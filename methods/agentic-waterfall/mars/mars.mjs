// Paper-based implementation; author code and prompts were not released.
export const parameters=Object.freeze({batch:3,maxPerCategory:8,maxEvents:15,boost:0.1,demote:0.2,forget:0.1,minEvidence:5,synthesizeAfter:5,rankBatch:10});
export const emptyState=userId=>({userId,events:[],pending:[],preferences:[],profile:'',mutations:0,previous:[]});
const clone=x=>structuredClone(x);
function validateChunk(p){
 if(!p||!['id','category','statement'].every(k=>typeof p[k]==='string'&&p[k].trim())||!Number.isFinite(p.strength)||p.strength < -1||p.strength > 1||!Number.isInteger(p.evidence)||p.evidence<1)throw Error('invalid preference');
}
function cap(s){
 const grouped=new Map();for(const p of s.preferences){validateChunk(p);if(!grouped.has(p.category))grouped.set(p.category,[]);grouped.get(p.category).push(p);}
 s.preferences=[...grouped.values()].flatMap(a=>a.sort((x,y)=>y.evidence*Math.abs(y.strength)-x.evidence*Math.abs(x.strength)).slice(0,parameters.maxPerCategory));
 if(new Set(s.preferences.map(p=>p.id)).size!==s.preferences.length)throw Error('duplicate preference');
}
export function ingest(s,events){
 if(!Array.isArray(events))throw Error('invalid events');
 for(const e of events){if(!e||typeof e.id!=='string'||typeof e.type!=='string'||typeof e.text!=='string')throw Error('invalid event');}
 s.pending.push(...clone(events));s.events.push(...clone(events));s.events=s.events.slice(-parameters.maxEvents);
}
export function applyMutations(s,actions){
 const work=clone(s);if(!Array.isArray(actions))throw Error('invalid actions');
 for(const a of actions){
  const p=work.preferences.find(x=>x.id===a.id);if(!p)throw Error('unknown preference');
  if(a.op==='boost'){p.strength=Math.min(1,p.strength+parameters.boost);p.evidence++;}
  else if(a.op==='demote'){p.strength=Math.max(-1,p.strength-parameters.demote);p.evidence++;}
  else if(a.op==='forget'){if(Math.abs(p.strength)>=parameters.forget||p.evidence<parameters.minEvidence)throw Error('forget threshold');work.preferences=work.preferences.filter(x=>x.id!==p.id);}
  else if(a.op==='merge'){
   const q=work.preferences.find(x=>x.id===a.other);if(!q||q.id===p.id||q.category!==p.category)throw Error('invalid merge');
   p.strength=(p.strength*p.evidence+q.strength*q.evidence)/(p.evidence+q.evidence);p.evidence+=q.evidence;work.preferences=work.preferences.filter(x=>x.id!==q.id);
  } else throw Error('unknown operation');
  work.mutations++;
 }
 cap(work);Object.assign(s,work);
}
async function extract(s,model){
 const answer=await model('extract',{events:clone(s.pending),preferences:clone(s.preferences)});
 if(!Array.isArray(answer?.preferences))throw Error('invalid extraction');
 const result=answer.preferences.map(clone);result.forEach(validateChunk);
 s.preferences=result;cap(s);s.pending=[];s.mutations++;
}
async function synthesize(s,model){
 const r=await model('synthesize',{preferences:clone(s.preferences),previous_profile:s.profile});
 if(typeof r?.profile!=='string'||!r.profile.trim())throw Error('invalid profile');s.profile=r.profile;s.mutations=0;
}
export async function retrospective(state,events,model){
 const s=clone(state);ingest(s,events);if(s.pending.length)await extract(s,model);if(s.preferences.length)await synthesize(s,model);Object.assign(state,s);return state;
}
export async function evolve(state,events,model){
 const s=clone(state);ingest(s,events);if(s.pending.length<parameters.batch){Object.assign(state,s);return state;}
 const plan=await model('plan',{profile:s.profile,preferences:clone(s.preferences),pending:clone(s.pending),previous:clone(s.previous)});
 if(!Array.isArray(plan?.actions))throw Error('invalid plan');
 for(const a of plan.actions){
  if(a.op==='extract')await extract(s,model);
  else if(a.op==='synthesize')await synthesize(s,model);
  else applyMutations(s,[a]);
 }
 if(s.mutations>=parameters.synthesizeAfter)await synthesize(s,model);
 s.previous=clone(plan.actions);Object.assign(state,s);return state;
}
export async function rank(state,candidates,instruction,model){
 if(!Array.isArray(candidates)||!candidates.length||typeof instruction!=='string'||candidates.some(c=>typeof c.id!=='string'||typeof c.text!=='string'))throw Error('invalid candidates');
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw Error('duplicate candidate');
 const scored=[];
 for(let i=0;i<candidates.length;i+=parameters.rankBatch){
  const batch=candidates.slice(i,i+parameters.rankBatch).map(c=>({id:c.id,text:c.text}));
  const res=await model('rank',{profile:state.profile,events:clone(state.events),instruction,candidates:batch});
  if(!Array.isArray(res?.scores)||res.scores.length!==batch.length||new Set(res.scores.map(x=>x.id)).size!==batch.length||res.scores.some(x=>!batch.some(c=>c.id===x.id)||!Number.isFinite(x.score)||x.score<0||x.score>10))throw Error('invalid scores');
  scored.push(...res.scores.map(x=>({id:x.id,score:x.score})));
 }
 const order=new Map(candidates.map((c,i)=>[c.id,i]));scored.sort((a,b)=>b.score-a.score||order.get(a.id)-order.get(b.id));
 return {ordered_item_ids:scored.map(x=>x.id),scores:scored};
}
