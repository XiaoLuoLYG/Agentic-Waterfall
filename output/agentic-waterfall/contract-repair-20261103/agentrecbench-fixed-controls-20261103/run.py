"""Run the fixed-candidate additions against the frozen Waterfall public input."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
BATCH = HERE.parent
BASE = BATCH.parents[2]
WF = BATCH/'agentrecbench-waterfall-full-20261103'
AR = BATCH/'full-agentrecbench-20261103'
CODE = HERE/'runtime/code'
METHODS = ('clawrec', 'generic-agent')
MODEL = 'DeepSeek-V4.1-Flash-1017'
ENTRY = CODE/'methods/agentic-waterfall/paper-reproductions-run.mjs'
CONFIG = BASE/'HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json'
TRANSPORT = BATCH/'transport-retry/register.mjs'
sys.path.insert(0, str(AR))
from run_queue import save, sha, verify_files

def read(path):
    return json.loads(path.read_bytes())

def frozen_source_paths():
    paths = {}
    for journal in WF.glob('**/outcomes.jsonl'):
        for line in journal.read_text().splitlines():
            row = json.loads(line)
            paths[row['id'], row['result_sha256']] = Path(row['result_path'])
    return paths

def prepare():
    assignment = read(WF/'assignment.json')['commands']
    reference = read(WF/'predictions-frozen.json')
    paths = frozen_source_paths()
    assert len(assignment) == len(reference['sources']) == 300
    pilot_ids = {row['id'] for row in read(WF/'pilot-plan.json')['commands']}
    assert len(pilot_ids) == 6
    rows = []
    for row in assignment:
        ref_id = row['id']
        ref_sha = reference['sources'][ref_id]
        source = paths[ref_id, ref_sha]
        assert sha(source) == ref_sha
        frozen = read(source)
        public_path = Path(row['public_task'])
        candidates = read(public_path)['candidate_list']
        observation = frozen['input']['observation']
        assert observation['decision_id'] == f'agentrecbench:short_term:{row["domain"]}:{row["task_id"]}'
        assert len(candidates) == len(set(candidates)) == 20
        assert [x['id'] for x in observation['environment']['candidate_pool']] == candidates
        assert frozen['result']['ordered_item_ids'] == reference['predictions'][ref_id]
        assert all(t['kind'] in ('recommend', 'lookup_history', 'update_state')
                   for step in frozen['result']['trace'] for t in step['execution_results'])
        projection = {'observation': observation}
        raw = (json.dumps(projection, ensure_ascii=False, separators=(',', ':'))+'\n').encode()
        path = HERE/'inputs'/f'{ref_id.removesuffix("-waterfall")}.jsonl'
        path.parent.mkdir(exist_ok=True)
        if path.exists():
            assert path.read_bytes() == raw
        else:
            with path.open('xb') as stream:
                stream.write(raw)
        rows.append({'id': ref_id, 'domain': row['domain'], 'task_id': row['task_id'],
                     'candidate_ids': candidates, 'input': str(path), 'input_sha256': hashlib.sha256(raw).hexdigest(),
                     'public_task': str(public_path), 'public_sha256': sha(public_path),
                     'reference_sha256': ref_sha, 'pilot': ref_id in pilot_ids})
    return rows

def run_case(row, method, frozen_files):
    folder = HERE/'cases'/method/row['id'].removesuffix('-waterfall')
    receipt = folder/'outcome.json'
    attempt = folder/'attempt'
    result_path = attempt/'result.json'
    verify_files(frozen_files)
    if receipt.exists():
        outcome = read(receipt)
        assert sha(result_path) == outcome['result_sha256']
        return outcome
    source = Path(row['input'])
    assert sha(source) == row['input_sha256']
    if not folder.exists():
        folder.mkdir(parents=True)
        env = {**os.environ, 'WATERFALL_FORMAL_ROUTE':'1', 'WATERFALL_MODEL_TIMEOUT_MS':'180000',
               'WATERFALL_REQUEST_GATE_DIR':str(AR/'request-gates'), 'MODEL_CONFIG_FILE':str(CONFIG)}
        for key in ('NODE_OPTIONS', 'BASELINE_REPLAY_DIR', 'BASELINE_REPLAY_ONLY', 'KREC_REPLAY_PREFIX'):
            env.pop(key, None)
        cmd = ['/usr/bin/sandbox-exec', '-f', HERE/'labels-denied.sb', 'node', '--import', TRANSPORT,
               '--import', HERE/'runtime/register.mjs', ENTRY, method, source, '0', attempt, 'agentrecbench']
        with (folder/'process.log').open('xb') as log:
            proc = subprocess.run(list(map(str, cmd)), cwd=CODE, env=env, stdout=log, stderr=subprocess.STDOUT)
        if proc.returncode:
            raise RuntimeError(f'{method} {row["id"]}: runner exited {proc.returncode}; see {folder}/process.log')
    result = read(result_path) if result_path.is_file() else {}
    if result.get('status') != 'submitted':
        raise RuntimeError(f'{method} {row["id"]}: {result.get("error", "missing result")}')
    ids = result['ordered_item_ids']
    assert result['method'] == method and result['context_id'] == read(source)['observation']['decision_id']
    assert len(ids) == len(set(ids)) == 20 and set(ids) == set(row['candidate_ids'])
    if method == 'clawrec':
        assert result.get('main_table_eligible') is False
    obs = read(source)['observation']
    metadata = next((x['value'] for x in obs['user_state']['records'] if x['key'] == 'public_user_metadata'), None)
    task = next(x['benchmark_task'] for x in obs['environment']['sources'] if x['id'] == 'get_user')
    context = {'user_metadata': metadata, 'category': task.get('candidate_category'), 'location': task.get('loc')}
    requests = sorted(attempt.glob('*.request.json'))
    responses = sorted(attempt.glob('*.response.json'))
    assert len(requests) == len(responses) == result['model_request_count'] == 2, f'{method} {row["id"]}: unexpected correction or missing receipt'
    for index, (req, res) in enumerate(zip(requests, responses)):
        assert read(res)['provider_response_model'] == MODEL and read(res)['status'] == 'success'
        request = read(req)
        payload = json.loads(request['messages'][1]['content'].split('\nINPUT: ', 1)[1])
        assert payload['task_context'] == context
        if index == 0:
            assert payload['history'] == obs['behavior_events']
        else:
            assert payload['candidates'] == [{'index': i, 'text': x['text']}
                for i, x in enumerate(obs['environment']['candidate_pool'], 1)]
    verify_files(frozen_files)
    value = {'id': row['id'], 'method': method, 'status': 'submitted', 'ordered_item_ids': ids,
             'result_sha256': sha(result_path), 'requests': len(requests)}
    save(receipt, value)
    return value

def score(phase, rows, outcomes):
    freeze = HERE/f'{phase}-predictions-frozen.json'
    if freeze.exists():
        assert read(freeze) == outcomes
    else:
        save(freeze, outcomes)
    from score_after_run import load_components
    evaluator = load_components().RecommendationEvaluator()
    i2 = read(AR/'evaluation/predictions-frozen.json')['outcomes']
    eligible = {key.removesuffix('-i2agent') for key, value in i2.items()
                if value['method'] == 'i2agent' and value['status'] != 'not_applicable'}
    assert len(eligible) == 220
    labels = {}
    for row in rows:
        public = Path(row['public_task'])
        assert sha(public) == row['public_sha256']
        label = read(public.parent.parent/'groundtruth'/f'groundtruth_{row["task_id"]}.json')['ground truth']
        assert label in row['candidate_ids']
        labels[row['id']] = label
    results = {}
    for method in METHODS:
        rankings = {x['id']: x['ordered_item_ids'] for x in outcomes if x['method'] == method}
        assert set(rankings) == set(labels)
        groups = {domain: [r['id'] for r in rows if r['domain'] == domain]
                  for domain in ('amazon', 'goodreads', 'yelp')}
        groups.update(all=list(labels), matched220=[k for k in labels if k.removesuffix('-waterfall') in eligible])
        results[method] = {}
        for group, keys in groups.items():
            metrics = evaluator.calculate_hr_at_n([labels[k] for k in keys], [rankings[k] for k in keys], 0)
            results[method][group] = {'hits': metrics.top_5_hits, 'assigned': len(keys), 'hit_at_5': metrics.top_5_hit_rate}
    save(HERE/f'{phase}-metrics.json', {'freeze_sha256': sha(freeze), 'methods': results})
    return results

def execute(phase, rows, files):
    outcomes = []
    for row in rows:
        # One pair at a time so an anomaly cannot start another case.
        with ThreadPoolExecutor(max_workers=2) as pool:
            pair = [pool.submit(run_case, row, method, files) for method in METHODS]
            outcomes.extend(future.result() for future in pair)
        save(HERE/'progress.json', {'phase': phase, 'status': 'running',
                                   'completed': len(outcomes), 'assigned': len(rows)*2})
    return score(phase, rows, outcomes)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('prepare', 'run'))
    args = parser.parse_args()
    with (HERE/'queue.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.mode == 'prepare':
            rows = prepare()
            files = [Path(__file__), HERE/'labels-denied.sb', HERE/'runtime/register.mjs',
                     TRANSPORT, TRANSPORT.with_name('model-client.mjs'), AR/'frozen/client.mjs']
            methods = CODE/'methods/agentic-waterfall'
            files.extend([ENTRY, methods/'kuairec-input.mjs'])
            for directory in ('clawrec', 'generic-agent', 'mars', 'recbot'):
                files.extend(p for p in (methods/directory).glob('*.mjs') if not p.name.endswith('.test.mjs'))
            files.extend(methods/'clawrec/source-snapshot'/skill/'SKILL.md' for skill in
                         ('clawrec-synthesizing-user-state', 'clawrec-curating-display-data'))
            save(HERE/'assignment.json', {'rows': rows, 'files': {str(p): sha(p) for p in files}})
        else:
            assignment = read(HERE/'assignment.json')
            rows, files = assignment['rows'], assignment['files']
            files[str(HERE/'assignment.json')] = sha(HERE/'assignment.json')
            phase = 'pilot'
            try:
                pilot = execute('pilot', [r for r in rows if r['pilot']], files)
                assert all(pilot[m]['amazon']['hits'] + pilot[m]['goodreads']['hits'] >= 1 for m in METHODS), 'Pilot below fixed-candidate random expectation'
                save(HERE/'gate.json', {'status': 'passed', 'pilot_metrics_sha256': sha(HERE/'pilot-metrics.json')})
                phase = 'full'
                execute('full', rows, files)
                save(HERE/'progress.json', {'phase': phase, 'status': 'completed', 'completed': 600, 'assigned': 600})
            except Exception as error:
                progress = HERE/'progress.json'
                current = read(progress) if progress.exists() else {}
                save(progress, {**current, 'phase': phase, 'status': 'needs_user', 'error': str(error)})
                raise
