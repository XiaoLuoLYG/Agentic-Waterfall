import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,ingest,applyMutations,retrospective,evolve,rank,validateDomain} from './mars.mjs';
const domain={name:'test',item_noun:'items',categories:['topic','style','creator','mood','format','length']};
const fresh=()=>emptyState('u',domain);
const chunk=(id,strength=0.5,evidence=1)=>({id,category:'topic',statement:id,strength,evidence});
const events=n=>Array.from({length:n},(_,i)=>({id:String(i),type:'view',text:`visible ${i}`,occurred_at:`time-${i}`,long_view:i%2}));
const update=(payload,text='new')=>({category:'topic',text,strength:0.5,action:'create',evidence_ids:payload.events.map(e=>e.signal_id)});

test('paper extraction delta preserves preferences without new evidence',async()=>{
 const state=fresh();state.preferences=[chunk('untouched',0.7,3)];
 const model=async(stage,payload)=>stage==='extract'?{preferences:[{...chunk('new',0.5,3),text:'new',action:'create',evidence_ids:payload.events.map(e=>e.signal_id??e.id)}]}:{profile:'profile'};
 await retrospective(state,events(3),model);
 assert(state.preferences.some(p=>p.statement==='untouched'),'extraction must not replace unrelated preference memory');
 assert(state.preferences.some(p=>p.statement==='new'));
});

test('domain categories are explicit, fixed, independent and exactly six',()=>{
 assert.throws(()=>emptyState('u'),/six fixed/);
 assert.throws(()=>validateDomain({...domain,categories:['topic']}),/six fixed/);
 assert.throws(()=>validateDomain({...domain,categories:Array(6).fill('topic')}),/six fixed/);
 const own=structuredClone(domain),state=emptyState('u',own);own.categories[0]='changed';assert.equal(state.domain.categories[0],'topic');
});

test('retrospective extraction sees all history while one rank prompt sees latest 15 and all 101 candidates',async()=>{
 const state=fresh(),calls=[];
 const model=async(stage,payload)=>{
  calls.push({stage,payload});assert.deepEqual(payload.domain,domain);
  if(stage==='extract')return {preferences:[update(payload)]};
  if(stage==='synthesize')return {profile:'specific profile'};
  if(stage==='rank')return {scores:payload.candidates.map(c=>({id:c.id,score:Number(c.id.slice(1))/10,tier:'maybe',reason:'visible evidence'}))};
  throw Error(stage);
 };
 await retrospective(state,events(20),model);
 const candidates=Array.from({length:101},(_,i)=>({id:`c${i}`,text:`candidate ${i}`,hidden_label:'SECRET'}));
 const output=await rank(state,candidates,'current requirement',model);
 assert.equal(calls[0].payload.events.length,20);assert.equal(state.preferences[0].evidence,20);assert.equal(state.pending.length,0);
 const ranks=calls.filter(x=>x.stage==='rank');assert.deepEqual(ranks.map(x=>x.payload.candidates.length),[101]);
 for(const call of ranks){assert.equal(call.payload.events.length,15);assert.equal(call.payload.events[0].id,'5');assert.equal(call.payload.instruction,'current requirement');assert(!('preferences' in call.payload));assert(!JSON.stringify(call.payload).includes('SECRET'));}
 assert.equal(output.ordered_item_ids[0],'c100');assert.equal(output.scores[0].reason,'visible evidence');assert.equal(new Set(output.ordered_item_ids).size,101);
});

