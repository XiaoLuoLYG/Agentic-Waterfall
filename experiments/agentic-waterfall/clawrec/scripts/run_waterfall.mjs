import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {runEpisode} from '../../../../demos/agentic-feed/waterfall-core.mjs';
import {acquire} from '../../../../demos/agentic-feed/core.mjs';
import {loadConfig} from '../../../../demos/agentic-feed/server.mjs';
import {loadSourceConfig,sourceCatalog} from '../../../../demos/agentic-feed/sources.mjs';
import {callModel} from '../../shared/model-client.mjs';

export function makeInput(observation,sources,now=new Date().toISOString()){
 const eventTime=observation.observed_at;
 return {observation:{...observation,observed_at:now,environment:{...observation.environment,sources,content_version:'live-not-frozen'}},protocol:{mode:'acquire',top_k:20,max_model_calls:4,max_tool_calls:10,max_acquired_items:100,max_output_tokens:8192},run_meta:{dataset_event_time:eventTime,content_environment:'live_not_frozen',official_effect_evaluation:false,unavailable_source:'xiaohongshu'}};
}
export function makeAcquire(input,sourceCall){
 return async(args,context)=>{
  const results=await Promise.all(args.source_ids.map(source=>sourceCall(source,args,context)));
  if(results.every(result=>result.status==='failed'))throw Error('all_sources_failed');
  const items=results.flatMap(result=>result.items||[]).slice(0,args.limit).map(item=>({id:item.id,title:item.title,abstract:item.summary,source_id:item.source,content_type:item.modality,url:item.url,published_at:item.published_at,content_hash:item.content_hash}));
  return {items,evidence:results.map(({items,...rest})=>rest),actual_requests:args.source_ids.length};
 };
}

export function priorStateForEvent(previous,workspace,event){
 if(event===1&&!previous)return null;
 if(!previous)throw Error('prior_state_required');
 const expected=`${workspace}__event_${String(event-1).padStart(2,'0')}`,state=previous.result?.state_after;
 if(previous.input?.observation?.user_id!==workspace||previous.input?.observation?.decision_id!==expected||!Number.isInteger(state?.version)||!Array.isArray(state.records))throw Error('prior_state_mismatch');
 return structuredClone(state);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{workspace:{type:'string'},event:{type:'string'},output:{type:'string'},'state-in':{type:'string'}}});
 if(!values.workspace||!values.event||!values.output)throw Error('--workspace --event --output required');
 const event=Number(values.event);if(!Number.isInteger(event)||event<1||event>5)throw Error('invalid_event');
 const previous=values['state-in']?JSON.parse(readFileSync(values['state-in'],'utf8')):null,state=priorStateForEvent(previous,values.workspace,event);
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const script="import json,pathlib,sys;sys.path.insert(0,sys.argv[1]);from simbench import read_public_event,observation;root=next(pathlib.Path(sys.argv[2]).glob('ClawRec-*/clawrec-simbench/cases'));state=json.load(sys.stdin);print(json.dumps(observation(read_public_event(root,sys.argv[3],int(sys.argv[4])),state)))";
 const proc=spawnSync('python3',['-c',script,resolve(root,'adapters'),resolve(root,'upstream'),values.workspace,values.event],{input:JSON.stringify(state),encoding:'utf8'});
 if(proc.status!==0)throw Error(`public_input_failed: ${proc.stderr}`);
 const config=loadConfig();if(!config)throw Error('model_config_missing');const sourceConfig=loadSourceConfig(config.sourceConfigPath);
 const sources=sourceCatalog(sourceConfig).filter(source=>['bilibili','zhihu'].includes(source.id)&&source.allowed!==false&&source.configured).map(({id,modes,modalities})=>({id,modes,modalities}));
 if(!sources.length)throw Error('no_available_live_sources');
 const input=makeInput(JSON.parse(proc.stdout),sources),toolCalls=[];
 const get=async(source,args)=>{const entry=sources.find(s=>s.id===source);const modality=args.content_types?.find(type=>entry.modalities.includes(type))||entry.modalities[0];const result=await acquire({source,mode:args.mode,query:args.query||'',modality},sourceConfig,{limit:args.limit});toolCalls.push(result);return result;};
 const result=await runEpisode(input,{experiment:'clawrec',modelCall:callModel,acquire:makeAcquire(input,get)});
 writeFileSync(values.output,JSON.stringify({input,result,tool_calls:toolCalls},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:result.status,error:result.error,continuation_error:result.continuation_error,model_requests:result.model_request_count,tool_calls:result.tool_calls,ranked:result.ordered_item_ids.length,content_environment:input.run_meta.content_environment}));
 if(result.status!=='submitted')process.exitCode=2;
}
