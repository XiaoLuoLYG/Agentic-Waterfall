import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('approved ledger limits, failed-call accounting and experiment quotas', async t => {
  const root=await mkdtemp(join(tmpdir(),'waterfall-budget-test-'));
  const keys=['MODEL_CONFIG_FILE','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','WATERFALL_REQUEST_GATE_DIR'];
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const originalFetch=globalThis.fetch;
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    for(const k of keys)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(join(root,'shared'));await mkdir(join(root,'mind'));
  await copyFile(new URL('./model-client.mjs',import.meta.url),join(root,'shared/model-client.mjs'));
  await copyFile(new URL('./request-gate.mjs',import.meta.url),join(root,'shared/request-gate.mjs'));
  await copyFile(new URL('./model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
  const config=join(root,'fake-config.json');
  await writeFile(config,JSON.stringify({apiKey:'test-only',apiBase:'https://example.invalid',modelName:'test-only'}));
  process.env.MODEL_CONFIG_FILE=config;
  process.env.WATERFALL_REQUEST_GATE_DIR=join(root,'request-gates');
  process.env.OPENAI_API_KEY='test-only';process.env.OPENAI_BASE_URL='https://example.invalid';process.env.OPENAI_MODEL='test-only';
  const ledgerPath=join(root,'shared/model-ledger.json'),controlPath=join(root,'mind/CONTROL.json');
  const save=(path,data)=>writeFile(path,JSON.stringify(data));
  const readLedger=async()=>JSON.parse(await readFile(ledgerPath,'utf8'));
  const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
  const request={messages:[{role:'user',content:'synthetic budget test'}],max_tokens:1};
  let requests=0,fail=false;
  globalThis.fetch=async()=>{
    requests++;
    return {ok:!fail,status:fail?429:200,json:async()=>({model:'test-only',choices:[{message:{content:'ok'}}],usage:{total_tokens:1}})};
  };
  await save(controlPath,{model_calls_enabled:true,model_request_limit:2});
  await save(ledgerPath,{limit:122,attempts:Array.from({length:120},()=>({experiment:'other',status:'success'}))});
  assert.equal((await callModel(request,{experiment:'mind'})).status,'success');
  fail=true;
  await assert.rejects(callModel(request,{experiment:'mind'}),/model_http_429/);
  assert.equal((await readLedger()).attempts.length,122);
  assert.equal((await readLedger()).attempts.at(-1).status,'failed');
  await assert.rejects(callModel(request,{experiment:'mind'}),/global_request_budget_exhausted/);
  assert.equal(requests,2);

  await save(ledgerPath,{limit:1000,attempts:[{experiment:'mind',status:'success'}]});
  await save(controlPath,{model_calls_enabled:true,model_request_limit:1});
  await assert.rejects(callModel(request,{experiment:'mind'}),/experiment_request_budget_exhausted/);
  await save(ledgerPath,{limit:null,attempts:[]});
  await assert.rejects(callModel(request,{experiment:'mind'}),/invalid_global_request_limit/);
  assert.equal(requests,2);
});
