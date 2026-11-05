import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';import {callModel} from '../../../experiments/agentic-waterfall/shared/model-client.mjs';import {toMindInput} from '../clawrec/mind_input.mjs';import {runSequence} from './sequence.mjs';
import {loadDomain,buildRequest,parseResponse} from './prompts.mjs';
const [input,outPath]=process.argv.slice(2);if(!input||!outPath)throw Error('usage: sequence_live.mjs public-input.jsonl output-dir');
const domain=loadDomain(process.env.MARS_DOMAIN_FILE);
const rows=readFileSync(input,'utf8').split('\n').filter(Boolean);const sample=JSON.parse(rows[0]);const {history}=toMindInput(sample);const events=history.map(x=>({id:x.id,type:'click',text:[x.title,x.text].filter(Boolean).join('\n')}));
const out=resolve(outPath);mkdirSync(out,{recursive:false});let calls=0;
async function model(stage,payload){
 if(calls>=10)throw Error('diagnostic request budget exhausted');
 const n=String(++calls).padStart(2,'0');const request=buildRequest(stage,payload);writeFileSync(resolve(out,`${n}-${stage}.request.json`),JSON.stringify(request,null,2)+'\n',{flag:'wx'});
 try{const receipt=await callModel(request,{experiment:'method-deployment'});writeFileSync(resolve(out,`${n}-${stage}.response.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});if(receipt.finish_reason==='length')throw Error('truncated response');return parseResponse(stage,receipt.content);}catch(e){writeFileSync(resolve(out,`${n}-${stage}.error.json`),JSON.stringify(e.receipt||{error:e.message},null,2)+'\n',{flag:'wx'});throw e;}
}
try{const result=await runSequence(sample.observation.user_id,events,model,domain);writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'submitted',kind:'public-history-state-diagnostic',author_implementation:false,complete_original_method:false,case_id:sample.observation.decision_id,model_requests:calls,...result},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'submitted',rounds:result.states.length,model_requests:calls}));}catch(e){writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'failed',case_id:sample.observation.decision_id,model_requests:calls,error:e.message},null,2)+'\n',{flag:'wx'});throw e;}
