"""Project the frozen KuaiRand full-history cases to the scored 512-event inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import re


HISTORY_POLICY = 'recent-512-visible-events-v1'
HISTORY_LIMIT = 512


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def prepare(full_source, output):
    with (full_source / 'assignment.jsonl').open(encoding='utf-8') as stream:
        rows = [json.loads(line) for line in stream if line.strip()]
    tasks = [row['task_id'] for row in rows]
    if not tasks or len(tasks) != len(set(tasks)):
        raise ValueError('expected nonempty, unique KuaiRand assignments')

    output.mkdir(parents=True)
    inputs = output / 'inputs'
    inputs.mkdir()
    assignments = []
    for row in rows:
        task = row['task_id']
        if not re.fullmatch(r'kuairand:\d+:test:(standard|random)', task):
            raise ValueError(f'invalid test task ID: {task}')
        name = task.replace(':', '-') + '.jsonl'
        # The full exporter always writes one case here, even if the archive was moved.
        raw = (full_source / 'cases' / name).read_bytes()
        if (row['input_line'] != 0 or row['input_offset'] != 0 or
                len(raw) != row['input_bytes'] or sha256(raw) != row['sha256']):
            raise ValueError(f'frozen input size, offset or SHA-256 mismatch: {task}')

        value = json.loads(raw)
        observation = value['observation']
        history = observation['behavior_events']
        if observation['decision_id'] != task or len(history) != row['history_events']:
            raise ValueError(f'frozen input identity or history length mismatch: {task}')
        ids = [item['id'] for item in observation['environment']['candidate_pool']]
        if len(ids) != 101 or len(set(ids)) != 101:
            raise ValueError(f'expected 101 distinct candidates: {task}')

        observation['behavior_events'] = history[-HISTORY_LIMIT:]
        value['run_meta'] = {**value.get('run_meta', {}), 'history_policy': HISTORY_POLICY,
                             'archived_history_events': len(history)}
        data = (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        path = inputs / name
        with path.open('xb') as stream:
            stream.write(data)
        assignments.append(dict(task_id=task, path=str(path), sha256=sha256(data),
                                original_history_count=len(history),
                                retained_history_count=len(observation['behavior_events']),
                                candidate_ids=ids))

    with (output / 'assignment.json').open('x', encoding='utf-8') as stream:
        json.dump({'history_policy': HISTORY_POLICY, 'cases': assignments}, stream,
                  ensure_ascii=False, indent=2)
        stream.write('\n')
    return len(assignments)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--full-source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    count = prepare(args.full_source.resolve(), args.output.resolve())
    print(f'Prepared {count} cases using {HISTORY_POLICY}')
