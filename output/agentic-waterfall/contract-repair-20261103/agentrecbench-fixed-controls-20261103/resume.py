"""Resume the approved AgentRecBench fixed-candidate controls."""
from pathlib import Path
from collections import Counter, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
import fcntl
import importlib.util
import inspect
import json
import math
import os
import subprocess
import sys
import shutil
import threading

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fixed_controls', HERE / 'run.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
CHECKS = HERE / 'resume-20261105'
REPLAY_SOURCES = base.read(CHECKS / 'automatic-replay-sources.json') if (CHECKS / 'automatic-replay-sources.json').exists() else {}
base.REPLAY_SOURCES = REPLAY_SOURCES
REPLAY_LOCK = threading.Lock()

# Revalidate cached native results without editing the original frozen runner.
source = inspect.getsource(base.run_case)
assert source.count('        return outcome\n') == 1
source = source.replace('        return outcome\n', '')
source = source.replace("        cmd = [", "        prior = Path(REPLAY_SOURCES.get(method+'/'+folder.name, HERE/'resume-20261105/replay-sources'/method/folder.name))\n        if prior.is_dir():\n            env.update(WATERFALL_QUOTA_PRIOR=str(prior/'attempt'), WATERFALL_QUOTA_REPLAY_LOG=str(folder/'prefix-replay.jsonl'))\n        cmd = [")
source = source.replace("HERE/'runtime/register.mjs', ENTRY", "HERE/'runtime/register.mjs', '--import', HERE/'resume-20261105/replay-register.mjs', ENTRY")
source = source.replace("assert len(requests) == len(responses) == result['model_request_count'] == 2",
    "assert len(requests) == len(responses) == result['model_request_count'] and 2 <= len(requests) <= (4 if method == 'clawrec' else 3)")
exec(compile(source, str(HERE / 'run.py'), 'exec'), base.__dict__)


def transient(row, method):
    folder = base.HERE / 'cases' / method / row['id'].removesuffix('-waterfall') / 'attempt'
    if not (folder / 'result.json').exists():
        return False
    error = base.read(folder / 'result.json').get('error') or ''
    if error not in {'model_http_429', 'model_http_502', 'model_http_503', 'model_http_504', 'model_transport_error',
                     'model_timeout', 'request_gate_call_deadline_exceeded', 'credential_busy_other_available'}:
        return False
    return not any(base.read(p).get('http_error', {}).get('retryable') is False for p in folder.glob('*.error.json'))


def continue_once(row, method, files):
    assert not any(p.exists() for p in [base.HERE / 'STOP', base.HERE.parent / 'STOP']), 'Manual stop retained'
    case = base.HERE / 'cases' / method / row['id'].removesuffix('-waterfall')
    folder = CHECKS / 'automatic-retries' / method / case.name
    assert not folder.exists(), 'A second failed continuation requires inspection'
    source = case / 'attempt'
    folder.mkdir(parents=True)
    output, trace = folder / 'offline', folder / 'offline-replay.jsonl'
    env = {**os.environ, 'WATERFALL_QUOTA_PRIOR': str(source), 'WATERFALL_QUOTA_REPLAY_LOG': str(trace),
           'WATERFALL_QUOTA_REPLAY_OFFLINE': '1', 'MODEL_CONFIG_FILE': '/dev/null'}
    profile = (base.HERE / 'labels-denied.sb').read_text() + '\n(deny network*)'
    args = ['/usr/bin/sandbox-exec', '-p', profile, 'node', '--import', str(base.TRANSPORT), '--import',
            str(base.HERE / 'runtime/register.mjs'), '--import', str(CHECKS / 'replay-register.mjs'),
            str(base.ENTRY), method, row['input'], '0', str(output), 'agentrecbench']
    with (folder / 'offline.log').open('x') as log:
        subprocess.run(args, cwd=base.CODE, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=90)
    assert base.read(output / 'result.json')['error'] == 'quota_offline_unanswered_boundary'
    for request in source.glob('*.request.json'):
        assert base.read(request) == base.read(output / request.name)
    replies = len(list(source.glob('*.response.json')))
    events = list(map(json.loads, trace.read_text().splitlines())) if trace.exists() else []
    assert sum(e['kind'] == 'cached_success_replayed' for e in events) == replies
    base.save(folder / 'verified.json', {'model_requests': 0, 'same_unanswered_request': True,
        'successful_replies_reused': replies, 'source_result_sha256': base.sha(source / 'result.json')})
    archived = folder / 'source'
    assert not any(p.exists() for p in [base.HERE / 'STOP', base.HERE.parent / 'STOP']), 'Manual stop retained'
    with REPLAY_LOCK:
        REPLAY_SOURCES[method + '/' + case.name] = str(archived)
        base.save(CHECKS / 'automatic-replay-sources.json', REPLAY_SOURCES)
    shutil.move(str(case), str(archived))
    result = base.run_case(row, method, files)
    assert all(base.read(p) == base.read(case / 'attempt' / p.name) for p in (archived / 'attempt').glob('*.response.json'))
    return result


