import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareHistory} from './formal-history.mjs';
import {createRuntime} from '../../../demos/agentic-feed/waterfall-core.mjs';

function fixture(count = 65) {
  return {observation: {decision_id: 'decision', user_id: 'alice', session_id: 'session', dialogue: [{id: 'command', text: 'keep command'}],
    behavior_events: Array.from({length: count}, (_, index) => ({id: `event-${index}`, type: 'click', item_id: `item-${index}`, text: index === 1 ? 'Archived ORCHID' : 'ordinary'})),
    user_state: {version: 1, records: [{id: 'preference', kind: 'preference', value: 'unchanged'}]},
    environment: {candidate_pool: [{id: 'a', title: 'candidate'}], sources: [], pending_queue: [], visible_item_ids: []}},
    protocol: {mode: 'fixed_candidates', top_k: 1, max_model_calls: 20, max_tool_calls: 0}};
}

test('recent window retains original input, commands and state; archive remains visible to core', () => {
  const source = fixture(), before = structuredClone(source), {input, lookupHistory} = prepareHistory(source);
  assert.deepEqual(source, before);
  assert.deepEqual(input.observation.behavior_events.map(row => row.id), before.observation.behavior_events.slice(-60).map(row => row.id));
  assert.deepEqual(input.observation.dialogue, before.observation.dialogue);
  assert.deepEqual(input.observation.user_state, before.observation.user_state);
  assert.equal(input.protocol.max_tool_calls, 20);
  const current = createRuntime(input, {lookupHistory}).snapshot();
  assert.equal(current.environment.sources[0].total_count, 65);
  assert.equal(current.environment.recommendation_constraints.history_lookup_enabled, true);
  assert.deepEqual(lookupHistory({query: '', offset: 0, limit: 2}, {observation: current}).behavior_events.map(row => row.id), ['event-4', 'event-3']);
  assert.equal(lookupHistory({query: '', offset: 0, limit: 2}, {observation: current}).next_offset, 2);
  assert.equal(lookupHistory({query: 'orchid', offset: 0, limit: 10}, {observation: current}).behavior_events[0].id, 'event-1');
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
