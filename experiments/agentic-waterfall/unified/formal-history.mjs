export function prepareHistory(source) {
  const input=structuredClone(source),observation=input.observation;
  const history=observation.behavior_events||[],owner=observation.user_id,cutoff=observation.observed_at;
  const available=history.filter(row=>(row.user_id===undefined||row.user_id===owner)&&
    (!row.visible_to_policy_id||row.visible_to_policy_id===(input.protocol?.policy_id||'full'))&&
    (!cutoff||['feedback_available_at','available_at','received_at','ended_at','occurred_at','timestamp']
      .map(key=>row[key]).filter(value=>value!==undefined&&value!==null&&value!=='')
      .every(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.parse(cutoff))));
  observation.behavior_events=available;
  observation.environment={...observation.environment,sources:[...(observation.environment?.sources||[]).filter(row=>row.id!=='waterfall-history-archive'),{
    id:'waterfall-history-archive',modes:[],tool:'lookup_history',total_count:history.length,
    visible_count:available.length,initial_count:available.length,
    description:'Every authorized visible behavior record is included in the initial input. '+
      'lookup_history matches case-insensitively over complete event JSON, or paginates newest to oldest with an empty query. offset indexes matching events; limit is 1 to 100. Every returned record is complete. next_offset=null means the matching archive is exhausted.',
  }]};
  input.run_meta={...input.run_meta,...(input.run_meta?.history_protocol?{source_history_protocol:input.run_meta.source_history_protocol||input.run_meta.history_protocol}:{}),history_protocol:{version:'full-visible-history-v1',original_events:history.length,
    initial_events:available.length,omitted_visible_events:0,original_history_retained:true,state_unchanged:true}};
  const lookupHistory=(args,{observation:current})=>{
    if(current.user_id!==owner)throw Error('history_owner_mismatch');
    const {query='',offset=0,limit=30}=args;
    if(typeof query!=='string'||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid_history_lookup');
    const matches=available.filter(row=>!query||JSON.stringify(row).toLowerCase().includes(query.toLowerCase())).slice().reverse();
    const rows=matches.slice(offset,offset+limit),next=offset+rows.length;
    return {dialogue:[],behavior_events:structuredClone(rows),matched_events:matches.length,next_offset:next<matches.length?next:null};
  };
  return {input,lookupHistory};
}
