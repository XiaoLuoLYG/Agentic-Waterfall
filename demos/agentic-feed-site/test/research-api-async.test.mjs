import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudStore} from '../lib/waterfall/cloud-store.mjs';
import {fixture,account} from './research-api-fixture.mjs';
import {inputSnapshot} from '../lib/waterfall/core.mjs';
test('confirmed input retains a real command once under its original event identity and timestamp',async()=>{
 const f=fixture(),a=await account(f.env,'one-real-command'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const command=await store.record('command',a.sid,{track:'feed',text:'多看一点足球',event_time:'2026-10-30T01:00:00Z'}),snapshot=inputSnapshot(store,a.sid,command.text);
 snapshot.command_event_id=command.id;await store.record('input',a.sid,{track:'feed',input_snapshot:snapshot});
 const p=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation,events=p.public_input.evidence.filter(row=>row.type==='command');
 assert.equal(events.length,1);assert.equal(events[0].id,command.id);assert.equal(events[0].event_time,command.event_time);assert.equal(events[0].available_at,command.available_at);
});
test('rating and blind answers loaded before sealing cannot commit after identity disclosure',{timeout:3000},async()=>{
 for(const mode of ['rating','blind']){
  const f=fixture(),a=await account(f.env,'seal-race-'+mode),p=(await a.api('/api/research/prepare',{sessionId:a.sid,mode})).body.preparation;
  await a.api('/api/research/start',{sessionId:a.sid,mode,preparationId:p.id});f.jobs.get(p.id).status='succeeded';
  const study=(await a.api(`/api/research/current?sessionId=${a.sid}&mode=${mode}`)).body.study,q=(mode==='rating'?study.items:study.pairs)[0];
  await a.api('/api/research/present',{sessionId:a.sid,studyId:study.id,questionId:q.id,itemId:mode==='rating'?q.item.id:q.A[0].id});
  let resume,announce,hold=true;const held=new Promise(r=>announce=r),gate=new Promise(r=>resume=r),prepare=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare=query=>({bind(...args){const stmt=prepare(query).bind(...args);return {...stmt,async all(){const result=await stmt.all();if(hold&&query==='SELECT sequence,payload FROM events WHERE user_id = ? ORDER BY sequence'){hold=false;announce();await gate;}return result;}};}});
  const answering=a.api('/api/research/answer',{sessionId:a.sid,studyId:study.id,questionId:q.id,...(mode==='rating'?{rating:3,status:'rated'}:{choice:'A'})});
  await held;
  try{assert.equal((await a.api('/api/research/stop',{sessionId:a.sid,studyId:study.id})).status,201);assert.equal((await a.api(`/api/research/details?sessionId=${a.sid}&studyId=${study.id}`)).status,200);}finally{resume();}
  assert.equal((await answering).status,409);
  const store=new CloudStore(f.env.DB);await store.load(a.user);assert.equal(store.rows.filter(r=>r.kind==='evaluation'&&r.study_id===study.id).length,0);
 }
});
test('five-system jobs require owned current preparation and reuse the immutable confirmed input',async()=>{
 const f=fixture(),a=await account(f.env,'owned-input'),b=await account(f.env,'other-input');
 assert.equal((await a.api('/api/research/start',{sessionId:a.sid,mode:'rating'})).status,400);assert.equal(f.starts,0);
 const prepared=await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'});assert.equal(prepared.status,201,JSON.stringify(prepared.body));const p=prepared.body.preparation;assert.equal(p.methods.length,5);assert.equal(p.backend_ready,true);assert.equal(p.public_input.provided_profile.profile,'明确提供的摄影画像');
 assert.equal((await b.api('/api/research/start',{sessionId:b.sid,mode:'rating',preparationId:p.id})).status,404);
 await a.api('/api/settings',{settings:{interests:['新兴趣']}});assert.equal((await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:p.id})).status,409);assert.equal(f.starts,0);
 const next=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation,input={sessionId:a.sid,mode:'rating',preparationId:next.id};assert.equal((await a.api('/api/research/start',input)).status,202);assert.equal((await a.api('/api/research/start',input)).status,202);assert.equal(f.starts,1);
 const job=f.jobs.get(next.id);assert.deepEqual(job.snapshot.candidate_pool,[]);assert.deepEqual(job.snapshot.previous_slate_ids,[]);assert.deepEqual(job.snapshot.available_sources.map(x=>x.id),['zhihu']);
 assert.equal((await a.api('/api/blind/round',{sessionId:a.sid})).status,410);
});

