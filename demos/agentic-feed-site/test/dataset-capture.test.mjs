import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {CloudStore,CloudAccounts} from '../lib/waterfall/cloud-store.mjs';
import {acquireSource} from '../lib/waterfall/sources.mjs';

function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(`drizzle/${file}`,'utf8'));
 return {prepare(sql){return {bind(...args){const statement=sqlite.prepare(sql);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){statement.run(...args);return {success:true};}};}};}};
}
function bucket(){
 const objects=new Map();return {objects,fail:false,puts:0,async head(key){return objects.has(key)?{size:objects.get(key).length}:null;},async put(key,value){if(this.fail)throw Error('offline');this.puts++;objects.set(key,Buffer.from(value));},async get(key){const body=objects.get(key);return body?{async arrayBuffer(){return body.buffer.slice(body.byteOffset,body.byteOffset+body.length);}}:null;}};
}
const item=n=>({id:'legacy-'+n,source:'hackernews',source_item_id:String(n),title:'Public '+n,summary:'Returned text '+n,url:'https://example.org/'+n});

test('capture sees every returned source item before feed limits and exclusions',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({hits:[1,2,3].map(n=>({objectID:String(n),title:'Public '+n,story_text:'Full returned summary '+n,points:n,url:'https://example.org/'+n}))}));
 const captures=[],config={onCapture:capture=>captures.push(capture)};
 const first=await acquireSource({source:'hackernews',mode:'search',query:'public',modality:'text'},config,{limit:1});
 assert.equal(first.items.length,1);assert.equal(captures.length,1);assert.equal(captures[0].results.length,3);
 const next=await acquireSource({source:'hackernews',mode:'search',query:'public',modality:'text'},config,{limit:1,excludedIds:[first.items[0].id]});
 assert.equal(next.items.length,1);assert.equal(captures[1].results.length,3);assert.equal(captures[1].results[0].id,first.items[0].id);
 assert.deepEqual(captures[0].request,{source:'hackernews',mode:'search',query:'public',modality:'text',page:1,limit:1});
});

test('private archive deduplicates content, retains failed capture and retries append-only',async()=>{
 const {captureDataset,retryDatasetArchives,readDatasetCaptures,datasetStatus}=await import('../lib/waterfall/dataset-store.mjs');
 const db=database(),accounts=new CloudAccounts(db),user=(await accounts.selectIdentity({username:'archive-owner',type:'human'})).user,store=new CloudStore(db),r2=bucket();await store.load(user.id);
 const {startSession}=await import('../lib/waterfall/core.mjs'),session=await startSession(store,{consent:true,recordKind:'human',interests:[]},user),sid=session.session_id;
 const capture={source:'hackernews',request:{query:'public',mode:'search',limit:1},results:[item(1),item(2),item(3)],status:'ok',started_at:new Date().toISOString(),completed_at:new Date().toISOString()};
 r2.fail=true;await captureDataset(store,r2,sid,capture);
 let status=datasetStatus(store,r2,sid);assert.equal(status.captures.pending,1);assert.equal(status.returned_items,3);assert.equal(status.archive_ready,false);
 const pending=store.rows.find(row=>row.kind==='dataset_archive'&&row.archive_status==='pending');assert.equal(pending.capture.results.length,3);const oldPayload=JSON.stringify(pending);
 r2.fail=false;await retryDatasetArchives(store,r2,sid);status=datasetStatus(store,r2,sid);assert.equal(status.captures.ready,1);assert.equal(status.captures.pending,0);assert.equal(status.contents,3);assert.equal(status.archive_ready,true);assert.equal(JSON.stringify(pending),oldPayload);
 const before=r2.puts;await captureDataset(store,r2,sid,capture);assert.equal(r2.puts-before,1,'second capture writes only its observation artifact');
 const captures=await readDatasetCaptures(store,r2,sid);assert.equal(captures.length,2);assert.equal(captures[0].results.length,3);assert.equal(captures[0].results[0].original_item_id,'legacy-1');
 assert([...r2.objects.keys()].every(key=>key.startsWith('dataset/'+user.id+'/')));
 const plain=[...r2.objects.values()].map(value=>JSON.parse(gunzipSync(value)));assert(plain.some(object=>object.results?.length===3));assert(status.archive_bytes>0);
 await store.record('dataset_capture',sid,{capture_id:'interrupted',returned_count:4,archive_status:'writing'});assert.equal(datasetStatus(store,r2,sid).captures.incomplete,1);assert.equal(datasetStatus(store,r2,sid).archive_ready,false);
});

test('an archive callback failure preserves the original feed acquisition',async t=>{
 t.mock.method(console,'error',()=>{});
 t.mock.method(globalThis,'fetch',async()=>Response.json({hits:[{objectID:'1',title:'Public',url:'https://example.org/1'}]}));
 const normal=await acquireSource({source:'hackernews',mode:'search',query:'public',modality:'text'},{});
 const captured=await acquireSource({source:'hackernews',mode:'search',query:'public',modality:'text'},{onCapture:()=>{throw Error('archive offline');}});
 const stable=value=>JSON.parse(JSON.stringify(value,(key,entry)=>key.endsWith('_at')?undefined:entry));
 assert.deepEqual(stable(captured),stable(normal));
});

