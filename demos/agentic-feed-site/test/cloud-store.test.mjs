import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { CloudStore, CloudAccounts } from '../lib/waterfall/cloud-store.mjs';
function database() {
  const db = new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(`drizzle/${file}`,'utf8'));
  return { prepare(sql) { return { bind(...args) { const stmt=db.prepare(sql); return { async first(){return stmt.get(...args)||null;}, async all(){return {results:stmt.all(...args)};}, async run(){stmt.run(...args);return {success:true};} }; } }; } };
}
test('cloud source credentials enable the three sources without exposing secrets',async()=>{
  const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');
  const env={DB:database(),WATERFALL_CONFIG:JSON.stringify({apiKey:'model-fixture',apiBase:'https://example.test',modelName:'fixture',providers:{ZHIHU_API_KEY:'existing-provider'}}),COMPOSIO_CONFIG:JSON.stringify({apiKey:'private-fixture',userId:'fixture-user',baseUrl:'https://backend.composio.dev/api/v3.1'})};
  const response=await handleApi(new Request('https://example.test/api/config'),env);const body=await response.text();
  assert.equal(response.status,200);const sources=JSON.parse(body).sources;
  for(const id of ['youtube','reddit','x','zhihu'])assert.equal(sources.find(s=>s.id===id).configured,true);
  assert(!body.includes('private-fixture'));assert(!body.includes('existing-provider'));assert(!body.includes('fixture-user'));
});
test('canceling a cloud recommendation aborts the model call and releases the account lock',async t=>{
  const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database();
  const env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
  const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'abort-test',type:'human'})}),env);
  const cookie=identity.headers.get('set-cookie').split(';')[0];
  const request=(path,data,signal)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data),signal});
  const session=await (await handleApi(request('/api/session',{consent:true,recordKind:'human',interests:[],profile:''}),env)).json();
  let started;const called=new Promise(resolve=>{started=resolve});const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>{started();options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
  const controller=new AbortController();const task=handleApi(request('/api/run',{sessionId:session.session.session_id,command:'test'},controller.signal),env);await called;controller.abort();
  const response=await Promise.race([task,new Promise((_,reject)=>setTimeout(()=>reject(new Error('canceled operation did not finish')),1000))]);
  assert.equal(response.status,499);assert.equal((await response.json()).error,'请求已取消');assert.equal(await db.prepare('SELECT owner FROM active_operations').bind().first(),null);
  assert.equal((await handleApi(request('/api/settings',{settings:{interests:['自然']}}),env)).status,200);
});
test('canceling a cloud recommendation during retrieval releases the account lock',async t=>{
  const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database();const env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
  const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'abort-source-test',type:'human'})}),env);const cookie=identity.headers.get('set-cookie').split(';')[0];
  const req=(path,data,signal)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data),signal});
  const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[],profile:''}),env)).json();
  let started;const called=new Promise(resolve=>{started=resolve});const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=(url,options)=>String(url).startsWith('https://model.example')?Promise.resolve(Response.json({choices:[{message:{content:JSON.stringify({actions:[{type:'acquire',source:'hackernews',query:'nature',mode:'search',modality:'text'}]})}}]})):new Promise((_resolve,reject)=>{started();options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
  const controller=new AbortController();const task=handleApi(req('/api/run',{sessionId:session.session.session_id,command:'test'},controller.signal),env);await called;controller.abort();
  const response=await Promise.race([task,new Promise((_,reject)=>setTimeout(()=>reject(new Error('canceled retrieval did not finish')),1000))]);assert.equal(response.status,499);assert.equal((await response.json()).error,'请求已取消');assert.equal(await db.prepare('SELECT owner FROM active_operations').bind().first(),null);
});
test('cloud recommendation can complete an Apple source job from its own browser',async t=>{
  const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
  const ident=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'browser-test',type:'human'})}),env);const cookie=ident.headers.get('set-cookie').split(';')[0];
  const req=(path,data)=>new Request('https://example.test'+path,{method:data?'POST':'GET',headers:{cookie,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[],profile:''}),env)).json();const sid=session.session.session_id;
  await handleApi(req('/api/settings',{settings:{sources:['applepodcasts']}}),env);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async(url,opts)=>{if(!String(url).startsWith('https://model.example'))return new Response('',{status:429});const payload=JSON.parse(JSON.parse(opts.body).messages[1].content),items=(payload.tool_results||[]).flatMap(x=>x.items||[]);const actions=items.length?[{type:'recommend',candidate_ids:[items[0].id],reason:'test'}]:[{type:'acquire',source:'applepodcasts',query:'nature',mode:'search',modality:'text'}];return Response.json({choices:[{message:{content:JSON.stringify({actions})}}]});};
  const run=handleApi(req('/api/run',{sessionId:sid,command:'nature'}),env);let jobs=[];for(let i=0;i<50&&!jobs.length;i++){await new Promise(resolve=>setTimeout(resolve,10));jobs=(await (await handleApi(req('/api/source-jobs?sessionId='+sid),env)).json()).jobs||[];}assert.equal(jobs.length,1);
  const rows=[{collectionId:123,collectionName:'Nature',collectionViewUrl:'https://podcasts.apple.com/us/podcast/nature/id123'}];assert.equal((await handleApi(req('/api/source-jobs',{sessionId:sid,id:jobs[0].id,rows}),env)).status,200);
  const output=await (await run).json();assert.equal(output.run.slate[0].source,'applepodcasts');assert.equal(output.run.slate[0].source_item_id,'123');
});
test('Bilibili relay requires its secret and returns content through the normal recommendation',async t=>{
  const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),secret='a'.repeat(43),env={DB:db,BILIBILI_RELAY_TOKEN:secret,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
  const ident=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'relay-test',type:'human'})}),env);const cookie=ident.headers.get('set-cookie').split(';')[0];
  const req=(path,data,authorization)=>new Request('https://example.test'+path,{method:data?'POST':'GET',headers:{cookie,...(authorization?{authorization}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const s=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[],profile:''}),env)).json();const sid=s.session.session_id;await handleApi(req('/api/settings',{settings:{sources:['bilibili']}}),env);
  assert.equal((await handleApi(req('/api/bilibili-relay/jobs'),env)).status,401);assert.equal((await handleApi(req('/api/bilibili-relay/jobs',undefined,'Bearer wrong'),env)).status,401);
  assert.equal((await handleApi(req('/api/bilibili-relay/jobs',undefined,'Bearer '+secret),env)).status,200);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async(url,opts)=>{if(!String(url).startsWith('https://model.example'))return new Response('',{status:412});const input=JSON.parse(JSON.parse(opts.body).messages[1].content),items=(input.tool_results||[]).flatMap(x=>x.items||[]);const actions=items.length?[{type:'recommend',candidate_ids:[items[0].id],reason:'test'}]:[{type:'acquire',source:'bilibili',query:'自然',mode:'search',modality:'video'}];return Response.json({choices:[{message:{content:JSON.stringify({actions})}}]});};
  const run=handleApi(req('/api/run',{sessionId:sid,command:'自然'}),env);let jobs=[];for(let i=0;i<50&&!jobs.length;i++){await new Promise(resolve=>setTimeout(resolve,10));jobs=(await (await handleApi(req('/api/bilibili-relay/jobs',undefined,'Bearer '+secret),env)).json()).jobs||[];}assert.equal(jobs.length,1);
  assert.equal((await handleApi(req('/api/bilibili-relay/jobs',{id:jobs[0].id,rows:[{id:'BV1xx411c7mD',title:'自然'}]},'Bearer '+secret),env)).status,200);const output=await (await run).json();assert.equal(output.run.slate[0].url,'https://www.bilibili.com/video/BV1xx411c7mD');
});
test('accounts and research records persist independently for each username',async()=>{
  const db=database();const accounts=new CloudAccounts(db);
  const a=await accounts.selectIdentity({username:'小明',type:'human'}),b=await accounts.selectIdentity({username:'小红',type:'human'});
  const sa=new CloudStore(db);await sa.load(a.user.id);const sb=new CloudStore(db);await sb.load(b.user.id);
  const aSession=await sa.add('session',{session_id:'a',user_id:a.user.id,participant_id:a.user.id,record_kind:'human'});
  await sa.record('feedback','a',{track:'feed',value:'like'});await sb.add('session',{session_id:'b',user_id:b.user.id,participant_id:b.user.id,record_kind:'human'});
  const restored=new CloudStore(db);await restored.load(a.user.id);assert.equal(restored.rows.length,2);assert.equal(restored.rows[0].id,aSession.id);assert.equal(restored.rows[1].value,'like');assert(restored.rows[1].sequence>restored.rows[0].sequence);
  assert.equal((await accounts.getUser(a.token)).id,a.user.id);assert.equal((await accounts.getUser(b.token)).id,b.user.id);assert.notEqual(a.user.id,b.user.id);
  await assert.rejects(()=>accounts.selectIdentity({username:'小明',type:'agent'}),/类型/);
});

