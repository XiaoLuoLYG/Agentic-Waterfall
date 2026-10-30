// shortcut: a fixed candidate task has no acquisition step; use the open-environment runner for search.
export async function runFixed(history,candidates,model){
 if(!Array.isArray(history)||!Array.isArray(candidates)||!candidates.length||candidates.some(x=>typeof x?.id!=='string'||typeof x.text!=='string'))throw Error('invalid input');
 const ids=candidates.map(x=>x.id);if(new Set(ids).size!==ids.length)throw Error('duplicate candidate');
 const state=await model('state',{history});if(typeof state?.user_state_md!=='string'||(history.length>0&&!state.user_state_md.trim()))throw Error('invalid state');
 const indexed=candidates.map((x,i)=>({index:i+1,text:x.text})),payload={user_state_md:state.user_state_md,candidates:indexed};
 let response=await model('curate',payload);const valid=r=>Array.isArray(r)&&r.length===ids.length&&new Set(r).size===ids.length&&r.every(x=>Number.isInteger(x)&&x>=1&&x<=ids.length);
 if(!valid(response?.ordered_indices))response=await model('curate_retry',{...payload,previous_indices:response?.ordered_indices??null,validation_error:'Return each index exactly once; the prior response was invalid.'});
 const ranked=response?.ordered_indices;if(!valid(ranked))throw Error('invalid candidate permutation after retry');
 return {variant:'generic-agent-adapted-fixed-candidates',state,ordered_item_ids:ranked.map(i=>ids[i-1]),ordered_indices:ranked};
}