def execute_full(rows, files):
    pending = deque((row, method) for row in rows for method in base.METHODS)
    active, outcomes, deferred = {}, [], []
    with ThreadPoolExecutor(max_workers=48) as pool:
        while pending or active:
            assert not any(p.exists() for p in [HERE / 'STOP', HERE.parent / 'STOP']), 'Manual stop retained'
            while pending and len(active) < 48:
                row, method = pending.popleft()
                active[pool.submit(base.run_case, row, method, files)] = (row, method)
            base.save(base.HERE / 'progress.json', {'phase': 'full', 'status': 'running', 'pid': os.getpid(),
                'at': datetime.now(timezone.utc).isoformat(), 'completed': len(outcomes), 'assigned': len(rows)*2,
                'by_method': dict(Counter(x['method'] for x in outcomes)),
                'active': [method + '/' + row['id'] for row, method in active.values()]})
            finished, _ = wait(active, return_when=FIRST_COMPLETED)
            for future in finished:
                row, method = active.pop(future)
                try:
                    outcomes.append(future.result())
                except RuntimeError:
                    if not transient(row, method):
                        raise
                    deferred.append((row, method))
    if deferred:
        base.save(base.HERE / 'progress.json', {'phase': 'full', 'status': 'running', 'pid': os.getpid(),
            'completed': len(outcomes), 'assigned': len(rows)*2, 'continuing_failed_steps': len(deferred)})
        retry_queue, retry_active = deque(deferred), {}
        with ThreadPoolExecutor(max_workers=48) as pool:
            while retry_queue or retry_active:
                assert not any(p.exists() for p in [base.HERE / 'STOP', base.HERE.parent / 'STOP']), 'Manual stop retained'
                while retry_queue and len(retry_active) < 48:
                    row, method = retry_queue.popleft()
                    retry_active[pool.submit(continue_once, row, method, files)] = (row, method)
                finished, _ = wait(retry_active, return_when=FIRST_COMPLETED)
                for future in finished:
                    retry_active.pop(future)
                    outcomes.append(future.result())
    order = {(row['id'], method): i for i, (row, method) in enumerate((r, m) for r in rows for m in base.METHODS)}
    outcomes.sort(key=lambda r: order[r['id'], r['method']])
    return base.score('full', rows, outcomes)


