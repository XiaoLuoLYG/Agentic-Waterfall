"""Separate post-freeze judgement; reuse committed scores without repeating paid calls."""
import argparse, hashlib, json, os, pathlib, subprocess, tempfile


def sha(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def completed_entry(folder, binding):
    receipt_path = folder / 'receipt.json'
    if not receipt_path.exists():
        return None
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('input') != binding:
        raise ValueError('scoring_needs_attention: changed ClawRec task result or plan')
    for name, digest in receipt.get('artifacts_sha256', {}).items():
        path = folder / name
        if not path.is_file() or sha(path) != digest:
            raise ValueError('scoring_needs_attention: changed or missing ClawRec score artifact')
    if receipt['entry']['status'] == 'scored' and set(receipt.get('artifacts_sha256', {})) != {
        'metrics.json', 'judge/receipt.json', 'judge/labels.json'
    }:
        raise ValueError('scoring_needs_attention: incomplete ClawRec score receipt')
    return receipt['entry']


def score(run):
    run = run.resolve()
    plan = json.loads((run / 'plan.json').read_text())
    tasks = [json.loads(x) for x in (run / 'tasks.jsonl').read_text().splitlines() if x.strip()]
    if not tasks or len({t['id'] for t in tasks}) != len(tasks):
        raise ValueError('invalid task assignment')
    if any(not (run / 'results' / (t['id'] + '.json')).exists() for t in tasks):
        raise ValueError('all predictions must be committed before judging')
    scripts = run / 'code/experiments/agentic-waterfall/clawrec/scripts'
    dest = run / 'evaluation-only/clawrec'
    dest.mkdir(parents=True, exist_ok=True)
    run_binding = {'plan_sha256': sha(run / 'plan.json'), 'tasks_sha256': sha(run / 'tasks.jsonl')}
    manifest = dest / 'run-receipt.json'
    if manifest.exists():
        if json.loads(manifest.read_text()) != run_binding:
            raise ValueError('scoring_needs_attention: changed ClawRec plan or assignment')
    elif any(dest.iterdir()):
        raise ValueError('scoring_needs_attention: existing ClawRec output has no run receipt')
    else:
        save(manifest, run_binding)
    entries = []
    environment = dict(os.environ, MODEL_CONFIG_FILE=plan['model_config_file'])
    if plan.get('model_name'):environment['OPENAI_MODEL']=plan['model_name']
    for task in [t for t in tasks if t['dataset'] == 'clawrec']:
        folder = dest / task['id']
        result_path = run / 'results' / (task['id'] + '.json')
        binding = {**run_binding, 'task_id': task['id'], 'result_sha256': sha(result_path)}
        if folder.exists():
            entry = completed_entry(folder, binding)
            if entry is not None:
                entries.append(entry)
                continue
            # A request may have been charged even when no response receipt was written.
            raise ValueError(f'scoring_needs_attention: incomplete ClawRec judgement {task["id"]}; inspect saved files and ledger, no automatic retry')
        folder.mkdir()
        save(folder / 'input-receipt.json', binding)
        row = json.loads(result_path.read_text())
        if row['task']['id'] != task['id'] or row['task']['dataset'] != 'clawrec':
            raise ValueError('ClawRec result task mismatch')
        result = row['result']
        artifacts = {}
        if result['status'] != 'submitted':
            entry = {'id': task['id'], 'status': result['status'], 'hit_at_20': 0,
                     'dcg_at_20': 0, 'reason': result.get('error')}
        else:
            commands = [
                ['python3', str(scripts/'export_pool.py'), '--result', str(result_path), '--catalog', str(folder/'catalog.json'), '--rankings', str(folder/'rankings.json')],
                ['python3', str(scripts/'build_blind_pool.py'), '--cases-root', plan['clawrec_cases_root'], '--workspace', task['workspace'], '--event', str(task['event']), '--catalog', str(folder/'catalog.json'), '--rankings', str(folder/'rankings.json'), '--output', str(folder/'judge')],
                ['node', str(scripts/'judge_waterfall.mjs'), '--pool', str(folder/'judge/blind-judge-input.json'), '--prompt', plan['clawrec_judge_prompt'], '--event', str(task['event']), '--receipt', str(folder/'judge/receipt.json'), '--labels', str(folder/'judge/labels.json')],
                ['python3', str(scripts/'score_rankings.py'), '--mapping', str(folder/'judge/evaluator-mapping.json'), '--labels', str(folder/'judge/labels.json'), '--output', str(folder/'metrics.json')],
            ]
            for index, command in enumerate(commands):
                if index == 2:
                    save(folder / 'judge-started.json', binding)
                with (folder / 'evaluation.log').open('a') as log:
                    code = subprocess.run(command, env=environment, stdout=log, stderr=subprocess.STDOUT).returncode
                if code:
                    raise RuntimeError(f'scoring_needs_attention: judge_pipeline_failed {task["id"]}; saved outputs retained, no automatic retry')
            values = json.loads((folder / 'metrics.json').read_text())['scores']['Waterfall']
            entry = {'id': task['id'], 'status': 'scored', 'hit_at_20': values['hit_at_k'],
                     'dcg_at_20': values['dcg_at_k'], 'ndcg_own_pool_at_20': values['ndcg_self_at_k']}
            artifacts = {name: sha(folder / name) for name in ('metrics.json', 'judge/receipt.json', 'judge/labels.json')}
        save(folder / 'receipt.json', {'input': binding, 'entry': entry, 'artifacts_sha256': artifacts})
        entries.append(entry)
    metrics = {'assigned': len(entries), 'judged': sum(x['status'] == 'scored' for x in entries),
               'hit_at_20': sum(x['hit_at_20'] for x in entries) / len(entries) if entries else None,
               'mean_dcg_at_20': sum(x['dcg_at_20'] for x in entries) / len(entries) if entries else None,
               'entries': entries, 'limits': ['Waterfall-only pool; no cross-method shared-pool NDCG claim',
               'Judge and recommender use the same model service', 'Retrospective frozen public content; not official live internet environment']}
    save(dest / 'summary.json', metrics)
    print(json.dumps({'assigned': len(entries), 'judged': metrics['judged'], 'summary': str(dest / 'summary.json')}))


def self_check():
    with tempfile.TemporaryDirectory() as temporary:
        folder = pathlib.Path(temporary) / 'task'
        (folder / 'judge').mkdir(parents=True)
        binding = {'plan_sha256': 'synthetic-plan', 'tasks_sha256': 'synthetic-tasks',
                   'task_id': 'fixture', 'result_sha256': 'synthetic-result'}
        assert completed_entry(folder, binding) is None
        for name in ('metrics.json', 'judge/receipt.json', 'judge/labels.json'):
            save(folder / name, {'synthetic': True})
        entry = {'id': 'fixture', 'status': 'scored', 'hit_at_20': 1, 'dcg_at_20': 1}
        save(folder / 'receipt.json', {'input': binding, 'entry': entry,
             'artifacts_sha256': {name: sha(folder / name) for name in ('metrics.json', 'judge/receipt.json', 'judge/labels.json')}})
        assert completed_entry(folder, binding) == entry
        try:
            completed_entry(folder, {**binding, 'result_sha256': 'changed'})
        except ValueError as error:
            assert str(error).startswith('scoring_needs_attention:')
        else:
            raise AssertionError('changed source result reused')
        save(folder / 'metrics.json', {'changed': True})
        try:
            completed_entry(folder, binding)
        except ValueError as error:
            assert str(error).startswith('scoring_needs_attention:')
        else:
            raise AssertionError('changed metrics reused')
        run = pathlib.Path(temporary) / 'run'
        (run / 'results').mkdir(parents=True)
        task = {'id': 'fixture', 'dataset': 'clawrec'}
        save(run / 'plan.json', {'model_config_file': 'unused-synthetic-config'})
        (run / 'tasks.jsonl').write_text(json.dumps(task) + '\n')
        save(run / 'results/fixture.json', {'task': task, 'result': {'status': 'submitted'}})
        dest = run / 'evaluation-only/clawrec'
        complete = dest / 'fixture'
        (complete / 'judge').mkdir(parents=True)
        run_binding = {'plan_sha256': sha(run / 'plan.json'), 'tasks_sha256': sha(run / 'tasks.jsonl')}
        save(dest / 'run-receipt.json', run_binding)
        actual_binding = {**run_binding, 'task_id': 'fixture', 'result_sha256': sha(run / 'results/fixture.json')}
        for name in ('metrics.json', 'judge/receipt.json', 'judge/labels.json'):
            save(complete / name, {'synthetic': True})
        save(complete / 'receipt.json', {'input': actual_binding, 'entry': entry,
             'artifacts_sha256': {name: sha(complete / name) for name in ('metrics.json', 'judge/receipt.json', 'judge/labels.json')}})
        original_run = subprocess.run
        def no_subprocess(*args, **kwargs):
            raise AssertionError('recovery must not invoke a subprocess or model')
        subprocess.run = no_subprocess
        try:
            score(run)
            assert json.loads((dest / 'summary.json').read_text())['assigned'] == 1
            (complete / 'receipt.json').unlink()
            save(complete / 'judge-started.json', actual_binding)
            try:
                score(run)
            except ValueError as error:
                assert str(error).startswith('scoring_needs_attention:')
            else:
                raise AssertionError('unfinished paid judgement retried')
        finally:
            subprocess.run = original_run
    print('synthetic ClawRec recovery checks passed; no labels or model calls')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=pathlib.Path)
    parser.add_argument('--self-check', action='store_true')
    args = parser.parse_args()
    if args.self_check:
        self_check()
    elif args.run_dir:
        score(args.run_dir)
    else:
        parser.error('--run-dir or --self-check required')
