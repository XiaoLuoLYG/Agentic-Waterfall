import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter,once} from 'node:events';

const request={messages:[{role:'user',content:'synthetic concurrency test'}],max_tokens:1};
async function fixture(t,maxConcurrent,holdResponses=true){
  const root=mkdtempSync(join(tmpdir(),'waterfall-concurrency-'));
  const names=['MODEL_CONFIG_FILE','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','WATERFALL_REQUEST_GATE_DIR'];
  const prior=Object.fromEntries(names.map(name=>[name,process.env[name]])),originalFetch=globalThis.fetch;
  const calls=[],pending=[],events=new EventEmitter();let completeImmediately=!holdResponses,sent=0;
  const response=()=>new Response(JSON.stringify({model:'test-model',choices:[{message:{content:'ok'},finish_reason:'stop'}],usage:{total_tokens:1}}),{status:200});
  t.after(async()=>{
    completeImmediately=true;for(const release of pending)release(response());
    await Promise.allSettled(calls);
    globalThis.fetch=originalFetch;
    for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];
    rmSync(root,{recursive:true,force:true});
  });
  mkdirSync(join(root,'shared'));mkdirSync(join(root,'mind'));
  for(const file of ['model-client.mjs','request-gate.mjs','model-response.mjs'])copyFileSync(new URL(file,import.meta.url),join(root,'shared',file));
  const config=join(root,'config.json'),ledgerPath=join(root,'shared/model-ledger.json');
  writeFileSync(config,JSON.stringify({apiKey:'test-only',apiBase:'https://example.invalid',modelName:'test-model'}));
  for(const name of names)delete process.env[name];
  process.env.MODEL_CONFIG_FILE=config;process.env.WATERFALL_REQUEST_GATE_DIR=join(root,'gates');
  const save=ledger=>writeFileSync(ledgerPath,JSON.stringify(ledger));
  save({limit:50,attempts:[],...(maxConcurrent===undefined?{}:{max_concurrent:maxConcurrent})});
  writeFileSync(join(root,'mind/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:50}));
  const {callModel}=await import(pathToFileURL(join(root,'shared/model-client.mjs')));
  globalThis.fetch=async()=>{
    sent++;
    if(completeImmediately)return response();
    return new Promise(resolve=>{pending.push(resolve);events.emit('request');});
  };
  return {
    root,
    start(client=callModel){const call=client(request,{experiment:'mind'});calls.push(call);return call;},
    ledger:()=>JSON.parse(readFileSync(ledgerPath,'utf8')),text:()=>readFileSync(ledgerPath,'utf8'),save,
    release(index){pending[index](response());},
    sent:()=>sent,
    async waitForRequests(count){
      try{while(pending.length<count)await once(events,'request',{signal:AbortSignal.timeout(20000)});}
      catch(error){assert.equal(pending.length,count,`mock requests did not arrive: ${error.message}`);}
    }
  };
}

for(const [name,maxConcurrent,slots] of [['configured',4,4],['server maximum',10,10],['default',undefined,2]]){
  test(`${name} concurrency permits ${slots} outstanding requests and blocks the next until release`,async t=>{
    const f=await fixture(t,maxConcurrent);
    const first=Array.from({length:slots},()=>f.start());
    assert.equal(f.ledger().attempts.length,slots);
    await f.waitForRequests(slots);
    assert.equal(f.ledger().attempts.filter(x=>x.status==='in_progress').length,slots);
    const next=f.start();
    assert.equal(f.ledger().attempts.length,slots);
    assert.equal(f.sent(),slots);
    f.release(0);await first[0];
    await f.waitForRequests(slots+1);
    assert.equal(f.ledger().attempts.length,slots+1);
    assert.equal(f.ledger().attempts.filter(x=>x.status==='in_progress').length,slots);
    for(let i=1;i<=slots;i++)f.release(i);
    assert((await Promise.all([...first,next])).every(receipt=>receipt.status==='success'));
    assert(f.ledger().attempts.every(attempt=>attempt.status==='success'));
  });
}

test('invalid concurrency fails closed before sending or changing the ledger budget',async t=>{
  const f=await fixture(t,undefined,false);
  for(const max_concurrent of [null,0,-1,11,1.5,'4',true,{},[]]){
    f.save({limit:10,max_concurrent,attempts:[]});const before=f.text();
    await assert.rejects(f.start(),/invalid_max_concurrent/);
    assert.equal(f.sent(),0);
    assert.equal(f.text(),before);
  }
});

test('JSON and SQLite clients share the same ten reservation slots',async t=>{
 const f=await fixture(t,10);
 const source=readFileSync(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/model-client.mjs',import.meta.url),'utf8').replace("resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')","resolve(ROOT, 'shared/model-ledger.json')");
 writeFileSync(join(f.root,'shared/peer-model-client.mjs'),source);
 copyFileSync(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/archive.mjs',import.meta.url),join(f.root,'shared/archive.mjs'));
 const peer=await import(pathToFileURL(join(f.root,'shared/peer-model-client.mjs')));
 const calls=Array.from({length:10},(_,i)=>i%2?f.start(peer.callModel):f.start());await f.waitForRequests(10);
 assert.equal(f.ledger().attempts.filter(x=>x.status==='in_progress').length,10);
 const next=f.start();assert.equal(f.ledger().attempts.length,10);
 f.release(0);await calls[0];await f.waitForRequests(11);
 for(let i=1;i<=10;i++)f.release(i);
 const receipts=await Promise.all([...calls,next]);assert.equal(receipts.length,11);assert.equal(new Set(receipts.map(x=>x.attempt_id)).size,11);
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(f.root,'shared/expansion-ledger.sqlite'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM attempts').get().n,5);db.close();
 assert.equal(f.ledger().attempts.length,6);assert(f.ledger().attempts.every(x=>x.status==='success'));
});
