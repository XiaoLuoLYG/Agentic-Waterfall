import importlib.util
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
spec = importlib.util.spec_from_file_location('agents_first_complete', HERE / 'run_agents.py')
agents = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agents)


class FirstEpisodeTests(unittest.TestCase):
    def test_duplicate_case_owner_is_rejected_before_model_dispatch(self):
        folder=self.root/'case';folder.mkdir()
        with (folder/'task.lock').open('a') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(agents.subprocess,'run',side_effect=AssertionError('duplicate paid request')):
                with self.assertRaises(BlockingIOError):self.run_case()

    def test_group_partition_keeps_original_jobs_and_rejects_unknown_group(self):
        plan={'groups':[{'name':'kuairec/test/clawrec','items':[1,2]}, {'name':'kuairec/test/generic-agent','items':[3]}]}
        self.assertEqual(agents.select_groups(plan,None),plan['groups'])
        self.assertEqual(agents.select_groups(plan,'kuairec/test/clawrec'),[plan['groups'][0]])
        with self.assertRaisesRegex(ValueError,'unknown_group'):
            agents.select_groups(plan,'other')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch = patch.object(agents, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        agents.STOP = False
        self.events = []
        self.calls = []

    def command(self, dest, number):
        return [str(dest)], dest

    def process(self, result, receipt=True, code=None):
        def execute(command, **_):
            self.calls.append(command)
            dest = Path(command[0])
            dest.mkdir(parents=True)
            (dest / 'result.json').write_text(json.dumps(result))
            if receipt:
                service = 'model_' in str(result.get('error', ''))
                (dest / 'stage.response.json').write_text(json.dumps({
                    'status': 'failed' if service else 'success', 'content': '{}',
                    'attempt_id': 'paid-' + str(len(self.calls)), 'error': result.get('error') if service else None}))
            return subprocess.CompletedProcess(command, code if code is not None else int(result['status'] == 'failed'), '', '')
        return execute

    def run_case(self, name='case', first=True):
        return agents.run_one(self.root / name, 'test', self.command, self.events.append, first)

    def test_first_failure_is_terminal_and_next_independent_case_continues(self):
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})):
            self.assertEqual(self.run_case()['status'], 'failed')
            self.assertEqual(self.run_case('other')['status'], 'failed')
        self.assertFalse(agents.STOP)
        self.assertEqual(len(self.calls), 2)
        self.assertTrue((self.root / 'case/run').is_symlink())
        self.assertEqual([e['outcome'] for e in self.events], ['method_failure', 'method_failure'])

    def test_terminal_failure_survives_restart_without_another_call(self):
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})):
            first = self.run_case()
        agents.STOP = False
        with patch.object(agents.subprocess, 'run', side_effect=AssertionError('paid rerun')):
            self.assertEqual(self.run_case(), first)
        self.assertEqual(len(self.calls), 1)

    def test_missing_result_and_unknown_error_stop_without_retry(self):
        for result, receipt in [({'status': 'failed', 'error': 'unrecognized adapter crash'}, True),
                                ({'status': 'failed', 'error': 'invalid ranking'}, False)]:
            with self.subTest(result=result, receipt=receipt):
                with patch.object(agents.subprocess, 'run', self.process(result, receipt)):
                    with self.assertRaises(RuntimeError):
                        self.run_case('unknown-' + str(len(self.calls)))
        self.assertEqual(len(self.calls), 2)

    def test_service_limit_persists_across_restart(self):
        def interrupt(_):
            raise InterruptedError('restart after committed service failure')
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'model_http_503'})), patch.object(agents.time, 'sleep', interrupt):
            with self.assertRaises(InterruptedError):
                self.run_case()
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'model_http_503'})), patch.object(agents.time, 'sleep', lambda _: None):
            self.assertEqual(self.run_case()['error'], 'model_http_503')
        self.assertEqual(len(self.calls), 3)
        agents.STOP = False
        with patch.object(agents.subprocess, 'run', side_effect=AssertionError('fourth service attempt')):
            with self.assertRaisesRegex(RuntimeError, 'service_attempt_limit'):
                self.run_case()

    def test_uncertain_process_started_before_crash_cannot_be_resubmitted(self):
        with patch.object(agents.subprocess, 'run', side_effect=InterruptedError('process killed while paid request may be running')):
            with self.assertRaises(InterruptedError):
                self.run_case()
        with patch.object(agents.subprocess, 'run', side_effect=AssertionError('uncertain paid resubmit')):
            with self.assertRaisesRegex(RuntimeError, 'unresolved_prior_paid_attempt'):
                self.run_case()

    def test_permanent_http_and_mixed_service_text_are_not_retryable(self):
        for error in ['model_http_400', 'model_http_401', 'model_http_403', 'adapter crash after model_timeout', 'state_missing_file']:
            self.assertEqual(agents.strict_category({'status': 'failed', 'error': error}), 'attention')

    def test_recovered_committed_failure_is_finalized_without_another_call(self):
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})), patch.object(agents.os, 'symlink', side_effect=InterruptedError('crash after committed outcome')):
            with self.assertRaises(InterruptedError):
                self.run_case()
        with patch.object(agents.subprocess, 'run', side_effect=AssertionError('method failure replay')):
            self.assertEqual(self.run_case()['status'], 'failed')

    def test_legacy_method_retry_policy_is_unchanged(self):
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})):
            self.run_case(first=False)
        self.assertEqual(len(self.calls), 2)
        self.assertTrue(agents.STOP)

    def test_changed_final_link_cannot_replace_first_failed_episode(self):
        with patch.object(agents.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})):
            self.run_case()
        other = self.root / 'later-success'
        other.mkdir()
        (other / 'result.json').write_text(json.dumps({'status': 'submitted'}))
        (other / 'response.json').write_text(json.dumps({'status': 'success', 'content': '{}'}))
        (self.root / 'case/run').unlink()
        (self.root / 'case/run').symlink_to(other)
        with patch.object(agents.subprocess, 'run', side_effect=AssertionError('must not request another episode')):
            with self.assertRaisesRegex(RuntimeError, 'first_episode_selection'):
                self.run_case()

    def test_nested_nonretryable_service_receipt_requires_attention(self):
        folder = self.root / 'receipt'
        folder.mkdir()
        (folder / 'response.json').write_text(json.dumps({'status': 'failed', 'error': 'model_http_429',
            'receipt': {'status': 'failed', 'error': 'model_http_429', 'http_error': {'retryable': False}}}))
        self.assertEqual(agents.checked_category({'status': 'failed', 'error': 'model_http_429'}, folder), 'attention')
        (folder / 'response.json').write_text(json.dumps({'status':'failed','error':'model_http_429','service_retry_exhausted':True,'http_error':{'retryable':True}}))
        self.assertEqual(agents.checked_category({'status':'failed','error':'model_http_429'}, folder), 'attention')

    def test_submitted_and_no_delivery_require_successful_response_proof(self):
        folder = self.root / 'response-proof'
        folder.mkdir()
        for status in ['submitted', 'no_delivery']:
            self.assertEqual(agents.checked_category({'status': status}, folder), 'attention')
        (folder / 'response.json').write_text(json.dumps({'receipt': {'status': 'success', 'content': '{}'}}))
        for status in ['submitted', 'no_delivery']:
            self.assertEqual(agents.checked_category({'status': status}, folder), status)

    def test_sim_failure_blocks_only_its_children_and_next_user_can_run(self):
        snapshot = self.root / 'snapshot'
        snapshot.mkdir()
        (snapshot / 'catalog.jsonl').write_text('public snapshot')
        plans = []
        for user in ['user-a', 'user-b']:
            events = []
            for event in [1, 2]:
                source = self.root / user / str(event)
                source.mkdir(parents=True)
                (source / 'public.json').write_text('{}')
                events.append({'case_id': user + '-' + str(event), 'input': str(source), 'event': event,
                               'input_hashes': {'public.json': agents.sha(source / 'public.json')}})
            plans.append({'method': 'clawrec', 'user_id': user, 'events': events})
        def fake_run(folder, kind, make_command, emit, first_complete):
            self.calls.append(folder.name)
            return {'status': 'failed', 'error': 'invalid ranking'}
        with patch.object(agents, 'B', self.root / 'formal'), patch.object(agents, 'run_one', fake_run):
            for plan in plans:
                agents.run_simbench(plan, snapshot, agents.sha(snapshot / 'catalog.jsonl'), self.events.append, True)
        self.assertEqual(self.calls, ['user-a-1', 'user-b-1'])
        self.assertEqual([e['outcome'] for e in self.events], ['blocked_by_prior_failure', 'blocked_by_prior_failure'])


if __name__ == '__main__':
    unittest.main()
