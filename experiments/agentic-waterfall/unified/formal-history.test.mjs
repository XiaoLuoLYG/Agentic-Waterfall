import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareHistory} from './formal-history.mjs';
import {createRuntime, runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';

function fixture(count = 65) {
  return {observation: {decision_id: 'decision', user_id: 'alice', session_id: 'session', dialogue: [{id: 'command', text: 'keep command'}],
    behavior_events: Array.from({length: count}, (_, index) => ({id: `event-${index}`, type: 'click', item_id: `item-${index}`, text: index === 1 ? 'Archived ORCHID' : 'ordinary'})),
    user_state: {version: 1, records: [{id: 'preference', kind: 'preference', value: 'unchanged'}]},
    environment: {candidate_pool: [{id: 'a', title: 'candidate'}], sources: [], pending_queue: [], visible_item_ids: []}},
    protocol: {mode: 'fixed_candidates', top_k: 1, max_model_calls: 20, max_tool_calls: 0}};
}

test('recent window retains original input, commands and state; archive remains visible to core', () => {
  const source = fixture(), before = structuredClone(source), {input, lookupHistory} = prepareHistory(source);
  assert.equal(createHash('sha256').update(JSON.stringify(input)).digest('hex'), '7a4cd993903d2db9d3e6cd65311e6bcae50a7f7d854bbe347f5b4246cfd440c0');
  assert.deepEqual(source, before);
  assert.deepEqual(input.observation.behavior_events.map(row => row.id), before.observation.behavior_events.slice(-60).map(row => row.id));
  assert.deepEqual(input.observation.dialogue, before.observation.dialogue);
  assert.deepEqual(input.observation.user_state, before.observation.user_state);
  assert.equal(input.protocol.max_tool_calls, 20);
  assert(!/\p{Script=Han}/u.test(input.observation.environment.sources.at(-1).description));
  const current = createRuntime(input, {lookupHistory}).snapshot();
  assert.equal(current.environment.sources[0].total_count, 65);
  assert.equal(current.environment.recommendation_constraints.history_lookup_enabled, true);
  assert.deepEqual(lookupHistory({query: '', offset: 0, limit: 2}, {observation: current}).behavior_events.map(row => row.id), ['event-4', 'event-3']);
  assert.equal(lookupHistory({query: '', offset: 0, limit: 2}, {observation: current}).next_offset, 2);
  assert.equal(lookupHistory({query: 'orchid', offset: 0, limit: 10}, {observation: current}).behavior_events[0].id, 'event-1');
});

test('history envelope counts public retrieval metadata retained by the core merge', () => {
  const source=fixture();
  for(const event of source.observation.behavior_events.slice(0,5))event.text='x'.repeat(4000);
  source.observation.environment.candidate_pool=Array.from({length:80},(_,i)=>({id:'item-'+i,title:'candidate',retrieval_query:'q'.repeat(700),retrieval_score:i,duration_ms:10000,retrieval_backend:'public'}));
  const {input,lookupHistory}=prepareHistory(source),current=createRuntime(input,{lookupHistory}).snapshot();
  const result=lookupHistory({query:'xxx',offset:0,limit:5},{observation:current});
  assert.equal(result.budget_full,true);assert(result.behavior_events.length<5);
  assert.equal(input.observation.environment.sources.at(-1).total_count,65);
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

test('lookups exclude visible duplicates, other owners and future events', () => {
  const source = fixture();
  source.observation.observed_at = '2026-01-01T00:00:00Z';
  source.observation.behavior_events.unshift({id: 'foreign', user_id: 'bob'}, {id: 'future', available_at: '2027-01-01T00:00:00Z'});
  const {input, lookupHistory} = prepareHistory(source), current = createRuntime(input, {lookupHistory}).snapshot();
  current.behavior_events.push({id: 'event-4'});
  const result = lookupHistory({query: '', offset: 0, limit: 100}, {observation: current});
  assert.deepEqual(result.behavior_events.map(row => row.id), ['event-3', 'event-2', 'event-1', 'event-0']);
  assert.throws(() => lookupHistory({query: '', offset: 0, limit: 1}, {observation: {...current, user_id: 'bob'}}), /history_owner_mismatch/);
});

test('context-full returns no new events and unchanged cursor without deleting archive', () => {
  const {input, lookupHistory} = prepareHistory(fixture()), current = createRuntime(input, {lookupHistory}).snapshot();
  const full = {...current, user_state: {version: 1, records: [{id: 'large', value: 'x'.repeat(85000)}]}};
  const result = lookupHistory({query: '', offset: 1, limit: 10}, {observation: full});
  assert.deepEqual(result.behavior_events, []); assert.equal(result.next_offset, 1); assert.equal(result.budget_full, true);
  assert.equal(lookupHistory({query: 'orchid', offset: 0, limit: 10}, {observation: current}).behavior_events[0].id, 'event-1');
});

test('single-candidate size also limits added history when compact merge is small', () => {
  const {input, lookupHistory} = prepareHistory(fixture()), current = createRuntime(input, {lookupHistory}).snapshot();
  current.environment.candidate_pool[0].text = 'x'.repeat(40000);
  current.environment.candidate_pool.push({id: 'b', text: '汉'.repeat(28000)});
  assert.equal(lookupHistory({query: '', offset: 0, limit: 10}, {observation: current}).budget_full, true);
});

test('fewer than 60 large events are packed with headroom and all archived originals remain queryable', async () => {
  const source = fixture(27);
  for (const event of source.observation.behavior_events) event.url = 'https://example.com/?tracking=' + 'x'.repeat(4200);
  const before = structuredClone(source), {input, lookupHistory} = prepareHistory(source);
  assert.deepEqual(source, before);
  assert.deepEqual(input.observation.user_state, before.observation.user_state);
  assert.deepEqual(input.observation.dialogue, before.observation.dialogue);
  const initial = input.observation.behavior_events.length;
  assert.ok(initial < 27);
  assert.deepEqual(input.observation.behavior_events, before.observation.behavior_events.slice(-initial));
  assert.equal(input.observation.environment.sources.at(-1).initial_count, initial);
  assert.equal(input.run_meta.history_protocol.initial_events, initial);
  assert.equal(input.run_meta.history_protocol.version, 'recent60-byte-bounded-with-original-history-lookup-v2');
  const current = createRuntime(input, {lookupHistory}).snapshot();
  for (const event of before.observation.behavior_events.slice(0, -initial)) {
    const found = lookupHistory({query: `"id":"${event.id}"`, offset: 0, limit: 1}, {observation: current});
    assert.deepEqual(found.behavior_events, [event]);
  }
  let messageBytes;
  const result = await runEpisode(input, {lookupHistory, modelCall: async ({messages}) => {
    messageBytes = Buffer.byteLength(JSON.stringify(messages));
    return {content: JSON.stringify({decision_id: 'decision', actions: [{action_id: 'recommend', kind: 'recommend', depends_on: [], evidence_refs: [], arguments: {ordered_candidate_indices: [1], delivery: 'replace_pending'}}]})};
  }});
  assert.equal(result.status, 'submitted');
  assert.ok(messageBytes < 50000, `initial model input was ${messageBytes} bytes`);
});

test('a single event above the initial target remains retrievable when the initial count is zero', () => {
  const source = fixture(2);
  for (const event of source.observation.behavior_events) event.text = 'x'.repeat(60000);
  const {input, lookupHistory} = prepareHistory(source);
  assert.deepEqual(input.observation.behavior_events, []);
  assert.equal(input.observation.environment.sources.at(-1).initial_count, 0);
  const current = createRuntime(input, {lookupHistory}).snapshot();
  assert.deepEqual(lookupHistory({query: '', offset: 0, limit: 1}, {observation: current}).behavior_events, [source.observation.behavior_events[1]]);
  assert.deepEqual(lookupHistory({query: '"id":"event-0"'}, {observation: current}).behavior_events, [source.observation.behavior_events[0]]);
});

test('byte-bounded archives still enforce owner, time and policy visibility', () => {
  const source = fixture(27);
  for (const event of source.observation.behavior_events) event.text = 'x'.repeat(4200);
  source.observation.observed_at = '2026-01-01T00:00:00Z';
  source.observation.behavior_events.unshift({id: 'foreign', user_id: 'bob'}, {id: 'future', available_at: '2027-01-01T00:00:00Z'}, {id: 'other-policy', visible_to_policy_id: 'other'});
  const {input, lookupHistory} = prepareHistory(source), current = createRuntime(input, {lookupHistory}).snapshot();
  assert.ok(current.behavior_events.length < 27);
  for (const query of ['foreign', 'future', 'other-policy']) assert.deepEqual(lookupHistory({query}, {observation: current}).behavior_events, []);
  assert.throws(() => lookupHistory({}, {observation: {...current, user_id: 'bob'}}), /history_owner_mismatch/);
  assert.equal(lookupHistory({query: '"id":"event-0"'}, {observation: current}).behavior_events[0].id, 'event-0');
});

test('an event that cannot fit alone in the lookup envelope fails explicitly without changing the source', () => {
  const source = fixture(1);
  source.observation.behavior_events[0].text = 'x'.repeat(120000);
  const before = structuredClone(source);
  assert.throws(() => prepareHistory(source), /history_event_byte_budget_exceeded/);
  assert.deepEqual(source, before);
});
