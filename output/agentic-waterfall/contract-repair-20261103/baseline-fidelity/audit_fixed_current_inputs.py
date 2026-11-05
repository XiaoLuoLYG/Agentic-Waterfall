"""Reuse fixed outputs only after comparing every actual current public input."""
import ast
import copy
import hashlib
import json
import sys
from pathlib import Path

from run_fixed_full import ROOT, OLD, audit_case, digest, save, sha, verify

PLAN = ROOT / 'baseline-fidelity/fixed-full-plan.json'
CURRENT = ROOT / 'full-kuairec-api-continuation-20261103/routequeue1234-20261104-waterfall-plan.json'
OUT = ROOT / 'fixed-input-equivalence-20261105'
NATIVE = OLD / 'frozen/fixed-v2'


def read(path):
    return json.loads(Path(path).read_bytes())


tree = ast.parse((NATIVE / 'kuairec_batch.py').read_text())
parts_function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'history_parts')
namespace = {}
exec(compile(ast.Module(body=[parts_function], type_ignores=[]), 'frozen-fixed-history-rule', 'exec'), namespace)
parts_for = namespace['history_parts']


def compare_observations(previous, current, scope_equal=True):
    old_events, new_events = previous['behavior_events'], current['behavior_events']
    fields = {
        'user_equal': str(previous['user_id']) == str(current['user_id']),
        'history_equal': old_events == new_events,
        'query_equal': ' '.join(parts_for(old_events)) == ' '.join(parts_for(new_events)),
        'excluded_ids_equal': {str(e['item_id']) for e in old_events} == {str(e['item_id']) for e in new_events},
        'catalog_and_eligibility_equal': scope_equal,
    }
    return {**fields, 'observation_equal': previous == current, 'reuse': all(fields.values())}


def self_check():
    old = {'user_id': 'u', 'behavior_events': [{'item_id': 'i', 'payload': {'watch_ratio': 3, 'item_text': 'public text'}}]}
    assert compare_observations(old, copy.deepcopy(old))['reuse']
    changed = copy.deepcopy(old)
    changed['behavior_events'][0]['payload']['item_text'] = 'different text'
    assert not compare_observations(old, changed)['reuse']
    assert not compare_observations(old, old, False)['reuse']
    metadata = copy.deepcopy(old)
    metadata['unused_transport_metadata'] = 'new'
    assert compare_observations(old, metadata)['reuse']
    print('PASS: unchanged native inputs reused; changed history/query/scope rejected; unused metadata does not force reruns', flush=True)


def main():
    self_check()
    if sys.argv[1:] == ['--self-check']:
        return
    assert not sys.argv[1:]
    assert not OUT.exists(), 'Keep prior audit immutable; inspect it before a new run'
    OUT.mkdir()
    plan, current = read(PLAN), read(CURRENT)
    assert len(plan['cases']) == len(current['commands']) == 1129
    verify(plan['files_sha256'])
    # Equal pinned model bytes and token policy make equal text/candidate inputs reusable.
    verify(plan['model_assets_sha256'])
    index = Path(plan['index'])
    verify({str(index / n): d for n, d in plan['index_sha256'].items()})
    eligibility = ROOT / 'public-data/kuairec/eligible-users.json'
    public_catalog = ROOT / 'public-data/kuairec/catalog.json'
    assert sha(eligibility) == plan['eligibility_sha256']
    catalog = read(index / 'index.json')['catalog']
    assert {str(x['id']): x['text'] for x in catalog} == {str(x['id']): x['text'] for x in read(public_catalog)}
    commands = {str(c['public_user_id']): c for c in current['commands']}
    statuses, affected, rows = {}, [], []
    journal = OUT / 'cases.jsonl'
    with journal.open('x') as stream:
        for number, job in enumerate(plan['cases'], 1):
            old_input = Path(job['input'])
            assert sha(old_input) == job['input_sha256']
            previous = read(old_input)['observation']
            command = commands[str(job['user_id'])]
            task = read(command['task_file'])
            with Path(task['input_path']).open('rb') as source:
                source.seek(task['input_offset'])
                raw = source.read(task['input_bytes'])
            observation = json.loads(raw)['observation']
            comparison = compare_observations(previous, observation)
            result_path = ROOT / 'full-kuairec-fixed-v3/cases' / f"{job['index']:04d}" / 'result.json'
            record = read(result_path)
            assert record['index'] == job['index'] and record['user_id'] == job['user_id']
            proof = {'index': job['index'], 'user_id': job['user_id'], **comparison,
                     'previous_input_sha256': sha(old_input), 'current_input_sha256': hashlib.sha256(raw).hexdigest(),
                     'current_task_sha256': sha(Path(command['task_file'])), 'result_sha256': sha(result_path)}
            if comparison['reuse']:
                query = ' '.join(parts_for(observation['behavior_events']))
                current_job = {**job, 'history_sha256': digest(observation['behavior_events']),
                               'query_sha256': hashlib.sha256(query.encode()).hexdigest()}
                prediction_path = next(Path(p) for p in record['artifact_sha256'] if Path(p).name == 'predictions.jsonl')
                prediction, artifacts = audit_case(prediction_path.parent, current_job, plan)
                assert prediction == record['prediction']
                verify(record['artifact_sha256'])
                proof.update(native_trace_token_and_gpu_receipts_verified=True,
                             source_artifact_sha256=artifacts, query_sha256=current_job['query_sha256'],
                             status=prediction['status'], rerun_required=False)
                statuses[prediction['status']] = statuses.get(prediction['status'], 0) + 1
            else:
                proof.update(rerun_required=True, status='changed_effective_input')
                affected.append(proof)
            rows.append(proof)
            stream.write(json.dumps(proof, ensure_ascii=False) + '\n')
            stream.flush()
            if number % 50 == 0 or number == 1129:
                save(OUT / 'progress.json', {'checked': number, 'assigned': 1129, 'affected': len(affected), 'model_requests': 0})
                print(json.dumps({'checked': number, 'affected': len(affected)}), flush=True)
    save(OUT / 'affected-cases.json', affected)
    save(OUT / 'acceptance.json', {
        'passed': True, 'assigned': 1129, 'checked': len(rows), 'reusable': len(rows) - len(affected),
        'changed_effective_inputs': len(affected), 'reruns_started': 0, 'statuses': statuses,
        'whole_observations_equal': sum(r['observation_equal'] for r in rows),
        'all_current_public_histories_checked': True, 'native_queries_and_token_receipts_checked': True,
        'catalog_text_index_eligibility_and_pinned_assets_equal': True,
        'actual_fixed_caller': 'fixed-worker.py -> frozen fixed-v2/kuairec_batch.py -> frozen fixed-v2/retrieval.search',
        'public_search_admission_patch_is_not_in_fixed_call_path': True,
        'does_not_claim_modified_fixed_algorithm_results': True,
        'fixed_plan_sha256': sha(PLAN), 'current_public_plan_sha256': sha(CURRENT),
        'per_case_proofs_sha256': sha(journal), 'labels_read_by_equivalence_audit': False,
        'model_requests': 0, 'new_gpu_inference': False, 'training': False,
    })


if __name__ == '__main__':
    main()
