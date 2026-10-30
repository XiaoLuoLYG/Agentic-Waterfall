import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRuntime,runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';
import {SOURCE_SHA256} from '../../../demos/agentic-feed-site/lib/waterfall/waterfall-version.mjs';
test('recorded source hash matches the common core',()=>{
 const source=readFileSync(new URL('../../../demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs',import.meta.url));
 assert.equal(SOURCE_SHA256,createHash('sha256').update(source).digest('hex'));
});
const item=id=>({id,title:id,source_id:'offline',content_type:'article'});
const input=()=>({observation:{decision_id:'d',observed_at:'2026-10-29T00:00:00Z',dialogue:[{id:'say',role:'user',text:'I like football'}],behavior_events:[{id:'read',type:'save',item_id:'a'}],user_state:{version:0,records:[]},environment:{candidate_pool:[item('a')],sources:[{id:'offline',modes:['search','hot']}]}},catalog:[item('b')],protocol:{top_k:2}});
const action=(id,kind,args,depends_on=[])=>({action_id:id,kind,arguments:args,depends_on,evidence_refs:[]});
const decision=actions=>({decision_id:'d',actions});
const record={id:'preference',kind:'preference',key:'interest',value:'football',scope:'long_term',scope_id:null,status:'active',basis:'explicit',evidence_refs:['say']};
test('a reused action id rejects the entire response before any other action changes state',async()=>{
 const r=createRuntime(input());
 await r.execute(decision([action('existing','respond',{kind:'answer',text:'first'})]));
 await assert.rejects(r.execute(decision([action('existing','respond',{kind:'answer',text:'changed'}),action('new','update_state',{base_version:0,edits:[]})])),/action_id_reuse_with_different_payload/);
 assert.equal(r.result.state_after.version,0);
});
test('an interim id collision is reported for a fresh model decision within the same budget',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});let reported=false;
 const pending=runEpisode(input(),{acquire:async args=>{if(args.query==='slow')await gate;return {items:[item(args.query)],actual_requests:1};},modelCall:async request=>{
  const {context}=JSON.parse(request.messages[1].content);
  if(context.call_index===0)return {attempt_id:'first',content:JSON.stringify(decision([action('fast','acquire',{source_ids:['offline'],mode:'search',query:'fast',limit:1}),action('slow','acquire',{source_ids:['offline'],mode:'search',query:'slow',limit:1})]))};
  if(context.other_acquisitions_pending)return {attempt_id:'partial',content:JSON.stringify(decision([action('slow','update_state',{base_version:0,edits:[]}),action('other','update_state',{base_version:0,edits:[]})]))};
  assert.equal(context.previous_output_error.error,'action_id_reuse_with_different_payload');reported=true;
  return {attempt_id:'corrected',content:JSON.stringify(decision([action('rank','recommend',{ordered_item_ids:['slow'],delivery:'append'})]))};
 }});
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));release();
 const result=await pending;
 assert(reported);assert.equal(result.status,'submitted');assert.equal(result.state_after.version,0);assert.equal(result.model_request_count,3);
 assert.equal(result.model_calls[1].error,'action_id_reuse_with_different_payload');
});
test('independent acquisitions start concurrently while dependent actions wait',async()=>{
 const started=[];let release;const gate=new Promise(resolve=>{release=resolve});
 const r=createRuntime(input(),{acquire:async args=>{started.push(args.query);await gate;return {items:[],actual_requests:1};}});
 const pending=r.execute(decision([action('one','acquire',{source_ids:['offline'],mode:'search',query:'one',limit:1}),action('two','acquire',{source_ids:['offline'],mode:'search',query:'two',limit:1}),action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'},['one','two'])]));
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.deepEqual(started,['one','two']);assert.deepEqual(r.result.ordered_item_ids,[]);}finally{release();await pending;}
 assert.deepEqual(r.result.ordered_item_ids,['a']);
});
test('independent recommendation survives a source failure',async()=>{
 const result=await runEpisode(input(),{acquire:async()=>{throw new Error('source_failed');},decide:async()=>decision([action('get','acquire',{source_ids:['offline'],mode:'search',query:'b',limit:1}),action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'})])});
 assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['a']);assert.equal(result.trace[0].execution_results[0].error,'source_failed');
});
test('a valid recommendation remains available when a later model call fails',async()=>{
 const result=await runEpisode(input(),{decide:async(_obs,context)=>{if(context.call_index>0)throw Error('later_model_failure');return decision([action('get','acquire',{source_ids:['offline'],mode:'search',query:'b',limit:1}),action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'})]);}});
 assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['a']);assert.equal(result.continuation_error,'later_model_failure');
});
test('an interim failure is recorded while other source results can still finish',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});
 const pending=runEpisode(input(),{acquire:async args=>{if(args.query==='slow')await gate;return {items:[item(args.query)],actual_requests:1};},decide:async(obs,context)=>{if(context.other_acquisitions_pending)throw Error('interim_failed');return decision(context.call_index===0?[action('fast','acquire',{source_ids:['offline'],mode:'search',query:'fast',limit:1}),action('slow','acquire',{source_ids:['offline'],mode:'search',query:'slow',limit:1})]:[action('rank','recommend',{ordered_item_ids:['slow'],delivery:'append'})]);}});
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));release();const result=await pending;
 assert.equal(result.status,'submitted');assert.equal(result.model_calls.find(x=>x.context.other_acquisitions_pending)?.error,'interim_failed');
});
test('existing candidates can be delivered while an independent search is running',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});const events=[];
 const pending=runEpisode(input(),{acquire:async()=>{await gate;return {items:[item('b')],actual_requests:1};},onAction:receipt=>events.push(receipt),decide:async()=>decision([action('get','acquire',{source_ids:['offline'],mode:'search',query:'b',limit:1}),action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'})])});
 await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(events.find(e=>e.action_id==='rank')?.status,'success');assert(!events.some(e=>e.action_id==='get'));}finally{release();await pending;}
 const result=await pending;assert.deepEqual(result.ordered_item_ids,['a']);assert(result.candidate_pool_after.some(i=>i.id==='b'));
});
test('agent can rank newly acquired content after delivering an existing candidate',async()=>{
 const decisions=[];
 const result=await runEpisode(input(),{decide:async(obs,context)=>{
  decisions.push(context.call_index);
  return decision(context.call_index===0?[action('get','acquire',{source_ids:['offline'],mode:'search',query:'b',limit:1}),action('first','recommend',{ordered_item_ids:['a'],delivery:'append'})]:[action('next','recommend',{ordered_item_ids:['b'],delivery:'replace_pending'})]);
 }});
 assert.deepEqual(decisions,[0,1]);assert.deepEqual(result.ordered_item_ids,['b']);
});
test('agent can recommend the first source result while another source is still pending',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),events=[];
 const pending=runEpisode(input(),{acquire:async args=>{if(args.query==='slow')await gate;return {items:[item(args.query)],actual_requests:1};},onAction:receipt=>events.push(receipt),decide:async(obs,context)=>decision(context.call_index===0?[action('fast','acquire',{source_ids:['offline'],mode:'search',query:'fast',limit:1}),action('slow','acquire',{source_ids:['offline'],mode:'search',query:'slow',limit:1})]:[action(`rank-${context.call_index}`,'recommend',{ordered_item_ids:[obs.environment.candidate_pool.some(x=>x.id==='slow')?'slow':'fast'],delivery:'append'})])});
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 let result;try{assert(events.some(event=>event.kind==='recommend'&&event.result.queued_item_ids[0]==='fast'));}finally{release();result=await pending;}
 assert.equal(result.status,'submitted');assert(result.candidate_pool_after.some(x=>x.id==='slow'));
});
test('an interim agent decision may recommend and acquire another source together',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),events=[];
 const resultPromise=runEpisode(input(),{acquire:async args=>{if(args.query==='slow')await gate;return {items:[item(args.query)],actual_requests:1};},onAction:receipt=>events.push(receipt),decide:async(obs,context)=>decision(context.call_index===0?[action('fast','acquire',{source_ids:['offline'],mode:'search',query:'fast',limit:1}),action('slow','acquire',{source_ids:['offline'],mode:'search',query:'slow',limit:1})]:context.other_acquisitions_pending?[action('third','acquire',{source_ids:['offline'],mode:'search',query:'third',limit:1}),action('first','recommend',{ordered_item_ids:['fast'],delivery:'append'})]:[action('last','recommend',{ordered_item_ids:['slow'],delivery:'append'})])});
 await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));let result;
 try{assert(events.some(event=>event.action_id==='first'&&event.status==='success'));}finally{release();result=await resultPromise;}
 assert(result.candidate_pool_after.some(x=>x.id==='third'));
});
test('cannot recommend an unacquired ID; no fabricated output',async()=>{
 const r=createRuntime(input());const s=await r.execute(decision([action('rank','recommend',{ordered_item_ids:['b'],delivery:'append'})]));assert.equal(s.execution_results[0].error,'unacquired_recommendation');assert.deepEqual(r.result.ordered_item_ids,[]);
});
test('acquisition is real and state dependencies execute; idempotence retains version',async()=>{
 const r=createRuntime(input());const d=decision([action('update','update_state',{base_version:0,edits:[{op:'upsert',record}]}),action('get','acquire',{source_ids:['offline'],mode:'search',query:'b',limit:1},['update'])]);
 await r.execute(d);await r.execute(d);assert.equal(r.result.state_after.version,1);assert.equal(r.result.tool_calls,1);assert.deepEqual(r.result.state_after.records[0].source_channels,['expression']);
 await r.execute(decision([action('rank','recommend',{ordered_item_ids:['b'],delivery:'replace_pending'},['get'])]));assert.deepEqual(r.result.ordered_item_ids,['b']);assert.equal(r.result.trace.at(-1).execution_results[0].result.exposure_recorded,false);
});
test('failed dependency cannot write state or recommend',async()=>{
 const r=createRuntime(input());const s=await r.execute(decision([action('bad','update_state',{base_version:9,edits:[]}),action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'},['bad'])]));assert.equal(s.execution_results[1].status,'skipped');assert.equal(r.result.state_after.version,0);
});
test('state transaction atomic and history never erased',async()=>{
 const r=createRuntime(input());await r.execute(decision([action('u','update_state',{base_version:0,edits:[{op:'upsert',record}]})]));await r.execute(decision([action('bad','update_state',{base_version:1,edits:[{op:'set_status',id:'preference',status:'completed'},{op:'set_status',id:'missing',status:'completed'}]})]));assert.equal(r.result.state_after.records[0].status,'active');assert.equal(r.result.state_after.history.length,1);
});
test('session-scoped state retains its originating session when the model omits scope ID',async()=>{
 const i=input();i.observation.session_id='session-one';const r=createRuntime(i);
 await r.execute(decision([action('u','update_state',{base_version:0,edits:[{op:'upsert',record:{...record,scope:'session',scope_id:null}}]})]));
 assert.equal(r.result.state_after.records[0].scope_id,'session-one');
});
test('frozen state sees current feedback but refuses persistent writes',async()=>{
 const r=createRuntime(input(),{variant:'frozen_state'});assert.equal(r.snapshot().behavior_events.length,1);const s=await r.execute(decision([action('u','update_state',{base_version:0,edits:[]})]));assert.equal(s.execution_results[0].error,'state_update_disabled');
});
test('no-expression removes dependent state and refuses unknown provenance',()=>{
 const i=input();i.observation.user_state.records=[{...record,source_channels:['expression']}];const r=createRuntime(i,{variant:'no_expression'});assert.deepEqual(r.snapshot().dialogue,[]);assert.deepEqual(r.result.state_after.records,[]);delete i.observation.user_state.records[0].source_channels;assert.throws(()=>createRuntime(i,{variant:'no_expression'}),/provenance/);
});
test('future feedback and hidden item labels never enter model input',()=>{
 const i=input();i.observation.behavior_events.push({id:'future',type:'rating',feedback_available_at:'2026-11-01T00:00:00Z'});i.observation.environment.candidate_pool[0].label=1;i.observation.environment.groundtruth='a';i.observation.evaluation_private={target:'a'};const r=createRuntime(i);const s=r.snapshot();assert.equal(s.behavior_events.length,1);assert.equal(s.environment.candidate_pool[0].label,undefined);assert.equal(s.environment.groundtruth,undefined);assert.equal(s.evaluation_private,undefined);
});
test('fixed ranking must be complete and cannot acquire',async()=>{
 const i=input();i.observation.environment.candidate_pool.push(item('c'));i.protocol={mode:'fixed_candidates',require_full_ranking:true};const r=createRuntime(i);const s=await r.execute(decision([action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'})]));assert.equal(s.execution_results[0].error,'incomplete_ranking');
});
test('dynamic loop does acquisition then recommendation and records fixture origin',async()=>{
 const r=await runEpisode(input(),{decide:async(o,c)=>decision([c.call_index===0?action('get','acquire',{source_ids:['offline'],mode:'hot',limit:1}):action('rank','recommend',{ordered_item_ids:['b'],delivery:'append'})])});assert.equal(r.status,'submitted');assert.equal(r.model_request_count,0);assert.equal(r.origin,'synthetic_scripted_contract_test');assert.equal(r.trace.length,2);
});
test('an injected model transport uses the same decision prompt and records the model receipt',async()=>{
 const requests=[];
 const result=await runEpisode(input(),{modelCall:async request=>{requests.push(request);return {attempt_id:'demo-attempt',content:JSON.stringify(decision([action('rank','recommend',{ordered_item_ids:['a'],delivery:'append'})])),requested_model:'test-model',usage:{total_tokens:3}};}});
 assert.equal(result.status,'submitted');assert.equal(result.origin,'llm');assert.equal(result.model_request_count,1);
 assert.equal(requests[0].messages[0].content.includes('Agentic Waterfall'),true);assert.equal(result.model_calls[0].requested_model,'test-model');
});
test('an unknown recommendation ID is reported to the agent for a bounded correction',async()=>{
 let calls=0;const result=await runEpisode(input(),{modelCall:async request=>{
  const {observation:obs,context}=JSON.parse(request.messages[1].content);calls++;
  if(context.call_index===1){assert(obs.environment.tool_results.some(x=>x.error_details?.unknown_item_ids?.includes('missing-id')));assert.match(request.messages[0].content,/correct.*unknown.*IDs/i);}
  return {attempt_id:`attempt-${calls}`,content:JSON.stringify(decision([action(`rank-${calls}`,'recommend',{ordered_item_ids:[calls===1?'missing-id':'a'],delivery:'append'})]))};
 }});
 assert.equal(calls,2);assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['a']);
});
test('agent candidate indices map exactly to the items it selected',async()=>{
 const i=input();i.observation.environment.candidate_pool=Array.from({length:60},(_,n)=>item(`id-${n}`));
 const result=await runEpisode(i,{modelCall:async request=>{const obs=JSON.parse(request.messages[1].content).observation;assert.equal(obs.environment.candidate_pool[2].candidate_index,3);return {attempt_id:'indices',content:JSON.stringify(decision([action('rank','recommend',{ordered_candidate_indices:[3,1],delivery:'append'})]))};}});
 assert.equal(result.status,'submitted');assert.deepEqual(result.ordered_item_ids,['id-2','id-0']);
 assert.deepEqual(result.model_calls[0].parsed_output.actions[0].arguments.ordered_candidate_indices,[3,1]);assert(result.normalizations.some(x=>x.operation==='candidate_indices_to_ids'));
});
test('large fixed candidate sets are model-ranked in batches and merged without losing IDs',async()=>{
 const i=input();i.observation.environment.candidate_pool=Array.from({length:101},(_,n)=>({id:`item-${n}`,title:`item ${n}`,abstract:'x'.repeat(1200)}));
 i.protocol={mode:'fixed_candidates',require_full_ranking:true,top_k:101,max_model_calls:5,max_tool_calls:0,max_acquired_items:0,max_output_tokens:8192};const stages=[];
 const result=await runEpisode(i,{modelCall:async request=>{assert(Buffer.byteLength(JSON.stringify(request.messages))<=100000);const {observation:obs,context}=JSON.parse(request.messages[1].content);stages.push({stage:context.batch_stage,ids:obs.environment.candidate_pool.map(item=>item.id)});return {attempt_id:`call-${stages.length}`,content:JSON.stringify(decision([action(`rank-${stages.length}`,'recommend',{ordered_item_ids:obs.environment.candidate_pool.map(item=>item.id),delivery:'replace_pending'})]))};}});
 assert.equal(result.status,'submitted');assert.equal(new Set(result.ordered_item_ids).size,101);assert.equal(result.ordered_item_ids.length,101);
 assert(stages.filter(x=>x.stage==='rank').length>=2);assert.equal(stages.at(-1).stage,'merge');
});
test('batch rankings and merge map the original candidate indices without dropping items',async()=>{
 const i=input();i.observation.environment.candidate_pool=Array.from({length:101},(_,n)=>({id:`item-${n}`,title:`item ${n}`,abstract:'x'.repeat(1200)}));
 i.protocol={mode:'fixed_candidates',require_full_ranking:true,top_k:101,max_model_calls:5,max_tool_calls:0,max_acquired_items:0,max_output_tokens:8192};
 const result=await runEpisode(i,{modelCall:async request=>{const {observation:obs,context}=JSON.parse(request.messages[1].content);return {attempt_id:`call-${context.call_index}`,content:JSON.stringify(decision([action(`rank-${context.call_index}`,'recommend',{ordered_candidate_indices:obs.environment.candidate_pool.map(x=>x.candidate_index).reverse(),delivery:'replace_pending'})]))};}});
 assert.equal(result.status,'submitted');assert.equal(new Set(result.ordered_item_ids).size,101);assert.equal(result.ordered_item_ids[0],'item-100');
});
test('no acquire and duplicate action IDs fail closed',async()=>{
 const r=createRuntime(input(),{variant:'no_acquire'});const s=await r.execute(decision([action('get','acquire',{source_ids:['offline'],mode:'hot',limit:1})]));assert.equal(s.execution_results[0].error,'acquire_disabled');await assert.rejects(()=>r.execute(decision([action('x','idle',{mode:'keep'}),action('x','idle',{mode:'wait'})])),/invalid_actions/);
});
test('repeating an already executed action stops without repeated model calls',async()=>{
 const i=input();i.catalog=[];i.protocol.max_model_calls=20;let calls=0;
 const result=await runEpisode(i,{decide:async()=>{calls++;return decision([action('same','acquire',{source_ids:['offline'],mode:'search',query:'missing',limit:1})]);}});
 assert.equal(calls,2);assert.equal(result.status,'failed');assert.equal(result.error,'no_progress');assert.equal(result.tool_calls,1);
});
test('acquired text is not serialized twice but full receipt stays in trace',async()=>{
 const r=createRuntime(input());await r.execute(decision([action('get','acquire',{source_ids:['offline'],mode:'hot',limit:1})]));
 const snapshot=r.snapshot();assert.deepEqual(snapshot.environment.tool_results[0].result.item_ids,['b']);assert.equal(snapshot.environment.tool_results[0].result.items,undefined);assert.equal(snapshot.environment.candidate_pool.find(x=>x.id==='b').title,'b');assert.equal(r.result.trace[0].execution_results[0].result.items[0].title,'b');
});
test('ongoing play cannot expose a completed duration before its ended_at',()=>{
 const i=input();i.observation.behavior_events.push({id:'ongoing',type:'play',available_at:'2026-10-28T23:59:00Z',ended_at:'2026-10-29T00:01:00Z',payload:{duration_ms:120000}});
 assert(!createRuntime(i).snapshot().behavior_events.some(e=>e.id==='ongoing'));
});
