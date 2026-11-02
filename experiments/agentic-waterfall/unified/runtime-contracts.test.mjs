import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime,runEpisode,SYSTEM_PROMPT} from '../../../demos/agentic-feed/waterfall-core.mjs';
test('history receipt references preserve comment provenance including provenance.channels',async()=>{
 for(const metadata of [{source_channels:['expression','behavior']},{provenance:{channels:['expression','behavior']}}]){
  const runtime=createRuntime(input(),{lookupHistory:async()=>({dialogue:[],behavior_events:[{id:'old-comment',type:'comment',text:'tutorials',...metadata}]})});
  await runtime.execute(decision([action('history','lookup_history',{query:'',offset:0,limit:10})]));
  await runtime.execute(decision([action('remember','update_state',{base_version:1,edits:[{op:'upsert',record:{...record,id:'receipt-memory',evidence_refs:['history']}}]})]));
  const saved=runtime.result.state_after.records.find(row=>row.id==='receipt-memory');
  assert(saved.source_channels.includes('expression'));
  const later=input();later.observation.user_state=runtime.result.state_after;
  assert.equal(createRuntime(later,{variant:'no_expression'}).snapshot().user_state.records.some(row=>row.id==='receipt-memory'),false);
 }
});

test('local forwarding preserves the documented private configuration location',async()=>{
 const {DEFAULT_SOURCE_CONFIG_PATH}=await import('../../../demos/agentic-feed/sources.mjs');
 assert.equal(DEFAULT_SOURCE_CONFIG_PATH,new URL('../../../HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json',import.meta.url).pathname);
});

const record={id:'remembered',kind:'preference',key:'interest',value:'photography',scope:'long_term',scope_id:null,status:'active',basis:'observed',evidence_refs:['old-save'],source_channels:['behavior']};
const action=(action_id,kind,arguments_)=>({action_id,kind,arguments:arguments_,evidence_refs:[],depends_on:[]});
const input=()=>({observation:{decision_id:'contract',user_id:'u',session_id:'s',observed_at:'2026-11-02T00:00:00Z',dialogue:[],behavior_events:[],user_state:{version:1,records:[structuredClone(record)]},environment:{candidate_pool:[{id:'A'}],sources:[{id:'metadata',modes:['browse']}]}},protocol:{max_model_calls:3,max_tool_calls:4,max_acquired_items:1}});
const decision=actions=>({decision_id:'contract',actions});

test('persisted evidence remains usable across decisions while invented references stay rejected',async()=>{
 const runtime=createRuntime(input());
 const kept=await runtime.execute(decision([action('keep','update_state',{base_version:1,edits:[{op:'upsert',record}]})]));
 assert.equal(kept.execution_results[0].status,'success');
 assert.deepEqual(runtime.result.state_after.records[0].source_channels,['behavior']);
 const bad=await runtime.execute(decision([action('bad','update_state',{base_version:2,edits:[{op:'upsert',record:{...record,evidence_refs:['invented']}}]})]));
 assert.equal(bad.execution_results[0].error,'state_evidence_missing');
 assert.equal(runtime.result.state_after.version,2);
});

test('history lookup remains available to every variant and filters only its removed channel',async()=>{
 const lookupHistory=async()=>({dialogue:[{id:'old-said',role:'user',text:'preference'}],behavior_events:[{id:'old-click',type:'click'},{id:'old-comment',type:'comment',text:'preference'}],next_offset:null});
 for(const variant of ['full','no_expression','no_behavior','fixed_workflow','no_acquire','frozen_state']){
  const runtime=createRuntime(input(),{variant,lookupHistory});
  assert.equal(runtime.snapshot().environment.recommendation_constraints.history_lookup_enabled,true,variant);
  const result=await runtime.execute(decision([action('history','lookup_history',{query:'',offset:0,limit:10})]));
  assert.equal(result.execution_results[0].status,'success',variant);
  const snapshot=runtime.snapshot();
  assert.equal(snapshot.dialogue.length,variant==='no_expression'?0:1,variant);
  assert.deepEqual(snapshot.behavior_events.map(row=>row.id),variant==='no_behavior'?[]:variant==='no_expression'?['old-click']:['old-click','old-comment'],variant);
  if(variant==='no_behavior')assert.equal(snapshot.user_state.records.length,0);
  if(variant==='no_expression')assert.deepEqual(snapshot.user_state.records.map(r=>r.id),['remembered']);
 }
});

