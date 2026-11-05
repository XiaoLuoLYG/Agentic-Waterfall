import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
const original=new URL('../kuairand-window512-20261103/cases/waterfall/kuairand-201-test-random/attempt/result.json',import.meta.url);
const source=JSON.parse(readFileSync(original)).result;
const ledger=JSON.parse(readFileSync(new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-ledger.json',import.meta.url)));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const packet=c=>({messages:structuredClone(c.messages),temperature:c.request_settings.temperature,max_tokens:c.request_settings.max_tokens,response_format:{type:'json_object'},stream:c.request_settings.stream===true});
const body=r=>({model:'DeepSeek-V4.1-Flash-1017',messages:r.messages,temperature:r.temperature,max_tokens:r.max_tokens,enable_thinking:false,thinking:{type:'disabled'},extra_body:{thinking:{type:'disabled'}},response_format:r.response_format,...(r.stream?{stream:true,stream_options:{include_usage:true}}:{})});
test('a retried unanswered request records the aligned sent packet on success and error',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'waterfall-unanswered-'));
 try{
  const backend=join(folder,'backend.mjs');
  writeFileSync(backend,`export async function callModel(){if(process.env.REPLAY_FIXTURE_ERROR==='1'){const e=Error('fixture_failure');e.receipt={status:'failed',error:'fixture_failure'};throw e;}return {status:'success',content:'fixture_response'};}`);
  const client=new URL('../kuairand-window512-20261103/client.mjs',import.meta.url).href;
  registerHooks({resolve(specifier,context,nextResolve){const r=nextResolve(specifier,context);return r.url===client?{url:pathToFileURL(backend).href,shortCircuit:true}:r;}});
  for(const failure of [false,true]){
   process.env.WATERFALL_QUOTA_NATIVE=original.pathname;process.env.WATERFALL_LEDGER_REPLAY='1';delete process.env.WATERFALL_QUOTA_REPLAY_OFFLINE;process.env.REPLAY_FIXTURE_ERROR=failure?'1':'0';process.env.WATERFALL_QUOTA_REPLAY_LOG=join(folder,'trace-'+failure+'.jsonl');
   const {callModel}=await import('./quota-replay-client.mjs?unanswered='+failure);
   const last=source.model_calls.findIndex(c=>c.status!=='success');assert(last>0);
   for(const call of source.model_calls.slice(0,last))await callModel(packet(call),{thinkingMode:'disabled'});
   const saved=source.model_calls[last],request=packet(saved),expected=ledger.attempts.find(x=>x.id===saved.attempt_id).request_sha256;
   assert.equal(hash(body(request)),expected);
   const payload=JSON.parse(request.messages[1].content);for(const r of payload.observation.environment.tool_results)for(const k of ['started_at','completed_at'])if(Object.hasOwn(r,k))r[k]='2099-01-01T00:00:00.000Z';request.messages[1].content=JSON.stringify(payload);
   let receipt;
   try{receipt=await callModel(request,{thinkingMode:'disabled'});assert(!failure);}catch(error){assert(failure);receipt=error.receipt;}
   const recorded={messages:request.messages,...receipt};assert.equal(hash(body({...request,messages:recorded.messages})),expected,'Both success and failure metadata must describe the packet actually sent after alignment');
   assert.equal(receipt.status,failure?'failed':'success');
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
