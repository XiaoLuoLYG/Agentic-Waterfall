import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareInputs } from './comparison.mjs';
import { readDualContentPools } from './comparison-pool.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path));
const pinned = ({path, sha256}) => {
  const bytes=readFileSync(path);
  assert.equal(hash(bytes),sha256,'frozen input changed: '+path);
  return JSON.parse(bytes);
};

export function loadDualDataset(root) {
  root=resolve(root);
  const released=existsSync(join(root,'ready.json'))?null:read(join(root,'manifest.json'));
  if(released)assert.equal(released.package,'waterfall-dataset-v1-full');
  const ready=released?{
    status:'accepted_synthetic_dataset',dataset:join(root,'dataset'),
    manifest_sha256:released.packaged_sha256.normalized_manifest,
    comparison_cutoffs_sha256:released.packaged_sha256.cutoffs,
    people:released.counts.users,checkpoints:released.counts.evaluation_checkpoints,
    pools:{directory:join(root,'content-pools'),manifest_sha256:released.packaged_sha256.pool_manifest,
      counts:released.counts.pools,filenames:{C0:'base.jsonl.gz',Cext:'expansion.jsonl.gz'}}
  }:read(join(root,'ready.json'));
  assert.equal(ready.status,'accepted_synthetic_dataset');
  const manifest=pinned({path:join(ready.dataset,'main','manifest.json'),sha256:ready.manifest_sha256});
  assert.equal(manifest.collection_protocol,'synthetic-collection/3');
  assert.equal(manifest.ready_for_synthetic_comparison,true);
  if(released){
    assert.equal(manifest.dual_evaluation_pool.manifest_sha256,ready.pools.manifest_sha256);
    assert.deepEqual(manifest.dual_evaluation_pool.counts,ready.pools.counts);
  }else assert.deepEqual(manifest.dual_evaluation_pool,ready.pools);
  const index=pinned({path:join(root,'comparison-cutoffs.json'),sha256:ready.comparison_cutoffs_sha256});
  assert.equal(index.checkpoints.length,ready.checkpoints);
  const personas=new Map(Object.entries(index.persona_sha256).map(([user, sha256])=>{
    assert(/^u\d+$/.test(user));
    const {id,subset,hidden_profile}=pinned({path:join(root,'full','users',user,'persona.json'),sha256});
    assert.equal(id,user);
    return [user,{id,subset,hidden_profile}];
  }));
  const inputs=index.checkpoints.map(({user,round,subset,context_sha256,goal,hard})=>{
    const persona=personas.get(user);
    assert(persona?.subset===subset&&Number.isSafeInteger(round)&&round>0);
    const file=join(root,'full','users',user,'checkpoints','r'+String(round).padStart(4,'0')+'.json');
    const context=pinned({path:file,sha256:context_sha256});
    return {user,round,persona,phase:{goal,hard},context};
  });
  const tracks=prepareInputs(inputs);
  assert.equal(tracks.size,ready.people);
  const sourceIds=input=>input.context.snapshot.available_sources.map(x=>x.id).sort();
  const roster=sourceIds(inputs[0]);
  for(const input of inputs)assert.deepEqual(sourceIds(input),roster);
  const pools=readDualContentPools(ready.pools,roster);
  if(!released)assert.deepEqual(Object.fromEntries(Object.entries(pools).map(([side,pool])=>[side,pool.lineage])),ready.pool_read_lineage);
  return {inputs,tracks,pools,ready};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert(process.argv[2],'Usage: node check-dual-dataset.mjs DATASET_RUN_DIR');
  const {inputs,tracks,pools,ready}=loadDualDataset(process.argv[2]);
  console.log(JSON.stringify({participants:tracks.size,checkpoints:inputs.length,counts:ready.pools.counts,
    sources:pools.C0.lineage.selected_sources.length,minimum_unseen:ready.minimum_unseen,method_runs_started:0},null,2));
}
