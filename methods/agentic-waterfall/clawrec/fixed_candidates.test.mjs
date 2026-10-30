import test from 'node:test';import assert from 'node:assert/strict';
import {runFixed} from './fixed_candidates.mjs';
import {readFileSync} from 'node:fs';
test('uses own state and returns exactly the public candidate permutation',async()=>{
 const calls=[];const model=async(stage,input)=>{calls.push({stage,input});return stage==='state'?{user_state_md:'likes sports'}:{ordered_indices:[2,1]};};
 const result=await runFixed([{id:'h',type:'click',text:'sports'}],[{id:'a',text:'a'},{id:'b',text:'b'}],model);
 assert.deepEqual(result.ordered_item_ids,['b','a']);assert.deepEqual(calls.map(c=>c.stage),['state','curate']);assert.equal(calls[1].input.user_state_md,'likes sports');assert.deepEqual(calls[1].input.candidates.map(x=>x.index),[1,2]);
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
test('rejects fabricated or incomplete candidate output',async()=>{
 const model=async(stage)=>stage==='state'?{user_state_md:'state'}:{ordered_indices:[2,3]};
 await assert.rejects(()=>runFixed([],[{id:'a',text:'a'},{id:'b',text:'b'}],model),/invalid candidate/);
});
test('requests one correction for incomplete rankings without filling missing items',async()=>{
 let calls=0;const model=async(stage,payload)=>{if(stage==='state')return {user_state_md:'state'};calls++;return calls===1?{ordered_indices:[1]}:{ordered_indices:[2,1]};};
 const result=await runFixed([],[{id:'a',text:'a'},{id:'b',text:'b'}],model);assert.equal(calls,2);assert.deepEqual(result.ordered_item_ids,['b','a']);
});
test('diagnoses recorded missing index 101 and duplicate 62 before a second correction',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/ranking-format-failures.json',import.meta.url),'utf8'));
 const candidates=Array.from({length:101},(_,i)=>({id:`item-${i+1}`,text:`item ${i+1}`}));
 const supplied=[fixture.responses[0],fixture.responses[1],{ordered_indices:Array.from({length:101},(_,i)=>101-i)}];const calls=[];
 const result=await runFixed([],candidates,async(stage,payload)=>{if(stage==='state')return {user_state_md:'state'};calls.push(payload);return supplied[calls.length-1];});
 assert.deepEqual(result.ordered_indices,Array.from({length:101},(_,i)=>101-i));
 assert.equal(calls.length,3);
 assert.match(calls[1].format_feedback,/missing indices: \[101\]/);
 assert.match(calls[1].format_feedback,/duplicate indices: \[62\]/);
 assert.match(calls[2].format_feedback,/missing indices: \[101\]/);
 assert.match(calls[2].format_feedback,/duplicate indices: \[\]/);
 assert.deepEqual(fixture.responses[0].ordered_indices,calls[1].previous_ordered_indices);
});
test('rejects recorded repeated omissions after two corrections without filling indices',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/ranking-format-failures.json',import.meta.url),'utf8'));
 const candidates=Array.from({length:101},(_,i)=>({id:`item-${i+1}`,text:`item ${i+1}`}));let calls=0;
 await assert.rejects(()=>runFixed([],candidates,async(stage)=>stage==='state'?{user_state_md:'state'}:fixture.responses[2+(calls++%2)]),/invalid candidate permutation/);
 assert.equal(calls,3);
});
