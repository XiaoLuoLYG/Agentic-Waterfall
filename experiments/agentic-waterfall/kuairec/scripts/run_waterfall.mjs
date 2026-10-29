import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {runEpisode} from '../../../../demos/agentic-feed/waterfall-core.mjs';
import {callModel} from '../../shared/model-client.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{tag:{type:'string',default:'dev4'},users:{type:'string'}}});
const selected=values.users?.split(',');
const inputs=readFileSync(resolve(root,'data/processed/waterfall-dev4.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(x=>!selected||selected.includes(x.observation.user_id));
const output=resolve(root,`results/waterfall-${values.tag}.jsonl`);
const predictions=resolve(root,`results/waterfall-${values.tag}-predictions.jsonl`);
writeFileSync(output,'',{flag:'wx'});writeFileSync(predictions,'',{flag:'wx'});
function acquireRequest(request){
  return new Promise((resolvePromise,reject)=>{
    const p=spawn(resolve(root,'.venv/bin/python'),[resolve(root,'scripts/acquire_cli.py')],{cwd:root});
    let stdout='',stderr='';
    const timeout=setTimeout(()=>{p.kill();reject(new Error('acquire_adapter_timeout'));},15000);
    p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);
    p.on('error',e=>{clearTimeout(timeout);reject(e);});
    p.on('exit',code=>{clearTimeout(timeout);if(code!==0){reject(new Error(`acquire_exit_${code}: ${stderr}`));return;}try{resolvePromise(JSON.parse(stdout));}catch(e){reject(e);}});
    p.stdin.end(JSON.stringify(request));
  });
}
let failed=0;
for(const input of inputs){
  const user=input.observation.user_id;
  const acquire=async(arguments_,context)=>{
    if(context.remaining_tool_calls<1)throw new Error('no_reserved_tool_request');
    const env=context.observation.environment;
    return acquireRequest({user_id:user,arguments:arguments_,exclude:env.candidate_pool.map(x=>x.id),remaining_acquired_items:env.budget.remaining_acquired_items});
  };
  const result=await runEpisode(input,{experiment:'kuairec',variant:'full',acquire,modelCall:callModel});
  appendFileSync(output,JSON.stringify({user_id:user,...result})+'\n');
  // Failed/partial outputs remain in the denominator; never repair using held-out labels.
  const row={user_id:Number(user),method:`${result.runtime_version}_bm25_backend`,status:result.status,acquisition_required:true,ordered_item_ids:result.ordered_item_ids,acquired_item_ids:result.candidate_pool_after.map(x=>x.id),model_requests:result.model_request_count,tool_calls:result.tool_calls,error:result.error,continuation_error:result.continuation_error};
  appendFileSync(predictions,JSON.stringify(row)+'\n');
  if(result.status==='failed')failed++;
  console.log(JSON.stringify({user_id:user,status:result.status,error:result.error,model_requests:result.model_request_count,tool_calls:result.tool_calls,acquired:result.acquired_items,recommended:result.ordered_item_ids.length}));
}
console.log(JSON.stringify({n_users:inputs.length,failed,kind:'subset',synthetic:false}));
if(failed)process.exitCode=2;
