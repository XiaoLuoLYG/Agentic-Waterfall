import test from 'node:test';import assert from 'node:assert/strict';import {runRound} from './round.mjs';
test('each method searches only allowed sources and ranks only acquired items',async()=>{
 const seen=[];const model=async(stage,payload)=>{seen.push([stage,payload]);if(stage==='state')return {state:'own state'};if(stage==='plan')return {queries:[{source:'zhihu',query:'photography'}]};if(stage==='followup')return {queries:[]};return {ordered_indices:[1]};};
 const search=async()=>[{id:'id1',source:'zhihu',title:'t',text:'x',url:'https://zhihu.com/a'}];
 const r=await runRound({method:'generic-agent',evidence:[],priorState:null,allowedSources:['zhihu'],model,search});
 assert.deepEqual(r.ordered_item_ids,['id1']);assert.equal(r.search_count,1);assert.deepEqual(seen.map(x=>x[0]),['state','plan','followup','curate']);
});
test('rejects out-of-source plans and fabricated content without committing state',async()=>{
 const model=async stage=>stage==='state'?{state:'state'}:stage==='plan'?{queries:[{source:'other',query:'q'}]}:{ordered_item_ids:['fake']};
 await assert.rejects(()=>runRound({method:'clawrec',evidence:[],priorState:null,allowedSources:['zhihu'],model,search:async()=>[]}),/source/);
});
test('enforces the shared ten-search bound',async()=>{
 const model=async stage=>stage==='state'?{state:'state'}:{queries:Array.from({length:11},()=>({source:'zhihu',query:'q'}))};
 await assert.rejects(()=>runRound({method:'clawrec',evidence:[],priorState:null,allowedSources:['zhihu'],model,search:async()=>[]}),/budget/);
});
test('corrects unsupported search plans before invoking any tool',async()=>{
 let plans=0;const searches=[];const model=async(stage,payload)=>{if(stage==='state')return {state:'state'};if(stage==='plan'){plans++;return {queries:[{source:plans===1?'unsupported':'zhihu',query:'q'}]};}return {ordered_indices:[1]};};
 const search=async(source)=>{searches.push(source);return [{id:'ok',source:'zhihu',title:'x',text:'x',url:'https://zhihu.com/a'}]};const r=await runRound({method:'clawrec',evidence:[],priorState:null,allowedSources:['zhihu'],model,search});
 assert.equal(plans,2);assert.deepEqual(searches,['zhihu']);assert.deepEqual(r.ordered_item_ids,['ok']);
});
