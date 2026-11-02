import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('thinking mode is explicit per call and receipts preserve reasoning evidence',async t=>{
 const root=await mkdtemp(join(tmpdir(),'waterfall-thinking-')),keys=['MODEL_CONFIG_FILE','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','WATERFALL_REQUEST_GATE_DIR'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]])),fetchBefore=globalThis.fetch;
 t.after(async()=>{globalThis.fetch=fetchBefore;for(const k of keys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];await rm(root,{recursive:true,force:true});});
 await mkdir(join(root,'shared'));await mkdir(join(root,'kuairec'));
 for(const name of ['model-client.mjs','request-gate.mjs','model-response.mjs'])await copyFile(new URL(name,import.meta.url),join(root,'shared',name));
 await writeFile(join(root,'config.json'),JSON.stringify({apiKey:'test',apiBase:'https://example.invalid',recommendationModelName:'test'}));
 await writeFile(join(root,'shared/model-ledger.json'),JSON.stringify({limit:3,attempts:[]}));await writeFile(join(root,'kuairec/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:3}));
 process.env.MODEL_CONFIG_FILE=join(root,'config.json');process.env.WATERFALL_REQUEST_GATE_DIR=join(root,'gates');for(const k of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'])delete process.env[k];
 const bodies=[];globalThis.fetch=async(_,request)=>{const body=JSON.parse(request.body);bodies.push(body);return {ok:true,status:200,json:async()=>({model:'test',choices:[{message:{content:'{}',reasoning_content:body.enable_thinking?'synthetic reasoning':''},finish_reason:'stop'}],usage:{completion_tokens_details:{reasoning_tokens:body.enable_thinking?4:0}}})};};
 const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs'))),request={messages:[{role:'user',content:'synthetic'}],max_tokens:32768,stream:true};
 const enabled=await callModel(request,{experiment:'kuairec',thinkingMode:'enabled'});await callModel(request,{experiment:'kuairec',thinkingMode:'disabled'});await callModel(request,{experiment:'kuairec'});
 assert.equal(bodies[0].max_tokens,32768);assert.equal(bodies[0].stream,true);assert.equal(bodies[0].stream_options.include_usage,true);assert.deepEqual(bodies.map(b=>b.thinking.type),['enabled','disabled','disabled']);assert.equal(enabled.reasoning_content,'synthetic reasoning');assert.equal(enabled.usage.completion_tokens_details.reasoning_tokens,4);assert.equal(enabled.request_settings.enable_thinking,true);
 await assert.rejects(callModel(request,{experiment:'kuairec',thinkingMode:'mystery'}),/invalid_thinking_mode/);assert.equal(bodies.length,3);
});
