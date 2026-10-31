import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const config={endpoint:'https://synthetic.invalid/v1/chat/completions',key:'synthetic-private-key',model:'model-a'};
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'waterfall-gate-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let time=100000;const waits=[];
 return {directory,now:()=>time,wait:async ms=>{assert(ms>0);waits.push(ms);time+=ms;},waits};
}
async function copies(t){
 const options=fixture(t);const modules=[];
 for(const root of ['waterfall-root','baseline-root']){
  const dir=join(options.directory,root);mkdirSync(dir);
  copyFileSync(new URL('./request-gate.mjs',import.meta.url),join(dir,'request-gate.mjs'));
  modules.push(await import(pathToFileURL(join(dir,'request-gate.mjs'))));
 }
 return {options,modules};
}

test('independent copies and model names share 45 admissions per rolling minute and spacing',async t=>{
 const {options,modules}=await copies(t);
 const gates=modules.map((m,i)=>m.createRequestGate({...config,model:`model-${i}`,endpoint:`https://synthetic.invalid/path-${i}`},options));
 const times=[];for(let i=0;i<46;i++)times.push(await gates[i%2].admit());
 assert.equal(times[0],100000);
 for(let i=1;i<times.length;i++)assert(times[i]-times[i-1]>=1334);
 for(const end of times)assert(times.filter(x=>x>end-60000&&x<=end).length<=45);
 assert(times[45]-times[0]>=60000);
 const files=readdirSync(options.directory).filter(x=>x.endsWith('.json'));
 assert.equal(files.length,1);
 assert(!files[0].includes(config.key));assert(!readFileSync(join(options.directory,files[0]),'utf8').includes(config.key));
});

test('live rate changes are shared and preserve the current rolling history',async t=>{
 const {options,modules}=await copies(t);
 const a=modules[0].createRequestGate(config,options),b=modules[1].createRequestGate(config,options);
 await a.setRateLimit(90);
 const starts=[];for(let i=0;i<91;i++)starts.push(await b.admit());
 assert(starts[1]-starts[0]>=667);assert(starts[90]-starts[0]>=60000);
 const file=join(options.directory,readdirSync(options.directory).find(x=>x.endsWith('.json')));
 const before=JSON.parse(readFileSync(file,'utf8')).starts;
 await a.setRateLimit(45);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).starts,before);
 const next=await b.admit();assert(starts.filter(x=>x>next-60000).length<45);
 for(const limit of [0,121,null,'90',1.5])await assert.rejects(a.setRateLimit(limit),/request_gate_invalid_rate/);
});

test('full rolling window waits even if old admissions were a burst',async t=>{
 const options=fixture(t);const {createRequestGate}=await import('./request-gate.mjs');
 const gate=createRequestGate(config,options);await gate.admit();
 const file=join(options.directory,readdirSync(options.directory).find(x=>x.endsWith('.json')));
 const state=JSON.parse(readFileSync(file,'utf8'));state.starts=Array(45).fill(100000);writeFileSync(file,JSON.stringify(state));
 assert.equal(await gate.admit(),160000);
});

test('cooldown propagates across roots and models without shortening previous cooldown',async t=>{
 const {options,modules}=await copies(t);
 const a=modules[0].createRequestGate(config,options),b=modules[1].createRequestGate({...config,model:'other'},options);
 await a.admit();await b.cooldown(90);await a.cooldown(60);
 assert.equal(await a.admit(),190000);
 assert.equal(await b.admit(),191334);
 const otherKey=modules[0].createRequestGate({...config,key:'different-key'},options);
 const otherOrigin=modules[0].createRequestGate({...config,endpoint:'https://another.invalid/chat/completions'},options);
 assert.equal(await otherKey.admit(),191334);assert.equal(await otherOrigin.admit(),191334);
});

