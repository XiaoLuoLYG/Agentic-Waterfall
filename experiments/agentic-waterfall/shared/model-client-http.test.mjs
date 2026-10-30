import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('HTTP refusals retain redacted diagnostics and distinguish quota from transient 429', async t => {
  const root=await mkdtemp(join(tmpdir(),'waterfall-http-'));
  const names=['MODEL_CONFIG_FILE','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL'];
  const prior=Object.fromEntries(names.map(name=>[name,process.env[name]])),originalFetch=globalThis.fetch;
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(join(root,'shared'));await mkdir(join(root,'kuairec'));
  await copyFile(new URL('./model-client.mjs',import.meta.url),join(root,'shared/model-client.mjs'));
  const config=join(root,'config.json'),key='test-secret-api-key';
  await writeFile(config,JSON.stringify({apiKey:key,apiBase:'https://example.invalid',modelName:'test-model'}));
  process.env.MODEL_CONFIG_FILE=config;
  for(const name of names.slice(1))delete process.env[name];
  await writeFile(join(root,'shared/model-ledger.json'),JSON.stringify({limit:10,attempts:[]}));
  await writeFile(join(root,'kuairec/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:10}));
  const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
  for(const code of ['rate_limit_exceeded','insufficient_quota']){
    globalThis.fetch=async()=>new Response(JSON.stringify({error:{code,type:'requests',message:`${code} ${key}`}}),{
      status:429,headers:{'content-type':'application/json','retry-after':'30','x-request-id':'synthetic-request'}});
    await assert.rejects(callModel({messages:[{role:'user',content:'test'}],max_tokens:1},{experiment:'kuairec'}),error=>{
      assert.equal(error.message,'model_http_429');
      assert.equal(error.receipt.requested_model,'test-model');
      assert.equal(error.receipt.http_error.status,429);
      assert.equal(error.receipt.http_error.code,code);
      assert.equal(error.receipt.http_error.retryable,code==='rate_limit_exceeded');
      assert.equal(error.receipt.http_error.retry_after_seconds,30);
      assert.equal(JSON.stringify(error.receipt).includes(key),false);
      return true;
    });
  }
  const ledger=JSON.parse(await readFile(join(root,'shared/model-ledger.json'),'utf8'));
  assert.equal(ledger.attempts.length,2);
  assert.equal(ledger.attempts[1].http_error.code,'insufficient_quota');
  assert.equal(JSON.stringify(ledger).includes(key),false);
});
