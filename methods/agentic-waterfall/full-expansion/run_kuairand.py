"""Run non-overlapping KuaiRand baselines against the frozen test input."""
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import time

from prepare_kuairand import SOURCE

HERE = Path(__file__).resolve().parent/'kuairand'
RUNTIME = HERE.parent/'runtime'
METHODS = RUNTIME/'methods/agentic-waterfall'
sys.path.insert(0, str(METHODS))
sys.path.insert(0, str(RUNTIME/'formal'))
from error_policy import operational_failure
from gpu_lock import locked
from contextlib import nullcontext

STOP = False


FIRST_COMPLETE='first-complete-episode-v2'
METHOD_ERRORS={'invalid state','invalid ranking','invalid candidate permutation','invalid candidate permutation after retry','invalid_candidate_permutation','invalid recommendation indices','invalid search source or query','search budget exceeded','truncated response','truncated','state_truncated','plan_truncated','curation_truncated','state_contract_missing','plan_missing','no_acquired_items','curation_invalid_ids','invalid queries','invalid memory','invalid plan','missing search instructions','invalid search count','duplicate search id','unsupported platform','missing query','model response truncated','model returned invalid JSON','model response missing required fields','model response has invalid field type','invalid scores','invalid extraction','invalid preference','invalid profile','invalid parser result','unknown allowed candidate','invalid tool plan','filter without hard constraints','invalid semantic scores'}
def strict_category(result):
 if result.get('status') in ('submitted','no_delivery'):return 'attention' if result.get('error') else result['status']
 if result.get('status')!='failed':return 'attention'
 error=re.sub(r'^(ValueError|RuntimeError|JSONDecodeError):\s*','',str(result.get('error','')))
 if re.fullmatch(r'(model_http_(429|502|503|504)|model_timeout|model_transport_error|model_slots_busy)([:\s].*)?',error):return 'operational_failure'
 if error in METHOD_ERRORS|{'state_missing_user_state_md','state_missing_state_updates_md','state_missing_negative_signals_md'} or error.startswith(('Unexpected token','Unexpected end of JSON input','Expected property name')):return 'method_failure'
 return 'attention'

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save(path, value):
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');os.replace(temporary,path)

def response_files(actual):
    return sorted(set(actual.rglob('*response*.json'))|set(actual.rglob('*.error.json')))

def checked_category(result,actual):
    category=strict_category(result)
    receipts=[json.loads(path.read_text()) for path in response_files(actual)]
    receipts += [r['receipt'] for r in receipts if isinstance(r.get('receipt'),dict)]
    if category in ('submitted','no_delivery','method_failure') and not any(r.get('status')=='success' and isinstance(r.get('content'),str) for r in receipts):return 'attention'
    if category=='operational_failure':
        if not any(r.get('status')=='failed' and strict_category({'status':'failed','error':r.get('error')})=='operational_failure' for r in receipts):return 'attention'
        if any(r.get('http_error',{}).get('retryable') is False for r in receipts):return 'attention'
    return category

def previous_attempts(folder):
    records=sorted(folder.glob('attempt-*.outcome.json'))
    if {p.name[:11] for p in folder.glob('attempt-[0-9][0-9][0-9]*')}!={p.name[:11] for p in records}:raise RuntimeError('unresolved_prior_paid_attempt')
    service=0;terminal=None
    for path in records:
        record=json.loads(path.read_text());result_path=Path(record['result_path'])
        if not result_path.is_file() or sha(result_path)!=record['sha256']:raise ValueError('prior_attempt_artifact_changed')
        for name,digest in record.get('response_sha256',{}).items():
            if not Path(name).is_file() or sha(name)!=digest:raise ValueError('prior_response_artifact_changed')
        result=json.loads(result_path.read_text());category=checked_category(result,result_path.parent)
        if category=='attention' or record.get('returncode') not in (0,1) or (category in ('submitted','no_delivery') and record['returncode']):raise RuntimeError('unknown_prior_attempt')
        if terminal is not None:raise RuntimeError('prior_method_outcome_requires_frozen_selection')
        if category=='operational_failure':service+=1
        else:terminal=(result_path.parent,result,int(path.name[8:11]),category)
    return service,terminal