test('successful artifact upload precedes study creation and sealed downloads survive backend loss',async()=>{
 const f=fixture(),a=await account(f.env,'archive-order'),b=await account(f.env,'archive-other');const p=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'blind'})).body.preparation;
 await a.api('/api/research/start',{sessionId:a.sid,mode:'blind',preparationId:p.id});f.jobs.get(p.id).status='succeeded';f.failPut=true;
 assert.equal((await a.api(`/api/research/current?sessionId=${a.sid}&mode=blind`)).status,503);const store=new CloudStore(f.env.DB);await store.load(a.user);assert.equal(store.rows.filter(x=>x.kind==='research_study').length,0);
 f.failPut=false;const completed=await a.api(`/api/research/current?sessionId=${a.sid}&mode=blind`);assert.equal(completed.status,200,JSON.stringify(completed.body));const study=completed.body.study;assert.equal(study.pairs.length,4);assert.ok(!JSON.stringify(study).includes('method_id'));assert.equal(f.objects.size,1);
 assert.equal((await a.api(`/api/research/details?sessionId=${a.sid}&studyId=${study.id}`)).status,409);assert.equal((await a.raw(`/api/research/artifact?sessionId=${a.sid}&studyId=${study.id}`)).status,409);assert.equal((await a.api(`/api/export?sessionId=${a.sid}`)).status,409);
 const data=(await a.api(`/api/research/data?sessionId=${a.sid}`)).body;assert.equal(data.studies[0].sealed,false);assert.ok(!JSON.stringify(data).includes('method_id'));
 await a.api('/api/research/stop',{sessionId:a.sid,studyId:study.id});delete f.env.RESEARCH_BACKEND;
 const details=(await a.api(`/api/research/details?sessionId=${a.sid}&studyId=${study.id}`)).body.details;assert.equal(details.methods.length,5);
 const raw=await a.raw(details.artifact_url);assert.equal(raw.status,200);assert.equal(raw.headers.get('content-type'),'application/gzip');assert.equal(Buffer.from(await raw.arrayBuffer())[0],31);
 assert.equal((await b.api(`/api/research/details?sessionId=${b.sid}&studyId=${study.id}`)).status,404);assert.equal((await b.raw(`/api/research/artifact?sessionId=${b.sid}&studyId=${study.id}`)).status,404);
 const exported=await a.api(`/api/export?sessionId=${a.sid}&format=json`);assert.equal(exported.status,200);assert.ok(!JSON.stringify(exported.body).includes('LARGE_PRIVATE_TRACE'));assert.ok(JSON.stringify(exported.body).includes('artifact_ref'));
});