test('fixed workflow can look up history alongside the required phase action',async()=>{
 const runtime=createRuntime(input(),{variant:'fixed_workflow',lookupHistory:async()=>({dialogue:[],behavior_events:[]})});
 const result=await runtime.execute(decision([action('history','lookup_history',{query:'',offset:0,limit:10}),action('state','update_state',{base_version:1,edits:[]})]),{phase:'update_state'});
 assert(result.execution_results.every(row=>row.status==='success'));
});

test('comment provenance survives memory updates and cannot reappear in a removed channel',async()=>{
 const source=input();source.observation.behavior_events=[{id:'comment',type:'comment',text:'I prefer tutorials',source_channels:['expression','behavior']}];
 const runtime=createRuntime(source);
 await runtime.execute(decision([action('remember','update_state',{base_version:1,edits:[{op:'upsert',record:{...record,id:'comment-memory',evidence_refs:['comment']}}]})]));
 const saved=runtime.result.state_after.records.find(row=>row.id==='comment-memory');
 assert.deepEqual(new Set(saved.source_channels),new Set(['expression','behavior']));
 const later=input();later.observation.user_state=runtime.result.state_after;
 for(const variant of ['no_expression','no_behavior'])assert.equal(createRuntime(later,{variant}).snapshot().user_state.records.some(row=>row.id==='comment-memory'),false);
});

test('history lookup rejects other-policy, other-owner and future records',async()=>{
 const runtime=createRuntime(input(),{lookupHistory:async()=>({dialogue:[],behavior_events:[{id:'allowed',type:'click'},{id:'other-policy',type:'click',visible_to_policy_id:'another-policy'},{id:'other-owner',type:'click',user_id:'other'},{id:'future',type:'click',available_at:'2027-01-01T00:00:00Z'}]})});
 await runtime.execute(decision([action('history','lookup_history',{query:'',offset:0,limit:10})]));
 assert.deepEqual(runtime.snapshot().behavior_events.map(row=>row.id),['allowed']);
});

test('metadata lookup request limit is separate from the unique candidate budget',async()=>{
 let calls=0;
 const runtime=createRuntime(input(),{acquire:async()=>{calls++;return {items:[],evidence:[{text:'visible reviews'}],actual_requests:1};}});
 const result=await runtime.execute(decision([action('reviews','acquire',{source_ids:['metadata'],mode:'browse',limit:100})]));
 assert.equal(result.execution_results[0].status,'success');assert.equal(calls,1);assert.equal(runtime.result.acquired_items,0);
 const bounded=createRuntime(input(),{acquire:async()=>({items:[{id:'B'},{id:'C'}],actual_requests:1})});
 const rejected=await bounded.execute(decision([action('get','acquire',{source_ids:['metadata'],mode:'browse',limit:100})]));
 assert.equal(rejected.execution_results[0].error,'unique_acquisition_budget_exhausted');
});

test('shared Waterfall prompt explains inputs and actions in Chinese',async()=>{
 assert.match(SYSTEM_PROMPT,/dialogue/);assert.match(SYSTEM_PROMPT,/behavior_events/);assert.match(SYSTEM_PROMPT,/user_state/);assert.match(SYSTEM_PROMPT,/environment/);
 assert.doesNotMatch(SYSTEM_PROMPT,/\b(?:You|Use|When|Respect|Return|Treat|Never|nonexclusive|ceilings)\b/);
 const seen=[];
 const result=await runEpisode(input(),{modelCall:async request=>{
  seen.push(request);const {observation:o,context}=JSON.parse(request.messages[1].content);
  assert.doesNotMatch(context.output_requirements.recommendation,/For ordered|Return complete|Respect top_k/);
  return {content:JSON.stringify({decision_id:o.decision_id,actions:[action('rank','recommend',{ordered_item_ids:['A'],delivery:'replace_pending'})]})};
 }});
 assert.equal(result.status,'submitted');assert.equal(seen.length,1);
});

test('active compatibility imports use the canonical functions',async()=>{
 const shared=await import('../shared/runtime.mjs'),canonical=await import('../../../demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs');
 const local=await import('../../../demos/agentic-feed/unified-demo.mjs'),demo=await import('../../../demos/agentic-feed-site/lib/waterfall/unified-demo.mjs');
 assert.equal(shared.createRuntime,canonical.createRuntime);assert.equal(shared.SYSTEM_PROMPT,canonical.SYSTEM_PROMPT);assert.equal(local.runDemo,demo.runDemo);
 const result=await shared.runEpisode(input(),{decide:async()=>decision([action('rank','recommend',{ordered_item_ids:['A'],delivery:'replace_pending'})])});
 assert.equal(result.runtime_source_sha256,(await import('../../../demos/agentic-feed-site/lib/waterfall/waterfall-version.mjs')).SOURCE_SHA256);
});
