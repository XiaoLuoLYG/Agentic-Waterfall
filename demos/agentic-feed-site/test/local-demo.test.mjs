import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {request} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {createLocalDemo} from '../scripts/local-demo.mjs';
import {fixture} from './research-api-fixture.mjs';

const model='DeepSeek-V4.1-Flash-1017';
function setup(){
 const directory=mkdtempSync(resolve(tmpdir(),'waterfall-local-')),configFile=resolve(directory,'private-config.json'),dataDir=resolve(directory,'data');
 writeFileSync(configFile,JSON.stringify({apiKey:'private-fixture-key',apiBase:'https://model.example/v1',recommendationModelName:'previous-model',providers:{ZHIHU_API_KEY:'private-source-key'},runtime:{waterfall:{sources:{wikipedia:{allowed:false}}}}}),{mode:0o600});
 return {directory,configFile,dataDir,options:{port:0,configFile,dataDir,modelOverride:model}};
}
function client(demo,cookie=''){
 const base=`http://127.0.0.1:${demo.info.port}`;
 return async(path,body)=>fetch(base+path,{headers:{cookie,'content-type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
}
async function account(demo,name,recordKind='synthetic'){
 const response=await client(demo)('/api/identity',{username:name,type:'human'});assert.equal(response.status,200);
 const identity=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0],api=client(demo,cookie);
 const created=await api('/api/session',{consent:true,recordKind,interests:['摄影'],profile:'Explicit offline test profile'});assert.equal(created.status,201);
 return {api,cookie,user:identity.user,sid:(await created.json()).session.session_id};
}

test('credential-free sample uses the shared core and never calls a remote model or content source', async t => {
 const directory = mkdtempSync(resolve(tmpdir(), 'waterfall-sample-'));
 const originalFetch = globalThis.fetch;
 const remoteCalls = [];
 t.mock.method(globalThis, 'fetch', (url, options) => {
  if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
  remoteCalls.push(String(url));
  throw Error('sample mode made an external request');
 });
 let demo;
 try {
  demo = await createLocalDemo({port: 0, dataDir: directory, configFile: '', modelOverride: '', modelKey: ''});
  const health = await (await client(demo)('/api/health')).json();
  const config = await (await client(demo)('/api/config')).json();
  assert.equal(health.mode, 'sample');
  assert.equal(config.mode, 'sample');
  assert.equal(config.model, null);
  assert.deepEqual(config.sources.map(source => source.id), ['local']);
  assert.equal(config.research.fullComparison, false);
  const a = await account(demo, 'sample-reader', 'human');
  const recent = await (await a.api('/api/me')).json();
  assert.equal(recent.sessionInfo.session.record_kind, 'synthetic');
  await a.api('/api/settings', {settings: {interests: ['自然']}});
  const first = await a.api('/api/run', {sessionId: a.sid, command: '', trigger: 'prefetch'});
  assert.equal(first.status, 200);
  const {run} = await first.json();
  assert.equal(run.mode, 'sample');
  assert.equal(run.runtime_source_sha256, '79d87e6b8bbc031727a43526768aba4765afec0b44c3e9bf06b2a9c39dd03905');
  assert.equal(run.slate[0].source_item_id, 'nature');
  assert.ok(run.trace.every(step => step.origin === 'scripted_fixture' && !step.requested_model));
  const saved = await (await a.api('/api/interaction', {sessionId: a.sid, type: 'command', text: '我已经买了电脑，想学怎么用', eventTime: new Date().toISOString()})).json();
  const reply = await a.api('/api/run', {sessionId: a.sid, command: '我已经买了电脑，想学怎么用', commandId: saved.id, trigger: 'command'});
  assert.equal(reply.status, 200);
  const changed = await reply.json();
  assert.equal(changed.run.slate[0].source_item_id, 'computer-guide');
  assert.ok(changed.state.entries.some(entry => entry.target === 'goal' && entry.value === 'completed'));
  const trace = await (await a.api(`/api/trace?sessionId=${a.sid}`)).json();
  const receipts = trace.decisions.flatMap(decision => decision.execution_results);
  assert.ok(['acquire', 'update_state', 'recommend'].every(kind => receipts.some(receipt => receipt.kind === kind && receipt.status === 'success')));
  const file = await a.api('/api/export');
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') || '', /^attachment; filename="waterfall-data-\d{4}-\d{2}-\d{2}\.json\.gz"$/);
  assert.equal(file.headers.get('x-unfinished-studies'), '0');
  const exported = JSON.parse(gunzipSync(Buffer.from(await file.arrayBuffer())));
  assert.equal(exported.manifest.data_origin, 'synthetic');
  assert.equal(exported.manifest.eligible_for_analysis, false);
  assert.deepEqual(exported.tables.model_calls, []);
  assert.deepEqual(remoteCalls, []);
 } finally {
  await demo?.close();
  rmSync(directory, {recursive: true, force: true});
 }
});

test('local demo uses real configuration without startup calls or fabricated accounts, and reopens owned history',async t=>{
 const s=setup();let demo,calls=0;const backend={async info(){calls++;throw Error('not called at startup');}};
 const originalFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',(...args)=>{assert.match(String(args[0]),/^http:\/\/127\.0\.0\.1:/,'external network is forbidden');return originalFetch(...args);});
 try{
  demo=await createLocalDemo({...s.options,backend});assert.equal(calls,0);
  const sql=new DatabaseSync(resolve(s.dataDir,'preview.sqlite'));assert.equal(sql.prepare('SELECT count(*) AS n FROM accounts').get().n,0);assert.equal(sql.prepare('SELECT count(*) AS n FROM events').get().n,0);sql.close();
  const config=await (await client(demo)('/api/config')).json();assert.equal(config.mode,'llm');assert.equal(config.model,model);assert.equal(config.research.fullComparison,true);
  assert.equal(config.sources.find(source=>source.id==='zhihu').configured,true);assert.equal(config.sources.find(source=>source.id==='wikipedia').allowed,false);assert.ok(!JSON.stringify(config).includes('private-'));
  assert.equal((await client(demo)('/api/dataset/status?sessionId=missing')).status,401);
  const a=await account(demo,'local-owner'),b=await account(demo,'local-other');
  const status=await (await a.api('/api/dataset/status?sessionId='+a.sid)).json();assert.equal(status.archive_configured,true);assert.equal(status.storage,'sqlite+files');assert.equal(status.captures.total,0);
  assert.equal((await b.api('/api/dataset/status?sessionId='+a.sid)).status,404);
  assert.equal(await (await client(demo)('/')).text(),readFileSync(new URL('../public/index.html',import.meta.url),'utf8'));
  for(const path of ['/%2e%2e%2fprivate-config.json','/%2e%2e%2fdata/preview.sqlite'])assert.equal((await client(demo)(path)).status,403);
  const forged=await new Promise((accept,reject)=>{const req=request(`http://127.0.0.1:${demo.info.port}/`,{headers:{host:'attacker.example'}},response=>{response.resume();accept(response.statusCode);});req.on('error',reject);req.end();});assert.equal(forged,403);
  await assert.rejects(()=>createLocalDemo({...s.options,backend}),/already has a running/);
  await demo.close();demo=await createLocalDemo({...s.options,backend});
  const me=await (await client(demo,a.cookie)('/api/me')).json();assert.equal(me.user.id,a.user.id);assert.equal(me.sessionInfo.session.session_id,a.sid);assert.equal(me.sessionInfo.lastRun,null);assert.equal(calls,0);
  assert.equal(statSync(s.dataDir).mode&0o777,0o700);assert.equal(statSync(resolve(s.dataDir,'preview.sqlite')).mode&0o777,0o600);
 }finally{await demo?.close();rmSync(s.directory,{recursive:true,force:true});}
});

test('five-method HTTP flow archives compressed bytes privately and survives a local restart',async()=>{
 const s=setup(),f=fixture();let demo;
 try{
  demo=await createLocalDemo({...s.options,backend:f.env.RESEARCH_BACKEND});const a=await account(demo,'five-method-owner');
  const prepared=await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'});assert.equal(prepared.status,201);const p=(await prepared.json()).preparation;assert.equal(p.methods.length,5);
  assert.equal((await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:p.id})).status,202);f.jobs.get(p.id).status='succeeded';
  const current=await a.api('/api/research/current?sessionId='+a.sid+'&mode=rating');assert.equal(current.status,200);const study=(await current.json()).study;assert.ok(study);
  await a.api('/api/research/stop',{sessionId:a.sid,studyId:study.id});
  const details=(await (await a.api('/api/research/details?sessionId='+a.sid+'&studyId='+study.id)).json()).details;assert.equal(details.methods.length,5);
  const download=await a.api(details.artifact_url);assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());assert.deepEqual(bytes,f.jobs.get(p.id).bytes);
  const artifacts=resolve(s.dataDir,'artifacts'),files=readdirSync(artifacts);assert.equal(files.length,1);assert.deepEqual(readFileSync(resolve(artifacts,files[0])),bytes);assert.equal(statSync(resolve(artifacts,files[0])).mode&0o777,0o600);
  await demo.close();demo=await createLocalDemo(s.options);
  const after=await client(demo,a.cookie)(details.artifact_url);assert.equal(after.status,200);assert.deepEqual(Buffer.from(await after.arrayBuffer()),bytes);
 }finally{await demo?.close();rmSync(s.directory,{recursive:true,force:true});}
});

