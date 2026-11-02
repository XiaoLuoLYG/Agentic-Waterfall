import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

for(const variant of ['json','sqlite'])test(`${variant}: retry the identical throttled HTTP stage, never resample a model answer`,async t=>{
 const root=mkdtempSync(join(tmpdir(),'waterfall-stage-retry-'));
 const names=['MODEL_CONFIG_FILE','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL'];
 const prior=Object.fromEntries(names.map(n=>[n,process.env[n]])),fetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=fetch;delete globalThis.stageRetryCooldowns;for(const n of names)if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];rmSync(root,{recursive:true,force:true});});
 mkdirSync(join(root,'shared'));mkdirSync(join(root,'method-deployment'));
 const source=variant==='json'?new URL('./model-client.mjs',import.meta.url):new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/model-client.mjs',import.meta.url);
 writeFileSync(join(root,'shared/model-client.mjs'),readFileSync(source,'utf8').replace("resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')","resolve(ROOT, 'shared/model-ledger.json')"));
 copyFileSync(new URL('./model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
 if(variant==='sqlite')copyFileSync(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/archive.mjs',import.meta.url),join(root,'shared/archive.mjs'));
 // Shared gate timing/locking has its own real-process tests; this seam never sleeps or uses a real endpoint.
 writeFileSync(join(root,'shared/request-gate.mjs'),'export const createRequestGate=()=>({admit:async()=>Date.now(),cooldown:async seconds=>globalThis.stageRetryCooldowns.push(seconds)});');
 writeFileSync(join(root,'shared/model-ledger.json'),JSON.stringify({limit:50,attempts:[]}));
 writeFileSync(join(root,'method-deployment/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:50}));
 writeFileSync(join(root,'config.json'),JSON.stringify({apiKey:'synthetic',apiBase:'https://example.invalid',modelName:'frozen-model'}));
 for(const n of names)delete process.env[n];process.env.MODEL_CONFIG_FILE=join(root,'config.json');globalThis.stageRetryCooldowns=[];
 const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
 const request={messages:[{role:'user',content:'unchanged previous decisions and correction feedback'}],max_tokens:4096};
 const throttle=()=>new Response(JSON.stringify({error:{code:'429',type:'throttling_error',message:'Limit type: max_parallel_requests. Current limit: 10, Remaining: 0.'}}),{status:429,headers:{'retry-after':'60'}});
 const success=content=>new Response(JSON.stringify({model:'frozen-model',choices:[{message:{content},finish_reason:'stop'}]}),{status:200,headers:{'x-ratelimit-limit-requests':'120','x-api-key':'synthetic'}});
 const bodies=[];globalThis.fetch=async(_,options)=>{bodies.push(options.body);process.env.OPENAI_MODEL='changed-while-waiting';return bodies.length===1?throttle():success('{"bad_method_output":true}');};
 const result=await callModel(request,{experiment:'method-deployment'});
 assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(result.requested_model,'frozen-model');
 assert.deepEqual(result.rate_limit_headers,{'x-ratelimit-limit-requests':'120'});
 assert.equal(result.content,'{"bad_method_output":true}');assert.equal(result.service_attempts.length,1);assert.equal(result.service_attempts[0].error,'model_http_429');
 assert.notEqual(result.attempt_id,result.service_attempts[0].attempt_id);assert.deepEqual(globalThis.stageRetryCooldowns,[60]);
 let sent=0;globalThis.fetch=async()=>{sent++;return throttle();};
 await assert.rejects(callModel(request,{experiment:'method-deployment'}),error=>{assert.equal(error.message,'model_http_429');assert.equal(error.receipt.service_retry_exhausted,true);assert.equal(error.receipt.service_attempts.length,2);return true;});
 assert.equal(sent,3);
 sent=0;globalThis.fetch=async()=>{sent++;return new Response(JSON.stringify({error:{type:'budget_exceeded',message:'Budget has been exceeded!'}}),{status:429});};
 await assert.rejects(callModel(request,{experiment:'method-deployment'}),e=>{assert.equal(e.receipt.http_error.retryable,false);return true;});assert.equal(sent,1);
 let records=JSON.parse(readFileSync(join(root,'shared/model-ledger.json'),'utf8')).attempts;
 if(variant==='sqlite'){const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(root,'shared/expansion-ledger.sqlite'));records=db.prepare('SELECT record FROM attempts').all().map(x=>JSON.parse(x.record));db.close();}
 assert.deepEqual(records.find(x=>x.status==='success').rate_limit_headers,{'x-ratelimit-limit-requests':'120'});
 assert.equal(records.length,6);assert.equal(records.filter(x=>x.status==='success').length,1);assert.equal(new Set(records.map(x=>x.id)).size,6);
});