test('corrupt state is preserved and fails closed; stale lock is never cleared',async t=>{
 const options=fixture(t);const {createRequestGate}=await import('./request-gate.mjs');const gate=createRequestGate(config,options);
 await gate.admit();const file=join(options.directory,readdirSync(options.directory).find(x=>x.endsWith('.json')));
 for(const text of ['not json','{"version":1,"starts":["bad"],"cooldown_until":0}']){
  writeFileSync(file,text);await assert.rejects(gate.admit(),/request_gate_state_invalid/);
  assert.equal(readFileSync(file,'utf8'),text);
 }
 mkdirSync(file+'.lock');await assert.rejects(gate.admit(),/request_gate_locked_manual_inspection_required/);
 assert(existsSync(file+'.lock'));assert.equal(readFileSync(file,'utf8'),'{"version":1,"starts":["bad"],"cooldown_until":0}');
});

test('repeated provider cooldown preserves the local queue wait budget across roots',async t=>{
 const {options,modules}=await copies(t);const advance=options.wait;let extended=false,b;
 options.wait=async ms=>{await advance(ms);if(!extended&&options.now()>=150000){extended=true;await b.cooldown(60);}};
 const a=modules[0].createRequestGate(config,options);b=modules[1].createRequestGate(config,options);
 await a.admit();await b.cooldown(60);
 assert.equal(await a.admit(),210000);
 const file=join(options.directory,readdirSync(options.directory).find(x=>x.endsWith('.json')));
 assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).starts,[210000]);
});

test('a provider cooldown beyond the absolute five-minute guard stops visibly without waiting',async t=>{
 const options=fixture(t);const {createRequestGate}=await import('./request-gate.mjs');const gate=createRequestGate(config,options);
 await gate.cooldown(301);
 await assert.rejects(gate.admit(),/request_gate_wait_exceeds_300s/);
 assert.equal(options.waits.length,0);
});

test('caller deadline reserves time for HTTP and accounting without changing the shared cooldown',async t=>{
 const options=fixture(t);const {createRequestGate}=await import('./request-gate.mjs');const gate=createRequestGate(config,options);
 await gate.cooldown(90);
 await assert.rejects(gate.admit({deadline:options.now()+80000}),/request_gate_call_deadline_exceeded/);
 assert.equal(options.waits.length,0);
 assert.equal(await gate.admit({deadline:options.now()+90000}),190000);
 for(const deadline of [NaN,null,'200000',-1])await assert.rejects(gate.admit({deadline}),/request_gate_invalid_deadline/);
});

test('queue contention still has a ninety-second budget without provider cooldown',async t=>{
 const {options,modules}=await copies(t);const advance=options.wait;let competed=false,b;
 options.wait=async ms=>{await advance(ms);if(!competed&&options.now()>=160000){competed=true;await b.admit();}};
 const a=modules[0].createRequestGate(config,options);b=modules[1].createRequestGate(config,options);
 await a.setRateLimit(1);await a.admit();
 await assert.rejects(a.admit(),/request_gate_wait_exceeds_90s/);
});

test('separate processes and copied roots coordinate actual admission times',async t=>{
 const {options}=await copies(t);
 const children=['waterfall-root','baseline-root','waterfall-root'].map((root,i)=>{
  const url=pathToFileURL(join(options.directory,root,'request-gate.mjs')).href;
  const code=`import {createRequestGate} from ${JSON.stringify(url)}; console.log(await createRequestGate(${JSON.stringify({...config,model:`model-${i}`})}).admit());`;
  return new Promise((done,fail)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,WATERFALL_REQUEST_GATE_DIR:join(options.directory,'real-process-gate')}});
   let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',fail);
   child.on('exit',status=>status===0?done(Number(out.trim())):fail(Error(err)));
  });
 });
 const times=(await Promise.all(children)).sort((a,b)=>a-b);
 assert.equal(times.length,3);assert(times[1]-times[0]>=1334);assert(times[2]-times[1]>=1334);
});

