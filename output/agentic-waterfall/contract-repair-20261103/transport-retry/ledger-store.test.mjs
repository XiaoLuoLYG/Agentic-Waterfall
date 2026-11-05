import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {initializeLedger,openLedger} from './ledger-store.mjs';

async function holdWriter(file){
 const ready=file+'.writer-'+Math.random();
 const code=`import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';
  const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');writeFileSync(process.argv[2],'ready');
  await delay(1500);db.exec('COMMIT');db.close();`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,file+'.sqlite',ready],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',x=>stderr+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',n=>n===0?resolve():reject(Error(stderr)));});
 done.catch(()=>{});
 for(let i=0;i<1000&&!existsSync(ready);i++){assert.equal(child.exitCode,null,stderr);await delay(5);}
 assert(existsSync(ready),'fixture writer never acquired its transaction');
 return {done};
}

test('a full credential can be polled without competing for the SQLite write lock',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-full-')),file=join(root,'ledger.json');
 writeFileSync(file,JSON.stringify({limit:20,max_concurrent:1,attempts:[{id:'active',experiment:'demo',status:'in_progress'}]}));
 initializeLedger(file);const store=openLedger(file);let held;
 try{
  held=await holdWriter(file);
  const start=Date.now();
  assert.equal(await store.reserve({id:'queued',experiment:'demo',status:'in_progress'},{model_calls_enabled:true,model_request_limit:20},false,1),null);
  assert(Date.now()-start<500,'a read-only capacity check waited for a writer');
 }finally{await held?.done;store.close();rmSync(root,{recursive:true,force:true});}
});

