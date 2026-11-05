import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {HERE,METHOD,read,hash,ref,checked,nativeInput,capture,verifyResources} from './run-case.mjs';
import {startResident} from './controller.mjs';
import {CACHE,fingerprint,cachedScores} from './embedding-cache.mjs';

const summary=read(resolve(HERE,'summary.json'));
verifyResources({...summary,execution_sources:summary.execution_sources.filter(x=>x.path.startsWith(METHOD+'/')||x.path.endsWith('/gpu_lock.py'))});
const implementation=fingerprint();
const rows=readFileSync(resolve(HERE,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
assert.equal(rows.length,617);
const selected=rows.filter(x=>x.embedding.current_would_run_after_valid_planner);
assert.equal(selected.length,613);
mkdirSync(resolve(CACHE,'scores'),{recursive:true});
const progressPath=resolve(CACHE,'progress.json');
assert.ok(!existsSync(progressPath),'inspect existing precompute before starting another GPU worker');
let finished=0,seeded=0,resident=null;
const started=Date.now();
const progress=status=>{
 const value={status,assigned:613,finished,seeded,skipped_empty_history:4,implementation_sha256:implementation,
  model_requests:0,method_predictions:false,scoring:false,elapsed_seconds:(Date.now()-started)/1000,at:new Date().toISOString()};
 writeFileSync(progressPath+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(progressPath+'.tmp',progressPath);
};
function save(row,payload,scores,provenance,seconds){
 const record={task_id:row.task_id,payload_sha256:hash(payload),implementation_sha256:implementation,current_input:row.current_input,
  scores,scores_sha256:hash(scores),provenance,seconds,method_prediction:false,requires_valid_native_planner_before_use:true};
 cachedScores(record,payload,implementation);
 const path=resolve(CACHE,'scores',record.payload_sha256+'.json');assert.ok(!existsSync(path));
 writeFileSync(path+'.tmp',JSON.stringify(record)+'\n',{flag:'wx'});renameSync(path+'.tmp',path);finished++;
}
try{
 progress('running');
 const calibration=read(resolve(HERE,'local-calibration/calibration.json'));assert.equal(calibration.passed,true);
 const seeds=new Map(calibration.cases.filter(x=>!x.embedding_skipped).map(x=>[x.task_id,x]));
 // Existing strict calibration outputs already have the exact current effective payload; do not infer them again.
 for(const row of selected.filter(x=>seeds.has(x.task_id))){
  const seed=seeds.get(row.task_id),payload=read(seed.path);
  assert.equal(hash(payload),row.embedding.current_payload_sha256);
  assert.ok(Object.values(seed.fields).every(x=>x.np_array_equal)&&seed.ranking_identical);
  save(row,payload,read(seed.resident_scores),{kind:'strict_six_case_calibration_reused',calibration:ref(resolve(HERE,'local-calibration/calibration.json')),scores:ref(seed.resident_scores)},0);seeded++;progress('running');
 }
 resident=await startResident(resolve(CACHE,'resident.stderr.log'));
 writeFileSync(resolve(CACHE,'resident-ready.json'),JSON.stringify(resident.ready,null,2)+'\n',{flag:'wx'});
 for(const row of selected.filter(x=>!seeds.has(x.task_id))){
  if(existsSync(resolve(CACHE,'STOP')))throw Error('precompute_stopped');
  const input=await nativeInput(checked(row.current_input));
  const effective=await capture(input,JSON.parse(checked(row.stages.parser.response).content));
  assert.ok(effective.embedding);assert.equal(hash(effective.embedding),row.embedding.current_payload_sha256);
  const before=Date.now(),scores=await resident.embedding(effective.embedding);
  save(row,effective.embedding,scores,{kind:'single_resident_original_semantic_score',calibration:ref(resolve(HERE,'local-calibration/calibration.json'))},(Date.now()-before)/1000);
  progress('running');
  if(finished%25===0)console.log(JSON.stringify({finished,total:613,elapsed_seconds:(Date.now()-started)/1000}));
 }
 assert.equal(finished,613);progress('completed');
}catch(error){progress('needs_attention');throw error;}
finally{if(resident)await resident.close();}
console.log(JSON.stringify({status:'completed',finished,seeded,model_requests:0}));
