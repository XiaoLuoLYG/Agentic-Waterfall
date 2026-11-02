import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {acquireSource as sharedAcquire} from '../lib/waterfall/sources.mjs';

const here=dirname(fileURLToPath(import.meta.url));
let workspace=here;
while(!existsSync(resolve(workspace,'methods/agentic-waterfall/i2agent/adapter.py'))&&dirname(workspace)!==workspace)workspace=dirname(workspace);
const researchRoot=resolve(workspace,'methods/agentic-waterfall');
const capabilities=[{id:'zhihu',name:'知乎',configured:true,allowed:true,modes:['search'],modalities:['text']},{id:'steam',configured:true,allowed:true,modes:['explore'],modalities:['text']},{id:'disabled',configured:true,allowed:false,modes:['search'],modalities:['text']}];
const cards=Array.from({length:8},(_,i)=>({id:`live-${i}`,source:'zhihu',title:`Camera ${i}`,summary:'actual injected transport result',url:`https://www.zhihu.com/question/${i+1}`,origin:'live',modality:'text',content_hash:`hash-${i}`}));
const snapshot=()=>({id:'input',captured_at:'2026-10-31T00:00:00Z',command:'camera',state:{version:4,profile:'profile',interests:['camera'],entries:[{origin:'user_edit',target:'memory',value:'explicit-tripod'},{origin:'model',value:'PRIVATE_INFERENCE'}],memory:'PRIVATE_MEMORY'},candidate_pool:[{id:'PRIVATE_CANDIDATE'}],available_sources:capabilities,behavior:[{id:'a',type:'open',content_id:'history-a',title:'Camera A'},{id:'b',type:'feedback',value:'like',content_id:'history-b',title:'Camera B'},{id:'rating',type:'evaluation',text:'PRIVATE_RATING'}]});
const receipt=value=>({attempt_id:crypto.randomUUID(),status:'success',finish_reason:'stop',content:JSON.stringify(value),usage:{prompt_tokens:1,completion_tokens:1}});
async function setup(options={}){
 const path=resolve(here,'../scripts/research-live-methods.mjs');assert.ok(existsSync(path),'live runner must exist');
 const {createResearchRunner}=await import(path);const calls=[],python=[],archive=[];
 const modelCall=async request=>{
  calls.push(request);let input;try{input=JSON.parse(request.messages.at(-1).content);}catch{}
  if(input?.stage==='state')return receipt({user_state_md:'# User State\n## Current Needs\nPhotography',state_updates_md:'Update Packet 1',negative_signals_md:'None'});
  if(input?.stage==='plan')return receipt({plan_md:'## Display Plan\nPhotography\n## Search Instructions\n### [search-1]\n- Platform: zhihu\n- Query: camera'});
  if(input?.stage==='curate')return receipt({sections:[{label:'Right now',topic:'Photography',cards:[4,0].map(i=>({title:cards[i].title,source:'知乎',href:cards[i].url,summary:cards[i].summary}))},{label:'Explore',topic:'Photography',cards:[0,3,1,2].map(i=>({title:cards[i].title,source:'知乎',href:cards[i].url,summary:cards[i].summary}))}]});
  if(input?.stage==='generic-agent')return receipt(input.input.search_results.length?{state:'own generic state',ordered_indices:[1,2,3,4,5]}:{state:'own generic state',queries:[{source:'zhihu',mode:'search',query:'camera'}]});
  const data=input;return receipt({decision_id:data.observation.decision_id,actions:[{action_id:'get',kind:'acquire',arguments:{source_ids:['zhihu'],mode:'search',query:'camera',limit:8},evidence_refs:[],depends_on:[]},{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:cards.slice(0,5).map(x=>x.id),delivery:'replace_pending'},evidence_refs:[],depends_on:['get']}]});
 };
 const pythonCall=async(operation,payload)=>{python.push({operation,payload});if(operation==='packets')return {packets:'## Update Packet 1\nactual visible evidence'};if(operation==='i2agent')return {ordered_item_ids:payload.candidates.map(x=>x.id),model_calls:5,source_sha256:'author-pin'};if(operation==='fixed')return {ordered_item_ids:payload.catalog.map(x=>x.id),acquired_ids:payload.catalog.map(x=>x.id),retrieval:'BM25+BGE-M3 RRF(60)',reranker:'BAAI/bge-reranker-v2-m3'};throw Error('unexpected Python operation');};
 const run=createResearchRunner({researchRoot,config:{model:'synthetic'},catalog:capabilities,sourceConfig:{},acquireSource:async(action,config,{limit})=>({source:action.source,status:'ok',items:cards.map(x=>({...x,id:action.source==='zhihu'?x.id:`${action.source}-${x.id}`,source:action.source})).slice(0,limit)}),modelCall,pythonCall,archive:entry=>archive.push(structuredClone(entry)),...options});
 return {run,calls,python,archive,modelCall};
}

