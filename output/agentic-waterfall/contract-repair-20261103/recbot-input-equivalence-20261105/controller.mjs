import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,createWriteStream,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {HERE,METHOD,read,ref,checked,hash,nativeInput,episode,verifyResources,liveClient} from './run-case.mjs';
import {CACHE,waitingCache} from './embedding-cache.mjs';

const methodErrors=new Set(['invalid request','invalid public items','duplicate candidate','invalid parser result','unknown allowed candidate','invalid tool plan','filter without hard constraints','invalid semantic scores','truncated response']);
export const terminal=result=>result.status==='submitted'||result.status==='failed'&&(result.error_name==='SyntaxError'||methodErrors.has(result.error)||/^(Unexpected token|Unexpected end|Expected property name|Unexpected non-whitespace)/.test(result.error??''));

export function semaphore(limit){
 assert.ok(Number.isSafeInteger(limit)&&limit>0);
 let active=0;const waiting=[];
 return async action=>{
  if(active<limit)active++;else await new Promise(done=>waiting.push(done));
  try{return await action();}finally{const next=waiting.shift();if(next)next();else active--;}
 };
}

export function serial(action){
 let tail=Promise.resolve();
 return payload=>{const result=tail.then(()=>action(payload));tail=result.catch(()=>{});return result;};
}

export function validate(result,input){
 assert.equal(result.context_id,input.context_id);assert.equal(result.method,'recbot');
 assert.equal(result.reused_model_request_count,1);
 assert.equal(result.model_request_count??result.requests,1);
 if(result.status==='submitted'){
  assert.ok(!result.error&&!result.continuation_error&&!result.action_failures);
  assert.equal(result.ordered_item_ids.length,101);assert.equal(new Set(result.ordered_item_ids).size,101);
  assert.deepEqual([...result.ordered_item_ids].sort(),input.candidates.map(x=>x.id).sort());
 }
}

function write(path,value,exclusive=false){writeFileSync(path,JSON.stringify(value,null,2)+'\n',exclusive?{flag:'wx'}:{});}

