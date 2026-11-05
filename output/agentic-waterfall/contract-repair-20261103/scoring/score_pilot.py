"""Freeze assigned native predictions before opening truth; reuse pinned evaluators.

No model, retrieval, prompt, queue, or historical output is changed by this script.
`freeze` is label-free; `score` requires the printed freeze SHA and explicit release.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil
import sys

OUT = Path(__file__).resolve().parents[1]
BASE = OUT.parents[2]
METRICS = ('precision_at_10', 'recall_at_10', 'ndcg_at_10', 'acquired_recall_at_100')


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def lines(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def save_lines(path, rows):
    with Path(path).open('x') as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def components(code):
    unified = load_module('pilot_formal_queue', code / 'experiments/agentic-waterfall/unified/formal_queue.py')
    krec = load_module('pilot_kuairec_evaluator', code / 'experiments/agentic-waterfall/kuairec/scripts/evaluate.py')
    sys.path.insert(0, str(code / 'experiments/agentic-waterfall/agentrecbench/scripts'))
    ar = load_module('pilot_ar_adapter', code / 'experiments/agentic-waterfall/agentrecbench/scripts/adapter.py')
    return unified, krec, ar


def distinct(values):
    return list(dict.fromkeys(values))


def ids(values):
    assert isinstance(values, list) and all(isinstance(x, str) for x in values), 'ID list must contain strings'
    assert len(values) == len(set(values)), 'duplicate IDs'
    return values


def failures(result):
    if 'action_failures' in result:
        return result['action_failures']
    trace = result.get('trace', [])
    if not isinstance(trace, list):
        return []  # Fixed inference stores a hashed trace-file reference, not Waterfall action steps.
    return [r for step in trace for r in step.get('execution_results', []) if r.get('status') != 'success']


def recorded_failures(native, folder):
    result = native.get('result', native)
    found = [{'origin': 'action', **r} for r in failures(result)]
    found += [{'origin': 'model_call', 'call_index': i, 'error': r.get('error'), 'status': r.get('status')}
              for i, r in enumerate(result.get('model_calls', [])) if r.get('error') or r.get('status') == 'failed']
    found += [{'origin': 'format_attempt', 'stage': stage.get('stage'), **r}
              for stage in result.get('format_attempt_accounting', []) for r in stage.get('attempts', []) if r.get('format_error')]
    found += [{'origin': 'output_integrity_recovery', 'receipt': r} for r in result.get('output_integrity_recoveries', [])]
    for path in Path(folder).rglob('*.json'):
        if 'response' not in path.name.lower() and 'error' not in path.name.lower():
            continue
        value = read(path)
        if not isinstance(value, dict):
            continue
        receipt = value.get('receipt', value)
        if receipt.get('error') or receipt.get('format_error') or receipt.get('status') == 'failed':
            found.append({'origin': 'artifact', 'path': str(path), 'sha256': sha(path), 'status': receipt.get('status'),
                          'error': receipt.get('error'), 'format_error': receipt.get('format_error')})
    return found


def project(command, native, public, receipts, queue, krec, ar):
    """Validate actual delivery without repairing any ranking or filling an output."""
    result = native.get('result', native) if command['method'] == 'waterfall' else native
    result = result or {'status': 'failed', 'error': 'missing_prediction'}
    expected_native_methods = {'generic-agent': 'generic-agent', 'clawrec': 'clawrec',
                               'fixed-bm25-bge-reranker': 'fixed-bm25-bge-reranker', 'recagent': 'RecAgent-candidate-complete'}
    if result.get('method') is not None and command['method'] in expected_native_methods:
        assert result['method'] == expected_native_methods[command['method']], 'native method mismatch'
    status = result.get('status', 'failed')
    action_failures = failures(result)
    row = {k: command[k] for k in ('id', 'dataset', 'method', 'case_id', 'domain', 'task_id', 'public_user_id') if k in command}
    row.update(status=status, error=result.get('error'), continuation_error=result.get('continuation_error'),
               action_failures=action_failures, failed_task_count=result.get('failed_task_count', 0),
               native_method=result.get('method'), native_source_name=result.get('source'),
               applicable=status != 'not_applicable', native_ordered_item_ids=result.get('ordered_item_ids', []),
               ordered_item_ids=[], acquired_item_ids=[], delivery_valid=False, strict_episode_success=False,
               delivery_error=None, scope_audit_flags=[])
    if row['continuation_error']:
        row['scope_audit_flags'].append(row['continuation_error'])
    if command['dataset'] == 'kuairec':
        obs = public['observation']
        assert str(obs['user_id']) == str(command['public_user_id'])
        if result.get('user_id') is not None:
            assert str(result['user_id']) == str(obs['user_id']), 'native user mismatch'
        if result.get('context_id') is not None:
            assert result['context_id'] == obs['decision_id'], 'native context mismatch'
        if result.get('decision_id') is not None:
            assert result['decision_id'] == obs['decision_id'], 'Waterfall decision mismatch'
        if command['method'] == 'waterfall':
            pool = ids([x['id'] for x in result.get('candidate_pool_after', [])])
            initial = [x['id'] for x in obs['environment']['candidate_pool']]
            acquired = distinct([x['id'] for step in result.get('trace', [])
                for r in step.get('execution_results', []) if r.get('kind') == 'acquire' and r.get('status') == 'success'
                for x in r.get('result', {}).get('items', [])])
            assert set(pool) == set(initial + acquired), 'Waterfall pool differs from successful acquire receipts'
        elif command['method'] == 'fixed-bm25-bge-reranker':
            pool = ids(result.get('acquired_item_ids', []))
        else:
            pool = ids(result.get('acquired_ids', []))
            actual = distinct([x['id'] for r in receipts for x in r.get('output', {}).get('items', [])])
            assert set(pool) == set(actual), 'baseline pool differs from search receipts'
        row['acquired_item_ids'] = pool
        row['user_id'] = str(obs['user_id'])
        row['acquisition_required'] = True
        row['eligible_item_ids'] = public['eligible_item_ids']
        assert set(pool) <= set(public['eligible_item_ids']), 'acquired ineligible item'
        assert len(pool) <= 100, 'acquisition budget exceeded'
        if command['method'] == 'clawrec' and status == 'submitted':
            native_order = ids(result['native_ordered_item_ids'])
            assert set(native_order) <= set(pool), 'ClawRec native selection outside acquired pool'
            policy = result['benchmark_projection']
            assert policy['policy'] == 'native-order-prefix-v1' and policy['k'] == 10
            assert result['ordered_item_ids'] == native_order[:10], 'ClawRec projection changed native prefix'
            row.update(native_ordered_item_ids=native_order, benchmark_projection=policy,
                       native_sections=result.get('sections', []))
    else:
        candidates = ids(public['candidate_list'])
        assert len(candidates) == 20, 'AR public candidate count changed'
        row['candidate_ids'] = candidates
        if result.get('task_id') is not None:
            assert str(result['task_id']) == str(command['task_id']), 'native task mismatch'
        if command['method'] == 'waterfall' and native.get('input'):
            assert str(native['input']['run_meta']['task_id']) == str(command['task_id'])
            assert [x['id'] for x in native['input']['observation']['environment']['candidate_pool']] == candidates
    try:
        if status != 'submitted':
            raise ValueError(result.get('error') or 'not_submitted')
        ranking = ids(result.get('ordered_item_ids', []))
        if not ranking:
            raise ValueError('missing_delivery')
        if command['method'] == 'waterfall' and not queue.committed_delivery(result):
            raise ValueError('recommendation_receipts_do_not_match_export')
        if command['dataset'] == 'kuairec':
            krec.score_user(ranking, row['acquired_item_ids'], row['eligible_item_ids'], [], True)
        else:
            ar.validate_ranking(ranking, row['candidate_ids'])
        row['ordered_item_ids'] = ranking
        row['delivery_valid'] = True
    except (ValueError, AssertionError, TypeError) as error:
        row['delivery_error'] = str(error)
    # Historical action/format failures are a separate audit: trace granularity differs by method.
    row['strict_episode_success'] = (row['delivery_valid'] and not row['error'] and not row['continuation_error']
                                    and not row['failed_task_count'])
    row['strict_terminal_success'] = row['strict_episode_success']
    row['strict_definition'] = 'valid_delivery_without_terminal_error_continuation_error_or_failed_workers'
    row['reported_failure_free'] = row['strict_episode_success'] and not action_failures
    row['strict_ordered_item_ids'] = row['ordered_item_ids'] if row['strict_episode_success'] else []
    return row


def verify_files(files):
    for name, digest in files.items():
        assert sha(name) == digest, 'frozen file changed: ' + name


def is_truth_path(path):
    path = Path(path)
    return (bool({'groundtruth', 'ground_truth', 'evaluator_only', 'evaluator-only'}.intersection(path.parts))
            or path.name in {'labels.npz', 'private-tasks.jsonl'})


def freeze(plan_path, fixed_path, output):
    plan_path, fixed_path, output = Path(plan_path).resolve(), Path(fixed_path).resolve(), Path(output).resolve()
    assert not output.exists(), 'new freeze directory required'
    plan = read(plan_path)
    folder, code = Path(plan['output']), Path(plan['runtime'])
    progress = read(folder / 'progress.json')
    commands = plan['commands']
    assert progress['completed'] == len(commands) and not progress['active'], 'API assignment not terminal'
    assert len({c['id'] for c in commands}) == len(commands)
    outcomes = lines(folder / 'outcomes.jsonl')
    by_id = {r['id']: r for r in outcomes}
    assert len(by_id) == len(outcomes) == len(commands) and set(by_id) == {c['id'] for c in commands}
    public_sources = {p: digest for p, digest in plan['files_sha256'].items() if not is_truth_path(p)}
    deferred_truth_sources = {p: digest for p, digest in plan['files_sha256'].items() if is_truth_path(p)}
    verify_files(public_sources)
    assert read(folder / 'queue-identity.json')['manifest_sha256'] == sha(plan_path)
    fixed = read(fixed_path / 'predictions-frozen.json')
    verify_files({str(fixed_path / name): digest for name, digest in read(fixed_path / 'freeze-sha256.json').items()})
    assert not any(is_truth_path(p) for p in fixed['source_sha256']), 'fixed inference sources contain truth'
    verify_files(fixed['source_sha256'])
    krec_users = distinct([str(c['public_user_id']) for c in commands if c['dataset'] == 'kuairec'])
    assert fixed['user_ids'] == krec_users, 'fixed assignment differs from API users/order'
    assert [r['user_id'] for r in fixed['records']] == krec_users
    fixed_predictions = lines(fixed_path / 'predictions.jsonl')
    assert fixed_predictions == [r['prediction'] for r in fixed['records']], 'fixed aggregate differs from frozen native rows'
    for user in krec_users:
        assert {c['method'] for c in commands if c['dataset'] == 'kuairec' and str(c['public_user_id']) == user} == {'waterfall', 'generic-agent', 'clawrec'}
    for case in {c['case_id'] for c in commands if c['dataset'] == 'agentrecbench'}:
        assert {c['method'] for c in commands if c['case_id'] == case} == {'waterfall', 'i2agent', 'recagent'}
    queue, krec, ar = components(code)
    files = {str(plan_path): sha(plan_path), str(Path(__file__).resolve()): sha(__file__)}
    files.update(public_sources)
    files.update(fixed['source_sha256'])
    for path in [folder / 'outcomes.jsonl', folder / 'queue-identity.json', fixed_path / 'predictions-frozen.json',
                 fixed_path / 'freeze-sha256.json', fixed_path / 'predictions.jsonl']:
        files[str(path)] = sha(path)
    public_by_case, meta_by_case = {}, {}
    for command in commands:
        if command['method'] != 'waterfall':
            continue
        task = read(command['task_file'])
        files[command['task_file']] = sha(command['task_file'])
        if command['dataset'] == 'kuairec':
            with Path(task['input_path']).open('rb') as stream:
                stream.seek(task['input_offset']); public = json.loads(stream.read(task['input_bytes']))
            eligible_path = Path(command['environment']['KUAIREC_PUBLIC_ELIGIBLE'])
            public['eligible_item_ids'] = [str(x) for x in read(eligible_path)[command['public_user_id']]]
            files[str(eligible_path)] = sha(eligible_path)
            files[task['input_path']] = sha(task['input_path'])
        else:
            public = read(task['task_file'])
            official_public = Path(task['task_dir']) / 'tasks' / f"task_{command['task_id']}.json"
            assert public == read(official_public), 'AR public tasks differ'
            files[task['task_file']] = sha(task['task_file'])
            files[str(official_public)] = sha(official_public)
        public_by_case[command['case_id']], meta_by_case[command['case_id']] = public, task
    rows, copies = [], []
    for command in commands:
        outcome = by_id[command['id']]
        for key in ('dataset', 'method', 'case_id'):
            assert outcome[key] == command[key], 'outcome assignment mismatch'
        source = Path(outcome['result_path'])
        assert sha(source) == outcome['result_sha256']
        native = read(source)
        receipts = []
        if command['dataset'] == 'kuairec' and command['method'] != 'waterfall':
            receipt_file = source.parent / 'search-results.json'
            receipts = read(receipt_file) if receipt_file.exists() else []
        # Preserve all requests, responses, native sections, receipts and failure artifacts for later audit.
        for path in source.parent.rglob('*'):
            if path.is_file():
                files[str(path)] = sha(path)
        row = project(command, native, public_by_case[command['case_id']], receipts, queue, krec, ar)
        row.update(native_source=str(source), native_sha256=sha(source), outcome=outcome,
                   public_task=meta_by_case[command['case_id']])
        row['recorded_failures'] = recorded_failures(native, source.parent)
        row['recorded_failure_count'] = len(row['recorded_failures'])
        row['reported_failure_free'] = row['strict_episode_success'] and not row['recorded_failures']
        rows.append(row)
        copies.append((source, output / 'native' / (command['id'] + '.json')))
    for record in fixed['records']:
        user = str(record['user_id'])
        command = {'id': 'fixed-' + user, 'dataset': 'kuairec', 'method': 'fixed-bm25-bge-reranker',
                   'case_id': 'kuairec:' + user, 'public_user_id': user}
        source = Path(record['result_path'])
        if record.get('result_sha256'):
            assert sha(source) == record['result_sha256']
            assert lines(source) == [record['prediction']]
            files[str(source)] = sha(source)
        runtime = Path(record['runtime_path'])
        if record.get('runtime_sha256'):
            assert sha(runtime) == record['runtime_sha256']; files[str(runtime)] = sha(runtime)
        for path in source.parent.rglob('*'):
            if path.is_file():
                files[str(path)] = sha(path)
        row = project(command, record['prediction'], public_by_case[command['case_id']], [], queue, krec, ar)
        row.update(native_source=str(source), native_sha256=record.get('result_sha256'), fixed_audit=record,
                   public_task=meta_by_case[command['case_id']])
        if record['audit_status'] != 'passed':
            row['scope_audit_flags'].extend(record['audit_errors'])
            row['strict_episode_success'] = False
            row['strict_terminal_success'] = False
            row['strict_ordered_item_ids'] = []
        row['recorded_failures'] = [{'origin': 'fixed_worker_audit', 'error': e} for e in record['audit_errors']]
        row['recorded_failure_count'] = len(row['recorded_failures'])
        row['reported_failure_free'] = row['strict_episode_success'] and not row['recorded_failures']
        rows.append(row)
    assert len(rows) == len(commands) + len(krec_users)
    output.mkdir(parents=True)
    for source, target in copies:
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(source, target)
        files[str(target)] = sha(target)
    for row in rows:
        if row['method'] == 'fixed-bm25-bge-reranker':
            target = output / 'native' / (row['id'] + '.json')
            save(target, row['fixed_audit']['prediction']); files[str(target)] = sha(target)
    save_lines(output / 'projections.jsonl', rows)
    files[str(output / 'projections.jsonl')] = sha(output / 'projections.jsonl')
    groups = collections.defaultdict(list)
    for row in rows:
        groups[(row['dataset'], row['method'])].append(row)
    for (dataset, method), group in groups.items():
        path = output / 'views' / dataset / method
        path.mkdir(parents=True)
        save_lines(path / 'delivery.jsonl', group)
        save_lines(path / 'strict.jsonl', [{**r, 'ordered_item_ids': r['strict_ordered_item_ids']} for r in group])
        for file in path.iterdir():
            files[str(file)] = sha(file)
    freeze_path = output / 'predictions-frozen.json'
    save(freeze_path, {'version': 'pilot-delivery-projection-v1', 'plan': str(plan_path), 'runtime': str(code),
                      'assignment_count': len(rows), 'api_count': len(commands), 'fixed_count': len(krec_users),
                      'assignment_ids': [r['id'] for r in rows], 'files_sha256': files,
                      'deferred_truth_source_sha256': deferred_truth_sources,
                      'all_predictions_sha256': sha(output / 'projections.jsonl'),
                      'labels_read_by_this_tool': False,
                      'label_boundary': 'Official AR masking during inference is separate; scoring truth is unopened before this freeze.'})
    print(json.dumps({'freeze': str(freeze_path), 'sha256': sha(freeze_path), 'n': len(rows), 'labels_read': False}))


def random_reference(pool, positives, eligible_positive_count, cutoff=10):
    n, p = len(pool), len(set(pool).intersection(positives))
    k = min(cutoff, n)
    rate = p / n if n else 0.0
    expected_hits = k * rate
    idcg = sum(1 / math.log2(i + 2) for i in range(min(cutoff, eligible_positive_count)))
    return {'pool_items': n, 'pool_positive_items': p, 'hypothetical_slate_length': k,
            'precision_at_10': expected_hits / 10,
            'recall_at_10': expected_hits / eligible_positive_count if eligible_positive_count else None,
            'ndcg_at_10': rate * sum(1 / math.log2(i + 2) for i in range(k)) / idcg if idcg else None}


def mean(values):
    values = [x for x in values if x is not None]
    return sum(values) / len(values) if values else None


def ndcg(ranking, target, cutoff):
    return 1 / math.log2(ranking.index(target) + 2) if target in ranking[:cutoff] else 0.0


def score(freeze_path, expected_sha, release, data_root, output):
    assert release, 'labels remain closed: --release-labels required after parent authorization'
    freeze_path, output = Path(freeze_path).resolve(), Path(output).resolve()
    assert sha(freeze_path) == expected_sha, 'freeze SHA differs from explicitly released SHA'
    assert not output.exists(), 'new score directory required'
    frozen = read(freeze_path)
    verify_files(frozen['files_sha256'])
    projections_path = freeze_path.parent / 'projections.jsonl'
    assert sha(projections_path) == frozen['all_predictions_sha256']
    rows = lines(projections_path)
    assert [r['id'] for r in rows] == frozen['assignment_ids'] and len(rows) == frozen['assignment_count']
    _, krec, ar = components(Path(frozen['runtime']))
    # The first scoring truth read occurs only after every native output and projection above is verified.
    verify_files(frozen.get('deferred_truth_source_sha256', {}))
    import numpy as np
    data_root = Path(data_root)
    masks = np.load(data_root / 'eligibility.npz', allow_pickle=False)
    labels = np.load(data_root / 'evaluator_only/labels.npz', allow_pickle=False)
    assert np.array_equal(masks['users'], labels['users']) and np.array_equal(masks['items'], labels['items'])
    user_index = {str(user): i for i, user in enumerate(masks['users'])}
    truth_files = {str(p): sha(p) for p in [data_root / 'eligibility.npz', data_root / 'evaluator_only/labels.npz']}
    scored, negatives = [], []
    for projection in rows:
        row = {**projection}
        ranking = row['ordered_item_ids']
        if row['dataset'] == 'kuairec':
            index = user_index[row['user_id']]
            eligible = list(map(str, masks['items'][masks['observed'][index]]))
            positive = set(map(str, labels['items'][labels['relevant'][index]]))
            assert positive <= set(eligible), 'invalid private positive mask'
            assert set(eligible) == set(row['eligible_item_ids']), 'public eligibility differs from original mask'
            metrics = krec.score_user(ranking, row['acquired_item_ids'] if row['delivery_valid'] else [], eligible, positive, True)
            row['metrics'] = {k: metrics[k] for k in METRICS}
            row['strict_metrics'] = {k: value if row['strict_episode_success'] or value is None else 0.0 for k, value in row['metrics'].items()}
            row['diagnostics'] = metrics
            row['random_full_eligible_catalog'] = random_reference(eligible, positive, len(positive))
            row['random_own_acquired_pool'] = random_reference(row['acquired_item_ids'], positive, len(positive))
            row['actual_pool_recall_diagnostic'] = len(positive.intersection(row['acquired_item_ids'])) / len(positive) if positive else None
            for target in sorted(positive - set(ranking)):
                native_rank = row['native_ordered_item_ids'].index(target) + 1 if target in row['native_ordered_item_ids'] else None
                stage = ('not_applicable' if not row['applicable'] else 'no_valid_delivery' if not row['delivery_valid']
                         else 'native_selected_beyond_evaluation_prefix' if row['method'] == 'clawrec' and native_rank is not None
                         else 'acquired_not_selected' if target in row['acquired_item_ids'] else 'not_acquired')
                negatives.append({'id': row['id'], 'dataset': row['dataset'], 'method': row['method'], 'target': target,
                                  'lost_at': stage, 'native_rank': native_rank,
                                  'native_source': row['native_source'], 'native_sha256': row['native_sha256']})
        else:
            truth_path = Path(row['public_task']['task_dir']) / 'groundtruth' / f"groundtruth_{row['task_id']}.json"
            target = str(read(truth_path)['ground truth'])
            truth_files[str(truth_path)] = sha(truth_path)
            assert target in row['candidate_ids'], 'AR truth outside public candidates'
            row['target'] = target
            row['metrics'] = {'hit_at_5': ar.official_metrics([target], [ranking])['top_5_hit_rate'],
                              'ndcg_at_5': ndcg(ranking, target, 5), 'ndcg_at_10': ndcg(ranking, target, 10)}
            row['strict_metrics'] = {k: value if row['strict_episode_success'] else 0.0 for k, value in row['metrics'].items()}
            n = len(row['candidate_ids'])
            row['random_fixed_candidates'] = {'hit_at_5': min(5, n) / n,
                'ndcg_at_5': sum(1 / math.log2(i + 2) for i in range(min(5, n))) / n,
                'ndcg_at_10': sum(1 / math.log2(i + 2) for i in range(min(10, n))) / n}
            if not row['metrics']['hit_at_5']:
                negatives.append({'id': row['id'], 'dataset': row['dataset'], 'method': row['method'], 'domain': row['domain'],
                    'target': target, 'target_rank': ranking.index(target) + 1 if target in ranking else None,
                    'lost_at': 'not_applicable' if not row['applicable'] else 'no_valid_delivery' if not row['delivery_valid'] else 'rank_below_5',
                    'native_source': row['native_source'], 'native_sha256': row['native_sha256']})
        scored.append(row)
    grouped = collections.defaultdict(list)
    for row in scored:
        grouped[(row['dataset'], row['method'], row.get('domain', 'all'))].append(row)
        if row['dataset'] == 'agentrecbench':
            grouped[(row['dataset'], row['method'], 'all')].append(row)
    summary = []
    for (dataset, method, domain), group in grouped.items():
        for subset, values in [('all_assigned', group), ('applicable_only', [r for r in group if r['applicable']])]:
            keys = group[0]['metrics']
            item = {'dataset': dataset, 'method': method, 'domain': domain, 'subset': subset, 'n': len(values),
                    'assigned_n': len(group), 'delivery_valid': sum(r['delivery_valid'] for r in values),
                    'strict_episode_success': sum(r['strict_episode_success'] for r in values),
                    'strict_definition': group[0]['strict_definition'],
                    'episodes_with_recorded_failures_diagnostic': sum(bool(r['recorded_failure_count']) for r in values),
                    'metric_denominator': {k: sum(r['metrics'][k] is not None for r in values) for k in keys},
                    'mean': {k: mean([r['metrics'][k] for r in values]) for k in keys},
                    'strict_mean': {k: mean([r['strict_metrics'][k] for r in values]) for k in keys}}
            for ref in ('random_full_eligible_catalog', 'random_own_acquired_pool', 'random_fixed_candidates'):
                if ref in group[0]:
                    item[ref] = {k: mean([r[ref][k] for r in values]) for k in keys if k in group[0][ref]}
            if dataset == 'agentrecbench' and values:
                item['official_metrics'] = ar.official_metrics([r['target'] for r in values], [r['ordered_item_ids'] for r in values])
                item['official_strict_metrics'] = ar.official_metrics([r['target'] for r in values], [r['strict_ordered_item_ids'] for r in values])
            summary.append(item)
    output.mkdir(parents=True)
    save_lines(output / 'rows.jsonl', scored)
    save_lines(output / 'negative-items.jsonl', negatives)
    save(output / 'metrics.json', {'prediction_freeze_sha256': expected_sha, 'summary': summary, 'truth_files_sha256': truth_files,
        'negative_count': len(negatives), 'notes': [
            'Actual legal delivery is primary. Strict terminal success requires valid delivery and no terminal error, continuation error, or failed workers. Failed or NA outputs contribute zero in all-assigned rows.',
            'Earlier action, format, model, and worker error receipts remain separate diagnostics. A recorded error does not mean final delivery failed; reporting granularity differs, so recorded-failure-free is not a comparable method-quality metric.',
            'KuaiRec uses original score_user with every eligible positive in recall/IDCG. Invalid/failed delivery has original evaluator zero acquisition metric; actual acquired pool recall is separately diagnostic.',
            'ClawRec evaluation is its declared native order prefix Top10; native sections/order remain saved.',
            'Random references are analytical expectations for an unconditioned Top10 within each listed public universe; they do not change predictions. Own-pool reference is conditional on each method retrieval.',
            'AR primary is original Hit@5. NDCG@5 and NDCG@10 are auxiliary single-positive metrics. Different datasets/metrics are not pooled.',
            'Negative attribution verifies only the execution/retrieval/ranking stage. Semantic causes and free-text factual truth are not inferred from the metric.'
        ]})
    print(json.dumps({'score': str(output), 'n': len(scored), 'negative_count': len(negatives), 'freeze_sha256': expected_sha}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    f = commands.add_parser('freeze')
    f.add_argument('--plan', type=Path, default=OUT / 'pilot-v2-plan.json')
    f.add_argument('--fixed', type=Path, default=OUT / 'pilot-fixed-v1')
    f.add_argument('--output', type=Path, required=True)
    s = commands.add_parser('score')
    s.add_argument('--freeze', type=Path, required=True)
    s.add_argument('--freeze-sha256', required=True)
    s.add_argument('--release-labels', action='store_true')
    s.add_argument('--data-root', type=Path, default=BASE / 'experiments/agentic-waterfall/kuairec/data/processed')
    s.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'freeze':
        freeze(args.plan, args.fixed, args.output)
    else:
        score(args.freeze, args.freeze_sha256, args.release_labels, args.data_root, args.output)


if __name__ == '__main__':
    main()
