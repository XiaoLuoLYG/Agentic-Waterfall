"""Validate and freeze every ClawRec delivery, then reuse the sealed KuaiRec scorer."""
from collections import Counter
from pathlib import Path
import fcntl
import math

import score_pilot as s

PLAN = s.OUT / 'kuairec-clawrec-targeted-repair-20261104/plan.json'
FROZEN = s.OUT / 'scoring/frozen-kuairec-clawrec-full-20261105'
SCORED = s.OUT / 'scoring/scored-kuairec-clawrec-full-20261105'


def freeze():
    plan = s.read(PLAN)
    run, code = Path(plan['output']), Path(plan['runtime'])
    with (run / 'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = s.read(run / 'progress.json')
        assert state['status'] == 'completed' and state['completed'] == state['total'] == 1129
        assert not state['active'] and not state['paused_groups']
        assert s.read(run / 'queue-identity.json')['manifest_sha256'] == s.sha(PLAN)
        public_files = {p: digest for p, digest in plan['files_sha256'].items() if not s.is_truth_path(p)}
        truth_files = {p: digest for p, digest in plan['files_sha256'].items() if s.is_truth_path(p)}
        s.verify_files(public_files)
        journal = run / 'outcomes.jsonl'
        records = s.lines(journal)
        assignments = {r['id']: r for r in plan['commands']}
        assert len(records) == len(assignments) == len({r['id'] for r in records}) == 1129
        assert {r['id'] for r in records} == assignments.keys()
        population = s.read(s.OUT / 'baseline-fidelity/fixed-full-plan.json')['cases']
        eligibility_path = s.OUT / 'public-data/kuairec/eligible-users.json'
        eligibility = s.read(eligibility_path)
        queue, krec, ar = s.components(code)
        evaluator = code / 'experiments/agentic-waterfall/kuairec/scripts/evaluate.py'
        assert s.sha(evaluator) == plan['files_sha256'][str(evaluator)]
        files = {**public_files, **{str(p): s.sha(p) for p in (PLAN, journal, run / 'queue-identity.json', evaluator,
                 eligibility_path, Path(__file__), Path(s.__file__))}}
        rows, models = [], Counter()
        for record in sorted(records, key=lambda r: r['id']):
            command = assignments[record['id']]
            index = int(command['id'].split('-')[1])
            assert command['dataset'] == 'kuairec' and command['method'] == 'clawrec'
            assert record['category'] == 'terminal' and record['status'] == 'submitted'
            assert not record.get('error') and not record.get('continuation_error')
            case = population[index]
            assert case['index'] == index and case['user_id'] == command['public_user_id']
            public_path = next(Path(p) for p in command['argv'] if p.endswith('.jsonl'))
            public = s.lines(public_path)[0]
            assert public['observation'] == s.lines(case['input'])[0]['observation']
            public['eligible_item_ids'] = list(map(str, eligibility[command['public_user_id']]))
            source = Path(record['result_path'])
            assert s.sha(source) == record['result_sha256']
            native = s.read(source)
            searches = source.parent / 'search-results.json'
            row = s.project(command, native, public, s.read(searches), queue, krec, ar)
            assert row['delivery_valid'] and row['strict_episode_success'], command['id']
            assert len(row['ordered_item_ids']) == 10 and native['search_count'] <= 10
            row.update(assignment_index=index, native_source=str(source), native_sha256=record['result_sha256'],
                       recorded_failure_count=len(s.recorded_failures(native, source.parent)))
            rows.append(row)
            for path in (source, searches, public_path, Path(case['input'])):
                files[str(path)] = s.sha(path)
            for receipt in source.parent.glob('*.response.json'):
                value = s.read(receipt)
                assert value['status'] == 'success'
                models[value['provider_response_model']] += 1
                files[str(receipt)] = s.sha(receipt)
        assert len({r['user_id'] for r in rows}) == 1129
        assert set(models) == {'DeepSeek-V4.1-Flash-1017'}
        FROZEN.mkdir()
        s.save_lines(FROZEN / 'projections.jsonl', rows)
        s.save(FROZEN / 'progress-snapshot.json', state)
        prior = s.read(s.OUT / 'scoring/scored-kuairec-full-completed/metrics.json')
        frozen = FROZEN / 'predictions-frozen.json'
        s.save(frozen, {'runtime': str(code), 'assignment_count': 1129,
            'assignment_ids': [r['id'] for r in rows], 'files_sha256': files,
            'all_predictions_sha256': s.sha(FROZEN / 'projections.jsonl'),
            'deferred_truth_source_sha256': {**truth_files, **prior['truth_files_sha256']},
            'labels_read_by_freeze': False, 'successful_model_receipts': dict(models)})
        return frozen


def verify_score(frozen):
    import numpy as np
    metrics = s.read(SCORED / 'metrics.json')
    assert metrics['prediction_freeze_sha256'] == s.sha(frozen)
    data = s.BASE / 'experiments/agentic-waterfall/kuairec/data/processed'
    labels = np.load(data / 'evaluator_only/labels.npz', allow_pickle=False)
    users = {str(user): i for i, user in enumerate(labels['users'])}
    values = {k: [] for k in s.METRICS}
    rows = s.lines(SCORED / 'rows.jsonl')
    for row in rows:
        positives = set(map(str, labels['items'][labels['relevant'][users[row['user_id']]]]))
        rank = row['ordered_item_ids']
        hits = len(positives.intersection(rank))
        dcg = sum(1 / math.log2(i + 2) for i, item in enumerate(rank) if item in positives)
        ideal = sum(1 / math.log2(i + 2) for i in range(min(10, len(positives))))
        expected = {'precision_at_10': hits / 10,
            'recall_at_10': hits / len(positives) if positives else None,
            'ndcg_at_10': dcg / ideal if ideal else None,
            'acquired_recall_at_100': len(positives.intersection(row['acquired_item_ids'])) / len(positives) if positives else None}
        for key, value in expected.items():
            assert (value is None and row['metrics'][key] is None) or math.isclose(value, row['metrics'][key], abs_tol=1e-12)
            values[key].append(value)
    summary = next(r for r in metrics['summary'] if r['subset'] == 'all_assigned')
    assert summary['n'] == summary['delivery_valid'] == summary['strict_episode_success'] == len(rows) == 1129
    for key, items in values.items():
        assert math.isclose(s.mean(items), summary['mean'][key], abs_tol=1e-12)
    s.save(SCORED / 'acceptance.json', {'passed': True, 'assigned_users': 1129, 'valid_deliveries': 1129,
        'strict_successes': 1129, 'unresolved_deliveries': 0, 'metrics_independently_verified': True,
        'mean': summary['mean'], 'metrics_sha256': s.sha(SCORED / 'metrics.json'),
        'prediction_freeze_sha256': s.sha(frozen), 'manifest_sha256': s.sha(PLAN)})


if __name__ == '__main__':
    frozen = freeze()
    s.score(frozen, s.sha(frozen), True, s.BASE / 'experiments/agentic-waterfall/kuairec/data/processed', SCORED)
    verify_score(frozen)
