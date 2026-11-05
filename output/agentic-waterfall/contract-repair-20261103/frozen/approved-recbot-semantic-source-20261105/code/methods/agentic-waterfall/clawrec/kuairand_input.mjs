export function toKuaiRandInput(sample){
 const obs=sample?.observation;
 if(!obs||!Array.isArray(obs.dialogue)||obs.dialogue.length||!Array.isArray(obs.behavior_events)||!Array.isArray(obs.environment?.candidate_pool))throw Error('invalid public input');
 const cutoff=Date.parse(obs.observed_at);if(!Number.isFinite(cutoff))throw Error('invalid cutoff');
 const history=obs.behavior_events.map(e=>{
  const available=Date.parse(e.available_at);
  if(typeof e.item_id!=='string'||!Number.isFinite(available)||available>cutoff)throw Error('future or invalid event');
  const p=e.payload||{};
  return {id:e.item_id,occurred_at:e.occurred_at,available_at:e.available_at,long_view:p.long_view,is_like:p.is_like,is_hate:p.is_hate,
          caption:p.caption_excerpt||'',metadata:p.content_metadata||''};
 });
 const candidates=obs.environment.candidate_pool.map(x=>{
  if(typeof x.id!=='string'||typeof x.title!=='string'||typeof x.text!=='string')throw Error('invalid candidate');
  return {id:x.id,title:x.title,text:x.text};
 });
 if(!candidates.length||new Set(candidates.map(x=>x.id)).size!==candidates.length)throw Error('invalid candidate IDs');
 return {history,candidates};
}
