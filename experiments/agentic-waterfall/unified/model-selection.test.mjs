import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadModelConfig} from '../shared/model-client.mjs';

test('GLM override enables low thinking without changing the original recommendation config',()=>{
 const names=['MODEL_CONFIG_FILE','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]])),dir=mkdtempSync(join(tmpdir(),'waterfall-model-'));
 try{
  for(const k of names)delete process.env[k];
  const path=join(dir,'config.json');writeFileSync(path,JSON.stringify({apiKey:'synthetic',apiBase:'https://model.invalid/v1',modelName:'GLM-5.3',recommendationModelName:'DeepSeek-V4.1-Flash'}));process.env.MODEL_CONFIG_FILE=path;
  process.env.OPENAI_MODEL='GLM-5.3-Flash';const glm=loadModelConfig();
  assert.equal(glm.model,'GLM-5.3-Flash');assert.deepEqual(glm.parameters,{thinking:{type:'enabled'},reasoning_effort:'low'});
  assert.equal(glm.endpoint,'https://model.invalid/v1/chat/completions');
  delete process.env.OPENAI_MODEL;const original=loadModelConfig();assert.equal(original.model,'DeepSeek-V4.1-Flash');assert.equal(original.parameters.thinking.type,'disabled');
 }finally{for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}rmSync(dir,{recursive:true,force:true});}
});
test('GLM reasoning budget reaches transport while original model limits remain enforced',async()=>{
 const names=['MODEL_CONFIG_FILE','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL','WATERFALL_MODEL_TIMEOUT_MS'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]])),dir=mkdtempSync(join(tmpdir(),'waterfall-transport-')),fetch=globalThis.fetch,requests=[];
 try{
  for(const k of names)delete process.env[k];
  mkdirSync(join(dir,'shared'));mkdirSync(join(dir,'mind'));
  writeFileSync(join(dir,'shared/model-client.mjs'),readFileSync(new URL('../shared/model-client.mjs',import.meta.url)));
  writeFileSync(join(dir,'shared/model-ledger.json'),JSON.stringify({limit:2,attempts:[]}));
  writeFileSync(join(dir,'mind/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:2}));
  process.env.MODEL_CONFIG_FILE=join(dir,'config.json');
  writeFileSync(process.env.MODEL_CONFIG_FILE,JSON.stringify({apiKey:'synthetic',apiBase:'https://model.invalid/v1',recommendationModelName:'DeepSeek-V4.1-Flash'}));
  globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return {ok:true,json:async()=>({model:body.model,choices:[{message:{content:'OK'},finish_reason:'stop'}]})};};
  const {callModel}=await import(pathToFileURL(join(dir,'shared/model-client.mjs')).href);
  const request={messages:[{role:'user',content:'synthetic'}]},options={experiment:'mind'};
  process.env.OPENAI_MODEL='GLM-5.3-Flash';process.env.WATERFALL_MODEL_TIMEOUT_MS='600000';
  const receipt=await callModel({...request,max_tokens:32768},options);assert.equal(receipt.request_settings.max_tokens,32768);assert.equal(requests[0].reasoning_effort,'low');
  await assert.rejects(callModel({...request,max_tokens:32769},options),/invalid_max_tokens/);
  delete process.env.OPENAI_MODEL;delete process.env.WATERFALL_MODEL_TIMEOUT_MS;
  await assert.rejects(callModel({...request,max_tokens:8193},options),/invalid_max_tokens/);
  await callModel({...request,max_tokens:8192},options);assert.equal(requests[1].thinking.type,'disabled');
  assert.equal(requests.length,2);assert.equal(JSON.parse(readFileSync(join(dir,'shared/model-ledger.json'),'utf8')).attempts.length,2);
 }finally{globalThis.fetch=fetch;for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}rmSync(dir,{recursive:true,force:true});}
});
