// Maps acquire to official get_user/get_item/get_reviews query semantics.
// The bundle is exported by the official InteractionTool after target masking.
import {runEpisode} from '../../../../demos/agentic-feed/waterfall-core.mjs';
import {callModel} from '../../shared/model-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function makeInput(task,scenario,taskId){
  return {observation:{schema_version:'agentic-waterfall-v1',decision_id:`agentrecbench:${scenario}:${taskId}`,
    user_id:task.user_id,session_id:`agentrecbench:${scenario}:${taskId}`,observed_at:null,
    trigger:'benchmark_recommendation',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},
    environment:{candidate_pool:task.candidate_list.map(id=>({id})),pending_queue:[],visible_item_ids:[],
      content_version:'AgentRecBench-288f7f09ca0387e5169a61b219047aea397e4b06',
      sources:[
        {id:'get_user',modes:['browse'],description:'Read public user metadata. Set target_id to the user ID and limit to 1. The result appears in evidence and adds no candidate IDs. Cite the successful action ID as evidence.',benchmark_task:{candidate_category:task.candidate_category,loc:task.loc}},
        {id:'get_item',modes:['browse'],description:'Public candidate details are preloaded in candidate_pool.text; public details of reviewed history items are in behavior_events.payload.item. Unavailable records are explicitly marked. Reread any visible item by setting target_id to its exact item ID and limit to 1. Rank only the original candidates; historical items are evidence, not additional candidates.'},
        {id:'get_reviews',modes:['browse'],description:'Read all visible reviews for one entity. query is a JSON string containing exactly one of user_id, item_id, or review_id, for example {"user_id":"the user ID"}. Results appear in evidence; limit does not truncate the review list. Held-out target interactions are masked. Cite the successful action ID; review_id is source metadata.'}
      ]}},protocol:{mode:'fixed_candidates',delivery_scope:'offline_slate',top_k:20,require_full_ranking:true,max_model_calls:4,
        max_tool_calls:22,max_acquired_items:20,max_output_tokens:4096},run_meta:{scenario,task_id:taskId,synthetic:false}};
}
export function makeAcquire(bundle,task,trace,remoteTool=null){
  const candidates=new Set(task.candidate_list);
  return async(args,context)=>{
    const items=[],evidence=[];
    for(const source of args.source_ids){
      let result,params;
      if(source==='get_user'){params={user_id:args.target_id};result=bundle.users[args.target_id]??null;}
      else if(source==='get_item'){params={item_id:args.target_id};result=bundle.items[args.target_id]??null;}
      else if(source==='get_reviews'){
        params=JSON.parse(args.query);const keys=Object.keys(params);
        if(keys.length!==1||!['user_id','item_id','review_id'].includes(keys[0]))throw new Error('get_reviews_requires_one_id');
        result=params.review_id?(bundle.reviews[params.review_id]?[bundle.reviews[params.review_id]]:[]):params.item_id?(bundle.item_reviews[params.item_id]||[]):(bundle.user_reviews[params.user_id]||[]);
      }else throw new Error('unknown_benchmark_tool');
      if(remoteTool)result=await remoteTool(source,params);
      trace.push({tool:source,arguments:params,result,...(context?.phase?{phase:context.phase}:{})});
      const fields=['item_id','name','stars','review_count','attributes','title','average_rating','rating_number','description','ratings_count','title_without_series','categories','address','city','state','postal_code','latitude','longitude','hours','is_open'];
      const publicResult=source==='get_item'&&result?Object.fromEntries(fields.filter(k=>k in result).map(k=>[k,result[k]])):result;
      evidence.push({tool:source,arguments:params,result:publicResult,...(source==='get_item'?{projection:'shared_official_public_item_fields_no_truncation'}:{})});
      // Full raw tool result is retained in benchmark_tool_calls; avoid repeating it in both pool and receipt.
      if(source==='get_item'&&result&&candidates.has(result.item_id))items.push({id:result.item_id,title:result.title||result.name||result.title_without_series||'',text:JSON.stringify(publicResult),source_id:'get_item',content_type:'benchmark_item'});
    }
    return {items,evidence,actual_requests:args.source_ids.length};
  };
}
export async function preloadCandidateDetails(input,acquire){
  const candidates=input.observation.environment.candidate_pool,items=[],unavailable=[];
  for(const candidate of candidates){
    const result=await acquire({source_ids:['get_item'],mode:'browse',target_id:candidate.id,limit:1},{phase:'candidate_preload'});
    const record=result.evidence[0].result;
    if(record===null){
      unavailable.push(candidate.id);
      items.push({...candidate,text:JSON.stringify({item_id:candidate.id,metadata_status:'unavailable',reason:'Official get_item returned null.'})});
    }else{
      if(result.items.length!==1||result.items[0].id!==candidate.id)throw Error('candidate_metadata_identity_mismatch');
      items.push(result.items[0]);
    }
  }
  input.observation.environment.candidate_pool=items;
  input.run_meta={...input.run_meta,candidate_details:{policy:'preloaded_official_public_item_fields_v1',preloaded_requests:candidates.length,available_count:items.length-unavailable.length,unavailable_ids:unavailable}};
}
export async function preloadUserEvidence(input,acquire){
  const observation=input.observation,userId=observation.user_id;
  const userResponse=await acquire({source_ids:['get_user'],mode:'browse',target_id:userId,limit:1},{phase:'user_preload'});
  const reviewResponse=await acquire({source_ids:['get_reviews'],mode:'browse',query:JSON.stringify({user_id:userId}),limit:1},{phase:'user_preload'});
  const user=userResponse.evidence[0].result,reviews=reviewResponse.evidence[0].result;
  if(!Array.isArray(reviews)||reviews.some(review=>typeof review.review_id!=='string'||review.user_id!==userId))throw Error('invalid_preloaded_user_reviews');
  if(user!==null){
    if(user.user_id!==userId)throw Error('user_metadata_identity_mismatch');
    observation.user_state.records.push({id:`agentrecbench:user:${userId}`,kind:'fact',key:'public_user_metadata',value:structuredClone(user),scope:'user',scope_id:userId,status:'active',basis:'observed',source_channels:['independent_profile'],evidence_refs:[]});
  }
  const items=new Map();
  for(const itemId of new Set(reviews.map(review=>review.item_id))){
    const response=await acquire({source_ids:['get_item'],mode:'browse',target_id:itemId,limit:1},{phase:'history_item_preload'});
    const item=response.evidence[0].result;
    if(item!==null&&item.item_id!==itemId)throw Error('history_metadata_identity_mismatch');
    items.set(itemId,item??{item_id:itemId,metadata_status:'unavailable',reason:'Official get_item returned null.'});
  }
  observation.behavior_events.push(...reviews.map((review,index)=>({id:`agentrecbench:review:${userId}:${index}:${review.review_id}`,user_id:userId,item_id:review.item_id,type:'comment',source_channels:['behavior','expression'],payload:{review:structuredClone(review),item:structuredClone(items.get(review.item_id))}})));
  observation.environment.sources.find(source=>source.id==='get_user').initial_evidence={available:user!==null,location:'user_state.records'};
  observation.environment.sources.find(source=>source.id==='get_reviews').initial_evidence={visible_user_reviews:reviews.length,location:'behavior_events',complete:true};
  input.run_meta={...input.run_meta,user_evidence:{policy:'all_official_visible_user_evidence_v2',preloaded_requests:2+items.size,user_available:user!==null,visible_review_count:reviews.length,history_item_count:items.size,unavailable_history_item_ids:[...items].filter(([,item])=>item.metadata_status==='unavailable').map(([id])=>id),omitted_reviews:0}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values:v}=parseArgs({options:{task:{type:'string'},bundle:{type:'string'},'tool-url':{type:'string'},output:{type:'string'},scenario:{type:'string'},'task-id':{type:'string'},variant:{type:'string',default:'full'}}});
  for(const k of ['task','output','scenario','task-id'])if(!v[k])throw new Error(`--${k} required`);
  const task=JSON.parse(readFileSync(v.task,'utf8'));
  const bundle=v.bundle?JSON.parse(readFileSync(v.bundle,'utf8')):{users:{},items:{},reviews:{},item_reviews:{},user_reviews:{}};
  let remoteTool=null;
  if(v['tool-url']){
    const endpoint=new URL(v['tool-url']);
    if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1')throw new Error('only_local_official_tool_server_allowed');
    remoteTool=async(tool,arguments_)=>{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool,arguments:arguments_}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error(`official_tool_http_${response.status}`);
      return (await response.json()).result;
    };
  } else if(bundle.provenance?.synthetic!==false)throw new Error('real_run_requires_public_corpus_bundle');
  const input=makeInput(task,v.scenario,v['task-id']),toolCalls=[];
  const acquire=makeAcquire(bundle,task,toolCalls,remoteTool);
  await preloadUserEvidence(input,acquire);
  await preloadCandidateDetails(input,acquire);
  const result=await runEpisode(input,{experiment:'agentrecbench',variant:v.variant,acquire,modelCall:callModel});
  result.preparation_tool_calls=input.run_meta.candidate_details.preloaded_requests+input.run_meta.user_evidence.preloaded_requests;
  result.total_tool_calls=result.tool_calls+result.preparation_tool_calls;
  writeFileSync(v.output,JSON.stringify({input,result,benchmark_tool_calls:toolCalls},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,error:result.error,model_requests:result.model_request_count,tool_calls:toolCalls.length}));
  if(result.status!=='submitted')process.exitCode=2;
}
