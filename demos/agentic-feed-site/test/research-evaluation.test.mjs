import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../lib/waterfall/cloud-entry.mjs';
import {CloudStore} from '../lib/waterfall/cloud-store.mjs';
import {inputSnapshot} from '../lib/waterfall/core.mjs';
import {researchMetrics,publicStudy} from '../lib/waterfall/research.mjs';
import {fixture} from './research-api-fixture.mjs';
import {gunzipSync} from 'node:zlib';

function database(){
 const db=new DatabaseSync(':memory:');
 for(const name of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(`drizzle/${name}`,'utf8'));
 return {prepare(sql){return {bind(...args){const stmt=db.prepare(sql);return {async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){stmt.run(...args);return {success:true};}};}};}};
}
async function account(env,name='evaluation-test',recordKind='human'){
 if(!env.RESEARCH_BACKEND){const f=fixture({makeResult:env.RESEARCH_RUNNER});env.RESEARCH_BACKEND=f.env.RESEARCH_BACKEND;env.RESEARCH_ARCHIVE=f.env.RESEARCH_ARCHIVE;const start=env.RESEARCH_BACKEND.start.bind(env.RESEARCH_BACKEND);env.RESEARCH_BACKEND.start=async input=>{await start(input);f.jobs.get(input.job_id).status='succeeded';return env.RESEARCH_BACKEND.poll(input.job_id);};}
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name,type:'human'})}),env);
 assert.equal(identity.status,200);
 const cookie=identity.headers.get('set-cookie').split(';')[0];
 const request=async(path,data)=>{const r=await handleApi(new Request('https://example.test'+path,{headers:{cookie,'content-type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})}),env);return {status:r.status,body:await r.json()};};
 const created=await request('/api/session',{consent:true,recordKind,interests:[]});
 const raw=(path)=>handleApi(new Request('https://example.test'+path,{headers:{cookie}}),env);return {request,raw,session:created.body.session};
}
async function begin(a,mode='rating'){const {preparation}=(await a.request('/api/research/prepare',{sessionId:a.session.session_id,mode})).body;return a.request('/api/research/start',{sessionId:a.session.session_id,mode,preparationId:preparation.id});}
const item=n=>({id:`item-${n}`,title:`Content ${n}`,summary:'A recorded public preview',source:'zhihu',modality:'text',url:`https://example.org/content/${n}`});
async function feed(env,session){
 const store=new CloudStore(env.DB);await store.load(session.user_id);
 const snapshot={id:'original-cutoff',captured_at:new Date().toISOString(),state:store.state(session.session_id),behavior:[],recent_commands:[],available_sources:[]};
 return store.record('run',session.session_id,{track:'feed',result:{policy_id:'joint-v1',runtime_source_sha256:'current-core',input_snapshot:snapshot,slate:[1,2,3,4,5,6].map(item),content_snapshot:{id:'content-version',items:[1,2,3,4,5,6].map(item)},trace:[]}});
}

test('content grades stay outside recommendation inputs and remain in the private export',async()=>{
 const env={DB:database()},a=await account(env);await feed(env,a.session);
 const started=await begin(a,'rating');
 assert.equal(started.status,201,JSON.stringify(started.body));const study=started.body.study;
 assert.equal(study.items.length,25);assert.equal(JSON.stringify(study).includes('current-core'),false);
 const questionId=study.items[0].id;
 assert.equal((await a.request('/api/research/present',{sessionId:a.session.session_id,studyId:study.id,questionId})).status,201);
 assert.equal((await a.request('/api/research/answer',{sessionId:a.session.session_id,studyId:study.id,questionId,rating:3,status:'rated'})).status,201);
 await a.request('/api/research/stop',{sessionId:a.session.session_id,studyId:study.id});
 const exported=await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`);
 assert.equal(exported.body.content_ratings.length,1);assert.equal(exported.body.content_ratings[0].rating_value,3);
 assert.equal(exported.body.content_ratings[0].rubric_version,'interest-0-3/v1');
 assert.equal(exported.body.research_studies[0].annotation_policy,'evaluation_only');
 const store=new CloudStore(env.DB);await store.load(a.session.user_id);
 const snapshot=inputSnapshot(store,a.session.session_id,'',{},[],[],[]);
 assert.equal(JSON.stringify(snapshot).includes(study.id),false);
 assert.equal(store.rows.filter(r=>r.kind==='feedback').length,0);
});

test('synthetic QA answers carry an explicit origin and the frozen context reference',async()=>{
 const env={DB:database()},a=await account(env,'qa-origin','synthetic');await feed(env,a.session);
 const {study}=(await begin(a,'rating')).body;
 const reference={sessionId:a.session.session_id,studyId:study.id,questionId:study.items[0].id};
 await a.request('/api/research/present',reference);await a.request('/api/research/answer',{...reference,rating:2,status:'rated'});
 await a.request('/api/research/stop',{sessionId:a.session.session_id,studyId:study.id});
 const exported=(await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`)).body,label=exported.content_ratings[0];
 assert.equal(label.origin,'synthetic');assert.equal(label.simulated,true);assert.equal(label.context_hash,exported.research_studies[0].context_hash);assert.equal(label.content_id,study.items[0].item.id);
});

test('grading requires actual presentation, valid integer labels and one answer per question',async()=>{
 const env={DB:database()},a=await account(env);await feed(env,a.session);
 const {study}= (await begin(a,'rating')).body;
 assert.ok(study,'a rating study must exist');const questionId=study.items[0].id;
 const answer={sessionId:a.session.session_id,studyId:study.id,questionId,rating:2,status:'rated'};
 assert.equal((await a.request('/api/research/answer',answer)).status,409);
 await a.request('/api/research/present',{sessionId:a.session.session_id,studyId:study.id,questionId});
 assert.equal((await a.request('/api/research/answer',{...answer,rating:'2'})).status,400);
 assert.equal((await a.request('/api/research/answer',{...answer,rating:4})).status,400);
 assert.equal((await a.request('/api/research/answer',{...answer,status:'unable'})).status,400);
 const attempts=await Promise.all([a.request('/api/research/answer',answer),a.request('/api/research/answer',answer)]);
 assert.deepEqual(attempts.map(x=>x.status).sort(),[201,409]);
});

test('a different account cannot present or answer another participant study',async()=>{
 const env={DB:database()},a=await account(env),b=await account(env,'other-evaluation-test');await feed(env,a.session);
 const {study}=(await begin(a,'rating')).body;
 assert.ok(study);assert.equal((await b.request('/api/research/present',{sessionId:b.session.session_id,studyId:study.id,questionId:study.items[0].id})).status,404);
});

test('five-method output is anonymized, deduplicated for ratings and retained unmodified in export',async()=>{
 const methods=['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'];
 const env={DB:database(),RESEARCH_RUNNER:async({snapshot,history})=>{
  assert(history.every(r=>!['evaluation','research_study','research_presentation'].includes(r.kind)));
  return {input_snapshot:snapshot,environment:{catalog_id:'frozen-qa',test_only:true},methods:methods.map((method_id,i)=>({method_id,status:'submitted',slate:[1,2,3,4,5].map(n=>item(i===1&&n===1?1:i*5+n)),trace:[{private:'private-trace'}]}))};
 }};
 const a=await account(env);await feed(env,a.session);
 const rated=await begin(a,'rating');assert.equal(rated.status,201);
 assert.equal(rated.body.study.items.length,24);
 assert.equal(JSON.stringify(rated.body.study).includes('private-trace'),false);
 assert.equal(JSON.stringify(rated.body.study).includes('method_id'),false);
 await a.request('/api/research/stop',{sessionId:a.session.session_id,studyId:rated.body.study.id});
 const exported=(await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`)).body;
 assert.equal(exported.research_studies[0].summary.methods.length,5);assert.ok(!JSON.stringify(exported).includes('private-trace'));
 const original=JSON.parse(gunzipSync(Buffer.from(await (await a.raw(exported.research_studies[0].artifact_url)).arrayBuffer())));assert.equal(original.methods[0].trace[0].private,'private-trace');
});

test('blind lists compare Waterfall with four opponents, preserving failed allocations',async()=>{
 const env={DB:database(),RESEARCH_RUNNER:async()=>({environment:{catalog_id:'frozen-qa'},methods:['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'].map((method_id,i)=>({method_id,status:i===2?'not_applicable':'submitted',slate:i===2?[]:[1,2,3,4,5].map(n=>item(i*5+n)),trace:[]}))})};
 const a=await account(env);await feed(env,a.session);
 const started=await begin(a,'blind');assert.equal(started.status,201);
 assert.equal(started.body.study.pairs.length,4);assert.equal(started.body.study.pairs.filter(x=>x.unavailable).length,1);assert.equal(started.body.study.incomplete_methods,1);
 for(const pair of started.body.study.pairs.filter(x=>!x.unavailable)){assert.equal(pair.A.length,5);assert.equal(pair.B.length,5);}
 assert.equal(JSON.stringify(started.body.study).includes('method_id'),false);
});

test('legacy blind creation is retired while existing recorded questions remain answerable',async()=>{
 const env={DB:database()},a=await account(env);const store=new CloudStore(env.DB);await store.load(a.session.user_id);
 const comparison=await store.record('comparison',a.session.session_id,{track:'blind',study_protocol:'blind-next-v1',input_snapshot:{id:'historical-input'},mapping:{A:'joint-v1',B:'fixed-retrieval-v1'},assignment_probability:.5,results:{'joint-v1':{slate:[item(1)],trace:[{phase:'unified',historical:true}]},'fixed-retrieval-v1':{slate:[item(2)]}}});
 assert.equal((await a.request('/api/blind/round',{sessionId:a.session.session_id})).status,410);
 assert.equal((await a.request('/api/blind/present',{sessionId:a.session.session_id,comparisonId:comparison.id,eventTime:new Date().toISOString()})).status,201);
 assert.equal((await a.request('/api/evaluate',{sessionId:a.session.session_id,comparisonId:comparison.id,choice:'A',eventTime:new Date().toISOString()})).status,201);
 const exported=(await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`)).body;assert.equal(exported.blind_trials[0].comparison.results['joint-v1'].trace[0].phase,'unified');
});

test('linear DCG keeps genuine zeros, missing grades and failed delivery distinct',()=>{
 const study={kind:'research_study',id:'s',mode:'rating',context_hash:'c',result:{methods:[{method_id:'waterfall',status:'submitted'},{method_id:'failed-method',status:'failed'}]},mappings:[0,1,2,3,4].map(index=>({method_id:'waterfall',rank:index+1,question_id:`q${index}`}))};
 const grades=[0,1,2,0,1].map((rating_value,index)=>({kind:'evaluation',study_id:'s',question_id:`q${index}`,rating_value,grade_status:'rated'}));
 const full=researchMetrics([study,...grades])[0].methods;
 assert(Math.abs(full[0].dcg_at_5-2.0177825608059994)<1e-9);assert.equal(full[0].observed_reward,4);assert.equal(full[0].unknown,0);
 assert.equal(full[1].delivered,0);assert.equal(full[1].dcg_at_5,0);
 const partial=researchMetrics([study,...grades.slice(1)])[0].methods[0];assert.equal(partial.dcg_at_5,null);assert.equal(partial.unknown,1);assert.equal(partial.dcg_upper-partial.dcg_lower,3);
});

test('research opens and returns are archived separately from natural browsing',async()=>{
 const env={DB:database()},a=await account(env);await feed(env,a.session);
 const {study}=(await begin(a,'rating')).body;
 const reference={sessionId:a.session.session_id,studyId:study.id,questionId:study.items[0].id,itemId:study.items[0].item.id};
 assert.equal((await a.request('/api/research/interaction',{...reference,event:'return'})).status,400);
 assert.equal((await a.request('/api/research/interaction',{...reference,event:'open'})).status,201);
 assert.equal((await a.request('/api/research/interaction',{...reference,event:'return'})).status,201);
 await a.request('/api/research/stop',{sessionId:a.session.session_id,studyId:study.id});
 const exported=(await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`)).body;
 assert.equal(exported.research_events.length,2);assert(exported.event_log.every(row=>!row.payload.study_id));
});

test('unfinished anonymous studies cannot reveal private mappings through export; ending seals answers',async()=>{
 const env={DB:database()},a=await account(env);await feed(env,a.session);
 const {study}=(await begin(a,'rating')).body;
 assert.equal((await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`)).status,409);
 assert.equal((await a.request('/api/research/stop',{sessionId:a.session.session_id,studyId:study.id})).status,201);
 assert.equal((await a.request(`/api/export?sessionId=${a.session.session_id}&format=json`)).status,200);
 const questionId=study.items[0].id;await a.request('/api/research/present',{sessionId:a.session.session_id,studyId:study.id,questionId});
 assert.equal((await a.request('/api/research/answer',{sessionId:a.session.session_id,studyId:study.id,questionId,rating:1,status:'rated'})).status,409);
});

