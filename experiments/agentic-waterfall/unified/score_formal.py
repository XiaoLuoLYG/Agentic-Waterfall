"""Score completed, isolated Waterfall runs; hidden labels stay in evaluation-only/."""
from pathlib import Path
import argparse
import collections
import hashlib
import json
import subprocess
import sys
import tempfile
from formal_queue import load_validation_dispositions, checked_disposition

ROOT = Path(__file__).resolve().parents[3]


def read_rows(path):
    with Path(path).open() as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def write_rows(path, rows):
    with Path(path).open('x') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def candidate_ids(public):
    environment = public['observation']['environment']
    return environment.get('candidate_ids', [item['id'] for item in environment.get('candidate_pool', [])])


def load_completed(run_dir, plan=None):
    tasks = list(read_rows(run_dir / 'tasks.jsonl'))
    ids = [task['id'] for task in tasks]
    if not tasks or len(ids) != len(set(ids)):
        raise ValueError('empty_or_duplicate_task_assignment')
    dispositions = load_validation_dispositions(run_dir, plan)
    held = sum(checked_disposition(task, run_dir / 'results' / (task['id'] + '.json'), dispositions) == 'hold'
               for task in tasks)
    if held:
        raise ValueError(f'evaluation_blocked_by_validation_holds: {held}')
    missing = [task_id for task_id in ids if not (run_dir / 'results' / (task_id + '.json')).is_file()]
    if missing:
        raise ValueError(f'run_incomplete: {len(missing)} assigned results missing')
    groups = collections.defaultdict(list)
    for task in tasks:
        if task['dataset'] not in ('mind', 'kuairand', 'kuairec', 'agentrecbench'):
            continue
        path = run_dir / 'results' / (task['id'] + '.json')
        row = json.loads(path.read_text())
        if row['task']['id'] != task['id'] or row['task']['dataset'] != task['dataset']:
            raise ValueError('result_task_mismatch')
        public = row.get('input')
        if public is None:
            public = json.loads((run_dir / task['input_path']).read_text())
        decision_id = public['observation']['decision_id']
        result = row['result']
        if result.get('decision_id') != decision_id or result.get('status') not in ('submitted', 'failed', 'idle'):
            raise ValueError('invalid_result_identity_or_status')
        if task['dataset'] == 'agentrecbench' and str(public['run_meta']['task_id']) != str(task['task_id']):
            raise ValueError('agentrecbench_task_id_mismatch')
        split = task['domain'] if task['dataset'] == 'agentrecbench' else task.get('split', 'test')
        if not split or Path(split).name != split or split in ('.', '..'):
            raise ValueError('invalid_split')
        # Keep large model traces only in the original result files.
        compact = {key: result[key] for key in ('decision_id', 'status', 'ordered_item_ids', 'error', 'runtime_version',
                   'model_request_count', 'tool_calls', 'continuation_error') if key in result}
        if task['dataset'] == 'kuairec':
            compact['acquired_item_ids'] = [item['id'] for item in result.get('candidate_pool_after', [])]
        # Evaluation needs identities only; full histories remain in the frozen inputs.
        public = {'observation': {'decision_id': decision_id, 'user_id': public['observation'].get('user_id'),
                  'environment': {'candidate_ids': candidate_ids(public)}}, 'run_meta': public.get('run_meta', {})}
        groups[(task['dataset'], split)].append((public, compact, path, task))
    return groups


def mind_truth(source, inputs):
    assigned = {str(row['observation']['decision_id']).rsplit(':', 1)[-1]: row for row in inputs}
    if len(assigned) != len(inputs):
        raise ValueError('duplicate_mind_impression')
    truth = {}
    with Path(source).open() as stream:
        for line in stream:
            impression_id = line.split('\t', 1)[0]
            if impression_id not in assigned:
                continue
            if impression_id in truth:
                raise ValueError('duplicate_mind_truth')
            fields = line.rstrip('\n').split('\t')
            candidates = [item.rsplit('-', 1) for item in fields[4].split()]
            if any(len(item) != 2 or item[1] not in ('0', '1') for item in candidates):
                raise ValueError('invalid_mind_truth')
            ids = [item[0] for item in candidates]
            visible = candidate_ids(assigned[impression_id])
            if len(ids) != len(set(ids)) or len(visible) != len(ids) or set(ids) != set(visible):
                raise ValueError('mind_candidate_mismatch')
            truth[impression_id] = {'impression_id': impression_id, 'original_candidate_ids': ids,
                                    'labels': [int(item[1]) for item in candidates]}
    if set(truth) != set(assigned):
        raise ValueError('missing_mind_truth')
    return [truth[impression_id] for impression_id in assigned]


