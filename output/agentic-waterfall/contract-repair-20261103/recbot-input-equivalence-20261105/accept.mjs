import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {HERE,read,ref,checked,hash,nativeInput,verifyResources} from './run-case.mjs';
import {CACHE,cachedScores,fingerprint} from './embedding-cache.mjs';

const summary=read(resolve(HERE,'summary.json'));verifyResources(summary);
const freeze=checked(read(resolve(HERE,'predictions-frozen.sha256.json')));
const metrics=read(resolve(HERE,'metrics.json')),accounting=read(resolve(HERE,'accounting.json'));
assert.equal(metrics.assigned,617);assert.equal(metrics.independent_recomputation_passed,true);
assert.equal(metrics.freeze.sha256,ref(resolve(HERE,'predictions-frozen.json')).sha256);
assert.equal(freeze.predictions.length,617);assert.equal(new Set(freeze.predictions.map(x=>x.task_id)).size,617);
const rows=new Map(readFileSync(resolve(HERE,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse).map(x=>[x.task_id,x]));
const implementation=fingerprint();let embeddings=0,empty=0;
for(const prediction of freeze.predictions){
 const row=rows.get(prediction.task_id),result=checked(prediction.native_result);
 assert.equal(result.status,'submitted');
 const folder=resolve(prediction.native_result.path,'..'),input=read(resolve(folder,'input.json'));
 assert.deepEqual(input,await nativeInput(checked(row.current_input)));
 checked(row.old_result);
 for(const stage of ['parser','planner'])assert.equal(hash(read(resolve(folder,stage==='parser'?'01-parser.request.json':'02-planner.request.json'))),row.stages[stage].current_request_sha256);
 assert.deepEqual(read(resolve(folder,'01-parser.response.json')),checked(row.stages.parser.response));
 const planner=read(resolve(folder,'02-planner.response.json'));assert.equal(planner.provider_response_model,'DeepSeek-V4.1-Flash-1017');assert.equal(planner.status,'success');
 const plan=JSON.parse(planner.content),ids=input.candidates.map(x=>x.id);
 assert.equal(plan.allowed_ids.length,101);assert.equal(new Set(plan.allowed_ids).size,101);assert.deepEqual([...plan.allowed_ids].sort(),[...ids].sort());
 const prefs=result.preferences;
 assert.ok(Object.values(prefs).every(x=>Array.isArray(x)&&x.length===0));
 const positive=[...prefs.positive_soft,...input.history.filter(x=>x.long_view===1).map(x=>x.text)].filter(Boolean).join('\n'),negative=prefs.negative_soft.join('\n');
 let scores;
 if(positive||negative){
  embeddings++;const payload={items:input.candidates,positive,negative};
  assert.equal(hash(payload),row.embedding.current_payload_sha256);
  const usage=read(resolve(folder,'embedding-cache.json')),cache=checked(usage.cache);
  assert.equal(usage.payload_sha256,hash(payload));scores=cachedScores(cache,payload,implementation);
 }else{empty++;scores={semantic:Object.fromEntries(ids.map(id=>[id,0])),negative:Object.fromEntries(ids.map(id=>[id,0]))};}
 const ranked=ids.map((id,index)=>({id,index,score:scores.semantic[id]-scores.negative[id]})).sort((a,b)=>b.score-a.score||a.index-b.index);
 assert.deepEqual(result.ordered_item_ids,ranked.map(x=>x.id));
 assert.deepEqual(result.scores,ranked.map(({id,score})=>({id,score})));
 assert.equal(result.model_request_count,1);assert.equal(result.reused_model_request_count,1);
}
assert.equal(embeddings,613);assert.equal(empty,4);
assert.equal(readdirSync(resolve(CACHE,'scores')).filter(x=>x.endsWith('.json')).length,613);
const progress=read(resolve(CACHE,'progress.json'));assert.equal(progress.status,'completed');assert.equal(progress.finished,613);
const oldFailure=rows.get('kuairand:701:test:random');assert.equal(checked(oldFailure.old_result).error,'filter without hard constraints');
assert.equal(accounting.new_parser_API_requests,0);assert.equal(accounting.distinct_successful_new_planner_responses,617);
const manifest=read(resolve(HERE,'execution-manifest.json'));
for(const source of manifest.sources){assert.equal(ref(source.path).sha256,source.sha256);assert.equal(ref(source.frozen_path).sha256,source.sha256);}
const recovery=readdirSync(resolve(HERE,'transport-recovery')).map(x=>ref(resolve(HERE,'transport-recovery',x,'manifest.json')));
const outcome={passed:true,at:new Date().toISOString(),assigned:617,submitted:617,invalid:0,unresolved:0,
 input_equivalence:{old_parser_requests_reused:617,new_planner_inputs:617,whole_old_results_reused:0,embedding_only_actual_tasks:0},
 actual_embedding_caches_used:embeddings,empty_history_skipped:empty,native_scores_and_rankings_recomputed_exactly:true,original_701_failure_unchanged:true,
 metrics:metrics.methods.recbot.groups.all,independent_scoring_passed:true,
 API_accounting:{new_parser_requests:0,distinct_successful_planner_responses:617,failed_HTTP_requests:accounting.failed_HTTP_requests,unsent_ledger_attempts:accounting.ledger_attempts_without_HTTP_start,tokens:accounting.tokens_returned_by_provider,monetary_cost:null},
 sources:{audit:ref(resolve(HERE,'audit.jsonl')),summary:ref(resolve(HERE,'summary.json')),sourcehashes:ref(resolve(HERE,'sourcehashes.json')),execution_manifest:ref(resolve(HERE,'execution-manifest.json')),
  predictions:ref(resolve(HERE,'predictions-frozen.json')),metrics:ref(resolve(HERE,'metrics.json')),accounting:ref(resolve(HERE,'accounting.json')),calibration:ref(resolve(HERE,'local-calibration/calibration.json')),embedding_implementation:ref(resolve(CACHE,'implementation.json')),embedding_progress:ref(resolve(CACHE,'progress.json')),transport_amendments:ref(resolve(HERE,'transport-amendments.jsonl')),recovery_manifests:recovery,accept_script:ref(resolve(HERE,'accept.mjs'))},
 complete_original_method:false,variant:'semantic-only-no-trained-AIA',main_table_modified:false,training_runs:0};
writeFileSync(resolve(HERE,'acceptance.json'),JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:true,assigned:617,submitted:617,embeddings,empty,metrics:outcome.metrics,acceptance:resolve(HERE,'acceptance.json')}));
