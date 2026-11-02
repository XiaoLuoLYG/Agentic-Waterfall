import test from 'node:test';
import assert from 'node:assert/strict';
import {runEpisode} from '../../../demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs';

test('invalid recommendations reject the whole proposed decision before state mutation and retain diagnostics',async()=>{
 const input={observation:{decision_id:'contract',user_id:'u',behavior_events:[{id:'view',type:'play'}],user_state:{version:0,records:[]},environment:{candidate_pool:[{id:'1001'},{id:'1002'}],sources:[]}},protocol:{mode:'fixed_candidates',top_k:2,require_full_ranking:true,max_model_calls:2}};
 let calls=0;
 const result=await runEpisode(input,{decide:async(obs,context)=>{
  calls++;
  if(calls===1)return {decision_id:'contract',actions:[{action_id:'state',kind:'update_state',arguments:{base_version:0,edits:[{op:'upsert',record:{id:'pref',kind:'preference',key:'topic',value:'robots',scope:'user',scope_id:'u',status:'active',basis:'inferred',evidence_refs:['view']}}]},evidence_refs:['view'],depends_on:[]},{action_id:'bad',kind:'recommend',arguments:{ordered_candidate_indices:[1001,1002],delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]};
  assert.equal(obs.user_state.version,0,'invalid response must not partly update memory');
  assert.equal(context.previous_output_error.error,'invalid_candidate_indices');
  return {decision_id:'contract',actions:[{action_id:'corrected',kind:'recommend',arguments:{ordered_candidate_indices:[2,1],delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]};
 }});
 assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['1002','1001']);
 assert.equal(result.model_calls[0].error,'invalid_candidate_indices');assert.equal(result.trace.length,1);
});

test('actual requests expose one complete recommendation contract and record the chosen prompt',async()=>{
 const input={observation:{decision_id:'contract',environment:{candidate_pool:[{id:'1001'},{id:'1002'}]}},protocol:{mode:'fixed_candidates',top_k:2,require_full_ranking:true,max_model_calls:1}};
 const prompt='A frozen comparison prompt.';
 const result=await runEpisode(input,{systemPrompt:prompt,modelCall:async({messages})=>{
  assert.equal(messages[0].content,prompt);
  const c=JSON.parse(messages[1].content).context.output_requirements.recommendation_contract;
  assert.equal(c.count,2);assert.deepEqual(c.delivery,['replace_pending','append']);
  assert.equal(c.order_field,'ordered_candidate_indices');
  return {content:JSON.stringify({decision_id:'contract',actions:[{action_id:'rank',kind:'recommend',arguments:{ordered_candidate_indices:[1,2],delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]})};
 }});
 assert.equal(result.status,'submitted');assert.equal(result.model_calls[0].messages[0].content,prompt);
});
