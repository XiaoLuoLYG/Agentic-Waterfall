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
function agentResponse(options,source,query,modality='text'){
 const obs=JSON.parse(JSON.parse(options.body).messages[1].content).observation,items=obs.environment.candidate_pool;
 const action=items.length?{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:[items[0].id],delivery:'replace_pending'}}:{action_id:'get',kind:'acquire',arguments:{source_ids:[source],query,mode:'search',content_types:[modality],limit:10}};
 return Response.json({choices:[{message:{content:JSON.stringify({decision_id:obs.decision_id,actions:[{...action,evidence_refs:[],depends_on:[]}]})}}]});
}
test('saving a reading event does not load unrelated large model traces',async()=>{
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs'),db=database(),env={DB:db};
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'reading-memory-test',type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];
 const req=(path,data)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
 const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[]}),env)).json(),sid=session.session.session_id,store=new CloudStore(db);await store.load(session.session.user_id);
 const card={id:'item',title:'reading',source:'bilibili',topic:'photo'};
 await store.record('run',sid,{track:'feed',result:{slate:[card],content_snapshot:{id:'old-snapshot',items:[{...card,summary:'z'.repeat(1000000)}]}}});
 const run=await store.record('run',sid,{track:'feed',result:{slate:[card],content_snapshot:{id:'snapshot',items:[card]},trace:[{messages:'x'.repeat(1000000)}]}});
 await store.record('decision_trace',sid,{track:'feed',trace:{messages:'y'.repeat(1000000)}});
 const prepare=db.prepare.bind(db);let readBytes=0;db.prepare=sql=>({bind(...args){const q=prepare(sql).bind(...args);return {...q,async all(){const result=await q.all();if(/from events/i.test(sql))readBytes+=result.results.reduce((sum,row)=>sum+Buffer.byteLength(row.payload||''),0);return result;}};}});
 const event=await handleApi(req('/api/event',{sessionId:sid,type:'exposure',track:'feed',referenceId:run.id,contentId:card.id,position:1,exposureId:'00000000-0000-4000-8000-000000000000',phase:'start',visibleMs:0,eventTime:new Date().toISOString()}),env);
 assert.equal(event.status,201,JSON.stringify(await event.json()));assert(readBytes<100000,`event loaded ${readBytes} bytes of historical records`);
 readBytes=0;const command=await handleApi(req('/api/interaction',{sessionId:sid,type:'command',text:'more',eventTime:new Date().toISOString()}),env);assert.equal(command.status,201);assert(readBytes<100000,`command loaded ${readBytes} bytes of historical records`);
 const exported=await handleApi(new Request(`https://example.test/api/export?sessionId=${sid}&format=jsonl`,{headers:{cookie}}),env);assert.equal(exported.status,200);assert((await exported.text()).includes('y'.repeat(1000)));
});
test('compact loading keeps the newest candidate snapshot and preserves complete history on disk',async()=>{
 const db=database(),user=(await new CloudAccounts(db).selectIdentity({username:'compact-snapshots',type:'human'})).user,store=new CloudStore(db);await store.load(user.id);
 await store.add('session',{session_id:'s',user_id:user.id,participant_id:user.id,record_kind:'human'});
 const old=await store.record('run','s',{track:'feed',result:{slate:[],content_snapshot:{id:'old',items:[{id:'old-item'}]},trace:[{message:'old trace'}]}});
 const latest=await store.record('run','s',{track:'feed',result:{slate:[],content_snapshot:{id:'new',items:[{id:'new-item'}]}}});
 const compact=new CloudStore(db);await compact.load(user.id,{compact:true});assert.equal(compact.rows.find(r=>r.id===old.id).result.content_snapshot.items,undefined);assert.deepEqual(compact.rows.find(r=>r.id===latest.id).result.content_snapshot.items,[{id:'new-item'}]);
 const full=new CloudStore(db);await full.load(user.id);assert.equal(full.rows.find(r=>r.id===old.id).result.content_snapshot.items[0].id,'old-item');assert.equal(full.rows.find(r=>r.id===old.id).result.trace[0].message,'old trace');
});
test('feedback starts a new agent decision while the previous decision is still running',async t=>{
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'feedback-overlap',type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];
 const req=(path,data)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
 const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[]}),env)).json(),sid=session.session.session_id,store=new CloudStore(db);await store.load(session.session.user_id);
 const card={id:'item-1',title:'旧内容',source:'bilibili',topic:'摄影'};const first=await store.record('run',sid,{track:'feed',result:{slate:[card],content_snapshot:{id:'c',items:[card]}}});
 let release,announce,calls=0,secondObservation;const started=new Promise(resolve=>{announce=resolve}),gate=new Promise(resolve=>{release=resolve});
 t.mock.method(globalThis,'fetch',async(url,options)=>{if(new URL(url).hostname==='hn.algolia.com')return Response.json({hits:[{objectID:'123',title:'新摄影内容'}]});const obs=JSON.parse(JSON.parse(options.body).messages[1].content).observation;let action;if(++calls===1){announce();await gate;action={action_id:'keep',kind:'idle',arguments:{mode:'keep'}};}else{secondObservation=obs;action=obs.environment.candidate_pool.length?{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:[obs.environment.candidate_pool[0].id],delivery:'replace_pending'}}:{action_id:'get',kind:'acquire',arguments:{source_ids:['hackernews'],query:'摄影',mode:'search',content_types:['text'],limit:10}};}return Response.json({choices:[{message:{content:JSON.stringify({decision_id:obs.decision_id,actions:[{...action,evidence_refs:[],depends_on:[]}]})}}]});});
 const old=handleApi(req('/api/run',{sessionId:sid,command:'',trigger:'prefetch'}),env);await started;
 try{
  const feedback=await handleApi(req('/api/event',{sessionId:sid,type:'feedback',track:'feed',referenceId:first.id,contentId:card.id,position:1,value:'dislike',eventTime:new Date().toISOString()}),env);assert.equal(feedback.status,201);
  const next=await Promise.race([handleApi(req('/api/run',{sessionId:sid,command:'',trigger:'feedback'}),env),new Promise((_,reject)=>setTimeout(()=>reject(new Error('new agent did not start')),1000))]);
  const result=await next.json();assert.equal(next.status,200,JSON.stringify(result));assert(secondObservation.behavior_events.some(x=>x.value==='dislike'));assert.equal(result.run.slate[0].title,'新摄影内容');
 }finally{release();assert.equal((await old).status,409);}
 const progress=await db.prepare('SELECT payload FROM progress WHERE session_id=?').bind(sid).first();assert.equal(JSON.parse(progress.payload).phase,'complete');
});
test('cloud feed calls the shared agent core and delivers a larger real-source batch',async t=>{
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database();const env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'shared-core-test',type:'human'})}),env);const cookie=identity.headers.get('set-cookie').split(';')[0];
 const req=(path,data)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
 const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[],profile:''}),env)).json();let calls=0;
 t.mock.method(globalThis,'fetch',async(address,options)=>{const url=new URL(address);if(url.hostname==='api.bilibili.com')return Response.json({code:0,data:{result:[{result_type:'video',data:Array.from({length:12},(_,n)=>({bvid:`BV${String(n).padStart(10,'0')}`,title:`摄影 ${n}`}))}]}});assert.equal(url.hostname,'model.example');const body=JSON.parse(options.body),obs=JSON.parse(body.messages[1].content).observation;calls++;const a=calls===1?{action_id:'get',kind:'acquire',arguments:{source_ids:['bilibili'],mode:'search',query:'摄影',content_types:['video'],limit:50}}:{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:obs.environment.candidate_pool.map(x=>x.id),delivery:'replace_pending'}};return Response.json({choices:[{message:{content:JSON.stringify({decision_id:obs.decision_id,actions:[{...a,evidence_refs:[],depends_on:[]}]})},finish_reason:'stop'}]});});
 const response=await handleApi(req('/api/run',{sessionId:session.session.session_id,command:'摄影'}),env),body=await response.json();
 assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.run.slate.length,12);assert.equal(body.run.trace[0].phase,'unified');assert.equal(calls,2);
 const exported=await (await handleApi(new Request(`https://example.test/api/export?sessionId=${session.session.session_id}&format=json`,{headers:{cookie}}),env)).json();
 assert(exported.decisions.some(d=>d.phase==='unified'&&d.normalized_output?.actions?.some(a=>a.kind==='recommend')));
 const callsView=await (await handleApi(new Request(`https://example.test/api/model-calls?sessionId=${session.session.session_id}`,{headers:{cookie}}),env)).json();assert(callsView.calls.unified);
});
test('a newer feedback prevents committing an older cloud recommendation',async()=>{
 const db=database(),accounts=new CloudAccounts(db),user=(await accounts.selectIdentity({username:'freshness',type:'human'})).user;
 const first=new CloudStore(db);await first.load(user.id);await first.add('session',{session_id:'s',user_id:user.id,participant_id:user.id,record_kind:'human'});
 const input=await first.record('input','s',{track:'feed'});const other=new CloudStore(db);await other.load(user.id);await other.record('feedback','s',{track:'feed',value:'dislike'});
 assert.equal(await first.recordIfCurrent('run','s',{track:'feed',result:{}},input.sequence),null);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='run'").bind().first()).n,0);
});
test('a replaced agent cannot commit even when no later feedback was recorded',async()=>{
 const db=database(),user=(await new CloudAccounts(db).selectIdentity({username:'owner-freshness',type:'human'})).user,store=new CloudStore(db);await store.load(user.id);
 await store.add('session',{session_id:'s',user_id:user.id,participant_id:user.id,record_kind:'human'});const input=await store.record('input','s',{});
 await db.prepare('INSERT INTO active_operations (user_id,owner,kind,expires_at) VALUES (?,?,?,?)').bind(user.id,'new-owner','/api/run',Date.now()+10000).run();
 assert.equal(await store.recordIfCurrent('run','s',{result:{}},input.sequence,'old-owner'),null);
});
test('a newer command rejects a stale cloud result across requests',async t=>{
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'stale-cloud',type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];
 const req=(path,data)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
 const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[]}),env)).json(),sid=session.session.session_id;let release,announce;const started=new Promise(resolve=>{announce=resolve}),gate=new Promise(resolve=>{release=resolve});
 t.mock.method(globalThis,'fetch',async(_address,options)=>{const obs=JSON.parse(JSON.parse(options.body).messages[1].content).observation;announce();await gate;return Response.json({choices:[{message:{content:JSON.stringify({decision_id:obs.decision_id,actions:[{action_id:'keep',kind:'idle',arguments:{mode:'keep'},evidence_refs:[],depends_on:[]}]})}}]});});
 const running=handleApi(req('/api/run',{sessionId:sid,command:'旧要求'}),env);await started;let result;
 try{assert.equal((await handleApi(req('/api/interaction',{sessionId:sid,type:'command',text:'新要求',eventTime:new Date().toISOString()}),env)).status,201);}finally{release();result=await running;}
 assert.equal(result.status,409);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='run'").bind().first()).n,0);
});
test('cloud session changes preserve prior session-scoped state and context',async()=>{
 const {startSession}=await import('../lib/waterfall/core.mjs');const db=database(),accounts=new CloudAccounts(db),user=(await accounts.selectIdentity({username:'history-owner',type:'human'})).user,store=new CloudStore(db);await store.load(user.id);
 const opts={consent:true,recordKind:'human',interests:[]},first=await startSession(store,opts,user);
 const prior={...store.state(first.session_id),context:'旧情境',entries:[{target:'goal',value:'旧任务',topic:'学习',scope:'session',lifetime:'session'}]};
 const next=await startSession(store,opts,user,prior,first.session_id),state=store.state(next.session_id);
 assert(state.entries.some(e=>e.value==='旧任务'&&e.origin_session_id===first.session_id));assert(state.entries.some(e=>e.value==='旧情境'&&e.origin_session_id===first.session_id));
});
test('cloud agent can retrieve an older command on demand',async t=>{
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'history-agent-test',type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0],user=(await identity.json()).user;
 const req=(path,data)=>new Request('https://example.test'+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
 const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[]}),env)).json(),sid=session.session.session_id,store=new CloudStore(db);await store.load(user.id);
 const old=await store.record('command',sid,{track:'feed',text:'不要标题党'});let calls=0;
 t.mock.method(globalThis,'fetch',async(_address,options)=>{const obs=JSON.parse(JSON.parse(options.body).messages[1].content).observation;calls++;assert.equal(obs.environment.recommendation_constraints.history_lookup_enabled,true);if(calls===2)assert(obs.dialogue.some(x=>x.id===old.id));const a=calls===1?{action_id:'history',kind:'lookup_history',arguments:{query:'标题',offset:0,limit:10}}:{action_id:'keep',kind:'idle',arguments:{mode:'keep'}};return Response.json({choices:[{message:{content:JSON.stringify({decision_id:obs.decision_id,actions:[{...a,evidence_refs:[],depends_on:[]}]})}}]});});
 const response=await handleApi(req('/api/run',{sessionId:sid,command:''}),env);assert.equal(response.status,200);assert.equal(calls,2);
});
test('cloud progress delivers the first source while another remains in flight',async t=>{
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'early-owner',type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];
 const req=(path,data)=>new Request('https://example.test'+path,{method:data?'POST':'GET',headers:{cookie,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[]}),env)).json(),sid=session.session.session_id;let release;const gate=new Promise(resolve=>{release=resolve});
 t.mock.method(globalThis,'fetch',async(address,options)=>{const host=new URL(address).hostname;if(host==='api.bilibili.com')return Response.json({code:0,data:{result:[{result_type:'video',data:[{bvid:'BV1234567890',title:'先到内容'}]}]}});if(host==='hn.algolia.com'){await gate;return Response.json({hits:[{objectID:'123',title:'后到内容'}]});}const {observation:obs,context}=JSON.parse(JSON.parse(options.body).messages[1].content);const action=(action_id,kind,args)=>({action_id,kind,arguments:args,evidence_refs:[],depends_on:[]});const actions=context.call_index===0?[action('fast','acquire',{source_ids:['bilibili'],mode:'search',query:'摄影',content_types:['video'],limit:10}),action('slow','acquire',{source_ids:['hackernews'],mode:'search',query:'photo',content_types:['text'],limit:10})]:[action(`rank-${context.call_index}`,'recommend',{ordered_item_ids:[obs.environment.candidate_pool[0].id],delivery:'replace_pending'})];return Response.json({choices:[{message:{content:JSON.stringify({decision_id:obs.decision_id,actions})}}]});});
 const running=handleApi(req('/api/run',{sessionId:sid,command:'摄影'}),env);let early;
 try{for(let i=0;i<100&&!early;i++){await new Promise(resolve=>setTimeout(resolve,10));early=(await (await handleApi(req(`/api/progress?sessionId=${sid}`),env)).json()).early_run;}assert.equal(early?.slate[0].title,'先到内容');}finally{release();}
 assert.equal((await running).status,200);
});
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
  globalThis.fetch=(url,options)=>String(url).startsWith('https://model.example')?Promise.resolve(agentResponse(options,'hackernews','nature')):new Promise((_resolve,reject)=>{started();options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
  const controller=new AbortController();const task=handleApi(req('/api/run',{sessionId:session.session.session_id,command:'test'},controller.signal),env);await called;controller.abort();
  const response=await Promise.race([task,new Promise((_,reject)=>setTimeout(()=>reject(new Error('canceled retrieval did not finish')),1000))]);assert.equal(response.status,499);assert.equal((await response.json()).error,'请求已取消');assert.equal(await db.prepare('SELECT owner FROM active_operations').bind().first(),null);
});
test('cloud recommendation can complete an Apple source job from its own browser',async t=>{
  const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');const db=database(),env={DB:db,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};
  const ident=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'browser-test',type:'human'})}),env);const cookie=ident.headers.get('set-cookie').split(';')[0];
  const req=(path,data)=>new Request('https://example.test'+path,{method:data?'POST':'GET',headers:{cookie,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const session=await (await handleApi(req('/api/session',{consent:true,recordKind:'human',interests:[],profile:''}),env)).json();const sid=session.session.session_id;
  await handleApi(req('/api/settings',{settings:{sources:['applepodcasts']}}),env);
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async(url,opts)=>String(url).startsWith('https://model.example')?agentResponse(opts,'applepodcasts','nature'):new Response('',{status:429});
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
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async(url,opts)=>String(url).startsWith('https://model.example')?agentResponse(opts,'bilibili','自然','video'):new Response('',{status:412});
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