test('all five methods use independently retrieved live material and common raw input',async()=>{
 const {run,calls,python,archive}=await setup();const result=await run({snapshot:snapshot(),history:[],session:{session_id:'s',record_kind:'synthetic'},userId:'u',data_origin:'test_only'});
 assert.deepEqual(result.methods.map(x=>x.status),Array(5).fill('submitted'));
 assert.equal(result.environment.network_sources,true);assert.equal(result.environment.catalog_sha256,undefined);
 assert.deepEqual(result.environment.active_sources,['zhihu','steam']);
 assert.ok(result.methods.every(x=>x.slate.length===5&&x.slate.every(card=>card.origin==='live')));
 assert.equal(python.filter(x=>x.operation==='packets').length,1);
 assert.ok(python.find(x=>x.operation==='fixed').payload.query.includes('explicit-tripod'));
 assert.equal(python.find(x=>x.operation==='fixed').payload.index_path,undefined);
 assert.ok(!JSON.stringify(calls).includes('PRIVATE_'));
 assert.ok(archive.some(x=>x.event==='tool_start'&&x.method_id==='fixed-retrieval'));
 assert.ok(archive.some(x=>x.event==='tool_finish'&&x.method_id==='fixed-retrieval'));
 assert.ok(result.methods.every(x=>x.protocol.max_tool_calls===20));
});

test('failed real retrieval stays failed and cannot become a recommendation',async()=>{
 const {run}=await setup({acquireSource:async()=>({status:'failed',error:'provider_http_429',items:[]})});
 const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 assert.ok(result.methods.every(x=>x.status==='failed'&&x.slate.length===0));
 assert.ok(result.methods.every(x=>x.trace.some(t=>t.phase==='source_call'&&t.status==='failed')));
});

