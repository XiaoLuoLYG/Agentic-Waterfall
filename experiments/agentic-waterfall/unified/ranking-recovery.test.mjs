import test from 'node:test';
import assert from 'node:assert/strict';
import {runEpisode,SYSTEM_PROMPT} from '../../../demos/agentic-feed/waterfall-core.mjs';

const input=(budget=2)=>({observation:{decision_id:'ranking-recovery',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:Array.from({length:101},(_,i)=>({id:`kuairand:${1000+i}`,title:`item ${i}`})),sources:[]}},protocol:{mode:'fixed_candidates',require_full_ranking:true,top_k:101,max_model_calls:budget,max_tool_calls:0}});
const action=(id,args)=>({action_id:id,kind:'recommend',arguments:{...args,delivery:'replace_pending'},evidence_refs:[],depends_on:[]});
const decision=actions=>({decision_id:'ranking-recovery',actions});
const full=Array.from({length:101},(_,i)=>101-i);

test('malformed decision envelopes and dependencies are rejected before dispatch and can be corrected',async()=>{
  const valid=action('rank',{ordered_candidate_indices:full});
  for(const [bad,error] of [
    [{decision_id:'misspelled-task',actions:[valid]},'invalid_decision'],
    [decision([null]),'invalid_actions'],
    [decision([{...valid,depends_on:['missing']}]),'invalid_dependency'],
    [decision([{...valid,action_id:'a',depends_on:['b']},{...valid,action_id:'b',depends_on:['a']}]),'dependency_cycle'],
  ]){
    let calls=0,executed=0;
    const result=await runEpisode(input(),{onAction:()=>executed++,decide:async(observation,context)=>{
      if(++calls===1)return bad;
      assert.equal(executed,0);assert.equal(context.previous_output_error.error,error);
      if(error==='invalid_decision')assert.equal(context.previous_output_error.error_details.expected_decision_id,'ranking-recovery');
      return decision([{...valid,action_id:'corrected'}]);
    }});
    assert.equal(calls,2);assert.equal(result.status,'submitted');assert.equal(result.model_calls[0].error,error);assert.equal(result.trace.length,1);
  }
});

test('invalid raw video numbers are reported and the agent independently supplies a complete correction',async()=>{
  let calls=0;
  const result=await runEpisode(input(),{decide:async(obs,context)=>{
    calls++;
    assert.deepEqual(obs.environment.recommendation_constraints.candidate_index_range,[1,101]);
    assert.equal(obs.environment.recommendation_constraints.candidate_count,101);
    if(calls===1)return decision([action('bad',{ordered_candidate_indices:[1,1059,1]})]);
    assert.deepEqual(obs.environment.tool_results,[]);
    const failed=context.previous_output_error;
    assert.equal(failed.error,'invalid_candidate_indices');
    assert.deepEqual(failed.error_details.candidate_index_range,[1,101]);
    assert.equal(failed.error_details.received_count,3);
    assert.deepEqual(failed.error_details.invalid_indices,[1059]);
    assert.deepEqual(failed.error_details.duplicate_indices,[1]);
    assert.deepEqual(failed.error_details.missing_indices,Array.from({length:100},(_,i)=>i+2));
    return decision([action('corrected',{ordered_candidate_indices:full})]);
  }});
  assert.equal(calls,2);assert.equal(result.status,'submitted');
  assert.deepEqual(result.ordered_item_ids,full.map(i=>`kuairand:${999+i}`));
  assert.deepEqual(result.model_calls[0].parsed_output.actions[0].arguments.ordered_candidate_indices,[1,1059,1]);
  assert.equal(result.model_calls[0].error,'invalid_candidate_indices');
  assert.equal(result.trace.length,1);assert.equal(result.trace[0].execution_results[0].status,'success');
  assert.equal(result.trace[0].decision.actions[0].action_id,'corrected');assert.equal(result.tool_calls,0);
  assert.match(SYSTEM_PROMPT,/new IDs/);assert.match(SYSTEM_PROMPT,/actual candidate_index/);
});