test('incremental updates resolve existing identities and credit each signal once',async()=>{
 const state=fresh();state.preferences=[chunk('p1',0.2,2),chunk('keep',0.4,2)];
 await retrospective(state,events(3),async(stage,payload)=>stage==='synthesize'?{profile:'profile'}:{preferences:[
  {category:'topic',text:'p1',action:'strengthen',strength:0.8,evidence_ids:[payload.events[0].signal_id,payload.events[0].signal_id]},
  {id:'p1',category:'topic',text:'renamed',action:'weaken',strength:0.3,evidence_ids:[payload.events[1].signal_id]},
  {id:'p1',category:'topic',text:'should not overwrite',action:'weaken',strength:-0.9,evidence_ids:[payload.events[1].signal_id]}
 ]});
 const p=state.preferences.find(x=>x.id==='p1');assert.equal(p.evidence,4);assert.equal(p.strength,0.3);assert.equal(p.statement,'renamed');assert.deepEqual(p.evidence_ids,['e1','e2']);assert(state.preferences.some(x=>x.id==='keep'));
});

test('invalid extraction, excessive deltas, unknown categories and failed synthesis roll back the whole call',async()=>{
 for(const kind of ['unknown-category','unknown-evidence','unknown-target','six-updates','profile-failure']){
  const state=fresh();state.preferences=[chunk('keep')];const before=structuredClone(state);
  await assert.rejects(()=>retrospective(state,events(3),async(stage,payload)=>{
   if(stage==='synthesize')throw Error('profile-failure');
   const u=update(payload);
   if(kind==='unknown-category')u.category='invented';
   if(kind==='unknown-evidence')u.evidence_ids=['future'];
   if(kind==='unknown-target'){u.action='strengthen';u.id='missing';}
   return {preferences:kind==='six-updates'?Array.from({length:6},(_,i)=>({...u,text:`p${i}`})):[u]};
  }),/invalid|unknown|profile-failure/);
  assert.deepEqual(state,before,kind);
 }
});

test('FIFO bounds pending and retains raw signals with unique signal IDs',()=>{
 const state=fresh(),raw=events(18);raw[0].id=raw[1].id='same-video';const original=structuredClone(raw);
 ingest(state,raw);assert.equal(state.events.length,15);assert.equal(state.pending.length,15);assert.equal(state.pending[0].signal_id,'e4');assert.equal(state.events[0].occurred_at,'time-3');assert.equal(state.events[0].long_view,1);assert.deepEqual(raw,original);
 const before=structuredClone(state);assert.throws(()=>ingest(state,[...events(1),{id:'bad'}]),/invalid events/);assert.deepEqual(state,before);
});

test('evolving schedules per signal, bounds skipped pending and reports health and prior outcomes',async()=>{
 const state=fresh(),plans=[];await evolve(state,events(18),async(stage,payload)=>{assert.equal(stage,'plan');plans.push(payload);return {actions:[]};});
 assert.equal(plans.length,16);assert.equal(plans[0].pending.length,3);assert.equal(plans.at(-1).pending.length,15);
 assert.deepEqual(plans.at(-1).pending.map(x=>x.signal_id),state.events.map(x=>x.signal_id));assert.equal(plans[0].health.mutations_since_synthesis,0);assert.deepEqual(plans[1].previous,[]);
 await evolve(state,[],()=>{throw Error('must not schedule without new signal');});
});

test('boost and demote use each new cited signal once and change strength once per operation',()=>{
 const state=fresh();state.preferences=[chunk('p',0.5,1)];ingest(state,events(3));
 applyMutations(state,[{op:'boost',id:'p',evidence_ids:['e1','e1','e2']}]);assert.equal(state.preferences[0].strength,0.6);assert.equal(state.preferences[0].evidence,3);
 const repeated=applyMutations(state,[{op:'boost',id:'p',evidence_ids:['e1','e2']}]);assert.equal(repeated[0].outcome,'no_new_evidence');assert.equal(state.preferences[0].strength,0.6);assert.equal(state.preferences[0].evidence,3);
 applyMutations(state,[{op:'demote',id:'p',evidence_ids:['e3']}]);assert(Math.abs(state.preferences[0].strength-0.4)<1e-9);assert.equal(state.preferences[0].evidence,4);
 const before=structuredClone(state);assert.throws(()=>applyMutations(state,[{op:'boost',id:'p',evidence_ids:['e3']},{op:'forget',id:'p'}]),/forget threshold/);assert.deepEqual(state,before);
});

