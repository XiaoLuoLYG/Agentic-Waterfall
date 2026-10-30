"""Run non-overlapping KuaiRand baselines against the frozen test input."""
import fcntl
import hashlib
import json
import os
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


def claim_next(db):
    db.execute('BEGIN IMMEDIATE')
    if db.execute("SELECT 1 FROM jobs WHERE status='running' LIMIT 1").fetchone():
        db.rollback()
        raise RuntimeError('unresolved running task; inspect attempts and ledger before recovery')
    if db.execute("SELECT 1 FROM jobs WHERE status='failed' LIMIT 1").fetchone():
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
    if status not in ('submitted', 'failed'):
        raise ValueError('invalid final status')
    changed = db.execute("UPDATE jobs SET status=? WHERE task=? AND method=? AND status='running'", (status,job['task'],job['method'])).rowcount
    if changed != 1:
        raise RuntimeError('job reservation changed')
    db.commit()


def save_progress(db, status, current=None, reason=None):
    counts = dict(db.execute('SELECT status, count(*) FROM jobs GROUP BY status').fetchall())
    data = {'status': status, 'pid': os.getpid(), 'current': current, 'reason': reason,
            'total': sum(counts.values()), 'submitted': counts.get('submitted', 0),
            'failed': counts.get('failed', 0), 'running': counts.get('running', 0), 'pending': counts.get('pending', 0),
            'legacy_14_tracked_separately': True, 'labels_read': False, 'training': False}
    tmp = HERE/'progress.json.tmp'
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    os.replace(tmp, HERE/'progress.json')


def handle_signal(*_):
    global STOP
    STOP = True


def run_job(db, job, source):
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
    while not STOP:
        attempt = job['attempt'] + 1
        job['attempt'] = attempt
        db.execute('UPDATE jobs SET attempt=? WHERE task=? AND method=?', (attempt, job['task'], job['method']))
        db.commit()
        dest = folder/f'attempt-{attempt:03d}'
        if dest.exists():
            raise RuntimeError('attempt directory already exists')
        if job['method'] == 'i2agent':
            cmd = [sys.executable, str(METHODS/'i2agent/batch_run.py'), '--input', str(public), '--line', '0', '--dataset', 'kuairand', '--rank-max-tokens', '8192', '--output', str(dest)]
        else:
            cmd = ['node', str(METHODS/'paper-reproductions-run.mjs'), job['method'], str(public), '0', str(dest), 'kuairand']
        with locked() if job['method'] == 'recbot' else nullcontext():
            proc = subprocess.run(cmd, cwd=RUNTIME, capture_output=True, text=True)
        (folder/f'attempt-{attempt:03d}.process.log').write_text(proc.stdout+proc.stderr)
        result = json.loads((dest/'result.json').read_text()) if (dest/'result.json').exists() else {'status': 'failed', 'error': 'runner_before_result'}
        if result.get('status') == 'submitted':
            ids = result.get('ordered_item_ids')
            candidates = [x['id'] for x in obj['observation']['environment']['candidate_pool']]
            if not isinstance(ids, list) or len(ids) != len(candidates) or len(set(ids)) != len(ids) or set(ids) != set(candidates):
                result = {'status': 'failed', 'error': 'invalid_candidate_permutation'}
        event = {'task': job['decision_id'], 'method': job['method'], 'attempt': attempt, 'status': result.get('status'), 'error': result.get('error')}
        with (HERE/'events.jsonl').open('a') as f:
            f.write(json.dumps(event, ensure_ascii=False)+'\n')
        if result.get('status') == 'submitted':
            os.symlink(dest.name, folder/'run')
            finish_job(db, job, 'submitted')
            return True
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
                    job = claim_next(db)
                    if job is None:
                        save_progress(db, 'complete')
                        return
                    save_progress(db, 'running', job['decision_id']+' / '+job['method'])
                    if not run_job(db, job, source):
                        return
                save_progress(db, 'stopped')
            except Exception as exc:
                save_progress(db, 'needs_attention', reason=str(exc))
                raise


if __name__ == '__main__':
    main()
