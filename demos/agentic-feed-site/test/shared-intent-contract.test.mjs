import test from 'node:test';
import assert from 'node:assert/strict';
import {runEpisode} from '../lib/waterfall/waterfall-core.mjs';

const source={id:'public',modes:['search']};
const items=[{id:'match',title:'Match analysis',source_id:'public'},{id:'portrait',title:'Portrait composition',source_id:'public'}];
const action=(action_id,kind,args,depends_on=[])=>({action_id,kind,arguments:args,depends_on,evidence_refs:[]});
const input=(text='More sport')=>({observation:{decision_id:'scope',trigger:'feedback',dialogue:[{id:'request',role:'user',text}],behavior_events:[{id:'save',type:'feedback',value:'save',title:'Portrait composition'}],user_state:{version:1,records:[{id:'interest',kind:'preference',value:'Photography',status:'active'}]},environment:{candidate_pool:items,sources:[source]}},protocol:{top_k:2,max_model_calls:1}});
const response=(o,actions)=>({content:JSON.stringify({decision_id:o.decision_id,actions})});

test('model requests preserve relative and exclusive evidence without an overriding latest-message objective',async()=>{
 for(const text of ['More sport','Only sport this round']){
  const given=input(text),order=text.startsWith('Only')?['match']:['match','portrait'];let sent;
  const result=await runEpisode(given,{modelCall:async request=>{
   sent=request;const {observation}=JSON.parse(request.messages.at(-1).content);
   assert.deepEqual(observation.dialogue,given.observation.dialogue);
   assert.deepEqual(observation.behavior_events,given.observation.behavior_events);
   assert.deepEqual(observation.user_state,given.observation.user_state);
   return response(observation,[action('rank','recommend',{ordered_item_ids:order,delivery:'replace_pending'})]);
  }});
  assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,order);
  assert.doesNotMatch(sent.messages[0].content,/Prioritize the latest user feedback or instruction|request as much as the source and remaining budget allow/);
  assert.match(sent.messages[0].content,/Acquisition quantity and delivery quantity are different/);
  assert.match(sent.messages[0].content,/relative changes from exclusive requirements/);
  assert.match(JSON.parse(sent.messages.at(-1).content).context.output_requirements.recommendation,/next feed slate/);
 }
});

test('partial decisions see reserved acquisitions without completing dependencies or charging twice',{timeout:3000},async()=>{
 for(const fails of [false,true]){
  let releaseSlow,announcePartial;
  const gate=new Promise(resolve=>{releaseSlow=resolve;}),partial=new Promise(resolve=>{announcePartial=resolve;});
  const slow={source_ids:['public'],mode:'search',query:'portrait composition',limit:2},fast={...slow,query:'match analysis'};
  const given=input();given.observation.environment.candidate_pool=[];given.protocol={top_k:2,max_model_calls:3,max_tool_calls:2};
  const seen=[],issued=[],receipts=[];
  const episode=runEpisode(given,{
   modelCall:async request=>{
    const data=JSON.parse(request.messages.at(-1).content),o=data.observation;seen.push(data);
    if(data.context.other_acquisitions_pending)announcePartial(data);
    return response(o,seen.length===1?[
     action('slow','acquire',slow),action('fast','acquire',fast),
     action('after-slow','recommend',{ordered_item_ids:['portrait'],delivery:'replace_pending'},['slow'])
    ]:[action('rank-'+seen.length,'recommend',{ordered_item_ids:['match'],delivery:'replace_pending'})]);
   },
   acquire:async request=>{issued.push(request);if(request.query===slow.query){await gate;if(fails)throw Error('source unavailable');return {items:[items[1]]};}return {items:[items[0]]};},
   onAction:receipt=>receipts.push(receipt)
  });
  let result;
  try{
   const {observation:{environment}}=await partial;
   assert.deepEqual(environment.pending_acquisitions,[{action_id:'slow',request:slow}]);
   assert.equal(environment.budget.remaining_tool_calls,0);
   assert.equal(environment.tool_results.some(row=>['slow','after-slow'].includes(row.action_id)),false);
   assert.equal(receipts.some(row=>row.action_id==='after-slow'),false);
   assert.equal(issued.length,2);
  }finally{releaseSlow();result=await episode;}
  assert.equal(result.status,'submitted');assert.equal(result.tool_calls,2);assert.equal(issued.length,2);
  assert.deepEqual(seen.at(-1).observation.environment.pending_acquisitions,[]);
  assert.equal(receipts.find(row=>row.action_id==='after-slow').status,fails?'skipped':'success');
  const completed=seen.at(-1).observation.environment.tool_results.find(row=>row.action_id==='slow');
  assert.deepEqual(completed.result.request,slow);
  assert.equal(completed.status,fails?'failed':'success');
 }
});

test('issued queries survive partial and failed receipts while invalid acquisitions stay unissued',async()=>{
 const issued={source_ids:['public'],mode:'search',query:'portrait composition',limit:2};
 const given=input();given.observation.environment.candidate_pool=[];given.protocol={top_k:1,max_model_calls:4,max_tool_calls:1};
 const seen=[];let adapterCalls=0;
 const result=await runEpisode(given,{
  modelCall:async request=>{
   const {observation:o}=JSON.parse(request.messages.at(-1).content);seen.push(o);
   return response(o,seen.length===1?[action('invalid','acquire',{...issued,limit:0})]:seen.length===2?[action('search','acquire',issued),action('explain','respond',{kind:'explain',text:'A source request is pending.'})]:[action('rank-'+seen.length,'recommend',{ordered_item_ids:['match'],delivery:'replace_pending'})]);
  },
  acquire:async(_request,{onItems})=>{adapterCalls++;onItems([items[0]]);await new Promise(setImmediate);throw Error('source unavailable');}
 });
 assert.equal(result.status,'submitted');assert.equal(adapterCalls,1);assert.equal(result.tool_calls,1);
 const partial=seen[2].environment.tool_results.find(row=>row.parent_action_id==='search');
 assert.deepEqual(partial.result.request,issued);assert.deepEqual(partial.result.item_ids,['match']);assert.equal(partial.result.items,undefined);
 assert.deepEqual(seen[2].environment.pending_acquisitions,[{action_id:'search',request:issued}]);
 const completed=seen.at(-1).environment.tool_results;
 assert.deepEqual(completed.find(row=>row.action_id==='search').result.request,issued);
 assert.equal(completed.find(row=>row.action_id==='search').status,'failed');
 assert.equal(completed.find(row=>row.action_id==='invalid'),undefined);
 assert.equal(result.model_calls[0].error,'invalid_acquire_limit');
 assert.deepEqual(seen.at(-1).environment.pending_acquisitions,[]);
 assert.equal(result.trace.at(-1).execution_results[0].result.request,undefined);
});