test('i2Agent never fabricates missing positive history',async()=>{
 const {run,python}=await setup();const input=snapshot();input.behavior=[];
 const result=await run({snapshot:input,session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 assert.equal(result.methods.find(x=>x.method_id==='i2agent').status,'not_applicable');assert.ok(!python.some(x=>x.operation==='i2agent'));
});

test('archive failures stop execution before a model or source request',async()=>{
 const {run}=await setup({archive:()=>{throw Error('disk full');},modelCall:()=>{throw Error('must not call');},acquireSource:()=>{throw Error('must not call');}});
 await assert.rejects(run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'}),/research_archive_failed/);
});

test('generic Agent can autonomously retrieve repeatedly but cannot exceed common network ceiling',async()=>{
 const {run}=await setup({modelCall:async request=>{let data;try{data=JSON.parse(request.messages.at(-1).content);}catch{}if(data?.stage==='generic-agent')return receipt({queries:Array.from({length:21},()=>({source:'zhihu',mode:'search',query:'camera'}))});throw Error('other methods deliberately fail');}});
 const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 const generic=result.methods.find(x=>x.method_id==='generic-agent');assert.equal(generic.status,'failed');assert.match(generic.error,/budget/);
});

test('each live request has the same bounded item ceiling even when an Agent requests more',async()=>{
 const requests=[];const {run}=await setup({acquireSource:async(action,config,options)=>{requests.push(options);return {status:'ok',items:cards.slice(0,options.limit).map(x=>({...x,source:action.source}))};},modelCall:async request=>{let data;try{data=JSON.parse(request.messages.at(-1).content);}catch{}if(data?.stage==='generic-agent')return receipt(data.input.search_results.length?{ordered_indices:[1]}:{queries:[{source:'zhihu',mode:'search',query:'camera',limit:999}]});throw Error('other methods deliberately fail');}});
 await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'});assert.ok(requests.length);assert.ok(requests.every(x=>x.limit<=50));
});

test('ClawRec packets increment only its own already processed natural evidence',async()=>{
 const {run,python}=await setup();const input={snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'};
 await run(input);await run(input);await run({...input,userId:'different-user'});
 const packets=python.filter(x=>x.operation==='packets');assert.ok(packets[0].payload.records.length);assert.deepEqual(packets[1].payload.records,[]);assert.ok(packets[2].payload.records.length);
});

test('deterministic retrieval uses separate raw interests and latest expression without concatenating history',async()=>{
 const calls=[];const {run}=await setup({acquireSource:async(action,config,{limit})=>{calls.push(action);return {status:'ok',items:cards.map(x=>({...x,id:`${action.source}-${x.id}`,source:action.source})).slice(0,limit)};}});
 const input=snapshot();input.command='AI agents';input.state.interests=['machine learning','open source'];input.state.entries=[];input.available_sources=[capabilities[0]];
 const result=await run({snapshot:input,session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 const fixed=result.methods.find(x=>x.method_id==='fixed-retrieval');const queries=fixed.trace.filter(x=>x.phase==='source_call').map(x=>x.request.query);
 assert.deepEqual(queries,['AI agents','machine learning','open source']);assert.ok(queries.every(x=>!x.includes('Camera A')));assert.ok(queries.length<20);
});

test('repeated live queries advance pages only within their own method run and request combination',async()=>{
 const {run}=await setup({acquireSource:async(action,config,options)=>{const item={...cards[0],id:`${action.source}-${action.query.trim()}-${options.page}`,source:action.source,content_hash:`${action.source}-${action.query.trim()}-${options.page}`};await config.onCapture({source:action.source,request:{...action,...options},results:[item],status:'ok'});return {status:'ok',items:[item]};},modelCall:async request=>{
  const data=JSON.parse(request.messages.at(-1).content);if(data.stage!=='generic-agent')throw Error('only testing autonomous live queries');
  return receipt(data.input.search_results.length?{ordered_indices:[1]}:{queries:[{source:'zhihu',mode:'search',query:'camera'},{source:'zhihu',mode:'search',query:'camera'},{source:'zhihu',mode:'search',query:'another query'},{source:'zhihu',mode:'search',query:' camera '},{source:'steam',mode:'explore',query:''}]});
 }});
 const input={snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'};
 for(const request of [input,input,{...input,userId:'other-user'}]){
  const result=await run(request),generic=result.methods.find(x=>x.method_id==='generic-agent');assert.equal(generic.status,'submitted');assert.deepEqual(generic.trace.filter(x=>x.phase==='source_call').map(x=>x.request.page),[1,2,1,3,1]);assert.deepEqual(generic.trace.filter(x=>x.phase==='source_capture').map(x=>x.capture.request.page),[1,2,1,3,1]);
  assert.ok(result.methods.every(x=>!x.trace.some(t=>t.operation==='search')));for(const method of result.methods){const first=method.trace.find(x=>x.phase==='source_call');if(first)assert.equal(first.request.page,1);}
 }
});

test('ClawRec author packets preserve literal user comments as visible expression evidence',async()=>{
 const {run,python}=await setup();const input=snapshot();input.behavior.push({id:'comment',type:'feedback',value:'comment',content_id:'history-c',title:'Third camera',text:'Please show beginner tutorials'});
 await run({snapshot:input,session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 assert.ok(JSON.stringify(python.find(x=>x.operation==='packets').payload.records).includes('Please show beginner tutorials'));
});

test('shared source capture archives every normalized provider row before requested limit and chains existing observer',async t=>{
 const captures=[],events=[];t.mock.method(globalThis,'fetch',async()=>Response.json({hits:Array.from({length:60},(_,i)=>({objectID:String(i+1),title:`Synthetic AI item ${i+1}`,story_text:'Synthetic provider body',created_at:'2026-01-01T00:00:00Z'}))}));
 const source={id:'hackernews',configured:true,allowed:true,modes:['search'],modalities:['text']};
 const {run}=await setup({catalog:[source],sourceConfig:{onCapture:capture=>captures.push(capture)},acquireSource:sharedAcquire,modelCall:async()=>{throw Error('no paid model in this test');},archive:entry=>events.push(structuredClone(entry))});
 const input=snapshot();input.available_sources=[source];input.command='AI';input.state.interests=['AI'];input.state.entries=[];
 const result=await run({snapshot:input,session:{session_id:'s'},userId:'u',data_origin:'test_only'});const fixed=result.methods.find(x=>x.method_id==='fixed-retrieval');
 assert.equal(fixed.status,'submitted');assert.equal(fixed.content_snapshot.items.length,50);
 const capture=events.find(x=>x.event==='source_capture'&&x.method_id==='fixed-retrieval');assert.ok(capture,'full source capture must be archived');assert.equal(capture.capture.results.length,60);assert.equal(capture.capture.request.limit,50);assert.equal(capture.capture.request.query,'AI');assert.ok(captures.every(x=>x.results.length===60));assert.equal(captures.length,2);
 assert.equal(fixed.trace.find(x=>x.phase==='source_capture').capture.results.length,60);
});

test('source observer errors swallowed by transport still invalidate execution before further model calls',async()=>{
 const events=[];let requests=0;
 const {run}=await setup({acquireSource:async(action,config,{limit})=>{requests++;try{await config.onCapture({source:action.source,request:{...action,limit},results:cards,status:'ok'});}catch{}return {status:'ok',items:cards.slice(0,limit)};},archive:entry=>{events.push(entry);if(entry.event==='source_capture')throw Error('archive disk full');}});
 await assert.rejects(run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'}),/research_archive_failed/);assert.equal(requests,1);assert.ok(!events.some(x=>x.event==='method_complete'&&x.result?.status==='submitted'));
});

test('i2Agent explicitly records its 20-candidate adapter cap and full acquired pool',async()=>{
 const twentyFive=Array.from({length:25},(_,i)=>({...cards[0],id:`candidate-${i}`,content_hash:`candidate-${i}`}));
 const {run}=await setup({acquireSource:async()=>({status:'ok',items:twentyFive})});const input=snapshot();input.available_sources=[capabilities[0]];
 const result=await run({snapshot:input,session:{session_id:'s'},userId:'u',data_origin:'test_only'});const i2=result.methods.find(x=>x.method_id==='i2agent');
 assert.equal(i2.status,'submitted');assert.equal(i2.adapter_protocol.candidate_cap,20);assert.equal(i2.adapter_protocol.acquired_pool_count,25);assert.equal(i2.adapter_protocol.selected_candidate_count,20);assert.equal(i2.acquired_ids.length,25);
 const task=i2.trace.find(x=>x.operation==='i2agent').payload;assert.equal(task.candidates.length,20);assert.ok(!task.candidates.some(x=>x.id===task.contrast.id));assert.equal(result.environment.method_protocols.i2agent.candidate_cap,20);
});

test('downloadable method traces retain exact own prior state and actual streaming core receipts',async()=>{
 const secondSource={id:'github',configured:true,allowed:true,modes:['search'],modalities:['text']},prior={state:{version:7,profile:'own prior profile',interests:[],memory:'own prior memory',context:'',entries:[]}};
 let calls=0;const {run}=await setup({catalog:[capabilities[0],secondSource],stateStore:{get:(user,method)=>method==='waterfall'?structuredClone(prior):null,set:()=>{}},acquireSource:async action=>{if(action.source==='github')await new Promise(resolve=>setTimeout(resolve,5));return {status:'ok',items:cards.map(x=>({...x,id:action.source==='zhihu'?x.id:`github-${x.id}`,source:action.source}))};},modelCall:async request=>{
  const data=JSON.parse(request.messages.at(-1).content);if(!data.observation)throw Error('only testing the shared core');calls++;
  return receipt({decision_id:data.observation.decision_id,actions:calls===1?[{action_id:'get',kind:'acquire',arguments:{source_ids:['zhihu','github'],mode:'search',query:'camera',limit:16},evidence_refs:[],depends_on:[]},{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:cards.slice(0,5).map(x=>x.id),delivery:'replace_pending'},evidence_refs:[],depends_on:['get']}]:[{action_id:`wait-${calls}`,kind:'idle',arguments:{mode:'wait',task_id:null},evidence_refs:[],depends_on:[]}]});
 }});
 const input=snapshot();input.available_sources=[capabilities[0],secondSource];const result=await run({snapshot:input,session:{session_id:'s'},userId:'u',data_origin:'test_only'}),waterfall=result.methods.find(x=>x.method_id==='waterfall');
 assert.deepEqual(waterfall.trace.find(x=>x.phase==='method_context')?.runtime.prior_state,prior);
 const actions=waterfall.trace.filter(x=>x.phase==='core_action').map(x=>x.runtime);assert.ok(actions.length,'raw callback receipts must survive in the downloadable result');
 const partial=actions.find(x=>x.receipt.parent_action_id==='get');assert.ok(partial,'actual partial receipt must be retained');assert.equal(partial.receipt.action_id,'get:partial:1');assert.deepEqual(partial.receipt.result.items.map(x=>x.id),cards.map(x=>x.id));assert.ok(partial.progress.pending_acquisitions>0);assert.ok(actions.some(x=>x.receipt.action_id==='get'));
 assert.ok(result.methods.every(x=>x.trace.some(t=>t.phase==='method_context')));
});

test('Python bridge runs the actual author packet builder without model or network calls',()=>{
 const record={record_id:'test-event',kind:'content_interest',session_id:'test-session',ts_start_ms:Date.parse('2026-10-31T00:00:00Z'),ts_end_ms:Date.parse('2026-10-31T00:00:00Z'),platform:'zhihu',page_type:'content',content_key:'test-content',title:'Synthetic camera evidence',canonical_url:'',context:{source_search_record_id:null,behavior_signal_types:['open']}};
 const result=spawnSync('python3',[resolve(here,'../scripts/research-python.py'),researchRoot],{input:JSON.stringify({operation:'packets',records:[record]})+'\n',encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout.trim());assert.equal(output.type,'result');assert.match(output.value.packets,/Synthetic camera evidence/);assert.match(output.value.packets,/Update Packet/);
});

test('Python bridge preserves all five pinned author i2Agent stages and full candidate mapping',()=>{
 const values={recommend_content:'synthetic choice',profile:'synthetic profile',knowledge:'synthetic knowledge',dynamic_interest:'synthetic interest',dynamic_profile:'synthetic profile',rerank_list:[2,1],explanation:['synthetic transport only']};
 const input={operation:'i2agent',history:[{id:'h1',title:'first',description:'',review:''},{id:'h2',title:'second',description:'',review:''}],candidates:[{id:'c1',title:'one',description:''},{id:'c2',title:'two',description:''}],contrast:{id:'neutral',title:'neutral',description:''},instruction:'Synthetic test only'};
 const fields=[['recommend_content'],['profile'],['knowledge'],['dynamic_interest','dynamic_profile'],['rerank_list','explanation']];
 const result=spawnSync('python3',[resolve(here,'../scripts/research-python.py'),researchRoot],{input:[input,...fields.map(keys=>({type:'model_response',value:Object.fromEntries(keys.map(key=>[key,values[key]]))}))].map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stderr||result.stdout);const outputs=result.stdout.trim().split('\n').map(x=>JSON.parse(x));assert.equal(outputs.filter(x=>x.type==='model_request').length,5);assert.deepEqual(outputs.at(-1).value.ordered_item_ids,['c2','c1']);assert.equal(outputs.at(-1).value.source_sha256,'a2b44548dffedcb2f32b382902626df67e23cc60dff42adb3d08a51e1a6210cb');
});


test('Waterfall receives all authorized natural history before the first model call',async()=>{
 const calls=[];const input=snapshot();input.command='';input.recent_commands=[];
 const history=Array.from({length:190},(_,i)=>({id:'older-'+i,kind:'exposure',phase:'end',track:'feed',title:'old-title-'+i+'x'.repeat(700),content_id:'old-'+i}));
 const {run,archive}=await setup({modelCall:async request=>{const d=JSON.parse(request.messages.at(-1).content);if(!d.observation)throw Error('unrelated method');calls.push(d.observation);if(calls.length===1)return receipt({decision_id:d.observation.decision_id,actions:[{action_id:'history',kind:'lookup_history',arguments:{query:'old-title-0',offset:0,limit:1},evidence_refs:[],depends_on:[]}]});throw Error('probe complete');}});
 await run({snapshot:input,history,session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 assert.ok(calls.length>=1,'large allowed history must not prevent the first model request');
 assert.equal(calls[0].behavior_events.length,192);
 assert.ok(calls[0].behavior_events.some(x=>x.id==='older-0'&&x.title.endsWith('x'.repeat(700))));
 assert.ok(archive.some(x=>x.event==='core_action'&&x.runtime.receipt.kind==='lookup_history'&&JSON.stringify(x.runtime.receipt).includes('older-0')));
});

test('ClawRec maps the author section and card order to exact acquired URLs',async()=>{
 const {run,calls}=await setup();const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'});
 const claw=result.methods.find(x=>x.method_id==='clawrec');assert.equal(claw.status,'submitted');assert.deepEqual(claw.slate.map(x=>x.id),[4,0,3,1,2].map(i=>cards[i].id));assert.deepEqual(claw.adapter_normalizations,{duplicate_display_item_ids:[cards[0].id],policy:'first occurrence in author section/card order'});
 const input=JSON.parse(calls.find(x=>JSON.parse(x.messages.at(-1).content).stage==='curate').messages.at(-1).content).input;
 assert.equal(input.search_results[0].instruction_id,'search-1');assert.equal(input.search_results[0].response.status,'ok');
});

test('ClawRec cannot convert an unacquired display URL into a recommendation',async()=>{
 const base=await setup();const {run}=await setup({modelCall:async request=>JSON.parse(request.messages.at(-1).content).stage==='curate'?receipt({sections:[{cards:[{title:'invented',source:'知乎',href:'https://www.zhihu.com/question/unacquired',summary:'invented'}]}]}):base.modelCall(request)});
 const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'});const claw=result.methods.find(x=>x.method_id==='clawrec');assert.equal(claw.status,'failed');assert.equal(claw.slate.length,0);assert.match(claw.error,/unacquired.*URL/);
});

test('generic Agent can preserve its own structured JSON memory across retrieval and delivery',async()=>{
 const {run}=await setup({modelCall:async request=>{const d=JSON.parse(request.messages.at(-1).content);if(d.stage!=='generic-agent')throw Error('unrelated method');return receipt(d.input.search_results.length?{state:{interests:['camera'],seen:8},ordered_indices:[1,2,3,4,5]}:{state:{interests:['camera']},queries:[{source:'zhihu',mode:'search',query:'camera'}],ordered_indices:[]});}});
 const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'});const generic=result.methods.find(x=>x.method_id==='generic-agent');assert.equal(generic.status,'submitted');assert.equal(generic.slate.length,5);
});


test('generic Agent retains a falsy JSON memory value in the next group',async()=>{
 const memories=[];const {run}=await setup({modelCall:async request=>{const d=JSON.parse(request.messages.at(-1).content);if(d.stage!=='generic-agent')throw Error('unrelated method');if(!d.input.search_results.length){memories.push(d.input.own_state);return receipt({state:0,queries:[{source:'zhihu',mode:'search',query:'camera'}]});}return receipt({state:0,ordered_indices:[1,2,3,4,5]});}});
 const input={snapshot:snapshot(),session:{session_id:'s'},userId:'u',data_origin:'test_only'};await run(input);await run(input);assert.deepEqual(memories,[null,0]);
});

test('online roster executes the four original methods without invoking fixed retrieval',async()=>{
 const {ONLINE_METHODS}=await import('../lib/waterfall/research-methods.mjs');
 const {run,python}=await setup({methodIds:ONLINE_METHODS});
 const result=await run({snapshot:snapshot(),userId:'four-qa',session:{session_id:'four-qa',record_kind:'synthetic'},data_origin:'test_only'});
 assert.deepEqual(result.methods.map(method=>method.method_id),ONLINE_METHODS);
 assert.ok(result.methods.every(method=>method.status==='submitted'));
 assert.equal(python.some(call=>call.operation==='fixed'),false);
});

test('four live methods can await networking concurrently without changing result order',async()=>{
 const {ONLINE_METHODS}=await import('../lib/waterfall/research-methods.mjs');
 const original=await setup(),started=new Set();let release;const gate=new Promise(resolve=>release=resolve);
 const {run}=await setup({methodIds:ONLINE_METHODS,archive:entry=>{if(entry.event==='method_start')started.add(entry.method_id);},modelCall:async request=>{await gate;return original.modelCall(request);}});
 const pending=run({snapshot:snapshot(),userId:'parallel-qa',session:{session_id:'parallel-qa',record_kind:'synthetic'},data_origin:'test_only'});
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(started.size,4);}finally{release();}
 const result=await pending;assert.deepEqual(result.methods.map(method=>method.method_id),ONLINE_METHODS);assert.equal(result.environment.method_scheduling,'parallel');
});
