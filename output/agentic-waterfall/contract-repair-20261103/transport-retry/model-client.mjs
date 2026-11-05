import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestGate } from './request-gate.mjs';
import {readModelResponse} from './model-response.mjs';
import {openLedger} from './ledger-store.mjs';
export {readModelResponse};

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = resolve(ROOT, 'shared/model-ledger.json');
const incrementalLedger = openLedger(LEDGER);
const LOCK = `${LEDGER}.lock`;
const DUAL_APPROVED_ROUTES = resolve(ROOT, 'shared/dual-approved-routes.enabled');
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

const CREDENTIAL_NAMES = ['primary','secondary','tertiary'];
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
    const extra = typeof file.waterfallApprovedCredentialsFile==='string'
      ? JSON.parse(readFileSync(file.waterfallApprovedCredentialsFile,'utf8')) : null;
    const useExtra = extra?.enabled===true || (process.env.WATERFALL_APPROVED_QUOTA_PROBE==='1' && Boolean(process.env.WATERFALL_PROBE_CREDENTIAL_SLOT));
    const primary = useExtra && extra?.primaryOverride ? {...extra.primaryOverride,replacesCredential:true}
      : {apiKey:file.apiKey,apiBase:file.apiBase,model:configuredModel};
    const configured = [...(useExtra && Array.isArray(extra?.credentials) ? extra.credentials.map(x=>({...x,replacesCredential:true})) : []),
      ...(Array.isArray(file.extraEndpoints) ? file.extraEndpoints : []), primary];
    slots = [];
    for (const item of configured) {
      if (item?.model !== FORMAL_MODEL || typeof item.apiKey !== 'string' || !item.apiKey
        || typeof item.apiBase !== 'string' || checkedEndpoint(item.apiBase) !== FORMAL_ENDPOINT
        || slots.some(slot => slot.key === item.apiKey)) continue;
      slots.push({key:item.apiKey, endpoint:FORMAL_ENDPOINT, model:FORMAL_MODEL,replacesCredential:item.replacesCredential===true});
    }
    if (!slots.length || slots.length > 3) throw new Error('invalid_formal_model_routes');
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
    if (result === null) return result;
    const temporary = `${LEDGER}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(ledger,null,2)+'\n'); renameSync(temporary,LEDGER);
    return result;
  } finally { rmdirSync(LOCK); }
}

async function reserve(experiment, request, model, latestStart, credentialSlot, dual, credentialCount, fingerprint, availableSlots) {
  if (!/^[a-z0-9-]+$/.test(experiment)) throw new Error('invalid_experiment');
  while (true) {
    if(Date.now()>latestStart)throw new Error('request_gate_call_deadline_exceeded');
    const reservation=incrementalLedger ? await incrementalLedger.reserve({id:randomUUID(),experiment,model,
      request_sha256:digest(request),started_at:new Date().toISOString(),pid:process.pid,status:'in_progress',
      ...(credentialSlot?{credential_slot:credentialSlot,credential_fingerprint:fingerprint}:{})},
      JSON.parse(readFileSync(resolve(ROOT,experiment==='controller'?'shared/CONTROL.json':`${experiment}/CONTROL.json`),'utf8')),
      dual,credentialCount) : await withLedger(ledger => {
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
      const active=ledger.attempts.filter(x=>x.status==='in_progress');
      const perCredential=dual ? ledger.max_concurrent_per_credential : undefined;
      if (perCredential===undefined) {
        if (active.length>=maxConcurrent) return null;
      } else {
        const overrides=ledger.credential_concurrency_overrides||{};
        const limits=Object.fromEntries(CREDENTIAL_NAMES.slice(0,credentialCount).map(name=>[name,ledger.credential_policy?.max_concurrent?.[name]??overrides[name]??perCredential]));
        if (Object.values(limits).some(n=>!Number.isSafeInteger(n)||n<1||n>16)) throw Error('invalid_credential_concurrency');
        const onCredential=active.filter(x=>!x.credential_slot||x.credential_slot===credentialSlot).length;
        if (active.length>=Object.values(limits).reduce((a,b)=>a+b,0)||onCredential>=limits[credentialSlot]) return null;
      }
      const attempt={id:randomUUID(),experiment,model,request_sha256:digest(request),started_at:new Date().toISOString(),pid:process.pid,status:'in_progress',...(credentialSlot?{credential_slot:credentialSlot,credential_fingerprint:fingerprint}:{})};
      ledger.attempts.push(attempt); return attempt;
    });
    if (reservation) return reservation;
    if(incrementalLedger&&dual&&incrementalLedger.spare(credentialSlot,availableSlots||[]))throw Error('credential_busy_other_available');
    await delay(350+Math.floor(Math.random()*150));
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
  const gate=createRequestGate(config.gateKey ? {...config,key:config.gateKey} : config);
  const routeGate=config.gateKey && config.gateKey!==config.key ? createRequestGate(config) : gate;
  const latestStart=Math.min(deadline-timeoutMs-10000,config.failoverAvailable?Date.now()+90000:Infinity);
  if(config.rpm!==undefined)await gate.setRateLimit(config.rpm);
  const attempt=await reserve(experiment,body,config.model,latestStart,config.credentialSlot,config.dual,config.credentialCount,digest(config.key),config.availableSlots);
  const started=Date.now(); let receipt,http,gateWaitMs,httpStartedAt=null;
  try {
    gateWaitMs=Math.max(0,(await gate.admit({deadline:latestStart}))-started);
    httpStartedAt=new Date().toISOString();
    if(incrementalLedger)await incrementalLedger.update(attempt.id,{http_request_started_at:httpStartedAt});
    else await withLedger(ledger=>{
      ledger.attempts.find(entry=>entry.id===attempt.id).http_request_started_at=httpStartedAt;
    });
    const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.key}`},body:JSON.stringify(body),...(config.formal?{redirect:'error'}:{}),signal:AbortSignal.timeout(timeoutMs)});
    if (!response.ok) { http=await httpError(response,config.key);if(response.status===429&&http.retryable){
      const cap=/Limit type:\s*(max_parallel_requests|rpm_limit)\.\s*Current limit:\s*(\d+)/i.exec(http.message||'');
      if(cap&&incrementalLedger)await incrementalLedger.providerLimit(config.credentialSlot,digest(config.key),
        cap[1].toLowerCase()==='max_parallel_requests'?'max_concurrent':'rpm',Number(cap[2]));
      else if(cap)await withLedger(ledger=>{
        const policy=ledger.credential_policy,limit=Number(cap[2]);
        if(!policy||!Number.isSafeInteger(limit)||limit<1||policy.fingerprints?.[config.credentialSlot]&&policy.fingerprints[config.credentialSlot]!==digest(config.key))return null;
        const field=cap[1].toLowerCase()==='max_parallel_requests'?'max_concurrent':'rpm';
        policy[field][config.credentialSlot]=Math.min(policy[field][config.credentialSlot],limit);
        (policy.observed_provider_limits??={})[config.credentialSlot]={...(policy.observed_provider_limits[config.credentialSlot]||{}),[field]:limit,observed_at:new Date().toISOString()};
      });
      await routeGate.cooldown(http.retry_after_seconds??60);
    }throw new Error(`model_http_${response.status}`); }
    const result=await readModelResponse(response);
    const content=result.choices?.[0]?.message?.content;
    if (typeof content!=='string') throw new Error('model_missing_content');
    receipt={attempt_id:attempt.id,status:'success',requested_model:config.model,provider_response_model:result.model||null,content,...(typeof result.choices?.[0]?.message?.reasoning_content==='string'?{reasoning_content:result.choices[0].message.reasoning_content}:{}),...(result.stream_metadata?{stream_metadata:result.stream_metadata}:{}),usage:result.usage||null,finish_reason:result.choices?.[0]?.finish_reason||null,request_settings:{temperature:body.temperature,max_tokens:body.max_tokens,...config.parameters,...(body.stream?{stream:true}:{})},rate_limit_headers:rateLimitHeaders(response),request_gate_wait_ms:gateWaitMs,http_request_started_at:httpStartedAt,duration_ms:Date.now()-started};
    return receipt;
  } catch(e) {
    const code=/^model_http_\d+$/.test(e.message)||e.message==='model_missing_content'||e.message?.startsWith('request_gate_')?e.message:e.name==='TimeoutError'?'model_timeout':'model_transport_error';
    const transportRetryable = Boolean(httpStartedAt && !http && !e.streamError &&
      (code === 'model_timeout' ||
       (code === 'model_transport_error' &&
        (e instanceof TypeError || ['terminated', 'model_stream_incomplete'].includes(e.streamDiagnostic?.reason)))));
    if(e.streamError)http=await httpError({status:200,json:async()=>({error:e.streamError})},config.key);
    receipt={attempt_id:attempt.id,status:'failed',requested_model:config.model,error:code,...(http?{http_error:http}:{}),...(transportRetryable?{transport_retryable:true}:{}),...(['model_transport_error','model_timeout'].includes(code)?{transport_diagnostic:{name:e.name,message:String(e.message).replaceAll(config.key,'[REDACTED]').slice(0,180),cause_code:e.cause?.code??null}}:{}),...(e.partialResponse?{partial_response:e.partialResponse,stream_diagnostic:e.streamDiagnostic}:{}),request_settings:{temperature:body.temperature,max_tokens:body.max_tokens,...config.parameters,...(body.stream?{stream:true}:{})},request_gate_wait_ms:gateWaitMs??Date.now()-started,http_request_started_at:httpStartedAt,duration_ms:Date.now()-started};
    const error=new Error(code); error.receipt=receipt; throw error;
  } finally {
    const settlement={status:receipt?.status||'failed',completed_at:new Date().toISOString(),duration_ms:Date.now()-started,usage:receipt?.usage||null,rate_limit_headers:receipt?.rate_limit_headers||http?.rate_limit_headers||{},provider_response_model:receipt?.provider_response_model||null,request_gate_wait_ms:receipt?.request_gate_wait_ms??null,http_request_started_at:receipt?.http_request_started_at??null,...(receipt?.error?{error:receipt.error}:{}),...(http?{http_error:http}:{})};
    if(incrementalLedger){
      try{await incrementalLedger.update(attempt.id,settlement,receipt);}
      catch(cause){
        const error=Error('ledger_settlement_pending',{cause});
        if(receipt)error.receipt={...receipt,ledger_settlement_pending:true};
        throw error;
      }
      try{await incrementalLedger.published();}
      catch(error){if(receipt)receipt.ledger_snapshot_pending=true;else throw error;}
    }
    else await withLedger(ledger=>{
      const entry=ledger.attempts.find(x=>x.id===attempt.id);
      Object.assign(entry,{status:receipt?.status||'failed',completed_at:new Date().toISOString(),duration_ms:Date.now()-started,usage:receipt?.usage||null,rate_limit_headers:receipt?.rate_limit_headers||http?.rate_limit_headers||{},provider_response_model:receipt?.provider_response_model||null,request_gate_wait_ms:receipt?.request_gate_wait_ms??null,http_request_started_at:receipt?.http_request_started_at??null,...(receipt?.error?{error:receipt.error}:{}),...(http?{http_error:http}:{})});
    });
  }
}

