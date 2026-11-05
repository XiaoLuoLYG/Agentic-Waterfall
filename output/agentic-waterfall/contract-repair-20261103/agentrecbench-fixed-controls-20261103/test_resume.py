from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import concurrent.futures
import json
import shutil
import threading
import unittest
import resume


class ResumeTests(unittest.TestCase):
    def test_full_freeze_order_is_the_fixed_assignment_order(self):
        import time
        def captured(row, method, files):
            if row['id'] == '0':
                time.sleep(0.02)
            return {'id': row['id'], 'method': method, 'status': 'submitted'}
        with TemporaryDirectory() as directory, patch.object(resume.base, 'HERE', Path(directory)), \
                patch.object(resume.base, 'run_case', side_effect=captured), \
                patch.object(resume.base, 'score', side_effect=lambda phase, rows, outcomes: outcomes):
            result = resume.execute_full([{'id': '0'}, {'id': '1'}], {})
        self.assertEqual([(x['id'], x['method']) for x in result],
            [('0', 'clawrec'), ('0', 'generic-agent'), ('1', 'clawrec'), ('1', 'generic-agent')])

    def test_failed_step_continuation_reuses_the_captured_state(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            checks = root / 'resume-20261105'
            checks.mkdir()
            shutil.copy2(resume.CHECKS / 'replay-register.mjs', checks / 'replay-register.mjs')
            (root / 'runtime').symlink_to(resume.HERE / 'runtime', target_is_directory=True)
            shutil.copy2(resume.HERE / 'labels-denied.sb', root / 'labels-denied.sb')
            captured = resume.CHECKS / 'replay-sources/clawrec/ar-amazon-004'
            case = root / 'cases/clawrec/ar-amazon-004'
            shutil.copytree(captured, case)
            row = next(r for r in resume.base.read(resume.HERE / 'assignment.json')['rows']
                       if r['id'] == 'ar-amazon-004-waterfall')
            real_run = resume.base.subprocess.run
            calls = []
            def recorded(args, **kwargs):
                if args[1] == '-p':
                    return real_run(args, **kwargs)
                calls.append('recorded suffix')
                output = Path(args[-2])
                shutil.copytree(resume.HERE / 'cases/clawrec/ar-amazon-004/attempt', output)
                return resume.subprocess.CompletedProcess(args, 0)
            with patch.object(resume, 'CHECKS', checks), patch.object(resume, 'REPLAY_SOURCES', {}), \
                    patch.object(resume.base, 'REPLAY_SOURCES', resume.REPLAY_SOURCES), \
                    patch.object(resume.base, 'HERE', root), patch.object(resume.base.subprocess, 'run', side_effect=recorded):
                result = resume.continue_once(row, 'clawrec', {})
            self.assertEqual(result['status'], 'submitted')
            self.assertEqual(calls, ['recorded suffix'])
            proof = resume.base.read(checks / 'automatic-retries/clawrec/ar-amazon-004/verified.json')
            self.assertEqual(proof['successful_replies_reused'], 1)

    def test_native_bounded_format_retry_is_accepted_without_another_model_call(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = resume.HERE / 'cases/clawrec/ar-goodreads-053'
            target = root / 'cases/clawrec/ar-goodreads-053'
            shutil.copytree(source, target)
            row = next(r for r in resume.base.read(resume.HERE / 'assignment.json')['rows']
                       if r['id'] == 'ar-goodreads-053-waterfall')
            with patch.object(resume.base, 'HERE', root), patch.object(resume.base.subprocess, 'run',
                    side_effect=AssertionError('Existing native correction must not request a model')):
                result = resume.base.run_case(row, 'clawrec', {})
            self.assertEqual(result['requests'], 3)
            self.assertEqual(len(result['ordered_item_ids']), 20)

    def test_cached_outcome_is_revalidated_against_native_result(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = resume.HERE / 'cases/clawrec/ar-amazon-000'
            target = root / 'cases/clawrec/ar-amazon-000'
            shutil.copytree(source, target)
            receipt = target / 'outcome.json'
            cached = json.loads(receipt.read_bytes())
            cached['ordered_item_ids'].pop()
            receipt.write_text(json.dumps(cached))
            row = next(r for r in resume.base.read(resume.HERE / 'assignment.json')['rows']
                       if r['id'] == 'ar-amazon-000-waterfall')
            with patch.object(resume.base, 'HERE', root), patch.object(resume.base.subprocess, 'run',
                    side_effect=AssertionError('Cached validation must not request a model')):
                result = resume.base.run_case(row, 'clawrec', {})
            self.assertEqual(len(result['ordered_item_ids']), 20)

    def test_full_queue_runs_more_than_one_pair_concurrently(self):
        lock = threading.Lock()
        active = peak = 0
        ready = threading.Event()

        def captured(row, method, files):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active >= 4:
                    ready.set()
            ready.wait(0.05)
            with lock:
                active -= 1
            return {'id': row['id'], 'method': method, 'status': 'submitted'}

        with TemporaryDirectory() as directory, patch.object(resume.base, 'HERE', Path(directory)), \
                patch.object(resume.base, 'run_case', side_effect=captured), \
                patch.object(resume.base, 'score', return_value={}):
            resume.execute_full([{'id': str(i)} for i in range(4)], {})
        self.assertGreaterEqual(peak, 4)

    def test_failure_stops_dispatching_new_full_cases(self):
        started = []

        def captured(row, method, files):
            started.append(row['id'])
            raise RuntimeError('captured format failure')

        with TemporaryDirectory() as directory, patch.object(resume.base, 'HERE', Path(directory)), \
                patch.object(resume.base, 'run_case', side_effect=captured), \
                patch.object(resume.base, 'score', return_value={}):
            with self.assertRaisesRegex(RuntimeError, 'captured format failure'):
                resume.execute_full([{'id': str(i)} for i in range(100)], {})
        self.assertLessEqual(len(started), 48)


if __name__ == '__main__':
    unittest.main()
