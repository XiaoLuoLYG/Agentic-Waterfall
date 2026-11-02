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
  assert.match(SYSTEM_PROMPT,/new IDs/);assert.match(SYSTEM_PROMPT,/actual candidate_index/);
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
    const fixture=input();fixture.observation.environment.sources=[{id:'offline',modes:['search']}];fixture.protocol.max_tool_calls=1;
    let calls=0;const result=await runEpisode(fixture,{acquire:async()=>{throw Error('source_failed');},decide:async()=>{calls++;return decision([action('bad',{ordered_candidate_indices:[9000]}),other]);}});
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

const batchedInput=(budget=20)=>{
  const fixture=input(budget);
  fixture.observation.environment.candidate_pool=fixture.observation.environment.candidate_pool.map((item,i)=>({...item,id:`N${14000+i}`,abstract:'x'.repeat(1200)}));
  return fixture;
};
const batchReply=(observation,context,extra=[])=>({attempt_id:`batch-${context.call_index}`,finish_reason:'stop',content:JSON.stringify(decision([
  action(`rank-${context.call_index}`,{ordered_candidate_indices:observation.environment.candidate_pool.map(item=>item.candidate_index).reverse()}),...extra]))});

test('second batch receives exact index diagnostics, retains the first batch, and commits only the model merge',async()=>{
  const seen=[];let badIndices;
  const result=await runEpisode(batchedInput(),{modelCall:async request=>{
    assert(Buffer.byteLength(JSON.stringify(request.messages))<=100000);
    const {observation,context}=JSON.parse(request.messages[1].content);seen.push([context.batch_stage,context.batch_index]);
    const items=observation.environment.candidate_pool,indices=items.map(item=>item.candidate_index);
    if(context.batch_stage==='rank'&&context.batch_index===1){
      if(!context.previous_batch_error){
        badIndices=[indices[0],indices[0],14273,1];
        return {attempt_id:'bad-batch',content:JSON.stringify(decision([action('bad-batch',{ordered_candidate_indices:badIndices})]))};
      }
      const details=context.previous_batch_error.error_details;
      assert.deepEqual(details.candidate_index_range,[indices[0],indices.at(-1)]);
      assert.deepEqual(details.invalid_indices,[14273,1]);assert.deepEqual(details.duplicate_indices,[indices[0]]);
      assert.equal(details.missing_indices_count,items.length-1);assert.equal(details.received_count,4);
      assert.equal(context.call_index,2);assert.equal(context.previous_batch_error.call_index,1);
    }
    if(context.batch_stage==='merge'){
      assert.equal(context.batch_rankings.length,2);
      assert.deepEqual(context.batch_rankings.flat().sort(),items.map(item=>item.id).sort());
    }
    return batchReply(observation,context);
  }});
  assert.deepEqual(seen,[['rank',0],['rank',1],['rank',1],['merge',undefined]]);
  assert.equal(result.status,'submitted');assert.equal(result.model_request_count,4);assert.equal(result.trace.length,1);
  assert.equal(result.normalizations.filter(repair=>repair.call_index===3&&repair.operation==='candidate_indices_to_ids').length,1);
  assert.deepEqual(result.ordered_item_ids,batchedInput().observation.environment.candidate_pool.map(item=>item.id).reverse());
  assert.equal(result.model_calls[1].error,'invalid_batch_ranking');
  assert.deepEqual(result.model_calls[1].parsed_output.actions[0].arguments.ordered_candidate_indices,badIndices);
  assert.equal(result.model_calls[1].error_details.missing_indices.length,result.model_calls[1].input.environment.candidate_pool.length-1);
});

test('persistent batch ranking errors stop within 20 calls while reserving later stages, without invented output',async()=>{
  const seen=[];
  const result=await runEpisode(batchedInput(),{modelCall:async request=>{
    assert(Buffer.byteLength(JSON.stringify(request.messages))<=100000);
    const {observation,context}=JSON.parse(request.messages[1].content);seen.push([context.batch_stage,context.batch_index]);
    if(context.batch_index===0)return batchReply(observation,context);
    return {attempt_id:`bad-${context.call_index}`,content:JSON.stringify(decision([action(`bad-${context.call_index}`,{ordered_candidate_indices:Array(500).fill('unknown-'.repeat(80))})]))};
  }});
  assert.equal(result.status,'failed');assert.equal(result.error,'batch_model_budget_exhausted');
  assert.equal(seen.length,19);assert.equal(result.model_request_count,19);
  assert.equal(seen.filter(([stage,index])=>stage==='rank'&&index===0).length,1);assert(seen.every(([stage])=>stage==='rank'));
  assert.deepEqual(result.ordered_item_ids,[]);assert.deepEqual(result.pending_queue,[]);assert.equal(result.trace.length,0);
  assert(result.model_calls.slice(1).every(call=>call.error==='invalid_batch_ranking'));
});

test('batch error summaries fit the reserved bytes even for large malformed index strings',async()=>{
  let calls=0,firstSize;
  const result=await runEpisode(batchedInput(4),{modelCall:async request=>{
    assert(Buffer.byteLength(JSON.stringify(request.messages))<=100000);
    const {observation,context}=JSON.parse(request.messages[1].content);
    if(++calls===1){
      firstSize=observation.environment.candidate_pool.length;
      const bad=Array.from({length:4},(_,i)=>String(i)+'\ud800'.repeat(80));
      return {attempt_id:'large-errors',content:JSON.stringify(decision([action('large-errors',{ordered_candidate_indices:[...bad,...bad]})]))};
    }
    if(context.previous_batch_error){
      assert.equal(context.batch_index,0);assert.equal(observation.environment.candidate_pool.length,firstSize);
      assert(Buffer.byteLength(JSON.stringify(context.previous_batch_error))<=1500);
      assert.equal(context.previous_batch_error.error_details.invalid_indices_count,8);
      assert.equal(context.previous_batch_error.error_details.duplicate_indices_count,4);
    }
    return batchReply(observation,context);
  }});
  assert.equal(result.status,'submitted');assert.equal(calls,4);assert.equal(result.model_calls[0].error_details.invalid_indices.length,8);
});

