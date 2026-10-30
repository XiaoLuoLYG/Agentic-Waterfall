"""Synthetic validation holds must stop evaluation before labels or paid judging."""
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


formal = module('score_formal')
clawrec = module('score_formal_clawrec')


class ValidationScoringChecks(unittest.TestCase):
    def fixture(self, directory, kind, missing=False, bad_hash=False):
        run = pathlib.Path(directory)
        (run / 'results').mkdir()
        tasks = [{'id': 'held-other-dataset', 'dataset': 'kuairand'},
                 {'id': 'clean-clawrec', 'dataset': 'clawrec'}]
        (run / 'tasks.jsonl').write_text(''.join(json.dumps(task) + '\n' for task in tasks))
        for task in tasks:
            if missing and task is tasks[0]:
                continue
            row = {'task': task, 'input': {'observation': {
                'decision_id': task['id'], 'user_id': 'synthetic',
                'environment': {'candidate_pool': []}}},
                'result': {'decision_id': task['id'], 'status': 'failed',
                           'error': 'synthetic_terminal_failure', 'ordered_item_ids': [],
                           'model_calls': []}}
            (run / 'results' / (task['id'] + '.json')).write_text(json.dumps(row) + '\n')
        output = run / 'results' / (tasks[0]['id'] + '.json')
        digest = None if missing else formal.sha(output)
        dispositions = run / 'validation-dispositions.json'
        dispositions.write_text(json.dumps({'schema_version': 1, 'tasks': {
            tasks[0]['id']: {'task': tasks[0]['id'], 'dataset': tasks[0]['dataset'],
                             'kind': kind, 'result_sha256': '0' * 64 if bad_hash else digest,
                             'reason': 'synthetic audit'}}}))
        plan = {'model_config_file': 'unused-synthetic-config',
                'validation_dispositions_file': str(dispositions)}
        (run / 'plan.json').write_text(json.dumps(plan) + '\n')
        return run, plan

    def assert_blocked(self, scorer, run, message):
        with patch.object(scorer.subprocess, 'run', side_effect=AssertionError('evaluation invoked')) as called:
            with patch.object(formal, 'reuse_completed', side_effect=AssertionError('evaluation source reached')):
                with self.assertRaisesRegex(ValueError, message):
                    scorer.score(run)
            called.assert_not_called()
        self.assertFalse((run / 'evaluation-only').exists())

    def test_any_assigned_hold_blocks_both_scorers_before_evaluation(self):
        for scorer in (formal, clawrec):
            with self.subTest(scorer=scorer.__name__), tempfile.TemporaryDirectory() as directory:
                run, _ = self.fixture(directory, 'hold')
                self.assert_blocked(scorer, run, '^evaluation_blocked_by_validation_holds: 1$')

    def test_uncommitted_hold_blocks_before_missing_prediction_check(self):
        for scorer in (formal, clawrec):
            with self.subTest(scorer=scorer.__name__), tempfile.TemporaryDirectory() as directory:
                run, _ = self.fixture(directory, 'hold', missing=True)
                self.assert_blocked(scorer, run, '^evaluation_blocked_by_validation_holds: 1$')

    def test_changed_result_hash_fails_closed_before_evaluation(self):
        for scorer in (formal, clawrec):
            with self.subTest(scorer=scorer.__name__), tempfile.TemporaryDirectory() as directory:
                run, _ = self.fixture(directory, 'failed', bad_hash=True)
                self.assert_blocked(scorer, run, 'validation_disposition')

    def test_terminal_failed_disposition_stays_failed_and_is_not_a_hold(self):
        with tempfile.TemporaryDirectory() as directory:
            run, plan = self.fixture(directory, 'failed')
            groups = formal.load_completed(run, plan)
            result = groups[('kuairand', 'test')][0][1]
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['ordered_item_ids'], [])
            with patch.object(formal, 'reuse_completed', return_value=True) as reused:
                formal.score(run)
                reused.assert_called_once()
            with patch.object(clawrec.subprocess, 'run', side_effect=AssertionError('judge invoked')) as called:
                clawrec.score(run)
                called.assert_not_called()
            summary = json.loads((run / 'evaluation-only/clawrec/summary.json').read_text())
            self.assertEqual((summary['assigned'], summary['judged'], summary['hit_at_20']), (1, 0, 0))
            self.assertEqual(summary['entries'][0]['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
