// Dataset semantics and descriptive public-history features stay outside the shared policy.
const identity={
 mind:'Content id is the original news identifier. Rank every supplied candidate exactly once.',
 kuairec:'Content id is the original video_id as a string. It is not the candidate_index. The task requests a top-10 selection from the acquired catalog candidates.',
 kuairand:'Content id has the kuairand:video_id form. Rank the complete supplied candidate set, including every candidate exactly once; do not return only the top 10 or top 20.',
 agentrecbench:'Content id is the original domain item identifier, which may be numeric or alphanumeric. Rank every supplied candidate exactly once, not just the best few.',
 clawrec:'Content id identifies a frozen source item. Select the requested next slate from actual returned items; preserve the ongoing user state across events.'
};

const quantiles=values=>{
 const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
 if(!a.length)return null;
 return {count:a.length,min:a[0],q25:a[Math.floor((a.length-1)*.25)],median:a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2,q75:a[Math.floor((a.length-1)*.75)],max:a.at(-1)};
};

export function behaviorStatistics(dataset,events){
 if(dataset==='kuairec'){
  const groups=new Map(),months=new Map();
  const summary=rows=>({observed_count:rows.length,watch_ratio_gt_2_count:rows.filter(e=>e.payload.watch_ratio>2).length,watch_ratio_gt_2_rate:rows.length?rows.filter(e=>e.payload.watch_ratio>2).length/rows.length:null,watch_ratio:quantiles(rows.map(e=>e.payload.watch_ratio)),duration_ms:quantiles(rows.map(e=>e.payload.duration_ms)),stronger_response_refs:rows.filter(e=>e.payload.watch_ratio>2).map(e=>e.id),other_response_refs:rows.filter(e=>e.payload.watch_ratio<=2).map(e=>e.id)});
  for(const e of events){
   if(!Number.isFinite(e.payload?.watch_ratio))throw Error('invalid_public_watch_ratio');
   const category=e.payload.item_category||'(missing category)',month=e.occurred_at?.slice(0,7)||'(missing time)';
   if(!groups.has(category))groups.set(category,[]);groups.get(category).push(e);
   if(!months.has(month))months.set(month,[]);months.get(month).push(e);
  }
  return {basis:'All supplied visible personal events, including repeated observations. No other-user popularity or held-out interactions. The >2 threshold is the public task outcome definition, not an explicit like/dislike label.',interpretation:'Exposure count and response rate are distinct. Small samples and observational exposure do not establish causal preference. All raw events remain present.',all:summary(events),by_category:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([category,rows])=>({category,...summary(rows)})),by_month:[...months].sort(([a],[b])=>a.localeCompare(b)).map(([month,rows])=>({month,...summary(rows)}))};
 }
 if(dataset==='agentrecbench'){
  const counts={};let missing=0;
  for(const e of events){const rating=e.payload?.review?.stars;if(typeof rating!=='number'||!Number.isFinite(rating)){missing++;continue;}counts[rating]=(counts[rating]||0)+1;}
  return {basis:'All supplied visible personal review events; raw reviews remain present. Rating values retain their original source meaning.',observed_count:events.length,rating_counts:counts,missing_rating_count:missing};
 }
 if(dataset==='kuairand'){
  const signals={};
  for(const key of ['long_view','is_click','is_like','is_hate','is_follow','is_comment','is_forward']){
   const known=events.filter(e=>[0,1,false,true].includes(e.payload?.[key])),yes=known.filter(e=>e.payload[key]===1||e.payload[key]===true);
   signals[key]={observed_count:known.length,set_count:yes.length,set_rate:known.length?yes.length/known.length:null,evidence_refs:yes.map(e=>e.id)};
  }
  return {basis:'All supplied visible personal exposure events. Each binary flag keeps its source meaning; absence of a positive action is not an explicit dislike. All original captions and raw events remain present.',observed_count:events.length,signals,play_time_ms:quantiles(events.map(e=>e.payload?.play_time_ms)),duration_ms:quantiles(events.map(e=>e.payload?.duration_ms))};
 }
 return undefined;
}

export function taskInstructions(task,input){
 if(!identity[task.dataset])throw Error('unsupported_task_instruction_dataset');
 const p=input.protocol;
 return {dataset:task.dataset,...(task.domain?{domain:task.domain}:{}),identity:identity[task.dataset],recommendation:{order_field:'ordered_candidate_indices',count:p.require_full_ranking?input.observation.environment.candidate_pool.length:p.top_k,count_rule:p.require_full_ranking?'exact':'up_to',coverage:p.require_full_ranking?'A complete permutation of all supplied candidates.':'Select up to the requested count of distinct candidates; shorter slates are valid.',mapping:'Read candidate_index from the CURRENT candidate_pool entry. Output that integer, not id, item_id, video_id, a numeric substring of an ID, or an array position from a previous observation. The runner maps indices back to original dataset IDs for evaluation.',delivery:'replace_pending replaces the pending slate; append adds to it. Select the delivery appropriate to the current queue and check its resulting count.',evidence:'Use exact visible record.id values or successful action_id values for evidence_refs. A source row number, item ID or review_id is not itself a registered evidence reference. Reference availability does not establish semantic support: observed records must state the cited event facts, while inferred preferences and long-term conclusions must use basis inferred. The runtime does not verify free-text claim truth.'},...(task.behavior_statistics?{behavior_statistics:behaviorStatistics(task.dataset,input.observation.behavior_events)}:{})};
}
