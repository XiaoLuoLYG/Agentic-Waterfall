import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve,dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createResearchRunner } from '../scripts/research-methods.mjs';

let workspace=dirname(fileURLToPath(import.meta.url));
while(!existsSync(resolve(workspace,'methods/agentic-waterfall/simbench/round.mjs'))&&dirname(workspace)!==workspace)workspace=dirname(workspace);
const researchRoot=process.env.WATERFALL_RESEARCH_ROOT||resolve(workspace,'methods/agentic-waterfall');
const catalog=Array.from({length:25},(_,i)=>({id:`public-${i+1}`,source:'zhihu',title:`Camera ${i+1}`,text:'camera guide',url:`https://www.zhihu.com/question/${i+1}`,published_at:'2026-01-01T00:00:00.000Z'}));
const snapshot=()=>({id:'input',captured_at:'2026-10-30T00:00:00.000Z',command:'camera',state:{version:18,profile:'Explicit profile',interests:['camera'],memory:'SECRET_WATERFALL',context:'SECRET_CONTEXT',entries:[{origin:'model',value:'SECRET_ENTRY'}]},candidate_pool:[{id:'SECRET_CANDIDATE',title:'private learned pool'}],previous_slate_ids:[],behavior:[{id:'like',type:'feedback',value:'like',content_id:'history-1',title:'First camera'},{id:'rating',type:'evaluation',score:3,text:'SECRET_RATING'}],available_sources:[{id:'zhihu',modalities:['text']}]});
function transport(request){
 const text=request.messages.at(-1).content;
 if(text.startsWith('Summarize'))return {state:'own private state'};
 if(text.startsWith('Plan'))return {queries:[{source:'zhihu',query:'camera'}]};
 if(text.startsWith('Using your own'))return {queries:[]};
 if(text.startsWith('Choose and order'))return {ordered_indices:[1,2,3,4,5,6]};
 const data=JSON.parse(text);return {decision_id:data.observation.decision_id,actions:[{action_id:'acquire',kind:'acquire',arguments:{source_ids:['zhihu'],mode:'search',query:'camera',limit:10},evidence_refs:[],depends_on:[]},{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:['public-1','public-2','public-3','public-4','public-5','public-6'],delivery:'replace_pending'},evidence_refs:[],depends_on:['acquire']}]};
}
const receipt=value=>({status:'success',attempt_id:'synthetic-only',content:JSON.stringify(value),usage:{prompt_tokens:1,completion_tokens:1},finish_reason:'stop',requested_model:'synthetic'});

test('five slots run the real JS entries with isolated public inputs and complete receipts',async()=>{
 const requests=[],python=[];
 const run=createResearchRunner({researchRoot,config:{model:'synthetic'},catalog,modelCall:async request=>{requests.push(request);return receipt(transport(request));},pythonCall:async(operation,payload)=>{python.push({operation,payload});if(operation==='search')return catalog.slice(0,payload.limit);if(operation==='fixed')return {ordered_item_ids:catalog.map(x=>x.id),acquired_ids:catalog.map(x=>x.id),retrieval:'test boundary'};throw Error('unexpected i2 call');}});
 const input=snapshot(),result=await run({snapshot:input,history:[{id:'blind',kind:'evaluation',track:'blind',text:'SECRET_BLIND'}],session:{session_id:'s'},userId:'u'});
 assert.deepEqual(result.methods.map(x=>x.method_id),['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval']);
 assert.deepEqual(result.methods.map(x=>x.status),['submitted','submitted','not_applicable','submitted','submitted']);
 for(const method of result.methods.filter(x=>x.status==='submitted')){assert.equal(method.slate.length,5);assert.ok(method.content_snapshot.items.length>=6);assert.ok(method.trace.length);}
 const modelText=JSON.stringify(requests);for(const secret of ['SECRET_WATERFALL','SECRET_CONTEXT','SECRET_ENTRY','SECRET_CANDIDATE','SECRET_RATING','SECRET_BLIND'])assert.ok(!modelText.includes(secret),secret);
 assert.ok(modelText.includes('Explicit profile'));assert.equal(input.state.memory,'SECRET_WATERFALL');
 assert.equal(result.environment.data_origin,'test_only');assert.equal(result.data_origin,'test_only');
 assert.ok(result.methods[0].runtime_source_sha256);assert.ok(result.methods[1].trace.some(x=>x.request&&x.receipt?.attempt_id==='synthetic-only'));
 assert.ok(python.some(x=>x.operation==='fixed'));assert.ok(!python.some(x=>x.operation==='i2agent'));
 const successfulTool=result.methods[1].trace.find(entry=>entry.phase==='tool_call'&&entry.operation==='search');assert.equal(successfulTool.status,'success');assert.deepEqual(successfulTool.response,catalog.slice(0,10));assert.ok(Date.parse(successfulTool.completed_at)>=Date.parse(successfulTool.started_at));
});

