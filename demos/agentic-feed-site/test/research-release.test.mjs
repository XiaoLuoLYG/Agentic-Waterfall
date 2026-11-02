import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {CloudStore} from '../lib/waterfall/cloud-store.mjs';
import {fixture,account} from './research-api-fixture.mjs';

async function group(store,sid,marker,{artifact_ref}={}){
 const at=new Date().toISOString(),item={id:marker,source:'hackernews',source_item_id:marker,title:marker,url:'https://example.test/'+marker,summary:'Displayed material'},input={id:marker+'-context',captured_at:at,state:{profile:'Provided profile',interests:[],entries:[]},candidate_pool:[],behavior:[],recent_commands:[],available_sources:[]};
 const result={data_origin:'human',input_snapshot:input,environment:{public_input:{provided_profile:{profile:'Provided profile',interests:[],entries:[]},evidence:[]}},methods:[{method_id:'waterfall',status:'submitted',slate:[item],content_snapshot:{items:[item]},trace:[{phase:'model',call_id:marker+'-call',started_at:at,completed_at:at,request:{messages:[{role:'user',content:marker+'-request'}]},receipt:{status:'success',content:JSON.stringify({marker}),requested_model:'unit-test-only'}}]}]};
 const study=await store.record('research_study',sid,{track:'evaluation',mode:'rating',items:[{id:marker+'-q',item}],pairs:[],mappings:[{method_id:'waterfall',question_id:marker+'-q',rank:1}],public_input:result.environment.public_input,input_snapshot:input,...(artifact_ref?{artifact_ref,summary:{data_origin:'human',methods:result.methods.map(({trace,...method})=>method)}}:{result})});
 return {study,result};
}
async function keep(a,store,study){await store.record('research_stop',a.sid,{track:'evaluation',study_id:study.id});assert.equal((await a.api('/api/research/curate',{sessionId:a.sid,studyId:study.id,disposition:'keep'})).status,201);}

test('kept stopped legacy groups retain release identity and the actual stop receipt without invented answers',async()=>{
 const f=fixture(),a=await account(f.env,'legacy-release'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const card={id:'legacy-card',title:'Actual legacy material',url:'https://example.test/legacy'},legacy=await store.record('comparison',a.sid,{track:'blind',study_protocol:'blind-next-v1',mapping:{A:'old-a',B:'old-b'},input_snapshot:{captured_at:new Date().toISOString()},results:{'old-a':{slate:[card]},'old-b':{slate:[{...card,id:'other'}]}}});
 assert.equal((await a.api('/api/research/stop',{sessionId:a.sid,studyId:legacy.id})).status,201);
 assert.equal((await a.api('/api/research/curate',{sessionId:a.sid,studyId:legacy.id,disposition:'keep'})).status,201);
 const response=await a.raw(`/api/export?sessionId=${a.sid}&format=release`);assert.equal(response.status,200);const data=JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
 assert.deepEqual(data.manifest.selection.study_ids,[legacy.id]);const study=data.tables.studies.find(row=>row.study_id===legacy.id);assert.equal(study.status,'stopped');assert.equal(study.source_metadata.research_stops[0].study_id,legacy.id);assert.deepEqual(data.tables.blind_choices,[]);
});

test('formal export needs explicit kept data, while raw export remains available',async()=>{
 const f=fixture(),a=await account(f.env,'release-empty');
 assert.equal((await a.raw(`/api/export?sessionId=${a.sid}&format=release`)).status,409);
 assert.equal((await a.raw(`/api/export?sessionId=${a.sid}&format=json`)).status,200);
});

test('formal package filters unfinished unselected batches and retains selected model IO',async()=>{
 const f=fixture(),a=await account(f.env,'release-selected'),b=await account(f.env,'release-other'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const selected=await group(store,a.sid,'KEPT_MATERIAL'),other=await group(store,a.sid,'UNSELECTED_SECRET');await keep(a,store,selected.study);
 assert.equal((await a.raw(`/api/export?sessionId=${a.sid}&format=json`)).status,409);
 const response=await a.raw(`/api/export?sessionId=${a.sid}&format=release`);assert.equal(response.status,200);
 const dataset=JSON.parse(gunzipSync(new Uint8Array(await response.arrayBuffer()))),text=JSON.stringify(dataset);
 assert.equal(dataset.schema_version,'awf-dataset/1.0');assert.equal(dataset.tables.studies.length,1);assert.equal(dataset.tables.studies[0].study_id,selected.study.id);
 assert(text.includes('KEPT_MATERIAL'));assert(!text.includes('UNSELECTED_SECRET'));assert.equal(dataset.tables.model_calls.length,1);
 assert.equal((await b.raw(`/api/export?sessionId=${a.sid}&format=release`)).status,404);
 assert.equal((await a.api('/api/research/curate',{sessionId:a.sid,studyId:selected.study.id,disposition:'exclude'})).status,201);
 assert.equal((await a.raw(`/api/export?sessionId=${a.sid}&format=release`)).status,409);
 await store.load(a.user);assert(store.rows.some(row=>row.id===other.study.id));
});

test('formal package hydrates verified private gzip and refuses a corrupt archive',async()=>{
 const f=fixture(),a=await account(f.env,'release-archive'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const plain=await group(store,a.sid,'ARCHIVED_MATERIAL'),bytes=gzipSync(JSON.stringify(plain.result)),key=`research/${a.user}/unit-artifact.json.gz`,sha256=createHash('sha256').update(bytes).digest('hex');
 const archived=await group(store,a.sid,'ARCHIVED_MATERIAL',{artifact_ref:{key,encoding:'gzip',size:bytes.length,sha256}});await f.env.RESEARCH_ARCHIVE.put(key,bytes);await keep(a,store,archived.study);
 let response=await a.raw(`/api/export?sessionId=${a.sid}&format=release`);assert.equal(response.status,200);
 const dataset=JSON.parse(gunzipSync(new Uint8Array(await response.arrayBuffer())));assert.equal(dataset.tables.model_calls.length,1);assert(JSON.stringify(dataset.tables.model_calls).includes('ARCHIVED_MATERIAL-request'));
 await f.env.RESEARCH_ARCHIVE.put(key,gzipSync('corrupt'));response=await a.raw(`/api/export?sessionId=${a.sid}&format=release`);assert.equal(response.status,502);
});