def claim_next(db, policy=None):
    if policy not in (None,FIRST_COMPLETE):raise ValueError('unknown_method_outcome_policy')
    db.execute('BEGIN IMMEDIATE')
    if db.execute("SELECT 1 FROM jobs WHERE status='running' LIMIT 1").fetchone():
        db.rollback()
        raise RuntimeError('unresolved running task; inspect attempts and ledger before recovery')
    failed="status='failed'" if policy==FIRST_COMPLETE else "status IN ('failed','method_failure')"
    if db.execute('SELECT 1 FROM jobs WHERE '+failed+' LIMIT 1').fetchone():
        db.rollback()
        raise RuntimeError('failed task requires investigation before recovery')
    row = db.execute("SELECT task,decision_id,method,attempt FROM jobs WHERE status='pending' ORDER BY task,method LIMIT 1").fetchone()
    if not row:
        db.commit()
        return None
    task, decision, method, attempt = row
    db.execute("UPDATE jobs SET status='running' WHERE task=? AND method=?", (task, method))
    db.commit()
    return {'task': task, 'decision_id': decision, 'method': method, 'attempt': attempt}


def finish_job(db, job, status):
    if status not in ('submitted', 'failed', 'method_failure'):
        raise ValueError('invalid final status')
    changed = db.execute("UPDATE jobs SET status=? WHERE task=? AND method=? AND status='running'", (status,job['task'],job['method'])).rowcount
    if changed != 1:
        raise RuntimeError('job reservation changed')
    db.commit()


def save_progress(db, status, current=None, reason=None):
    counts = dict(db.execute('SELECT status, count(*) FROM jobs GROUP BY status').fetchall())
    data = {'status': status, 'pid': os.getpid(), 'current': current, 'reason': reason,
            'total': sum(counts.values()), 'submitted': counts.get('submitted', 0),
            'failed': counts.get('failed', 0)+counts.get('method_failure',0), 'running': counts.get('running', 0), 'pending': counts.get('pending', 0),
            'legacy_14_tracked_separately': True, 'labels_read': False, 'training': False}
    tmp = HERE/'progress.json.tmp'
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    os.replace(tmp, HERE/'progress.json')


def handle_signal(*_):
    global STOP
    STOP = True