test('incomplete and duplicate rankings expose missing and repeated indices without filling them',async()=>{
  for(const [indices,error,duplicates] of [[[1,2],'incomplete_ranking',[]],[[1,1],'invalid_ranking',[1]]]){
    let calls=0;
    const result=await runEpisode(input(),{decide:async(obs,context)=>{
      calls++;
      if(calls===1)return decision([action('bad',{ordered_candidate_indices:indices})]);
      assert.deepEqual(obs.environment.tool_results,[]);
      const failed=context.previous_output_error;assert.equal(failed.error,error);
      assert.equal(failed.error_details.received_count,2);assert.equal(failed.error_details.required_count,101);
      assert.deepEqual(failed.error_details.duplicate_indices,duplicates);
      assert.equal(failed.error_details.missing_indices.length,error==='incomplete_ranking'?99:100);
      return decision([action('corrected',{ordered_candidate_indices:full})]);
    }});
    assert.equal(calls,2);assert.equal(result.status,'submitted');
    assert.deepEqual(result.ordered_item_ids,full.map(i=>`kuairand:${999+i}`));
    assert.equal(result.model_calls[0].error,error);
    assert.deepEqual(result.model_calls[0].parsed_output.actions[0].arguments.ordered_candidate_indices,indices);
    assert.equal(result.trace.length,1);assert.equal(result.tool_calls,0);
  }
});

test('persistent invalid rankings consume only the existing budget and never fabricate a submission',async()=>{
  let calls=0;
  const result=await runEpisode(input(3),{decide:async()=>decision([action(`bad-${++calls}`,{ordered_candidate_indices:[9000]})])});
  assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.error,'model_call_budget_exhausted_without_submission');
  assert.deepEqual(result.ordered_item_ids,[]);assert.deepEqual(result.pending_queue,[]);
  assert.equal(result.trace.length,0);assert.equal(result.model_calls.length,3);assert.equal(result.tool_calls,0);
  assert(result.model_calls.every(call=>call.error==='invalid_candidate_indices'));
  assert(result.model_calls.every(call=>JSON.stringify(call.parsed_output.actions[0].arguments.ordered_candidate_indices)==='[9000]'));
  assert.equal(result.state_after.version,0);
});

test('ranking recovery does not swallow state, tool or dependency failures in otherwise valid decisions',async()=>{
  const badState={action_id:'state',kind:'update_state',arguments:{base_version:9,edits:[]},depends_on:[],evidence_refs:[]};
  const badTool={action_id:'tool',kind:'acquire',arguments:{source_ids:['offline'],mode:'search',query:'x',limit:1},depends_on:[],evidence_refs:[]};
  for(const [actions,error] of [
    [[badState],'state_version_conflict'],
    [[badTool],'source_failed'],
    [[badState,{...action('dependent',{ordered_candidate_indices:full}),depends_on:['state']}],'state_version_conflict'],
  ]){
    const fixture=input();fixture.observation.environment.sources=[{id:'offline',modes:['search']}];fixture.protocol.max_tool_calls=1;
    let calls=0,acquires=0,executed=0;
    const result=await runEpisode(fixture,{onAction:()=>executed++,acquire:async()=>{acquires++;throw Error('source_failed');},decide:async(obs,context)=>{
      if(++calls===1)return decision([action('bad',{ordered_candidate_indices:[9000]}),...actions]);
      assert.equal(executed,0);assert.equal(acquires,0);assert.equal(obs.user_state.version,0);
      assert.deepEqual(obs.environment.tool_results,[]);assert.equal(context.previous_output_error.error,'invalid_candidate_indices');
      return decision(actions);
    }});
    assert.equal(calls,2);assert.equal(result.status,'failed');assert.equal(result.error,'action_execution_failed');
    assert.deepEqual(result.ordered_item_ids,[]);assert.equal(result.state_after.version,0);
    assert.equal(result.model_calls[0].error,'invalid_candidate_indices');
    assert.deepEqual(result.model_calls[0].parsed_output.actions[0].arguments.ordered_candidate_indices,[9000]);
    assert.equal(result.trace.length,1);assert.equal(result.trace[0].execution_results[0].error,error);
    assert.equal(result.model_calls[1].execution_errors[0].error,error);
    assert.equal(result.tool_calls,error==='source_failed'?1:0);
    if(actions.length>1)assert.equal(result.trace[0].execution_results[1].error,'dependency_failed');
  }
});

