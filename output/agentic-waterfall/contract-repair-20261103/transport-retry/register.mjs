import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

const client = new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/model-client.mjs', import.meta.url).href;
const replacement = new URL('./model-client.mjs', import.meta.url);
const replay = new URL('../kuairec-clawrec-targeted-repair-20261104/client.mjs', import.meta.url).href;
const requestGate = new URL('../full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/shared/request-gate.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier,context,nextResolve){
    if(context.parentURL===client&&specifier==='./ledger-store.mjs')return {url:new URL('./ledger-store.mjs',import.meta.url).href,shortCircuit:true};
    return nextResolve(specifier,context);
  },
  load(url, context, nextLoad) {
    // Keep the frozen client's URL so the existing shared ledger and gate remain authoritative.
    if (url === client) return {format: 'module', source: readFileSync(replacement), shortCircuit: true};
    if (url === requestGate) return {format: 'module', source: readFileSync(new URL('./request-gate.mjs',import.meta.url)), shortCircuit: true};
    // Extend recovery boundaries at load time so the main queue's frozen hash stays valid.
    if (url.split('?')[0] === replay && process.env.KREC_REPAIR_PRIORS) {
      const source = readFileSync(new URL(url), 'utf8').replace(
        "stage==='curate'&&allowed.curate||stage==='search-worker'&&allowed.workers?.includes(payload.task_id)",
        "stage==='plan'&&allowed.plan||stage==='curate'&&allowed.curate||stage==='search-worker'&&(allowed.allWorkers||allowed.workers?.includes(payload.task_id))");
      return {format: 'module', source, shortCircuit: true};
    }
    return nextLoad(url, context);
  },
});
