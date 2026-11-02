import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

for(const variant of ['json','sqlite'])test(`${variant}: one deadline covers all retries and closes every unsent reservation`,async t=>{
 const root=mkdtempSync(join(tmpdir(),'waterfall-call-deadline-'));
 const names=['MODEL_CONFIG_FILE','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL','WATERFALL_MODEL_TIMEOUT_MS'];
 const prior=Object.fromEntries(names.map(n=>[n,process.env[n]])),fetch=globalThis.fetch,now=Date.now;
 t.after(()=>{globalThis.fetch=fetch;Date.now=now;delete globalThis.deadlineClock;for(const n of names)if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];rmSync(root,{recursive:true,force:true});});
 mkdirSync(join(root,'shared'));mkdirSync(join(root,'method-deployment'));
 const source=variant==='json'?new URL('./model-client.mjs',import.meta.url):new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/model-client.mjs',import.meta.url);
 writeFileSync(join(root,'shared/model-client.mjs'),readFileSync(source,'utf8').replace("resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')","resolve(ROOT, 'shared/model-ledger.json')"));
 copyFileSync(new URL('./model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
 if(variant==='sqlite')copyFileSync(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/archive.mjs',import.meta.url),join(root,'shared/archive.mjs'));
 writeFileSync(join(root,'shared/request-gate.mjs'),`export const createRequestGate=()=>({admit:async({deadline=Infinity}={})=>{if(Date.now()+80000>deadline)throw Error('request_gate_call_deadline_exceeded');globalThis.deadlineClock+=80000;return Date.now();},cooldown:async()=>{}});`);
 writeFileSync(join(root,'shared/model-ledger.json'),JSON.stringify({limit:50,attempts:[]}));
 writeFileSync(join(root,'method-deployment/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:50}));
 writeFileSync(join(root,'config.json'),JSON.stringify({apiKey:'synthetic',apiBase:'https://example.invalid',modelName:'frozen-model'}));
 for(const n of names)delete process.env[n];process.env.MODEL_CONFIG_FILE=join(root,'config.json');
 globalThis.deadlineClock=1000000;Date.now=()=>globalThis.deadlineClock;
 const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
 const bodies=[];globalThis.fetch=async(_,options)=>{bodies.push(options.body);globalThis.deadlineClock+=5000;return new Response(JSON.stringify({error:{type:'throttling_error',message:'Rate limit'}}),{status:429});};
 await assert.rejects(callModel({messages:[{role:'user',content:'unchanged'}]},{experiment:'method-deployment'}),e=>{
  assert.equal(e.message,'request_gate_call_deadline_exceeded');
  assert.equal(e.receipt.service_retry_exhausted,true);
  assert.equal(e.receipt.http_request_started_at,null);
  assert.equal(e.receipt.service_attempts.length,2);
  return true;
 });
 assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
 assert(Date.now()-1000000<270000);
 const ledger=JSON.parse(readFileSync(join(root,'shared/model-ledger.json'),'utf8'));
 assert(!ledger.attempts.some(x=>x.status==='in_progress'));
 let records=ledger.attempts;
 if(variant==='sqlite'){const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(root,'shared/expansion-ledger.sqlite'));records=db.prepare('SELECT record FROM attempts').all().map(x=>JSON.parse(x.record));db.close();}
 assert.equal(records.length,3);
 assert.equal(records.at(-1).http_request_started_at,null);
 assert.equal(records.at(-1).error,'request_gate_call_deadline_exceeded');
});

for(const variant of ['json'])test(`${variant}: the 180-second response mode still permits two provider cooldowns`,async t=>{
 const root=mkdtempSync(join(tmpdir(),'waterfall-cooldown-deadline-'));
 const names=['MODEL_CONFIG_FILE','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL','WATERFALL_MODEL_TIMEOUT_MS'];
 const prior=Object.fromEntries(names.map(n=>[n,process.env[n]])),fetch=globalThis.fetch,now=Date.now;
 let time=1000000;t.after(()=>{globalThis.fetch=fetch;Date.now=now;delete globalThis.cooldownClock;for(const n of names)if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];rmSync(root,{recursive:true,force:true});});
 mkdirSync(join(root,'shared'));mkdirSync(join(root,'method-deployment'));
 const source=variant==='json'?new URL('./model-client.mjs',import.meta.url):new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/model-client.mjs',import.meta.url);
 writeFileSync(join(root,'shared/model-client.mjs'),readFileSync(source,'utf8').replace("resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')","resolve(ROOT, 'shared/model-ledger.json')"));
 copyFileSync(new URL('./model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
 if(variant==='sqlite')copyFileSync(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/archive.mjs',import.meta.url),join(root,'shared/archive.mjs'));
 writeFileSync(join(root,'shared/request-gate.mjs'),`let retry=false;export const createRequestGate=()=>({admit:async({deadline=Infinity}={})=>{const wait=retry?60000:0;if(Date.now()+wait>deadline)throw Error('request_gate_call_deadline_exceeded');globalThis.cooldownClock(wait);retry=false;return Date.now();},cooldown:async()=>{retry=true;}});`);
 writeFileSync(join(root,'shared/model-ledger.json'),JSON.stringify({limit:10,attempts:[]}));
 writeFileSync(join(root,'method-deployment/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:10}));
 writeFileSync(join(root,'config.json'),JSON.stringify({apiKey:'synthetic',apiBase:'https://example.invalid',modelName:'frozen-model'}));
 for(const n of names)delete process.env[n];process.env.MODEL_CONFIG_FILE=join(root,'config.json');process.env.WATERFALL_MODEL_TIMEOUT_MS='180000';
 globalThis.cooldownClock=ms=>time+=ms;Date.now=()=>time;const bodies=[];
 globalThis.fetch=async(_,options)=>{bodies.push(options.body);time+=5000;return bodies.length<3?new Response(JSON.stringify({error:{type:'throttling_error',message:'Rate limit'}}),{status:429}):new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}),{status:200});};
 const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
 const result=await callModel({messages:[{role:'user',content:'unchanged'}]},{experiment:'method-deployment'});
 assert.equal(result.status,'success');assert.equal(result.service_attempts.length,2);assert.equal(new Set(bodies).size,1);assert.equal(bodies.length,3);assert.equal(time-1000000,135000);
 assert(JSON.parse(readFileSync(join(root,'shared/model-ledger.json'),'utf8')).attempts.every(a=>a.status!=='in_progress'));
});
