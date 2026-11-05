export function toMindInput(sample){
 const obs=sample?.observation;
 if(!obs||!Array.isArray(obs.dialogue)||obs.dialogue.length||!Array.isArray(obs.behavior_events)||!Array.isArray(obs.environment?.candidate_pool))throw Error('invalid MIND public input');
 const item=x=>{
  if(typeof x?.id!=='string'||typeof x.title!=='string'||(x.abstract!=null&&typeof x.abstract!=='string'))throw Error('invalid public news');
  return {id:x.id,title:x.title,text:x.abstract||''};
 };
 if(obs.behavior_events.some(e=>e.type!=='click'))throw Error('unsupported MIND event');
 const history=obs.behavior_events.map(e=>item(e.item));
 const candidates=obs.environment.candidate_pool.map(item);
 if(!candidates.length||new Set(candidates.map(x=>x.id)).size!==candidates.length)throw Error('invalid candidates');
 return {history,candidates};
}