test('JSON and SQLite clients in separate roots share one gate and meter each HTTP attempt',async t=>{
 const options=fixture(t);const names=['MODEL_CONFIG_FILE','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_BASE_URL','WATERFALL_REQUEST_GATE_DIR'];
 const prior=Object.fromEntries(names.map(x=>[x,process.env[x]])),fetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=fetch;for(const name of names)if(prior[name]===undefined)delete process.env[name];else process.env[name]=prior[name];});
 const clients=[];
 for(const variant of ['json','sqlite']){
  const root=join(options.directory,variant),shared=join(root,'shared');mkdirSync(shared,{recursive:true});mkdirSync(join(root,'method-deployment'));
  const source=variant==='json'?new URL('./model-client.mjs',import.meta.url):new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/model-client.mjs',import.meta.url);
  writeFileSync(join(shared,'model-client.mjs'),readFileSync(source,'utf8').replace("resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')","resolve(ROOT, 'shared/model-ledger.json')"));
  copyFileSync(new URL('./request-gate.mjs',import.meta.url),join(shared,'request-gate.mjs'));
  if(variant==='sqlite')copyFileSync(new URL('../../../methods/agentic-waterfall/full-expansion/runtime/experiments/agentic-waterfall/shared/archive.mjs',import.meta.url),join(shared,'archive.mjs'));
  writeFileSync(join(shared,'model-ledger.json'),JSON.stringify({limit:10,attempts:[]}));
  writeFileSync(join(root,'method-deployment/CONTROL.json'),JSON.stringify({model_calls_enabled:true,model_request_limit:10}));
  clients.push(await import(pathToFileURL(join(shared,'model-client.mjs'))));
 }
 const configPath=join(options.directory,'config.json');writeFileSync(configPath,JSON.stringify({apiKey:config.key,apiBase:config.endpoint,modelName:'base'}));
 process.env.MODEL_CONFIG_FILE=configPath;process.env.WATERFALL_REQUEST_GATE_DIR=join(options.directory,'shared-gate');
 delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_BASE_URL;
 const http=[];globalThis.fetch=async(_,request)=>{http.push(Date.now());return new Response(JSON.stringify({model:JSON.parse(request.body).model,choices:[{message:{content:'{}'},finish_reason:'stop'}]}),{status:200});};
 process.env.OPENAI_MODEL='waterfall-model';const a=clients[0].callModel({messages:[{role:'user',content:'synthetic'}]},{experiment:'method-deployment'});
 process.env.OPENAI_MODEL='baseline-model';const b=clients[1].callModel({messages:[{role:'user',content:'synthetic'}]},{experiment:'method-deployment'});
 const receipts=await Promise.all([a,b]);assert.equal(http.length,2);
 assert.deepEqual(receipts.map(x=>x.requested_model),['waterfall-model','baseline-model']);
 assert(receipts.every(x=>Number.isInteger(x.request_gate_wait_ms)&&x.request_gate_wait_ms>=0));
 const files=readdirSync(process.env.WATERFALL_REQUEST_GATE_DIR).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);
 const state=JSON.parse(readFileSync(join(process.env.WATERFALL_REQUEST_GATE_DIR,files[0]),'utf8'));assert.equal(state.starts.length,2);assert(state.starts[1]-state.starts[0]>=1334);
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(join(options.directory,'sqlite/shared/expansion-ledger.sqlite'));
 const records=db.prepare('SELECT record FROM attempts').all().map(x=>JSON.parse(x.record));db.close();
 assert.equal(records.length,1);assert.equal(records[0].request_gate_wait_ms,receipts[1].request_gate_wait_ms);
 assert.equal(JSON.parse(readFileSync(join(options.directory,'json/shared/model-ledger.json'),'utf8')).attempts.length,1);
 assert(receipts.every(x=>Number.isFinite(Date.parse(x.http_request_started_at))));
 assert.equal(records[0].http_request_started_at,receipts[1].http_request_started_at);
 const gateFile=join(process.env.WATERFALL_REQUEST_GATE_DIR,files[0]);writeFileSync(gateFile,'corrupt gate state');
 await assert.rejects(clients[0].callModel({messages:[{role:'user',content:'synthetic unsent request'}]},{experiment:'method-deployment'}),error=>{
  assert.equal(error.message,'request_gate_state_invalid');assert.equal(error.receipt.http_request_started_at,null);return true;
 });
 assert.equal(http.length,2);
 const ledger=JSON.parse(readFileSync(join(options.directory,'json/shared/model-ledger.json'),'utf8'));
 assert.equal(ledger.attempts.length,2);assert.equal(ledger.attempts.at(-1).http_request_started_at,null);
 assert.equal(readFileSync(gateFile,'utf8'),'corrupt gate state');
});
