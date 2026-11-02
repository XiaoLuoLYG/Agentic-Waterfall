import test from 'node:test';
import assert from 'node:assert/strict';
import {taskInstructions,behaviorStatistics} from './task-instructions.mjs';

test('dataset contracts preserve native output size and opaque identity semantics',()=>{
 for(const [dataset,count,full] of [['mind',2,true],['kuairec',10,false],['kuairand',101,true],['agentrecbench',20,true],['clawrec',5,false]]){
  const input={protocol:{top_k:count,require_full_ranking:full},observation:{behavior_events:[],environment:{candidate_pool:Array.from({length:count},(_,i)=>({id:String(i+1000)}))}}};
  const result=taskInstructions({dataset},input);assert.equal(result.recommendation.count,count);assert.equal(result.recommendation.order_field,'ordered_candidate_indices');assert.equal(result.behavior_statistics,undefined);
 }
});
test('KuaiRand statistics distinguish explicit feedback from missing fields',()=>{
 const events=[{id:'a',payload:{is_like:1,is_hate:0,duration_ms:0,play_time_ms:0}},{id:'b',payload:{is_like:0}},{id:'c',payload:{}}];
 const result=behaviorStatistics('kuairand',events);
 assert.equal(result.signals.is_like.observed_count,2);assert.equal(result.signals.is_like.set_rate,.5);assert.equal(result.signals.is_hate.observed_count,1);assert.equal(result.signals.is_hate.set_count,0);assert.equal(result.duration_ms.min,0);assert.deepEqual(result.signals.is_like.evidence_refs,['a']);
});
test('statistics count exposure, preserve duplicates and distinguish strict >2 from dislikes',()=>{
 const events=[0,2,3,5].map((watch_ratio,i)=>({id:'e'+i,item_id:'same',occurred_at:'2020-01-01T00:00:00Z',payload:{watch_ratio,item_category:'topic',duration_ms:1000+i}}));
 const before=structuredClone(events),result=behaviorStatistics('kuairec',events);
 assert.equal(result.all.observed_count,4);assert.equal(result.all.watch_ratio_gt_2_count,2);assert.equal(result.all.watch_ratio_gt_2_rate,.5);assert.equal(result.all.watch_ratio.median,2.5);assert.deepEqual(result.by_category[0].stronger_response_refs,['e2','e3']);assert.equal(result.by_month[0].month,'2020-01');assert.deepEqual(events,before);
 assert.throws(()=>behaviorStatistics('kuairec',[{payload:{watch_ratio:NaN}}]),/invalid_public_watch_ratio/);
});
test('statistics use only declared public events and do not invent ratings for missing reviews',()=>{
 const input={protocol:{top_k:20,require_full_ranking:false},hidden_target:'SECRET',observation:{behavior_events:[{payload:{review:{stars:5}}},{payload:{review:{}}}],environment:{candidate_pool:[]}}};
 const result=taskInstructions({dataset:'agentrecbench',behavior_statistics:true},input);
 assert.deepEqual(result.behavior_statistics.rating_counts,{'5':1});assert.equal(result.behavior_statistics.missing_rating_count,1);assert(!JSON.stringify(result).includes('SECRET'));
});
