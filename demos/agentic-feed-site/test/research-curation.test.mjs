import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../lib/waterfall/cloud-store.mjs';
import * as research from '../lib/waterfall/research.mjs';
import {createResearchDataView} from '../public/research-view.js';
import {fixture,account} from './research-api-fixture.mjs';

async function study(store,sid,extra={}){
 const item={id:'public-card',title:'Public card',url:'https://example.test/card'};
 return store.record('research_study',sid,{track:'evaluation',mode:'rating',items:[{id:'q',item}],pairs:[],mappings:[{method_id:'waterfall',question_id:'q',rank:1}],result:{methods:[{method_id:'waterfall',slate:[item],trace:[{original:'PRIVATE_RAW_TRACE'}]}]},public_input:{provided_profile:{},evidence:[]},...extra});
}

test('curation is owned append-only administration and keep requires a sealed human group',async()=>{
 const f=fixture(),a=await account(f.env,'curate-owner'),b=await account(f.env,'curate-other'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const group=await study(store,a.sid),original=structuredClone(group),path='/api/research/curate',request={sessionId:a.sid,studyId:group.id};
 assert.equal((await b.api(path,{...request,sessionId:b.sid,disposition:'exclude'})).status,404);
 assert.equal((await a.api(path,{...request,disposition:'keep'})).status,409);
 assert.equal((await a.api(path,{...request,disposition:'delete'})).status,400);
 assert.equal((await a.api(path,{...request,disposition:'exclude',rating:3})).status,400);
 assert.equal((await a.api(path,{...request,disposition:'exclude'})).status,201);
 assert.equal((await a.api('/api/research/data?sessionId='+a.sid)).body.studies[0].curation.disposition,'exclude');
 assert.equal((await a.api(path,{...request,disposition:'pending'})).status,201);
 assert.equal((await a.api('/api/research/stop',request)).status,201);
 assert.equal((await a.api(path,{...request,disposition:'keep'})).status,201);
 assert.equal((await a.api('/api/research/data?sessionId='+a.sid)).body.studies[0].curation.release_eligible,true);
 assert.equal((await a.api(path,{...request,disposition:'pending'})).status,201);
 assert.equal((await a.api('/api/research/data?sessionId='+a.sid)).body.studies[0].curation.release_eligible,false);
 await store.load(a.user);assert.deepEqual(store.rows.find(row=>row.id===group.id),original);
 const records=store.rows.filter(row=>row.kind==='research_curation');assert.deepEqual(records.map(row=>row.disposition),['exclude','pending','keep','pending']);assert.ok(records.every(row=>row.track==='administration'));
 assert.equal(store.rows.filter(row=>['evaluation','feedback','command'].includes(row.kind)).length,0);
 const next=(await a.api('/api/session',{consent:true,recordKind:'human',interests:[],profile:''})).body.session.session_id;
 assert.equal((await a.api(path,{...request,sessionId:next,disposition:'exclude'})).status,404);
});

test('human groups default to pending and test or simulated groups can never be formally kept',async()=>{
 const f=fixture(),a=await account(f.env,'curate-origin'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const preparation=await store.record('research_preparation',a.sid,{track:'evaluation',snapshot:{qa_environment:{data_origin:'test_only'}}});
 const localTest=await study(store,a.sid,{preparation_id:preparation.id}),human=await study(store,a.sid),testOnly=await study(store,a.sid,{summary:{data_origin:'test_only',methods:[]}}),synthetic=await study(store,a.sid,{result:{data_origin:'synthetic',methods:[]}}),simulated=await study(store,a.sid);
 await store.record('evaluation',a.sid,{track:'evaluation',study_id:simulated.id,question_id:'q',simulated:true,origin:'model'});
 for(const group of [human,testOnly,synthetic,simulated,localTest])await store.record('research_stop',a.sid,{track:'evaluation',study_id:group.id});
 const data=(await a.api('/api/research/data?sessionId='+a.sid)).body,byId=new Map(data.studies.map(group=>[group.id,group]));
 assert.equal(byId.get(human.id).curation.disposition,'pending');assert.equal(byId.get(human.id).curation.release_eligible,false);
 for(const group of [testOnly,synthetic,simulated,localTest]){assert.equal(byId.get(group.id).curation.disposition,'exclude');assert.equal(byId.get(group.id).curation.can_keep,false);assert.equal((await a.api('/api/research/curate',{sessionId:a.sid,studyId:group.id,disposition:'keep'})).status,409);}
});

test('release rows contain only selected sealed human batches and preserve original rows',async()=>{
 assert.equal(typeof research.researchReleaseRows,'function');
 const f=fixture(),a=await account(f.env,'curate-release'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const keep=await study(store,a.sid,{preparation_id:'prep-keep'}),excluded=await study(store,a.sid,{preparation_id:'prep-exclude',mappings:[{method_id:'UNSELECTED_SECRET'}]}),unfinished=await study(store,a.sid,{mappings:[{method_id:'UNFINISHED_SECRET'}]});
 await store.record('research_preparation',a.sid,{track:'evaluation',preparation_id:'prep-exclude',id_hint:'private',snapshot:{secret:'UNSELECTED_PREPARATION'}});
 await store.record('research_event',a.sid,{track:'evaluation',study_id:unfinished.id,trace:'UNFINISHED_EVENT'});
 await store.record('evaluation',a.sid,{track:'evaluation',study_id:keep.id,question_id:'q',origin:'human',rating_value:2});
 await store.record('evaluation',a.sid,{track:'evaluation',study_id:excluded.id,question_id:'q',origin:'human',rating_value:0});
 await store.record('command',a.sid,{track:'feed',text:'natural history'});
 assert.throws(()=>research.researchReleaseRows(store,a.sid),error=>error.status===409);
 await a.api('/api/research/curate',{sessionId:a.sid,studyId:keep.id,disposition:'keep'});await store.load(a.user);
 const before=structuredClone(store.rows),release=research.researchReleaseRows(store,a.sid),text=JSON.stringify(release);
 assert.ok(release.some(row=>row.id===keep.id));assert.ok(release.some(row=>row.kind==='command'));assert.equal(release.filter(row=>row.kind==='evaluation').length,1);
 assert.ok(!text.includes('UNSELECTED_'));assert.ok(!text.includes('UNFINISHED_'));assert.ok(text.includes('PRIVATE_RAW_TRACE'));assert.deepEqual(store.rows,before);
 await a.api('/api/research/curate',{sessionId:a.sid,studyId:keep.id,disposition:'exclude'});await store.load(a.user);assert.throws(()=>research.researchReleaseRows(store,a.sid),error=>error.status===409);
});

test('my data shows reversible batch actions and a formal package link per session',async t=>{
 const elements=new Map(),get=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',hidden:false,handlers:{},querySelector:get,addEventListener(type,handler){this.handlers[type]=handler;}});return elements.get(selector);};
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:get}});t.after(()=>previous?Object.defineProperty(globalThis,'document',previous):delete globalThis.document);
 const requests=[],group={id:'batch',session_id:'old-session',mode:'rating',created_at:'now',sealed:true,total:1,completed:1,answers:[],curation:{disposition:'pending',data_origin:'human',can_keep:true,release_eligible:false}};
 const view=createResearchDataView({getSession:()=>({session_id:'current'}),notice:()=>{},api:async(path,data)=>{requests.push({path,data});return {studies:[group]};}});await view.enter();
 const html=get('#dataStudies').innerHTML;assert.match(html,/保留/);assert.match(html,/排除/);assert.match(html,/恢复待审核/);assert.match(get('#dataExport').innerHTML,/下载正式数据包/);assert.match(get('#dataExport').innerHTML,/sessionId=old-session&amp;format=release/);
 const button={dataset:{studyCurate:'batch',disposition:'exclude'},disabled:false};await get('#dataStudies').handlers.click({target:{closest:selector=>selector==='[data-study-curate]'?button:null}});
 assert.deepEqual(requests.find(request=>request.path==='/api/research/curate').data,{sessionId:'old-session',studyId:'batch',disposition:'exclude'});
});