test('archive callback failure leaves the actual next model observation unchanged',async t=>{
 const {runDemo}=await import('../lib/waterfall/unified-demo.mjs');
 t.mock.method(globalThis,'fetch',async()=>Response.json({hits:[1,2,3].map(n=>({objectID:String(n),title:'Public '+n,story_text:n===3?'unacquired-'.repeat(11000):'small returned content'}))}));
 t.mock.method(console,'error',()=>{});
 const snapshot={id:'unchanged-input',captured_at:'2026-10-31T00:00:00.000Z',command:'public',state:{version:1,profile:'',memory:'',context:'',entries:[],interests:[]},behavior:[],recent_commands:[],candidate_pool:[],previous_slate_ids:[],available_sources:[{id:'hackernews',modes:['search'],modalities:['text']}],settings:{sources:[],contentTypes:['text']}};
 const collect=async onCapture=>{
  const requests=[];
  const result=await runDemo(snapshot,{userId:'owner',sessionId:'session',acquireSource:(source,args)=>acquireSource({source,mode:args.mode,query:args.query,modality:'text'},{onCapture},{limit:args.limit}),modelCall:async request=>{
   requests.push(JSON.parse(request.messages[1].content));const observation=requests.at(-1).observation,items=observation.environment.candidate_pool;
   const action=items.length?{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:[items[0].id],delivery:'replace_pending'}}:{action_id:'get',kind:'acquire',arguments:{source_ids:['hackernews'],mode:'search',query:'public',content_types:['text'],limit:1}};
   return {status:'success',content:JSON.stringify({decision_id:observation.decision_id,actions:[{...action,evidence_refs:[],depends_on:[]}]})};
  }});
  assert.equal(result.slate.length,1);assert.equal(requests.length,2);return requests[1];
 };
 const stable=value=>JSON.parse(JSON.stringify(value,(key,entry)=>key.endsWith('_at')?undefined:entry));
 const normal=await collect(undefined),failed=await collect(()=>{throw Error('collector failed');});assert.deepEqual(stable(failed),stable(normal));assert(!JSON.stringify(failed).includes('unacquired-'));
});

test('large pending source content is chunked and remains retryable after compact loading',async()=>{
 const {captureDataset,retryDatasetArchives,readDatasetCaptures,datasetStatus}=await import('../lib/waterfall/dataset-store.mjs');
 const db=database(),accounts=new CloudAccounts(db),user=(await accounts.selectIdentity({username:'chunk-owner',type:'human'})).user,store=new CloudStore(db),r2=bucket();await store.load(user.id);
 const {startSession}=await import('../lib/waterfall/core.mjs'),session=await startSession(store,{consent:true,recordKind:'synthetic',interests:[]},user),sid=session.session_id;
 r2.fail=true;await captureDataset(store,r2,sid,{source:'hackernews',status:'ok',results:Array.from({length:6},(_,n)=>({...item(n),summary:'正文'.repeat(50000)}))});
 assert(store.rows.some(row=>row.kind==='dataset_capture_chunk'));assert(store.rows.every(row=>Buffer.byteLength(JSON.stringify(row))<500000));
 await store.loadDataset(user.id,sid);assert.equal(datasetStatus(store,r2,sid).contents,6);r2.fail=false;await retryDatasetArchives(store,r2,sid);
 assert.equal(datasetStatus(store,r2,sid).archive_ready,true);const captures=await readDatasetCaptures(store,r2,sid);assert.equal(captures[0].results.length,6);assert.equal(captures[0].results[0].summary.length,100000);
});