test('local demo rejects symlink data roots and private database files',async()=>{
 const s=setup();
 try{
  symlinkSync(s.directory,s.dataDir);await assert.rejects(()=>createLocalDemo(s.options),/real directory/);rmSync(s.dataDir);
  const first=await createLocalDemo(s.options);await first.close();rmSync(resolve(s.dataDir,'preview.sqlite'));symlinkSync(s.configFile,resolve(s.dataDir,'preview.sqlite'));
  await assert.rejects(()=>createLocalDemo(s.options),/regular file/);
 }finally{rmSync(s.directory,{recursive:true,force:true});}
});

test('browser requests on localhost preserve their real origin and reject foreign origins',async()=>{
 const s=setup();let demo;
 try{
  demo=await createLocalDemo(s.options);const base=`http://localhost:${demo.info.port}`;
  const options=origin=>({method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({username:'browser-origin-test',type:'human'})});
  assert.equal((await fetch(base+'/api/identity',options(base))).status,200);
  assert.equal((await fetch(base+'/api/identity',options('https://attacker.example'))).status,403);
 }finally{await demo?.close();rmSync(s.directory,{recursive:true,force:true});}
});

test('local storage preserves explicit human origin without silently marking it as a fixture',async()=>{
 const s=setup(),f=fixture();let demo;
 try{
  demo=await createLocalDemo({...s.options,backend:f.env.RESEARCH_BACKEND});const a=await account(demo,'human-origin-contract','human');
  const p=await (await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).json();
  assert.equal((await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:p.preparation.id})).status,202);
  assert.equal(f.jobs.get(p.preparation.id).data_origin,'human');
 }finally{await demo?.close();rmSync(s.directory,{recursive:true,force:true});}
});

