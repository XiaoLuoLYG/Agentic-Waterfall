import test from 'node:test';import assert from 'node:assert/strict';
import {runRecBot,emptyState} from './recbot.mjs';
test('updates its own preferences, filters hard constraints and scores only supplied candidates',async()=>{
 const state=emptyState('u');const candidates=[{id:'a',text:'sports'},{id:'b',text:'politics'}];const trace=[];
 const model=async(stage,payload)=>{trace.push([stage,payload]);if(stage==='parser')return {positive_hard:[],positive_soft:['sports'],negative_hard:['politics'],negative_soft:[]};if(stage==='planner')return {allowed_ids:['a'],tools:['filter','matcher','aggregator']};};
 const embedding=async(items,positive,negative)=>({semantic:{a:0.8,b:0.2},negative:{a:0,b:0}});
 const result=await runRecBot({state,command:'sports, no politics',history:[],candidates,model,embedding});
 assert.deepEqual(result.ordered_item_ids,['a']);assert.equal(result.variant,'semantic-only-no-trained-AIA');assert.deepEqual(trace.map(x=>x[0]),['parser','planner']);assert.deepEqual(state.preferences.positive_soft,['sports']);
});
test('fails closed for duplicate or fabricated candidate and rolls back state',async()=>{
 const state=emptyState('u');const before=structuredClone(state);const model=async(stage)=>stage==='parser'?{positive_hard:[],positive_soft:[],negative_hard:[],negative_soft:[]}:{allowed_ids:['invented'],tools:['filter']};
 await assert.rejects(()=>runRecBot({state,command:'x',history:[],candidates:[{id:'a',text:'a'}],model,embedding:async()=>({})}),/unknown allowed/);assert.deepEqual(state,before);
});
test('multi-turn preferences and previous feed are per-user and tool trace is explicit',async()=>{
 const first=emptyState('first'),second=emptyState('second');let oldSeen;
 const model=async(stage,payload)=>{if(stage==='parser'){oldSeen=payload;return {positive_hard:[],positive_soft:['books'],negative_hard:[],negative_soft:[]};}return {allowed_ids:['a'],tools:[]};};
 const embedding=async()=>({semantic:{a:0.2},negative:{a:0}});const args={command:'books',history:[],candidates:[{id:'a',text:'a'}],model,embedding};
 const result=await runRecBot({...args,state:first});assert.deepEqual(result.executed_tools,['matcher','aggregator']);await runRecBot({...args,state:first});assert.equal(oldSeen.previous_feed[0].id,'a');assert.deepEqual(second.preferences.positive_soft,[]);
});
