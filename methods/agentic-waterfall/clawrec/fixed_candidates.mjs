// shortcut: fixed-candidate adaptation does not perform ClawRec acquisition; use the open-environment runner for retrieval.
export async function runFixed(history,candidates,model){
 if(!Array.isArray(history)||!Array.isArray(candidates)||!candidates.length||candidates.some(x=>typeof x?.id!=='string'||typeof x.text!=='string'))throw Error('invalid input');
 const ids=candidates.map(x=>x.id);if(new Set(ids).size!==ids.length)throw Error('duplicate candidate');
 const state=await model('state',{history});if(typeof state?.user_state_md!=='string'||!state.user_state_md.trim())throw Error('invalid state');
 const indexed=candidates.map((x,i)=>({index:i+1,text:x.text}));
 const payload={user_state_md:state.user_state_md,candidates:indexed};
 const valid=ranked=>Array.isArray(ranked)&&ranked.length===ids.length&&new Set(ranked).size===ids.length&&ranked.every(x=>Number.isInteger(x)&&x>=1&&x<=ids.length);
 let result=await model('curate',payload);let ranked=result?.ordered_indices;
 if(!valid(ranked)){
  result=await model('curate',{...payload,previous_ordered_indices:ranked,format_feedback:`The previous output was not a permutation. Return each supplied index from 1 to ${ids.length} exactly once; do not add or omit any index.`});ranked=result?.ordered_indices;
 }
 if(!valid(ranked))throw Error('invalid candidate permutation');
 return {variant:'clawrec-adapted-fixed-candidates',state,ordered_item_ids:ranked.map(i=>ids[i-1]),ordered_indices:ranked};
}
