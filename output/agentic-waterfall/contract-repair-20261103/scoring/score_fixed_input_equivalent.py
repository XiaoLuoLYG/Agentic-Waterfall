"""Score the input-equivalent frozen fixed outputs; never start model inference."""
from datetime import datetime, timezone, timedelta
import importlib.util
import math
from pathlib import Path

import score_pilot as s

AUDIT = s.OUT / 'fixed-input-equivalence-20261105'
FIXED = s.OUT / 'full-kuairec-fixed-v3'
OUT = s.OUT / 'scoring/scored-kuairec-fixed-input-audited-20261105'


def main():
    audit = s.read(AUDIT / 'acceptance.json')
    assert audit['passed'] and audit['checked'] == audit['reusable'] == 1129
    assert audit['changed_effective_inputs'] == 0 and s.sha(AUDIT / 'cases.jsonl') == audit['per_case_proofs_sha256']
    freeze = s.read(FIXED / 'freeze.json')
    predictions = FIXED / 'predictions.jsonl'
    assert freeze['count'] == 1129 and not freeze['labels_read'] and s.sha(predictions) == freeze['predictions_sha256']
    rows = s.lines(predictions)
    assert len(rows) == len({r['user_id'] for r in rows}) == 1129
    assert sum(r['status'] == 'submitted' for r in rows) == 1128
    assert sum(r['status'] == 'no_delivery' for r in rows) == 1
    evaluator_path = s.OUT / 'frozen/v4/code/experiments/agentic-waterfall/kuairec/scripts/evaluate.py'
    spec = importlib.util.spec_from_file_location('fixed_official_evaluator', evaluator_path)
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    OUT.mkdir()
    # Freeze the existing outputs and label-free equivalence decision before this score reads labels.
    s.save(OUT / 'prediction-freeze.json', {'count': 1129, 'prediction_source': str(predictions),
        'prediction_sha256': s.sha(predictions), 'original_freeze_sha256': s.sha(FIXED / 'freeze.json'),
        'equivalence_acceptance_sha256': s.sha(AUDIT / 'acceptance.json'),
        'per_case_proofs_sha256': s.sha(AUDIT / 'cases.jsonl'),
        'evaluator_sha256': s.sha(evaluator_path), 'scoring_script_sha256': s.sha(Path(__file__)),
        'labels_read_by_this_freeze': False})
    import numpy as np
    data = s.BASE / 'experiments/agentic-waterfall/kuairec/data/processed'
    eligibility = np.load(data / 'eligibility.npz', allow_pickle=False)
    labels = np.load(data / 'evaluator_only/labels.npz', allow_pickle=False)
    assert np.array_equal(eligibility['users'], labels['users']) and np.array_equal(eligibility['items'], labels['items'])
    users = {str(u): i for i, u in enumerate(labels['users'])}
    values = {key: [] for key in s.METRICS}
    scored = []
    for row in rows:
        i = users[row['user_id']]
        eligible = list(map(str, eligibility['items'][eligibility['observed'][i]]))
        positive = set(map(str, labels['items'][labels['relevant'][i]]))
        rank, acquired = row['ordered_item_ids'], row['acquired_item_ids']
        assert len(rank) == len(set(rank)) and set(rank) <= set(acquired) <= set(eligible)
        assert (row['status'] == 'submitted' and len(rank) == 10) or (row['status'] == 'no_delivery' and not rank and not acquired)
        metrics = evaluator.score_user(rank, acquired, eligible, positive, True)
        hits = len(set(rank) & positive)
        dcg = sum(1 / math.log2(j + 2) for j, item in enumerate(rank) if item in positive)
        ideal = sum(1 / math.log2(j + 2) for j in range(min(10, len(positive))))
        expected = {'precision_at_10': hits / 10, 'recall_at_10': hits / len(positive) if positive else None,
                    'ndcg_at_10': dcg / ideal if ideal else None,
                    'acquired_recall_at_100': len(set(acquired) & positive) / len(positive) if positive else None}
        for key, value in expected.items():
            assert (value is None and metrics[key] is None) or math.isclose(value, metrics[key], abs_tol=1e-12)
            values[key].append(value)
        scored.append({'user_id': row['user_id'], 'status': row['status'],
                       'metrics': expected, 'hits_at_10': hits, 'prediction_reused': True})
    mean = {key: s.mean(v) for key, v in values.items()}
    old = next(r for r in s.read(s.OUT / 'scoring/scored-kuairec-full-completed/metrics.json')['summary']
               if r['method'] == 'fixed-bm25-bge-reranker' and r['subset'] == 'all_assigned')
    for key, value in mean.items():
        assert math.isclose(value, old['mean'][key], abs_tol=1e-12)
    s.save_lines(OUT / 'rows.jsonl', scored)
    s.save(OUT / 'metrics.json', {'method': 'fixed-bm25-bge-reranker', 'assigned': 1129,
        'submitted': 1128, 'legal_empty': 1, 'mean': mean,
        'metric_denominators': {k: sum(v is not None for v in vals) for k, vals in values.items()},
        'prediction_freeze_sha256': s.sha(OUT / 'prediction-freeze.json'),
        'truth_files_sha256': {str(p): s.sha(p) for p in (data / 'eligibility.npz', data / 'evaluator_only/labels.npz')}})
    s.save(OUT / 'acceptance.json', {'passed': True, 'at_beijing': datetime.now(timezone(timedelta(hours=8))).isoformat(),
        'assigned': 1129, 'reused_predictions': 1129, 'rerun_cases': 0, 'changed_effective_inputs': 0,
        'valid_rankings': 1128, 'legal_empty': 1, 'denominator': 1129,
        'same_current_public_observations': 1129, 'official_and_independent_metrics_match': True,
        'mean': mean, 'existing_metrics_reproduced': True, 'model_requests': 0,
        'metrics_sha256': s.sha(OUT / 'metrics.json'),
        'equivalence_audit_sha256': s.sha(AUDIT / 'acceptance.json')})
    print({'passed': True, 'reused': 1129, 'reruns': 0, 'mean': mean})


if __name__ == '__main__':
    main()
