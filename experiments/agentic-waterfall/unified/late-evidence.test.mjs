import test from 'node:test';
import assert from 'node:assert/strict';
import {runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';

const action=(id,kind,args)=>({action_id:id,kind,arguments:args,depends_on:[],evidence_refs:[]});
const rank=id=>action(id,'recommend',{ordered_item_ids:['A','B'],delivery:'replace_pending'});
const get=id=>action('get-'+id,'acquire',{source_ids:['get_item'],mode:'browse',target_id:id,limit:1});
const input=(mode='fixed_candidates',max_model_calls=5)=>({observation:{decision_id:'late-evidence',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:mode==='fixed_candidates'?[{id:'A'},{id:'B'}]:[],sources:[{id:'get_item',modes:['browse']}]}},protocol:{mode,top_k:2,require_full_ranking:mode==='fixed_candidates',max_model_calls,max_tool_calls:2,max_acquired_items:2}});

async function lateEvidence({mode='fixed_candidates',reviews=false,max_model_calls=5,end=false}={}){
 const seen=[];let release;
 const late=new Promise(resolve=>release=resolve);
 const result=await runEpisode(input(mode,max_model_calls),{
  acquire:async args=>{
   if(args.target_id==='B'){if(max_model_calls===2)release();await late;}
   if(reviews&&args.target_id==='B')return {items:[],evidence:[{id:'review',text:'Prefer B'}],actual_requests:1};
   return {items:[{id:args.target_id,title:args.target_id}],actual_requests:1};
  },
  decide:async(obs,context)=>{
   const receiptIds=obs.environment.tool_results.filter(r=>r.kind==='acquire'&&r.status==='success').map(r=>r.action_id);
   seen.push({partial:!!context.other_acquisitions_pending,receiptIds,metadata:obs.environment.candidate_pool.filter(x=>x.title).length});
   let actions;
   if(context.call_index===0)actions=[get('A'),get('B')];
   else{
    release();
    const ranked=rank('rank-'+context.call_index);
    if(receiptIds.includes('get-B'))ranked.arguments.ordered_item_ids=['B','A'];
    actions=[ranked,...(end?[action('done','idle',{mode:'end_task'})]:[])];
   }
   return {decision_id:obs.decision_id,actions};
  }
 });
 return {result,seen};
}

test('known candidate metadata arriving after an interim slate gets a final decision',async()=>{
 const {result,seen}=await lateEvidence();
 assert.deepEqual(seen.map(x=>x.metadata),[0,1,2]);
 assert(seen[1].partial);
 assert.deepEqual(result.ordered_item_ids,['B','A']);
 assert.equal(result.acquired_items,0);
 assert.equal(result.status,'submitted');
});

test('late review evidence without new items also gets a final decision',async()=>{
 const {result,seen}=await lateEvidence({reviews:true});
 assert.deepEqual(seen.at(-1).receiptIds,['get-A','get-B']);
 assert.deepEqual(result.ordered_item_ids,['B','A']);
 assert.equal(result.acquired_items,0);
});

test('open acquisition still streams an interim slate and consumes the late result',async()=>{
 const {result,seen}=await lateEvidence({mode:'acquire'});
 assert.deepEqual(seen.map(x=>x.metadata),[0,1,2]);
 assert.equal(result.acquired_items,2);
 assert.deepEqual(result.ordered_item_ids,['B','A']);
});

const updateFocus=(obs,kind='task')=>action('write','update_state',{base_version:obs.user_state.version,edits:[{
 op:'upsert',record:{id:'new-focus',kind,key:'trip',value:'travel',scope:'user',scope_id:null,status:'active',basis:'observed',evidence_refs:['saved-trip']}
}]});