test('JSON truncation and parse errors recover within their batch or merge without rerunning successful batches',async()=>{
  for(const stage of ['rank','merge'])for(const finish_reason of ['length','stop']){
    const seen=[];let failed=false;
    const result=await runEpisode(batchedInput(),{modelCall:async request=>{
      assert(Buffer.byteLength(JSON.stringify(request.messages))<=100000);
      const {observation,context}=JSON.parse(request.messages[1].content);seen.push([context.batch_stage,context.batch_index]);
      if(context.batch_stage===stage&&(stage==='merge'||context.batch_index===1)&&!failed){failed=true;return {attempt_id:'broken',finish_reason,content:'{"actions":['+'DO_NOT_RESEND'.repeat(2000)};}
      if(context.previous_output_error){
        assert.equal(context.previous_output_error.error,finish_reason==='length'?'model_output_truncated':'model_invalid_json');
        assert(request.messages.every(message=>!message.content.includes('DO_NOT_RESEND')));
      }
      return batchReply(observation,context);
    }});
    assert.equal(result.status,'submitted');assert.equal(result.model_request_count,4);assert.equal(result.trace.length,1);
    assert.equal(seen.filter(([s,i])=>s==='rank'&&i===0).length,1);
    assert.equal(seen.filter(([s,i])=>s==='rank'&&i===1).length,stage==='rank'?2:1);
    assert.equal(seen.filter(([s])=>s==='merge').length,stage==='merge'?2:1);
    assert(result.model_calls.some(call=>call.content.includes('DO_NOT_RESEND')&&call.error));
  }
});

test('merge ranking correction retains batches and executes other valid actions only after a valid merge',async()=>{
  let merges=0,updates=0;
  const state={action_id:'state',kind:'update_state',arguments:{base_version:0,edits:[]},depends_on:[],evidence_refs:[]};
  const result=await runEpisode(batchedInput(),{onAction:receipt=>{if(receipt.kind==='update_state')updates++;},modelCall:async request=>{
    const {observation,context}=JSON.parse(request.messages[1].content);
    if(context.batch_stage==='merge'&&++merges===1)return {attempt_id:'bad-merge',content:JSON.stringify(decision([action('bad-merge',{ordered_candidate_indices:[1,1]}),state]))};
    if(context.batch_stage==='merge'){
      assert.equal(updates,0);assert.equal(context.previous_batch_error.error_details.missing_indices_count,100);
      return batchReply(observation,context,[state]);
    }
    return batchReply(observation,context);
  }});
  assert.equal(result.status,'submitted');assert.equal(result.model_request_count,4);assert.equal(updates,1);
  assert.equal(result.state_after.version,1);assert.equal(result.trace.length,1);
});

test('persistent batch and merge format errors cannot restart batches or exceed the original budget',async()=>{
  for(const stage of ['rank','merge']){
    const seen=[];
    const result=await runEpisode(batchedInput(),{modelCall:async request=>{
      const {observation,context}=JSON.parse(request.messages[1].content);seen.push([context.batch_stage,context.batch_index]);
      if(context.batch_stage===stage&&(stage==='merge'||context.batch_index===1))return {attempt_id:`broken-${context.call_index}`,finish_reason:'length',content:'{"actions":['};
      return batchReply(observation,context);
    }});
    assert.equal(result.status,'failed');assert.equal(result.error,'batch_model_budget_exhausted');
    assert.equal(result.model_request_count,stage==='rank'?19:20);assert.equal(seen.filter(([s,i])=>s==='rank'&&i===0).length,1);
    assert.deepEqual(result.ordered_item_ids,[]);assert.equal(result.trace.length,0);
  }
});

test('batch recovery preserves network, state and dependency failures and checks minimum budget before calling',async()=>{
  let calls=0;
  const short=await runEpisode(batchedInput(2),{modelCall:async()=>{calls++;throw new Error('unexpected');}});
  assert.equal(calls,0);assert.equal(short.error,'batch_model_budget_insufficient');
  for(const stage of ['rank','merge']){
    const result=await runEpisode(batchedInput(),{modelCall:async request=>{
      const {observation,context}=JSON.parse(request.messages[1].content);
      if(context.batch_stage===stage&&(stage==='merge'||context.batch_index===1))throw new Error('model_timeout');
      return batchReply(observation,context);
    }});
    assert.equal(result.error,'model_timeout');assert.equal(result.model_calls.length,stage==='rank'?2:3);
  }
  for(const extra of [
    {action_id:'bad-state',kind:'update_state',arguments:{base_version:99,edits:[]},depends_on:[],evidence_refs:[]},
    {action_id:'bad-tool',kind:'acquire',arguments:{source_ids:['offline'],mode:'search',query:'x',limit:1},depends_on:[],evidence_refs:[]},
  ]){
    const fixture=batchedInput();fixture.observation.environment.sources=[{id:'offline',modes:['search']}];fixture.protocol.max_tool_calls=1;
    const result=await runEpisode(fixture,{acquire:async()=>{throw Error('source_failed');},modelCall:async request=>{
      const {observation,context}=JSON.parse(request.messages[1].content);
      return batchReply(observation,context,context.batch_stage==='merge'?[extra]:[]);
    }});
    assert.equal(result.model_request_count,3);assert(result.trace[0].execution_results.some(receipt=>receipt.status==='failed'));
    assert.equal(result.state_after.version,0);
  }
});
