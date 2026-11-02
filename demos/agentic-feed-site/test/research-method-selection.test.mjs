import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,account} from './research-api-fixture.mjs';
import {ONLINE_METHODS,validResearchMethods} from '../lib/waterfall/research-methods.mjs';

test('online four-method blind study freezes its roster and does not invent a missing BGE result',async()=>{
 const f=fixture({methods:ONLINE_METHODS}),a=await account(f.env,'four-methods');
 const prep=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'blind'})).body.preparation;
 assert.deepEqual(prep.methods,ONLINE_METHODS);
 await a.api('/api/research/start',{sessionId:a.sid,mode:'blind',preparationId:prep.id});
 f.jobs.get(prep.id).status='succeeded';
 const {study}=(await a.api(`/api/research/current?sessionId=${a.sid}&mode=blind`)).body;
 assert.equal(study.total,3);assert.equal(study.incomplete_methods,0);
 assert.equal(study.method_count,4);assert.deepEqual(f.jobs.get(prep.id).method_ids,ONLINE_METHODS);
});

test('method capabilities reject duplicates, unknown methods and a missing reference method',()=>{
 assert.equal(validResearchMethods(ONLINE_METHODS),true);
 for(const ids of [['waterfall'],['waterfall','waterfall'],['waterfall','fake'],['clawrec','i2agent']])assert.equal(validResearchMethods(ids),false);
});

 test('changing the participating roster requires confirming a fresh shared input',async()=>{
 const f=fixture({methods:ONLINE_METHODS}),a=await account(f.env,'roster-change');
 const prep=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation;
 const info=await f.env.RESEARCH_BACKEND.info();f.env.RESEARCH_BACKEND.info=async()=>({...info,methods:[...ONLINE_METHODS,'fixed-retrieval']});
 const response=await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:prep.id});
 assert.equal(response.status,409);assert.equal(f.starts,0);
 });
