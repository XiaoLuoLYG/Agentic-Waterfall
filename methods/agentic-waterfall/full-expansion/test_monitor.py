"""Read-only aggregation regression tests; fixtures contain no evaluator labels."""
from collections import Counter, defaultdict
import importlib.util
import os
import pty
import fcntl
import select
import struct
import termios
import time
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

    def test_confirmed_delivery_and_action_warning_are_counted_separately(self):
        run=self.waterfall_fixture();path=run/'results/a.json';row=json.loads(path.read_text());result=row['result']
        result.update(state_after={'version':1,'records':[]},candidate_pool_after=[{'id':'item'}],trace=[{'execution_results':[
            {'kind':'update_state','status':'failed','error':'state_evidence_missing'},
            {'kind':'recommend','status':'success','result':{'queued_item_ids':['item'],'delivery':'replace_pending'}}]}])
        save(path,row);table=defaultdict(Counter);warnings=Counter();errors=monitor.waterfall(table,run,warnings)
        counts=table[('kuairand','test','','Waterfall')]
        self.assertEqual(counts['delivered'],1);self.assertEqual(counts['warning_cases'],1)
        self.assertEqual(counts['failed'],3);self.assertEqual(warnings,Counter(state_evidence_missing=1))
        self.assertNotIn('failed_tool_action; inspect before continuing',errors)

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

    def test_totals_count_committed_empty_once_and_exclude_mind(self):
        table = {
            ('kuairand', 'test', '', 'Waterfall'): Counter(total=4, delivered=1, empty=1, failed=1, pending=1),
            ('kuairec', 'dev', '', 'clawrec'): Counter(total=3, delivered=2, uncommitted=1, inapplicable=2),
            ('mind', 'test', '', 'Waterfall'): Counter(total=100, delivered=100),
        }
        self.assertEqual(monitor.totals(table), Counter(total=7, delivered=3, empty=1, failed=1, pending=1, uncommitted=1, inapplicable=2))
        self.assertEqual(monitor.totals(table, method='Waterfall')['total'], 4)
        self.assertEqual(monitor.totals(table, split='dev')['total'], 3)
        self.assertIn('4/7', monitor.progress_text(monitor.totals(table)))
        self.assertNotIn('5/7', monitor.progress_text(monitor.totals(table)))

    def test_screen_fits_chinese_columns_and_keeps_footer_on_short_terminal(self):
        self.assertEqual(monitor.display_width('通用Agent'), 9)
        self.assertEqual(monitor.display_width(monitor.cell('通用Agent', 12)), 12)
        self.assertEqual(monitor.display_width(monitor.cell('1/100', 12, right=True)), 12)
        lines = ['标题' * 50, *[str(n) for n in range(30)], '按 q 退出']
        frame = monitor.screen_lines(lines, 20, 80)
        self.assertLessEqual(len(frame), 20)
        self.assertTrue(all(monitor.display_width(line) <= 79 for line in frame))
        self.assertEqual(frame[-1], '按 q 退出')
        self.assertTrue(any('省略' in line for line in frame))

    def test_compact_snapshot_reports_mixed_errors_and_totals(self):
        run = self.waterfall_fixture()
        row = json.loads((run / 'results/b.json').read_text())
        row['result']['model_calls'].append({'error': 'action_id_reuse_with_different_payload'})
        save(run / 'results/b.json', row)
        save(run / 'shards/other/progress.json', {'status': 'needs_attention', 'task': 'b', 'reason': 'model_http_429'})
        with mock.patch.object(monitor, 'resources', return_value='资源'), mock.patch.object(monitor, 'live', return_value=False):
            text = monitor.snapshot(self.root)
        self.assertIn('2/7', text)
        self.assertIn('接口限流429, 动作编号冲突', text)
        self.assertIn('已暂停', text)
        self.assertLessEqual(len(text.splitlines()), 24)

    def test_details_lists_additional_disjoint_lanes_without_changing_totals(self):
        run=self.waterfall_fixture()
        save(run/'shards/kuairec-2/plan.json',{'total':3})
        save(run/'shards/kuairec-2/progress.json',{'status':'running','current':'g','pid':123})
        save(run/'shards/other-2/plan.json',{'total':2})
        save(run/'shards/other-2/progress.json',{'status':'running','current':'f','pid':124})
        with mock.patch.object(monitor,'resources',return_value='资源'),mock.patch.object(monitor,'live',return_value=True):
            text=monitor.snapshot(self.root,details=True)
        self.assertIn('WF/kuairec-2:',text);self.assertIn('WF/other-2:',text)
        self.assertIn('2/7',text)

    def test_details_viewport_clamps_and_keeps_summary_at_two_sizes(self):
        summary = [f'汇总{n}' for n in range(7)]
        body = [f'方法{n:02d} ' + '中文' * 40 for n in range(60)]
        text = summary + body + ['旧页脚']
        for height, width in [(24, 80), (12, 45)]:
            with self.subTest(size=(height, width)):
                frame, offset, page, maximum = monitor.details_viewport(text, height, width, -1)
                self.assertEqual(offset, 0)
                self.assertEqual(page, height - 8)
                self.assertEqual(maximum, len(body) - page)
                self.assertEqual(frame[:7], summary)
                self.assertEqual(len(frame), height)
                self.assertTrue(frame[7].startswith('方法00'))
                self.assertTrue(all(monitor.display_width(line) <= width - 1 for line in frame))
                frame, offset, _, _ = monitor.details_viewport(text, height, width, 1000)
                self.assertEqual(offset, maximum)
                self.assertTrue(frame[-2].startswith('方法59'))
                self.assertIn('30秒刷新', monitor.details_viewport(text, 24, 80, 0)[0][-1])
                self.assertNotIn('省略', '\n'.join(frame))
        self.assertEqual(monitor.details_viewport(text, 0, 80, 20), ([], 0, 0, 0))

    def test_details_dashboard_retains_scroll_across_refresh_and_resize(self):
        class Screen:
            def __init__(self):
                self.keys = iter([monitor.curses.KEY_NPAGE, -1, monitor.curses.KEY_END,
                                  monitor.curses.KEY_RESIZE, monitor.curses.KEY_HOME, ord('q')])
                self.turn = 0
                self.frames = []
            def timeout(self, value):
                pass
            def getmaxyx(self):
                return (24, 80) if self.turn < 3 else (12, 60)
            def erase(self):
                self.frames.append([])
            def addstr(self, row, col, text):
                self.frames[-1].append(text)
            def refresh(self):
                pass
            def getch(self):
                self.turn += 1
                return next(self.keys)
        screen = Screen()
        body = [f'方法{n:02d}' for n in range(60)]
        snapshots = ['\n'.join([f'汇总{version}-{n}' for n in range(7)] + body + ['旧页脚']) for version in ('A', 'B')]
        with mock.patch.object(monitor.curses, 'curs_set'), \
             mock.patch.object(monitor, 'snapshot', side_effect=snapshots) as snapshot, \
             mock.patch.object(monitor.time, 'monotonic', side_effect=[0, 0, 1, 31, 31, 32, 33, 34]):
            monitor.dashboard(screen, self.root, details=True)
        self.assertEqual(snapshot.call_args_list, [mock.call(self.root, True), mock.call(self.root, True)])
        self.assertEqual(screen.frames[1][7], '方法16')
        self.assertEqual(screen.frames[2][7], '方法16')
        self.assertEqual(screen.frames[2][0], '汇总B-0')
        self.assertEqual(screen.frames[3][7], '方法44')
        self.assertEqual(screen.frames[-1][7], '方法00')
        self.assertEqual(len(screen.frames[-1]), 12)

    def test_details_cli_is_interactive_only_for_tty_without_once(self):
        for flags, tty, interactive, details in [(['--details'], True, True, True),
                ([], True, True, False), (['--details', '--once'], True, False, True),
                (['--details'], False, False, True), (['--once'], True, False, False)]:
            with self.subTest(flags=flags, tty=tty), \
                 mock.patch.object(monitor.sys, 'argv', ['monitor.py', '--root', str(self.root), *flags]), \
                 mock.patch.object(monitor.sys, 'stdout') as stdout, \
                 mock.patch.object(monitor, 'snapshot', return_value='STATIC') as snapshot, \
                 mock.patch.object(monitor.curses, 'wrapper') as wrapper:
                stdout.isatty.return_value = tty
                monitor.main()
                if interactive:
                    wrapper.assert_called_once_with(monitor.dashboard, self.root.resolve(), details)
                    snapshot.assert_not_called()
                else:
                    wrapper.assert_not_called()
                    snapshot.assert_called_once_with(self.root.resolve(), details)
                    stdout.write.assert_any_call('STATIC')

    def test_details_pty_stays_live_refreshes_scrolls_resizes_and_quits(self):
        # A faster clock exercises real curses refreshes without waiting thirty seconds.
        code = """import importlib.util,sys,time,types
spec=importlib.util.spec_from_file_location('monitor',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
calls=0
def snapshot(root,details=False):
 global calls
 calls+=1
 with open(root/'refresh-count.txt','a') as receipt:receipt.write(str(calls)+'\\n')
 return '\\n'.join([f'REFRESH_{calls} summary {n}' for n in range(7)]+[f'DETAIL_ROW_{n:03d} 方法行' for n in range(60)]+['footer'])
m.snapshot=snapshot
clock=time.monotonic;m.time=types.SimpleNamespace(monotonic=lambda:clock()*100)
sys.argv=['monitor.py','--root',sys.argv[2],'--details'];m.main()
"""
        pid, master = pty.fork()
        if pid == 0:
            os.environ['TERM'] = 'xterm-256color'
            os.execv(os.sys.executable, [os.sys.executable, '-B', '-c', code, str(HERE / 'monitor.py'), str(self.root)])
        collected = bytearray()
        exited = False
        def read_until(marker, timeout=5):
            deadline = time.monotonic() + timeout
            while marker not in collected and time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    try:
                        collected.extend(os.read(master, 65536))
                    except OSError:
                        break
            self.assertIn(marker, collected, collected.decode(errors='replace'))
        try:
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
            read_until(b'1-16/60')
            deadline = time.monotonic() + 3
            receipt = self.root / 'refresh-count.txt'
            while len(receipt.read_text().splitlines()) < 2 and time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    collected.extend(os.read(master, 65536))
            self.assertGreaterEqual(len(receipt.read_text().splitlines()), 2)
            self.assertEqual(os.waitpid(pid, os.WNOHANG), (0, 0))
            os.write(master, b'\x1bOF')
            read_until(b'45-60/60')
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 12, 60, 0, 0))
            os.write(master, b'\x1bOH')
            os.write(master, b'q')
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                waited, status = os.waitpid(pid, os.WNOHANG)
                if waited:
                    exited = True
                    self.assertEqual(status, 0)
                    break
                ready, _, _ = select.select([master], [], [], 0.05)
                if ready:
                    try:
                        collected.extend(os.read(master, 65536))
                    except OSError:
                        pass
            self.assertTrue(exited, 'details monitor did not exit on q')
        finally:
            if not exited:
                try:
                    os.write(master, b'q')
                except OSError:
                    pass
            os.close(master)
            if not exited:
                os.waitpid(pid, 0)


if __name__ == '__main__':
    unittest.main()