for(const phase of ['reserve','http start','successful settlement'])test(`temporary SQLite contention cannot discard ${phase}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-busy-')),file=join(root,'ledger.json');
 const attempt={id:'current',experiment:'demo',status:'in_progress'};
 writeFileSync(file,JSON.stringify({limit:20,max_concurrent:2,attempts:phase==='reserve'?[]:[attempt]}));
 initializeLedger(file);const store=openLedger(file);let held;
 try{
  held=await holdWriter(file);
  let yielded=false;const tick=setTimeout(()=>{yielded=true;},25);
  const receipt={attempt_id:'current',status:'success',content:'the already received reply'};
  if(phase==='reserve')assert.equal((await store.reserve(attempt,{model_calls_enabled:true,model_request_limit:20},false,1)).id,'current');
  else await store.update('current',phase==='http start'?{http_request_started_at:'2026-11-05T00:00:00.000Z'}:{status:'success'},phase==='successful settlement'?receipt:undefined);
  clearTimeout(tick);assert(yielded,'contention blocked the caller instead of yielding');
  if(phase==='successful settlement')assert.deepEqual(store.receipt('current'),receipt);
  assert.equal(store.attempt('current').status,phase==='successful settlement'?'success':'in_progress');
 }finally{await held?.done;store.close();rmSync(root,{recursive:true,force:true});}
});

test('an exhausted settlement lock retains the successful reply without sending it again',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-pending-'));mkdirSync(join(root,'shared'));mkdirSync(join(root,'demo'));
 const file=join(root,'shared/model-ledger.json');
 writeFileSync(file,JSON.stringify({limit:20,max_concurrent:2,attempts:[]}));initializeLedger(file);
 for(const name of ['model-client.mjs','ledger-store.mjs'])copyFileSync(new URL('./'+name,import.meta.url),join(root,'shared',name));
 copyFileSync(new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
 writeFileSync(join(root,'shared/request-gate.mjs'),'export const createRequestGate=()=>({admit:async()=>Date.now(),cooldown:async()=>{}})');
 writeFileSync(join(root,'demo/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:20}));
 const config=join(root,'config.json');writeFileSync(config,JSON.stringify({modelName:'fixture',apiBase:'http://127.0.0.1/v1',apiKey:'fixture'}));
 const saved={fetch:globalThis.fetch,now:Date.now,config:process.env.MODEL_CONFIG_FILE,formal:process.env.WATERFALL_FORMAL_ROUTE};
 const store=openLedger(file);let calls=0,held;
 try{
  process.env.MODEL_CONFIG_FILE=config;delete process.env.WATERFALL_FORMAL_ROUTE;
  globalThis.fetch=async()=>{
   calls++;held=await holdWriter(file);const start=saved.now();
   Date.now=()=>saved.now()+(saved.now()-start)*1000;
   return Response.json({model:'fixture',choices:[{message:{content:'preserve this paid reply'}}]});
  };
  const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
  await assert.rejects(callModel({messages:[{role:'user',content:'settlement fixture'}]},{experiment:'demo'}),error=>{
   assert.equal(error.message,'ledger_settlement_pending');assert.equal(error.receipt.status,'success');
   assert.equal(error.receipt.content,'preserve this paid reply');assert.equal(error.receipt.ledger_settlement_pending,true);
   assert.equal(store.receipt(error.receipt.attempt_id),null);assert.equal(store.attempt(error.receipt.attempt_id).status,'in_progress');
   return true;
  });
  assert.equal(calls,1);
 }finally{
  Date.now=saved.now;globalThis.fetch=saved.fetch;
  for(const[k,v]of [['MODEL_CONFIG_FILE',saved.config],['WATERFALL_FORMAL_ROUTE',saved.formal]])v===undefined?delete process.env[k]:process.env[k]=v;
  await held?.done;store.close();rmSync(root,{recursive:true,force:true});
 }
});

test('incremental updates retain history order and durable replies before snapshot publication',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-records-')),file=join(root,'ledger.json');
 const old=[{id:'first',experiment:'demo',status:'in_progress',credential_slot:'primary'},
   {id:'second',experiment:'demo',status:'success',usage:{total_tokens:123}}];
 writeFileSync(file,JSON.stringify({limit:100,max_concurrent:10,attempts:old}));initializeLedger(file);
 const store=openLedger(file),reply={status:'success',content:'retained real response'};
 try{
  await store.update('first',{status:'success'},reply);
  assert.deepEqual(store.receipt('first'),reply);
  assert.deepEqual(JSON.parse(readFileSync(file)).attempts,old);
  await store.exportSnapshot();await store.published();
  const saved=JSON.parse(readFileSync(file));
  assert.deepEqual(saved.attempts.map(r=>r.id),['first','second']);
  assert.deepEqual(saved.attempts[1],old[1]);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('a stalled JSON publisher cannot discard or resend a successful HTTP reply',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-publisher-'));mkdirSync(join(root,'shared'));mkdirSync(join(root,'demo'));
 const file=join(root,'shared/model-ledger.json');
 writeFileSync(file,JSON.stringify({limit:20,max_concurrent:2,attempts:[]}));initializeLedger(file);
 for(const name of ['model-client.mjs','ledger-store.mjs'])copyFileSync(new URL('./'+name,import.meta.url),join(root,'shared',name));
 copyFileSync(new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
 writeFileSync(join(root,'shared/request-gate.mjs'),'export const createRequestGate=()=>({admit:async()=>Date.now(),cooldown:async()=>{}})');
 writeFileSync(join(root,'demo/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:20}));
 const config=join(root,'config.json');writeFileSync(config,JSON.stringify({modelName:'fixture',apiBase:'http://127.0.0.1/v1',apiKey:'fixture'}));
 const saved={fetch:globalThis.fetch,now:Date.now,config:process.env.MODEL_CONFIG_FILE,formal:process.env.WATERFALL_FORMAL_ROUTE};
 let calls=0;const store=openLedger(file);
 try{
  process.env.MODEL_CONFIG_FILE=config;delete process.env.WATERFALL_FORMAL_ROUTE;
  globalThis.fetch=async()=>{calls++;return Response.json({model:'fixture',choices:[{message:{content:'real retained reply'}}]});};
  const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
  const start=saved.now();Date.now=()=>saved.now()+(saved.now()-start)*1000;
  const receipt=await callModel({messages:[{role:'user',content:'publisher fixture'}]},{experiment:'demo'});
  assert.equal(receipt.status,'success');assert.equal(receipt.ledger_snapshot_pending,true);assert.equal(calls,1);
  assert.equal(store.receipt(receipt.attempt_id).content,'real retained reply');
 }finally{
  globalThis.fetch=saved.fetch;Date.now=saved.now;
  for(const[k,v]of [['MODEL_CONFIG_FILE',saved.config],['WATERFALL_FORMAL_ROUTE',saved.formal]])v===undefined?delete process.env[k]:process.env[k]=v;
  store.close();rmSync(root,{recursive:true,force:true});
 }
});

test('48 real client processes reach 16 per credential without rewriting history per request',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ledger-48-'));mkdirSync(join(root,'shared'));mkdirSync(join(root,'demo'));
 const file=join(root,'shared/model-ledger.json'),model='DeepSeek-V4.1-Flash-1017';
 const history=Array.from({length:43000},(_,i)=>({id:'history-'+i,experiment:'prior',status:'success',note:'preserved '.repeat(60)}));
 writeFileSync(file,JSON.stringify({limit:160000,max_concurrent:10,max_concurrent_per_credential:16,
   credential_policy:{max_concurrent:{primary:16,secondary:16,tertiary:16},rpm:{primary:50,secondary:50,tertiary:50}},attempts:history}));
 initializeLedger(file);const store=openLedger(file);
 for(const name of ['model-client.mjs','ledger-store.mjs'])copyFileSync(new URL('./'+name,import.meta.url),join(root,'shared',name));
 copyFileSync(new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-response.mjs',import.meta.url),join(root,'shared/model-response.mjs'));
 writeFileSync(join(root,'shared/request-gate.mjs'),'export const createRequestGate=()=>({admit:async()=>Date.now(),setRateLimit:async()=>{},cooldown:async()=>{}})');
 writeFileSync(join(root,'shared/dual-approved-routes.enabled'),'');
 writeFileSync(join(root,'demo/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:1000}));
 const config=join(root,'config.json'),apiBase='https://api.jiuwenappless.com/v1';
 writeFileSync(config,JSON.stringify({recommendationModelName:model,apiBase,apiKey:'one',extraEndpoints:[{model,apiBase,apiKey:'two'},{model,apiBase,apiKey:'three'}]}));
 const barrier=join(root,'release'),client=pathToFileURL(join(root,'shared/model-client.mjs')).href;
 const children=[],errors=[];let peak=0,publish,publishing=Promise.resolve();
 const started=Date.now();
 try{
  publish=setInterval(()=>{publishing=publishing.then(()=>store.exportSnapshot()).catch(error=>errors.push(error));},100);
  for(let i=0;i<48;i++)children.push(new Promise((resolve,reject)=>{
   const code=`import {existsSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';
    globalThis.fetch=async()=>{while(!existsSync(${JSON.stringify(barrier)}))await delay(10);return Response.json({model:${JSON.stringify(model)},choices:[{message:{content:'OK'}}]});};
    const {callModel}=await import(${JSON.stringify(client)});const r=await callModel({messages:[{role:'user',content:'fixture-'+process.pid}]},{experiment:'demo'});if(r.status!=='success')throw Error('invalid fixture receipt');`;
   const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,MODEL_CONFIG_FILE:config,WATERFALL_FORMAL_ROUTE:'1',WATERFALL_MODEL_TIMEOUT_MS:'30000'},stdio:['ignore','ignore','pipe']});
   let stderr='';child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('exit',n=>n===0?resolve():reject(Error(stderr)));children.at(-1)?.catch?.(()=>{});
  }));
  for(let i=0;i<500;i++){
   const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(file+'.sqlite');
   const rows=db.prepare("SELECT slot,count(*) AS n FROM attempts WHERE status='in_progress' AND http_started IS NOT NULL GROUP BY slot").all();db.close();
   peak=Math.max(peak,rows.reduce((n,r)=>n+r.n,0));
   assert(rows.every(r=>r.n<=16));if(peak===48)break;
   await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(peak,48);writeFileSync(barrier,'');await Promise.all(children);clearInterval(publish);await publishing;await store.exportSnapshot();
  const saved=JSON.parse(readFileSync(file));assert.equal(saved.attempts.length,43048);
  assert.deepEqual(saved.attempts.slice(0,43000),history);
  assert(saved.attempts.slice(43000).every(r=>r.status==='success'));assert.equal(errors.length,0);
  console.log(JSON.stringify({simulated_http_peak:peak,prior_records:43000,elapsed_ms:Date.now()-started,real_api_requests:0}));
 }finally{clearInterval(publish);writeFileSync(barrier,'');await Promise.allSettled(children);await publishing;store.close();rmSync(root,{recursive:true,force:true});}
});