def kuairand_truth(source, inputs, split):
    assigned = {row['observation']['decision_id']: row for row in inputs}
    if len(assigned) != len(inputs):
        raise ValueError('duplicate_kuairand_task')
    truth = {}
    for row in read_rows(source):
        task_id = row['task_id']
        if task_id not in assigned:
            continue
        if task_id in truth or not row['eligible'] or row['split'] != split:
            raise ValueError('invalid_kuairand_assignment')
        visible = candidate_ids(assigned[task_id])
        if visible != [f'kuairand:{item}' for item in row['candidate_ids']]:
            raise ValueError('kuairand_candidate_mismatch')
        truth[task_id] = {key: row[key] for key in ('task_id', 'eligible', 'target', 'candidate_ids', 'split', 'stratum')}
        if 'required_ranking_length' in row:
            truth[task_id]['required_ranking_length'] = row['required_ranking_length']
    if set(truth) != set(assigned):
        raise ValueError('missing_kuairand_truth')
    return [truth[task_id] for task_id in assigned]


def kuairec_prediction(public, result):
    return {'user_id': int(public['observation']['user_id']),
            'method': result.get('runtime_version', 'waterfall') + '_bm25_backend', 'status': result['status'],
            'acquisition_required': True, 'ordered_item_ids': result.get('ordered_item_ids', []),
            'acquired_item_ids': result.get('acquired_item_ids', []),
            'model_requests': result.get('model_request_count'), 'tool_calls': result.get('tool_calls'),
            'error': result.get('error'), 'continuation_error': result.get('continuation_error')}


def reuse_completed(run_dir, groups):
    output = run_dir / 'evaluation-only'
    if not output.exists():
        return False
    path = output / 'receipt.json'
    if not path.exists():
        raise ValueError('scoring_needs_attention: incomplete evaluation-only without final receipt')
    receipt = json.loads(path.read_text())
    if (receipt.get('plan_sha256') != sha(run_dir / 'plan.json') or
        receipt.get('tasks_sha256') != sha(run_dir / 'tasks.jsonl') or
        not receipt.get('all_assigned_results_present')):
        raise ValueError('scoring_needs_attention: changed plan or task assignment')
    entries = receipt.get('groups', [])
    if len(entries) != len(groups) or {(e['dataset'], e['split']) for e in entries} != set(groups):
        raise ValueError('scoring_needs_attention: incomplete scoring groups')
    for entry in entries:
        rows = groups[(entry['dataset'], entry['split'])]
        expected = {str(path.relative_to(run_dir)): sha(path) for _, _, path, _ in rows}
        metrics = run_dir / entry['metrics']
        if (entry.get('assigned') != len(rows) or entry.get('result_sha256') != expected or
            not metrics.is_file() or entry.get('metrics_sha256') != sha(metrics) or
            entry.get('scorer_sha256') != sha(entry['scorer'])):
            raise ValueError('scoring_needs_attention: changed or incomplete scored artifacts')
    print(json.dumps({'scored_groups': len(entries), 'receipt': str(path), 'reused': True}))
    return True


