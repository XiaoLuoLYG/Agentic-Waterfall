import {buildRequest,parseResponse} from '../frozen/v6/code/methods/agentic-waterfall/mars/prompts.mjs';

export function project(sample) {
  const obs=sample?.observation;
  const domain=obs?.decision_id?.match(/^agentrecbench:short_term:(amazon|goodreads|yelp):[0-9]+$/)?.[1];
  const pool=obs?.environment?.candidate_pool;
  if(!domain||typeof obs.user_id!=='string'||!Array.isArray(obs.behavior_events)
    ||!Array.isArray(pool)||pool.length!==20||new Set(pool.map(x=>x.id)).size!==20
    ||pool.some(x=>typeof x.id!=='string'||!x.id||typeof x.text!=='string')
    ||obs.behavior_events.some(e=>typeof e.id!=='string'||!e.id||typeof e.type!=='string'||!e.type))throw Error('invalid AgentRecBench public input');
  const task=obs.environment.sources.find(x=>x.id==='get_user')?.benchmark_task;
  if(!task)throw Error('missing AgentRecBench task context');
  return {
    context_id:obs.decision_id,user_id:obs.user_id,domain,
    history:obs.behavior_events.map(e=>({...structuredClone(e),text:JSON.stringify(e)})),
    candidates:pool.map(({id,text})=>({id,text})),instruction:'',
    task_context:{user_metadata:obs.user_state.records.find(x=>x.key==='public_user_metadata')?.value??null,
      category:task.candidate_category??null,location:task.loc??null},
  };
}

export function requestFor(stage,payload,context) {
  const request=buildRequest(stage,payload);
  request.messages[0].content+='\nPublic benchmark context (provided metadata, not user speech): '+JSON.stringify(context)
    +'\nObserved engagements are complete public comments with their item metadata and recorded rating. Preserve positive and negative evidence. Missing history or metadata supplies no preference evidence. All twenty supplied candidates must be scored; no search is performed.';
  return request;
}

export function parseFor(stage,content) {
  const parsed=parseResponse(stage,content);
  const normalized=[];
  if(stage==='extract')parsed.preferences.forEach((p,index)=>{
    if(Array.isArray(p.category)&&p.category.length===1&&typeof p.category[0]==='string'){
      p.category=p.category[0];normalized.push(index);
    }
  });
  if(normalized.length)parsed.format_normalization={kind:'singleton-category-array',preference_indices:normalized};
  return parsed;
}
