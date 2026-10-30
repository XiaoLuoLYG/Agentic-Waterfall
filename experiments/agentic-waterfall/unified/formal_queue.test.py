import importlib.util,json,pathlib,signal,sys,tempfile,types,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('queue',pathlib.Path(__file__).with_name('formal_queue.py'));queue=importlib.util.module_from_spec(spec);spec.loader.exec_module(queue)

class QueueChecks(unittest.TestCase):
    def test_never_retry_an_uncommitted_paid_attempt(self):
        with tempfile.TemporaryDirectory() as d:
            output=pathlib.Path(d)/'result.json';started=pathlib.Path(d)/'started.json'
            self.assertEqual(queue.result_state(output,started),'pending')
            queue.save(started,{'id':'a'});self.assertEqual(queue.result_state(output,started),'interrupted')
            queue.save(output,{'result':{'status':'failed'}});self.assertEqual(queue.result_state(output,started),'completed')
    def test_transport_error_stops_even_after_partial_submission(self):
        self.assertEqual(queue.infrastructure_failure({'status':'submitted','continuation_error':'model_timeout'}),'model_timeout')
        self.assertEqual(queue.infrastructure_failure({'model_calls':[{'error':'model_http_429'}]}),'model_http_429')
        self.assertIsNone(queue.infrastructure_failure({'status':'failed','error':'invalid_batch_ranking'}))
    def test_agent_corrected_ranking_is_valid_but_unresolved_tools_stop(self):
        trace=[{'execution_results':[{'kind':'recommend','status':'failed','error':'invalid_candidate_indices'}]},{'execution_results':[{'kind':'recommend','status':'success'}]}]
        self.assertIsNone(queue.failure_reason({'status':'submitted','trace':trace}))
        trace[0]['execution_results'][0]={'kind':'update_state','status':'failed','error':'state_evidence_missing'}
        self.assertIsNotNone(queue.failure_reason({'status':'submitted','trace':trace}))

    def test_model_format_failure_requires_a_later_successful_recommendation(self):
        for error in ('model_invalid_json','model_output_truncated','invalid_batch_ranking'):
            for index in (None,0,1,2):
                result={'status':'submitted','model_calls':[{'context':{'call_index':1},'error':error}],
                        'trace':[{'call_index':index,'execution_results':[{'kind':'recommend','status':'success'}]}]}
                self.assertEqual(queue.failure_reason(result),None if index==2 else error)
            result['model_calls'][0]['context']={}
            self.assertEqual(queue.failure_reason(result),error)

    def test_skipped_dependency_is_not_hidden_by_a_later_ranking(self):
        result={'status':'submitted','trace':[{'call_index':0,'execution_results':[
            {'kind':'recommend','status':'failed','error':'invalid_ranking'},
            {'kind':'update_state','status':'skipped','error':'dependency_failed'}]},
            {'call_index':1,'execution_results':[{'kind':'recommend','status':'success'}]}]}
        self.assertIn('skipped_dependency',queue.failure_reason(result))

    def fixture(self,directory):
        run=pathlib.Path(directory)
        for name in ('results','started','logs','task-configs','code','reviewed'):(run/name).mkdir()
        queue.save(run/'plan.json',{'model_config_file':'unused-synthetic-config'})
        tasks=[{'id':name,'dataset':'mind'} for name in ('a','b')]
        (run/'tasks.jsonl').write_text(''.join(json.dumps(t)+'\n' for t in tasks))
        return run,tasks

    def result(self,task,error=None,submitted=False,trace=None):
        status='submitted' if not error or submitted else 'failed'
        result={'decision_id':task['id'],'status':status,'error':error if status=='failed' else None,
                'continuation_error':error if submitted else None,'ordered_item_ids':['x'] if status=='submitted' else [],
                'model_calls':[{'attempt_id':'synthetic-only','context':{'call_index':0},**({'error':error} if error else {})}],
                'model_request_count':1,'duration_ms':1,'state_after':{'version':0,'records':[]},'trace':trace or []}
        return {'task':task,'input':{'observation':{'decision_id':task['id']}},'result':result}

    def execute(self,run,outcomes,stop_in_wait=False,memory=None,env_check=None):
        calls=[];sleeps=[];updates=[];handlers={};original_save=queue.save
        def save(path,value):
            if pathlib.Path(path).name=='progress.json':updates.append(value)
            original_save(path,value)
        def popen(command,**kwargs):
            if env_check:env_check(kwargs['env'])
            task=json.loads(pathlib.Path(command[2]).read_text());calls.append(task['id'])
            outcome=outcomes[len(calls)-1]
            if outcome!='no_result':
                row=outcome if isinstance(outcome,dict) else self.result(task,outcome)
                save(pathlib.Path(command[3]),row)
            kwargs['stdout'].write(f'synthetic attempt {len(calls)}\n');kwargs['stdout'].flush()
            return types.SimpleNamespace(pid=123,returncode=0,poll=lambda:0)
        def sleep(seconds):
            sleeps.append(seconds)
            if stop_in_wait:handlers[signal.SIGTERM](signal.SIGTERM,None)
        with patch.object(sys,'argv',['formal_queue.py','--run-dir',str(run),'--max-new-tasks','1']),\
             patch.object(queue,'save',side_effect=save),patch.object(queue.subprocess,'Popen',side_effect=popen),\
             patch.object(queue.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)),\
             patch.object(queue.signal,'signal',side_effect=lambda sig,fn:handlers.__setitem__(sig,fn)),\
             patch.object(queue.time,'sleep',side_effect=sleep),\
             patch.object(queue.shutil,'disk_usage',return_value=types.SimpleNamespace(free=100*1024**3)),\
             patch.object(queue,'memory_free',side_effect=memory or (lambda:100)):
            queue.main()
        return calls,sleeps,updates,json.loads((run/'progress.json').read_text())

    def test_frozen_model_selection_overrides_inherited_model(self):
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory)
            queue.save(run/'plan.json',{'model_config_file':'unused-synthetic-config','model_name':'DeepSeek-V4.1-Flash-1017'})
            def check_environment(env):
                self.assertEqual(env['OPENAI_MODEL'],'DeepSeek-V4.1-Flash-1017')
                self.assertEqual(env['WATERFALL_MODEL_TIMEOUT_MS'],'180000')
            with patch.dict(queue.os.environ,{'OPENAI_MODEL':'Other-Model'}):
                calls,_,_,progress=self.execute(run,[None],env_check=check_environment)
            self.assertEqual(calls,['a']);self.assertEqual(progress['status'],'preflight_complete')

    def test_transient_failure_recovers_and_preserves_both_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory)
            calls,sleeps,updates,progress=self.execute(run,['model_http_502',None])
            self.assertEqual(calls,['a','a']);self.assertEqual(sum(sleeps),30)
            self.assertEqual(progress['status'],'preflight_complete');self.assertEqual(progress['counts'],{'mind:submitted':1})
            archive=run/'attempts/a/service-attempt-001'
            self.assertEqual(json.loads((archive/'result.json').read_text())['result']['status'],'failed')
            self.assertTrue(all((archive/name).exists() for name in ('started.json','log.txt','receipt.json')))
            self.assertFalse((run/'attempts/a/service-attempt-002').exists())
            self.assertEqual(json.loads((run/'results/a.json').read_text())['result']['status'],'submitted')
            waiting=[u for u in updates if u['status']=='waiting_for_service']
            self.assertEqual([(u['attempt'],u['delay_seconds']) for u in waiting],[(2,30)])

    def test_three_attempt_limit_survives_queue_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory)
            calls,sleeps,_,progress=self.execute(run,['model_http_502','model_timeout','model_http_504'])
            self.assertEqual(len(calls),3);self.assertEqual(sum(sleeps),120)
            self.assertEqual(progress['status'],'needs_attention');self.assertEqual(progress['attempt'],3)
            calls,_,_,progress=self.execute(run,[])
            self.assertEqual(calls,[]);self.assertEqual(progress['attempt'],3)
            self.assertEqual(len(list((run/'attempts/a').glob('service-attempt-*'))),2)
            self.assertEqual(json.loads((run/'results/a.json').read_text())['result']['error'],'model_http_504')

    def test_old_recorded_failure_is_attempt_one(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory)
            queue.save(run/'results/a.json',self.result(tasks[0],'model_http_503'))
            queue.save(run/'started/a.json',{'task':'a'});(run/'logs/a.log').write_text('original paid attempt\n')
            calls,_,_,progress=self.execute(run,[None])
            self.assertEqual(calls,['a']);self.assertEqual(progress['status'],'preflight_complete')
            self.assertEqual((run/'attempts/a/service-attempt-001/log.txt').read_text(),'original paid attempt\n')
            self.assertEqual(json.loads((run/'started/a.json').read_text())['attempt'],2)

    def test_missing_result_and_nontransient_failures_never_retry(self):
        for outcome in ('no_result','model_http_401','model_http_403','model_http_429','model_invalid_json','model_output_truncated','invalid_batch_ranking','bad_dataset','action_execution_failed'):
            with self.subTest(outcome=outcome),tempfile.TemporaryDirectory() as directory:
                run,_=self.fixture(directory)
                calls,sleeps,_,progress=self.execute(run,[outcome])
                self.assertEqual(calls,['a']);self.assertEqual(sleeps,[]);self.assertEqual(progress['status'],'needs_attention')
                if outcome=='no_result':
                    calls,_,_,progress=self.execute(run,[])
                    self.assertEqual(calls,[]);self.assertIn('previous_attempt_without_committed_result',progress['reason'])

    def test_partial_valid_submission_and_tool_failure_do_not_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory)
            row=self.result(tasks[0],'model_timeout',submitted=True)
            calls,_,_,progress=self.execute(run,[row])
            self.assertEqual(calls,['a']);self.assertEqual(progress['status'],'needs_attention')
        result=self.result({'id':'a','dataset':'mind'},'model_http_502',trace=[{'execution_results':[{'kind':'acquire','status':'failed','error':'source_failed'}]}])['result']
        self.assertIsNone(queue.retryable_failure(result))

    def test_batch_failure_after_earlier_submission_requires_a_real_later_merge(self):
        for corrected in (False,True):
            with self.subTest(corrected=corrected),tempfile.TemporaryDirectory() as directory:
                run,tasks=self.fixture(directory);row=self.result(tasks[0]);result=row['result']
                result['model_calls']=[{'context':{'call_index':0}},
                    {'context':{'call_index':2,'batch_stage':'rank','batch_index':0},'error':'invalid_batch_ranking',
                     'error_details':{'error':'invalid_candidate_indices'},'content':'retained invalid batch output'},
                    {'context':{'call_index':3,'batch_stage':'rank','batch_index':0},'content':'valid local batch output'}]
                result['trace']=[{'call_index':0,'execution_results':[{'kind':'recommend','status':'success'}]},
                    {'call_index':1,'execution_results':[{'kind':'acquire','status':'success'}]}]
                if corrected:
                    result['model_calls'].append({'context':{'call_index':4,'batch_stage':'merge'}})
                    result['trace'].append({'call_index':4,'execution_results':[{'kind':'recommend','status':'success'}]})
                calls,sleeps,_,progress=self.execute(run,[row])
                self.assertEqual(calls,['a']);self.assertEqual(sleeps,[])
                self.assertEqual(progress['status'],'preflight_complete' if corrected else 'needs_attention')
                self.assertFalse((run/'attempts').exists())
                if not corrected:
                    self.assertEqual(progress['reason'],'invalid_batch_ranking')
                    calls,_,_,progress=self.execute(run,[])
                    self.assertEqual(calls,[]);self.assertEqual(progress['status'],'needs_attention')

    def test_stop_during_backoff_and_resource_gate_before_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory)
            calls,sleeps,_,progress=self.execute(run,['model_http_502'],stop_in_wait=True)
            self.assertEqual(calls,['a']);self.assertEqual(sum(sleeps),1);self.assertEqual(progress['status'],'stopped')
            self.assertEqual(json.loads((run/'results/a.json').read_text())['result']['error'],'model_http_502')
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory)
            calls,sleeps,updates,progress=self.execute(run,['model_transport_error',None],memory=iter([100,10,100]).__next__)
            self.assertEqual(calls,['a','a']);self.assertEqual(sum(sleeps),60)
            self.assertTrue(any(x['status']=='waiting_for_resources' and x['attempt']==2 for x in updates))

    def test_committed_success_is_not_repeated_and_mismatched_result_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory)
            queue.save(run/'results/a.json',self.result(tasks[0]));queue.save(run/'started/a.json',{'task':'a'});(run/'logs/a.log').write_text('original\n')
            calls,_,_,_=self.execute(run,[None]);self.assertEqual(calls,['b'])
            self.assertFalse((run/'attempts').exists())
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[1],'model_http_502')
            calls,_,_,progress=self.execute(run,[row])
            self.assertEqual(calls,['a']);self.assertEqual(progress['status'],'needs_attention')
            self.assertIn('identity_or_structure',progress['reason'])

    def test_service_retry_preserves_older_manual_attempt_namespace(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory)
            legacy=run/'attempts/a/attempt-001';legacy.mkdir(parents=True)
            (legacy/'results.json').write_text('older core output\n')
            queue.save(run/'results/a.json',self.result(tasks[0],'model_http_502'))
            queue.save(run/'started/a.json',{'task':'a'});(run/'logs/a.log').write_text('current core failure\n')
            calls,_,_,progress=self.execute(run,[None])
            self.assertEqual(calls,['a']);self.assertEqual(progress['status'],'preflight_complete')
            self.assertEqual((legacy/'results.json').read_text(),'older core output\n')
            self.assertEqual((run/'attempts/a/service-attempt-001/log.txt').read_text(),'current core failure\n')
            self.assertEqual(json.loads((run/'started/a.json').read_text())['attempt'],2)
if __name__=='__main__':unittest.main()
