import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime,runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';
import {makeInput,makeAcquire} from '../clawrec/scripts/run_waterfall.mjs';

test('SimBench adapter keeps visible behavior and marks its live content environment',async()=>{
 const observation={decision_id:'case',user_id:'u',session_id:'s',observed_at:'2025-01-01T00:00:00Z',dialogue:[],behavior_events:[{id:'b',type:'open',title:'visible'}],user_state:{version:0,records:[]},environment:{candidate_pool:[],sources:[],pending_queue:[],visible_item_ids:[]}};
 const input=makeInput(observation,[{id:'bilibili',modes:['search'],modalities:['video']}],'2026-10-29T00:00:00Z');
 assert.equal(input.run_meta.dataset_event_time,'2025-01-01T00:00:00Z');assert.equal(input.run_meta.content_environment,'live_not_frozen');
 assert.equal(createRuntime(input).snapshot().behavior_events[0].id,'b');
 const acquire=makeAcquire(input,async()=>({source:'bilibili',status:'ok',items:[{id:'one',source:'bilibili',title:'one',modality:'video'}]}));
 const result=await runEpisode(input,{acquire,decide:async(obs,context)=>({decision_id:obs.decision_id,actions:context.call_index===0?[{action_id:'get',kind:'acquire',arguments:{source_ids:['bilibili'],mode:'search',query:'x',content_types:['video'],limit:10},evidence_refs:[],depends_on:[]}]:[{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:['one'],delivery:'append'},evidence_refs:[],depends_on:[]}]})});
 assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['one']);
});