test('normal model acquisition uses configured model and the same durable dataset archive binding',async t=>{
 const s=setup();let demo,calls=0;const originalFetch=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(address,options)=>{
  if(String(address).startsWith('http://127.0.0.1:'))return originalFetch(address,options);
  calls++;
  if(new URL(address).hostname==='hn.algolia.com')return Response.json({hits:[1,2,3].map(n=>({objectID:String(n),title:'Offline public '+n,story_text:'Offline source body '+n}))});
  assert.equal(String(address),'https://model.example/v1/chat/completions');
  const payload=JSON.parse(options.body);assert.equal(payload.model,model);assert.equal(options.headers.Authorization,'Bearer private-override-key');
  const observation=JSON.parse(payload.messages[1].content).observation,items=observation.environment.candidate_pool;
  const action=items.length?{action_id:'recommend',kind:'recommend',arguments:{ordered_item_ids:[items[0].id],delivery:'replace_pending'}}:{action_id:'acquire',kind:'acquire',arguments:{source_ids:['hackernews'],query:'public',mode:'search',content_types:['text'],limit:1}};
  return Response.json({choices:[{message:{content:JSON.stringify({decision_id:observation.decision_id,actions:[{...action,evidence_refs:[],depends_on:[]}]})}}]});
 });
 try{
  demo=await createLocalDemo({...s.options,modelKey:'private-override-key'});assert.equal(calls,0);const a=await account(demo,'dataset-owner');
  assert.equal((await a.api('/api/settings',{settings:{sources:['hackernews'],contentTypes:['text']}})).status,200);
  const response=await a.api('/api/run',{sessionId:a.sid,command:'public'});assert.equal(response.status,200,await response.clone().text());const {run}=await response.json();assert.equal(run.slate.length,1);assert.equal(run.mode,'llm');assert.equal(run.runtime_source_sha256,'79d87e6b8bbc031727a43526768aba4765afec0b44c3e9bf06b2a9c39dd03905');
  const status=await (await a.api('/api/dataset/status?sessionId='+a.sid)).json();assert.equal(status.archive_ready,true);assert.equal(status.contents,3);assert.equal(status.storage,'sqlite+files');
  const exported=await a.api('/api/export?sessionId='+a.sid+'&format=dataset');assert.equal(exported.status,200);
  const data=JSON.parse(gunzipSync(Buffer.from(await exported.arrayBuffer())));assert.equal(data.tables.tool_calls.find(call=>call.results?.length===3).results.length,3);assert.ok(data.tables.contents.some(item=>item.summary==='Offline source body 3'));assert.ok(!JSON.stringify(data).includes('private-override-key'));
  assert.ok(readdirSync(resolve(s.dataDir,'artifacts')).length>0);
  await demo.close();demo=await createLocalDemo(s.options);
  const restored=await client(demo,a.cookie)('/api/export?sessionId='+a.sid+'&format=dataset');assert.equal(restored.status,200);assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await restored.arrayBuffer()))).tables.contents,data.tables.contents);
 }finally{await demo?.close();rmSync(s.directory,{recursive:true,force:true});}
});
