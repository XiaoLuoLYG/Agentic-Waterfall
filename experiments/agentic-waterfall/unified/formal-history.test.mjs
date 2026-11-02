import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHistory} from './formal-history.mjs';
import {createRuntime, runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';

function fixture(count = 65) {
  return {observation: {decision_id: 'decision', user_id: 'alice', session_id: 'session', dialogue: [{id: 'command', text: 'keep command'}],
    behavior_events: Array.from({length: count}, (_, index) => ({id: `event-${index}`, type: 'click', item_id: `item-${index}`, text: index === 1 ? 'Archived ORCHID' : 'ordinary'})),
    user_state: {version: 1, records: [{id: 'preference', kind: 'preference', value: 'unchanged'}]},
    environment: {candidate_pool: [{id: 'a', title: 'candidate'}], sources: [], pending_queue: [], visible_item_ids: []}},
    protocol: {mode: 'fixed_candidates', top_k: 1, max_model_calls: 20, max_tool_calls: 0}};
}

test('all visible original history, commands and state are included without mutating the source',()=>{
 const source=fixture(),before=structuredClone(source),{input,lookupHistory}=prepareHistory(source);
 assert.deepEqual(source,before);assert.deepEqual(input.observation.behavior_events,before.observation.behavior_events);
 assert.deepEqual(input.observation.dialogue,before.observation.dialogue);assert.deepEqual(input.observation.user_state,before.observation.user_state);
 assert.equal(input.protocol.max_tool_calls,20);assert.equal(input.run_meta.history_protocol.omitted_visible_events,0);
 const current=createRuntime(input,{lookupHistory}).snapshot();
 assert.equal(current.behavior_events.length,65);assert.equal(current.environment.sources[0].initial_count,65);
 assert.equal(lookupHistory({query:'orchid',offset:0,limit:10},{observation:current}).behavior_events[0].id,'event-1');
});

test('complete history remains available even when records or candidate bodies exceed old byte thresholds',()=>{
 const source=fixture(82);source.observation.behavior_events[0].text='HEAD '+'x'.repeat(120000)+' TAIL';
 source.observation.environment.candidate_pool[0].text='c'.repeat(150000);
 const {input,lookupHistory}=prepareHistory(source),current=createRuntime(input,{lookupHistory}).snapshot();
 assert.equal(current.behavior_events.length,82);assert.equal(current.behavior_events[0].text,source.observation.behavior_events[0].text);
 assert.equal(current.environment.candidate_pool[0].text.length,150000);
 assert.equal(lookupHistory({query:'HEAD',offset:0,limit:1},{observation:current}).behavior_events[0].text,source.observation.behavior_events[0].text);
});

test('adding history access preserves enough allowance to inspect every native fixed candidate', async () => {
  const source=fixture();source.protocol={...source.protocol,max_tool_calls:22,max_model_calls:3};
  source.observation.environment.candidate_pool=Array.from({length:20},(_,i)=>({id:'item-'+i}));
  source.observation.environment.sources=[{id:'metadata',modes:['browse']}];
  const {input,lookupHistory}=prepareHistory(source);let phase=0;
  const action=(id,kind,args)=>({action_id:id,kind,arguments:args,evidence_refs:[],depends_on:[]});
  const result=await runEpisode(input,{lookupHistory,acquire:async()=>({items:[],actual_requests:1}),decide:async()=>({decision_id:'decision',actions:phase++===0?
    [action('history','lookup_history',{query:'',offset:0,limit:1}),...Array.from({length:22},(_,i)=>action('inspect-'+i,'acquire',{source_ids:['metadata'],mode:'browse',limit:1,target_id:String(i)}))]:
    [action('rank','recommend',{ordered_item_ids:['item-0'],delivery:'replace_pending'})]})});
  assert.equal(result.status,'submitted');assert.equal(result.tool_calls,23);
  assert(result.trace.flatMap(step=>step.execution_results).every(receipt=>receipt.status==='success'));
});

test('initial input and rereads exclude other users, forbidden policy evidence and future records',()=>{
 const source=fixture();source.observation.observed_at='2026-01-01T00:00:00Z';
 source.observation.behavior_events.unshift({id:'foreign',user_id:'bob'},{id:'future',available_at:'2027-01-01T00:00:00Z'},{id:'wrong-policy',visible_to_policy_id:'other'});
 const {input,lookupHistory}=prepareHistory(source),current=createRuntime(input,{lookupHistory}).snapshot();
 assert.equal(current.behavior_events.length,65);
 const found=lookupHistory({query:'',offset:0,limit:100},{observation:current});assert.equal(found.behavior_events.length,65);assert.equal(found.next_offset,null);
 assert.throws(()=>lookupHistory({},{observation:{...current,user_id:'bob'}}),/history_owner_mismatch/);
});

test('explicit history pagination has no hidden byte cutoff and retains full record text',()=>{
 const source=fixture(130);for(const row of source.observation.behavior_events)row.text='z'.repeat(2000);
 const {input,lookupHistory}=prepareHistory(source),current=createRuntime(input,{lookupHistory}).snapshot();
 const first=lookupHistory({query:'',offset:0,limit:100},{observation:current}),second=lookupHistory({query:'',offset:first.next_offset,limit:100},{observation:current});
 assert.equal(first.behavior_events.length,100);assert.equal(second.behavior_events.length,30);assert.equal(second.next_offset,null);
 assert.equal(new Set([...first.behavior_events,...second.behavior_events].map(x=>x.id)).size,130);
 assert([...first.behavior_events,...second.behavior_events].every(x=>x.text.length===2000));
});
