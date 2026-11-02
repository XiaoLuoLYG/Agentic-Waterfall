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
        {id:'get_user',modes:['browse'],description:'查询公开用户资料，target_id填写用户ID。返回资料在evidence中，不占新增候选数量；limit表示候选数量，不表示评论条数。状态依据可引用成功工具动作ID。',benchmark_task:{candidate_category:task.candidate_category,loc:task.loc}},
        {id:'get_item',modes:['browse'],description:'查询一个候选的公开资料，target_id填写候选ID，limit通常为1；仅原候选ID参与排序。'},
        {id:'get_reviews',modes:['browse'],description:'查询全部可见评论。query是只含user_id、item_id或review_id之一的JSON，例如 {"user_id":"用户ID"}。结果在evidence中，limit不限制评论条数；隐藏目标交互已屏蔽。状态依据引用成功工具动作ID，返回的review_id本身是来源元数据。'}
      ]}},protocol:{mode:'fixed_candidates',top_k:20,require_full_ranking:true,max_model_calls:4,
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
      trace.push({tool:source,arguments:params,result});
      const fields=['item_id','name','stars','review_count','attributes','title','average_rating','rating_number','description','ratings_count','title_without_series'];
      const publicResult=source==='get_item'&&result?Object.fromEntries(fields.filter(k=>k in result).map(k=>[k,result[k]])):result;
      evidence.push({tool:source,arguments:params,result:publicResult,...(source==='get_item'?{projection:'official_RecAgent_item_fields_no_truncation'}:{})});
      // Full raw tool result is retained in benchmark_tool_calls; avoid repeating it in both pool and receipt.
      if(source==='get_item'&&result&&candidates.has(result.item_id))items.push({id:result.item_id,title:result.title||result.name||result.title_without_series||'',source_id:'get_item',content_type:'benchmark_item'});
    }
    return {items,evidence,actual_requests:args.source_ids.length};
  };
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
  const result=await runEpisode(input,{experiment:'agentrecbench',variant:v.variant,acquire:makeAcquire(bundle,task,toolCalls,remoteTool),modelCall:callModel});
  writeFileSync(v.output,JSON.stringify({input,result,benchmark_tool_calls:toolCalls},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,error:result.error,model_requests:result.model_request_count,tool_calls:toolCalls.length}));
  if(result.status!=='submitted')process.exitCode=2;
}
