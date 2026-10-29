import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState, ingest, applyMutations, retrospective, rank} from './mars.mjs';
const chunk=(id,s=0.5,e=1)=>({id,category:'topic',statement:id,strength:s,evidence:e});
test('recent FIFO, pending and lifecycle keep state separate and bounded',()=>{
 const state=emptyState('u1');ingest(state,Array.from({length:16},(_,i)=>({id:String(i),type:'click',text:'x'})));
 assert.equal(state.events.length,15);assert.equal(state.pending.length,16);
 state.preferences=[chunk('a',0.5,5),chunk('b',0.4,2)];
 applyMutations(state,[{op:'boost',id:'a'},{op:'demote',id:'a'},{op:'merge',id:'a',other:'b'}]);
 assert.equal(state.preferences.length,1);assert.equal(state.preferences[0].evidence,9);
 state.preferences=[chunk('weak',0.05,5)];applyMutations(state,[{op:'forget',id:'weak'}]);assert.deepEqual(state.preferences,[]);
});
test('retrospective builds memory then ranks only supplied candidate IDs without labels',async()=>{
 const calls=[];const model=async(stage,payload)=>{calls.push({stage,payload});if(stage==='extract')return {preferences:[chunk('p')]};if(stage==='synthesize')return {profile:'liked topics'};if(stage==='rank')return {scores:payload.candidates.map((c,i)=>({id:c.id,score:i}))};throw Error(stage)};
 const state=emptyState('u');const events=[{id:'h',type:'click',text:'history'}];
 await retrospective(state,events,model);assert.equal(state.pending.length,0);
 const items=[{id:'x',text:'x'},{id:'y',text:'y'}];const result=await rank(state,items,'',model);assert.deepEqual(result.ordered_item_ids,['y','x']);
 assert.deepEqual(calls.map(x=>x.stage),['extract','synthesize','rank']);assert(!JSON.stringify(calls).includes('SECRET'));
 await assert.rejects(()=>rank(state,[{id:'x',text:'x'},{id:'x',text:'y'}],'',model),/duplicate/);
});
test('evolving state waits for three events, honors scheduled actions, and rolls back on failure',async()=>{
 const {evolve}=await import('./mars.mjs');const s=emptyState('u');s.preferences=[chunk('p')];s.profile='old';let calls=0;
 const model=async(stage)=>{calls++;if(stage==='plan')return {actions:[{op:'boost',id:'p'}]};throw Error('unexpected')};
 await evolve(s,[{id:'1',type:'click',text:'a'}],model);assert.equal(calls,0);
 await evolve(s,[{id:'2',type:'click',text:'b'},{id:'3',type:'click',text:'c'}],model);assert.equal(calls,1);assert.equal(s.preferences[0].strength,0.6);
 const before=structuredClone(s);await assert.rejects(()=>evolve(s,[],async()=>({actions:[{op:'boost',id:'missing'}]})),/unknown preference/);assert.deepEqual(s,before);
});
