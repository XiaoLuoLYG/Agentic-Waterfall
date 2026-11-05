import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync,realpathSync,readdirSync,createReadStream} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {HERE,BATCH,ROOT,METHOD,read,hash,ref,checked,same,nativeInput,capture,requestFor,payloadOf} from './run-case.mjs';

const sources=new Map();
function bind(path){const value=ref(path);sources.set(value.path,value);return value;}
function save(name,value){writeFileSync(resolve(HERE,name),JSON.stringify(value,null,2)+'\n');}
const base=resolve(ROOT,'output/agentic-waterfall');
const score=resolve(base,'unified-scoring-20261101/offline/kuairand/test/full-assigned/recbot');
const snapshotPath=resolve(base,'unified-scoring-20261101/full-primary-baseline-view.json');
const snapshot=checked(bind(snapshotPath));
const selected=Object.values(snapshot.records).filter(x=>x.dataset==='kuairand'&&x.method==='recbot'&&x.split==='test');
const original=new Map(selected.map(x=>[x.task_id,x]));
const predictions=new Map(checkedLines(bind(resolve(score,'predictions.jsonl'))).map(x=>[x.decision_id,x]));
const projections=new Map(checkedLines(bind(resolve(score,'inputs.jsonl'))).map(x=>[x.observation.decision_id,x]));
bind(resolve(score,'truth-evaluator-only.jsonl')); // Hash only; no evaluator target is parsed or used.
const assignment=checked(bind(resolve(BATCH,'kuairand-window512-20261103/assignment.json'))).cases;
assert.equal(assignment.length,617);assert.equal(original.size,617);assert.equal(predictions.size,617);assert.equal(projections.size,617);
assert.equal(new Set(assignment.map(x=>x.task_id)).size,617);

const codePaths=['recbot/recbot.mjs','recbot/semantic.py','fixed-retrieval/retrieval.py','clawrec/kuairand_input.mjs','paper-reproductions-run.mjs'];
const executionSources=codePaths.map(x=>bind(resolve(METHOD,x)));
executionSources.push(bind(resolve(base,'full-expansion-20261030/runtime/formal/gpu_lock.py')));
for(const file of ['register.mjs','model-client.mjs','request-gate.mjs','ledger-store.mjs'])executionSources.push(bind(resolve(BATCH,'transport-retry',file)));
executionSources.push(bind(resolve(BATCH,'full-agentrecbench-20261103/frozen/client.mjs')));
executionSources.push(bind(resolve(BATCH,'full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-client.mjs')));
executionSources.push(bind(resolve(BATCH,'full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-response.mjs')));
for(const file of codePaths.slice(0,3)){
 const reference=executionSources.find(x=>x.path===resolve(METHOD,file));
 for(const archive of ['formal-20261029-224252','formal-20261030-glm53flash','full-expansion-20261030/runtime'])assert.equal(bind(resolve(base,archive,'methods/agentic-waterfall',file)).sha256,reference.sha256,file+' changed in historical archive');
}

const bge=resolve(METHOD,'fixed-retrieval/weights/bge-m3');
const bgeFiles=[];
for(const name of readdirSync(bge).filter(x=>!x.startsWith('.')).sort()){
 const path=resolve(bge,name),stat=statSync(path);if(!stat.isFile())continue;
 const digest=createHash('sha256');for await(const bytes of createReadStream(path))digest.update(bytes);
 const reference={path,sha256:digest.digest('hex'),size:stat.size,mtime_ms:stat.mtimeMs};
 bgeFiles.push(reference);sources.set(path,reference);
}
const weight=bgeFiles.find(x=>x.path.endsWith('/pytorch_model.bin'));
const cached=readFileSync(resolve(bge,'.cache/huggingface/download/pytorch_model.bin.metadata'),'utf8').trim().split('\n');
assert.equal(cached[0],'5617a9f61b028005a4858fdac845db406aefb181');assert.equal(weight.sha256,cached[1]);
const bgeArchivePaths=['formal-20261029-224252','formal-20261030-glm53flash','full-expansion-20261030/runtime'].map(x=>resolve(base,x,'methods/agentic-waterfall/fixed-retrieval/weights/bge-m3'));
assert.ok(bgeArchivePaths.every(x=>realpathSync(x)===realpathSync(bge)));

