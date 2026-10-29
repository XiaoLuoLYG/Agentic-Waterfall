// Shared frozen-tool adaptation, not the author's original browser runtime.
export async function runRound({method,evidence,priorState,allowedSources,model,search}){
 if(!['clawrec','generic-agent'].includes(method)||!Array.isArray(evidence)||!Array.isArray(allowedSources)||allowedSources.some(x=>typeof x!=='string')||typeof model!=='function'||typeof search!=='function')throw Error('invalid round input');
 const state=await model('state',{evidence,prior_state:priorState});if(typeof state?.state!=='string'||!state.state.trim())throw Error('invalid state');
 const plan=await model('plan',{state:state.state,allowed_sources:allowedSources});const acquired=new Map(),logs=[];
 async function execute(queries){
  if(!Array.isArray(queries)||logs.length+queries.length>10)throw Error('search budget exceeded');
  for(const q of queries){
   if(!q||!allowedSources.includes(q.source)||typeof q.query!=='string'||!q.query.trim())throw Error('invalid search source or query');
   const items=await search(q.source,q.query,10);if(!Array.isArray(items)||items.length>10)throw Error('invalid search result');
   for(const item of items){
    if(!item||typeof item.id!=='string'||item.source!==q.source||typeof item.title!=='string'||typeof item.text!=='string'||typeof item.url!=='string')throw Error('invalid acquired item');
    const old=acquired.get(item.id);if(old&&JSON.stringify(old)!==JSON.stringify(item))throw Error('inconsistent snapshot item');acquired.set(item.id,item);
   }
   logs.push({source:q.source,query:q.query,items});
  }
 }
 await execute(plan?.queries);
 if(method==='generic-agent'&&logs.length<10){
  const follow=await model('followup',{state:state.state,search_results:logs,remaining_searches:10-logs.length,allowed_sources:allowedSources});await execute(follow?.queries);
 }
 if(!acquired.size)return {status:'no_delivery',state:state.state,searches:logs,search_count:logs.length,acquired_ids:[],ordered_item_ids:[]};
 const items=[...acquired.values()];const indexed=items.map((item,i)=>({index:i+1,source:item.source,title:item.title,text:item.text,url:item.url}));
 const selected=await model('curate',{state:state.state,items:indexed});const order=selected?.ordered_indices;
 if(!Array.isArray(order)||order.length>20||order.some(x=>!Number.isInteger(x)||x<1||x>items.length)||new Set(order).size!==order.length)throw Error('invalid recommendation indices');
 const ids=order.map(i=>items[i-1].id);
 return {status:ids.length?'submitted':'no_delivery',state:state.state,searches:logs,search_count:logs.length,acquired_ids:[...acquired.keys()],ordered_item_ids:ids};
}
