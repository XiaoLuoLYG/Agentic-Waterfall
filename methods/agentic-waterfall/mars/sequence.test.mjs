import test from 'node:test';import assert from 'node:assert/strict';import {runSequence} from './sequence.mjs';
test('real-history diagnostic advances isolated state over three bounded event batches',async()=>{
 const seen=[];const model=async(stage,payload)=>{seen.push(stage);if(stage==='extract')return {preferences:[{id:'p',category:'topic',statement:'x',strength:0.5,evidence:1}]};if(stage==='synthesize')return {profile:'x'};return {actions:[]};};
 const events=Array.from({length:9},(_,i)=>({id:String(i),type:'click',text:'x'}));const r=await runSequence('u',events,model);assert.equal(r.states.length,3);assert.deepEqual(seen,['extract','synthesize','plan','plan']);assert.equal(r.states[2].userId,'u');
});