test('account data includes sealed historical groups across sessions without revealing an unfinished legacy blind trial',async()=>{
 const f=fixture(),a=await account(f.env,'old-history'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const card={id:'old-card',title:'Original legacy card',url:'https://example.test/original'},legacy=await store.record('research_study',a.sid,{track:'evaluation',mode:'rating',context_hash:'old-context',input_snapshot:{captured_at:new Date().toISOString(),state:{profile:'original profile'},behavior:[]},items:[{id:'old-question',item:card}],pairs:[],mappings:[{method_id:'waterfall',rank:1,question_id:'old-question'}],result:{methods:[{method_id:'waterfall',status:'submitted',slate:[card],trace:[{original:'LEGACY_RAW'}]}]}});
 await store.record('evaluation',a.sid,{track:'evaluation',study_id:legacy.id,question_id:'old-question',grade_status:'rated',rating_value:3});
 await store.record('comparison',a.sid,{track:'blind',study_protocol:'blind-next-v1',mapping:{A:'PRIVATE_OLD_MAP',B:'old-opponent'},results:{}});
 const next=(await a.api('/api/session',{consent:true,recordKind:'human',interests:[],profile:''})).body.session.session_id;
 const data=await a.api(`/api/research/data?sessionId=${next}`);assert.equal(data.body.studies.length,2);assert.equal(data.body.studies[0].session_id,a.sid);assert.equal(data.body.studies[0].sealed,true);assert.equal(data.body.studies[1].legacy,true);assert.equal(data.body.studies[1].sealed,false);assert.ok(!JSON.stringify(data.body).includes('PRIVATE_OLD_MAP'));
 const details=await a.api(`/api/research/details?sessionId=${next}&studyId=${legacy.id}`);assert.equal(details.status,200);assert.ok(details.body.details.artifact_url.includes(encodeURIComponent(a.sid)));
 const artifact=await a.raw(details.body.details.artifact_url);assert.equal(artifact.status,200);const {gunzipSync}=await import('node:zlib');assert.ok(gunzipSync(Buffer.from(await artifact.arrayBuffer())).toString().includes('LEGACY_RAW'));
 assert.equal((await a.api(`/api/export?sessionId=${a.sid}`)).status,409);
 await store.load(a.user);assert.equal(store.rows.find(row=>row.id===legacy.id).result.methods[0].trace[0].original,'LEGACY_RAW');
});

test('offline backend, wrong identity and corrupt gzip never create a partial or fallback study',async()=>{
 const f=fixture(),a=await account(f.env,'fail-closed'),backend=f.env.RESEARCH_BACKEND;delete f.env.RESEARCH_BACKEND;
 const unavailable=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation;assert.equal(unavailable.backend_ready,false);assert.equal(unavailable.methods.length,5);
 assert.equal((await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:unavailable.id})).status,503);assert.equal(f.starts,0);f.env.RESEARCH_BACKEND=backend;
 const p=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation;
 await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:p.id});const job=f.jobs.get(p.id);job.status='succeeded';job.user_id='another-account';
 assert.equal((await a.api(`/api/research/current?sessionId=${a.sid}&mode=rating`)).status,502);job.user_id=a.user;job.bytes=Buffer.from([31,139,99]);
 assert.equal((await a.api(`/api/research/current?sessionId=${a.sid}&mode=rating`)).status,502);const store=new CloudStore(f.env.DB);await store.load(a.user);assert.equal(store.rows.filter(row=>row.kind==='research_study').length,0);assert.equal(f.objects.size,0);
});

test('a 23 MiB full result stays in gzip while concurrent polls create one small D1 study',async()=>{
 const f=fixture({makeResult:async({snapshot})=>({input_snapshot:snapshot,methods:['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'].map((method_id,index)=>({method_id,status:'submitted',method_version:'large-offline-fixture',slate:[{id:'card-'+index,title:'Public item',url:'https://example.test/'+index}],trace:[{large:index===0?'z'.repeat(23*1024*1024):''}]}))})}),a=await account(f.env,'large-artifact');
 const p=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation;await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:p.id});f.jobs.get(p.id).status='succeeded';
 const polls=await Promise.all([a.api(`/api/research/current?sessionId=${a.sid}&mode=rating`),a.api(`/api/research/current?sessionId=${a.sid}&mode=rating`)]);assert.ok(polls.every(response=>response.status===200));assert.equal(polls[0].body.study.id,polls[1].body.study.id);
 const store=new CloudStore(f.env.DB);await store.load(a.user);const studies=store.rows.filter(row=>row.kind==='research_study');assert.equal(studies.length,1);assert.ok(Buffer.byteLength(JSON.stringify(studies[0]))<100000);assert.ok(studies[0].artifact_ref.size<100000);
});

test('a failed task cannot hide a later successful group when refreshing to continue answers',async()=>{
 const f=fixture(),a=await account(f.env,'retry-and-refresh');
 const prepare=async()=> (await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation;
 const start=p=>a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:p.id});
 const current=()=>a.api(`/api/research/current?sessionId=${a.sid}&mode=rating`);
 const failed=await prepare();await start(failed);f.jobs.get(failed.id).status='failed';f.jobs.get(failed.id).error='offline fixture failure';
 assert.equal((await current()).body.pending.status,'failed');
 const retry=await prepare();assert.notEqual(retry.id,failed.id);await start(retry);f.jobs.get(retry.id).status='succeeded';
 const ready=await current();assert.equal(ready.status,200);const study=ready.body.study;assert.ok(study);
 const reference={sessionId:a.sid,studyId:study.id,questionId:study.items[0].id,itemId:study.items[0].item.id};
 assert.equal((await a.api('/api/research/present',reference)).status,201);
 const {itemId,...answer}=reference;assert.equal((await a.api('/api/research/answer',{...answer,rating:2,status:'rated'})).status,201);
 delete f.env.RESEARCH_BACKEND;const refreshed=await current();assert.equal(refreshed.status,200);assert.equal(refreshed.body.study?.id,study.id);assert.equal(refreshed.body.pending,undefined);assert.equal(refreshed.body.study.completed,1);assert.equal(refreshed.body.study.items.find(item=>item.id===answer.questionId).answered,true);assert.equal(f.starts,2);
});

