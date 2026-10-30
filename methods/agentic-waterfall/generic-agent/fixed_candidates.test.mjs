import test from 'node:test';import assert from 'node:assert/strict';import {runFixed} from './fixed_candidates.mjs';
test('generic candidate agent uses its own state and only returns supplied candidates',async()=>{
 const stages=[];const model=async(stage,payload)=>{stages.push(stage);return stage==='state'?{user_state_md:'recent interests'}:{ordered_indices:[2,1]};};
 const r=await runFixed([{text:'public'}],[{id:'a',text:'A'},{id:'b',text:'B'}],model);assert.deepEqual(stages,['state','curate']);assert.deepEqual(r.ordered_item_ids,['b','a']);
 await assert.rejects(()=>runFixed([],[{id:'a',text:'A'}],async stage=>stage==='state'?{user_state_md:'s'}:{ordered_indices:[2]}));
});
test('one bounded retry asks the model to repair an incomplete permutation',async()=>{
 const stages=[];const r=await runFixed([],[{id:'a',text:'A'},{id:'b',text:'B'}],async(stage)=>{stages.push(stage);return stage==='state'?{user_state_md:'s'}:stage==='curate'?{ordered_indices:[1]}:{ordered_indices:[2,1]};});
 assert.deepEqual(stages,['state','curate','curate_retry']);assert.deepEqual(r.ordered_item_ids,['b','a']);
 await assert.rejects(()=>runFixed([],[{id:'a',text:'A'}],async stage=>stage==='state'?{user_state_md:'s'}:{ordered_indices:[]}));
});
test('empty visible history permits an empty state without inventing preferences',async()=>{
 const stages=[];const result=await runFixed([],[{id:'a',text:'A'},{id:'b',text:'B'}],async(stage,payload)=>{
  stages.push(stage);if(stage==='state')return {user_state_md:''};
  assert.equal(payload.user_state_md,'');return {ordered_indices:[2,1]};
 });
 assert.deepEqual(stages,['state','curate']);assert.deepEqual(result.state,{user_state_md:''});assert.deepEqual(result.ordered_item_ids,['b','a']);
 for(const [history,state] of [[[{text:'observed history'}],{user_state_md:''}],[[],{}],[[],{user_state_md:[]}],[[],null]]){
  let calls=0;await assert.rejects(()=>runFixed(history,[{id:'a',text:'A'}],async()=>{calls++;return state;}),/invalid state/);assert.equal(calls,1);
 }
});