def score(run_dir):
    run_dir = run_dir.resolve()
    plan = json.loads((run_dir / 'plan.json').read_text())
    groups = load_completed(run_dir, plan)
    if reuse_completed(run_dir, groups):
        return
    sources = plan.get('evaluation_sources', {})

    def source(key, default):
        path = Path(sources.get(key, default))
        return path if path.is_absolute() else run_dir / path

    output = run_dir / 'evaluation-only'
    output.mkdir(exist_ok=False)
    receipt = {'plan_sha256': sha(run_dir / 'plan.json'), 'tasks_sha256': sha(run_dir / 'tasks.jsonl'),
               'all_assigned_results_present': True, 'groups': []}
    for (dataset, split), rows in sorted(groups.items()):
        destination = output / dataset / split
        destination.mkdir(parents=True)
        inputs = [public for public, _, _, _ in rows]
        predictions = [kuairec_prediction(public, result) if dataset == 'kuairec' else result
                       for public, result, _, _ in rows]
        write_rows(destination / 'inputs.jsonl', inputs)
        write_rows(destination / 'predictions.jsonl', predictions)
        if dataset == 'mind':
            label_source = source('mind_behaviors', ROOT / 'experiments/agentic-waterfall/mind/data/MINDsmall_dev/behaviors.tsv')
            truth = mind_truth(label_source, inputs)
            (destination / 'truth.json').write_text(json.dumps(truth) + '\n')
            scorer = source('mind_scorer', ROOT / 'experiments/agentic-waterfall/mind/scripts/score_waterfall.py')
            python = source('mind_python', ROOT / 'experiments/agentic-waterfall/mind/.venv/bin/python')
            command = [str(python), str(scorer), '--truth', str(destination / 'truth.json'),
                       '--input', str(destination / 'inputs.jsonl')]
        elif dataset == 'kuairand':
            label_source = source('kuairand_tasks', ROOT / 'experiments/agentic-waterfall/kuairand/data/prepared-v2/private-tasks.jsonl')
            write_rows(destination / 'truth.jsonl', kuairand_truth(label_source, inputs, split))
            scorer = source('kuairand_scorer', ROOT / 'experiments/agentic-waterfall/kuairand/scripts/score.py')
            command = [sys.executable, str(scorer), '--tasks', str(destination / 'truth.jsonl')]
        elif dataset == 'kuairec':
            scorer = source('kuairec_evaluator', ROOT / 'experiments/agentic-waterfall/kuairec/scripts/evaluate.py')
            python = source('kuairec_python', ROOT / 'experiments/agentic-waterfall/kuairec/.venv/bin/python')
            label_source = scorer.parent.parent / 'data/processed/evaluator_only/labels.npz'
            command = [str(python), str(scorer), '--input', str(destination / 'inputs.jsonl')]
        else:
            scorer = source('agentrecbench_scorer', ROOT / 'experiments/agentic-waterfall/agentrecbench/scripts/score_waterfall.py')
            python = source('agentrecbench_python', ROOT / 'experiments/agentic-waterfall/agentrecbench/.venv/bin/python')
            task_dirs = {(Path(task['root']) / task['task_dir']).resolve() for _, _, _, task in rows}
            ids = [str(task['task_id']) for _, _, _, task in rows]
            if len(task_dirs) != 1 or len(ids) != len(set(ids)) or any(not task_id.isdigit() for task_id in ids):
                raise ValueError('invalid_agentrecbench_domain_assignment')
            label_source = task_dirs.pop()
            command = [str(python), str(scorer), '--task-dir', str(label_source), '--task-ids', ','.join(ids)]
        if dataset == 'agentrecbench':
            command += ['--output', str(destination / 'metrics.json')] + [str(path) for _, _, path, _ in rows]
            label_hashes = {f'{directory}/{prefix}_{task_id}.json': sha(label_source / directory / f'{prefix}_{task_id}.json')
                            for task_id in ids for directory, prefix in [('tasks', 'task'), ('groundtruth', 'groundtruth')]}
            source_hash = hashlib.sha256(json.dumps(label_hashes, sort_keys=True).encode()).hexdigest()
        else:
            command += ['--predictions', str(destination / 'predictions.jsonl'), '--output', str(destination / 'metrics.json')]
            source_hash = sha(label_source)
        with (destination / 'scoring.log').open('x') as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        receipt['groups'].append({'dataset': dataset, 'split': split, 'assigned': len(rows),
                                  'source': str(label_source), 'source_sha256': source_hash,
                                  'scorer': str(scorer), 'scorer_sha256': sha(scorer),
                                  'predictions_sha256': sha(destination / 'predictions.jsonl'),
                                  'result_sha256': {str(path.relative_to(run_dir)): sha(path) for _, _, path, _ in rows},
                                  'metrics': str((destination / 'metrics.json').relative_to(run_dir)),
                                  'metrics_sha256': sha(destination / 'metrics.json')})
    temporary = output / 'receipt.json.tmp'
    temporary.write_text(json.dumps(receipt, indent=2) + '\n')
    temporary.replace(output / 'receipt.json')
    print(json.dumps({'scored_groups': len(groups), 'receipt': str(output / 'receipt.json')}))