test('legacy single-method rating groups expose absent allocations without inventing failures',()=>{
 const method={method_id:'waterfall',status:'submitted',slate:[1,2,3,4,5].map(item)};
 const study={id:'old',session_id:'s',kind:'research_study',mode:'rating',items:[],pairs:[],result:{methods:[method]}};
 const original=JSON.stringify(study),view=publicStudy({rows:[]},study);assert.equal(view.incomplete_methods,4);assert.equal(JSON.stringify(study),original);assert.ok(!JSON.stringify(view).includes('method_id'));
});

test('preparation discloses selected sources unavailable to the common backend before starting',async()=>{
 const env={DB:database(),WATERFALL_CONFIG:JSON.stringify({apiKey:'fictional-test-key',apiBase:'https://model.example/v1',modelName:'fictional-test-model',providers:{ZHIHU_API_KEY:'fictional-test-key'}}),COMPOSIO_CONFIG:JSON.stringify({apiKey:'fictional-test-key',userId:'fictional-test-user',baseUrl:'https://backend.composio.dev/api/v3.1'})},a=await account(env);let starts=0;const start=env.RESEARCH_BACKEND.start;env.RESEARCH_BACKEND.start=(...args)=>{starts++;return start(...args);};
 const settings=await a.request('/api/settings',{settings:{sources:['zhihu','youtube']}});assert.equal(settings.status,200,JSON.stringify(settings.body));
 const response=await a.request('/api/research/prepare',{sessionId:a.session.session_id,mode:'rating'});assert.equal(response.body.preparation.backend_ready,true);assert.deepEqual(response.body.preparation.sources.map(x=>x.id),['zhihu']);assert.deepEqual(response.body.preparation.unavailable_sources,['youtube']);assert.equal(starts,0);
});

test('blind question order does not reveal the same opponent position in every group',async t=>{
 t.mock.method(Math,'random',()=>0);
 const env={DB:database()},a=await account(env);await begin(a,'blind');const store=new CloudStore(env.DB);await store.load(a.session.user_id);const study=store.rows.findLast(row=>row.kind==='research_study');
 const opponents=study.pairs.map(pair=>Object.values(pair.mapping).find(method=>method!=='waterfall'));
 assert.deepEqual(new Set(opponents),new Set(['clawrec','i2agent','generic-agent','fixed-retrieval']));assert.notDeepEqual(opponents,['clawrec','i2agent','generic-agent','fixed-retrieval']);
});