async function account(env,username){
 const {handleApi}=await import('../lib/waterfall/cloud-entry.mjs');
 const identity=await handleApi(new Request('https://example.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];
 const request=(path,data)=>handleApi(new Request('https://example.test'+path,{headers:{cookie,'content-type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})}),env);
 const session=await (await request('/api/session',{consent:true,recordKind:'synthetic',interests:[]})).json();
 return {request,session:session.session};
}
test('cloud dataset keeps unshown content private, preserves seals and old exports',async t=>{
 const r2=bucket(),env={DB:database(),DATASET_ARCHIVE:r2,WATERFALL_CONFIG:JSON.stringify({apiKey:'private-fixture-key',apiBase:'https://model.example',modelName:'fixture'})};
 t.mock.method(globalThis,'fetch',async(address,options)=>{
  if(!String(address).startsWith('https://model.example'))return Response.json({hits:[1,2,3].map(n=>({objectID:String(n),title:'Public '+n,story_text:'Summary '+n+'x'.repeat(2000),author:'Public author'}))});
  const observation=JSON.parse(JSON.parse(options.body).messages[1].content).observation,items=observation.environment.candidate_pool;
  const action=items.length?{action_id:'recommend',kind:'recommend',arguments:{ordered_item_ids:[items[0].id],delivery:'replace_pending'}}:{action_id:'acquire',kind:'acquire',arguments:{source_ids:['hackernews'],query:'public',mode:'search',content_types:['text'],limit:1}};
  return Response.json({choices:[{message:{content:JSON.stringify({decision_id:observation.decision_id,actions:[{...action,evidence_refs:[],depends_on:[]}]})}}]});
 });
 const a=await account(env,'dataset-a'),b=await account(env,'dataset-b'),sid=a.session.session_id;
 const response=await a.request('/api/run',{sessionId:sid,command:'public'});assert.equal(response.status,200,await response.clone().text());const run=(await response.json()).run;assert.equal(run.slate.length,1);
 const status=await (await a.request(`/api/dataset/status?sessionId=${sid}`)).json();assert.equal(status.returned_items,3);assert.equal(status.contents,3);assert.equal(status.archive_ready,true);assert(!JSON.stringify(status).includes('joint-v1'));assert(!JSON.stringify(status).includes('mapping'));
 for(const path of [`/api/dataset/status?sessionId=${sid}`,`/api/export?sessionId=${sid}&format=dataset`])assert.equal((await b.request(path)).status,404);
 assert.equal((await b.request(`/api/dataset/retry?sessionId=${sid}`,{})).status,404);
 const download=await a.request(`/api/export?sessionId=${sid}&format=dataset`);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/gzip');
 const transport=JSON.parse(gunzipSync(Buffer.from(await download.arrayBuffer())));assert.equal(transport.schema_version,'awf-dataset/1.0');assert.equal(transport.tables.ratings.length,0);assert.equal(transport.tables.slates[0].items.length,1);assert.equal(transport.tables.tool_calls.find(row=>row.results?.length===3).results.length,3);assert(transport.tables.contents.some(row=>row.summary.length>1600));assert(!JSON.stringify(transport).includes('private-fixture-key'));
 assert.equal((await a.request(`/api/export?sessionId=${sid}&format=json`)).status,200);const jsonl=await a.request(`/api/export?sessionId=${sid}&format=jsonl`);assert.equal(jsonl.status,200);assert((await jsonl.text()).includes('"kind":"run"'));
 const store=new CloudStore(env.DB);await store.load(a.session.user_id);
 const study=await store.record('research_study',sid,{mode:'rating',items:[{id:'q',item:item(1)}],pairs:[],result:{methods:[]},mappings:[{method_id:'private-method'}]});
 assert.equal((await a.request(`/api/export?sessionId=${sid}&format=dataset`)).status,409);assert.equal((await a.request(`/api/dataset/status?sessionId=${sid}`)).status,200);
 await store.record('research_stop',sid,{study_id:study.id});assert.equal((await a.request(`/api/export?sessionId=${sid}&format=dataset`)).status,200);
 await store.record('comparison',sid,{track:'blind',study_protocol:'blind-next-v1',mapping:{A:'private-a',B:'private-b'}});assert.equal((await a.request(`/api/export?sessionId=${sid}&format=dataset`)).status,409);
});

test('failed model round still archives its successful acquisition and recovers from R2 failure',async t=>{
 const r2=bucket();r2.fail=true;const env={DB:database(),DATASET_ARCHIVE:r2,WATERFALL_CONFIG:JSON.stringify({apiKey:'fixture',apiBase:'https://model.example',modelName:'fixture'})};let calls=0;
 t.mock.method(globalThis,'fetch',async(address,options)=>{
  if(!String(address).startsWith('https://model.example'))return Response.json({hits:[1,2,3].map(n=>({objectID:String(n),title:'Public '+n}))});
  if(calls++)return Response.json({error:'temporarily unavailable'},{status:503});
  const observation=JSON.parse(JSON.parse(options.body).messages[1].content).observation;
  return Response.json({choices:[{message:{content:JSON.stringify({decision_id:observation.decision_id,actions:[{action_id:'get',kind:'acquire',arguments:{source_ids:['hackernews'],mode:'search',query:'public',content_types:['text'],limit:1},evidence_refs:[],depends_on:[]}]})}}]});
 });
 const a=await account(env,'failed-capture'),sid=a.session.session_id;
 assert.equal((await a.request('/api/run',{sessionId:sid,command:'public'})).status,502);
 const status=await (await a.request(`/api/dataset/status?sessionId=${sid}`)).json();assert.equal(status.captures.pending,1);assert.equal(status.returned_items,3);assert.equal(status.contents,3);
 const pending=await a.request(`/api/export?sessionId=${sid}&format=dataset`);assert.equal(pending.status,200);const data=JSON.parse(gunzipSync(Buffer.from(await pending.arrayBuffer())));assert.equal(data.artifact_refs[0].availability,'pending_retry');assert(data.tables.contents.length>=3);assert(data.tables.runs.some(run=>run.status==='failed'));
 r2.fail=false;const retried=await a.request(`/api/dataset/retry?sessionId=${sid}`,{});assert.equal(retried.status,200);assert.equal((await retried.json()).archive_ready,true);
});
