"""Run only the authorized six-case local calibration; never call an API or scorer."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
METHOD = ROOT / 'methods/agentic-waterfall'
OUT = HERE / 'local-calibration'
PYTHON = METHOD / 'fixed-retrieval/.venv/bin/python'
ENV = {**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'}


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    assert not (OUT / 'calibration.json').exists(), 'inspect existing calibration before repeating GPU work'
    assignment = read(OUT / 'assignment.json')['assignments']
    assert len(assignment) == 6 and sum(not x['embedding_skipped'] for x in assignment) == 5
    summary = read(HERE / 'summary.json')
    for item in summary['execution_sources']:
        assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
    for item in summary['bge_files']:
        info = Path(item['path']).stat()
        assert info.st_size == item['size'] and info.st_mtime_ns // 1_000_000 == int(item['mtime_ms'])
    for item in assignment:
        if not item['embedding_skipped']:
            raw = Path(item['path']).read_bytes().strip()
            assert hashlib.sha256(raw).hexdigest() == item['payload_sha256']

    baseline = OUT / 'baseline'; resident = OUT / 'resident'
    baseline.mkdir(); resident.mkdir()
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'method_predictions': False,
              'scoring': False, 'model_requests_sent': 0, 'training_runs': 0, 'cases': [],
              'source_sha256': {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in
                               [HERE / 'resident-bge.py', HERE / 'calibrate-local.py', METHOD / 'recbot/semantic.py',
                                METHOD / 'fixed-retrieval/retrieval.py']},
              'bge_files': summary['bge_files'], 'platform': platform.platform(),
              'hardware': {key: subprocess.run(['sysctl', '-n', key], capture_output=True, text=True).stdout.strip()
                           for key in ['hw.model', 'hw.memsize', 'hw.ncpu', 'machdep.cpu.brand_string']}}
    save(OUT / 'progress.json', report)
    runner = "import runpy,sys;sys.path.insert(0,sys.argv[1]);from gpu_lock import locked\nwith locked():runpy.run_path(sys.argv[2],run_name='__main__')"
    for item in assignment:
        row = {**item}
        report['cases'].append(row)
        if item['embedding_skipped']:
            row['status'] = 'skipped_original_empty_history_branch'
            continue
        task = item['task_id'].replace(':', '-')
        stdout = baseline / (task + '.scores.json')
        stderr = baseline / (task + '.stderr.log')
        started = time.perf_counter()
        with Path(item['path']).open('rb') as payload, stdout.open('xb') as output, stderr.open('xb') as log:
            process = subprocess.run([str(PYTHON), '-c', runner,
                                      str(ROOT / 'output/agentic-waterfall/full-expansion-20261030/runtime/formal'),
                                      str(METHOD / 'recbot/semantic.py')], stdin=payload, stdout=output, stderr=log, env=ENV)
        row['baseline_wall_seconds'] = time.perf_counter() - started
        row['baseline_scores'] = str(stdout)
        assert process.returncode == 0, stderr.read_text()[-2000:]
        row['status'] = 'baseline_completed'
        save(OUT / 'progress.json', report)
        print(json.dumps({'phase': 'baseline', 'task_id': item['task_id'], 'seconds': row['baseline_wall_seconds']}), flush=True)

    import numpy as np
    started = time.perf_counter()
    with (resident / 'stderr.log').open('xb') as log:
        process = subprocess.Popen([str(PYTHON), str(HERE / 'resident-bge.py')], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=log, text=True, bufsize=1, env=ENV)
        try:
            ready = json.loads(process.stdout.readline())
            assert ready['type'] == 'ready' and ready['device'] == 'mps' and ready['dtype'] == 'torch.float32'
            report['resident'] = {**ready, 'startup_wall_seconds': time.perf_counter() - started}
            for row in report['cases']:
                if row['embedding_skipped']:
                    continue
                payload = read(Path(row['path']))
                started = time.perf_counter()
                process.stdin.write(json.dumps({'id': row['task_id'], 'payload': payload}, separators=(',', ':')) + '\n')
                process.stdin.flush()
                response = json.loads(process.stdout.readline())
                row['resident_wall_seconds'] = time.perf_counter() - started
                assert response['type'] == 'result' and response['id'] == row['task_id']
                path = resident / (row['task_id'].replace(':', '-') + '.scores.json')
                save(path, response['scores']); row['resident_scores'] = str(path)
                row['resident_inference_seconds'] = response['seconds']
                old = read(Path(row['baseline_scores'])); new = response['scores']
                ids = [item['id'] for item in payload['items']]
                row['fields'] = {}
                for key in ['semantic', 'negative']:
                    assert list(old[key]) == list(new[key]) == ids
                    first = np.asarray([old[key][item] for item in ids], dtype=np.float64)
                    second = np.asarray([new[key][item] for item in ids], dtype=np.float64)
                    equal = bool(np.array_equal(first, second))
                    row['fields'][key] = {'np_array_equal': equal, 'maximum_absolute_difference': float(np.max(np.abs(first - second)))}
                ranking = lambda scores: sorted(ids, key=lambda item: (-(scores['semantic'][item] - scores['negative'][item]), ids.index(item)))
                row['ranking_identical'] = ranking(old) == ranking(new)
                row['passed'] = all(item['np_array_equal'] for item in row['fields'].values()) and row['ranking_identical']
                row['status'] = 'passed' if row['passed'] else 'different_do_not_use_resident'
                save(OUT / 'progress.json', report)
                print(json.dumps({'phase': 'resident', 'task_id': row['task_id'], 'seconds': row['resident_wall_seconds'], 'passed': row['passed']}), flush=True)
        finally:
            process.stdin.close()
            process.wait()
    report['passed'] = process.returncode == 0 and all(row.get('passed', row['embedding_skipped']) for row in report['cases'])
    report['status'] = 'passed' if report['passed'] else 'different_do_not_use_resident'
    report['baseline_total_seconds'] = sum(row.get('baseline_wall_seconds', 0) for row in report['cases'])
    report['resident_inference_total_seconds'] = sum(row.get('resident_wall_seconds', 0) for row in report['cases'])
    report['resident_with_startup_total_seconds'] = report['resident']['startup_wall_seconds'] + report['resident_inference_total_seconds']
    save(OUT / 'calibration.json', report); save(OUT / 'progress.json', report)
    print(json.dumps({key: report[key] for key in ['status', 'passed', 'baseline_total_seconds', 'resident_inference_total_seconds', 'resident_with_startup_total_seconds']}), flush=True)
    assert report['passed'], 'resident implementation must not be used'


if __name__ == '__main__':
    main()
