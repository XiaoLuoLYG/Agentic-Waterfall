import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
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