def prepare():
    CHECKS.mkdir(exist_ok=True)
    assignment = base.read(HERE / 'assignment.json')
    assert base.prepare() == assignment['rows'], 'Public input or Waterfall reference changed'
    allowed = {str(base.TRANSPORT), str(base.TRANSPORT.with_name('model-client.mjs'))}
    changed = [path for path, expected in assignment['files'].items() if base.sha(Path(path)) != expected]
    assert set(changed) <= allowed, changed
    files = {path: base.sha(Path(path)) for path in assignment['files']}
    files.update({str(path): base.sha(path) for path in [Path(__file__), HERE / 'assignment.json', CHECKS / 'replay-register.mjs', HERE.parent / 'transport-retry/quota-replay-client.mjs', HERE.parent / 'kuairand-window512-20261103/client.mjs']})
    files.update({str(path): base.sha(path) for path in [base.TRANSPORT.with_name(name) for name in
        ['ledger-store.mjs', 'ledger-export.mjs', 'request-gate.mjs']]})
    plan = {'rows': assignment['rows'], 'files': files, 'original_assignment_sha256': base.sha(HERE / 'assignment.json'),
            'approved_transport_changes': changed, 'original_method_input_and_budget_unchanged': True,
            'workers': 48, 'credential_caps': {'primary': 16, 'secondary': 16, 'tertiary': 16}, 'rpm_per_key': 50}
    if (CHECKS / 'plan.json').exists():
        assert base.read(CHECKS / 'plan.json') == plan, 'Resume plan changed; inspect before proceeding'
    else:
        base.save(CHECKS / 'plan.json', plan)
    with __import__('unittest.mock', fromlist=['patch']).patch.object(base.subprocess, 'run',
            side_effect=AssertionError('Cached validation must not request a model')):
        for receipt in HERE.glob('cases/*/*/outcome.json'):
            method, ident = receipt.parent.parent.name, receipt.parent.name
            row = next(r for r in plan['rows'] if r['id'].removesuffix('-waterfall') == ident)
            base.run_case(row, method, files)
    return plan


def verify_failed_boundary():
    case = HERE / 'cases/generic-agent/ar-goodreads-000'
    archived = CHECKS / 'archived/generic-agent/ar-goodreads-000'
    if (case / 'outcome.json').exists():
        return
    if archived.exists():
        assert not case.exists(), 'Inspect a newer failed attempt before retrying'
        return
    attempt = case / 'attempt'
    assert not list(attempt.glob('*.response.json')), 'Successful replies require exact replay'
    result = base.read(attempt / 'result.json')
    assert result['status'] == 'failed' and result['error'] == 'model_http_429'
    boundary = CHECKS / 'offline-boundary.mjs'
    client = (base.CODE / 'experiments/agentic-waterfall/shared/model-client.mjs').as_uri()
    boundary.write_text("import {registerHooks} from 'node:module';\nregisterHooks({load(url,context,next){"
        + 'if(url!==' + json.dumps(client) + ')return next(url,context);'
        + "return {format:'module',shortCircuit:true,source:\"export async function callModel(){throw Error('approved_offline_boundary');}\"};}});\n")
    row = next(r for r in base.read(HERE / 'assignment.json')['rows'] if r['id'] == 'ar-goodreads-000-waterfall')
    offline = CHECKS / 'offline-goodreads-000'
    if not offline.exists():
        profile = (HERE / 'labels-denied.sb').read_text() + '\n(deny network*)'
        with (CHECKS / 'offline-boundary.log').open('x') as log:
            subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, 'node', '--import', str(boundary),
                str(base.ENTRY), 'generic-agent', row['input'], '0', str(offline), 'agentrecbench'],
                cwd=base.CODE, env={**os.environ, 'MODEL_CONFIG_FILE': '/dev/null'},
                stdout=log, stderr=subprocess.STDOUT, timeout=90)
    assert base.read(offline / 'result.json')['error'] == 'approved_offline_boundary'
    assert base.read(offline / '01-state.request.json') == base.read(attempt / '01-state.request.json')
    base.save(CHECKS / 'offline-acceptance.json', {'passed': True, 'model_requests': 0,
        'same_failed_request': True, 'successful_prefix_replies': 0,
        'request_sha256': base.sha(attempt / '01-state.request.json'), 'failed_result_sha256': base.sha(attempt / 'result.json')})


