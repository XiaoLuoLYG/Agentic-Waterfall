"""Audit only this run's Planner receipts against the shared read-only ledger."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3

HERE = Path(__file__).resolve().parent
BATCH = HERE.parent


def read(path):
    return json.loads(Path(path).read_bytes())


def main():
    metrics = read(HERE / 'metrics.json')
    assert metrics['assigned'] == 617 and metrics['independent_recomputation_passed']
    freeze = read(HERE / 'predictions-frozen.json')
    assert hashlib.sha256((HERE / 'predictions-frozen.json').read_bytes()).hexdigest() == metrics['freeze']['sha256']
    audit = {row['task_id']: row for row in [json.loads(line) for line in (HERE / 'audit.jsonl').open()]}
    assert len(audit) == 617
    ids = set()
    receipt_files = []

    def collect(value):
        if isinstance(value, dict):
            if value.get('attempt_id'):
                ids.add(value['attempt_id'])
            for item in value.get('service_attempts', []):
                collect(item)

    for base in [HERE / 'execution', HERE / 'transport-recovery']:
        if not base.exists():
            continue
        for pattern in ['**/02-planner.response.json', '**/02-planner.error.json']:
            for path in base.glob(pattern):
                collect(read(path));receipt_files.append({'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    current_success_ids = []
    for prediction in freeze['predictions']:
        folder = Path(prediction['native_result']['path']).parent
        old = audit[prediction['task_id']]
        assert read(folder / '01-parser.response.json') == read(old['stages']['parser']['response']['path'])
        assert read(folder / '01-parser.request.json') == read(old['stages']['parser']['request']['path'])
        receipt = read(folder / '02-planner.response.json')
        assert receipt['status'] == 'success' and receipt['provider_response_model'] == 'DeepSeek-V4.1-Flash-1017'
        current_success_ids.append(receipt['attempt_id'])
    assert len(set(current_success_ids)) == 617
    ledger = BATCH / 'full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-ledger.json.sqlite'
    records = []
    with sqlite3.connect('file:' + str(ledger) + '?mode=ro', uri=True) as db:
        for identifier in sorted(ids):
            row = db.execute('SELECT record FROM attempts WHERE id=?', (identifier,)).fetchone()
            assert row is not None, identifier
            value = json.loads(row[0]);assert value['experiment'] == 'method-deployment'
            assert value['status'] in ('success', 'failed')
            records.append(value)
    successful = [row for row in records if row['status'] == 'success']
    assert {row['id'] for row in successful} == set(current_success_ids)
    assert all(row.get('http_request_started_at') for row in successful)
    tokens = {key: sum((row.get('usage') or {}).get(key, 0) for row in records) for key in ['prompt_tokens', 'completion_tokens', 'total_tokens']}
    output = {'at': datetime.now(timezone.utc).isoformat(), 'assigned': 617, 'final_parser_receipts_reused': 617,
              'new_parser_API_requests': 0, 'distinct_successful_new_planner_responses': len(successful),
              'successful_HTTP_requests': len(successful),
              'failed_HTTP_requests': sum(row['status'] == 'failed' and bool(row.get('http_request_started_at')) for row in records),
              'ledger_attempts_without_HTTP_start': sum(not row.get('http_request_started_at') for row in records),
              'ledger_attempts_total': len(records), 'failed_errors': dict(Counter(row.get('error') for row in records if row['status'] == 'failed')),
              'provider_models': dict(Counter(row.get('provider_response_model') for row in successful)),
              'tokens_returned_by_provider': tokens, 'successful_receipts_missing_usage': sum(not row.get('usage') for row in successful),
              'monetary_cost': None, 'monetary_cost_note': 'Provider receipts do not contain a billed monetary amount; no price-based estimate is made.',
              'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'receipt_files': receipt_files,
              'attempts': [{key: row.get(key) for key in ['id', 'status', 'http_request_started_at', 'error', 'http_error', 'provider_response_model', 'usage', 'request_sha256']} for row in records]}
    with (HERE / 'accounting.json').open('x') as stream:
        json.dump(output, stream, ensure_ascii=False, indent=2);stream.write('\n')
    print(json.dumps({key: output[key] for key in ['assigned', 'new_parser_API_requests', 'distinct_successful_new_planner_responses', 'failed_HTTP_requests', 'ledger_attempts_without_HTTP_start', 'tokens_returned_by_provider', 'monetary_cost']}))


if __name__ == '__main__':
    main()