test('i2agent receives only real chosen history and an independent neutral public contrast',async()=>{
 let task;
 const run=createResearchRunner({researchRoot,config:{model:'synthetic'},catalog,modelCall:async req=>receipt(req.messages.at(-1).content==='i2 stage'?{stage:'synthetic'}:transport(req)),pythonCall:async(operation,payload,model)=>{if(operation==='search')return catalog.slice(0,payload.limit);if(operation==='fixed')return {acquired_ids:[],ordered_item_ids:[]};task=payload;await model({messages:[{role:'user',content:'i2 stage'}]});return {ordered_item_ids:payload.candidates.map(x=>x.id),source_sha256:'author-sha'};}});
 const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',history:[{id:'h2',kind:'open',track:'feed',content_id:'history-2',title:'Second camera'},{id:'dislike',kind:'feedback',track:'feed',value:'dislike',content_id:'history-3',title:'Unwanted camera'},{id:'comment',kind:'feedback',track:'feed',value:'comment',content_id:'history-2',title:'Second camera',text:'Actual written review'}]});
 assert.equal(result.methods[2].status,'submitted');assert.equal(result.methods[2].runtime_source_sha256,'author-sha');
 assert.deepEqual(task.history.map(x=>x.id),['history-1','history-2']);assert.deepEqual(task.history.map(x=>x.review),['','Actual written review']);
 assert.ok(!task.candidates.some(x=>x.id===task.contrast.id));assert.ok(task.instruction.includes('not a dislike'));assert.ok(!JSON.stringify(task.history).includes('Unwanted camera'));assert.ok(JSON.parse(task.instruction.split(' The contrast')[0]).evidence.some(row=>row.value==='dislike'&&row.content_id==='history-3'));assert.ok(result.methods[2].content_snapshot.items.some(item=>item.id===task.contrast.id));
});

test('a failed method keeps partial model receipts and cannot silently fall back',async()=>{
 const run=createResearchRunner({researchRoot,config:{model:'synthetic'},catalog,modelCall:async request=>{if(request.messages.at(-1).content.startsWith('Summarize'))throw Object.assign(Error('transport failed'),{receipt:{status:'failed',attempt_id:'failed-receipt'}});return receipt(transport(request));},pythonCall:async op=>{if(op==='search')return catalog.slice(0,10);throw Error('no BGE in boundary test');}});
 const result=await run({snapshot:snapshot(),history:[],session:{session_id:'s'},userId:'u'});
 assert.equal(result.methods[1].status,'failed');assert.equal(result.methods[1].slate.length,0);assert.equal(result.methods[1].trace.at(-1).receipt.attempt_id,'failed-receipt');assert.match(result.methods[4].error,/no BGE/);
});

test('private method state stays with its method and user while calls serialize',async()=>{
 const states=[];let active=0,maxActive=0,sequence=0;
 const run=createResearchRunner({researchRoot,catalog,modelCall:async request=>{
  maxActive=Math.max(maxActive,++active);await new Promise(setImmediate);active--;
  const text=request.messages.at(-1).content;
  if(text.startsWith('Summarize')){states.push(JSON.parse(text.split('\nINPUT: ')[1]).prior_state);return receipt({state:`own-${++sequence}`});}
  return receipt(transport(request));
 },pythonCall:async op=>op==='search'?catalog.slice(0,10):{acquired_ids:[],ordered_item_ids:[]}});
 await Promise.all([run({snapshot:snapshot(),session:{session_id:'s'},userId:'first'}),run({snapshot:snapshot(),session:{session_id:'s'},userId:'first'}),run({snapshot:snapshot(),session:{session_id:'other'},userId:'second'})]);
 assert.deepEqual(states,[null,null,'own-1','own-2',null,null]);assert.equal(maxActive,1);
});

test('real Python bridge runs pinned i2agent five stages offline without loading retrieval weights',async()=>{
 const i2Requests=[];
 const run=createResearchRunner({researchRoot,catalog,indexPath:'/path/that/does/not/exist',config:{pythonPath:'python3'},modelCall:async request=>{
  if(request.messages[0].content.startsWith('Return a JSON object matching this schema: ')){
   i2Requests.push(request);const schema=JSON.parse(request.messages[0].content.split('Return a JSON object matching this schema: ')[1].split('. Treat item text')[0]);
   const values={recommend_content:'fixture choice',profile:'fixture private profile',knowledge:'fixture knowledge',dynamic_interest:'fixture interest',dynamic_profile:'fixture dynamic profile',rerank_list:Array.from({length:10},(_,i)=>10-i),explanation:['fixture explanation']};
   return receipt(Object.fromEntries(schema.required.map(key=>[key,values[key]])));
  }
  return receipt(transport(request));
 }});
 const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',history:[{id:'second',kind:'open',track:'feed',content_id:'history-2',title:'Second camera'}]});
 assert.equal(result.methods[2].status,'submitted',result.methods[2].error);assert.equal(i2Requests.length,5);
 assert.equal(result.methods[2].runtime_source_sha256,'a2b44548dffedcb2f32b382902626df67e23cc60dff42adb3d08a51e1a6210cb');
 assert.deepEqual(result.methods[2].original_ordered_item_ids,['public-18','public-17','public-16','public-15','public-14','public-13','public-12','public-11','public-10','public-1']);
 assert.equal(result.methods[4].status,'failed');assert.match(result.methods[4].error,/FileNotFoundError/);
});

