import test from 'node:test';
import assert from 'node:assert/strict';
import {runEpisode,SYSTEM_PROMPT} from '../../../demos/agentic-feed/waterfall-core.mjs';

const input=(budget=2)=>({observation:{decision_id:'ranking-recovery',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:Array.from({length:101},(_,i)=>({id:`kuairand:${1000+i}`,title:`item ${i}`})),sources:[]}},protocol:{mode:'fixed_candidates',require_full_ranking:true,top_k:101,max_model_calls:budget,max_tool_calls:0}});
const action=(id,args)=>({action_id:id,kind:'recommend',arguments:{...args,delivery:'replace_pending'},evidence_refs:[],depends_on:[]});
const decision=actions=>({decision_id:'ranking-recovery',actions});
const full=Array.from({length:101},(_,i)=>101-i);

test('invalid raw video numbers are reported and the agent independently supplies a complete correction',async()=>{
  let calls=0;
  const result=await runEpisode(input(),{decide:async(obs)=>{
    calls++;
    assert.deepEqual(obs.environment.recommendation_constraints.candidate_index_range,[1,101]);
    assert.equal(obs.environment.recommendation_constraints.candidate_count,101);
    if(calls===1)return decision([action('bad',{ordered_candidate_indices:[1,1059,1]})]);
    const failed=obs.environment.tool_results.find(r=>r.action_id==='bad');
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
  assert.equal(result.trace[0].execution_results[0].status,'failed');
  assert.deepEqual(result.trace[0].decision.actions[0].arguments.ordered_candidate_indices,[1,1059,1]);
  assert.match(SYSTEM_PROMPT,/new action_id/);assert.match(SYSTEM_PROMPT,/raw.*IDs/);
});

test('incomplete and duplicate rankings expose missing and repeated indices without filling them',async()=>{
  for(const [indices,error,duplicates] of [[[1,2],'incomplete_ranking',[]],[[1,1],'invalid_ranking',[1]]]){
    let calls=0;
    const result=await runEpisode(input(),{decide:async obs=>{
      calls++;
      if(calls===1)return decision([action('bad',{ordered_candidate_indices:indices})]);
      const failed=obs.environment.tool_results[0];assert.equal(failed.error,error);
      assert.equal(failed.error_details.received_count,2);assert.equal(failed.error_details.required_count,101);
      assert.deepEqual(failed.error_details.duplicate_indices,duplicates);
      assert.equal(failed.error_details.missing_indices.length,error==='incomplete_ranking'?99:100);
      return decision([action('corrected',{ordered_candidate_indices:full})]);
    }});
    assert.equal(calls,2);assert.equal(result.status,'submitted');assert.equal(result.ordered_item_ids.length,101);
  }
});

test('persistent invalid rankings consume only the existing budget and never fabricate a submission',async()=>{
  let calls=0;
  const result=await runEpisode(input(3),{decide:async()=>decision([action(`bad-${++calls}`,{ordered_candidate_indices:[9000]})])});
  assert.equal(calls,3);assert.equal(result.status,'failed');assert.equal(result.error,'model_call_budget_exhausted_without_submission');
  assert.deepEqual(result.ordered_item_ids,[]);assert.deepEqual(result.pending_queue,[]);
  assert.equal(result.trace.length,3);assert(result.trace.every(step=>step.execution_results[0].error==='invalid_candidate_indices'));
});

test('ranking recovery does not swallow state, tool or dependency failures',async()=>{
  for(const other of [
    {action_id:'state',kind:'update_state',arguments:{base_version:9,edits:[]},depends_on:[],evidence_refs:[]},
    {action_id:'tool',kind:'acquire',arguments:{source_ids:['offline'],mode:'search',query:'x',limit:1},depends_on:[],evidence_refs:[]},
    {...action('dependent',{ordered_candidate_indices:full}),depends_on:['bad']},
  ]){
    let calls=0;const result=await runEpisode(input(),{decide:async()=>{calls++;return decision([action('bad',{ordered_candidate_indices:[9000]}),other]);}});
    assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.error,'action_execution_failed');
    assert.deepEqual(result.ordered_item_ids,[]);assert.equal(result.state_after.version,0);
  }
});

test('a corrected recommendation must use a new action ID',async()=>{
  let calls=0;
  const result=await runEpisode(input(),{decide:async()=>decision([action('same',{ordered_candidate_indices:++calls===1?[9000]:full})])});
  assert.equal(result.status,'failed');assert.equal(result.error,'action_id_reuse_with_different_payload');assert.deepEqual(result.ordered_item_ids,[]);
});

test('truncated or invalid JSON gets a short diagnostic and a fresh agent response',async()=>{
  for(const [finish_reason,expectedError] of [['length','model_output_truncated'],['stop','model_invalid_json']]){
    const broken='{"actions":['+'UNTRUSTED_REPEAT,'.repeat(2000);let calls=0;
    const result=await runEpisode(input(),{modelCall:async request=>{
      calls++;const {observation,context}=JSON.parse(request.messages[1].content);
      assert.deepEqual(observation.environment.recommendation_constraints.allowed_candidate_indices,Array.from({length:101},(_,i)=>i+1));
      assert.equal(context.output_requirements.candidate_count,101);
      assert.match(context.output_requirements.recommendation,/raw numeric video IDs/);
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
