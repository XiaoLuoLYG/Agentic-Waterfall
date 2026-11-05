"""Archive only proven transport failures so the unchanged controller resumes them."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys

HERE = Path(__file__).resolve().parent
BATCH = HERE.parent


def read(path):
    return json.loads(Path(path).read_bytes())


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def receipt_checks(value, attempt_ids):
    if isinstance(value, dict):
        assert value.get('status') != 'success', 'successful Planner prefix must be replayed, never resent'
        assert not value.get('content'), 'successful/partial content requires explicit prefix review'
        assert not value.get('partial_response'), 'partial streamed content requires explicit prefix review'
        if value.get('http_request_started_at'):
            assert value.get('error') == 'model_http_429' and value.get('http_error', {}).get('retryable') is True
        if value.get('attempt_id'):
            attempt_ids.add(value['attempt_id'])
        for child in value.get('service_attempts', []):
            receipt_checks(child, attempt_ids)


def main():
    flag = sys.argv[1] if len(sys.argv) > 1 else '--check'
    assert flag in ('--check', '--archive')
    assert not (HERE / 'predictions-frozen.json').exists()
    report = read(HERE / 'full-report.json')
    assert report['status'] == 'needs_attention' and report['assigned'] == len(report['records']) == 617
    rows = {row['task_id']: row for row in [json.loads(line) for line in (HERE / 'audit.jsonl').open()]}
    selected = []
    attempt_ids = set()
    for outcome in report['records']:
        path = Path(outcome['result']['path'])
        assert path.parent.parent == HERE / 'execution' and sha(path) == outcome['result']['sha256']
        result = read(path)
        if result['status'] == 'submitted':
            continue
        if result.get('error') != 'request_gate_call_deadline_exceeded':
            continue  # Native method failures and any unreviewed infrastructure condition remain untouched.
        folder = path.parent
        assert not (folder / '02-planner.response.json').exists()
        assert read(folder / 'selection.json') == rows[result['context_id']]
        request = read(folder / '02-planner.request.json')
        canonical = json.dumps(request, ensure_ascii=False, separators=(',', ':'))
        assert hashlib.sha256(canonical.encode()).hexdigest() == rows[result['context_id']]['stages']['planner']['current_request_sha256']
        receipt_checks(read(folder / '02-planner.error.json'), attempt_ids)
        selected.append({'task_id': result['context_id'], 'folder': str(folder), 'original_result': outcome['result'],
                         'request_sha256': rows[result['context_id']]['stages']['planner']['current_request_sha256']})
    ledger = BATCH / 'full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-ledger.json.sqlite'
    with sqlite3.connect('file:' + str(ledger) + '?mode=ro', uri=True) as db:
        for identifier in attempt_ids:
            row = db.execute('SELECT record FROM attempts WHERE id=?', (identifier,)).fetchone()
            assert row is not None and json.loads(row[0])['status'] == 'failed', identifier
    if flag == '--archive' and selected:
        archive = HERE / 'transport-recovery' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        archive.mkdir(parents=True)
        shutil.copy2(__file__, archive / Path(__file__).name)
        shutil.copy2(HERE / 'full-report.json', archive / 'prior-full-report.json')
        for item in selected:
            destination = archive / Path(item['folder']).name
            assert not destination.exists()
            Path(item['folder']).rename(destination)
            item['archive'] = str(destination)
            item['archived_result'] = {'path': str(destination / 'result.json'), 'sha256': sha(destination / 'result.json')}
        manifest = {'at': datetime.now(timezone.utc).isoformat(), 'source_sha256': sha(__file__), 'API_requests': 0,
                    'reason': 'Only queue failures or retryable HTTP429 without any successful Planner content; identical payload resumes through the unchanged controller.',
                    'selected': selected, 'ledger_attempt_ids_checked_failed': sorted(attempt_ids)}
        (archive / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': flag, 'selected': len(selected), 'task_ids': [item['task_id'] for item in selected], 'API_requests': 0}))


if __name__ == '__main__':
    main()