test('failed Python tools retain exact requests, timestamps and errors without fallback',async()=>{
 for(const [operation,methodId] of [['search','clawrec'],['i2agent','i2agent'],['fixed','fixed-retrieval']]){
  const calls=[];
  const run=createResearchRunner({researchRoot,catalog,modelCall:async request=>receipt(transport(request)),pythonCall:async(op,payload)=>{
   calls.push({operation:op,payload:structuredClone(payload)});
   if(op===operation)throw Object.assign(new RangeError(`offline ${operation}`),{code:'E_QA_TOOL'});
   if(op==='search')return catalog.slice(0,payload.limit);
   if(op==='i2agent')return {ordered_item_ids:payload.candidates.map(item=>item.id),source_sha256:'fixture-author'};
   return {acquired_ids:catalog.map(item=>item.id),ordered_item_ids:catalog.map(item=>item.id)};
  }});
  const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u',history:[{id:'second',kind:'open',track:'feed',content_id:'history-2',title:'Second camera'}]});
  const method=result.methods.find(item=>item.method_id===methodId),attempt=method.trace.find(item=>item.phase==='tool_call'&&item.operation===operation);
  assert.equal(method.status,'failed');assert.deepEqual(method.slate,[]);assert.equal(typeof method.implementation,'string');
  assert.ok(attempt,`${operation} request must be traced before Python throws`);assert.equal(attempt.status,'failed');
  assert.deepEqual(attempt.payload,calls.find(item=>item.operation===operation).payload);
  assert.equal(attempt.error,`offline ${operation}`);assert.equal(attempt.error_name,'RangeError');assert.equal(attempt.error_code,'E_QA_TOOL');
  assert.ok(Number.isFinite(Date.parse(attempt.started_at)));assert.ok(Date.parse(attempt.completed_at)>=Date.parse(attempt.started_at));assert.equal(attempt.response,undefined);
 }
});

test('private incremental archive writes starts before transport and retains failed receipts immediately',async()=>{
 const {mkdtempSync,readdirSync,readFileSync,statSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');
 const {createPrivateArchive}=await import('../scripts/research-preview.mjs');
 const folder=mkdtempSync(resolve(tmpdir(),'waterfall-incremental-'));
 try{
  const archive=createPrivateArchive(folder),records=()=>readdirSync(folder).flatMap(file=>readFileSync(resolve(folder,file),'utf8').trim().split('\n').map(line=>JSON.parse(line)));
  let modelCalls=0,toolCalls=0;
  const run=createResearchRunner({researchRoot,catalog,archive,modelCall:async request=>{
   modelCalls++;const saved=records(),start=saved.at(-1);assert.equal(saved[0].event,'run_start');assert.ok(saved[0].context_hash);assert.ok(saved[0].source_sha256['waterfall-core.mjs']);assert.equal(start.event,'model_start');assert.deepEqual(start.call.request,request);
   if(request.messages.at(-1).content.startsWith('Summarize'))throw Object.assign(Error('offline archived model'),{receipt:{status:'failed',attempt_id:'archived-failure'}});
   return receipt(transport(request));
  },pythonCall:async(operation,payload)=>{
   toolCalls++;const start=records().at(-1);assert.equal(start.event,'tool_start');assert.equal(start.call.operation,operation);assert.deepEqual(start.call.payload,payload);throw Error('offline archived tool');
  }});
  const result=await run({snapshot:snapshot(),session:{session_id:'s'},userId:'u'}),saved=records();
  assert.ok(modelCalls>0&&toolCalls>0);assert.ok(saved.some(row=>row.event==='model_finish'&&row.call.receipt?.attempt_id==='archived-failure'&&row.call.error==='offline archived model'));
  assert.ok(saved.some(row=>row.event==='tool_finish'&&row.call.status==='failed'&&row.call.error==='offline archived tool'));assert.equal(saved.at(-1).event,'run_complete');
  assert.ok(saved.every(row=>row.run_id===saved[0].run_id&&row.user_id==='u'&&row.session_id==='s'&&row.data_origin==='test_only'));
  assert.equal(result.methods[1].status,'failed');assert.equal(statSync(resolve(folder,readdirSync(folder)[0])).mode&0o777,0o600);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('archive write failures stop the entire group before another model or tool can execute',async()=>{
 let models=0,tools=0;
 const run=createResearchRunner({researchRoot,catalog,archive:entry=>{if(entry.event==='model_finish')throw Error('disk full');},modelCall:async request=>{models++;return receipt(transport(request));},pythonCall:async()=>{tools++;return [];} });
 await assert.rejects(()=>run({snapshot:snapshot(),session:{session_id:'s'},userId:'u'}),/research_archive_failed.*disk full/);
 assert.equal(models,1);assert.equal(tools,0);
});
