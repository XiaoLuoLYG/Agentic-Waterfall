// Paper-based adapter to arXiv:2605.14401v2; author implementation is unavailable.
export const parameters=Object.freeze({batch:3,maxPerCategory:8,maxEvents:15,boost:0.1,demote:0.2,forget:0.1,minEvidence:5,synthesizeAfter:5});
const clone=x=>structuredClone(x);
const nonempty=x=>typeof x==='string'&&Boolean(x.trim());
export function validateDomain(domain){
 if(!domain||!nonempty(domain.name)||!nonempty(domain.item_noun)||!Array.isArray(domain.categories)||domain.categories.length!==6||domain.categories.some(x=>!nonempty(x))||new Set(domain.categories).size!==6)throw Error('six fixed domain categories required');
}
export function emptyState(userId,domain){
 if(!nonempty(userId))throw Error('invalid user');validateDomain(domain);
 return {userId,domain:clone(domain),events:[],pending:[],preferences:[],profile:'',mutations:0,previous:[],nextSignal:1,nextPreference:1};
}
function validateChunk(p,domain){
 if(!p||!['id','category','statement'].every(k=>nonempty(p[k]))||!domain.categories.includes(p.category)||!Number.isFinite(p.strength)||p.strength < -1||p.strength > 1||!Number.isSafeInteger(p.evidence)||p.evidence<1)throw Error('invalid preference');
 if(p.evidence_ids!==undefined&&(!Array.isArray(p.evidence_ids)||p.evidence_ids.some(x=>!nonempty(x))||new Set(p.evidence_ids).size!==p.evidence_ids.length||p.evidence_ids.length>p.evidence))throw Error('invalid preference evidence');
}
function cap(s){
 validateDomain(s.domain);const grouped=new Map();
 for(const p of s.preferences){validateChunk(p,s.domain);if(!grouped.has(p.category))grouped.set(p.category,[]);grouped.get(p.category).push(p);}
 if(new Set(s.preferences.map(p=>p.id)).size!==s.preferences.length)throw Error('duplicate preference');
 s.preferences=[...grouped.values()].flatMap(a=>a.sort((x,y)=>y.evidence*Math.abs(y.strength)-x.evidence*Math.abs(x.strength)).slice(0,parameters.maxPerCategory));
}
export function ingest(s,events){
 if(!Array.isArray(events)||events.some(e=>!e||!nonempty(e.id)||!nonempty(e.type)||typeof e.text!=='string'))throw Error('invalid events');
 if(!Number.isSafeInteger(s.nextSignal)||s.nextSignal<1)throw Error('invalid signal counter');
 const incoming=clone(events).map(e=>({...e,signal_id:`e${s.nextSignal++}`}));
 s.events.push(...incoming);s.events=s.events.slice(-parameters.maxEvents);
 const retained=new Set(s.events.map(e=>e.signal_id));s.pending.push(...clone(incoming));s.pending=s.pending.filter(e=>retained.has(e.signal_id));
 return incoming;
}
function evidence(s,ids,signals=s.pending){
 const pending=new Set(signals.map(e=>e.signal_id));
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>!nonempty(id)||!pending.has(id)))throw Error('invalid pending evidence');
 return [...new Set(ids)];
}
function credit(p,ids){
 // shortcut: the paper does not specify event-to-count mapping; audit unique cited signals until author code is available.
 const known=new Set(p.evidence_ids??[]),fresh=ids.filter(id=>!known.has(id));
 p.evidence+=fresh.length;p.evidence_ids=[...known,...fresh];return fresh.length;
}
function mutate(s,a,signals=s.pending){
 if(!a||!nonempty(a.op))throw Error('invalid action');
 const p=s.preferences.find(x=>x.id===a.id);if(!p)throw Error('unknown preference');
 let changed=true;
 if(a.op==='boost'||a.op==='demote'){
  changed=credit(p,evidence(s,a.evidence_ids,signals))>0;
  if(changed)p.strength=Math.max(-1,Math.min(1,p.strength+(a.op==='boost'?parameters.boost:-parameters.demote)));
 } else if(a.op==='forget'){
  if(Math.abs(p.strength)>=parameters.forget||p.evidence<parameters.minEvidence)throw Error('forget threshold');s.preferences=s.preferences.filter(x=>x.id!==p.id);
 } else if(a.op==='merge'){
  const q=s.preferences.find(x=>x.id===a.other);if(!q||q.id===p.id||q.category!==p.category)throw Error('invalid merge');
  // shortcut: weighted merging is a local interpretation; replace when author merge semantics become available.
  p.strength=(p.strength*p.evidence+q.strength*q.evidence)/(p.evidence+q.evidence);
  const seen=new Set(p.evidence_ids??[]),other=q.evidence_ids??[];
  p.evidence+=q.evidence-other.filter(id=>seen.has(id)).length;p.evidence_ids=[...new Set([...seen,...other])];s.preferences=s.preferences.filter(x=>x.id!==q.id);
 } else throw Error('unknown operation');
 if(changed)s.mutations++;
 return {...clone(a),outcome:changed?'applied':'no_new_evidence'};
}
export function applyMutations(s,actions){
 if(!Array.isArray(actions))throw Error('invalid actions');
 const work=clone(s),outcomes=actions.map(a=>mutate(work,a));cap(work);Object.assign(s,work);return outcomes;
}
async function extract(s,model){
 const answer=await model('extract',{domain:clone(s.domain),events:clone(s.pending),preferences:clone(s.preferences)});
 if(!Array.isArray(answer?.preferences)||answer.preferences.length>5)throw Error('invalid extraction');
 for(const u of answer.preferences){
  if(!u||!s.domain.categories.includes(u.category)||!nonempty(u.text)||!Number.isFinite(u.strength)||u.strength < -1||u.strength > 1||!['create','strengthen','weaken'].includes(u.action))throw Error('invalid preference update');
  const ids=evidence(s,u.evidence_ids),matches=s.preferences.filter(p=>u.id?p.id===u.id:p.category===u.category&&p.statement===u.text);
  if(u.action==='create'){
   if(s.preferences.some(p=>p.category===u.category&&p.statement===u.text))throw Error('duplicate preference creation');
   let id;do{id=`p${s.nextPreference++}`;}while(s.preferences.some(p=>p.id===id));
   s.preferences.push({id,category:u.category,statement:u.text,strength:u.strength,evidence:ids.length,evidence_ids:ids});
  } else {
   if(matches.length!==1||matches[0].category!==u.category)throw Error('unknown preference update');
   const p=matches[0];if(credit(p,ids)){p.statement=u.text;p.strength=u.strength;}
  }
 }
 s.pending=[];s.mutations++;
}
async function synthesize(s,model){
 const r=await model('synthesize',{domain:clone(s.domain),preferences:clone(s.preferences),previous_profile:s.profile});
 if(typeof r?.profile!=='string'||!r.profile.trim())throw Error('invalid profile');s.profile=r.profile;s.mutations=0;
}
export async function retrospective(state,events,model){
 const s=clone(state);validateDomain(s.domain);
 const prior=clone(s.pending),incoming=ingest(s,events);
 // Retrospective extraction sees all supplied history; only the ranking event tier uses the FIFO window (§4.1).
 s.pending=[...prior,...incoming];if(s.pending.length)await extract(s,model);cap(s);
 if(s.preferences.length)await synthesize(s,model);Object.assign(state,s);return state;
}
export async function evolve(state,events,model){
 const s=clone(state);validateDomain(s.domain);
 if(!Array.isArray(events))throw Error('invalid events');
 for(const event of events){
  ingest(s,[event]);if(s.pending.length<parameters.batch)continue;
  const health={events:s.events.length,pending:s.pending.length,preferences:s.preferences.length,mutations_since_synthesis:s.mutations,per_category:Object.fromEntries(s.domain.categories.map(c=>[c,s.preferences.filter(p=>p.category===c).length])),forgettable:s.preferences.filter(p=>Math.abs(p.strength)<parameters.forget&&p.evidence>=parameters.minEvidence).map(p=>p.id)};
  const plan=await model('plan',{domain:clone(s.domain),profile:s.profile,preferences:clone(s.preferences),pending:clone(s.pending),previous:clone(s.previous),health});
  if(!Array.isArray(plan?.actions)||plan.actions.length>3)throw Error('invalid plan');
  const outcomes=[],plannedSignals=clone(s.pending);
  for(const a of plan.actions){
   if(a?.op==='extract'){await extract(s,model);outcomes.push({...clone(a),outcome:'applied'});}
   else if(a?.op==='synthesize'){await synthesize(s,model);outcomes.push({...clone(a),outcome:'applied'});}
   else outcomes.push(mutate(s,a,plannedSignals));
  }
  cap(s);if(s.mutations>=parameters.synthesizeAfter)await synthesize(s,model);
  s.previous=outcomes;
 }
 Object.assign(state,s);return state;
}
export async function rank(state,candidates,instruction,model){
 validateDomain(state.domain);
 if(!Array.isArray(candidates)||!candidates.length||typeof instruction!=='string'||candidates.some(c=>!nonempty(c?.id)||typeof c.text!=='string'))throw Error('invalid candidates');
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw Error('duplicate candidate');
 const items=candidates.map(c=>({id:c.id,text:c.text})),ids=new Set(items.map(c=>c.id));
 // N=10 in Table 5 is the paper's candidate slate size, not a specified scoring batch size.
 const res=await model('rank',{domain:clone(state.domain),profile:state.profile,events:clone(state.events),instruction,candidates:items});
 if(!Array.isArray(res?.scores)||res.scores.length!==ids.size||new Set(res.scores.map(x=>x.id)).size!==ids.size||res.scores.some(x=>!ids.has(x.id)||!Number.isFinite(x.score)||x.score<0||x.score>10||(x.tier!==undefined&&typeof x.tier!=='string')||(x.reason!==undefined&&typeof x.reason!=='string')))throw Error('invalid scores');
 const scored=res.scores.map(x=>({id:x.id,score:x.score,...(x.tier!==undefined?{tier:x.tier}:{}),...(x.reason!==undefined?{reason:x.reason}:{})}));
 const order=new Map(candidates.map((c,i)=>[c.id,i]));scored.sort((a,b)=>b.score-a.score||order.get(a.id)-order.get(b.id));
 return {ordered_item_ids:scored.map(x=>x.id),scores:scored};
}
