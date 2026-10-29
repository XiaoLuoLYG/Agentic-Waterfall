import test from 'node:test';
import assert from 'node:assert/strict';
import {demoModelCall} from '../lib/waterfall/unified-demo.mjs';
import {runEpisode} from '../lib/waterfall/waterfall-core.mjs';

test('demo transport preserves truncated output so the common core can correct it',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{
  calls++;
  const content=calls===1?'{"actions":[':JSON.stringify({decision_id:'demo-format',actions:[{action_id:'corrected',kind:'recommend',arguments:{ordered_item_ids:['one'],delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]});
  return Response.json({model:'synthetic',choices:[{message:{content},finish_reason:calls===1?'length':'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
 };
 try{
  const input={observation:{decision_id:'demo-format',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:[{id:'one',title:'One'}],sources:[]}},protocol:{mode:'fixed_candidates',require_full_ranking:true,top_k:1,max_model_calls:2}};
  const result=await runEpisode(input,{modelCall:demoModelCall({endpoint:'https://model.invalid/chat/completions',key:'synthetic',model:'synthetic'})});
  assert.equal(result.status,'submitted');assert.equal(calls,2);assert.equal(result.model_calls[0].content,'{"actions":[');assert.equal(result.model_calls[0].error,'model_output_truncated');assert.deepEqual(result.ordered_item_ids,['one']);
 }finally{globalThis.fetch=previous;}
});
