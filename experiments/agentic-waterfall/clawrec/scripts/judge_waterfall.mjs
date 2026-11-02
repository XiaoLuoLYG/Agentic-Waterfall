import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {callModel} from '../../shared/model-client.mjs';

export function judgeLabels(pool,judged){
 const ids=new Set(pool.cards.map(card=>card.card_id)),labels={};
 if(judged.evaluation_id!==pool.evaluation_id||!Array.isArray(judged.card_relevance)||judged.card_relevance.length!==ids.size)throw Error('invalid_judge_output');
 for(const item of judged.card_relevance){if(!ids.has(item.card_id)||Object.hasOwn(labels,item.card_id)||!Number.isInteger(item.rel)||item.rel<1||item.rel>5)throw Error('invalid_judge_output');labels[item.card_id]=item.rel;}
 return labels;
}

export function judgeMessage(pool,event){
 const cards=pool.cards.map((card,index)=>({...card,rank:index+1}));
 return {evaluation_id:pool.evaluation_id,target_event_id:Number(event),k:20,candidate_card_count:cards.length,
  coverage_instruction:`Assess all ${cards.length} candidate_cards exactly once. Return ${cards.length} card_relevance entries. k=20 is only the downstream ranking metric cutoff, not a limit on cards to assess.`,
  visible_evidence:pool.visible_evidence,heldout_step:pool.heldout_step,candidate_cards:cards};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{pool:{type:'string'},prompt:{type:'string'},event:{type:'string'},receipt:{type:'string'},labels:{type:'string'}}});
 for(const key of ['pool','prompt','event','receipt','labels'])if(!values[key])throw Error(`--${key} required`);
 if(existsSync(values.receipt)||existsSync(values.labels))throw Error('output_already_exists');
 const pool=JSON.parse(readFileSync(values.pool,'utf8')),prompt=readFileSync(values.prompt,'utf8'),message=judgeMessage(pool,values.event);
 const receipt=await callModel({messages:[{role:'system',content:prompt+'\nCards are randomly ordered for independent relevance assessment; their ranks are anonymized indices, not recommendation ordering.'},{role:'user',content:JSON.stringify(message)}],temperature:0,max_tokens:8192,response_format:{type:'json_object'}},{experiment:'clawrec'});
 writeFileSync(values.receipt,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 const labels=judgeLabels(pool,JSON.parse(receipt.content));writeFileSync(values.labels,JSON.stringify(labels,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'success',cards:message.candidate_card_count,attempt_id:receipt.attempt_id}));
}
