"""Score only a complete immutable pilot/full freeze; independently recompute metrics."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
BATCH = HERE.parent
PINNED = BATCH / 'frozen/v4/code/experiments/agentic-waterfall'


def read(path):
    return json.loads(Path(path).read_bytes())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checked(reference):
    assert digest(reference['path']) == reference['sha256'], reference['path']
    return read(reference['path'])


def independent(tasks, predictions):
    groups = {}
    details = []
    for task in tasks:
        candidates = [f'kuairand:{item}' for item in task['candidate_ids']]
        prediction = predictions[task['task_id']]
        ranking = prediction['ordered_item_ids']
        valid = prediction['status'] == 'submitted' and not prediction.get('error') and isinstance(ranking, list)
        valid = bool(valid and len(ranking) == len(candidates) and len(set(ranking)) == len(ranking) and set(ranking) == set(candidates))
        position = ranking.index(f'kuairand:{task["target"]}') + 1 if valid else math.inf
        values = {}
        for cutoff in (10, 20):
            hit = position <= cutoff
            values[f'Hit@{cutoff}'] = float(hit)
            values[f'NDCG@{cutoff}'] = 1 / math.log2(position + 1) if hit else 0.0
        details.append({'task_id': task['task_id'], 'valid': valid, **values})
        for name in ['all', task['split'] + ':' + task['stratum']]:
            group = groups.setdefault(name, {'n': 0, 'invalid': 0, **{key: 0.0 for key in values}})
            group['n'] += 1
            group['invalid'] += not valid
            for key, value in values.items():
                group[key] += value
    for group in groups.values():
        for key in ('Hit@10', 'NDCG@10', 'Hit@20', 'NDCG@20'):
            group[key] /= group['n']
        group['invalid_rate'] = group['invalid'] / group['n']
    return {'groups': groups, 'per_task': details}


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else 'full'
    assert phase in ('pilot', 'full')
    count = 6 if phase == 'pilot' else 617
    prefix = 'pilot-' if phase == 'pilot' else ''
    freeze_ref = read(HERE / (prefix + 'predictions-frozen.sha256.json'))
    freeze = checked(freeze_ref)
    assert freeze['assigned'] == count and freeze['phase'] == phase and freeze['evaluator_targets_read'] is False and freeze['scoring_performed'] is False
    summary = checked(freeze['summary'])
    for source in summary['execution_sources']:
        assert digest(source['path']) == source['sha256'], source['path']
    for source in (freeze['audit'], freeze['calibration']):
        assert digest(source['path']) == source['sha256'], source['path']
    assignments = freeze['assignments']
    predictions = {item['task_id']: item for item in freeze['predictions']}
    assert len(assignments) == len(predictions) == len(freeze['predictions']) == count
    assert {item['task_id'] for item in assignments} == set(predictions)
    for item in freeze['predictions']:
        result = checked(item['native_result'])
        for artifact in item['native_artifacts']:
            assert digest(artifact['path']) == artifact['sha256']
        assert result['context_id'] == item['task_id'] and result['status'] == item['status']
        assert (result.get('ordered_item_ids', []) if result['status'] == 'submitted' else []) == item['ordered_item_ids']
        assert result.get('error') == item['error']
    for item in assignments:
        public = checked(item['input'])
        assert public['observation']['decision_id'] == item['task_id']
        assert [candidate['id'] for candidate in public['observation']['environment']['candidate_pool']] == item['candidate_ids']
        assert len(item['candidate_ids']) == len(set(item['candidate_ids'])) == 101

    # Evaluator targets are read only after this complete phase's terminal predictions are frozen and rechecked.
    private = BATCH / 'public-data/kuairand/evaluator-only/private-tasks.jsonl'
    expected_truth = read(BATCH / 'public-data/kuairand/manifest.json')['evaluator_sha256']
    assert digest(private) == expected_truth
    sys.path.insert(0, str(PINNED / 'unified'))
    from score_formal import kuairand_truth
    spec = importlib.util.spec_from_file_location('recbot_frozen_kuairand_protocol', PINNED / 'kuairand/scripts/protocol.py')
    protocol = importlib.util.module_from_spec(spec); spec.loader.exec_module(protocol)
    inputs = [{'observation': {'decision_id': item['task_id'], 'environment': {'candidate_ids': item['candidate_ids']}}} for item in assignments]
    truth = kuairand_truth(private, inputs, 'test')
    original = protocol.evaluate(truth, predictions)

    independently_parsed = {}
    ids = set(predictions)
    for line in private.open():
        task = json.loads(line)
        if task['task_id'] in ids:
            assert task['task_id'] not in independently_parsed and task['eligible'] and task['split'] == 'test'
            independently_parsed[task['task_id']] = task
    assert set(independently_parsed) == ids
    for item in assignments:
        assert item['candidate_ids'] == [f'kuairand:{video}' for video in independently_parsed[item['task_id']]['candidate_ids']]
    manual = independent([independently_parsed[item['task_id']] for item in assignments], predictions)
    assert original['groups'].keys() == original['strict_groups'].keys() == manual['groups'].keys()
    for group in original['groups']:
        for key, value in manual['groups'][group].items():
            assert math.isclose(original['groups'][group][key], value, rel_tol=0, abs_tol=1e-15), (group, key)
            assert math.isclose(original['strict_groups'][group][key], value, rel_tol=0, abs_tol=1e-15), (group, key, 'strict')
    for first, second in zip(original['per_task'], manual['per_task']):
        assert all(first[key] == value for key, value in second.items()), first['task_id']
    assert original['groups']['all']['n'] == count
    artifact = {'assigned': count, 'phase': phase, 'freeze': freeze_ref, 'truth_sha256': expected_truth,
                'existing_scorer_sha256': digest(PINNED / 'kuairand/scripts/protocol.py'),
                'independent_scorer_sha256': digest(Path(__file__)), 'independent_recomputation_passed': True,
                'methods': {'recbot': original}, 'independent': manual, 'model_requests': 0}
    with (HERE / (prefix + 'metrics.json')).open('x') as stream:
        json.dump(artifact, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'assigned': count, 'phase': phase, 'independent_recomputation_passed': True, **original['groups']['all']}))


if __name__ == '__main__':
    main()
