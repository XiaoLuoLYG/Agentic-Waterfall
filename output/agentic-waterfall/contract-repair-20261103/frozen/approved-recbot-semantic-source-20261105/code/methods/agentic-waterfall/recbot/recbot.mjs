// Paper-based RecBot variant: trained AIA and distilled agents are unavailable.
export const emptyState=userId=>({userId,preferences:{positive_hard:[],positive_soft:[],negative_hard:[],negative_soft:[]},previous_feed:[]});
const fields=['positive_hard','positive_soft','negative_hard','negative_soft'];
const clone=x=>structuredClone(x);
export async function runRecBot({state,command,history,candidates,model,embedding,beta=1}){
 if(typeof command!=='string'||!Array.isArray(history)||!Array.isArray(candidates)||!candidates.length||!Number.isFinite(beta)||beta<=0)throw Error('invalid request');
 if(history.some(e=>typeof e?.id!=='string'||typeof e.text!=='string')||candidates.some(c=>typeof c?.id!=='string'||typeof c.text!=='string'))throw Error('invalid public items');
 const items=candidates.map(c=>({id:c.id,text:c.text}));if(new Set(items.map(c=>c.id)).size!==items.length)throw Error('duplicate candidate');
 const prior=clone(state.preferences);const parsed=await model('parser',{command,previous_preferences:prior,previous_feed:clone(state.previous_feed)});
 if(!parsed||fields.some(k=>!Array.isArray(parsed[k])||parsed[k].some(x=>typeof x!=='string'||!x.trim())))throw Error('invalid parser result');
 const prefs=Object.fromEntries(fields.map(k=>[k,parsed[k]]));
 const plan=await model('planner',{preferences:prefs,has_positive_history:history.length>0,candidates:items});
 const ids=items.map(x=>x.id);if(!Array.isArray(plan?.allowed_ids)||new Set(plan.allowed_ids).size!==plan.allowed_ids.length||plan.allowed_ids.some(x=>!ids.includes(x)))throw Error('unknown allowed candidate');
 if(!Array.isArray(plan.tools)||plan.tools.some(x=>!['filter','matcher','attenuator','aggregator'].includes(x)))throw Error('invalid tool plan');
 if(!prefs.positive_hard.length&&!prefs.negative_hard.length&&plan.allowed_ids.length!==ids.length)throw Error('filter without hard constraints');
 // shortcut: without AIA, positive history is a semantic proxy; replace with trained AIA for paper-complete scoring.
 const positive=[...prefs.positive_soft,...history.map(e=>e.text)].filter(Boolean).join('\n');
 const negative=prefs.negative_soft.join('\n');const scores=positive||negative?await embedding(items,positive,negative):{semantic:Object.fromEntries(ids.map(id=>[id,0])),negative:Object.fromEntries(ids.map(id=>[id,0]))};
 for(const id of ids)if(!Number.isFinite(scores.semantic?.[id])||!Number.isFinite(scores.negative?.[id]))throw Error('invalid semantic scores');
 const allowed=new Set(plan.allowed_ids);const ranked=ids.filter(x=>allowed.has(x)).map(id=>({id,score:scores.semantic[id]-beta*scores.negative[id]}));
 ranked.sort((a,b)=>b.score-a.score||ids.indexOf(a.id)-ids.indexOf(b.id));
 const executedTools=[...(prefs.positive_hard.length||prefs.negative_hard.length?['filter']:[]),...(positive?['matcher']:[]),...(negative?['attenuator']:[]),'aggregator'];
 state.preferences=clone(prefs);state.previous_feed=ranked.map(x=>items.find(c=>c.id===x.id));
 return {variant:'semantic-only-no-trained-AIA',ordered_item_ids:ranked.map(x=>x.id),scores:ranked,preferences:prefs,planner_tools:plan.tools,executed_tools:executedTools,complete_original_method:false};
}
