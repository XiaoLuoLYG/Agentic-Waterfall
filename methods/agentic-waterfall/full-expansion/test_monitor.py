"""Read-only aggregation regression tests; fixtures contain no evaluator labels."""
from collections import Counter, defaultdict
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('monitor', HERE / 'monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def lines(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(row) + '\n' for row in rows))


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        monitor.CACHE.clear()

    def waterfall_fixture(self):
        run = self.root / 'waterfall-four-parallel-20261030'
        queue = run / 'code/experiments/agentic-waterfall/unified/formal_queue.py'
        queue.parent.mkdir(parents=True)
        shutil.copyfile(HERE.parents[2] / 'experiments/agentic-waterfall/unified/formal_queue.py', queue)
        save(run / 'plan.json', {'core_sha256': 'expected'})
        tasks = [{'id': name, 'dataset': 'kuairand', 'split': 'test'} for name in 'abcdefg']
        tasks.append({'id': 'mind', 'dataset': 'mind', 'split': 'test'})
        lines(run / 'tasks.jsonl', tasks)
        for task in tasks[:5]:
            result = {'status': 'submitted', 'decision_id': task['id'], 'ordered_item_ids': ['item'],
                      'runtime_source_sha256': 'expected', 'model_calls': [], 'trace': []}
            if task['id'] == 'b':
                result['model_calls'] = [{'error': 'model_http_429'}]
            if task['id'] == 'c':
                result['ordered_item_ids'] = []
            if task['id'] == 'd':
                result['decision_id'] = 'wrong'
            if task['id'] == 'e':
                result['runtime_source_sha256'] = 'old'
            save(run / 'results' / (task['id'] + '.json'), {
                'task': task, 'input': {'observation': {'decision_id': task['id']}}, 'result': result})
        save(run / 'started/f.json', {})
        return run

    def test_waterfall_validates_success_empty_failures_and_uncommitted(self):
        run = self.waterfall_fixture()
        table = defaultdict(Counter)
        errors = monitor.waterfall(table, run)
        self.assertEqual(table[('kuairand', 'test', '', 'Waterfall')],
                         Counter(total=7, delivered=1, empty=1, failed=3, uncommitted=1, pending=1))
        self.assertEqual(sum(errors.values()), 3)
        self.assertIn('model_http_429', errors)
        self.assertFalse(any(key[0] == 'mind' for key in table))
        self.assertFalse(list(run.rglob('__pycache__')))

    def test_waterfall_cache_rechecks_only_changed_results(self):
        run = self.waterfall_fixture()
        queue = monitor.validator(run / 'code/experiments/agentic-waterfall/unified/formal_queue.py')
        with mock.patch.object(queue, 'read_committed', wraps=queue.read_committed) as checked:
            monitor.waterfall(defaultdict(Counter), run)
            monitor.waterfall(defaultdict(Counter), run)
            self.assertEqual(checked.call_count, 5)
            path = run / 'results/e.json'
            row = json.loads(path.read_text())
            row['result']['runtime_source_sha256'] = 'expected'
            save(path, row)
            table = defaultdict(Counter)
            monitor.waterfall(table, run)
            self.assertEqual(checked.call_count, 6)
            self.assertEqual(table[('kuairand', 'test', '', 'Waterfall')]['delivered'], 2)

    def test_events_deduplicate_restarts_and_remove_superseded(self):
        rows = [{'case': 'a', 'outcome': value} for value in
                ('submitted', 'submitted', 'skipped_existing', 'method_failure', 'no_delivery')]
        rows += [{'case': 'b', 'outcome': 'submitted'}, {'case': 'b', 'outcome': 'superseded'},
                 {'case': 'b', 'outcome': 'skipped_existing'}, {'case': 'c', 'outcome': 'operational_failure'}]
        states = monitor.event_states(rows)
        self.assertEqual(set(states), {'a', 'c'})
        table = defaultdict(Counter)
        key = ('kuairec', 'test', '', 'clawrec')
        monitor.apply_events(table, dict.fromkeys('abcd', key), states)
        self.assertEqual(table[key], Counter(total=4, empty=1, failed=1, pending=2))

    def test_plans_expand_simbench_events_and_separate_dev_mind(self):
        base = self.root / 'formal'
        save(base / 'additional-plan.json', {'groups': [
            {'name': 'simbench/clawrec', 'items': [{'kind': 'simbench_sequence', 'method': 'clawrec',
                                                  'events': [{'case_id': 'first'}, {'case_id': 'second'}]}]},
            {'name': 'agentrecbench/amazon/i2agent', 'items': [{'kind': 'agentrecbench', 'domain': 'amazon',
                                                             'method': 'i2agent', 'task_id': 0, 'entry': {}}]}]})
        lines(base / 'additional-events.jsonl', [{'case': 'formal/simbench/clawrec/first', 'outcome': 'no_delivery'},
              {'case': 'formal/simbench/clawrec/second', 'outcome': 'submitted'}])
        save(base / 'local-plan.json', {'kuairec_dev': 1, 'kuairec_test': 2, 'simbench_cases': 2})
        save(base.parent / 'experiment-plan.json', {'jobs': [{'dataset': 'kuairand', 'method': 'clawrec'},
                                                             {'dataset': 'mind', 'method': 'clawrec'}]})
        save(base / 'fixed-candidates/kuairand/clawrec/task-input-hashes.json', {'tasks': [
            {'task_id': 'kuairand:1:dev:random'}, {'task_id': 'kuairand:2:test:random'}]})
        lines(base / 'fixed-events.jsonl', [{'dataset': 'kuairand', 'method': 'clawrec',
              'task_id': 'kuairand:1:dev:random', 'outcome': 'submitted'},
              {'dataset': 'mind', 'method': 'clawrec', 'task_id': 'mind:test:1', 'outcome': 'method_failure'}])
        table = defaultdict(Counter)
        states = monitor.baselines(table, base)
        self.assertEqual(table[('simbench', 'five_events', '', 'clawrec')], Counter(total=2, empty=1, delivered=1))
        main = '\n'.join(monitor.table_lines(table))
        self.assertNotIn('/dev', main)
        self.assertNotIn('mind/', main)
        self.assertIn('kuairand/dev', '\n'.join(monitor.table_lines(table, dev=True)))
        self.assertFalse(any(key[0] == 'mind' for key in states['fixed']))

    def test_sqlite_merges_only_test_jobs_with_legacy_and_never_writes(self):
        path = self.root / 'kuairand/mind-index.sqlite'
        path.parent.mkdir()
        with sqlite3.connect(path) as db:
            db.executescript('CREATE TABLE tasks(decision_id TEXT); CREATE TABLE jobs(decision_id TEXT, method TEXT,status TEXT);')
            db.executemany('INSERT INTO tasks VALUES(?)', [('kuairand:1:test:r',), ('kuairand:2:test:r',),
                                                          ('kuairand:3:test:r',), ('kuairand:4:dev:r',)])
            db.executemany('INSERT INTO jobs VALUES(?,?,?)', [('kuairand:2:test:r', 'i2agent', 'submitted'),
                         ('kuairand:3:test:r', 'clawrec', 'failed'), ('kuairand:4:dev:r', 'i2agent', 'submitted'),
                         ('mind:test:1', 'i2agent', 'submitted')])
        before = path.read_bytes()
        table = defaultdict(Counter)
        key = ('kuairand', 'test', '', 'i2agent')
        table[key].update(total=1, delivered=1)
        monitor.kuairand(table, self.root)
        self.assertEqual(table[key], Counter(total=2, delivered=2, inapplicable=1))
        self.assertEqual(table[('kuairand', 'test', '', 'clawrec')]['failed'], 1)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual({p.name for p in path.parent.iterdir()}, {'mind-index.sqlite'})

    def test_recycled_pid_and_stale_fatal_are_not_reported_as_live_failure(self):
        with mock.patch.object(monitor.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '/bin/sleep 10')):
            self.assertFalse(monitor.live(123, 'run_local.py'))
        with mock.patch.object(monitor.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'python formal/run_local.py')):
            self.assertTrue(monitor.live(123, 'run_local.py'))
        with mock.patch.object(monitor, 'live', return_value=False):
            text = monitor.queue_line('fixed', {'running': False, 'stopped': False, 'total_planned': 2,
                                      'skipped_existing': 2}, 123, 'run_fixed.py', fatal={'error': 'old MIND failure'})
        self.assertIn('predictions_complete', text)
        self.assertNotIn('old MIND failure', text)


if __name__ == '__main__':
    unittest.main()
