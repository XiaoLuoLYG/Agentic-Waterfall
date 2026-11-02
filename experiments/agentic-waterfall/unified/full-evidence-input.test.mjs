import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHistory} from './formal-history.mjs';
import {runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';

const fixture=()=>({observation:{decision_id:'full-evidence',user_id:'u',dialogue:[],behavior_events:Array.from({length:82},(_,i)=>({id:`history-${i}`,text:`record ${i}`})),user_state:{version:0,records:[]},environment:{candidate_pool:[{id:'first',text:'START '+'a'.repeat(60000)+' FIRST_END'},{id:'last',text:'LAST_START '+'b'.repeat(60000)+' END'}],sources:[]}},protocol:{mode:'fixed_candidates',require_full_ranking:true,top_k:2,max_model_calls:2,max_tool_calls:0}});
const reply=()=>({content:JSON.stringify({decision_id:'full-evidence',actions:[{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:['last','first'],delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]})});

test('all authorized history is present initially, including a large single event',()=>{
 const source=fixture();source.observation.behavior_events[0].text='HEAD '+'x'.repeat(120000)+' TAIL';
 const before=structuredClone(source),{input}=prepareHistory(source);
 assert.deepEqual(source,before);
 assert.deepEqual(input.observation.behavior_events,before.observation.behavior_events);
});

test('a full request above 100KB keeps every candidate body and every history record in one decision',async()=>{
 const source=fixture();let calls=0;
 const result=await runEpisode(source,{modelCall:async request=>{
  calls++;const {observation,context}=JSON.parse(request.messages[1].content);
  assert(Buffer.byteLength(JSON.stringify(request.messages))>100000);
  assert.equal(context.batch_stage,undefined);
  assert.deepEqual(observation.behavior_events,source.observation.behavior_events);
  assert.deepEqual(observation.environment.candidate_pool.map(x=>x.text),source.observation.environment.candidate_pool.map(x=>x.text));
  return reply();
 }});
 assert.equal(result.status,'submitted');assert.equal(calls,1);assert.deepEqual(result.ordered_item_ids,['last','first']);
});

test('an actual provider context rejection is retained without a shortened substitute request',async()=>{
 let calls=0;
 const result=await runEpisode(fixture(),{modelCall:async request=>{
  calls++;assert(JSON.parse(request.messages[1].content).observation.environment.candidate_pool[1].text.endsWith(' END'));
  throw Object.assign(Error('model_http_400'),{receipt:{http:{code:'context_length_exceeded'}}});
 }});
 assert.equal(calls,1);assert.equal(result.status,'failed');assert.equal(result.error,'model_http_400');
 assert.equal(result.model_calls[0].http.code,'context_length_exceeded');assert.deepEqual(result.ordered_item_ids,[]);
});
