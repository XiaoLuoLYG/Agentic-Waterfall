import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createResearchService,createResearchStateStore} from '../scripts/research-service.mjs';
import {createRemoteResearchBackend} from '../lib/waterfall/research-backend.mjs';
const token='offline-test-service-token-32-characters';
test('remote client rejects redirects without following them in the Worker runtime',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  calls++;assert.equal(options.redirect,'manual');
  return new Response(null,{status:302,headers:{Location:'https://another.example/'}});
 });
 const backend=createRemoteResearchBackend({url:'https://research.example',token});
 await assert.rejects(()=>backend.info(),/research_backend_http_302/);
 assert.equal(calls,1);
});
const request=()=>({job_id:randomUUID(),user_id:randomUUID(),session_id:randomUUID(),mode:'rating',context_hash:'a'.repeat(64),data_origin:'human',snapshot:{id:'frozen-input',captured_at:'2026-10-31T00:00:00.000Z',state:{profile:'explicit'},available_sources:[]},history:[]});
const result=()=>({data_origin:'human',environment:{catalog_count:1109,source_sha256:{core:'hash'},public_input:{secret:'not in summary'}},methods:['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'].map(method_id=>({method_id,status:'submitted',method_version:'actual-entry-v1',slate:[{id:method_id,title:'public card',url:'https://example.test/'+method_id}],trace:[{receipt:{attempt_id:method_id,usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}}},{huge:'x'.repeat(100000)}],content_snapshot:{items:[{private_large:'not in summary'}]}}))});
const call=(service,path,body,auth=token)=>service.handler(new Request('http://127.0.0.1'+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${auth}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));

