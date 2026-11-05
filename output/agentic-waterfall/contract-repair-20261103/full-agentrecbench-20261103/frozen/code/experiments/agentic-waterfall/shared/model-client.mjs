import { readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestGate } from './request-gate.mjs';
import {readModelResponse} from './model-response.mjs';
export {readModelResponse};

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = resolve(ROOT, 'shared/model-ledger.json');
const LOCK = `${LEDGER}.lock`;
const CONFIG = resolve(ROOT, '../../HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json');
export const digest = data => createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
export function modelTimeoutMs() {
  const value=Number(process.env.WATERFALL_MODEL_TIMEOUT_MS || 60000);
  if(!Number.isSafeInteger(value)||value<1000||value>600000)throw new Error('invalid_model_timeout');
  return value;
}

function checkedEndpoint(base) {
  const endpoint = new URL(base);
  if (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)) throw new Error('unsafe_model_endpoint');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('invalid_model_config');
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  if (!endpoint.pathname.endsWith('/chat/completions')) endpoint.pathname += '/chat/completions';
  return endpoint.href;
}

const FORMAL_MODEL = 'DeepSeek-V4.1-Flash-1017';
const FORMAL_ENDPOINT = 'https://api.jiuwenappless.com/v1/chat/completions';

export function loadModelConfig() {
  const file = JSON.parse(readFileSync(process.env.MODEL_CONFIG_FILE || process.env.XUANJI_CONFIG_FILE || CONFIG, 'utf8'));
  const configuredModel = file.recommendationModelName || file.modelName;
  const formal = process.env.WATERFALL_FORMAL_ROUTE === '1'
    || (configuredModel === FORMAL_MODEL && file.apiBase && checkedEndpoint(file.apiBase) === FORMAL_ENDPOINT);
  let slots;
  if (formal) {
    // Prefer the newer gateway credential and use the original gateway credential as fallback.
    const configured = [...(Array.isArray(file.extraEndpoints) ? file.extraEndpoints : []),
      {apiKey:file.apiKey, apiBase:file.apiBase, model:configuredModel}];
    slots = [];
    for (const item of configured) {
      if (item?.model !== FORMAL_MODEL || typeof item.apiKey !== 'string' || !item.apiKey
        || typeof item.apiBase !== 'string' || checkedEndpoint(item.apiBase) !== FORMAL_ENDPOINT
        || slots.some(slot => slot.key === item.apiKey)) continue;
      slots.push({key:item.apiKey, endpoint:FORMAL_ENDPOINT, model:FORMAL_MODEL});
    }
    if (!slots.length || slots.length > 2) throw new Error('invalid_formal_model_routes');
  } else {
    const model = process.env.OPENAI_MODEL || configuredModel;
    const key = process.env.OPENAI_API_KEY || file.apiKey;
    if (!key || !model) throw new Error('invalid_model_config');
    slots = [{key, model, endpoint:checkedEndpoint(process.env.OPENAI_BASE_URL || file.apiBase)}];
  }
  const parameters = formal || file.recommendationModelName
    ? {enable_thinking:false,thinking:{type:'disabled'},extra_body:{thinking:{type:'disabled'}}} : {};
  return {...slots[0], slots, parameters, formal};
}

