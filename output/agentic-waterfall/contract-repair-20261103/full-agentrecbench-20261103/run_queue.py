"""Run a frozen, gated baseline manifest; retain attempts and resume without rerunning outcomes."""
import argparse, collections, concurrent.futures, fcntl, hashlib, json, os, re, subprocess, time
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent
BASE = OUT.parents[3]
MODEL = 'DeepSeek-V4.1-Flash-1017'

def now(): return datetime.now(timezone.utc).isoformat()
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def verify_files(files):
    for path, digest in files.items():
        if sha(path) != digest: raise ValueError('frozen file changed: ' + path)
def save(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    temp = p.with_suffix(p.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temp, p)

def category(value, folder, reviewed_worker_errors=()):
    if value.get('failed_task_count', 0):
        errors = [json.loads(p.read_text()).get('error') for p in folder.glob('search-execution/tasks/*/ERROR.json')]
        if (value.get('dataset') == 'kuairec' and value.get('method') == 'clawrec' and value.get('status') == 'submitted'
                and len(errors) == value['failed_task_count'] and all(e in reviewed_worker_errors for e in errors)):
            return 'method_partial_failure'
        return 'attention'
    if value.get('status') in ('submitted', 'no_delivery', 'not_applicable', 'idle'): return 'terminal'
    error = str(value.get('error', ''))
    receipts = []
    for p in folder.rglob('*.json'):
        if 'response' in p.name or 'error' in p.name:
            try:
                r = json.loads(p.read_text()); receipts.extend([r, r.get('receipt') or {}])
            except (ValueError, OSError): pass
    if any(r.get('http_error', {}).get('retryable') is False for r in receipts): return 'attention'
    if 'model_http_413' in error and any(r.get('http_error', {}).get('status') == 413 for r in receipts):
        return 'input_capacity_failure'
    gate_timeouts = ('request_gate_call_deadline_exceeded', 'request_gate_wait_exceeds_90s')
    gate_error = error.removeprefix('RuntimeError: ')
    if gate_error in gate_timeouts and any(r.get('error') == gate_error and 'http_request_started_at' in r and r['http_request_started_at'] is None for r in receipts):
        return 'service_failure'
    transport = r'model_http_(429|502|503|504)|model_timeout|model_transport_error'
    if re.search(transport, error) and any(r.get('status') == 'failed' and re.search(transport, str(r.get('error', ''))) for r in receipts):
        return 'service_failure'
    if re.search(r'budget_exhausted|model_calls_not_enabled|model_slots_busy|request_gate_|runner_before_result', error): return 'attention'
    formats = value.get('format_attempt_accounting', [])
    if formats and formats[-1].get('attempts_consumed')==3 and all(a.get('format_error') for a in formats[-1]['attempts']):
        return 'method_failure'
    known = ('invalid ', 'invalid_', 'truncated', 'missing ', 'state_', 'plan_', 'curation_', 'no_acquired', 'Unexpected ', 'Expected ', 'unknown preference', 'model response', 'model returned', 'duplicate MARS rank ID', 'MARS extraction must', 'empty MARS response')
    return 'method_failure' if any(x in error for x in known) else 'attention'

def run_one(row, runtime, folder, environment, frozen_files=None):
    verify_files(frozen_files or {})
    verify_files(row['input_sha256'])
    runtime = Path(row.get('runtime', runtime))
    group = row['dataset'] + '/' + row['method']
    case = folder / 'cases' / row['id']
    case.mkdir(parents=True, exist_ok=True)
    prior = None
    attempts = row.get('service_attempts_remaining', 1)
    assert attempts == 1, 'One episode per version; no outer retry'
    for n in range(1, attempts + 1):
        dest = case / f'attempt-{n:02}'
        outcome = case / f'attempt-{n:02}.json'
        if outcome.exists():
            record = json.loads(outcome.read_text())
            if sha(record['result_path']) != record['result_sha256']: raise ValueError('prior result changed')
            if record['category'] != 'service_failure': return record
            prior = dest
            continue
        if dest.exists(): raise RuntimeError('unresolved interrupted attempt: ' + str(dest))
        if row['method'] == 'waterfall': dest.mkdir()
        argv = [x.replace('{CODE}', str(runtime)).replace('{OUTPUT}', str(dest)) for x in row['argv']]
        env = {**environment, **{k:v.replace('{CODE}', str(runtime)).replace('{OUTPUT}', str(dest)) for k,v in row.get('environment', {}).items()}}
        env['NODE_OPTIONS'] = '--import=' + str(runtime.parent / 'register.mjs')
        if prior:
            env['BASELINE_REPLAY_DIR'] = str(prior)
            if row['method'] == 'i2agent': argv.extend(['--resume-from', str(prior)])
        started = now()
        with (case / f'attempt-{n:02}.log').open('x') as log:
            proc = subprocess.run(argv, cwd=runtime, env=env, stdout=log, stderr=subprocess.STDOUT)
        verify_files(frozen_files or {})
        result = dest / 'result.json'
        if not result.exists():
            dest.mkdir(parents=True, exist_ok=True)
            save(result, {'status': 'failed', 'error': 'runner_before_result', 'returncode': proc.returncode})
        value = json.loads(result.read_text())
        if row['method'] == 'waterfall': value = value.get('result', value)
        record = {'id': row['id'], 'group': group, 'dataset': row['dataset'], 'method': row['method'],
                  'case_id': row['case_id'], 'attempt': n, 'category': category(value, dest, row.get('reviewed_worker_errors', ())),
                  'status': value.get('status'), 'error': value.get('error'), 'returncode': proc.returncode,
                  'failed_task_count': value.get('failed_task_count', 0),
                  'started_at': started, 'finished_at': now(), 'result_path': str(result), 'result_sha256': sha(result)}
        save(outcome, record)
        if record['category'] != 'service_failure': return record
        prior = dest
        if n < attempts: time.sleep(30)
    record['category'] = 'attention'
    record['service_attempts_exhausted'] = True
    return record

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('manifest', type=Path); a = ap.parse_args()
    plan = json.loads(a.manifest.read_text()); runtime = Path(plan['runtime']); folder = Path(plan['output'])
    assert folder.is_relative_to(OUT) and runtime.is_relative_to(OUT)
    rows = plan['commands']; assert rows and len({r['id'] for r in rows}) == len(rows)
    assert all(Path(r.get('runtime', runtime)).is_relative_to(OUT) for r in rows)
    assert all(r.get('service_attempts_remaining') == 1 for r in rows), 'One episode per version; native bounded transport retries only'
    assert 1 <= plan.get('concurrency', 1) <= 10
    manifest_sha256 = sha(a.manifest)
    frozen_files = {**plan['files_sha256'], str(a.manifest.resolve()): manifest_sha256}
    verify_files(frozen_files)
    if plan['phase'] == 'full':
        gate = json.loads(Path(plan['gate']).read_text())
        assert gate['status'] == 'passed' and gate['manifest_sha256'] == sha(a.manifest)
        assert gate['source_manifest_sha256'] == sha(runtime.parent / 'source-manifest.json')
    else: assert plan['phase'] == 'pilot'
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / 'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        identity = folder / 'queue-identity.json'
        if identity.exists():
            if json.loads(identity.read_text())['manifest_sha256'] != manifest_sha256: raise ValueError('queue manifest changed; use a new output directory')
        else: save(identity, {'manifest_sha256': manifest_sha256})
        journal = folder / 'outcomes.jsonl'; done = {}
        row_ids = {r['id'] for r in rows}
        if journal.exists():
            for line in journal.read_text().splitlines():
                record = json.loads(line); assert record['id'] in row_ids and record['id'] not in done
                assert sha(record['result_path']) == record['result_sha256']; done[record['id']] = record
        for record in plan.get('reused_results', []):
            assert record['id'] in row_ids
            assert sha(record['result_path']) == record['result_sha256']
            if record['id'] not in done:
                record = {**record, 'reused_from_pilot': True}
                with journal.open('a') as stream:
                    stream.write(json.dumps(record, ensure_ascii=False)+'\n'); stream.flush(); os.fsync(stream.fileno())
                done[record['id']] = record
        environment = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1',
            'OPENBLAS_NUM_THREADS': '1', 'TOKENIZERS_PARALLELISM': 'false', 'WATERFALL_MODEL_TIMEOUT_MS': '180000',
            'MODEL_CONFIG_FILE': str(BASE / 'HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json'),
            'OPENAI_MODEL': MODEL, 'WATERFALL_FORMAL_ROUTE': '1', 'WATERFALL_REQUEST_GATE_DIR': str(OUT/'request-gates'), 'NODE_OPTIONS': '--import=' + str(runtime.parent / 'register.mjs'),
            'MARS_DOMAIN_FILE': str(OUT / 'inputs/mars-domain.json')}
        paused = {r['group'] for r in done.values() if r['category'] == 'attention'}
        pending = [r for r in rows if r['id'] not in done]; active = {}
        concurrency = json.loads((OUT/'control.json').read_text()).get('concurrency', plan.get('concurrency', 4))
        assert type(concurrency) is int and 1 <= concurrency <= 10
        def progress(status):
            save(folder / 'progress.json', {'status': status, 'pid': os.getpid(), 'at': now(), 'total': len(rows),
                'completed': len(done), 'by_group': dict(collections.Counter(r['group'] for r in done.values())),
                'by_method_domain_status': dict(collections.Counter(
                    '/'.join((r['method'],r['case_id'].split(':')[1],r['status'])) for r in done.values())),
                'active_by_method': dict(collections.Counter(r['method'] for r in active.values())),
                'statuses': dict(collections.Counter(r['status'] for r in done.values())),
                'categories': dict(collections.Counter(r['category'] for r in done.values())),
                'active': [r['id'] for r in active.values()], 'concurrency': concurrency, 'paused_groups': sorted(paused),
                'remaining': len(rows) - len(done), 'manifest_sha256': manifest_sha256})
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            while pending or active:
                concurrency = json.loads((OUT/'control.json').read_text()).get('concurrency', plan.get('concurrency', 4))
                assert type(concurrency) is int and 1 <= concurrency <= 10
                while len(active) < concurrency:
                    index = next((i for i,r in enumerate(pending) if r['dataset']+'/'+r['method'] not in paused), None)
                    if index is None: break
                    row = pending.pop(index); active[pool.submit(run_one, row, runtime, folder, environment, frozen_files)] = row
                progress('running' if active else 'needs_attention')
                if not active: break
                finished, _ = concurrent.futures.wait(active, timeout=10, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in finished:
                    row = active.pop(future)
                    try: record = future.result()
                    except Exception as error:
                        paused.add(row['dataset']+'/'+row['method'])
                        save(folder/'attention'/f"{row['id']}.json", {'id': row['id'], 'error': str(error), 'at': now()})
                        continue
                    if record['category'] == 'attention': paused.add(record['group'])
                    with journal.open('a') as stream:
                        stream.write(json.dumps(record, ensure_ascii=False)+'\n'); stream.flush(); os.fsync(stream.fileno())
                    done[record['id']] = record
                    print(json.dumps(record, ensure_ascii=False), flush=True)
        progress('completed' if len(done) == len(rows) and not paused else 'needs_attention')

if __name__ == '__main__': main()
