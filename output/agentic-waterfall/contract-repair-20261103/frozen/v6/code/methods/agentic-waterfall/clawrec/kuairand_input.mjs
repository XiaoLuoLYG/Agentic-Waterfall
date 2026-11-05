import {readFileSync} from 'node:fs';
export const kuaiRandFeedbackContract=JSON.parse(readFileSync(new URL('../i2agent/kuairand-feedback-contract.json',import.meta.url),'utf8'));

export function kuaiRandEvents(visible){
 return visible.history.map(x=>({id:x.id,type:'view',...Object.fromEntries(kuaiRandFeedbackContract.feedback_fields.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]])),
  occurred_at:x.occurred_at,available_at:x.available_at,
  text:[x.caption,x.metadata,'Observed feedback: '+JSON.stringify(Object.fromEntries(kuaiRandFeedbackContract.feedback_fields.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]])))].filter(Boolean).join('\n')}));
}

export function toKuaiRandInput(sample){
 const obs=sample?.observation;
 if(!obs||!Array.isArray(obs.dialogue)||obs.dialogue.length||!Array.isArray(obs.behavior_events)||!Array.isArray(obs.environment?.candidate_pool))throw Error('invalid public input');
 const cutoff=Date.parse(obs.observed_at);if(!Number.isFinite(cutoff))throw Error('invalid cutoff');
 const history=obs.behavior_events.map(e=>{
  const available=Date.parse(e.available_at);
  if(typeof e.item_id!=='string'||!Number.isFinite(available)||available>cutoff)throw Error('future or invalid event');
  const p=e.payload||{};
  return {id:e.item_id,occurred_at:e.occurred_at,available_at:e.available_at,...Object.fromEntries(kuaiRandFeedbackContract.feedback_fields.filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]])),
          caption:p.caption_excerpt||'',metadata:p.content_metadata||''};
 });
 const candidates=obs.environment.candidate_pool.map(x=>{
  if(typeof x.id!=='string'||typeof x.title!=='string'||typeof x.text!=='string')throw Error('invalid candidate');
  return {id:x.id,title:x.title,text:x.text};
 });
 if(!candidates.length||new Set(candidates.map(x=>x.id)).size!==candidates.length)throw Error('invalid candidate IDs');
 return {history,candidates,feedback_contract:kuaiRandFeedbackContract};
}
