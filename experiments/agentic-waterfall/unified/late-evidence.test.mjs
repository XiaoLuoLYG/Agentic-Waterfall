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
   if(args.target_id==='B')await late;
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

test('late evidence never increases the logical call budget',async()=>{
 const {result,seen}=await lateEvidence({max_model_calls:2});
 assert.equal(seen.length,2);
 assert.equal(result.model_calls.length,2);
 assert.deepEqual(result.ordered_item_ids,['A','B']);
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
