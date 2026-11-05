import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const original=new URL('../kuairand-window512-20261103/cases/waterfall/kuairand-244-test-random/attempt/result.json',import.meta.url);
const source=JSON.parse(readFileSync(original)).result;
const ledger=JSON.parse(readFileSync(new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-ledger.json',import.meta.url)));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const request=call=>({messages:structuredClone(call.messages),temperature:call.request_settings.temperature,max_tokens:call.request_settings.max_tokens,response_format:{type:'json_object'},stream:call.request_settings.stream===true});
const body=r=>({model:'DeepSeek-V4.1-Flash-1017',messages:r.messages,temperature:r.temperature,max_tokens:r.max_tokens,enable_thinking:false,thinking:{type:'disabled'},extra_body:{thinking:{type:'disabled'}},response_format:r.response_format,...(r.stream?{stream:true,stream_options:{include_usage:true}}:{})});
test('a replayed receipt records the exact ledger-matching request, including aligned tool clocks',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'waterfall-receipt-'));
 try{
  process.env.WATERFALL_QUOTA_NATIVE=original.pathname;
  process.env.WATERFALL_LEDGER_REPLAY='1';
  process.env.WATERFALL_QUOTA_REPLAY_OFFLINE='1';
  process.env.WATERFALL_QUOTA_REPLAY_LOG=join(folder,'replay.jsonl');
  const {callModel}=await import('./quota-replay-client.mjs?receipt-regression');
  assert.equal(digest(body(request(source.model_calls[0]))),ledger.attempts.find(x=>x.id===source.model_calls[0].attempt_id).request_sha256);
  await callModel(request(source.model_calls[0]),{thinkingMode:'disabled'});
  const second=source.model_calls[1],input=request(second);
  const expected=ledger.attempts.find(x=>x.id===second.attempt_id).request_sha256;
  assert.equal(digest(body(input)),expected,'Captured source must match the real ledger');
  const payload=JSON.parse(input.messages[1].content);
  for(const result of payload.observation.environment.tool_results){
   for(const key of ['started_at','completed_at'])if(Object.hasOwn(result,key))result[key]='2099-01-01T00:00:00.000Z';
  }
  input.messages[1].content=JSON.stringify(payload);
  const response=await callModel(input,{thinkingMode:'disabled'});
  const recorded={messages:input.messages,...response};
  assert.equal(digest(body({...input,messages:recorded.messages})),expected,'Native recording must describe the request that actually produced the cached reply');
  assert.equal(response.attempt_id,second.attempt_id);
  assert.equal(response.content,second.content);
  assert.equal(JSON.parse(input.messages[1].content).observation.environment.tool_results[0].started_at,'2099-01-01T00:00:00.000Z','Caller snapshot must not be mutated');
 }finally{rmSync(folder,{recursive:true,force:true});}
});
