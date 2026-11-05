import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {callModel as live} from '../kuairand-window512-20261103/client.mjs';
import {openLedger} from './ledger-store.mjs';

const load=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const model='DeepSeek-V4.1-Flash-1017';
const folder=process.env.WATERFALL_QUOTA_PRIOR;
const trace=process.env.WATERFALL_QUOTA_REPLAY_LOG;
const nativeFile=process.env.WATERFALL_QUOTA_NATIVE;
const ledgerRecovery=process.env.WATERFALL_LEDGER_REPLAY==='1';
const cache=new Map();
const prefix=[];
if(nativeFile){
  const file=new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-ledger.json',import.meta.url);
  const incremental=openLedger(file.pathname);
  const byId=incremental?{get:id=>incremental.attempt(id)}:new Map(load(file).attempts.map(x=>[x.id,x]));
  for(const receipt of load(nativeFile).result.model_calls){
    if(!receipt.attempt_id){
      if(ledgerRecovery)break;
      continue;
    }
    const recorded=byId.get(receipt.attempt_id);
    assert(recorded && Array.isArray(receipt.messages),'invalid native replay evidence');
    assert(recorded.status===receipt.status,'native receipt status mismatch');
    if(receipt.status==='success')assert.equal(receipt.provider_response_model,model);
    else if(!ledgerRecovery)assert.equal(receipt.error,'model_http_429');
    prefix.push({receipt,requestHash:recorded.request_sha256});
    if(receipt.status!=='success')break;
  }
  if(!ledgerRecovery)assert(prefix.length && prefix.at(-1).receipt.status==='failed','quota boundary missing');
}else if(folder){
  for(const name of readdirSync(folder).filter(x=>x.endsWith('.request.json')).sort()){
    const response=join(folder,name.replace('.request.json','.response.json'));
    if(!existsSync(response))continue;
    const receipt=load(response);
    if(receipt.status!=='success'||receipt.provider_response_model!==model)continue;
    cache.set(JSON.stringify(load(join(folder,name))),receipt);
  }
}
let halted=false, cursor=0;
const log=event=>appendFileSync(trace,JSON.stringify(event)+'\n');
function restoreToolClock(messages, expected){
  const index=messages.findIndex(message=>message.role==='user');
  const actual=JSON.parse(messages[index].content);
  const old=JSON.parse(expected[index].content);
  const tools=actual.observation.environment.tool_results;
  const saved=old.observation.environment.tool_results;
  if(!Array.isArray(tools)||!Array.isArray(saved)||tools.length!==saved.length)return;
  const byId=new Map(tools.map(receipt=>[receipt.action_id,receipt]));
  const ordered=saved.map(receipt=>byId.get(receipt.action_id));
  if(byId.size!==tools.length||new Set(ordered).size!==ordered.length||
    ordered.some((receipt,i)=>!receipt||receipt.kind!==saved[i].kind))return;
  for(const [i,receipt] of ordered.entries()){
    for(const field of ['started_at','completed_at']){
      if(Object.hasOwn(receipt,field)&&Object.hasOwn(saved[i],field))receipt[field]=saved[i][field];
    }
    const actualEvidence=receipt.result?.evidence, savedEvidence=saved[i].result?.evidence;
    if(!Array.isArray(actualEvidence)||!Array.isArray(savedEvidence)||actualEvidence.length!==savedEvidence.length)continue;
    for(const [j,entry] of actualEvidence.entries()){
      if(Object.hasOwn(entry,'elapsed_seconds')&&Object.hasOwn(savedEvidence[j],'elapsed_seconds')){
        entry.elapsed_seconds=savedEvidence[j].elapsed_seconds;
      }
    }
  }
  actual.observation.environment.tool_results=ordered;
  messages[index]={...messages[index],content:JSON.stringify(actual)};
}


export async function callModel(request,options){
  if(halted)throw Error('quota_exact_replay_already_halted');
  const saved=prefix[cursor];
  if(saved){
    const aligned=structuredClone(request);
    const thinking=options.thinkingMode ?? 'disabled';
    const body={model,messages:aligned.messages,temperature:aligned.temperature??0.3,max_tokens:aligned.max_tokens??4096,
      enable_thinking:thinking==='enabled',thinking:{type:thinking},extra_body:{thinking:{type:thinking}},
      ...(aligned.response_format?{response_format:aligned.response_format}:{}),
      ...(aligned.stream===true?{stream:true,stream_options:{include_usage:true}}:{})};
    if(hash(body)!==saved.requestHash){
      try{restoreToolClock(aligned.messages,saved.receipt.messages);}catch{}
    }
    const actual=hash(body);
    if(actual!==saved.requestHash){
      halted=true;
      const paths=[];
      function diff(left,right,path){
        if(paths.length>=18||JSON.stringify(left)===JSON.stringify(right))return;
        if(left&&right&&typeof left==='object'&&typeof right==='object'){
          for(const key of new Set([...Object.keys(left),...Object.keys(right)]))diff(left[key],right[key],path+'/'+key);
        }else paths.push(path);
      }
      if(process.env.WATERFALL_QUOTA_REPLAY_OFFLINE==='1'){
        for(const [i,m] of aligned.messages.entries()){
          const old=saved.receipt.messages[i];
          try{diff(JSON.parse(m.content),JSON.parse(old.content),'/messages/'+i);}
          catch{diff(m,old,'/messages/'+i);}
        }
      }
      log({kind:'exact_request_mismatch',expected:saved.requestHash,actual,paths});
      throw Error('quota_exact_replay_request_mismatch');
    }
    cursor++;
    if(saved.receipt.status==='success'){
      log({kind:'cached_success_replayed',sha256:actual,attempt_id:saved.receipt.attempt_id});
      const keys=['attempt_id','status','requested_model','provider_response_model','content','reasoning_content',
                  'stream_metadata','usage','finish_reason','request_settings','rate_limit_headers','request_gate_wait_ms',
                  'http_request_started_at','duration_ms','service_attempts'];
      return {...Object.fromEntries(keys.filter(k=>Object.hasOwn(saved.receipt,k)).map(k=>[k,saved.receipt[k]])),messages:aligned.messages};
    }
    log({kind:'exact_unanswered_boundary_reached',sha256:actual});
    request=aligned;
  }else{
    const key=JSON.stringify(request);
    const cached=cache.get(key);
    if(cached){
      cache.delete(key);
      log({kind:'cached_success_replayed',sha256:hash(request),attempt_id:cached.attempt_id});
      return cached;
    }
  }
  if(process.env.WATERFALL_QUOTA_REPLAY_OFFLINE==='1'){
    halted=true;
    throw Error('quota_offline_unanswered_boundary');
  }
  try {
    const receipt=await live(request,options);
    return nativeFile?{...receipt,messages:request.messages}:receipt;
  } catch(error) {
    if(nativeFile&&error.receipt)error.receipt={...error.receipt,messages:request.messages};
    throw error;
  }
}