test('a recommendation already dispatched after acquisition cannot change payload under the same action ID',async()=>{
  const fixture=input();fixture.observation.environment.sources=[{id:'offline',modes:['search']}];fixture.protocol.max_tool_calls=1;
  let calls=0,acquires=0;
  const result=await runEpisode(fixture,{acquire:async()=>{acquires++;return {items:[],actual_requests:1};},decide:async obs=>{
    const rank={...action('same',{ordered_candidate_indices:++calls===1?[9000]:full}),depends_on:['get']};
    if(calls===1)return decision([{action_id:'get',kind:'acquire',arguments:{source_ids:['offline'],mode:'search',query:'x',limit:1},evidence_refs:[],depends_on:[]},rank]);
    assert.equal(obs.environment.tool_results.find(receipt=>receipt.action_id==='same').error,'invalid_candidate_indices');
    return decision([rank]);
  }});
  assert.equal(calls,2);assert.equal(acquires,1);assert.equal(result.tool_calls,1);
  assert.equal(result.status,'failed');assert.equal(result.error,'action_id_reuse_with_different_payload');assert.deepEqual(result.ordered_item_ids,[]);
  assert.equal(result.trace.length,1);assert.equal(result.trace[0].execution_results[1].error,'invalid_candidate_indices');
  assert.deepEqual(result.model_calls[0].parsed_output.actions[1].arguments.ordered_candidate_indices,[9000]);
  assert.equal(result.model_calls[1].error,'action_id_reuse_with_different_payload');
});

test('truncated or invalid JSON gets a short diagnostic and a fresh agent response',async()=>{
  for(const [finish_reason,expectedError] of [['length','model_output_truncated'],['stop','model_invalid_json']]){
    const broken='{"actions":['+'UNTRUSTED_REPEAT,'.repeat(2000);let calls=0;
    const result=await runEpisode(input(),{modelCall:async request=>{
      calls++;const {observation,context}=JSON.parse(request.messages[1].content);
      assert.deepEqual(observation.environment.recommendation_constraints.allowed_candidate_indices,Array.from({length:101},(_,i)=>i+1));
      assert.equal(context.output_requirements.candidate_count,101);
      assert.match(context.output_requirements.recommendation,/Use only allowed_candidate_indices/);
      if(calls===1)return {attempt_id:'broken',finish_reason,content:broken};
      assert.equal(context.previous_output_error.error,expectedError);
      assert(request.messages.every(message=>!message.content.includes('UNTRUSTED_REPEAT')));
      return {attempt_id:'correct',finish_reason:'stop',content:JSON.stringify(decision([action('corrected',{ordered_candidate_indices:full})]))};
    }});
    assert.equal(calls,2);assert.equal(result.status,'submitted');assert.equal(result.ordered_item_ids.length,101);
    assert.equal(result.model_calls[0].error,expectedError);assert.equal(result.model_calls[0].content,broken);
    assert.equal(result.trace.length,1);assert.equal(result.model_request_count,2);
  }
});

test('persistent truncation remains bounded and network errors are never retried as formatting',async()=>{
  let calls=0;
  const result=await runEpisode(input(3),{modelCall:async()=>({attempt_id:`truncated-${++calls}`,finish_reason:'length',content:'{"actions":['})});
  assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.error,'model_call_budget_exhausted_without_submission');
  assert.deepEqual(result.ordered_item_ids,[]);assert(result.model_calls.every(call=>call.error==='model_output_truncated'));
  calls=0;
  const network=await runEpisode(input(3),{modelCall:async()=>{calls++;throw new Error('model_timeout');}});
  assert.equal(calls,1);assert.equal(network.status,'failed');assert.equal(network.error,'model_timeout');
});

test('large-input ranking correction retains complete candidate bodies on every request',async()=>{
 const fixture=input();for(const item of fixture.observation.environment.candidate_pool)item.abstract='x'.repeat(1500)+' END';
 let calls=0;
 const result=await runEpisode(fixture,{modelCall:async request=>{
  calls++;const {observation,context}=JSON.parse(request.messages[1].content);
  assert.equal(context.batch_stage,undefined);assert.equal(observation.environment.candidate_pool.length,101);
  assert(observation.environment.candidate_pool.every(item=>item.abstract==='x'.repeat(1500)+' END'));
  return {content:JSON.stringify(decision([action('rank-'+calls,{ordered_candidate_indices:calls===1?[999]:full})]))};
 }});
 assert.equal(result.status,'submitted');assert.equal(calls,2);assert.equal(result.ordered_item_ids.length,101);
 assert.equal(result.model_calls[0].error,'invalid_candidate_indices');
 assert.deepEqual(result.model_calls[0].parsed_output.actions[0].arguments.ordered_candidate_indices,[999]);
 assert.deepEqual(result.ordered_item_ids,full.map(i=>`kuairand:${999+i}`));
 assert.equal(result.trace.length,1);assert.equal(result.trace[0].execution_results[0].status,'success');
 assert.equal(result.tool_calls,0);
});
