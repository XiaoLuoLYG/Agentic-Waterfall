import {registerHooks} from 'node:module';

const source = new URL('./code/experiments/agentic-waterfall/shared/model-client.mjs', import.meta.url).href;
const client = new URL('../../full-agentrecbench-20261103/frozen/client.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    return result.url === source ? {url: client, shortCircuit: true} : result;
  },
});
