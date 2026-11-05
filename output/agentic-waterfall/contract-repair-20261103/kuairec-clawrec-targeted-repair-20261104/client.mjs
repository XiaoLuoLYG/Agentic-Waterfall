import assert from 'node:assert/strict';
import {appendFileSync,existsSync,readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {callModel as live} from '../full-agentrecbench-20261103/frozen/client.mjs';

const read=p=>JSON.parse(readFileSync(p,'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const caches=new Map();
const sources=JSON.parse(process.env.KREC_REPAIR_PRIORS??'[]');
const allowed=JSON.parse(process.env.KREC_REPAIR_ALLOWED??'{}');
const log=entry=>{
  if(process.env.KREC_REPAIR_LOG)appendFileSync(process.env.KREC_REPAIR_LOG,JSON.stringify(entry)+'\n');
};
for(const directory of sources){
  const found=new Map();
  for(const filename of readdirSync(directory).filter(x=>x.endsWith('.request.json')).sort()){
    const request=read(join(directory,filename));
    const response=join(directory,filename.replace('.request.json','.response.json'));
    const error=join(directory,filename.replace('.request.json','.error.json'));
    if(!existsSync(response)&&!existsSync(error))continue;
    const receipt=read(existsSync(response)?response:error);
    if(receipt.status==='success')assert.equal(receipt.provider_response_model,'DeepSeek-V4.1-Flash-1017');
    const key=JSON.stringify(request);
    if(!found.has(key))found.set(key,[]);
    found.get(key).push(receipt);
  }
  for(const [key,receipts] of found)if(!caches.has(key))caches.set(key,receipts);
}

export async function callModel(request,options){
  assert.equal(options.experiment,'method-deployment');
  const key=JSON.stringify(request),digest=hash(request),saved=caches.get(key)?.shift();
  if(saved?.status==='success'||(saved&&process.env.KREC_REPAIR_BASELINE==='1')){
    log({origin:'exact_cache',request_sha256:digest,attempt_id:saved.attempt_id??null,error:saved.error??null});
    if(saved.status!=='success'){const error=Error(saved.error);error.receipt=saved;throw error;}
    return saved;
  }
  const content=request.messages.at(-1).content;
  const payload=JSON.parse(content.slice(content.lastIndexOf('INPUT:')+6).trim());
  const stage=payload.task_id?'search-worker':payload.plan_md&&payload.items?'curate':payload.prior_state?'state':'plan';
  if(sources.length){
    assert(stage==='curate'&&allowed.curate||stage==='search-worker'&&allowed.workers?.includes(payload.task_id),
      'exact_replay_miss_for_unaffected_step');
  }
  log({origin:'repair_boundary',stage,task_id:payload.task_id??null,request_sha256:digest});
  if(process.env.KREC_REPAIR_OFFLINE==='1')throw Error('offline_repair_boundary');
  for(let retry=0;;retry++){
    try{
      const receipt=await live(request,options);
      assert.equal(receipt.provider_response_model,'DeepSeek-V4.1-Flash-1017');
      log({origin:'live',stage,task_id:payload.task_id??null,request_sha256:digest,attempt_id:receipt.attempt_id});
      return receipt;
    }catch(error){
      const pending=error.message==='request_gate_call_deadline_exceeded'&&!error.receipt?.http_request_started_at;
      if(!pending||retry===2)throw error;
      log({origin:'scheduling_retry',stage,request_sha256:digest,retry:retry+1});
    }
  }
}
