import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

for(const variant of ['json','sqlite']) test(`${variant}: HTTP refusals distinguish quota and budget exhaustion from transient 429`, async t => {
  const root=await mkdtemp(join(tmpdir(),'waterfall-http-'));
  const names=['MODEL_CONFIG_FILE','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','WATERFALL_REQUEST_GATE_DIR'];
  const prior=Object.fromEntries(names.map(name=>[name,process.env[name]])),originalFetch=globalThis.fetch;
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(join(root,'shared'));await mkdir(join(root,'kuairec'));
  const source=variant==='json'?new URL('./model-client.mjs',import.meta.url):new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/model-client.mjs',import.meta.url);
  await writeFile(join(root,'shared/model-client.mjs'),(await readFile(source,'utf8')).replace("resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')","resolve(ROOT, 'shared/model-ledger.json')"));
 await copyFile(new URL('./model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
  if(variant==='sqlite')await copyFile(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/archive.mjs',import.meta.url),join(root,'shared/archive.mjs'));
  await copyFile(new URL('./request-gate.mjs',import.meta.url),join(root,'shared/request-gate.mjs'));
  const config=join(root,'config.json');
  process.env.MODEL_CONFIG_FILE=config;
  for(const name of names.slice(1))delete process.env[name];
  process.env.WATERFALL_REQUEST_GATE_DIR=join(root,'gates');
  await writeFile(join(root,'shared/model-ledger.json'),JSON.stringify({limit:10,attempts:[]}));
  await writeFile(join(root,'kuairec/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:10}));
  const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
  for(const code of ['rate_limit_exceeded','insufficient_quota','budget_exceeded','budget_message_only']){
    const key='test-secret-api-key-'+code;
    await writeFile(config,JSON.stringify({apiKey:key,apiBase:'https://example.invalid',modelName:'test-model'}));
    const before=Date.now(),retry=code==='rate_limit_exceeded'?'30':new Date(before+90000).toUTCString();
    const body=code==='budget_message_only'?{message:`Budget has been exceeded! Key=${key} Current cost: 50.0, Max budget: 50.0`}:{code:code==='budget_exceeded'?'429':code,type:code==='budget_exceeded'?code:'requests',message:`${code} ${key} api_key: opaque_identifier`};
    globalThis.fetch=async()=>new Response(JSON.stringify({error:body}),{
      status:429,headers:{'content-type':'application/json','retry-after':retry,'x-request-id':'synthetic-request'}});
    await assert.rejects(callModel({messages:[{role:'user',content:'test'}],max_tokens:1},{experiment:'kuairec'}),error=>{
      assert.equal(error.message,'model_http_429');
      assert.equal(error.receipt.requested_model,'test-model');
      assert.equal(error.receipt.http_error.status,429);
      assert.equal(error.receipt.http_error.code,body.code??null);
      assert.equal(error.receipt.http_error.retryable,code==='rate_limit_exceeded');
      if(code==='rate_limit_exceeded')assert.equal(error.receipt.http_error.retry_after_seconds,30);
      else assert(error.receipt.http_error.retry_after_seconds>=89&&error.receipt.http_error.retry_after_seconds<=90);
      assert.equal(JSON.stringify(error.receipt).includes(key),false);
      assert.equal(JSON.stringify(error.receipt).includes('opaque_identifier'),false);
      return true;
    });
    const states=await Promise.all((await readdir(join(root,'gates'))).filter(x=>x.endsWith('.json')).map(async x=>JSON.parse(await readFile(join(root,'gates',x),'utf8'))));
    assert.equal(states.filter(x=>x.cooldown_until>0).length,1);
  }
  let ledger=JSON.parse(await readFile(join(root,'shared/model-ledger.json'),'utf8'));
  if(variant==='sqlite'){const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(root,'shared/expansion-ledger.sqlite'));ledger.attempts=db.prepare('SELECT record FROM attempts ORDER BY rowid').all().map(row=>JSON.parse(row.record));db.close();}
  assert.equal(ledger.attempts.length,4);
  assert.equal(ledger.attempts[1].http_error.code,'insufficient_quota');
  assert.equal(JSON.stringify(ledger).includes('test-secret-api-key-'),false);
  assert.equal(JSON.stringify(ledger).includes('opaque_identifier'),false);
});