async function withLedger(fn) {
  const deadline = Date.now() + 10000;
  while (true) {
    try { mkdirSync(LOCK); break; }
    catch (e) { if(e.code !== 'EEXIST') throw e; if(Date.now() > deadline) throw new Error('ledger_locked_manual_inspection_required'); await delay(50); }
  }
  try {
    let ledger;
    try { ledger = JSON.parse(readFileSync(LEDGER, 'utf8')); }
    catch (e) { if(e.code !== 'ENOENT') throw e; ledger={schema_version:1,limit:120,max_concurrent:2,attempts:[]}; }
    const result = fn(ledger);
    const temporary = `${LEDGER}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(ledger,null,2)+'\n'); renameSync(temporary,LEDGER);
    return result;
  } finally { rmdirSync(LOCK); }
}

async function reserve(experiment, request, model, latestStart) {
  if (!/^[a-z0-9-]+$/.test(experiment)) throw new Error('invalid_experiment');
  while (true) {
    const reservation=await withLedger(ledger => {
      if(Date.now()>latestStart)throw new Error('request_gate_call_deadline_exceeded');
      const controlPath=resolve(ROOT,experiment==='controller'?'shared/CONTROL.json':`${experiment}/CONTROL.json`);
      const control=JSON.parse(readFileSync(controlPath,'utf8'));
      if (control.model_calls_enabled === false) throw new Error('model_calls_not_enabled');
      if (!Number.isSafeInteger(ledger.limit) || ledger.limit < 1) throw new Error('invalid_global_request_limit');
      const maxConcurrent=ledger.max_concurrent===undefined?2:ledger.max_concurrent;
      if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) throw new Error('invalid_max_concurrent');
      if (ledger.attempts.length >= ledger.limit) throw new Error('global_request_budget_exhausted');
      if (ledger.attempts.filter(x=>x.experiment===experiment).length >= (control.model_request_limit || 0)) throw new Error('experiment_request_budget_exhausted');
      // A stale reservation is never silently recycled: its actual outcome must be audited.
      if (ledger.attempts.filter(x=>x.status==='in_progress').length >= maxConcurrent) return null;
      const attempt={id:randomUUID(),experiment,model,request_sha256:digest(request),started_at:new Date().toISOString(),pid:process.pid,status:'in_progress'};
      ledger.attempts.push(attempt); return attempt;
    });
    if (reservation) return reservation;
    await delay(250);
  }
}

function rateLimitHeaders(response){
 return Object.fromEntries([...(response.headers?.entries?.()||[])].filter(([key,value])=>/^(x-)?ratelimit-(limit|remaining|reset)(-(requests|tokens))?$/.test(key)&&/^[0-9:.TZ+ -]+$/.test(value)).map(([key,value])=>[key,value.slice(0,100)]));
}


async function httpError(response,key) {
  let body;
  try { body=typeof response.text==='function'?await response.text():await response.json(); } catch {}
  if(typeof body==='string')try { body=JSON.parse(body); } catch { body={message:body}; }
  const error=body?.error??body;
  const clean=value=>typeof value==='string'?value.replaceAll(key,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/(\bapi[_ -]?key\s*[:=]\s*)\S+/gi,'$1[REDACTED]').slice(0,1000):null;
  const code=clean(error?.code),type=clean(error?.type),message=clean(typeof error==='string'?error:error?.message);
  const retry=response.headers?.get?.('retry-after');
  const seconds=retry&&/^\d+$/.test(retry)?Number(retry):retry?Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000)):null;
  const quota=/insufficient[_ -]?quota|quota[_ -]?exceeded|budget[_ -]?exceeded|budget has been exceeded|credit|balance|billing|payment|预算|余额|额度不足/i.test([code,type,message].join(' '));
  return {status:response.status,code,type,message,rate_limit_headers:rateLimitHeaders(response),request_id:clean(response.headers?.get?.('x-request-id')),
    retry_after_seconds:Number.isFinite(seconds)?seconds:null,...(response.status===429?{retryable:!quota}:{})};
}

async function callOnce(request, {experiment}={}, config, deadline) {
  if (!Array.isArray(request?.messages) || request.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')) throw new Error('invalid_messages');
  const timeoutMs=modelTimeoutMs();
  const body={model:config.model,messages:request.messages,temperature:request.temperature??0.3,max_tokens:request.max_tokens??4096,...config.parameters,...(request.response_format?{response_format:request.response_format}:{}),...(request.stream===true?{stream:true,stream_options:{include_usage:true}}:{})};
  if (!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1) throw new Error('invalid_max_tokens');
  const gate=createRequestGate(config);
  const latestStart=deadline-timeoutMs-10000;
  const attempt=await reserve(experiment,body,config.model,latestStart);
  const started=Date.now(); let receipt,http,gateWaitMs,httpStartedAt=null;
  try {
    gateWaitMs=Math.max(0,(await gate.admit({deadline:latestStart}))-started);
    httpStartedAt=new Date().toISOString();
    await withLedger(ledger=>{
      ledger.attempts.find(entry=>entry.id===attempt.id).http_request_started_at=httpStartedAt;
    });
    const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.key}`},body:JSON.stringify(body),...(config.formal?{redirect:'error'}:{}),signal:AbortSignal.timeout(timeoutMs)});
    if (!response.ok) { http=await httpError(response,config.key);if(response.status===429&&http.retryable)await gate.cooldown(http.retry_after_seconds??60);throw new Error(`model_http_${response.status}`); }
    const result=await readModelResponse(response);
    const content=result.choices?.[0]?.message?.content;
    if (typeof content!=='string') throw new Error('model_missing_content');
    receipt={attempt_id:attempt.id,status:'success',requested_model:config.model,provider_response_model:result.model||null,content,...(typeof result.choices?.[0]?.message?.reasoning_content==='string'?{reasoning_content:result.choices[0].message.reasoning_content}:{}),...(result.stream_metadata?{stream_metadata:result.stream_metadata}:{}),usage:result.usage||null,finish_reason:result.choices?.[0]?.finish_reason||null,request_settings:{temperature:body.temperature,max_tokens:body.max_tokens,...config.parameters,...(body.stream?{stream:true}:{})},rate_limit_headers:rateLimitHeaders(response),request_gate_wait_ms:gateWaitMs,http_request_started_at:httpStartedAt,duration_ms:Date.now()-started};
    return receipt;
  } catch(e) {
    const code=/^model_http_\d+$/.test(e.message)||e.message==='model_missing_content'||e.message?.startsWith('request_gate_')?e.message:e.name==='TimeoutError'?'model_timeout':'model_transport_error';
    if(e.streamError)http=await httpError({status:200,json:async()=>({error:e.streamError})},config.key);
    receipt={attempt_id:attempt.id,status:'failed',requested_model:config.model,error:code,...(http?{http_error:http}:{}),...(e.partialResponse?{partial_response:e.partialResponse,stream_diagnostic:e.streamDiagnostic}:{}),request_settings:{temperature:body.temperature,max_tokens:body.max_tokens,...config.parameters,...(body.stream?{stream:true}:{})},request_gate_wait_ms:gateWaitMs??Date.now()-started,http_request_started_at:httpStartedAt,duration_ms:Date.now()-started};
    const error=new Error(code); error.receipt=receipt; throw error;
  } finally {
    await withLedger(ledger=>{
      const entry=ledger.attempts.find(x=>x.id===attempt.id);
      Object.assign(entry,{status:receipt?.status||'failed',completed_at:new Date().toISOString(),duration_ms:Date.now()-started,usage:receipt?.usage||null,rate_limit_headers:receipt?.rate_limit_headers||http?.rate_limit_headers||{},provider_response_model:receipt?.provider_response_model||null,request_gate_wait_ms:receipt?.request_gate_wait_ms??null,http_request_started_at:receipt?.http_request_started_at??null,...(receipt?.error?{error:receipt.error}:{}),...(http?{http_error:http}:{})});
    });
  }
}