let nextSlot = process.pid;

function knownRejectedSlots(slots, kind) {
  if(incrementalLedger)return incrementalLedger.rejected(slots.map(slot=>({fingerprint:digest(slot.key),replacesCredential:slot.replacesCredential})),kind);
  const rejected=kind==='budget'?a=>a.http_error?.type==='budget_exceeded'&&a.http_error.retryable===false:a=>[401,403].includes(a.http_error?.status);
  const attempts = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')).attempts : [];
  const unavailable = new Set();
  slots.forEach((_, index) => {
    const slot = CREDENTIAL_NAMES[index],fingerprint=digest(slots[index].key);
    const rows = attempts.filter(a => (a.credential_slot || 'primary') === slot
      && (a.credential_fingerprint ? a.credential_fingerprint===fingerprint : !slots[index].replacesCredential));
    const rejection = rows.filter(rejected)
      .reduce((latest, a) => a.completed_at > latest ? a.completed_at : latest, '');
    if (rejection && !rows.some(a => a.status === 'success' && a.http_request_started_at > rejection)) unavailable.add(index);
  });
  return unavailable;
}

export async function callModel(request, options={}) {
  if (!Array.isArray(request?.messages) || request.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')) throw new Error('invalid_messages');
  // Keep 200 seconds for shared queue/backoff plus HTTP and accounting; the default fits 300-second callers.
  const deadline=Date.now()+modelTimeoutMs()+210000,base=loadModelConfig(),frozen=structuredClone(request),failures=[];
  const slots = base.formal ? [...base.slots].reverse() : base.slots;
  const budget = base.formal ? knownRejectedSlots(slots,'budget') : new Set();
  const invalid = base.formal ? knownRejectedSlots(slots,'auth') : new Set();
  const known = new Set([...budget,...invalid]);
  const probing = process.env.WATERFALL_APPROVED_QUOTA_PROBE === '1';
  const exhausted = probing ? new Set() : known;
  if (exhausted.size === slots.length) {
    const error = Error(invalid.size?'approved_routes_unavailable':'approved_routes_budget_exhausted');
    error.receipt = {status:'failed',error:error.message,requested_model:base.model,
      http_error:{status:invalid.size?401:429,type:invalid.size?'authentication_error':'budget_exceeded',retryable:false},http_request_started_at:null};
    throw error;
  }
  const forcedTarget = process.env.WATERFALL_PROBE_CREDENTIAL_SLOT;
  if(forcedTarget&&(!probing||!CREDENTIAL_NAMES.slice(0,slots.length).includes(forcedTarget)))throw Error('invalid_credential_probe_target');
  const dual = base.formal && slots.length>=2 && existsSync(DUAL_APPROVED_ROUTES);
  const useSharedGate = !dual && base.formal && slots.length===2 && process.env.WATERFALL_PREFER_SECOND_APPROVED_KEY==='1';
  let slotIndex = forcedTarget ? CREDENTIAL_NAMES.indexOf(forcedTarget) : probing && known.size ? [...known][0] : dual ? nextSlot%slots.length : useSharedGate ? 1 : 0;
  while (exhausted.has(slotIndex)) slotIndex = (slotIndex+1)%slots.length;
  if(incrementalLedger&&dual&&!forcedTarget&&!probing)slotIndex=CREDENTIAL_NAMES.indexOf(incrementalLedger.pick(CREDENTIAL_NAMES.slice(0,slots.length).filter((_,i)=>!exhausted.has(i)),CREDENTIAL_NAMES[slotIndex]));
  if (dual) nextSlot = (slotIndex+1)%slots.length;
  const tried = new Set();
  let retriedTransport = false;
  if(options.thinkingMode!==undefined){
    if(!['enabled','disabled'].includes(options.thinkingMode))throw Error('invalid_thinking_mode');
    base.parameters={...base.parameters,enable_thinking:options.thinkingMode==='enabled',thinking:{type:options.thinkingMode},extra_body:{thinking:{type:options.thinkingMode}}};
  }
  for(let index=0;index<3;index++) {
    const slot=slots[slotIndex];tried.add(slotIndex);
    const policy=incrementalLedger?incrementalLedger.settings().credential_policy:existsSync(LEDGER)?JSON.parse(readFileSync(LEDGER,'utf8')).credential_policy:null;
    const rpm=policy?.rpm?.[CREDENTIAL_NAMES[slotIndex]];
    const config={...base,...slot,dual,failoverAvailable:slots.some((_, i) => i !== slotIndex && !exhausted.has(i)),
      availableSlots:CREDENTIAL_NAMES.slice(0,slots.length).filter((_,i)=>!exhausted.has(i)),
      credentialCount:slots.length,...(rpm!==undefined?{rpm}:{}),
      ...(base.formal?{credentialSlot:CREDENTIAL_NAMES[slotIndex]}:{}),
      ...(useSharedGate?{gateKey:slots[0].key}:{})};
    try {
      const receipt=await callOnce(frozen,options,config,deadline);
      if(failures.length)receipt.service_attempts=failures;
      return receipt;
    } catch(error) {
      if(!error.receipt&&['request_gate_call_deadline_exceeded','credential_busy_other_available'].includes(error.message))error.receipt={status:'failed',error:error.message,requested_model:config.model,http_request_started_at:null};
      const receipt=error.receipt;
      if(receipt?.ledger_settlement_pending)throw error;
      if(receipt?.error==='credential_busy_other_available'&&incrementalLedger&&Date.now()<deadline-modelTimeoutMs()-10000){
        slotIndex=CREDENTIAL_NAMES.indexOf(incrementalLedger.pick(CREDENTIAL_NAMES.slice(0,slots.length).filter((_,i)=>!exhausted.has(i)),CREDENTIAL_NAMES[slotIndex]));
        await delay(25);index--;continue;
      }
      const throttled=receipt?.error==='model_http_429'&&receipt.http_error?.retryable===true&&receipt.http_error.type==='throttling_error';
      const quota=receipt?.error==='model_http_429'&&receipt.http_error?.retryable===false;
      const authentication=['model_http_401','model_http_403'].includes(receipt?.error);
      if (receipt?.transport_retryable && !retriedTransport) {
        retriedTransport = true;
        failures.push(structuredClone(receipt));
        await delay(750);
        index--;
        continue;
      }
      if (receipt?.transport_retryable) receipt.transport_retry_exhausted = true;
      if (quota||authentication) exhausted.add(slotIndex);
      if(forcedTarget)throw error;
      let alternative = slots.findIndex((_, i) => i !== slotIndex && !exhausted.has(i) && !tried.has(i));
      if(alternative<0)alternative=slots.findIndex((_, i) => i !== slotIndex && !exhausted.has(i));
      const queued = ['request_gate_call_deadline_exceeded','credential_busy_other_available'].includes(receipt?.error) && receipt.http_request_started_at===null;
      if (queued && alternative>=0 && index<2 && Date.now()<deadline-modelTimeoutMs()-10000) {
        failures.push(structuredClone(receipt));
        slotIndex=alternative;
        continue;
      }
      if ((!throttled && !((quota||authentication) && alternative >= 0)) || index === 2) {
        if(receipt&&failures.length)receipt.service_attempts=failures;
        if(throttled||quota||error.message==='request_gate_call_deadline_exceeded')receipt.service_retry_exhausted=true;
        throw error;
      }
      failures.push(structuredClone(receipt));
      if (alternative >= 0) slotIndex = alternative;
    }
  }
}
