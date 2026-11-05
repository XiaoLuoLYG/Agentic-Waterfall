import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const HERE=dirname(fileURLToPath(import.meta.url));
export const BATCH=dirname(HERE);
export const ROOT=resolve(BATCH,'../../..');
export const METHOD=resolve(ROOT,'methods/agentic-waterfall');
export const read=path=>JSON.parse(readFileSync(path,'utf8'));
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const ref=path=>({path:resolve(path),sha256:hash(readFileSync(path))});
export const checked=reference=>{const raw=readFileSync(reference.path);assert.equal(hash(raw),reference.sha256,reference.path);return JSON.parse(raw);};

export async function methods(){
 assert.equal(hash(readFileSync(resolve(METHOD,'recbot/recbot.mjs'))),'29718c2c8521f41f96bc51c015d9ff5c4b91bd399b25fa39aae8c239e642cd81');
 const module=await import(pathToFileURL(resolve(METHOD,'recbot/recbot.mjs')));
 const {toKuaiRandInput}=await import(pathToFileURL(resolve(METHOD,'clawrec/kuairand_input.mjs')));
 return {...module,toKuaiRandInput};
}

export async function nativeInput(sample){
 const {toKuaiRandInput}=await methods();
 const visible=toKuaiRandInput(sample);
 return {context_id:sample.observation.decision_id,user_id:sample.observation.user_id,instruction:'',
  history:visible.history.map(x=>({id:x.id,type:'view',text:[x.caption,x.metadata].filter(Boolean).join('\n'),long_view:x.long_view,is_like:x.is_like,is_hate:x.is_hate,occurred_at:x.occurred_at,available_at:x.available_at})),
  candidates:visible.candidates.map(x=>({id:x.id,text:[x.title,x.text].filter(Boolean).join('\n')}))};
}

export function payloadOf(request){
 const content=request.messages.at(-1).content;
 const marker='\nINPUT: ';
 assert.equal(content.split(marker).length,2);
 return JSON.parse(content.split(marker)[1]);
}

export function requestFor(template,payload){
 const request=structuredClone(template),content=request.messages.at(-1).content;
 payloadOf(request);
 request.messages.at(-1).content=content.slice(0,content.indexOf('\nINPUT: '))+'\nINPUT: '+JSON.stringify(payload);
 return request;
}

export async function capture(input,preferences,actualPlan=null){
 const {runRecBot,emptyState}=await methods();
 const value={requests:{},embedding:null,error:null};
 try{
  await runRecBot({state:emptyState(input.user_id),command:input.instruction,
   history:input.history.filter(x=>x.long_view===1),candidates:input.candidates,
   model:async(stage,payload)=>{value.requests[stage]=payload;return stage==='parser'?structuredClone(preferences):actualPlan??{allowed_ids:input.candidates.map(x=>x.id),tools:[]};},
   embedding:async(items,positive,negative)=>{value.embedding={items,positive,negative};return {semantic:Object.fromEntries(items.map(x=>[x.id,0])),negative:Object.fromEntries(items.map(x=>[x.id,0]))};}});
 }catch(error){value.error=error.message;}
 return value;
}

function parseReceipt(receipt,historical=false){
 assert.equal(receipt.status,'success');
 assert.ok((historical?['DeepSeek-V4.1-Flash-1017','DeepSeek-V4.1-Flash']:['DeepSeek-V4.1-Flash-1017']).includes(receipt.provider_response_model),'unexpected model receipt');
 if(receipt.finish_reason==='length')throw Error('truncated response');
 return JSON.parse(receipt.content);
}

// The injected functions keep the complete episode testable without a network or a model load.
export async function episode(record,{input,model,embedding,save}){
 const {runRecBot,emptyState}=await methods();
 let paid=0,reused=0;
 const state=emptyState(input.user_id);
 try{
  const result=await runRecBot({state,command:input.instruction,history:input.history.filter(x=>x.long_view===1),candidates:input.candidates,
   model:async(stage,payload)=>{
    const old=record.stages[stage],request=requestFor(checked(old.request),payload);
    assert.equal(hash(request),old.current_request_sha256,stage+': request differs from reviewed plan');
    save(stage==='parser'?'01-parser.request.json':'02-planner.request.json',request);
    let receipt;
    if(old.reusable){assert.equal(hash(request),old.old_request_sha256);receipt=checked(old.response);reused++;}
    else {paid++;try{receipt=await model(request,{experiment:'method-deployment'});}catch(error){save(stage==='parser'?'01-parser.error.json':'02-planner.error.json',error.receipt??{error:error.message});throw error;}}
    save(stage==='parser'?'01-parser.response.json':'02-planner.response.json',receipt);
    return parseReceipt(receipt,old.reusable);
   },
   embedding:async(items,positive,negative)=>{
    const payload={items,positive,negative};
    assert.equal(hash(payload),record.embedding.current_payload_sha256,'embedding differs from reviewed plan');
    save('embedding-input.sha256.json',{sha256:hash(payload),positive_characters:positive.length,negative_characters:negative.length,candidate_count:items.length});
    return embedding(payload);
   }});
  save('state.json',state);
  return {status:'submitted',method:'recbot',context_id:record.task_id,...result,
   model_request_count:paid,reused_model_request_count:reused,original_result:record.old_result,
   effective_input_audit:record.audit_source,comparison_condition:'recent-512-visible-events-v1; full public text; original semantic-only no-AIA logic'};
 }catch(error){
  return {status:'failed',method:'recbot',context_id:record.task_id,error:error.message,error_name:error.name,
   requests:paid,reused_model_request_count:reused,original_result:record.old_result,effective_input_audit:record.audit_source};
 }
}

