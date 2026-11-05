import runpy
from pathlib import Path
from unittest.mock import patch
from tempfile import TemporaryDirectory
import json

bar = runpy.run_path(str(Path(__file__).with_name('monitor-formal-runs.py')))['progress_bar']
assert bar('0/617') == '[------------]  0.0% 0/617'
assert bar('50/100') == '[######------] 50.0% 50/100'
assert bar('1129/1129') == '[############] 100.0% 1129/1129'
assert bar('0/0') == '[------------]  0.0% 0/0'
assert bar('11/10').startswith('[############]')
print('Monitor progress checks passed')

summary = runpy.run_path(str(Path(__file__).with_name('monitor-formal-runs.py')))['api_summary']
ledger = {'attempts': [{'credential_slot': 'secondary', 'status': 'failed',
                       'completed_at': '2026-11-04T00:00:00Z',
                       'http_error': {'type': 'budget_exceeded', 'retryable': False}},
                      {'credential_slot': 'secondary', 'status': 'failed', 'error': 'model_transport_error'}],
          'max_concurrent_per_credential': 7,
          'credential_concurrency_overrides': {'primary': 7, 'secondary': 10}}
with patch.dict(summary.__globals__, {'read_json': lambda path: ledger}):
    assert summary({}, 0).startswith('API 在途 0/7'), 'Exhausted credentials are not available concurrency.'
    ledger['attempts'].append({'credential_slot': 'secondary', 'status': 'success',
                              'http_request_started_at': '2026-11-05T00:00:00Z',
                              'completed_at': '2026-11-05T00:00:01Z',
                              'provider_response_model': 'DeepSeek-V4.1-Flash-1017'})
    assert summary({}, 0).startswith('API 在途 0/17'), 'A successful response proves quota restoration.'
print('Monitor quota checks passed')

row = runpy.run_path(str(Path(__file__).with_name('monitor-formal-runs.py')))['row']
state = {'phase': 'needs_attention', 'pid': 58484, 'execution_complete': True,
         'execution_finished_at': '2026-11-04T07:12:40+00:00',
         'unresolved': [{'task_id': '146'}, {'task_id': '415'}]}
result = row('KuaiRand ClawRec', 615, 617, state, [], 0, {})
assert result[2:] == ['验收未通过（2题）', '11-04 15:12'], 'Finished execution is not a resumable outage.'
assert row('test', 10, 617, {'phase': 'paused'}, [], 0, {})[2:] == ['已暂停', '待恢复']
print('Monitor acceptance-state checks passed')

deliveries = runpy.run_path(str(Path(__file__).with_name('monitor-formal-runs.py')))['window_deliveries']
with TemporaryDirectory() as directory:
    window = Path(directory)
    original = window / 'cases/mars/example/outcome.json'
    repaired = window / 'service-repair/mars/example/outcome.json'
    for p in [original, repaired]: p.parent.mkdir(parents=True)
    original.write_text(json.dumps({'valid': False, 'result_sha256': 'original'}))
    repaired.write_text(json.dumps({'valid': True, 'previous_result_sha256': 'original'}))
    assert deliveries(window, 'mars')[:2] == (1, 0)
    repaired.write_text(json.dumps({'valid': True, 'previous_result_sha256': 'wrong-source'}))
    assert deliveries(window, 'mars')[:2] == (0, 1)
    repaired.unlink()
    assert deliveries(window, 'mars')[:2] == (0, 1), 'Failed requests are not completed deliveries.'
print('Monitor effective-delivery checks passed')

overview = runpy.run_path(str(Path(__file__).with_name('monitor-formal-runs.py')))['overview']
with TemporaryDirectory() as directory:
    import hashlib
    root = Path(directory)
    folder = root / 'kuairand-window512-20261103/generic-agent'
    folder.mkdir(parents=True)
    metrics = folder / 'metrics.json'
    metrics.write_text('{}')
    (folder / 'acceptance.json').write_text(json.dumps({'passed': True, 'assigned': 617, 'valid': 617,
        'metrics_sha256': hashlib.sha256(metrics.read_bytes()).hexdigest()}))
    with patch.dict(overview.__globals__, {'ROOT': root,
            'window_deliveries': lambda window, method: (617, 0, [])}):
        entry = next(r for r in overview(0, {}) if r[0] == 'KuaiRand 通用 Agent')
        assert entry[2] == '已评分', 'An independently accepted method must not wait for other methods.'
        metrics.write_text('{"changed":true}')
        entry = next(r for r in overview(0, {}) if r[0] == 'KuaiRand 通用 Agent')
        assert entry[2] != '已评分', 'Changed metrics invalidate their acceptance receipt.'
print('Monitor independent-scoring checks passed')

with TemporaryDirectory() as directory:
    import hashlib
    root = Path(directory)
    controls = root / 'agentrecbench-fixed-controls-20261103'
    case = controls / 'cases/clawrec/example'
    (case / 'attempt').mkdir(parents=True)
    (controls / 'resume-20261105').mkdir()
    (controls / 'resume-20261105/launch.json').write_text('{}')
    (controls / 'progress.json').write_text(json.dumps({'phase': 'full', 'status': 'running', 'pid': 123}))
    result = case / 'attempt/result.json'
    result.write_text('{}')
    (case / 'outcome.json').write_text(json.dumps({'status': 'submitted', 'method': 'clawrec',
        'ordered_item_ids': [str(i) for i in range(20)],
        'result_sha256': hashlib.sha256(result.read_bytes()).hexdigest()}))
    with patch.dict(overview.__globals__, {'ROOT': root}):
        rows = {r[0]: r for r in overview(0, {123: 0})}
        assert rows['AgentRecBench ClawRec 固定候选'][1:3] == ['1/300', '运行中']
        assert rows['AgentRecBench 通用 Agent 固定候选'][1] == '0/300'
        result.write_text('{"changed":true}')
        rows = {r[0]: r for r in overview(0, {123: 0})}
        assert rows['AgentRecBench ClawRec 固定候选'][1] == '0/300'
print('Monitor additional-control checks passed')

with TemporaryDirectory() as directory:
    root = Path(directory)
    queue = root / 'full-kuairec-api-continuation-20261103/run-clawrec-network'
    queue.mkdir(parents=True)
    (queue / 'progress.json').write_text(json.dumps({'status': 'completed', 'completed': 1129,
        'total': 1129, 'manifest_sha256': 'manifest'}))
    scored = root / 'scoring/scored-kuairec-clawrec-full-20261105'
    scored.mkdir(parents=True)
    metrics = scored / 'metrics.json'
    metrics.write_text('{}')
    (scored / 'acceptance.json').write_text(json.dumps({'passed': True, 'manifest_sha256': 'manifest',
        'metrics_sha256': hashlib.sha256(metrics.read_bytes()).hexdigest()}))
    with patch.dict(overview.__globals__, {'ROOT': root, 'clawrec_deliveries': lambda folder: 1129}):
        entry = next(r for r in overview(0, {}) if r[0] == 'KuaiRec ClawRec')
        assert entry[2] == '已评分', 'A completed ClawRec score needs a verified acceptance receipt.'
        metrics.write_text('{"changed":true}')
        entry = next(r for r in overview(0, {}) if r[0] == 'KuaiRec ClawRec')
        assert entry[2] != '已评分', 'Changed metrics must not retain scored status.'
print('Monitor ClawRec score-acceptance checks passed')