test('durable authenticated jobs are idempotent and return a small summary plus verified gzip',async()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'research-service-'));let runs=0;
 const service=await createResearchService({dataDir:dir,token,runner:async input=>{runs++;assert.equal(input.session.record_kind,'human');return result();}});
 try{
  assert.equal((await call(service,'/v1/info',null,'wrong')).status,401);
  const input=request();assert.equal((await call(service,'/v1/jobs',input)).status,202);await service.idle();
  const poll=await (await call(service,`/v1/jobs/${input.job_id}`)).json();assert.equal(poll.status,'succeeded');assert.equal(poll.user_id,input.user_id);assert.equal(poll.session_id,input.session_id);assert.equal(poll.summary.methods.length,5);assert.equal(poll.summary.costs.total_tokens,15);assert.equal(poll.summary.run_id,input.job_id);assert.equal(poll.summary.artifact_version,'awf-research-artifact/1');
  assert.ok(JSON.stringify(poll).length<10000);assert.ok(!JSON.stringify(poll).includes('not in summary'));assert.equal(runs,1);
  assert.equal((await call(service,'/v1/jobs',input)).status,200);assert.equal(runs,1);
  assert.equal((await call(service,'/v1/jobs',{...input,user_id:randomUUID()})).status,409);assert.equal((await call(service,'/v1/jobs',{...input,mode:'blind'})).status,409);
  const response=await call(service,`/v1/jobs/${input.job_id}/artifact`),compressed=Buffer.from(await response.arrayBuffer());assert.equal(response.headers.get('content-encoding'),null);assert.equal(compressed.length,poll.artifact.size);assert.equal(createHash('sha256').update(compressed).digest('hex'),poll.artifact.sha256);assert.equal(JSON.parse(gunzipSync(compressed)).methods.length,5);
  assert.equal(statSync(resolve(dir,'jobs',input.job_id,'artifact.json.gz')).mode&0o777,0o600);
 }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('queued execution is serial and failed or interrupted jobs never execute again on restart',async()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'research-restart-'));let running=0,maximum=0,calls=0;
 let service=await createResearchService({dataDir:dir,token,runner:async()=>{calls++;maximum=Math.max(maximum,++running);await new Promise(setImmediate);running--;throw Error('offline model failure');}});
 const first=request(),second=request();
 try{
  await call(service,'/v1/jobs',first);await call(service,'/v1/jobs',second);await service.idle();assert.equal(maximum,1);assert.equal(calls,2);
  const failed=await (await call(service,`/v1/jobs/${first.job_id}`)).json();assert.equal(failed.status,'failed');assert.match(failed.error,/offline model failure/);
  await service.close();const file=resolve(dir,'jobs',second.job_id,'job.json'),job=JSON.parse(readFileSync(file,'utf8'));job.status='running';writeFileSync(file,JSON.stringify(job));
  service=await createResearchService({dataDir:dir,token,runner:async()=>{calls++;return result();}});await service.idle();
  assert.equal((await (await call(service,`/v1/jobs/${second.job_id}`)).json()).status,'interrupted');assert.equal((await call(service,'/v1/jobs',second)).status,200);await service.idle();assert.equal(calls,2);
 }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('remote client verifies identities, private artifact bytes and safe endpoint configuration',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'research-client-')),service=await createResearchService({dataDir:dir,token,runner:async()=>result()});
 t.mock.method(globalThis,'fetch',async(address,options)=>service.handler(new Request(address,options)));
 try{
  assert.throws(()=>createRemoteResearchBackend({url:'http://public.example',token}),/HTTPS/);assert.throws(()=>createRemoteResearchBackend({url:'https://u:password@example.test',token}),/endpoint/);
  const backend=createRemoteResearchBackend({url:'http://127.0.0.1',token}),input=request();assert.equal((await backend.info()).ready,true);await backend.start(input);await service.idle();const poll=await backend.poll(input.job_id);assert.equal(poll.status,'succeeded');const artifact=await backend.artifact(input.job_id);assert.equal((await artifact.arrayBuffer()).byteLength,poll.artifact.size);
  t.mock.method(globalThis,'fetch',async()=>Response.json({...poll,user_id:randomUUID()}));await assert.rejects(()=>backend.poll(input.job_id),/identity/);
 }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('state loader rejects unarchived states and restores only private committed method state',async()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'research-state-')),service=await createResearchService({dataDir:dir,token,runner:async()=>result()});
 try{
  const user=randomUUID(),run_id=randomUUID(),value={state:'own state'},state_sha256=createHash('sha256').update(JSON.stringify(value)).digest('hex');
  service.archive({event:'method_complete',run_id,user_id:user,method_id:'clawrec',next_state:value,state_sha256});service.stateStore.set(user,'clawrec',value,{run_id,state_sha256});
  assert.deepEqual(createResearchStateStore(dir).get(user,'clawrec'),value);assert.equal(service.stateStore.get(randomUUID(),'clawrec'),null);
  service.stateStore.set(user,'generic-agent',value,{run_id,state_sha256});assert.throws(()=>service.stateStore.get(user,'generic-agent'),/no archived completion/);
 }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('UTF-8 request chunks remain exact and corrupted artifacts are rejected',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'research-bytes-'));let text;
 const service=await createResearchService({dataDir:dir,token,runner:async input=>{text=input.snapshot.state.profile;return result();}});
 try{
  const input=request();input.snapshot.state.profile='摄影中文画像';const bytes=Buffer.from(JSON.stringify(input)),split=bytes.indexOf(Buffer.from('摄影'))+1;
  const body=new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,split));controller.enqueue(bytes.subarray(split));controller.close();}});
  assert.equal((await service.handler(new Request('http://127.0.0.1/v1/jobs',{method:'POST',headers:{authorization:'Bearer '+token},body,duplex:'half'}))).status,202);await service.idle();assert.equal(text,'摄影中文画像');
  const artifact=resolve(dir,'jobs',input.job_id,'artifact.json.gz');writeFileSync(artifact,'corruption');assert.equal((await call(service,`/v1/jobs/${input.job_id}/artifact`)).status,500);
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([31,139,1]),{headers:{'X-Job-Id':input.job_id,'X-Artifact-Size':'3','X-Artifact-Sha256':'0'.repeat(64)}}));
  const backend=createRemoteResearchBackend({url:'http://127.0.0.1',token});await assert.rejects(()=>backend.artifact(input.job_id),/checksum/);
 }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('a persisted input without a job marker remains bound to its original identity and context',async()=>{
 const dir=mkdtempSync(resolve(tmpdir(),'research-orphan-'));let service=await createResearchService({dataDir:dir,token,runner:async()=>result()});
 const input=request();
 try{
  await call(service,'/v1/jobs',input);await service.idle();await service.close();rmSync(resolve(dir,'jobs',input.job_id,'job.json'));
  service=await createResearchService({dataDir:dir,token,runner:async()=>result()});assert.equal((await call(service,'/v1/jobs',{...input,context_hash:'b'.repeat(64)})).status,409);assert.equal((await (await call(service,'/v1/jobs',input)).json()).status,'interrupted');
 }finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});
