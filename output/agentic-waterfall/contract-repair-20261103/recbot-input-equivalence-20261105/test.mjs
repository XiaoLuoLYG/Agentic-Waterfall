import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {HERE,read,hash,checked,capture,nativeInput,requestFor,episode} from './run-case.mjs';

const rows=readFileSync(resolve(HERE,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const zeros=payload=>({semantic:Object.fromEntries(payload.items.map(x=>[x.id,0])),negative:Object.fromEntries(payload.items.map(x=>[x.id,0]))});
const receipt=plan=>({status:'success',provider_response_model:'DeepSeek-V4.1-Flash-1017',finish_reason:'stop',content:JSON.stringify(plan)});
const prefs=row=>JSON.parse(checked(row.stages.parser.response).content);

test('all 617 actual requests are stage-accounted with no whole-result reuse',()=>{
 const summary=read(resolve(HERE,'summary.json'));
 assert.equal(rows.length,617);assert.equal(new Set(rows.map(x=>x.task_id)).size,617);
 assert.equal(summary.counts.parser_reusable,617);assert.equal(summary.counts.planner_changed,617);
 assert.ok(rows.every(x=>x.stages.parser.reusable&&!x.stages.planner.reusable&&x.action==='new_planner'));
 assert.equal(summary.counts.embedding_after_valid_planner,613);
 assert.equal(summary.counts.embedding_skipped_empty_preferences_and_history,4);
 assert.equal(summary.model_requests_sent,0);assert.equal(summary.embedding_model_loads,0);
});

test('candidate text change replays exact parser and sends only planner',async()=>{
 const row=rows.find(x=>x.task_id==='kuairand:2:test:random'),input=await nativeInput(checked(row.current_input));
 let modelCalls=0,embeddings=0;const saved={};
 const result=await episode(row,{input,save:(name,value)=>saved[name]=value,
  model:async request=>{modelCalls++;assert.equal(hash(request),row.stages.planner.current_request_sha256);return receipt({allowed_ids:input.candidates.map(x=>x.id),tools:['matcher','aggregator']});},
  embedding:async payload=>{embeddings++;return zeros(payload);}});
 assert.equal(result.status,'submitted');assert.equal(modelCalls,1);assert.equal(embeddings,1);assert.equal(result.reused_model_request_count,1);
 assert.deepEqual(saved['01-parser.request.json'],checked(row.stages.parser.request));
 assert.deepEqual(saved['01-parser.response.json'],checked(row.stages.parser.response));
});

test('history-only change reuses both requests and recomputes local embedding',async()=>{
 const row=structuredClone(rows.find(x=>x.task_id==='kuairand:2:test:random'));
 const input=checked(row.old_native_input);input.instruction='';
 const positive=input.history.find(x=>x.long_view===1);positive.text+='\nnew complete public text';
 const effective=await capture(input,prefs(row));
 row.stages.planner.reusable=true;row.stages.planner.current_request_sha256=row.stages.planner.old_request_sha256;
 row.embedding.current_payload_sha256=hash(effective.embedding);
 assert.equal(hash(requestFor(checked(row.stages.planner.request),effective.requests.planner)),row.stages.planner.old_request_sha256);
 let embeddings=0;
 const result=await episode(row,{input,save:()=>{},model:async()=>{throw Error('network must not be called');},embedding:async payload=>{embeddings++;return zeros(payload);}});
 assert.equal(result.status,'submitted');assert.equal(result.model_request_count,0);assert.equal(result.reused_model_request_count,2);assert.equal(embeddings,1);
});

test('empty positive history skips embedding even with changed candidate text',async()=>{
 const row=rows.find(x=>!x.embedding.current_would_run_after_valid_planner),input=await nativeInput(checked(row.current_input));
 let calls=0;
 const result=await episode(row,{input,save:()=>{},model:async()=>{calls++;return receipt({allowed_ids:input.candidates.map(x=>x.id),tools:['aggregator']});},embedding:async()=>{throw Error('embedding must not run');}});
 assert.equal(result.status,'submitted');assert.equal(calls,1);
});

test('unchanged original 701 planner failure remains a zero, with no resampling or embedding',async()=>{
 const row=structuredClone(rows.find(x=>x.task_id==='kuairand:701:test:random'));
 const input=checked(row.old_native_input);input.instruction='';
 row.stages.planner.reusable=true;row.stages.planner.current_request_sha256=row.stages.planner.old_request_sha256;
 const result=await episode(row,{input,save:()=>{},model:async()=>{throw Error('network must not be called');},embedding:async()=>{throw Error('embedding must not run');}});
 assert.equal(result.status,'failed');assert.equal(result.error,'filter without hard constraints');assert.equal(result.requests,0);assert.equal(result.reused_model_request_count,2);
});

test('new invalid planner response is terminal and cannot trigger a success redraw',async()=>{
 const row=rows.find(x=>x.task_id==='kuairand:701:test:random'),input=await nativeInput(checked(row.current_input));
 let calls=0;
 const result=await episode(row,{input,save:()=>{},model:async()=>{calls++;return receipt({allowed_ids:input.candidates.slice(0,100).map(x=>x.id),tools:['aggregator']});},embedding:async()=>{throw Error('embedding must not run');}});
 assert.equal(result.status,'failed');assert.equal(result.error,'filter without hard constraints');assert.equal(calls,1);
});

test('changed reviewed planner payload is rejected before a model call',async()=>{
 const row=rows[0],input=await nativeInput(checked(row.current_input));input.candidates[0].text+='unreviewed mutation';
 let calls=0;
 const result=await episode(row,{input,save:()=>{},model:async()=>{calls++;throw Error('must not be called');},embedding:async()=>{throw Error('must not be called');}});
 assert.equal(result.status,'failed');assert.match(result.error,/request differs from reviewed plan/);assert.equal(calls,0);
});
