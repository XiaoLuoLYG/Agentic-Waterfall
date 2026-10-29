import { acquire, hash, id } from './core.mjs';

// A fixed, inspectable retrieval baseline: it does not use the recommender's learned entries.
export async function fixedRetrieval(snapshot, sourceConfig, get = acquire, nextPage = () => 1) {
  const started=Date.now(), positive=snapshot.behavior.findLast(event=>event.type==='feedback' && ['like','save'].includes(event.value));
  const query=(snapshot.command || snapshot.recent_commands?.at(-1)?.command || positive?.topic || snapshot.state.interests?.[0] || '科技').trim().slice(0,120) || '科技';
  const actions=(snapshot.available_sources || []).slice(0,3).map(source=>({type:'acquire',source:source.id,query,mode:source.modes.includes('search')?'search':source.modes[0],modality:source.modalities[0]}));
  const results=await Promise.all(actions.map(async action=>{const started_at=new Date().toISOString();try{return {...await get(action,sourceConfig,{excludedIds:snapshot.rendered_ids || [],...(action.source==='bilibili'?{page:nextPage(action)}:{})}),started_at};}catch{return {source:action.source,status:'failed',error:'source_request_failed',items:[],started_at,completed_at:new Date().toISOString()};}}));
  const rendered=new Set(snapshot.rendered_ids || []);
  const fits=item=>(!snapshot.available_sources || snapshot.available_sources.some(source=>source.id===item.source)) && (!snapshot.settings || ((!snapshot.settings.sources.length || snapshot.settings.sources.includes(item.source)) && snapshot.settings.contentTypes.includes(item.modality)));
  const items=[...new Map([...(snapshot.candidate_pool || []),...results.flatMap(result=>result.items || [])].filter(item=>fits(item)&&!rendered.has(item.id)).map(item=>[item.id,item])).values()];
  const ranked=items.map((item,index)=>({item,index,score:(item.title || '').includes(query)?1:0})).sort((a,b)=>b.score-a.score || a.index-b.index).map(x=>x.item);
  return {policy_id:'fixed-retrieval-v1',policy_version:'fixed-retrieval-v1',mode:'fixed-retrieval',input_snapshot:snapshot,state_before_version:snapshot.state.version,state_after:structuredClone(snapshot.state),content_snapshot:{id:id(),hash:hash(items),items},slate:ranked.slice(0,6),trace:[{phase:'plan',actions,rule_input:{snapshot},at:new Date().toISOString()},{phase:'tool_result',results,at:new Date().toISOString()},{phase:'rank',actions:ranked.length?[{type:'recommend',candidate_ids:ranked.slice(0,6).map(item=>item.id),reason:'固定关键词匹配和来源顺序'}]:[],rule_input:{query,candidates:items},at:new Date().toISOString()}],duration_ms:Date.now()-started};
}
