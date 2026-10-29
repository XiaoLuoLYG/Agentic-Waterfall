import test from 'node:test';import assert from 'node:assert/strict';
import {runFixed} from './fixed_candidates.mjs';
test('uses own state and returns exactly the public candidate permutation',async()=>{
 const calls=[];const model=async(stage,input)=>{calls.push({stage,input});return stage==='state'?{user_state_md:'likes sports'}:{ordered_indices:[2,1]};};
 const result=await runFixed([{id:'h',type:'click',text:'sports'}],[{id:'a',text:'a'},{id:'b',text:'b'}],model);
 assert.deepEqual(result.ordered_item_ids,['b','a']);assert.deepEqual(calls.map(c=>c.stage),['state','curate']);assert.equal(calls[1].input.user_state_md,'likes sports');assert.deepEqual(calls[1].input.candidates.map(x=>x.index),[1,2]);
});
test('rejects fabricated or incomplete candidate output',async()=>{
 const model=async(stage)=>stage==='state'?{user_state_md:'state'}:{ordered_indices:[2,3]};
 await assert.rejects(()=>runFixed([],[{id:'a',text:'a'},{id:'b',text:'b'}],model),/invalid candidate/);
});
