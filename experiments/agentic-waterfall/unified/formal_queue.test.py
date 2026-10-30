import copy,importlib.util,json,pathlib,signal,sys,tempfile,types,unittest
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

    def delivered_with_warning(self,warning):
        result={'status':'submitted','error':None,'ordered_item_ids':['item'],
            'state_after':{'version':1,'records':[]},'candidate_pool_after':[{'id':'item'}],
            'model_calls':[],'trace':[{'execution_results':[
                {'kind':'recommend','status':'success','result':{'queued_item_ids':['item'],'delivery':'replace_pending'}}]}]}
        if warning=='state_evidence_missing':
            result['trace'][0]['execution_results'].insert(0,{'kind':'update_state','status':'failed','error':warning})
        else:result['continuation_error']=warning
        return result

    def test_proven_delivery_survives_rejected_atomic_state_write_and_local_context_limit(self):
        for warning in ('state_evidence_missing','candidate_or_history_too_large','input_byte_budget_exceeded','batch_model_budget_insufficient'):
            with self.subTest(warning=warning):
                result=self.delivered_with_warning(warning);original=copy.deepcopy(result)
                self.assertIsNone(queue.failure_reason(result))
                self.assertEqual(queue.result_warnings(result),[warning])
                self.assertEqual(result,original)
        for broken in ('no_delivery_receipt','mismatched_receipt','not_acquired','invalid_pool','invalid_state','missing_state','transport_error','unknown_tool_error'):
            result=self.delivered_with_warning('state_evidence_missing')
            if broken=='no_delivery_receipt':result['trace'][0]['execution_results'].pop()
            elif broken=='mismatched_receipt':result['trace'][0]['execution_results'][-1]['result']['queued_item_ids']=['other']
            elif broken=='not_acquired':result['candidate_pool_after']=[]
            elif broken=='invalid_pool':result['candidate_pool_after']=['item']
            elif broken=='invalid_state':result['state_after']['version']=None
            elif broken=='missing_state':result['state_after']=None
            elif broken=='transport_error':result['continuation_error']='model_transport_error'
            elif broken=='unknown_tool_error':result['trace'][0]['execution_results'][0]['error']='unknown_error'
            with self.subTest(broken=broken):self.assertIsNotNone(queue.failure_reason(result))

    def test_confirmed_delivery_warning_never_causes_another_paid_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0]);row['result'].update(self.delivered_with_warning('state_evidence_missing'))
            calls,sleeps,_,progress=self.execute(run,[row])
            self.assertEqual(calls,['a']);self.assertEqual(sleeps,[]);self.assertEqual(progress['status'],'preflight_complete')
            self.assertFalse((run/'attempts').exists())
    def test_agent_corrected_ranking_is_valid_but_unresolved_tools_stop(self):
        trace=[{'execution_results':[{'kind':'recommend','status':'failed','error':'invalid_candidate_indices'}]},{'execution_results':[{'kind':'recommend','status':'success'}]}]
        self.assertIsNone(queue.failure_reason({'status':'submitted','trace':trace}))
        trace[0]['execution_results'][0]={'kind':'update_state','status':'failed','error':'state_evidence_missing'}
        self.assertIsNotNone(queue.failure_reason({'status':'submitted','trace':trace}))

    def test_model_format_failure_requires_a_later_successful_recommendation(self):
        for error in ('model_invalid_json','model_output_truncated','invalid_batch_ranking','action_id_reuse_with_different_payload','action_id_already_in_progress'):
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

    def corrected_dependency_trace(self):
        return [
            {'call_index':0,'decision':{'actions':[{'action_id':'state','kind':'update_state','depends_on':[]}]},
             'execution_results':[{'action_id':'state','kind':'update_state','status':'success'}]},
            {'call_index':2,'decision':{'actions':[{'action_id':'bad','kind':'recommend','depends_on':['state']}]},
             'execution_results':[{'action_id':'bad','kind':'recommend','status':'failed','error':'too_many_recommendations'}]},
            {'call_index':3,'decision':{'actions':[{'action_id':'blocked','kind':'recommend','depends_on':['state','bad']}]},
             'execution_results':[{'action_id':'blocked','kind':'recommend','status':'skipped','error':'dependency_failed'}]},
            {'call_index':4,'decision':{'actions':[{'action_id':'final','kind':'recommend','depends_on':['state']}]},
             'execution_results':[{'action_id':'final','kind':'recommend','status':'success'}]}]

    def test_corrected_recommendation_dependency_reuses_committed_result(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0],trace=self.corrected_dependency_trace())
            row['result']['model_calls']=[{'context':{'call_index':1},'error':'action_id_reuse_with_different_payload'}]
            self.assertIsNone(queue.failure_reason(row['result']))
            queue.save(run/'results/a.json',row);queue.save(run/'started/a.json',{'task':'a','attempt':1})
            (run/'logs/a.log').write_text('already paid and corrected\n');original=(run/'results/a.json').read_bytes()
            calls,sleeps,_,progress=self.execute(run,[None],predictions_only=True)
            self.assertEqual(calls,['b']);self.assertEqual(sleeps,[]);self.assertEqual(progress['status'],'predictions_complete')
            self.assertEqual((run/'results/a.json').read_bytes(),original);self.assertFalse((run/'attempts').exists())

    def test_dependency_recovery_requires_known_recommendation_ancestors_and_later_success(self):
        result={'status':'submitted','trace':self.corrected_dependency_trace()}
        for mutation in ('no_later_success','unknown_dependency','cyclic_dependency','skipped_state','source_failure','unknown_failure'):
            broken=copy.deepcopy(result)
            if mutation=='no_later_success':broken['trace'].pop()
            elif mutation=='unknown_dependency':broken['trace'][2]['decision']['actions'][0]['depends_on']=['missing']
            elif mutation=='cyclic_dependency':broken['trace'][2]['decision']['actions'][0]['depends_on']=['blocked']
            elif mutation=='skipped_state':broken['trace'][2]['execution_results'][0]['kind']='update_state'
            elif mutation=='source_failure':broken['trace'][1]['execution_results'][0]['kind']='acquire'
            elif mutation=='unknown_failure':broken['trace'][1]['execution_results'][0]['error']='unknown_error'
            with self.subTest(mutation=mutation):self.assertIsNotNone(queue.failure_reason(broken))
        blocked=copy.deepcopy(result['trace'][2]);blocked['call_index']=4
        blocked['decision']['actions'][0].update(action_id='blocked-again',depends_on=['blocked'])
        blocked['execution_results'][0]['action_id']='blocked-again';result['trace'].insert(3,blocked)
        self.assertIsNone(queue.failure_reason(result))

    def test_state_evidence_failure_requires_seen_error_and_later_successful_update(self):
        failed={'action_id':'bad-state','kind':'update_state','status':'failed','error':'state_evidence_missing'}
        update={'kind':'update_state','status':'success'}
        recommend={'kind':'recommend','status':'success'}
        result={'status':'submitted','model_calls':[{'context':{'call_index':1},'input':{'environment':{'tool_results':[failed]}}}],
                'trace':[{'call_index':0,'execution_results':[failed]}, {'call_index':1,'execution_results':[update,recommend]}]}
        self.assertIsNone(queue.failure_reason(result))
        result['model_calls'][0]['input']['environment']['tool_results']=[]
        self.assertEqual(queue.failure_reason(result),'failed_tool_action; inspect before continuing')
        result['model_calls'][0]['input']['environment']['tool_results']=[failed]
        result['trace'][1]['execution_results']=[recommend]
        self.assertEqual(queue.failure_reason(result),'failed_tool_action; inspect before continuing')

    def test_acquisition_refusal_is_never_hidden_by_a_later_recommendation(self):
        for error in ('tool_budget_exhausted','unique_acquisition_budget_exhausted'):
            failed={'action_id':'over-limit','kind':'acquire','status':'failed','error':error}
            result={'status':'submitted','model_calls':[{'context':{'call_index':1},'input':{'environment':{'tool_results':[failed]}}}],
                    'trace':[{'call_index':0,'execution_results':[failed]}, {'call_index':1,'execution_results':[{'kind':'recommend','status':'success'}]}]}
            self.assertEqual(queue.failure_reason(result),'failed_tool_action; inspect before continuing')
            result['model_calls'][0]['input']['environment']['tool_results']=[]
            self.assertEqual(queue.failure_reason(result),'failed_tool_action; inspect before continuing')
            result['model_calls'][0]['input']['environment']['tool_results']=[failed]
            result['trace'][1]['execution_results']=[]
            self.assertEqual(queue.failure_reason(result),'failed_tool_action; inspect before continuing')

    def test_acquisition_failure_is_retried_even_after_partial_submission(self):
        result={'status':'submitted','ordered_item_ids':['a'],'model_calls':[],
                'trace':[{'execution_results':[{'kind':'acquire','status':'failed','error':'unique_acquisition_budget_exhausted'}]}]}
        self.assertEqual(queue.retryable_failure(result),'acquisition_failed:unique_acquisition_budget_exhausted')
        result['model_calls']=[{'error':'model_http_403'}]
        self.assertIsNone(queue.retryable_failure(result))

    def test_missing_state_evidence_failure_is_retried_but_infrastructure_is_not(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0],'action_execution_failed');result=row['result']
            result['model_calls']=[]
            result['trace']=[{'execution_results':[{'kind':'update_state','status':'failed','error':'state_evidence_missing'},{'kind':'recommend','status':'skipped','error':'dependency_failed'}]}]
            self.assertEqual(queue.retryable_failure(result),'state_evidence_missing')
            result['model_calls']=[{'error':'model_http_403'}];self.assertIsNone(queue.retryable_failure(result));result['model_calls']=[]
            calls,_,_,progress=self.execute(run,[row,None]);self.assertEqual(calls,['a','a']);self.assertEqual(progress['status'],'preflight_complete')
            self.assertEqual(json.loads((run/'attempts/a/service-attempt-001/result.json').read_text())['result']['error'],'action_execution_failed')

    def test_submitted_recommendation_with_failed_state_is_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0]);row['result']['trace']=[{'execution_results':[
                {'kind':'update_state','status':'failed','error':'state_evidence_missing'},
                {'kind':'recommend','status':'success'}]}]
            self.assertEqual(queue.failure_reason(row['result']),'failed_tool_action; inspect before continuing')
            calls,_,_,progress=self.execute(run,[row,None]);self.assertEqual(calls,['a','a']);self.assertEqual(progress['status'],'preflight_complete')
            self.assertEqual(json.loads((run/'attempts/a/service-attempt-001/result.json').read_text())['result']['status'],'submitted')

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

    def execute(self,run,outcomes,stop_in_wait=False,memory=None,env_check=None,predictions_only=False,command_check=None):
        calls=[];sleeps=[];updates=[];handlers={};original_save=queue.save
        def save(path,value):
            if pathlib.Path(path).name=='progress.json':updates.append(value)
            original_save(path,value)
        def popen(command,**kwargs):
            if env_check:env_check(kwargs['env'])
            if command_check:command_check(command)
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
        with patch.object(sys,'argv',['formal_queue.py','--run-dir',str(run),'--max-new-tasks','1']+(['--predictions-only'] if predictions_only else [])),\
             patch.object(queue,'save',side_effect=save),patch.object(queue.subprocess,'Popen',side_effect=popen),\
             patch.object(queue.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)),\
             patch.object(queue.signal,'signal',side_effect=lambda sig,fn:handlers.__setitem__(sig,fn)),\
             patch.object(queue.time,'sleep',side_effect=sleep),\
             patch.object(queue.shutil,'disk_usage',return_value=types.SimpleNamespace(free=100*1024**3)),\
             patch.object(queue,'memory_free',side_effect=memory or (lambda:100)):
            queue.main()
        return calls,sleeps,updates,json.loads((run/'progress.json').read_text())

    def test_prediction_shard_never_scores_before_other_shards_finish(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);(run/'tasks.jsonl').write_text(json.dumps(tasks[0])+'\n')
            calls,_,_,progress=self.execute(run,[None],predictions_only=True)
            self.assertEqual(calls,['a']);self.assertEqual(progress['status'],'predictions_complete')

    def test_task_entrypoint_resolves_shared_code_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory);(run/'code').rename(run/'shared-code');(run/'code').symlink_to(run/'shared-code',target_is_directory=True)
            def check(command):
                self.assertEqual(command[1],str((run/'shared-code/experiments/agentic-waterfall/unified/formal_task.mjs').resolve()))
            self.execute(run,[None],command_check=check)

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

    def test_acquisition_failure_preserves_submitted_attempt_and_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0]);row['result']['trace']=[{'execution_results':[{'kind':'acquire','status':'failed','error':'unique_acquisition_budget_exhausted'}]}]
            calls,_,_,progress=self.execute(run,[row,None])
            self.assertEqual(calls,['a','a']);self.assertEqual(progress['status'],'preflight_complete')
            archived=json.loads((run/'attempts/a/service-attempt-001/result.json').read_text())['result']
            self.assertEqual(archived['status'],'submitted');self.assertEqual(archived['trace'][0]['execution_results'][0]['status'],'failed')

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
        for outcome in ('no_result','model_http_401','model_http_403','model_invalid_json','model_output_truncated','invalid_batch_ranking','bad_dataset','action_execution_failed'):
            with self.subTest(outcome=outcome),tempfile.TemporaryDirectory() as directory:
                run,_=self.fixture(directory)
                calls,sleeps,_,progress=self.execute(run,[outcome])
                self.assertEqual(calls,['a']);self.assertEqual(sleeps,[]);self.assertEqual(progress['status'],'needs_attention')
                if outcome=='no_result':
                    calls,_,_,progress=self.execute(run,[])
                    self.assertEqual(calls,[]);self.assertIn('previous_attempt_without_committed_result',progress['reason'])

    def test_committed_initial_byte_overflow_retries_with_existing_three_attempt_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0],'input_byte_budget_exceeded')
            row['result'].update(model_request_count=0,tool_calls=0,model_calls=[])
            self.assertEqual(queue.retryable_failure(row['result']),'input_byte_budget_exceeded')
            calls,sleeps,_,progress=self.execute(run,[row,row,row])
            self.assertEqual(calls,['a','a','a']);self.assertEqual(sum(sleeps),120)
            self.assertEqual(progress['status'],'needs_attention');self.assertEqual(progress['attempt'],3)
            self.assertEqual(json.loads((run/'attempts/a/service-attempt-001/result.json').read_text()),row)
            calls,_,_,progress=self.execute(run,[])
            self.assertEqual(calls,[]);self.assertEqual(progress['attempt'],3)

    def test_byte_overflow_never_retries_paid_side_effectful_or_incomplete_results(self):
        result=self.result({'id':'a','dataset':'mind'},'input_byte_budget_exceeded')['result']
        result.update(model_request_count=0,tool_calls=0,model_calls=[])
        for key,value in [('model_request_count',1),('tool_calls',1),('model_calls',[{'attempt_id':'paid'}]),
                          ('trace',[{'execution_results':[{'kind':'acquire','status':'success'}]}]),
                          ('ordered_item_ids',['x']),('continuation_error','model_timeout'),('status','submitted'),
                          ('model_request_count',False),('tool_calls',False)]:
            with self.subTest(key=key,value=value):
                unsafe=copy.deepcopy(result);unsafe[key]=value
                self.assertIsNone(queue.retryable_failure(unsafe))
        for key in ('model_request_count','tool_calls','model_calls','trace','ordered_item_ids'):
            with self.subTest(missing=key):
                incomplete=copy.deepcopy(result);del incomplete[key]
                self.assertIsNone(queue.retryable_failure(incomplete))

    def test_transient_429_retries_but_explicit_quota_refusal_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            run,_=self.fixture(directory)
            calls,sleeps,_,progress=self.execute(run,['model_http_429',None])
            self.assertEqual(calls,['a','a']);self.assertEqual(sum(sleeps),30)
            self.assertEqual(progress['status'],'preflight_complete')
            self.assertEqual(json.loads((run/'attempts/a/service-attempt-001/result.json').read_text())['result']['error'],'model_http_429')
        result=self.result({'id':'a','dataset':'mind'},'model_http_429')['result']
        result['model_calls']=[{'error':'model_http_429','http_error':{'retryable':False,'code':'insufficient_quota'}}]
        self.assertIsNone(queue.retryable_failure(result))

    def test_rejected_response_then_throttle_replays_only_failed_task(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0],'model_http_429')
            row['result']['model_calls']=[{'status':'success','error':'action_id_reuse_with_different_payload'},
                                         {'status':'failed','error':'model_http_429','http_error':{'retryable':True}}]
            row['result']['trace']=[{'execution_results':[{'kind':'acquire','status':'success'}]}]
            calls,sleeps,_,progress=self.execute(run,[row,None])
            self.assertEqual(calls,['a','a']);self.assertEqual(sum(sleeps),30)
            self.assertEqual(progress['status'],'preflight_complete')
            old=json.loads((run/'attempts/a/service-attempt-001/result.json').read_text())
            self.assertEqual(old['result']['model_calls'][0]['error'],'action_id_reuse_with_different_payload')

    def test_wrong_decision_id_can_retry_without_accepting_or_filling_output(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0],'invalid_decision')
            row['result']['model_calls']=[{'status':'success','error':'action_id_reuse_with_different_payload'},
                                         {'status':'success','parsed_output':{'decision_id':'wrong','actions':[]}}]
            self.assertEqual(queue.retryable_failure(row['result']),'invalid_decision')
            calls,_,_,progress=self.execute(run,[row,None])
            self.assertEqual(calls,['a','a']);self.assertEqual(progress['status'],'preflight_complete')
        for forbidden in ('model_http_403','unknown_error'):
            row['result']['model_calls'].append({'error':forbidden})
            self.assertIsNone(queue.retryable_failure(row['result']))
            row['result']['model_calls'].pop()
        row['result']['trace']=[{'execution_results':[{'kind':'update_state','status':'failed','error':'unknown_error'}]}]
        self.assertIsNone(queue.retryable_failure(row['result']))

    def test_mixed_state_and_response_rejections_preserve_the_failed_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            run,tasks=self.fixture(directory);row=self.result(tasks[0],'invalid_decision')
            row['result']['model_calls']=[{'status':'success'},
                {'status':'success','error':'action_id_reuse_with_different_payload'}, {'status':'success'}]
            row['result']['trace']=[{'execution_results':[
                {'kind':'update_state','status':'failed','error':'state_evidence_missing'},
                {'kind':'acquire','status':'success'}]}]
            self.assertEqual(queue.retryable_failure(row['result']),'state_evidence_missing')
            calls,_,_,progress=self.execute(run,[row,None])
            self.assertEqual(calls,['a','a']);self.assertEqual(progress['status'],'preflight_complete')
            saved=json.loads((run/'attempts/a/service-attempt-001/result.json').read_text())
            self.assertEqual(saved,row)
        for error in ('model_http_401','model_http_403','unknown_error'):
            row['result']['model_calls'].append({'error':error})
            self.assertIsNone(queue.retryable_failure(row['result']))
            row['result']['model_calls'].pop()
        row['result']['trace'][0]['execution_results'].append({'kind':'respond','status':'failed','error':'unknown_error'})
        self.assertIsNone(queue.retryable_failure(row['result']))

    def test_mixed_state_and_transient_errors_still_refuse_explicit_quota_rejection(self):
        result=self.result({'id':'a','dataset':'synthetic'},'model_http_429',trace=[{'execution_results':[
            {'kind':'update_state','status':'failed','error':'state_evidence_missing'},
            {'kind':'recommend','status':'skipped','error':'dependency_failed'}]}])['result']
        result['model_calls'][0]['http_error']={'retryable':True}
        self.assertEqual(queue.retryable_failure(result),'model_http_429')
        result['model_calls'][0]['http_error']['retryable']=False
        self.assertIsNone(queue.retryable_failure(result))

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
