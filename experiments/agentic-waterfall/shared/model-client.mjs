import { readFileSync, writeFileSync, mkdirSync, renameSync, rmdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = resolve(ROOT, 'shared/model-ledger.json');
const LOCK = `${LEDGER}.lock`;
const CONFIG = resolve(ROOT, '../../HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json');
export const digest = data => createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
export function modelTimeoutMs(model) {
  const value=Number(process.env.WATERFALL_MODEL_TIMEOUT_MS || 60000);
  if(!Number.isSafeInteger(value)||value<1000||value>(model==='GLM-5.3-Flash'?600000:180000))throw new Error('invalid_model_timeout');
  return value;
}

export function loadModelConfig() {
  const file = JSON.parse(readFileSync(process.env.MODEL_CONFIG_FILE || process.env.XUANJI_CONFIG_FILE || CONFIG, 'utf8'));
  const key = process.env.OPENAI_API_KEY || file.apiKey;
  const model = process.env.OPENAI_MODEL || file.recommendationModelName || file.modelName;
  const endpoint = new URL(process.env.OPENAI_BASE_URL || file.apiBase);
  if (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)) throw new Error('unsafe_model_endpoint');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !key || !model) throw new Error('invalid_model_config');
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  if (!endpoint.pathname.endsWith('/chat/completions')) endpoint.pathname += '/chat/completions';
  const parameters = model === 'GLM-5.3-Flash'
    ? {thinking:{type:'enabled'},reasoning_effort:'low',stream:true,stream_options:{include_usage:true}}
    : file.recommendationModelName ? {enable_thinking:false,thinking:{type:'disabled'},extra_body:{thinking:{type:'disabled'}}} : {};
  return {key, model, endpoint: endpoint.href, parameters};
}

export async function readModelResponse(response) {
  if(!response.headers?.get('content-type')?.includes('text/event-stream'))return response.json();
  const result={model:null,choices:[{message:{content:''},finish_reason:null}],usage:null};
  const decoder=new TextDecoder();let buffer='',data=[],done=false;
  try {
    for await(const bytes of response.body){
      buffer+=decoder.decode(bytes,{stream:true});let end;
      while((end=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,end).replace(/\r$/,'');buffer=buffer.slice(end+1);
        if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
        else if(!line&&data.length){
          const value=data.join('\n');data=[];
          if(value==='[DONE]'){done=true;break;}
          let event;
          try{event=JSON.parse(value);}catch{throw Error('model_stream_invalid');}
          if(event.error){const status=event.error.status_code??event.error.code;throw Error(/^[45]\d\d$/.test(String(status))?`model_http_${status}`:'model_stream_error');}
          if(event.model)result.model=event.model;
          if(event.usage)result.usage=event.usage;
          const choice=event.choices?.find(x=>x.index===0);
          if(typeof choice?.delta?.content==='string')result.choices[0].message.content+=choice.delta.content;
          if(choice?.finish_reason)result.choices[0].finish_reason=choice.finish_reason;
        }
      }
      if(done)break;
    }
    if(!done||!result.choices[0].finish_reason)throw Error('model_stream_incomplete');
    return result;
  }catch(error){error.model_response=result;throw error;}
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

async function reserve(experiment, request, model) {
  if (!/^[a-z0-9-]+$/.test(experiment)) throw new Error('invalid_experiment');
  const start=Date.now();
  while (true) {
    const reservation=await withLedger(ledger => {
      const controlPath=resolve(ROOT,experiment==='controller'?'shared/CONTROL.json':`${experiment}/CONTROL.json`);
      const control=JSON.parse(readFileSync(controlPath,'utf8'));
      if (control.model_calls_enabled === false) throw new Error('model_calls_not_enabled');
      if (!Number.isSafeInteger(ledger.limit) || ledger.limit < 1) throw new Error('invalid_global_request_limit');
      if (ledger.attempts.length >= ledger.limit) throw new Error('global_request_budget_exhausted');
      if (ledger.attempts.filter(x=>x.experiment===experiment).length >= (control.model_request_limit || 0)) throw new Error('experiment_request_budget_exhausted');
      // A stale reservation is never silently recycled: its actual outcome must be audited.
      if (ledger.attempts.filter(x=>x.status==='in_progress').length >= 2) return null;
      const attempt={id:randomUUID(),experiment,model,request_sha256:digest(request),started_at:new Date().toISOString(),pid:process.pid,status:'in_progress'};
      ledger.attempts.push(attempt); return attempt;
    });
    if (reservation) return reservation;
    if (Date.now()-start>65000) throw new Error('model_slots_busy');
    await delay(250);
  }
}

export async function callModel(request, {experiment}={}) {
  if (!Array.isArray(request?.messages) || request.messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')) throw new Error('invalid_messages');
  const config=loadModelConfig(),timeoutMs=modelTimeoutMs(config.model);
  const body={model:config.model,messages:request.messages,temperature:request.temperature??0.3,max_tokens:request.max_tokens??4096,...config.parameters,...(request.response_format?{response_format:request.response_format}:{})};
  if (!Number.isInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>(config.model==='GLM-5.3-Flash'?32768:8192)) throw new Error('invalid_max_tokens');
  const attempt=await reserve(experiment,body,config.model);
  const started=Date.now(); let receipt;
  try {
    const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.key}`},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
    if (!response.ok) throw new Error(`model_http_${response.status}`);
    const result=await readModelResponse(response);
    const content=result.choices?.[0]?.message?.content;
    if (typeof content!=='string') throw new Error('model_missing_content');
    receipt={attempt_id:attempt.id,status:'success',requested_model:config.model,provider_response_model:result.model||null,content,usage:result.usage||null,finish_reason:result.choices?.[0]?.finish_reason||null,request_settings:{temperature:body.temperature,max_tokens:body.max_tokens,...config.parameters},duration_ms:Date.now()-started};
    return receipt;
  } catch(e) {
    const code=/^model_http_\d+$/.test(e.message)||e.message==='model_missing_content'||e.message.startsWith('model_stream_')?e.message:e.name==='TimeoutError'?'model_timeout':'model_transport_error';
    receipt={attempt_id:attempt.id,status:'failed',error:code,duration_ms:Date.now()-started,...(e.model_response?{partial_response:e.model_response,usage:e.model_response.usage,provider_response_model:e.model_response.model}:{})};
    const error=new Error(code); error.receipt=receipt; throw error;
  } finally {
    await withLedger(ledger=>{
      const entry=ledger.attempts.find(x=>x.id===attempt.id);
      Object.assign(entry,{status:receipt?.status||'failed',completed_at:new Date().toISOString(),duration_ms:Date.now()-started,usage:receipt?.usage||null,provider_response_model:receipt?.provider_response_model||null,...(receipt?.error?{error:receipt.error}:{})});
    });
  }
}
