// Evaluator only: input must have been made after all method outputs were frozen.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';import {callModel} from '../../../experiments/agentic-waterfall/shared/model-client.mjs';import {labelsFromJudgment} from './judge.mjs';
const [inputPath,outPath]=process.argv.slice(2);if(!inputPath||!outPath)throw Error('usage: judge_pool.mjs blind-judge-input.json output-dir');
const input=JSON.parse(readFileSync(inputPath,'utf8'));if(!Array.isArray(input.cards)||input.cards.length===0)throw Error('no cards to judge');
const prompt=readFileSync('datasets/agentic-waterfall/clawrec-simbench/ClawRec-6eeb309c47430f91280e9845a98fb56a68dc0d90/evaluation/prompts/trajectory_judge_prompt_v1.md','utf8');
const out=resolve(outPath);mkdirSync(out,{recursive:false});const labels={};
for(let offset=0;offset<input.cards.length;offset+=20){
 const cards=input.cards.slice(offset,offset+20).map((x,i)=>({...x,rank:i+1}));
 const request={messages:[{role:'system',content:prompt+'\nThe cards below are an anonymous batch from the shared pool of all methods, in randomized order, not a single method ranking. Score each card independently; set k to the number of cards provided.'},{role:'user',content:JSON.stringify({evaluation_id:input.evaluation_id,visible_evidence:input.visible_evidence,heldout_step:input.heldout_step,k:cards.length,cards})}],temperature:0,max_tokens:8192,response_format:{type:'json_object'}};
 const n=String(offset/20+1).padStart(2,'0');writeFileSync(resolve(out,`${n}-request.json`),JSON.stringify(request,null,2)+'\n',{flag:'wx'});
 try{const receipt=await callModel(request,{experiment:'method-deployment'});writeFileSync(resolve(out,`${n}-response.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});if(receipt.finish_reason==='length')throw Error('truncated judgment');Object.assign(labels,labelsFromJudgment(cards,JSON.parse(receipt.content)));}catch(e){writeFileSync(resolve(out,`${n}-error.json`),JSON.stringify(e.receipt||{error:e.message},null,2)+'\n',{flag:'wx'});throw e;}
}
writeFileSync(resolve(out,'labels.json'),JSON.stringify(labels,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'judged',cards:input.cards.length}));