async function reviseAfterSlate(kind,maxCalls=4){
 const episode=input('acquire',maxCalls),queries=[];
 episode.observation.environment.candidate_pool=[{id:'A',title:'camera'}];
 const result=await runEpisode(episode,{
  lookupHistory:async()=>({dialogue:[],behavior_events:[{id:'saved-trip',type:'feedback',value:'save'}]}),
  acquire:async args=>{queries.push(args.query);return {items:[{id:'B',title:'travel'}],actual_requests:1};},
  decide:async(obs,ctx)=>{
   const actions=[
    [action('first','recommend',{ordered_item_ids:['A'],delivery:'replace_pending'}),action('read','lookup_history',{query:'',offset:0,limit:1})],
    [updateFocus(obs,kind)],
    [action('get-trip','acquire',{source_ids:['get_item'],mode:'browse',target_id:'B',query:obs.user_state.records[0]?.value,limit:1})],
    [action('revised','recommend',{ordered_item_ids:['B'],delivery:'replace_pending'})]
   ][ctx.call_index];
   return {decision_id:obs.decision_id,actions};
  }
 });
 return {result,queries};
}

test('a changed active task makes the feed reconsider an earlier slate within its budget',async()=>{
 const {result,queries}=await reviseAfterSlate('task');
 assert.deepEqual(queries,['travel']);
 assert.equal(result.model_calls.length,4);
 assert.deepEqual(result.ordered_item_ids,['B']);
 const exhausted=await reviseAfterSlate('task',2);
 assert.equal(exhausted.result.status,'failed');
 assert.deepEqual(exhausted.result.ordered_item_ids,[]);
});

test('an ordinary preference update does not invalidate an earlier slate',async()=>{
 const {result,queries}=await reviseAfterSlate('preference');
 assert.equal(result.model_calls.length,2);
 assert.deepEqual(queries,[]);
 assert.deepEqual(result.ordered_item_ids,['A']);
});

test('keeping the queue in the same decision as a new requirement needs a fresh decision',async()=>{
 const episode=input('acquire',2);
 episode.observation.behavior_events=[{id:'saved-trip',type:'feedback',value:'save'}];
 episode.observation.environment.candidate_pool=[{id:'A',title:'camera'},{id:'B',title:'travel'}];
 episode.observation.environment.pending_queue=['A'];
 const result=await runEpisode(episode,{decide:async(obs,ctx)=>({decision_id:obs.decision_id,actions:ctx.call_index===0
  ?[updateFocus(obs,'constraint'),action('keep','idle',{mode:'keep'})]
  :[action('revised','recommend',{ordered_item_ids:['B'],delivery:'replace_pending'})]})});
 assert.equal(result.model_calls.length,2);
 assert.deepEqual(result.ordered_item_ids,['B']);
});

test('late evidence never increases the logical call budget',async()=>{
 const {result,seen}=await lateEvidence({max_model_calls:2});
 assert.equal(seen.length,2);
 assert.equal(result.model_calls.length,2);
 assert.deepEqual(result.ordered_item_ids,['B','A']);
});

test('an explicit end still stops after the interim recommendation',async()=>{
 const {result,seen}=await lateEvidence({end:true});
 assert.equal(seen.length,2);
 assert.equal(result.ended,true);
});

test('a recommendation that already saw all acquisitions adds no extra call',async()=>{
 let calls=0;
 const result=await runEpisode(input(),{
  acquire:async()=>({items:[{id:'A',title:'A'}],actual_requests:1}),
  decide:async obs=>({decision_id:obs.decision_id,actions:++calls===1?[get('A')]:[rank('rank')]})
 });
 assert.equal(calls,2);
 assert.equal(result.status,'submitted');
});

test('a failed acquisition stays failed and does not become successful evidence',async()=>{
 let calls=0;
 const result=await runEpisode(input(),{
  acquire:async()=>{throw Error('source_failed');},
  decide:async obs=>{calls++;return {decision_id:obs.decision_id,actions:[get('A'),rank('rank')]};}
 });
 assert.equal(calls,1);
 assert.equal(result.trace[0].execution_results[0].status,'failed');
 assert.equal(result.trace[0].execution_results[0].error,'source_failed');
});