def self_check():
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        public = {'observation': {'decision_id': 'mind:test:1', 'environment': {'candidate_pool': [{'id': 'A'}, {'id': 'B'}]}}}
        source = directory / 'behaviors.tsv'
        source.write_text('unassigned\tmalformed-label-is-not-decoded\n1\tu\tt\t\tA-1 B-0\n')
        assert mind_truth(source, [public])[0]['labels'] == [1, 0]
        public['observation']['environment']['candidate_pool'][1]['id'] = 'C'
        try:
            mind_truth(source, [public])
        except ValueError as error:
            assert str(error) == 'mind_candidate_mismatch'
        else:
            raise AssertionError('candidate mismatch accepted')
        write_rows(directory / 'tasks.jsonl', [{'id': 'unfinished', 'dataset': 'mind'}])
        try:
            load_completed(directory, {})
        except ValueError as error:
            assert str(error).startswith('run_incomplete:')
        else:
            raise AssertionError('incomplete run accepted')
        public = {'observation': {'decision_id': 'kuairand:1:test:standard', 'environment': {'candidate_pool': [{'id': 'kuairand:2'}, {'id': 'kuairand:3'}]}}}
        write_rows(directory / 'private.jsonl', [{'task_id': public['observation']['decision_id'], 'eligible': True,
                                                'target': 2, 'candidate_ids': [2, 3], 'split': 'test', 'stratum': 'standard'}])
        assert kuairand_truth(directory / 'private.jsonl', [public], 'test')[0]['target'] == 2
        row = kuairec_prediction({'observation': {'user_id': '42'}}, {'status': 'failed', 'error': 'model_timeout'})
        assert row['user_id'] == 42 and row['ordered_item_ids'] == [] and row['acquired_item_ids'] == []
        reuse = directory / 'reuse'
        (reuse / 'evaluation-only/mind/test').mkdir(parents=True)
        (reuse / 'results').mkdir()
        for name in ('plan.json', 'tasks.jsonl'):
            (reuse / name).write_text('{}\n')
        result = reuse / 'results/task.json'
        result.write_text('{"synthetic":true}\n')
        metrics = reuse / 'evaluation-only/mind/test/metrics.json'
        metrics.write_text('{"synthetic":true}\n')
        scorer = reuse / 'scorer.py'
        scorer.write_text('# synthetic scorer\n')
        entry = {'dataset': 'mind', 'split': 'test', 'assigned': 1, 'scorer': str(scorer),
                 'scorer_sha256': sha(scorer), 'metrics': str(metrics.relative_to(reuse)),
                 'metrics_sha256': sha(metrics), 'result_sha256': {'results/task.json': sha(result)}}
        (reuse / 'evaluation-only/receipt.json').write_text(json.dumps({
            'plan_sha256': sha(reuse / 'plan.json'), 'tasks_sha256': sha(reuse / 'tasks.jsonl'),
            'all_assigned_results_present': True, 'groups': [entry]}))
        groups = {('mind', 'test'): [(None, None, result, None)]}
        assert reuse_completed(reuse, groups)
        for changed in (reuse / 'plan.json', result, metrics):
            original = changed.read_bytes()
            changed.write_bytes(original + b' ')
            try:
                reuse_completed(reuse, groups)
            except ValueError as error:
                assert str(error).startswith('scoring_needs_attention:')
            else:
                raise AssertionError('changed scoring artifact reused')
            changed.write_bytes(original)
    print('synthetic scoring-boundary checks passed; no real labels or model calls')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path)
    parser.add_argument('--self-check', action='store_true')
    args = parser.parse_args()
    if args.self_check:
        self_check()
    elif args.run_dir:
        score(args.run_dir)
    else:
        parser.error('--run-dir or --self-check required')
