import assert from 'node:assert/strict';
import { runEpisode } from '../demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs';

const input = {
  observation: {
    decision_id: 'camera-tips',
    dialogue: [{ id: 'request', role: 'user', text: 'How do I film a football game from the sidelines?' }],
    environment: { candidate_pool: [] },
  },
  catalog: [
    { id: 'sideline-tips', title: 'Filming a game from the sidelines', source_id: 'offline', content_type: 'article' },
    { id: 'lens-review', title: 'A review of a portrait lens', source_id: 'offline', content_type: 'article' },
  ],
  protocol: { top_k: 1, max_model_calls: 2, max_tool_calls: 1 },
};

const result = await runEpisode(input, {
  decide(observation, { call_index }) {
    if (call_index === 0) {
      return { decision_id: observation.decision_id, actions: [{
        action_id: 'search',
        kind: 'acquire',
        arguments: { source_ids: ['offline'], mode: 'search', query: 'sidelines', limit: 1 },
      }] };
    }
    return { decision_id: observation.decision_id, actions: [{
      action_id: 'recommend',
      kind: 'recommend',
      arguments: { ordered_item_ids: [observation.environment.candidate_pool[0].id], delivery: 'append' },
    }] };
  },
});

assert.equal(result.status, 'submitted', result.error);
assert.deepEqual(result.ordered_item_ids, ['sideline-tips']);
const actions = result.trace.flatMap(step => step.execution_results.map(({ kind, status }) => ({ kind, status })));
assert.deepEqual(actions.map(action => action.kind), ['acquire', 'recommend']);
console.log(JSON.stringify({
  recommended: result.ordered_item_ids,
  actions,
  modelRequests: result.model_request_count,
}, null, 2));