export function verifyResources(manifest){
 for(const reference of manifest.execution_sources)assert.equal(hash(readFileSync(reference.path)),reference.sha256,reference.path);
 for(const file of manifest.bge_files){
  const stat=statSync(file.path);
  assert.equal(stat.size,file.size,file.path);
  assert.equal(stat.mtimeMs,file.mtime_ms,file.path);
 }
}

async function localEmbedding(payload){
 const python=resolve(METHOD,'fixed-retrieval/.venv/bin/python');
 const lock=resolve(ROOT,'output/agentic-waterfall/full-expansion-20261030/runtime/formal');
 const source="import runpy,sys;sys.path.insert(0,sys.argv[1]);from gpu_lock import locked\nwith locked():runpy.run_path(sys.argv[2],run_name='__main__')";
 return new Promise((done,fail)=>{
  const child=spawn(python,['-c',source,lock,resolve(METHOD,'recbot/semantic.py')],{stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',fail);
  child.on('close',code=>{if(code!==0)return fail(Error('embedding failed '+code+': '+stderr.slice(-500)));try{done(JSON.parse(stdout));}catch(error){fail(error);}});
  child.stdin.end(JSON.stringify(payload));
 });
}

export async function liveClient(){
 const shared=resolve(BATCH,'full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-ledger.json');
 assert.ok(existsSync(shared+'.sqlite.enabled'),'shared SQLite ledger is required');
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(shared+'.sqlite',{readOnly:true});
 const settings=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='settings'").get().value);db.close();
 for(const [slot,cap] of Object.entries({primary:10,secondary:16,tertiary:10})){
  assert.ok(Number.isSafeInteger(settings.credential_policy?.max_concurrent?.[slot])&&settings.credential_policy.max_concurrent[slot]<=cap,'unexpected concurrency policy');
  assert.ok(Number.isSafeInteger(settings.credential_policy?.rpm?.[slot])&&settings.credential_policy.rpm[slot]<=50,'unexpected RPM policy');
 }
 process.env.WATERFALL_FORMAL_ROUTE='1';process.env.WATERFALL_MODEL_TIMEOUT_MS='180000';
 process.env.WATERFALL_REQUEST_GATE_DIR=resolve(BATCH,'full-agentrecbench-20261103/request-gates');
 process.env.MODEL_CONFIG_FILE=resolve(ROOT,'HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json');
 assert.ok(existsSync(process.env.MODEL_CONFIG_FILE),'configured model file is missing');
 await import(pathToFileURL(resolve(BATCH,'transport-retry/register.mjs')));
 return (await import(pathToFileURL(resolve(BATCH,'full-agentrecbench-20261103/frozen/client.mjs')))).callModel;
}

async function main(){
 const [task,flag='--check']=process.argv.slice(2);
 assert.ok(task&&['--check','--execute'].includes(flag),'usage: node run-case.mjs kuairand:ID:test:STRATUM [--check|--execute]');
 const manifest=read(resolve(HERE,'summary.json'));
 const record=readFileSync(resolve(HERE,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse).find(x=>x.task_id===task);
 assert.ok(record,'task is outside frozen 617 assignments');
 assert.ok(record.stages.parser.reusable,'only the reviewed reusable parser condition is supported');
 verifyResources(manifest);
 checked(record.old_result);checked(record.old_native_input);
 const sample=checked(record.current_input),input=await nativeInput(sample);
 assert.equal(input.context_id,task);
 const preferences=parseReceipt(checked(record.stages.parser.response),true);
 const effective=await capture(input,preferences);
 for(const stage of ['parser','planner'])assert.equal(hash(requestFor(checked(record.stages[stage].request),effective.requests[stage])),record.stages[stage].current_request_sha256);
 assert.equal(effective.embedding===null?null:hash(effective.embedding),record.embedding.current_payload_sha256);
 if(flag==='--check'){console.log(JSON.stringify({task_id:task,action:record.action,reusable_parser:true,new_planner:!record.stages.planner.reusable,local_embedding:effective.embedding!==null,network_requests:0}));return;}
 const out=resolve(HERE,'execution',task.replaceAll(':','-'));
 assert.ok(!existsSync(out),'existing episode must be inspected; never resample a method failure');
 const save=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 if(record.action==='reuse_result'){
  mkdirSync(out,{recursive:true});save('result.json',checked(record.old_result));save('reuse.json',{reason:'all effective inputs and implementation identical',original:record.old_result,new_model_requests:0});return;
 }
 const callModel=await liveClient();
 mkdirSync(out,{recursive:true});save('input.json',input);save('selection.json',record);
 const result=await episode(record,{input,model:callModel,embedding:localEmbedding,save});
 if(result.status==='submitted'){
  assert.equal(result.ordered_item_ids.length,101);assert.equal(new Set(result.ordered_item_ids).size,101);
  assert.deepEqual([...result.ordered_item_ids].sort(),input.candidates.map(x=>x.id).sort());
 }
 save('result.json',result);
 console.log(JSON.stringify({task_id:task,status:result.status,error:result.error??null,new_model_requests:result.model_request_count??result.requests,reused_requests:result.reused_model_request_count}));
 if(result.status!=='submitted')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