test('explicitly stopping a legacy pending comparison preserves missing answers and unblocks only its owned export',async()=>{
 const f=fixture(),a=await account(f.env,'legacy-stop'),b=await account(f.env,'legacy-stop-other'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const legacy=await store.record('comparison',a.sid,{track:'blind',study_protocol:'blind-next-v1',mapping:{A:'PRIVATE_METHOD_A',B:'PRIVATE_METHOD_B'},assignment_probability:.5,input_snapshot:{captured_at:new Date().toISOString(),state:{profile:'Original own input'}},results:{PRIVATE_METHOD_A:{slate:[{id:'public-a',title:'Public A',url:'https://example.test/a'}]},PRIVATE_METHOD_B:{slate:[{id:'public-b',title:'Public B',url:'https://example.test/b'}]}}});
 const initial=(await a.api(`/api/research/data?sessionId=${a.sid}`)).body,group=initial.studies.find(study=>study.id===legacy.id);assert.ok(group);assert.equal(group.legacy,true);assert.equal(group.mode,'blind');assert.equal(group.total,1);assert.equal(group.completed,0);assert.equal(group.can_stop,true);assert.equal(group.sealed,false);assert.deepEqual(group.answers,[]);assert.ok(!JSON.stringify(initial).includes('PRIVATE_METHOD'));
 assert.equal((await a.api(`/api/export?sessionId=${a.sid}`)).status,409);assert.equal((await a.api(`/api/research/details?sessionId=${a.sid}&studyId=${legacy.id}`)).status,409);
 assert.equal((await b.api('/api/research/stop',{sessionId:b.sid,studyId:legacy.id})).status,404);
 const stopped=await a.api('/api/research/stop',{sessionId:a.sid,studyId:legacy.id});assert.equal(stopped.status,201);assert.equal(stopped.body.study.stopped,true);assert.equal(stopped.body.study.completed,0);
 assert.equal((await a.api(`/api/blind/current?sessionId=${a.sid}`)).body.comparison,null);
 const reference={sessionId:a.sid,comparisonId:legacy.id,eventTime:new Date().toISOString()};assert.equal((await a.api('/api/blind/present',reference)).status,409);assert.equal((await a.api('/api/evaluate',{...reference,choice:'insufficient'})).status,409);
 const after=(await a.api(`/api/research/data?sessionId=${a.sid}`)).body.studies.find(study=>study.id===legacy.id);assert.equal(after.sealed,true);assert.equal(after.can_stop,false);assert.deepEqual(after.answers,[]);
 const exported=await a.api(`/api/export?sessionId=${a.sid}&format=json`);assert.equal(exported.status,200);assert.equal(exported.body.blind_trials[0].choice,null);assert.equal(exported.body.research_stops[0].study_id,legacy.id);
 const details=(await a.api(`/api/research/details?sessionId=${a.sid}&studyId=${legacy.id}`)).body.details;assert.equal(details.methods.length,2);assert.equal(details.record.legacy,true);assert.equal(details.record.unknown,1);assert.deepEqual(details.record.answers,[]);assert.equal(details.record.questions[0].A[0].id,'public-a');assert.equal(details.record.mappings.A,'PRIVATE_METHOD_A');const download=await a.raw(details.artifact_url);assert.equal(download.status,200);const {gunzipSync}=await import('node:zlib'),raw=JSON.parse(gunzipSync(Buffer.from(await download.arrayBuffer())));assert.deepEqual(raw.answers,[]);assert.equal(raw.stops[0].study_id,legacy.id);assert.equal((await b.raw(`/api/research/artifact?sessionId=${b.sid}&studyId=${legacy.id}`)).status,404);
 await store.load(a.user);assert.equal(store.rows.filter(row=>row.kind==='evaluation'&&row.comparison_id===legacy.id).length,0);assert.deepEqual(store.rows.find(row=>row.id===legacy.id).mapping,legacy.mapping);
});

test('a legacy answer that loaded before an explicit stop rechecks that stop before writing',async()=>{
 const f=fixture(),a=await account(f.env,'legacy-stop-race'),store=new CloudStore(f.env.DB);await store.load(a.user);
 const card={id:'shown',title:'Shown public item',url:'https://example.test/shown'},trial=await store.record('comparison',a.sid,{track:'blind',study_protocol:'blind-next-v1',mapping:{A:'old-a',B:'old-b'},input_snapshot:{captured_at:new Date().toISOString()},results:{'old-a':{slate:[card]},'old-b':{slate:[{...card,id:'other',url:'https://example.test/other'}]}}});
 await a.api('/api/blind/present',{sessionId:a.sid,comparisonId:trial.id,eventTime:new Date().toISOString()});
 let resume,announce,hold=true;const held=new Promise(resolve=>{announce=resolve;}),gate=new Promise(resolve=>{resume=resolve;}),prepare=f.env.DB.prepare.bind(f.env.DB);
 f.env.DB.prepare=query=>({bind(...args){const statement=prepare(query).bind(...args);return {...statement,async all(){const result=await statement.all();if(hold&&query.includes('FROM events e WHERE e.user_id=?')){hold=false;announce();await gate;}return result;}};}});
 const answering=a.api('/api/evaluate',{sessionId:a.sid,comparisonId:trial.id,choice:'A',eventTime:new Date().toISOString()});await held;
 try{assert.equal((await a.api('/api/research/stop',{sessionId:a.sid,studyId:trial.id})).status,201);}finally{resume();}
 assert.equal((await answering).status,409);await store.load(a.user);assert.equal(store.rows.filter(row=>row.kind==='evaluation'&&row.comparison_id===trial.id).length,0);
});

test('sealed details JSON sidecar retains the actual score, 24 unknown answers and the original stop',async()=>{
 const f=fixture(),a=await account(f.env,'scored-sidecar'),b=await account(f.env,'other-sidecar');
 const preparation=(await a.api('/api/research/prepare',{sessionId:a.sid,mode:'rating'})).body.preparation;await a.api('/api/research/start',{sessionId:a.sid,mode:'rating',preparationId:preparation.id});f.jobs.get(preparation.id).status='succeeded';const study=(await a.api(`/api/research/current?sessionId=${a.sid}&mode=rating`)).body.study;
 const path=`/api/research/details?sessionId=${a.sid}&studyId=${encodeURIComponent(study.id)}`;
 assert.equal((await a.raw(path+'&download=1')).status,409);
 const question=study.items[0];await a.api('/api/research/present',{sessionId:a.sid,studyId:study.id,questionId:question.id,itemId:question.item.id});await a.api('/api/research/answer',{sessionId:a.sid,studyId:study.id,questionId:question.id,rating:3,status:'rated'});await a.api('/api/research/stop',{sessionId:a.sid,studyId:study.id});
 f.env.RESEARCH_ARCHIVE.get=async()=>{throw Error('sidecar must not read method gzip');};f.env.RESEARCH_BACKEND.artifact=async()=>{throw Error('sidecar must not fetch method gzip');};
 const details=await a.api(path),response=await a.raw(path+'&download=1');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment; filename="waterfall-[a-f0-9]+-record\.json"$/);const downloaded=await response.json();assert.deepEqual(downloaded,details.body);
 const record=downloaded.details.record;assert.ok(record.version);assert.equal(record.study_id,study.id);assert.equal(record.session_id,a.sid);assert.equal(record.mode,'rating');assert.equal(record.legacy,false);assert.equal(record.data_origin,'human');assert.equal(record.history_cutoff.captured_at,preparation.captured_at);assert.equal(record.input.captured_at,preparation.captured_at);assert.equal(record.total,25);assert.equal(record.completed,1);assert.equal(record.unknown,24);assert.equal(record.stopped,true);assert.equal(record.questions.length,25);assert.equal(record.mappings.length,25);assert.equal(record.answers.length,1);assert.equal(record.answers[0].rating_value,3);assert.equal(record.stops.length,1);assert.ok(record.artifact_ref.sha256);assert.equal(record.artifact_url,downloaded.details.artifact_url);
 const store=new CloudStore(f.env.DB);await store.load(a.user);assert.deepEqual(record.answers[0],store.rows.find(row=>row.kind==='evaluation'&&row.study_id===study.id));assert.deepEqual(record.stops[0],store.rows.find(row=>row.kind==='research_stop'&&row.study_id===study.id));
 assert.equal((await b.raw(`/api/research/details?sessionId=${b.sid}&studyId=${encodeURIComponent(study.id)}&download=1`)).status,404);
});