const rows=[],counts={parser_reusable:0,parser_changed:0,planner_reusable:0,planner_changed:0,reuse_result:0,embedding_only:0,new_planner:0,candidate_ids_or_order_changed:0},oldRoots={},historicalModels={},oldHistoryCounts={},currentHistoryCounts={};
const count=key=>counts[key]=(counts[key]??0)+1;
for(const current of assignment){
 const old=original.get(current.task_id),prediction=predictions.get(current.task_id);
 assert.ok(old&&prediction);const oldResult=old.selected_result;
 const result=checked(oldResult);sources.set(oldResult.path,oldResult);
 const folder=resolve(oldResult.path,'..');
 const oldInputRef=bind(resolve(folder,'input.json')),oldInput=checked(oldInputRef);
 assert.equal(oldInput.context_id,current.task_id);assert.equal(result.context_id,current.task_id);
 assert.equal(oldInput.provenance.method_source_sha256,executionSources[0].sha256);
 assert.equal(oldInput.provenance.runner_sha256,executionSources[4].sha256);
 assert.equal(result.status,prediction.status);assert.deepEqual(result.ordered_item_ids??[],prediction.ordered_item_ids);assert.equal(result.error??null,prediction.error??null);
 const currentRef=bind(current.path);assert.equal(currentRef.sha256,current.sha256);
 const sample=checked(currentRef),input=await nativeInput(sample);
 assert.equal(input.history.length,current.retained_history_count);assert.ok(input.history.length<=512);
 assert.equal(input.candidates.length,101);
 assert.deepEqual(input.candidates.map(x=>x.id),current.candidate_ids);
 assert.deepEqual(oldInput.candidates.map(x=>x.id),projections.get(current.task_id).observation.environment.candidate_pool.map(x=>x.id));
 const stages={};
 const receipts={};
 for(const stage of ['parser','planner']){
  const prefix=stage==='parser'?'01-parser':'02-planner';
  stages[stage]={request:bind(resolve(folder,prefix+'.request.json')),response:bind(resolve(folder,prefix+'.response.json'))};
  const receipt=checked(stages[stage].response);assert.equal(receipt.status,'success');assert.ok(['DeepSeek-V4.1-Flash-1017','DeepSeek-V4.1-Flash'].includes(receipt.provider_response_model));assert.notEqual(receipt.finish_reason,'length');
  stages[stage].historical_requested_model=receipt.requested_model;stages[stage].historical_provider_model=receipt.provider_response_model;
  if(stage==='parser')historicalModels[receipt.provider_response_model]=(historicalModels[receipt.provider_response_model]??0)+1;
  receipts[stage]=JSON.parse(receipt.content);
 }
 assert.ok(Object.values(receipts.parser).every(x=>Array.isArray(x)&&x.length===0),'unexpected nonempty historical parser preferences');
 const before=await capture(oldInput,receipts.parser),after=await capture(input,receipts.parser);
 assert.equal(before.error,null);assert.equal(after.error,null);
 for(const stage of ['parser','planner']){
  const template=checked(stages[stage].request);
  assert.deepEqual(before.requests[stage],payloadOf(template),'original native input does not reproduce original '+stage+' payload');
  const newRequest=requestFor(template,after.requests[stage]);
  Object.assign(stages[stage],{old_request_sha256:hash(template),current_request_sha256:hash(newRequest),reusable:same(template,newRequest)});
  if(stages[stage].reusable)count(stage+'_reusable');else count(stage+'_changed');
 }
 const actualOld=await capture(oldInput,receipts.parser,receipts.planner);
 assert.equal(actualOld.error,result.error??null,'old guard result differs');
 const changedIndices=input.candidates.flatMap((x,index)=>same(x,oldInput.candidates[index])?[]:[index]);
 const hasPositiveBefore=before.requests.planner.has_positive_history,hasPositiveAfter=after.requests.planner.has_positive_history;
 const embedding={old_payload_sha256:before.embedding===null?null:hash(before.embedding),current_payload_sha256:after.embedding===null?null:hash(after.embedding),
  payload_same:same(before.embedding,after.embedding),old_reached_embedding:actualOld.embedding!==null,current_would_run_after_valid_planner:after.embedding!==null};
 const entireSame=stages.parser.reusable&&stages.planner.reusable&&embedding.payload_same;
 const action=entireSame?'reuse_result':stages.parser.reusable&&stages.planner.reusable?'embedding_only':'new_planner';
 assert.ok(stages.parser.reusable,'unexpected parser drift requires a separate reviewed plan');
 count(action);count('old_'+result.status);
 if(changedIndices.length)count('candidate_fulltext_changed');
 if(!same(oldInput.candidates.map(x=>x.id),input.candidates.map(x=>x.id)))count('candidate_ids_or_order_changed');
 if(hasPositiveBefore!==hasPositiveAfter)count('has_positive_history_changed');
 if(!embedding.payload_same)count('embedding_payload_changed');
 if(after.embedding!==null)count('embedding_after_valid_planner');else count('embedding_skipped_empty_preferences_and_history');
 const beforePositive=oldInput.history.filter(x=>x.long_view===1).map(x=>x.text).filter(Boolean).join('\n');
 const afterPositive=input.history.filter(x=>x.long_view===1).map(x=>x.text).filter(Boolean).join('\n');
 if(beforePositive!==afterPositive)count('positive_history_text_changed');else count('positive_history_text_same');
 const oldRoot=oldResult.path.split('/output/agentic-waterfall/')[1].split('/')[0];oldRoots[oldRoot]=(oldRoots[oldRoot]??0)+1;
 oldHistoryCounts[oldInput.history.length]=(oldHistoryCounts[oldInput.history.length]??0)+1;
 currentHistoryCounts[input.history.length]=(currentHistoryCounts[input.history.length]??0)+1;
 rows.push({task_id:current.task_id,action,old_status:result.status,old_error:result.error??null,old_result:oldResult,old_native_input:oldInputRef,current_input:currentRef,
  candidate_ids_and_order_same:same(oldInput.candidates.map(x=>x.id),input.candidates.map(x=>x.id)),candidate_changed_indices:changedIndices,
  history:{old_events:oldInput.history.length,current_events:input.history.length,old_positive_events:oldInput.history.filter(x=>x.long_view===1).length,current_positive_events:input.history.filter(x=>x.long_view===1).length,
   has_positive_history_changed:hasPositiveBefore!==hasPositiveAfter,positive_text_same:beforePositive===afterPositive},stages,embedding,
  audit_source:{path:resolve(HERE,'audit.jsonl'),policy:'actual original native payload equality; raw projection hashes do not determine reuse'}});
}
assert.equal(rows.length,617);
const summary={assigned:617,counts,old_sources:oldRoots,history_event_counts:{old:oldHistoryCounts,current:currentHistoryCounts},historical_parser_models:historicalModels,
 historical_model_note:'6 early receipts identify DeepSeek-V4.1-Flash without -1017; the parent task confirms the user previously accepted this as the same model alias, without independent server-side weight evidence. All parser results are empty preference arrays and retain their original receipt lineage. New Planner receipts must identify DeepSeek-V4.1-Flash-1017.',
 model_requests_sent:0,embedding_model_loads:0,training_runs:0,evaluator_targets_parsed_by_audit:false,
 condition:'current complete public text + most recent 512 raw events; retain original RecBot long_view===1 selection, exact Parser/Planner prompts and original BGE max_length=512 logic',
 variant:'semantic-only-no-trained-AIA',complete_original_method:false,
 preserved_original_failure:rows.filter(x=>x.old_status==='failed').map(x=>({task_id:x.task_id,error:x.old_error,action:x.action,source:x.old_result})),
 execution_sources:executionSources,bge_files:bgeFiles,bge_revision:cached[0],bge_weight_sha256:weight.sha256,bge_historical_paths_resolve_to_same_files:true,
 excluded_current_v6:{reason:'unavailable original-RecBot entry and changed embedding token policy; neither is used in this authorized no-AIA continuation',
  files:['recbot/recbot.mjs','recbot/semantic.py','fixed-retrieval/retrieval.py'].map(x=>bind(resolve(BATCH,'frozen/v6/code/methods/agentic-waterfall',x)))},
 limits:{new_planner_calls:counts.planner_changed??0,reused_parser_calls:counts.parser_reusable??0,local_embeddings_at_most:counts.embedding_after_valid_planner??0,
  credential_concurrency_ceiling:{primary:10,secondary:16,tertiary:10},rpm_ceiling_per_credential:50,request_gate_wait_seconds:90},
 scope:'Only this directory is written; original attempts, main table, other runners, shared limits and credentials are untouched.'};
writeFileSync(resolve(HERE,'audit.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
save('summary.json',summary);save('sourcehashes.json',{algorithm:'sha256',files:[...sources.values()].sort((a,b)=>a.path.localeCompare(b.path))});
save('pilot6.json',{executed:false,mode:'new planner only; reuse original parser; original local BGE when needed',cases:[
 {task_id:'kuairand:2:test:random',reason:'ordinary candidate and positive-history text alignment'},
 {task_id:'kuairand:19:test:standard',reason:'has_positive_history false to true'},
 {task_id:'kuairand:146:test:standard',reason:'empty history; no embedding'},
 {task_id:'kuairand:701:test:random',reason:'archived genuine planner guard failure; new changed input only'},
 {task_id:'kuairand:87:test:standard',reason:'preserve accepted historical model-alias receipt'},
 {task_id:'kuairand:318:test:random',reason:'current window512 pilot identity'}]});
console.log(JSON.stringify({assigned:617,counts,bge_weight_sha256:weight.sha256,model_requests_sent:0,embedding_model_loads:0}));

function checkedLines(reference){const raw=readFileSync(reference.path);assert.equal(hash(raw),reference.sha256);return raw.toString('utf8').trim().split('\n').map(JSON.parse);}
