import {readFileSync,writeFileSync,renameSync,existsSync,openSync,readSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';
import {callModel} from '../shared/model-client.mjs';
import {buildFormalAdapter} from './formal-adapters.mjs';
import {prepareHistory} from './formal-history.mjs';

export function serial(fn,stopOnError=false){
  let tail=Promise.resolve(),failure;
  return (...args)=>{const result=tail.then(()=>{if(failure)throw Error(failure.message);return fn(...args);});tail=result.catch(error=>{if(stopOnError)failure=error;});return result;};
}
export function readInput(task){
  if(task.input_offset===undefined)return JSON.parse(readFileSync(task.input_path,'utf8'));
  const fd=openSync(task.input_path,'r'),buffer=Buffer.alloc(task.input_bytes);
  try{if(readSync(fd,buffer,0,buffer.length,task.input_offset)!==buffer.length)throw Error('input_slice_truncated');return JSON.parse(buffer.toString('utf8'));}finally{closeSync(fd);}
}
export function pythonJSON(python,script,request){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(python,[script],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('acquire_adapter_timeout'));},30000);
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error(`acquire_exit_${code}: ${stderr.slice(-2000)}`));try{resolvePromise(JSON.parse(stdout));}catch(error){reject(error);}});
    child.stdin.end(JSON.stringify(request));
  });
}

async function main(){
  const [taskPath,output,priorPath]=process.argv.slice(2);
  if(!taskPath||!output)throw Error('task_path and output required');
  if(existsSync(output))throw Error('result_already_exists');
  const task=JSON.parse(readFileSync(taskPath,'utf8'));
  const prior=priorPath?JSON.parse(readFileSync(priorPath,'utf8')):null;
  let input,acquire,toolCalls=[];
  if(['agentrecbench','clawrec'].includes(task.dataset)){
    ({input,acquire,toolCalls}=await buildFormalAdapter(task,prior));
  }else{
    input=readInput(task);
    if(task.dataset==='kuairand'&&prior){
      if(prior.task.id!==task.previous||prior.task.dataset!=='kuairand'||prior.input.observation.user_id!==input.observation.user_id||Date.parse(prior.input.observation.observed_at)>Date.parse(input.observation.observed_at)||!Number.isInteger(prior.result.state_after?.version)||!Array.isArray(prior.result.state_after?.records))throw Error('invalid_previous_user_state');
      input.observation.user_state=structuredClone(prior.result.state_after);
    }
    if(task.dataset==='kuairec')acquire=(args,context)=>pythonJSON(task.python,resolve(task.root,'experiments/agentic-waterfall/kuairec/scripts/acquire_cli.py'),{user_id:input.observation.user_id,arguments:args,exclude:context.observation.environment.candidate_pool.map(x=>x.id),remaining_acquired_items:context.observation.environment.budget.remaining_acquired_items});
  }
  // Keep the demo decision allowance; the frozen output budget also covers model reasoning.
  input.protocol={...input.protocol,max_model_calls:20,max_output_tokens:Number(process.env.WATERFALL_MAX_OUTPUT_TOKENS||8192)};
  const history=prepareHistory(input);input=history.input;
  const result=await runEpisode(input,{experiment:task.dataset,modelCall:serial(callModel,true),lookupHistory:history.lookupHistory,...(acquire?{acquire:serial(acquire)}:{})});
  const temporary=output+'.tmp';
  writeFileSync(temporary,JSON.stringify({task,input,result,tool_calls:toolCalls})+'\n',{flag:'wx'});renameSync(temporary,output);
  console.log(JSON.stringify({id:task.id,dataset:task.dataset,status:result.status,error:result.error,model_requests:result.model_request_count,duration_ms:result.duration_ms,peak_rss_bytes:process.resourceUsage().maxRSS*1024}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