test('cloud handler persists a user session, choices, and export across requests',async t=>{
  const http=await import('node:http');const {createCloudHandler}=await import('../lib/waterfall/server.mjs');const db=database();
  const server=http.createServer((req,res)=>createCloudHandler({db,config:null}).handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  let cookie='';const base=`http://127.0.0.1:${server.address().port}`;
  async function req(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:r.status,body:await r.json()};}
  assert.equal((await req('/api/identity',{username:'alice',type:'human'})).status,200);
  const session=await req('/api/session',{consent:true,recordKind:'human',interests:[],profile:'阅读'});assert.equal(session.status,201);const sid=session.body.session.session_id;
  const round=await req('/api/blind/round',{sessionId:sid,renderedIds:[],pending:[]});assert.equal(round.status,201);const trial=round.body.comparison;
  assert.equal((await req('/api/blind/present',{sessionId:sid,comparisonId:trial.id,eventTime:new Date().toISOString()})).status,201);
  const choice=trial.unavailable?'insufficient':trial.same_content?'tie':'A';assert.equal((await req('/api/evaluate',{sessionId:sid,comparisonId:trial.id,choice,eventTime:new Date().toISOString()})).status,201);
  const output=await req(`/api/export?sessionId=${sid}&format=json`);assert.equal(output.status,200);assert.equal(output.body.blind_trials[0].choice.choice,choice);
  await req('/api/identity',{username:'bob',type:'human'});assert.equal((await req(`/api/export?sessionId=${sid}&format=json`)).status,404);
});