def run_job(db, job, source, policy=None):
    if policy not in (None,FIRST_COMPLETE):raise ValueError('unknown_method_outcome_policy')
    row = db.execute('SELECT offset,bytes FROM tasks WHERE id=?', (job['task'],)).fetchone()
    source.seek(row[0]); raw = source.read(row[1]); obj = json.loads(raw)
    if obj['observation']['decision_id'] != job['decision_id']:
        raise RuntimeError('source offset mismatch')
    folder = RUNTIME/'formal/kuairand-full'/job['method']/f"task-{job['task']:06d}"
    folder.mkdir(parents=True, exist_ok=True)
    public = folder/'public-input.jsonl'
    if public.exists():
        if public.read_bytes() != raw:
            raise RuntimeError('existing public input mismatch')
    else:
        public.write_bytes(raw)
    failures = {'method': 0, 'operational': 0}
    if policy==FIRST_COMPLETE:
        failures['operational'],terminal=previous_attempts(folder)
        if failures['operational']+bool(terminal)!=job['attempt']:raise RuntimeError('unresolved_prior_paid_attempt')
        if terminal:
            actual,result,_,category=terminal
            if category not in ('submitted','method_failure'):raise RuntimeError('unexpected_fixed_candidate_outcome')
            if category=='submitted':
                ids=result.get('ordered_item_ids');candidates=[x['id'] for x in obj['observation']['environment']['candidate_pool']]
                if not isinstance(ids,list) or not all(isinstance(x,str) for x in ids) or len(ids)!=len(candidates) or len(set(ids))!=len(ids) or set(ids)!=set(candidates):raise RuntimeError('invalid_submitted_artifact')
            link=folder/'run'
            if link.is_symlink():
                if link.resolve()!=actual.resolve():raise ValueError('unexpected final run path')
            elif link.exists():raise ValueError('unexpected final run path')
            else:os.symlink(actual.name,link)
            finish_job(db,job,'method_failure' if category=='method_failure' else 'submitted');return True
        if failures['operational']>=3:raise RuntimeError('service_attempt_limit_reached')
    while not STOP:
        attempt = job['attempt'] + 1
        job['attempt'] = attempt
        db.execute('UPDATE jobs SET attempt=? WHERE task=? AND method=?', (attempt, job['task'], job['method']))
        db.commit()
        dest = folder/f'attempt-{attempt:03d}'
        if dest.exists():
            raise RuntimeError('attempt directory already exists')
        if policy==FIRST_COMPLETE:
            save(folder/f'attempt-{attempt:03d}.started.json',{'result_path':str((dest/'result.json').resolve()),'started_at':time.time()})
        if job['method'] == 'i2agent':
            cmd = [sys.executable, str(METHODS/'i2agent/batch_run.py'), '--input', str(public), '--line', '0', '--dataset', 'kuairand', '--rank-max-tokens', '8192', '--output', str(dest)]
        else:
            cmd = ['node', str(METHODS/'paper-reproductions-run.mjs'), job['method'], str(public), '0', str(dest), 'kuairand']
        with locked() if job['method'] == 'recbot' else nullcontext():
            proc = subprocess.run(cmd, cwd=RUNTIME, capture_output=True, text=True)
        (folder/f'attempt-{attempt:03d}.process.log').write_text(proc.stdout+proc.stderr)
        result = json.loads((dest/'result.json').read_text()) if (dest/'result.json').exists() else {'status': 'failed', 'error': 'runner_before_result'}
        if policy==FIRST_COMPLETE:
            if not (dest/'result.json').is_file():
                save_progress(db,'needs_attention',job['decision_id'],'runner_or_uncommitted_paid_attempt');return False
            save(folder/f'attempt-{attempt:03d}.outcome.json',{'result_path':str((dest/'result.json').resolve()),'sha256':sha(dest/'result.json'),'returncode':proc.returncode,'response_sha256':{str(p.resolve()):sha(p) for p in response_files(dest)}})
        if result.get('status') == 'submitted':
            ids = result.get('ordered_item_ids')
            candidates = [x['id'] for x in obj['observation']['environment']['candidate_pool']]
            if not isinstance(ids, list) or len(ids) != len(candidates) or len(set(ids)) != len(ids) or set(ids) != set(candidates):
                if policy==FIRST_COMPLETE:
                    save_progress(db,'needs_attention',job['decision_id'],'invalid_submitted_artifact');return False
                result = {'status': 'failed', 'error': 'invalid_candidate_permutation'}
        event = {'task': job['decision_id'], 'method': job['method'], 'attempt': attempt, 'status': result.get('status'), 'error': result.get('error')}
        with (HERE/'events.jsonl').open('a') as f:
            f.write(json.dumps(event, ensure_ascii=False)+'\n')
        if policy==FIRST_COMPLETE:
            category=checked_category(result,dest)
            if category in ('attention','no_delivery') or proc.returncode not in (0,1) or (result.get('status')=='submitted' and proc.returncode):
                save_progress(db,'needs_attention',job['decision_id'],'unknown_runner_or_method_outcome');return False
            if category=='method_failure':
                os.symlink(dest.name,folder/'run');finish_job(db,job,'method_failure');return True
        if result.get('status') == 'submitted':
            os.symlink(dest.name, folder/'run')
            finish_job(db, job, 'submitted')
            return True
        if policy==FIRST_COMPLETE:
            category = 'operational' if category=='operational_failure' else 'method'
        else:
            category = 'operational' if operational_failure(result) or any(x in str(result.get('error','')) for x in ('public task preparation failed','runtime result missing','embedding failed','runner_before_result')) else 'method'
        failures[category] += 1
        if failures[category] >= (3 if category == 'operational' else 2):
            finish_job(db, job, 'failed')
            save_progress(db, 'needs_attention', job['decision_id'], result.get('error'))
            return False
        if category == 'operational':
            time.sleep(5*failures[category])
    raise RuntimeError('stopped during task; inspect unfinished attempt')


def main():
    signal.signal(signal.SIGINT, handle_signal); signal.signal(signal.SIGTERM, handle_signal)
    manifest = json.loads((HERE/'mind-index-manifest.json').read_text())
    policy=manifest.get('method_outcome_policy')
    if policy not in (None,FIRST_COMPLETE):raise ValueError('unknown_method_outcome_policy')
    hashes = json.loads((HERE/'runtime-sha256.json').read_text())
    for name, expected in hashes.items():
        if hashlib.sha256((HERE/name).read_bytes()).hexdigest() != expected:
            raise ValueError('runtime hash mismatch: '+name)
    sha = hashlib.sha256()
    with SOURCE.open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            sha.update(block)
    if sha.hexdigest() != manifest['source_sha256']:
        raise ValueError('full input hash mismatch')
    with (HERE/'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with sqlite3.connect(HERE/'mind-index.sqlite') as db, SOURCE.open('rb') as source:
            try:
                save_progress(db, 'running')
                while not STOP:
                    if shutil.disk_usage(HERE).free < 20*1024**3:
                        save_progress(db, 'needs_attention', reason='less than 20 GiB free')
                        return
                    job = claim_next(db,policy)
                    if job is None:
                        save_progress(db, 'complete')
                        return
                    save_progress(db, 'running', job['decision_id']+' / '+job['method'])
                    if not run_job(db, job, source,policy):
                        return
                save_progress(db, 'stopped')
            except Exception as exc:
                save_progress(db, 'needs_attention', reason=str(exc))
                raise


if __name__ == '__main__':
    main()
