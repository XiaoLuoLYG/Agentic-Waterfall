import {readFileSync, writeFileSync, appendFileSync, existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {runEpisode} from '../../../../demos/agentic-feed/waterfall-core.mjs';
import {callModel} from '../../shared/model-client.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{input:{type:'string',default:resolve(root,'data/model-subset/public-inputs.jsonl')},output:{type:'string',default:resolve(root,'results/waterfall-subset.jsonl')},fixture:{type:'boolean',default:false}}});
const inputs=readFileSync(values.input,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
if(!inputs.length)throw new Error('no_input_samples');
if(existsSync(values.output+'.states.json'))throw new Error('state_output_already_exists');
inputs.sort((a,b)=>Date.parse(a.observation.observed_at)-Date.parse(b.observation.observed_at)||a.observation.decision_id.localeCompare(b.observation.decision_id));
writeFileSync(values.output,'',{flag:'wx'});const states=new Map();let failed=0;
for(const input of inputs){
 const user=input.observation.user_id;
 if(states.has(user))input.observation.user_state=structuredClone(states.get(user));
 let result;
 try{
  const decide=values.fixture?async obs=>({decision_id:obs.decision_id,actions:[{action_id:'synthetic-submit',kind:'recommend',arguments:{ordered_item_ids:obs.environment.candidate_pool.slice(0,obs.environment.recommendation_constraints.require_full_ranking?undefined:obs.environment.recommendation_constraints.top_k).map(x=>x.id),delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]}):undefined;
  result=await runEpisode(input,{experiment:'kuairand',variant:'full',decide,modelCall:callModel});
 }catch(e){result={decision_id:input.observation.decision_id,status:'failed',error:e.message};}
 if(result.state_after)states.set(user,result.state_after);
 appendFileSync(values.output,JSON.stringify(result)+'\n');
 console.log(JSON.stringify({decision_id:result.decision_id,status:result.status,error:result.error,model_requests:result.model_request_count}));
 if(result.status!=='submitted')failed++;
}
writeFileSync(values.output+'.states.json',JSON.stringify(Object.fromEntries(states),null,2),{flag:'wx'});
console.log(JSON.stringify({n:inputs.length,failed,kind:values.fixture?'smoke':'subset',synthetic:values.fixture}));
if(failed)process.exitCode=2;