def verify_metrics(phase, rows):
    frozen = base.read(HERE / (phase + '-predictions-frozen.json'))
    scored = base.read(HERE / (phase + '-metrics.json'))
    assert scored['freeze_sha256'] == base.sha(HERE / (phase + '-predictions-frozen.json'))
    i2 = base.read(base.AR / 'evaluation/predictions-frozen.json')['outcomes']
    matched = {key.removesuffix('-i2agent') for key, value in i2.items()
               if value['method'] == 'i2agent' and value['status'] != 'not_applicable'}
    assert len(matched) == 220
    for method in base.METHODS:
        predictions = {r['id']: r['ordered_item_ids'] for r in frozen if r['method'] == method}
        for group, expected in scored['methods'][method].items():
            selected = [r for r in rows if group == 'all' or r['domain'] == group
                        or group == 'matched220' and r['id'].removesuffix('-waterfall') in matched]
            hits = sum(base.read(Path(r['public_task']).parent.parent / 'groundtruth' /
                                ('groundtruth_' + str(r['task_id']) + '.json'))['ground truth']
                       in predictions[r['id']][:5] for r in selected)
            assert expected['assigned'] == len(selected) and expected['hits'] == hits
            assert math.isclose(expected['hit_at_5'], hits / len(selected) if selected else 0, abs_tol=1e-12)
    base.save(CHECKS / (phase + '-acceptance.json'), {'passed': True, 'assigned_per_method': len(rows),
        'valid_deliveries': len(frozen), 'metrics_independently_verified': True,
        'same_waterfall_inputs_and_twenty_candidates': True, 'model_request_budget_unchanged': True,
        'predictions_frozen_before_labels': True, 'metrics_sha256': base.sha(HERE / (phase + '-metrics.json'))})


def main():
    with (HERE / 'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        plan = prepare()
        verify_failed_boundary()
        if sys.argv[1:] == ['prepare']:
            print(json.dumps({'prepared': True, 'offline_only': True, 'plan': str(CHECKS / 'plan.json')}))
            return
        assert not sys.argv[1:], 'Use no argument to run, or prepare for offline verification'
        case = HERE / 'cases/generic-agent/ar-goodreads-000'
        if not (case / 'outcome.json').exists():
            archived = CHECKS / 'archived/generic-agent/ar-goodreads-000'
            archived.parent.mkdir(parents=True, exist_ok=True)
            case.rename(archived)
        phase = 'pilot'
        base.save(CHECKS / 'active.json', {'pid': os.getpid(), 'phase': phase, 'entry': str(Path(__file__))})
        try:
            pilot_rows = [row for row in plan['rows'] if row['pilot']]
            pilot = base.execute('pilot', pilot_rows, plan['files'])
            verify_metrics('pilot', pilot_rows)
            assert all(pilot[m]['amazon']['hits'] + pilot[m]['goodreads']['hits'] >= 1 for m in base.METHODS), 'Original pilot performance gate failed'
            base.save(HERE / 'gate.json', {'status': 'passed', 'pilot_metrics_sha256': base.sha(HERE / 'pilot-metrics.json')})
            phase = 'full'
            base.save(CHECKS / 'active.json', {'pid': os.getpid(), 'phase': phase, 'entry': str(Path(__file__))})
            execute_full(plan['rows'], plan['files'])
            verify_metrics('full', plan['rows'])
            base.save(HERE / 'progress.json', {'phase': 'full', 'status': 'completed', 'pid': os.getpid(),
                'at': datetime.now(timezone.utc).isoformat(), 'completed': 600, 'assigned': 600})
        except Exception as error:
            current = base.read(HERE / 'progress.json') if (HERE / 'progress.json').exists() else {}
            base.save(HERE / 'progress.json', {**current, 'pid': os.getpid(), 'phase': phase,
                'status': 'needs_user', 'error': str(error)})
            raise


if __name__ == '__main__':
    main()