test('merge deduplicates evidence and category capacity validates before pruning',()=>{
 const state=fresh();state.preferences=[{...chunk('a',0.6,3),evidence_ids:['e1','e2','e3']},{...chunk('b',0.2,3),evidence_ids:['e2','e3','e4']}];
 applyMutations(state,[{op:'merge',id:'a',other:'b'}]);assert.equal(state.preferences.length,1);assert.equal(state.preferences[0].evidence,4);assert(Math.abs(state.preferences[0].strength-0.4)<1e-9);
 state.preferences=Array.from({length:10},(_,i)=>chunk(`p${i}`,i/10,2));applyMutations(state,[]);assert.equal(state.preferences.length,8);assert(!state.preferences.some(p=>p.id==='p0'||p.id==='p1'));
 state.preferences.push(chunk('p9',0.01,1));const before=structuredClone(state);assert.throws(()=>applyMutations(state,[]),/duplicate/);assert.deepEqual(state,before);
 state.preferences=[chunk('weak',0.05,5)];applyMutations(state,[{op:'forget',id:'weak'}]);assert.equal(state.preferences.length,0);
});

test('evolving synthesizes after five actual mutations and passes action outcomes to next plan',async()=>{
 const state=fresh();state.preferences=[chunk('p',0.1,1)];const calls=[];
 await evolve(state,events(8),async(stage,payload)=>{
  calls.push({stage,payload});
  if(stage==='synthesize')return {profile:'updated'};
  return {actions:[{op:'boost',id:'p',evidence_ids:[payload.pending.at(-1).signal_id]}]};
 });
 assert.equal(calls.filter(c=>c.stage==='synthesize').length,1);assert.equal(state.profile,'updated');assert.equal(state.mutations,1);
 const plans=calls.filter(c=>c.stage==='plan');assert.equal(plans[1].payload.previous[0].outcome,'applied');assert.equal(plans[1].payload.previous[0].op,'boost');
});

test('an extraction followed by another planned update can cite that round of observations',async()=>{
 const state=fresh();state.preferences=[chunk('existing',0.2,1)];
 await evolve(state,events(3),async(stage,payload)=>{
  if(stage==='plan')return {actions:[{op:'extract'},{op:'boost',id:'existing',evidence_ids:payload.pending.map(e=>e.signal_id)}]};
  if(stage==='extract')return {preferences:[update(payload)]};
  throw Error(stage);
 });
 assert.equal(state.pending.length,0);assert.equal(state.preferences.find(p=>p.id==='existing').evidence,4);assert(state.preferences.some(p=>p.statement==='new'));
});

test('evolving invalid later action and excessive planner actions do not commit partial state',async()=>{
 for(const actions of [[{op:'boost',id:'p',evidence_ids:['e3']},{op:'forget',id:'missing'}],Array.from({length:4},()=>({op:'extract'}))]){
  const state=fresh();state.preferences=[chunk('p')];const before=structuredClone(state);
  await assert.rejects(()=>evolve(state,events(3),async()=>({actions})),/unknown preference|invalid plan/);assert.deepEqual(state,before);
 }
});

test('rank rejects duplicate, missing and invented candidate IDs without changing state',async()=>{
 const state=fresh(),before=structuredClone(state),candidates=[{id:'a',text:'a'},{id:'b',text:'b'}];
 await assert.rejects(()=>rank(state,[candidates[0],candidates[0]],'',async()=>{}),/duplicate/);
 for(const scores of [[{id:'a',score:1}],[{id:'a',score:1},{id:'c',score:2}],[{id:'a',score:1},{id:'a',score:2}],[{id:'a',score:11},{id:'b',score:2}]])await assert.rejects(()=>rank(state,candidates,'',async()=>({scores})),/invalid scores/);
 assert.deepEqual(state,before);
});
