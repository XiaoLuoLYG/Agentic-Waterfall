import assert from 'node:assert/strict';
import test from 'node:test';
import {semaphore,serial,terminal,validate} from './controller.mjs';
import {read,hash,HERE} from './run-case.mjs';
import {resolve} from 'node:path';
import {CACHE,cachedScores,fingerprint} from './embedding-cache.mjs';

test('36 planner slots remain available while the independent single GPU queue runs',async()=>{
 const api=semaphore(36);let active=0,peak=0,gpuActive=0,gpuPeak=0,modelsDone=0;
 const gpu=serial(async value=>{gpuActive++;gpuPeak=Math.max(gpuPeak,gpuActive);await new Promise(done=>setTimeout(done,1));gpuActive--;return value;});
 await Promise.all(Array.from({length:72},async(_,index)=>{
  const value=await api(async()=>{active++;peak=Math.max(peak,active);await new Promise(done=>setTimeout(done,1));active--;modelsDone++;return index;});
  assert.equal(await gpu(value),index);
 }));
 assert.equal(peak,36);assert.equal(gpuPeak,1);assert.equal(modelsDone,72);
});

test('all 72 planner calls finish while the first GPU result is deliberately blocked',async()=>{
 const api=semaphore(36);let calls=0,completed=0,unblock;
 const blocked=new Promise(done=>unblock=done),gpu=serial(async value=>{await blocked;return value;});
 const jobs=Array.from({length:72},async(_,index)=>{await api(async()=>{calls++;});await gpu(index);completed++;});
 await new Promise(done=>setTimeout(done,10));
 assert.equal(calls,72);assert.equal(completed,0);
 unblock();await Promise.all(jobs);assert.equal(completed,72);
});

test('infrastructure failures cannot enter freeze, and the original native guard failure can',()=>{
 assert.equal(terminal({status:'submitted'}),true);
 assert.equal(terminal({status:'failed',error:'filter without hard constraints'}),true);
 assert.equal(terminal({status:'failed',error:"Expected ',' or ']' after array element",error_name:'SyntaxError'}),true);
 for(const error of ['model_transport_error','request_gate_call_deadline_exceeded','embedding failed 1','controller_stopped_before_request','ledger_locked_manual_inspection_required'])assert.equal(terminal({status:'failed',error}),false);
});

test('freeze admission requires 101 exact IDs, one reused parser and one new planner',()=>{
 const ids=Array.from({length:101},(_,n)=>'id:'+n),input={context_id:'task',candidates:ids.map(id=>({id}))};
 const result={context_id:'task',method:'recbot',status:'submitted',reused_model_request_count:1,model_request_count:1,ordered_item_ids:ids};
 validate(result,input);
 assert.throws(()=>validate({...result,ordered_item_ids:ids.slice(0,100)},input));
 assert.throws(()=>validate({...result,model_request_count:2},input));
});

test('five calibrated cache entries require exact payload and implementation fingerprints',()=>{
 const calibration=read(resolve(HERE,'local-calibration/calibration.json'));
 const implementation=fingerprint();
 for(const row of calibration.cases.filter(x=>!x.embedding_skipped)){
  const payload=read(row.path),record=read(resolve(CACHE,'scores',hash(payload)+'.json'));
  assert.deepEqual(cachedScores(record,payload,implementation),read(row.resident_scores));
  assert.throws(()=>cachedScores(record,{...payload,positive:payload.positive+' changed'},implementation));
  assert.throws(()=>cachedScores(record,payload,'wrong implementation'));
 }
});
