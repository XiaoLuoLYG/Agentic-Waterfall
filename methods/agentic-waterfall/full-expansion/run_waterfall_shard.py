"""Copy to the frozen Waterfall root as run_shard.py; preflight a prediction shard."""
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys


def save(shard, status, filename='supervisor.json', **details):
    path = shard / filename
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps({'status': status, 'pid': os.getpid(),
                                    'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                    **details}, indent=2) + '\n')
    os.replace(temporary, path)


def verify(root, shard, q, allow_retryable=False):
    plan = json.loads((root / 'plan.json').read_text())
    source = json.loads((root / 'source-sha256.json').read_text())
    for name, digest in source.items():
        path = root / 'code' / name
        assert path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest, name
    dispositions = q.load_validation_dispositions(shard, plan)
    tasks = [json.loads(line) for line in (shard / 'tasks.jsonl').read_text().splitlines()]
    counts = dict(valid=0, held=0, failed=0, missing=0, retryable=0, total=len(tasks), counts={})
    for task in tasks:
        output = shard / 'results' / (task['id'] + '.json')
        disposition = q.checked_disposition(task, output, dispositions)
        if output.exists():
            result = q.read_committed(output, task)
            assert result.get('runtime_source_sha256') == plan['core_sha256'], task['id']
            for call in result.get('model_calls', []):
                if call.get('attempt_id') and call.get('requested_model'):
                    assert call['requested_model'] == plan['model_name'], task['id']
        if disposition:
            counts['held' if disposition == 'hold' else 'failed'] += 1
            key = task['dataset'] + (':held' if disposition == 'hold' else ':failed')
            counts['counts'][key] = counts['counts'].get(key, 0) + 1
            continue
        if not output.exists():
            if (shard / 'started' / (task['id'] + '.json')).exists():
                raise ValueError(f'previous_attempt_without_committed_result: {task["id"]}')
            if (shard / 'attempts' / task['id']).exists():
                raise ValueError(f'archived_attempt_without_current_result: {task["id"]}')
            counts['missing'] += 1
            continue
        reason = q.failure_reason(result)
        if reason and allow_retryable and q.retryable_failure(result):
            started = json.loads((shard / 'started' / (task['id'] + '.json')).read_text())
            if started.get('attempt', 1) < 3:
                counts['retryable'] += 1
                continue
        assert reason is None, (task['id'], reason)
        counts['valid'] += 1
        key = task['dataset'] + ':' + result['status']
        counts['counts'][key] = counts['counts'].get(key, 0) + 1
    return counts


def run_shard(root, name, q=None, run_command=subprocess.run):
    root = pathlib.Path(root)
    shard = root / 'shards' / name
    queue = root / 'code/experiments/agentic-waterfall/unified/formal_queue.py'
    try:
        if q is None:
            spec = importlib.util.spec_from_file_location('formal_queue', queue)
            q = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(q)
        before = verify(root, shard, q, allow_retryable=True)
        expected_new = min(3, before['missing'] + before['retryable'])
        if expected_new == 0:
            status = 'validation_holds_remaining' if before['held'] else 'predictions_complete'
            save(shard, status, filename='progress.json', counts=before['counts'], total=before['total'],
                 held_count=before['held'], verified_valid=before['valid'], audited_failed=before['failed'])
            save(shard, status, existing=before['valid'], withheld=before['held'], audited_failed=before['failed'], preflight_new=0)
            return status
        save(shard, 'preflight_running', existing=before['valid'], withheld=before['held'],
             audited_failed=before['failed'], expected_new=expected_new)
        command = [sys.executable, str(queue), '--run-dir', str(shard), '--predictions-only']
        result = run_command(command + ['--max-new-tasks', '3'])
        assert result.returncode == 0, result.returncode
        progress = json.loads((shard / 'progress.json').read_text())
        assert progress['status'] in {'preflight_complete', 'predictions_complete', 'validation_holds_remaining'}, progress
        after = verify(root, shard, q)
        assert after['valid'] >= before['valid'] + expected_new, (before, after, expected_new)
        preflight_new = after['valid'] - before['valid']
        if progress['status'] == 'preflight_complete':
            save(shard, 'full_running', preflight_new=preflight_new, existing=after['valid'],
                 withheld=after['held'], audited_failed=after['failed'])
            result = run_command(command)
            progress = json.loads((shard / 'progress.json').read_text())
            assert result.returncode == 0 and progress['status'] in {'predictions_complete', 'validation_holds_remaining'}, progress
            after = verify(root, shard, q)
        assert after['missing'] == after['retryable'] == 0, after
        status = 'validation_holds_remaining' if after['held'] or progress['status'] == 'validation_holds_remaining' else 'predictions_complete'
        save(shard, status, preflight_new=preflight_new, existing=after['valid'],
             withheld=after['held'], audited_failed=after['failed'], queue_status=progress['status'])
        return status
    except Exception as exc:
        save(shard, 'needs_attention', reason=f'{type(exc).__name__}: {exc}')
        raise


if __name__ == '__main__':
    try:
        run_shard(pathlib.Path(__file__).resolve().parent, sys.argv[1])
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