test('waiting for in-flight metadata resumes after all results, including completion races',async()=>{
 for(const releaseBeforeWait of [true,false]){
  let release;const gate=new Promise(resolve=>release=resolve);const seen=[];
  const result=await runEpisode(input(),{
   acquire:async args=>{if(args.target_id==='B')await gate;return {items:[{id:args.target_id,title:args.target_id}],actual_requests:1};},
   onAction:receipt=>{if(receipt.kind==='idle'&&!releaseBeforeWait)release();},
   decide:async(obs,context)=>{
    seen.push(obs.environment.candidate_pool.filter(x=>x.title).length);
    if(context.call_index===0)return {decision_id:obs.decision_id,actions:[get('A'),get('B')]};
    if(context.other_acquisitions_pending){if(releaseBeforeWait){release();await gate;}return {decision_id:obs.decision_id,actions:[action('wait','idle',{mode:'wait'})]};}
    return {decision_id:obs.decision_id,actions:[action('final','recommend',{ordered_item_ids:['B','A'],delivery:'replace_pending'})]};
   }
  });
  assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['B','A']);assert.deepEqual(seen,[0,1,2]);
 }
});

test('the last model call is reserved for the completed acquisition set',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const seen=[];
 const result=await runEpisode(input('fixed_candidates',2),{
  acquire:async args=>{if(args.target_id==='B')await gate;return {items:[{id:args.target_id,title:args.target_id}],actual_requests:1};},
  onAction:receipt=>{if(receipt.action_id==='get-A')release();},
  decide:async(obs,context)=>{seen.push({partial:!!context.other_acquisitions_pending,metadata:obs.environment.candidate_pool.filter(x=>x.title).length});return {decision_id:obs.decision_id,actions:context.call_index===0?[get('A'),get('B')]:[rank('final')]};}
 });
 assert.equal(result.status,'submitted');assert.deepEqual(seen,[{partial:false,metadata:0},{partial:false,metadata:2}]);
});

test('waiting without an in-flight request yields without spinning',async()=>{
 const result=await runEpisode(input(),{decide:async obs=>({decision_id:obs.decision_id,actions:[action('wait','idle',{mode:'wait'})]})});
 assert.equal(result.status,'idle');assert.equal(result.model_calls.length,1);
});

test('wait is nonterminal for acquisitions in the same response regardless of order or dependencies',async()=>{
 for(const order of ['wait-first','wait-last','wait-dependent']){
  const result=await runEpisode(input(),{acquire:async()=>({items:[{id:'A',title:'enriched'}],actual_requests:1}),decide:async(obs,c)=>{
   const waiting=action('wait','idle',{mode:'wait'});if(order==='wait-dependent')waiting.depends_on=['get-A'];
   return {decision_id:obs.decision_id,actions:c.call_index===0?(order==='wait-first'?[waiting,get('A')]:[get('A'),waiting]):[rank('final')]};
  }});
  assert.equal(result.status,'submitted',order);assert.equal(result.model_calls.length,2,order);
 }
});

test('pending dependent acquisitions reserve slots against an overlapping partial decision',async()=>{
 const executed=[];let sawRefusal=false;
 const result=await runEpisode(input('fixed_candidates',4),{acquire:async a=>{executed.push(a.target_id);return {items:[{id:a.target_id,title:a.target_id}],actual_requests:1};},decide:async(obs,c)=>{
  if(c.call_index===0){const b=get('B');b.depends_on=['get-A'];return {decision_id:obs.decision_id,actions:[get('A'),b]};}
  if(c.other_acquisitions_pending){assert.equal(obs.environment.budget.remaining_tool_calls,0);return {decision_id:obs.decision_id,actions:[{...get('A'),action_id:'duplicate-fetch'}]};}
  sawRefusal=c.previous_output_error?.error==='tool_budget_exhausted';
  return {decision_id:obs.decision_id,actions:[rank('final')]};
 }});
 assert.deepEqual(executed,['A','B']);assert.equal(sawRefusal,true);assert.equal(result.status,'submitted');
 assert(result.trace.flatMap(x=>x.execution_results).every(r=>r.status==='success'));
});

test('a ranking never becomes a complete result when final-call evidence was not reviewed',async()=>{
 const result=await runEpisode(input('fixed_candidates',2),{acquire:async a=>({items:[{id:a.target_id,title:a.target_id}],actual_requests:1}),decide:async(obs,c)=>({decision_id:obs.decision_id,actions:c.call_index===0?[rank('early'),get('A')]:[get('B')]})});
 assert.deepEqual(result.ordered_item_ids,['A','B']);
 assert.equal(result.continuation_error,'model_call_budget_exhausted_with_unreviewed_evidence');
});
