import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent), str(HERE.parent / 'formal-run')]
spec = importlib.util.spec_from_file_location('kuairand_first_complete', HERE / 'run_kuairand.py')
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)


class FirstEpisodeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.raw = (json.dumps({'observation': {'decision_id': 'case-0', 'environment': {'candidate_pool': [{'id': 'a'}, {'id': 'b'}]}}}) + '\n').encode()
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript('CREATE TABLE tasks(id INTEGER,offset INTEGER,bytes INTEGER); CREATE TABLE jobs(task INTEGER,decision_id TEXT,method TEXT,status TEXT,attempt INTEGER,PRIMARY KEY(task,method));')
        self.db.execute('INSERT INTO tasks VALUES(0,0,?)', (len(self.raw),))
        self.db.execute('INSERT INTO jobs VALUES(0,"case-0","mars","pending",0)')
        self.db.execute('INSERT INTO jobs VALUES(1,"case-1","mars","pending",0)')
        self.db.commit()
        self.calls = []
        self.folder = self.root / 'runtime/formal/kuairand-full/mars/task-000000'
        self.patches = [patch.object(queue, 'HERE', self.root), patch.object(queue, 'RUNTIME', self.root / 'runtime')]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        queue.STOP = False

    def process(self, result, receipt=True):
        def execute(command, **_):
            self.calls.append(command)
            dest = Path(command[-2])
            dest.mkdir(parents=True)
            (dest / 'result.json').write_text(json.dumps(result))
            if receipt:
                service = 'model_' in str(result.get('error', ''))
                (dest / 'stage.response.json').write_text(json.dumps({'status': 'failed' if service else 'success',
                    'content': '{}', 'attempt_id': 'paid-' + str(len(self.calls)), 'error': result.get('error') if service else None}))
            return subprocess.CompletedProcess(command, int(result['status'] == 'failed'), '', '')
        return execute

    def execute(self):
        return queue.run_job(self.db, queue.claim_next(self.db, queue.FIRST_COMPLETE), io.BytesIO(self.raw), queue.FIRST_COMPLETE)

    def test_first_method_failure_is_terminal_and_independent_job_can_continue(self):
        with patch.object(queue.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})):
            self.assertTrue(self.execute())
        self.assertEqual(self.db.execute('SELECT status FROM jobs WHERE task=0').fetchone()[0], 'method_failure')
        self.assertEqual(queue.claim_next(self.db, queue.FIRST_COMPLETE)['task'], 1)
        self.assertEqual(json.loads((self.folder / 'run/result.json').read_text())['status'], 'failed')

    def test_restart_does_not_replay_terminal_method_failure(self):
        with patch.object(queue.subprocess, 'run', self.process({'status': 'failed', 'error': 'invalid ranking'})):
            self.execute()
        with patch.object(queue.subprocess, 'run', side_effect=AssertionError('failed episode replay')):
            self.assertEqual(queue.claim_next(self.db, queue.FIRST_COMPLETE)['task'], 1)
        self.assertEqual(len(self.calls), 1)

    def test_service_limit_counts_prior_committed_failures_after_restart(self):
        def interrupt(_):
            raise InterruptedError('restart')
        with patch.object(queue.subprocess, 'run', self.process({'status': 'failed', 'error': 'model_http_503'})), patch.object(queue.time, 'sleep', interrupt):
            with self.assertRaises(InterruptedError):
                self.execute()
        self.db.execute('UPDATE jobs SET status="pending" WHERE task=0')
        self.db.commit()
        with patch.object(queue.subprocess, 'run', self.process({'status': 'failed', 'error': 'model_http_503'})), patch.object(queue.time, 'sleep', lambda _: None):
            self.assertFalse(self.execute())
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.db.execute('SELECT attempt,status FROM jobs WHERE task=0').fetchone(), (3, 'failed'))
        with self.assertRaisesRegex(RuntimeError, 'failed task'):
            queue.claim_next(self.db, queue.FIRST_COMPLETE)

    def test_unknown_and_missing_model_receipt_stop_without_terminal_zero(self):
        for result, receipt in [({'status': 'failed', 'error': 'adapter mysterious crash'}, True),
                                ({'status': 'failed', 'error': 'invalid ranking'}, False)]:
            with self.subTest(result=result, receipt=receipt):
                # Each case is an isolated job in a fresh folder/database attempt state.
                import shutil
                if self.folder.exists():
                    shutil.rmtree(self.folder)
                self.db.execute('UPDATE jobs SET status="pending",attempt=0 WHERE task=0')
                self.db.commit()
                with patch.object(queue.subprocess, 'run', self.process(result, receipt)):
                    self.assertFalse(self.execute())
                self.assertEqual(self.db.execute('SELECT status FROM jobs WHERE task=0').fetchone()[0], 'running')
                with self.assertRaisesRegex(RuntimeError, 'unresolved running'):
                    queue.claim_next(self.db, queue.FIRST_COMPLETE)

    def test_started_without_result_cannot_be_resubmitted_after_manual_reset(self):
        with patch.object(queue.subprocess, 'run', side_effect=InterruptedError('uncertain paid task')):
            with self.assertRaises(InterruptedError):
                self.execute()
        self.db.execute('UPDATE jobs SET status="pending" WHERE task=0')
        self.db.commit()
        with patch.object(queue.subprocess, 'run', side_effect=AssertionError('uncertain replay')):
            with self.assertRaisesRegex(RuntimeError, 'unresolved_prior_paid_attempt'):
                self.execute()

    def test_invalid_submitted_artifact_stays_raw_and_needs_attention(self):
        raw = {'status': 'submitted', 'ordered_item_ids': ['a', 'a']}
        with patch.object(queue.subprocess, 'run', self.process(raw)):
            self.assertFalse(self.execute())
        self.assertEqual(json.loads((self.folder / 'attempt-001/result.json').read_text()), raw)
        self.assertFalse((self.folder / 'run').exists())
        self.assertEqual(self.db.execute('SELECT status FROM jobs WHERE task=0').fetchone()[0], 'running')
        self.db.execute('UPDATE jobs SET status="pending" WHERE task=0')
        self.db.commit()
        with patch.object(queue.subprocess, 'run', side_effect=AssertionError('invalid artifact replay')):
            with self.assertRaisesRegex(RuntimeError, 'invalid_submitted_artifact'):
                self.execute()

    def test_nested_nonretryable_service_receipt_requires_attention(self):
        folder = self.root / 'receipt'
        folder.mkdir()
        (folder / 'response.json').write_text(json.dumps({'status': 'failed', 'error': 'model_http_429',
            'receipt': {'status': 'failed', 'error': 'model_http_429', 'http_error': {'retryable': False}}}))
        self.assertEqual(queue.checked_category({'status': 'failed', 'error': 'model_http_429'}, folder), 'attention')
        (folder / 'response.json').write_text(json.dumps({'status':'failed','error':'model_http_429','service_retry_exhausted':True,'http_error':{'retryable':True}}))
        self.assertEqual(queue.checked_category({'status':'failed','error':'model_http_429'}, folder), 'attention')

    def test_submitted_and_no_delivery_require_successful_response_proof(self):
        folder = self.root / 'response-proof'
        folder.mkdir()
        for status in ['submitted', 'no_delivery']:
            self.assertEqual(queue.checked_category({'status': status}, folder), 'attention')
        (folder / 'response.json').write_text(json.dumps({'receipt': {'status': 'success', 'content': '{}'}}))
        for status in ['submitted', 'no_delivery']:
            self.assertEqual(queue.checked_category({'status': status}, folder), status)

    def test_legacy_failed_row_still_stops(self):
        self.db.execute('UPDATE jobs SET status="method_failure" WHERE task=0')
        self.db.commit()
        with self.assertRaisesRegex(RuntimeError, 'failed task'):
            queue.claim_next(self.db)


if __name__ == '__main__':
    unittest.main()
