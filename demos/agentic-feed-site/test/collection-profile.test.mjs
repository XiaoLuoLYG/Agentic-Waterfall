import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {fixture} from './research-api-fixture.mjs';
import {handleApi} from '../lib/waterfall/cloud-entry.mjs';

const hidden='HIDDEN_ONLY: 徒步新手，本周买相机，预算8000元，选好后结束选购。';
async function identity(env,name,type='human'){
 const response=await handleApi(new Request('https://app.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name,type})}),env);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const raw=(path,data)=>handleApi(new Request('https://app.test'+path,{headers:{cookie,'content-type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})}),env);
 const api=async(path,data)=>{const r=await raw(path,data);return {status:r.status,body:await r.json()};};
 return {raw,api,type};
}
async function session(client,{public_profile='喜欢旅行',hidden_profile=hidden,subset='general'}={}){
 const r=await client.api('/api/session',{consent:true,recordKind:client.type==='agent'?'synthetic':'human',interests:[],collectionProfile:{public_profile,hidden_profile,subset}});
 assert.equal(r.status,201,JSON.stringify(r.body));return r.body;
}
async function study(f,client,sid,mode='rating'){
 const p=await client.api('/api/research/prepare',{sessionId:sid,mode});assert.equal(p.status,201,JSON.stringify(p.body));
 const id=p.body.preparation.id;
 assert.equal((await client.api('/api/research/start',{sessionId:sid,mode,preparationId:id})).status,202);
 f.jobs.get(id).status='succeeded';
 const r=await client.api('/api/research/current?sessionId='+sid+'&mode='+mode);assert.equal(r.status,200);
 return {study:r.body.study,preparation:p.body.preparation,job:f.jobs.get(id)};
}

test('human and Agent use the same persona format; hidden text never reaches the recommendation backend',async()=>{
 for(const type of ['human','agent']){
  const f=fixture(),a=await identity(f.env,'persona-'+type,type),info=await session(a);
  assert.equal(info.collection_profile.schema_version,'awf-persona/1.0');
  assert.equal(info.collection_profile.origin,type==='human'?'human':'synthetic');
  assert.equal(info.collection_profile.public_profile,'喜欢旅行');assert.equal(info.collection_profile.hidden_profile,hidden);
  assert.equal(info.state.profile,'喜欢旅行');assert.ok(!JSON.stringify(info.state).includes('HIDDEN_ONLY'));
  const r=await study(f,a,info.session.session_id);
  assert.ok(!JSON.stringify({snapshot:r.job.snapshot,history:r.job.history,public_input:r.preparation.public_input}).includes('HIDDEN_ONLY'));
  assert.equal(r.preparation.public_input.provided_profile.profile,'喜欢旅行');
  assert.equal(r.study.collection_profile_id,info.collection_profile.profile_id);
 }
});

test('the read-only system profile matches the model input and excludes the private persona',async t=>{
 const f=fixture();f.env.WATERFALL_CONFIG=JSON.stringify({apiKey:'fixture',apiBase:'https://model.example/v1',modelName:'fixture'});
 const a=await identity(f.env,'profile-view-owner','agent'),b=await identity(f.env,'profile-view-other'),info=await session(a),sid=info.session.session_id;
 const changed=await a.api('/api/state',{sessionId:sid,version:info.state.version,profile:'喜欢旅行',memory:'偏好具体的入门步骤',context:'近期关注摄影'});assert.equal(changed.status,200);
 const profile=await a.api('/api/state?sessionId='+sid);assert.equal(profile.status,200,JSON.stringify(profile.body));
 assert.equal((await b.api('/api/state?sessionId='+sid)).status,404);
 const text=JSON.stringify(profile.body.model_profile);assert.ok(text.includes('偏好具体的入门步骤'));assert.ok(text.includes('近期关注摄影'));assert.ok(!text.includes('HIDDEN_ONLY'));
 let actual;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://model.example/v1/chat/completions');actual=JSON.parse(JSON.parse(options.body).messages[1].content).observation.user_state;throw Error('stop after inspecting the model input');});
 assert.equal((await a.api('/api/run',{sessionId:sid,command:''})).status,502);
 assert.deepEqual(profile.body.model_profile,actual);
});

test('humans can omit hidden persona; profile edits are owned, versioned and preserve previous records',async()=>{
 const f=fixture(),a=await identity(f.env,'profile-owner'),b=await identity(f.env,'profile-other');
 const info=await session(a,{hidden_profile:''}),sid=info.session.session_id;
 const patch={sessionId:sid,version:info.state.version,expectedProfileId:info.collection_profile.profile_id,public_profile:'中文短视频',hidden_profile:hidden,subset:'general'};
 assert.equal((await b.api('/api/collection-profile',patch)).status,404);
 const saved=await a.api('/api/collection-profile',patch);assert.equal(saved.status,200,JSON.stringify(saved.body));
 assert.equal(saved.body.state.profile,'中文短视频');assert.equal(saved.body.collection_profile.hidden_profile,hidden);
 assert.notEqual(saved.body.collection_profile.profile_id,info.collection_profile.profile_id);
 assert.equal((await a.api('/api/collection-profile',patch)).status,409);
 const exported=await a.raw('/api/export');assert.equal(exported.status,200);
 const data=JSON.parse(gunzipSync(Buffer.from(await exported.arrayBuffer())));
 const records=data.tables.events.filter(row=>row.type==='collection_profile');
 assert.equal(records.length,2);assert.ok(JSON.stringify(records).includes('HIDDEN_ONLY'));
 assert.ok(data.tables.profiles.every(row=>!JSON.stringify(row).includes('HIDDEN_ONLY')));
});

test('behavior ambiguity blocks explicit instructions; interactive revision requires an actual expression',async()=>{
 const f=fixture(),a=await identity(f.env,'subset-owner','agent');
 const one=await session(a,{subset:'behavior_ambiguity'}),sid=one.session.session_id;
 assert.equal((await a.api('/api/interaction',{sessionId:sid,type:'command',text:'我要相机测评',eventTime:new Date().toISOString()})).status,400);
 assert.equal((await a.api('/api/run',{sessionId:sid,command:'我要相机测评'})).status,400);
 const two=await session(a,{subset:'interactive_revision'}),second=two.session.session_id;
 assert.equal((await a.api('/api/research/prepare',{sessionId:second,mode:'rating'})).status,409);
 assert.equal((await a.api('/api/interaction',{sessionId:second,type:'command',text:'相机买好了，先学拍足球',eventTime:new Date().toISOString()})).status,201);
 const prepared=await a.api('/api/research/prepare',{sessionId:second,mode:'rating'});assert.equal(prepared.status,201);
 assert.equal(prepared.body.preparation.collection_subset,'interactive_revision');
});

test('one profile save updates public text and interests without replacing memory or private persona',async()=>{
 const f=fixture(),a=await identity(f.env,'simple-profile'),info=await session(a),sid=info.session.session_id;
 const patch={sessionId:sid,version:info.state.version,expectedProfileId:info.collection_profile.profile_id,public_profile:'摄影新手',hidden_profile:hidden,subset:'general',interests:['摄影','足球'],expectedInterests:[]};
 const stale=await a.api('/api/collection-profile',{...patch,expectedInterests:['旧标签']});assert.equal(stale.status,409);
 const saved=await a.api('/api/collection-profile',patch);assert.equal(saved.status,200,JSON.stringify(saved.body));
 assert.deepEqual(saved.body.user.settings.interests,['摄影','足球']);assert.deepEqual(saved.body.state.interests,['摄影','足球']);
 assert.deepEqual(saved.body.state.entries,info.state.entries);assert.equal(saved.body.state.memory,info.state.memory);
 assert.equal(saved.body.collection_profile.hidden_profile,hidden);
 assert.equal((await a.api('/api/session',{consent:true,recordKind:'human',interests:[],collectionProfile:{public_profile:'',hidden_profile:'',subset:'behavior_ambiguity'}})).status,400);
});

test('legacy public profiles stay public; invalid persona fields are rejected',async()=>{
 const f=fixture(),a=await identity(f.env,'legacy-owner');
 const legacy=await a.api('/api/session',{consent:true,recordKind:'human',interests:[],profile:'原有公开介绍'});
 assert.equal(legacy.status,201);assert.equal(legacy.body.state.profile,'原有公开介绍');assert.equal(legacy.body.collection_profile.hidden_profile,'');
 for(const collectionProfile of [{public_profile:'旅行',hidden_profile:'x'.repeat(8001),subset:'general'},{public_profile:'旅行',hidden_profile:'',subset:'unknown'},{public_profile:'旅行',hidden_profile:'',subset:'general',state:{profile:hidden}}]){
  assert.equal((await a.api('/api/session',{consent:true,recordKind:'human',interests:[],collectionProfile})).status,400);
 }
});

test('human accounts cannot select generated subsets by labelling their session synthetic',async()=>{
 const f=fixture(),a=await identity(f.env,'human-subset-boundary');
 const input={consent:true,recordKind:'synthetic',interests:[],collectionProfile:{public_profile:'',hidden_profile:'',subset:'behavior_ambiguity'}};
 assert.equal((await a.api('/api/session',input)).status,400);
 const info=await a.api('/api/session',{...input,collectionProfile:{...input.collectionProfile,subset:'general'}});assert.equal(info.status,201);
 assert.equal((await a.api('/api/collection-profile',{sessionId:info.body.session.session_id,version:info.body.state.version,expectedProfileId:info.body.collection_profile.profile_id,...input.collectionProfile})).status,400);
});

test('one explicit Agent evaluation uses the frozen private persona and never feeds labels into history',async t=>{
 const f=fixture();f.env.WATERFALL_CONFIG=JSON.stringify({apiKey:'fixture',apiBase:'https://model.example/v1',recommendationModelName:'fixture-model'});
 const a=await identity(f.env,'agent-evaluator','agent'),info=await session(a),sid=info.session.session_id;
 const r=await study(f,a,sid),q=r.study.items[0];let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://model.example/v1/chat/completions');calls++;const payload=JSON.parse(options.body);assert.ok(JSON.stringify(payload.messages).includes('HIDDEN_ONLY'));assert.ok(!JSON.stringify(payload.messages).includes('replacement-private'));assert.ok(!JSON.stringify(payload.messages).includes('method_id'));return Response.json({choices:[{message:{content:JSON.stringify({rating:3,status:'rated'})}}]});});
 const edit=await a.api('/api/collection-profile',{sessionId:sid,version:info.state.version,expectedProfileId:info.collection_profile.profile_id,public_profile:'喜欢旅行',hidden_profile:'replacement-private',subset:'general'});assert.equal(edit.status,200);
 const answer=await a.api('/api/research/simulate',{sessionId:sid,studyId:r.study.id,questionId:q.id});assert.equal(answer.status,201,JSON.stringify(answer.body));assert.equal(calls,1);
 assert.equal((await a.api('/api/research/simulate',{sessionId:sid,studyId:r.study.id,questionId:q.id})).status,409);assert.equal(calls,1);
 const prep=await a.api('/api/research/prepare',{sessionId:sid,mode:'rating'});assert.equal(prep.status,201);
 assert.ok(!JSON.stringify(prep.body.preparation.public_input).includes('rating_value'));
 await a.api('/api/research/stop',{sessionId:sid,studyId:r.study.id});
 const exported=await a.raw('/api/export'),data=JSON.parse(gunzipSync(Buffer.from(await exported.arrayBuffer())));
 const saved=data.tables.studies.find(row=>row.study_id===r.study.id);
 assert.equal(saved.source_metadata.collection_profile_id,info.collection_profile.profile_id);
 assert.equal(saved.source_metadata.collection_subset,'general');
 assert.ok(data.tables.events.some(row=>row.event_id===saved.source_metadata.collection_profile_id));
});

test('fast-path content events enforce the subset without needing a full state load',async()=>{
 const {CloudStore}=await import('../lib/waterfall/cloud-store.mjs');
 for(const subset of ['general','behavior_ambiguity']){
  const f=fixture(),a=await identity(f.env,'event-'+subset,'agent'),info=await session(a,{subset}),sid=info.session.session_id;
  const store=new CloudStore(f.env.DB);await store.load(info.session.user_id);
  const run=await store.record('run',sid,{track:'feed',result:{slate:[{id:'card',title:'摄影练习',source:'zhihu'}]}});
  const response=await a.api('/api/event',{sessionId:sid,type:'feedback',track:'feed',referenceId:run.id,contentId:'card',position:1,value:'comment',text:'想看更基础的',eventTime:new Date().toISOString()});
  assert.equal(response.status,subset==='general'?201:400,JSON.stringify(response.body));
 }
});
