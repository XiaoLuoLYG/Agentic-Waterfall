import test from 'node:test';import assert from 'node:assert/strict';import {runSequence} from './sequence.mjs';
test('real-history diagnostic advances isolated state over three bounded event batches',async()=>{
 const domain={name:'test',item_noun:'items',categories:['topic','style','creator','mood','format','length']};
 const seen=[];const model=async(stage,payload)=>{seen.push(stage);if(stage==='extract')return {preferences:[{category:'topic',text:'x',strength:0.5,action:'create',evidence_ids:payload.events.map(e=>e.signal_id)}]};if(stage==='synthesize')return {profile:'x'};return {actions:[]};};
 const events=Array.from({length:9},(_,i)=>({id:String(i),type:'click',text:'x'}));const r=await runSequence('u',events,model,domain);assert.equal(r.states.length,3);assert.deepEqual(seen,['extract','synthesize','plan','plan','plan','plan']);assert.equal(r.states[2].userId,'u');assert.equal(r.states[2].pending.length,6);
});
