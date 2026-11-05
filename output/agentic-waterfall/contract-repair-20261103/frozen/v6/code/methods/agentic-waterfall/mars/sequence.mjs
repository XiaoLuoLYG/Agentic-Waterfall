import {emptyState,retrospective,evolve} from './mars.mjs';
// shortcut: this splits an existing visible history for an engineering check, not a real multi-session user study.
export async function runSequence(userId,events,model,domain){
 if(typeof userId!=='string'||!Array.isArray(events)||events.length<9)throw Error('nine visible events required');
 const state=emptyState(userId,domain),states=[];await retrospective(state,events.slice(0,3),model);states.push(structuredClone(state));
 for(let start=3;start<9;start+=3){await evolve(state,events.slice(start,start+3),model);states.push(structuredClone(state));}
 return {states};
}