export async function startResident(logPath){
 const calibration=read(resolve(HERE,'local-calibration/calibration.json'));
 assert.equal(calibration.passed,true,'resident service was not calibrated');
 const source=resolve(HERE,'resident-bge.py');
 assert.equal(hash(readFileSync(source)),calibration.source_sha256[source],'resident source differs from strict calibration');
 const child=spawn(resolve(METHOD,'fixed-retrieval/.venv/bin/python'),[source],{stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
 const log=createWriteStream(logPath,{flags:'wx'});child.stderr.pipe(log);
 const done=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',code=>code===0?accept():reject(Error('resident_embedding_process_failed '+code)));});
 done.catch(()=>{});
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 let ready;
 try{ready=JSON.parse((await lines.next()).value);assert.equal(ready.type,'ready');assert.equal(ready.device,'mps');assert.equal(ready.dtype,'torch.float32');}
 catch(error){child.kill();await done.catch(()=>{});throw error;}
 let index=0;
 const embedding=serial(async payload=>{
  const id=String(++index);assert.ok(child.exitCode===null,'resident service exited');
  child.stdin.write(JSON.stringify({id,payload})+'\n');
  const value=await lines.next();assert.equal(value.done,false,'resident service closed before durable output');
  const response=JSON.parse(value.value);assert.equal(response.type,'result');assert.equal(response.id,id);
  return response.scores;
 });
 return {embedding,ready,close:async()=>{child.stdin.end();await done;}};
}

async function main(){
 const [flag='--check',phase='pilot']=process.argv.slice(2);
 assert.ok(['--check','--execute'].includes(flag)&&['pilot','full'].includes(phase),'usage: node controller.mjs --check|--execute pilot|full');
 const summary=read(resolve(HERE,'summary.json'));
 verifyResources(summary);
 const all=readFileSync(resolve(HERE,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(all.length,617);assert.ok(all.every(x=>x.stages.parser.reusable&&!x.stages.planner.reusable&&x.action==='new_planner'));
 const pilotIds=new Set(read(resolve(HERE,'pilot6.json')).cases.map(x=>x.task_id));
 const selected=phase==='pilot'?all.filter(x=>pilotIds.has(x.task_id)):all;
 assert.equal(selected.length,phase==='pilot'?6:617);
 const calibration=read(resolve(HERE,'local-calibration/calibration.json'));assert.equal(calibration.passed,true);
 if(flag==='--check'){console.log(JSON.stringify({phase,assigned:selected.length,planner_concurrency:36,gpu_workers:1,reused_parser:selected.length,new_planner:selected.length,strict_resident_calibration_passed:true,
  embedding_precompute:existsSync(resolve(CACHE,'progress.json'))?read(resolve(CACHE,'progress.json')):null,network_requests:0}));return;}
 assert.ok(!existsSync(resolve(HERE,'predictions-frozen.json')),'predictions already frozen; do not repeat this experiment');
 if(phase==='full'){
  const pilot=read(resolve(HERE,'pilot-report.json'));
  assert.equal(pilot.status,'completed');assert.equal(pilot.assigned,6);assert.equal(pilot.service_failures,0);
  const scores=read(resolve(HERE,'pilot-metrics.json'));
  assert.equal(scores.assigned,6);assert.equal(scores.independent_recomputation_passed,true);
  assert.equal(scores.freeze.sha256,ref(resolve(HERE,'pilot-predictions-frozen.json')).sha256);
 }
 const existing=new Map();
 const inputs=new Map();
 for(const row of selected){checked(row.old_result);checked(row.old_native_input);inputs.set(row.task_id,await nativeInput(checked(row.current_input)));}
 for(const row of selected){
  const folder=resolve(HERE,'execution',row.task_id.replaceAll(':','-'));
  if(existsSync(folder)){
   const result=read(resolve(folder,'result.json'));
   assert.deepEqual(read(resolve(folder,'selection.json')),row,'existing episode selection differs');
   existing.set(row.task_id,{folder,result});
  }
 }
 const run=resolve(HERE,'controller-'+phase+'-'+new Date().toISOString().replaceAll(':','-'));mkdirSync(run);
 const live=await liveClient();
 const useCache=existsSync(resolve(CACHE,'progress.json'));
 const resident=useCache?{embedding:waitingCache(),ready:{type:'independent_durable_embedding_precompute',progress:ref(resolve(CACHE,'progress.json'))},close:async()=>{}}:await startResident(resolve(run,'resident.stderr.log'));
 write(resolve(run,'resident-ready.json'),resident.ready,true);
 const slot=semaphore(36);
 const records=[];let halt=null,modelStages=0;
 const progress=()=>write(resolve(run,'progress.json'),{phase,assigned:selected.length,finished:records.length,submitted:records.filter(x=>x.result.status==='submitted').length,
  service_failures:records.filter(x=>!terminal(x.result)).length,new_native_planner_stages:modelStages,halt,at:new Date().toISOString()});
 try{
  const settled=await Promise.allSettled(selected.map(async row=>{
   const input=inputs.get(row.task_id);
   let folder,result;
   if(existing.has(row.task_id))({folder,result}=existing.get(row.task_id));
   else {
    folder=resolve(HERE,'execution',row.task_id.replaceAll(':','-'));mkdirSync(resolve(HERE,'execution'),{recursive:true});mkdirSync(folder);
    const save=(name,value)=>write(resolve(folder,name),value,true);
    save('input.json',input);save('selection.json',row);
    result=await episode(row,{input,save,embedding:async payload=>{
     const scores=await resident.embedding(payload);
     if(useCache)save('embedding-cache.json',{payload_sha256:hash(payload),cache:ref(resolve(CACHE,'scores',hash(payload)+'.json'))});
     return scores;
    },
     model:(request,options)=>slot(async()=>{
      if(halt)throw Error('controller_halted_before_request');
      if(existsSync(resolve(HERE,'STOP')))throw Error('controller_stopped_before_request');
      modelStages++;
      try{return await live(request,options);}catch(error){if(/budget_exhausted|provider_model_mismatch|model_calls_not_enabled/.test(error.message))halt=error.message;throw error;}
     })});
    save('result.json',result);
   }
   // Infrastructure failures stay unresolved. Only native method terminals can enter the scoring freeze.
   if(terminal(result))validate(result,input);
   records.push({task_id:row.task_id,folder,result,result_ref:ref(resolve(folder,'result.json'))});progress();
   console.log(JSON.stringify({task_id:row.task_id,status:result.status,error:result.error??null,reused_existing:existing.has(row.task_id)}));
  }));
  const failed=settled.filter(x=>x.status==='rejected');
  if(failed.length)throw Error('controller_artifact_validation_failed: '+failed.map(x=>x.reason.message).join('; '));
 }finally{await resident.close();}
 const unresolved=records.filter(x=>!terminal(x.result));
 const report={status:records.length===selected.length&&!unresolved.length?'completed':'needs_attention',phase,assigned:selected.length,
  submitted:records.filter(x=>x.result.status==='submitted').length,method_failures:records.filter(x=>terminal(x.result)&&x.result.status==='failed').length,
  service_failures:unresolved.length,new_native_planner_stages:modelStages,reused_existing:existing.size,run,
  records:records.map(x=>({task_id:x.task_id,result:x.result_ref,status:x.result.status,error:x.result.error??null}))};
 write(resolve(HERE,phase==='pilot'?'pilot-report.json':'full-report.json'),report);
 if(report.status==='completed'){
  const byTask=new Map(records.map(x=>[x.task_id,x]));
  const freeze={assigned:selected.length,phase,method:'recbot',variant:'semantic-only-no-trained-AIA',history_policy:'recent-512-visible-events-v1',
   evaluator_targets_read:false,scoring_performed:false,audit:ref(resolve(HERE,'audit.jsonl')),summary:ref(resolve(HERE,'summary.json')),calibration:ref(resolve(HERE,'local-calibration/calibration.json')),
   assignments:selected.map(x=>({task_id:x.task_id,input:x.current_input,candidate_ids:checked(x.current_input).observation.environment.candidate_pool.map(c=>c.id)})),
   predictions:selected.map(row=>{const item=byTask.get(row.task_id),result=item.result;return {task_id:row.task_id,status:result.status,ordered_item_ids:result.status==='submitted'?result.ordered_item_ids:[],error:result.error??null,native_result:item.result_ref,
    native_artifacts:readdirSync(item.folder).filter(x=>x.endsWith('.json')).sort().map(x=>ref(resolve(item.folder,x)))};})};
  const prefix=phase==='pilot'?'pilot-':'';
  write(resolve(HERE,prefix+'predictions-frozen.json'),freeze,true);
  write(resolve(HERE,prefix+'predictions-frozen.sha256.json'),ref(resolve(HERE,prefix+'predictions-frozen.json')),true);
 }
 console.log(JSON.stringify(report));if(report.status!=='completed')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