export async function callModel(request, options={}) {
  if (!Array.isArray(request?.messages) || request.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')) throw new Error('invalid_messages');
  // Keep 200 seconds for shared queue/backoff plus HTTP and accounting; the default fits 300-second callers.
  const deadline=Date.now()+modelTimeoutMs()+210000,base=loadModelConfig(),frozen=structuredClone(request),failures=[];
  const {slots}=base;
  if(options.thinkingMode!==undefined){
    if(!['enabled','disabled'].includes(options.thinkingMode))throw Error('invalid_thinking_mode');
    base.parameters={...base.parameters,enable_thinking:options.thinkingMode==='enabled',thinking:{type:options.thinkingMode},extra_body:{thinking:{type:options.thinkingMode}}};
  }
  for(let index=0;index<3;index++) {
    const slot=slots[Math.min(index,slots.length-1)];
    const config={...base,...slot};
    try {
      const receipt=await callOnce(frozen,options,config,deadline);
      if(failures.length)receipt.service_attempts=failures;
      return receipt;
    } catch(error) {
      if(!error.receipt&&error.message==='request_gate_call_deadline_exceeded')error.receipt={status:'failed',error:error.message,requested_model:config.model,http_request_started_at:null};
      const receipt=error.receipt;
      const throttled=receipt?.error==='model_http_429'&&receipt.http_error?.retryable===true&&receipt.http_error.type==='throttling_error';
      const quota=receipt?.error==='model_http_429'&&receipt.http_error?.retryable===false;
      const nextSlot=index+1<slots.length;
      if((!throttled&&!(quota&&nextSlot))||index===2) {
        if(receipt&&failures.length)receipt.service_attempts=failures;
        if(throttled||quota||error.message==='request_gate_call_deadline_exceeded')receipt.service_retry_exhausted=true;
        throw error;
      }
      failures.push(structuredClone(receipt));
    }
  }
}
