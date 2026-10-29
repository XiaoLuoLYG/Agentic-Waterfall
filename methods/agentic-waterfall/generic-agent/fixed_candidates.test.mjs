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
