import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {installMeteredFetch} from './api.mjs';
import {loadDualDataset} from './check-dual-dataset.mjs';
import {comparisonMethods, runComparison, verifyWeights} from './comparison.mjs';

const {values}=parseArgs({options:{dataset:{type:'string'},out:{type:'string'},config:{type:'string'},
 protocol:{type:'string',default:'independent-recall'},check:{type:'boolean',default:false}}});
assert(values.dataset,'--dataset must point to the extracted waterfall-dataset-v1-full directory');
assert(['shared-shortlist','independent-recall'].includes(values.protocol),'unknown protocol');
const {inputs,tracks,ready}=loadDualDataset(values.dataset);
if(values.check){
 console.log(JSON.stringify({users:tracks.size,checkpoints:inputs.length,pools:ready.pools.counts,model_requests:0},null,2));
}else{
 assert(values.out&&values.config,'--out and --config are required for a model run');
 const weights=JSON.parse(readFileSync(new URL('../../../output/agentic-waterfall/comparison-20261106-synthetic-10x20-all-methods-v4/bge-model-source-manifest.json',import.meta.url)));
 await verifyWeights(weights);
 const root=resolve(values.out);mkdirSync(root,{mode:0o700});
 const abort=new AbortController();
 const stop=()=>abort.abort(Error('run interrupted'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let api;
 try{
  api=await installMeteredFetch({configPath:resolve(values.config),outputDir:root});
  const checks=await api.preflight({includePro:false,verifyThinking:true});
  assert(checks.some(check=>check.ok),'no model key passed the preflight');
  writeFileSync(join(root,'plan.json'),JSON.stringify({dataset:resolve(values.dataset),protocol:values.protocol,
   dataset_manifest_sha256:ready.manifest_sha256,comparison_cutoffs_sha256:ready.comparison_cutoffs_sha256,
   pools:ready.pools,methods:comparisonMethods,checkpoints:inputs.length,model:api.flashModel},null,2)+'\n',{mode:0o600});
  const result=await runComparison({root:join(root,'comparison'),inputs,api,dualPool:ready.pools,
   independentRecall:values.protocol==='independent-recall',signal:abort.signal});
  console.log(JSON.stringify({output:root,status:result.status,coverage:result.coverage},null,2));
  assert.equal(result.status,'completed','comparison is incomplete; inspect comparison/analysis.json');
 }finally{
  await api?.drain();api?.restore();
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 }
}