test('a blind question cannot receive duplicate votes during concurrent requests',async()=>{
  const db=database(),accounts=new CloudAccounts(db);const user=(await accounts.selectIdentity({username:'race',type:'human'})).user;
  const one=new CloudStore(db);await one.load(user.id);await one.add('session',{session_id:'race-session',user_id:user.id,participant_id:user.id,record_kind:'human'});
  const two=new CloudStore(db);await two.load(user.id);
  const results=await Promise.allSettled([one.record('evaluation','race-session',{comparison_id:'race-question',choice:'A'}),two.record('evaluation','race-session',{comparison_id:'race-question',choice:'B'})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
});

test('concurrent model operations are blocked while live progress remains readable',async t=>{
  const http=await import('node:http');const {createCloudHandler}=await import('../lib/waterfall/server.mjs');const db=database();let release,announce;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{announce=resolve;});
  const model=http.createServer(async(req,res)=>{for await(const _ of req){}announce();await gate;res.end(JSON.stringify({choices:[{message:{content:'{"actions":[{"type":"keep"}]}'}}]}));});await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const config={key:'fixture',endpoint:`http://127.0.0.1:${model.address().port}`,model:'fixture',timeoutMs:5000};const server=http.createServer((req,res)=>createCloudHandler({db,config,sourceConfig:{}}).handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{release();server.closeAllConnections();server.close();model.closeAllConnections();model.close();});let cookie='';const base=`http://127.0.0.1:${server.address().port}`;
  async function req(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;return {status:r.status,body:await r.json()};}
  await req('/api/identity',{username:'busy-user',type:'human'});const sid=(await req('/api/session',{consent:true,recordKind:'human',interests:[],profile:''})).body.session.session_id;
  const pending=req('/api/run',{sessionId:sid,command:'测试'});await started;
  assert.equal((await req('/api/run',{sessionId:sid,command:'重入'})).status,409);
  const progress=await req(`/api/progress?sessionId=${sid}`);assert.equal(progress.status,200);assert.equal(progress.body.phase,'planning');
  release();await pending;
});
