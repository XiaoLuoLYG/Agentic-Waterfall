import {registerHooks} from 'node:module';

const client = new URL('./code/experiments/agentic-waterfall/shared/model-client.mjs', import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url !== client) return nextLoad(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: `
        import assert from 'node:assert/strict';
        export async function callModel(request) {
          const input = JSON.parse(request.messages[1].content.split('\\nINPUT: ').at(-1));
          assert.deepEqual(input.task_context, {user_metadata: {name:'Visible'}, category: 'books', location: null});
          if (input.history) assert.deepEqual(input.history, []);
          else assert.deepEqual(input.candidates.map(x => x.text), Array.from({length:20}, (_, i) => 'Visible ' + i));
          const reply = input.history ? {user_state_md: ''} : {ordered_indices: Array.from({length:20}, (_, i) => 20-i)};
          return {status:'success',provider_response_model:'offline-fixture',content:JSON.stringify(reply)};
        }`
    };
  },
});
