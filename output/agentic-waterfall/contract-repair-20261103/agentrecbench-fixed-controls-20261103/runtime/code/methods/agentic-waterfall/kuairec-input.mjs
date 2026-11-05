export function kuaiRecInput(sample,pool,catalog){
 const obs=sample?.observation;if(!obs||obs.decision_id!==pool?.context_id)throw Error('context mismatch');
 if(!Array.isArray(obs.dialogue)||obs.dialogue.length||!Array.isArray(obs.behavior_events)||!Array.isArray(pool.acquired_ids)||!pool.acquired_ids.length||!Array.isArray(catalog))throw Error('invalid KuaiRec input');
 const cutoff=Date.parse(obs.observed_at);if(!Number.isFinite(cutoff))throw Error('invalid cutoff');
 const history=obs.behavior_events.map(e=>{const t=Date.parse(e.occurred_at),p=e.payload||{};if(!Number.isFinite(t)||t>cutoff)throw Error('future or invalid event');if(typeof e.item_id!=='string'||typeof e.type!=='string'||typeof p.item_text!=='string'||!Number.isFinite(p.watch_ratio))throw Error('invalid event');return {id:e.item_id,type:e.type,text:p.item_text,watch_ratio:p.watch_ratio,occurred_at:e.occurred_at};});
 if(new Set(pool.acquired_ids).size!==pool.acquired_ids.length)throw Error('duplicate candidates');
 const table=new Map(catalog.map(x=>[x.id,x.text]));if(table.size!==catalog.length)throw Error('duplicate catalog');
 const candidates=pool.acquired_ids.map(id=>{if(typeof id!=='string'||typeof table.get(id)!=='string')throw Error('unknown candidate');return {id,text:table.get(id)};});
 return {history,candidates};
}
