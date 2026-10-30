import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest


SCRIPT = Path(__file__).with_name('run_waterfall_shard.py')
if SCRIPT.exists():
    spec = importlib.util.spec_from_file_location('run_waterfall_shard', SCRIPT)
    wrapper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wrapper)
else:
    wrapper = None


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


class QueueFixture:
    def __init__(self, dispositions=None):
        self.dispositions = dispositions or {}

    def load_validation_dispositions(self, run, plan=None):
        return self.dispositions

    def checked_disposition(self, task, output, dispositions):
        row = dispositions.get(task['id'])
        if row is None:
            return None
        if row['task'] != task['id'] or row['dataset'] != task['dataset']:
            raise ValueError('disposition_identity_mismatch')
        digest = hashlib.sha256(output.read_bytes()).hexdigest() if output.exists() else None
        if digest != row['result_sha256']:
            raise ValueError('disposition_result_mismatch')
        return row['kind']

    def read_committed(self, path, task):
        row = json.loads(path.read_text())
        if row['task'] != task:
            raise ValueError('committed_identity_mismatch')
        return row['result']

    def failure_reason(self, result):
        return result.get('error')

    def retryable_failure(self, result):
        return result.get('error') == 'model_timeout'


class ShardTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(wrapper, 'strict-aware shard wrapper must exist')
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.shard = self.root / 'shards/other'
        self.shard.mkdir(parents=True)
        source = self.root / 'code/runtime.py'
        source.parent.mkdir()
        source.write_text('frozen runtime\n')
        save(self.root / 'source-sha256.json', {'runtime.py': hashlib.sha256(source.read_bytes()).hexdigest()})
        save(self.root / 'plan.json', {'core_sha256': 'core', 'model_name': 'model', 'validation_dispositions_file': 'dispositions.json'})
        self.tasks = []

    def task(self, tid, result=False, error=None, attempt=1):
        task = {'id': tid, 'dataset': 'clawrec'}
        self.tasks.append(task)
        (self.shard / 'tasks.jsonl').write_text(''.join(json.dumps(t) + '\n' for t in self.tasks))
        if result:
            save(self.shard / 'results' / (tid + '.json'), {'task': task, 'result': {
                'status': 'failed' if error else 'submitted', 'error': error,
                'runtime_source_sha256': 'core', 'model_calls': [{'attempt_id': 'call', 'requested_model': 'model'}]}})
            save(self.shard / 'started' / (tid + '.json'), {'attempt': attempt})
        return task

    def disposition(self, task, kind='hold'):
        path = self.shard / 'results' / (task['id'] + '.json')
        return {'task': task['id'], 'dataset': task['dataset'], 'kind': kind,
                'result_sha256': hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None}

    def result(self, task):
        save(self.shard / 'results' / (task['id'] + '.json'), {'task': task, 'result': {
            'status': 'submitted', 'error': None, 'runtime_source_sha256': 'core', 'model_calls': []}})

    def supervisor(self):
        return json.loads((self.shard / 'supervisor.json').read_text())

    def v2_queue(self):
        path=SCRIPT.parents[3]/'experiments/agentic-waterfall/unified/formal_queue.py'
        spec=importlib.util.spec_from_file_location('v2_queue',path);q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
        plan=json.loads((self.root/'plan.json').read_text());plan['method_outcome_policy']='first-complete-episode-v2';save(self.root/'plan.json',plan)
        save(self.shard/'dispositions.json',{'schema_version':1,'tasks':{}})
        return q

    def semantic_outcome(self,task):
        save(self.shard/'results'/(task['id']+'.json'),{'task':task,'input':{'observation':{'decision_id':task['id']}},'result':{
            'decision_id':task['id'],'status':'failed','error':'action_execution_failed','continuation_error':None,'ordered_item_ids':[],
            'state_after':{'version':0,'records':[]},'runtime_source_sha256':'core',
            'model_calls':[{'attempt_id':'retained-call','requested_model':'model','status':'success'}],
            'trace':[{'execution_results':[{'kind':'update_state','status':'failed','error':'state_evidence_missing'}]}]}})

    def test_v2_preflight_excludes_existing_terminal_failure_and_its_pending_descendant(self):
        q=self.v2_queue();parent=self.task('parent');child=self.task('child');child['previous']='parent'
        other=self.task('independent');self.semantic_outcome(parent)
        before=(self.shard/'results/parent.json').read_bytes();calls=[]
        def execute(command):
            calls.append(command);self.result(other)
            row=json.loads((self.shard/'results/independent.json').read_text());row['input']={'observation':{'decision_id':'independent'}}
            row['result']['decision_id']='independent';save(self.shard/'results/independent.json',row)
            save(self.shard/'progress.json',{'status':'method_failures_remaining','blocked_count':1})
            return types.SimpleNamespace(returncode=0)
        self.assertEqual(wrapper.run_shard(self.root,'other',q,execute),'method_failures_remaining')
        self.assertEqual(len(calls),1);self.assertEqual(self.supervisor()['existing'],1)
        self.assertEqual(self.supervisor()['audited_failed'],1);self.assertEqual(self.supervisor()['blocked'],1)
        self.assertEqual((self.shard/'results/parent.json').read_bytes(),before);self.assertFalse((self.shard/'results/child.json').exists())

    def test_v2_new_terminal_outcome_settles_preflight_without_becoming_valid_success(self):
        q=self.v2_queue();task=self.task('only')
        def execute(_):
            self.semantic_outcome(task);save(self.shard/'progress.json',{'status':'predictions_complete'})
            return types.SimpleNamespace(returncode=0)
        self.assertEqual(wrapper.run_shard(self.root,'other',q,execute),'predictions_complete')
        self.assertEqual(self.supervisor()['existing'],0);self.assertEqual(self.supervisor()['audited_failed'],1)
        self.assertEqual(self.supervisor()['preflight_new'],0);self.assertEqual(self.supervisor()['preflight_failed'],1)

    def test_only_holds_report_withheld_without_invoking_queue(self):
        held = self.task('held', result=True, error='state_evidence_missing')
        missing = self.task('pending-held')
        failed = self.task('failed', result=True, error='action_execution_failed', attempt=3)
        q = QueueFixture({t['id']: self.disposition(t, 'failed' if t == failed else 'hold') for t in [held, missing, failed]})
        save(self.shard / 'progress.json', {'status': 'predictions_complete', 'counts': {'clawrec:submitted': 3}})
        status = wrapper.run_shard(self.root, 'other', q, lambda _: self.fail('queue must not be launched'))
        self.assertEqual(status, 'validation_holds_remaining')
        self.assertEqual((self.supervisor()['existing'], self.supervisor()['withheld'], self.supervisor()['audited_failed']), (0, 2, 1))
        progress = json.loads((self.shard / 'progress.json').read_text())
        self.assertEqual(progress['status'], 'validation_holds_remaining')
        self.assertEqual(progress['counts'], {'clawrec:held': 2, 'clawrec:failed': 1})
        self.assertEqual((progress['held_count'], progress['total'], progress['verified_valid'], progress['audited_failed']), (2, 3, 0, 1))
        self.assertIsInstance(progress['pid'], int)
        self.assertTrue(progress['at'])

    def test_short_preflight_accepts_normal_end_and_counts_only_clean_new(self):
        clean = self.task('clean', result=True)
        held = self.task('held', result=True, error='state_evidence_missing')
        pending = [self.task('a'), self.task('b')]
        q = QueueFixture({held['id']: self.disposition(held)})
        calls = []

        def execute(command):
            calls.append(command)
            for task in pending:
                self.result(task)
            save(self.shard / 'progress.json', {'status': 'validation_holds_remaining'})
            return types.SimpleNamespace(returncode=0)

        self.assertEqual(wrapper.run_shard(self.root, 'other', q, execute), 'validation_holds_remaining')
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.supervisor()['preflight_new'], 2)
        self.assertEqual(self.supervisor()['existing'], 3)
        self.assertEqual(self.supervisor()['withheld'], 1)

    def test_full_queue_preserves_hold_terminal_status(self):
        held = self.task('held')
        pending = [self.task(str(i)) for i in range(4)]
        q = QueueFixture({held['id']: self.disposition(held)})
        calls = []

        def execute(command):
            calls.append(command)
            if '--max-new-tasks' in command:
                for task in pending[:3]:
                    self.result(task)
                status = 'preflight_complete'
            else:
                self.result(pending[3])
                status = 'validation_holds_remaining'
            save(self.shard / 'progress.json', {'status': status})
            return types.SimpleNamespace(returncode=0)

        self.assertEqual(wrapper.run_shard(self.root, 'other', q, execute), 'validation_holds_remaining')
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.supervisor()['existing'], 4)
        self.assertEqual(self.supervisor()['withheld'], 1)

    def test_three_task_preflight_requires_three_valid_new_results(self):
        pending = [self.task(str(i)) for i in range(3)]

        def incomplete(_):
            for task in pending[:2]:
                self.result(task)
            save(self.shard / 'progress.json', {'status': 'preflight_complete'})
            return types.SimpleNamespace(returncode=0)

        with self.assertRaises(AssertionError):
            wrapper.run_shard(self.root, 'other', QueueFixture(), incomplete)
        self.assertEqual(self.supervisor()['status'], 'needs_attention')

    def test_holds_do_not_bypass_source_core_or_model_checks(self):
        task = self.task('held', result=True, error='state_evidence_missing')
        path = self.shard / 'results/held.json'
        original = json.loads(path.read_text())
        for field in ['source', 'core', 'model']:
            with self.subTest(field=field):
                row = json.loads(json.dumps(original))
                if field == 'core':
                    row['result']['runtime_source_sha256'] = 'other-core'
                if field == 'model':
                    row['result']['model_calls'][0]['requested_model'] = 'other-model'
                save(path, row)
                source = self.root / 'code/runtime.py'
                source.write_text('changed\n' if field == 'source' else 'frozen runtime\n')
                q = QueueFixture({task['id']: self.disposition(task)})
                with self.assertRaises(AssertionError):
                    wrapper.verify(self.root, self.shard, q)

    def test_retryable_existing_failure_only_before_original_attempt_cap(self):
        task = self.task('retry', result=True, error='model_timeout', attempt=2)
        state = wrapper.verify(self.root, self.shard, QueueFixture(), allow_retryable=True)
        self.assertEqual((state['valid'], state['retryable']), (0, 1))
        save(self.shard / 'started/retry.json', {'attempt': 3})
        with self.assertRaises(AssertionError):
            wrapper.verify(self.root, self.shard, QueueFixture(), allow_retryable=True)

    def test_uncommitted_unheld_started_task_is_not_auto_retried(self):
        self.task('indeterminate')
        save(self.shard / 'started/indeterminate.json', {'attempt': 1})
        with self.assertRaises(ValueError):
            wrapper.run_shard(self.root, 'other', QueueFixture(), lambda _: self.fail('must not retry indeterminate'))
        self.assertEqual(self.supervisor()['status'], 'needs_attention')

    def test_held_result_hash_must_match(self):
        task = self.task('held', result=True, error='state_evidence_missing')
        q = QueueFixture({task['id']: self.disposition(task)})
        with (self.shard / 'results/held.json').open('a') as stream:
            stream.write('\n')
        with self.assertRaisesRegex(ValueError, 'disposition_result_mismatch'):
            wrapper.verify(self.root, self.shard, q)

    def test_uncommitted_archived_attempt_is_not_treated_as_fresh_work(self):
        self.task('archived')
        (self.shard / 'attempts/archived').mkdir(parents=True)
        with self.assertRaises(ValueError):
            wrapper.run_shard(self.root, 'other', QueueFixture(), lambda _: self.fail('must not rerun archived indeterminate task'))
        self.assertEqual(self.supervisor()['status'], 'needs_attention')

    def test_no_holds_normal_completion_with_less_than_three_tasks(self):
        task = self.task('only')

        def execute(_):
            self.result(task)
            save(self.shard / 'progress.json', {'status': 'predictions_complete'})
            return types.SimpleNamespace(returncode=0)

        self.assertEqual(wrapper.run_shard(self.root, 'other', QueueFixture(), execute), 'predictions_complete')
        self.assertEqual(self.supervisor()['preflight_new'], 1)


if __name__ == '__main__':
    unittest.main()
