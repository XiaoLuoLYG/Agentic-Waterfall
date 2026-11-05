import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('transport retry repeats only the failed body and retains receipts', async t => {
  const root = mkdtempSync(join(tmpdir(), 'waterfall-transport-'));
  const originalFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(['MODEL_CONFIG_FILE','WATERFALL_FORMAL_ROUTE','WATERFALL_MODEL_TIMEOUT_MS','WATERFALL_PREFER_SECOND_APPROVED_KEY','WATERFALL_APPROVED_QUOTA_PROBE'].map(k => [k, process.env[k]]));
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, {recursive:true,force:true});
  });
  const model = 'DeepSeek-V4.1-Flash-1017';
  const apiBase = 'https://api.jiuwenappless.com/v1';
  for (const dir of ['shared','demo']) mkdirSync(join(root, dir));
  const ledger = join(root,'shared/model-ledger.json');
  writeFileSync(ledger, JSON.stringify({limit:50,max_concurrent:8,attempts:[]}));
  writeFileSync(join(root,'demo/CONTROL.json'), JSON.stringify({model_calls_enabled:true,model_request_limit:50}));
  const client = join(root,'shared/model-client.mjs');
  copyFileSync(process.env.WATERFALL_CLIENT_TEST_SOURCE||new URL('./model-client.mjs',import.meta.url), client);
  copyFileSync(new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-response.mjs',import.meta.url), join(root,'shared/model-response.mjs'));
  copyFileSync(new URL('./ledger-store.mjs',import.meta.url),join(root,'shared/ledger-store.mjs'));
  writeFileSync(join(root,'shared/request-gate.mjs'), `export const createRequestGate=({key})=>({admit:async({deadline})=>{
    globalThis.waterfallTestGateKeys?.push(key);
    globalThis.waterfallTestGateBudgets?.push(deadline-Date.now());
    if(globalThis.waterfallTestFailNextGate){globalThis.waterfallTestFailNextGate=false;throw Error('request_gate_call_deadline_exceeded')}
    return Date.now()
  },cooldown:async()=>{}})`);
  process.env.MODEL_CONFIG_FILE = join(root,'test-config.json');
  process.env.WATERFALL_FORMAL_ROUTE = '1';
  process.env.WATERFALL_MODEL_TIMEOUT_MS = '1000';
  writeFileSync(process.env.MODEL_CONFIG_FILE, JSON.stringify({recommendationModelName:model,apiBase,apiKey:'usable-test',extraEndpoints:[{model,apiBase,apiKey:'spent-test'}]}));
  const {callModel} = await import(pathToFileURL(client));
  const requests = [];
  let errors = 0, malformed = false;
  globalThis.fetch = async (url, {headers, body}) => {
    assert.equal(url, apiBase+'/chat/completions');
    assert.equal(headers.Authorization, 'Bearer usable-test');
    requests.push(body);
    if (errors > 0) {
      errors--;
      throw Object.assign(new TypeError('terminated'), {cause:{code:'UND_ERR_SOCKET'}});
    }
    if (malformed) return new Response('{');
    return Response.json({model, choices:[{message:{content:'valid'}}]});
  };
  const call = text => callModel({messages:[{role:'user',content:text}]}, {experiment:'demo'});
  assert.equal((await call('previous step')).content, 'valid');
  errors = 1;
  const recovered = await call('current step');
  assert.equal(recovered.service_attempts[0].error, 'model_transport_error');
  assert.equal(recovered.service_attempts[0].transport_diagnostic.cause_code, 'UND_ERR_SOCKET');
  assert.equal(requests.length, 3);
  assert.equal(requests[1], requests[2]);
  assert.notEqual(requests[0], requests[1]);
  errors = 2;
  await assert.rejects(call('exhausted step'), e => e.receipt.transport_retry_exhausted && e.receipt.service_attempts.length === 1);
  assert.equal(requests.length, 5);
  malformed = true;
  await assert.rejects(call('invalid HTTP body'), e => !e.receipt.transport_retryable);
  assert.equal(requests.length, 6);
  assert.deepEqual(JSON.parse(readFileSync(ledger)).attempts.map(r => r.status),
    ['success','failed','success','failed','failed','failed']);
  process.env.WATERFALL_PREFER_SECOND_APPROVED_KEY = '1';
  const credentials = [];
  globalThis.waterfallTestGateKeys = [];
  t.after(() => { delete globalThis.waterfallTestGateKeys; });
  globalThis.fetch = async (url, {headers}) => {
    credentials.push(headers.Authorization);
    return Response.json({model, choices:[{message:{content:'valid'}}]});
  };
  await call('secondary preferred');
  assert.deepEqual(credentials, ['Bearer spent-test']);
  assert.deepEqual(globalThis.waterfallTestGateKeys, ['usable-test']);
  assert.equal(JSON.parse(readFileSync(ledger)).attempts.at(-1).credential_slot, 'secondary');
  writeFileSync(join(root,'shared/dual-approved-routes.enabled'), '');
  credentials.length = 0;
  globalThis.waterfallTestGateKeys.length = 0;
  await Promise.all([call('parallel A'),call('parallel B')]);
  assert.deepEqual(credentials.sort(), ['Bearer spent-test','Bearer usable-test']);
  assert.deepEqual(globalThis.waterfallTestGateKeys.sort(), ['spent-test','usable-test']);
  const settings=JSON.parse(readFileSync(ledger));
  writeFileSync(ledger, JSON.stringify({...settings,max_concurrent:2,max_concurrent_per_credential:2}));
  const inFlight=new Map();
  let peak=0;
  globalThis.fetch=async (_url,{headers})=>{
    const key=headers.Authorization;
    inFlight.set(key,(inFlight.get(key)??0)+1);
    assert(inFlight.get(key)<=2);
    peak=Math.max(peak,[...inFlight.values()].reduce((sum,n)=>sum+n,0));
    await new Promise(resolve=>setTimeout(resolve,200));
    inFlight.set(key,inFlight.get(key)-1);
    return Response.json({model,choices:[{message:{content:'valid'}}]});
  };
  await Promise.all(Array.from({length:6},(_,i)=>call('capacity '+i)));
  assert.equal(peak,4);
  const settled=JSON.parse(readFileSync(ledger));
  writeFileSync(ledger,JSON.stringify({...settled,credential_concurrency_overrides:{primary:1}}));
  peak=0;
  await Promise.all(Array.from({length:6},(_,i)=>call('split capacity '+i)));
  assert.equal(peak,3);
  globalThis.waterfallTestGateKeys = [];
  globalThis.waterfallTestGateBudgets = [];
  globalThis.waterfallTestFailNextGate = true;
  t.after(() => {
    delete globalThis.waterfallTestGateBudgets;
    delete globalThis.waterfallTestFailNextGate;
  });
  const forwarded = [];
  globalThis.fetch = async (_url, {headers,body}) => {
    forwarded.push({key:headers.Authorization,body});
    return Response.json({model,choices:[{message:{content:'after queue wait'}}]});
  };
  const scheduled = await call('same step after route queue timeout');
  assert.equal(scheduled.content,'after queue wait');
  assert.equal(scheduled.service_attempts[0].error,'request_gate_call_deadline_exceeded');
  assert.equal(scheduled.service_attempts[0].http_request_started_at,null);
  assert.equal(forwarded.length,1);
  assert.equal(globalThis.waterfallTestGateKeys.length,2);
  assert.notEqual(...globalThis.waterfallTestGateKeys);
  assert(globalThis.waterfallTestGateBudgets.every(value=>value>0&&value<=90000));
  const last=JSON.parse(readFileSync(ledger)).attempts.slice(-2);
  assert.equal(last[0].request_sha256,last[1].request_sha256);
  assert.deepEqual(last.map(row=>row.status),['failed','success']);
  let transmitted = 0;
  globalThis.fetch = async () => {
    transmitted++;
    throw Error('request_gate_call_deadline_exceeded');
  };
  await assert.rejects(call('never treat an already transmitted call as a queue wait'));
  assert.equal(transmitted,1);
  let throttled = false;
  const afterThrottle = [];
  globalThis.fetch = async (_url, {headers}) => {
    const key=headers.Authorization;
    if(key==='Bearer spent-test'&&!throttled){
      throttled=true;
      return Response.json({error:{code:'max_parallel_requests',type:'throttling_error',message:'temporary concurrency limit'}},
        {status:429,headers:{'retry-after':'1'}});
    }
    afterThrottle.push(key);
    return Response.json({model,choices:[{message:{content:'after temporary throttle'}}]});
  };
  await call('allow either initial credential');
  await call('ensure the second credential throttle was observed');
  assert(throttled);
  afterThrottle.length=0;
  await Promise.all([call('following step A'),call('following step B')]);
  assert.deepEqual(afterThrottle.sort(),['Bearer spent-test','Bearer usable-test']);
  writeFileSync(process.env.MODEL_CONFIG_FILE,JSON.stringify({recommendationModelName:model,apiBase,apiKey:'usable-test'}));
  globalThis.waterfallTestGateBudgets.length=0;
  await call('one configured route keeps its full original wait budget');
  assert(globalThis.waterfallTestGateBudgets[0]>90000&&globalThis.waterfallTestGateBudgets[0]<=200000);
  writeFileSync(process.env.MODEL_CONFIG_FILE, JSON.stringify({recommendationModelName:model,apiBase,apiKey:'usable-test',extraEndpoints:[{model,apiBase,apiKey:'spent-test'}]}));
  const quota = slot => ({id:'quota-'+slot,experiment:'demo',credential_slot:slot,status:'failed',
    started_at:new Date().toISOString(),completed_at:new Date().toISOString(),
    http_error:{type:'budget_exceeded',retryable:false}});
  let current=JSON.parse(readFileSync(ledger));
  current.attempts.push(quota('secondary'));writeFileSync(ledger,JSON.stringify(current));
  const routed=[];globalThis.waterfallTestGateBudgets.length=0;
  globalThis.fetch=async (_url,{headers})=>{routed.push(headers.Authorization);return Response.json({model,choices:[{message:{content:'same approved model'}}]});};
  await Promise.all([call('skip exhausted route A'),call('skip exhausted route B')]);
  assert.deepEqual(routed,['Bearer usable-test','Bearer usable-test']);
  assert(globalThis.waterfallTestGateBudgets.every(value=>value>90000&&value<=200000),'Do not consume 90 seconds trying a route already proven out of budget.');
  process.env.WATERFALL_APPROVED_QUOTA_PROBE='1';routed.length=0;
  await call('one authorized quota probe');
  assert.deepEqual(routed,['Bearer spent-test']);
  delete process.env.WATERFALL_APPROVED_QUOTA_PROBE;
  routed.length=0;
  await Promise.all([call('restored route A'),call('restored route B')]);
  assert.deepEqual(routed.sort(),['Bearer spent-test','Bearer usable-test']);
  current=JSON.parse(readFileSync(ledger));current.attempts.push(quota('primary'),quota('secondary'));writeFileSync(ledger,JSON.stringify(current));
  const beforeBlocked=routed.length;
  await assert.rejects(call('both routes exhausted'),/approved_routes_budget_exhausted/);
  assert.equal(routed.length,beforeBlocked,'No model request when both approved budgets are known exhausted.');
});
