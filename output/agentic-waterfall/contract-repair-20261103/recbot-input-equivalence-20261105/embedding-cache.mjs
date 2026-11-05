import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {HERE,METHOD,read,hash} from './run-case.mjs';

export const CACHE=resolve(HERE,'embedding-precompute');
export function fingerprint(){
 const summary=read(resolve(HERE,'summary.json'));
 const calibration=read(resolve(HERE,'local-calibration/calibration.json'));
 const sources=summary.execution_sources.filter(x=>[resolve(METHOD,'recbot/semantic.py'),resolve(METHOD,'fixed-retrieval/retrieval.py')].includes(x.path));
 const resident=resolve(HERE,'resident-bge.py');
 assert.equal(hash(readFileSync(resident)),calibration.source_sha256[resident]);
 return hash({sources,bge:summary.bge_files.map(({path,sha256})=>({path,sha256})),resident_source_sha256:calibration.source_sha256[resident]});
}

export function cachedScores(record,payload,implementation){
 assert.equal(record.payload_sha256,hash(payload));assert.equal(record.implementation_sha256,implementation);
 assert.equal(record.scores_sha256,hash(record.scores));
 const ids=payload.items.map(x=>x.id);
 for(const field of ['semantic','negative']){
  assert.deepEqual(Object.keys(record.scores[field]),ids);
  assert.ok(ids.every(id=>Number.isFinite(record.scores[field][id])));
 }
 return record.scores;
}

export function waitingCache(){
 const implementation=fingerprint();
 let lastProgress=null,checkedAt=0;
 return async payload=>{
  const path=resolve(CACHE,'scores',hash(payload)+'.json');
  while(!existsSync(path)){
   if(Date.now()-checkedAt>500){lastProgress=read(resolve(CACHE,'progress.json'));checkedAt=Date.now();}
   const progress=lastProgress;
   assert.equal(progress.implementation_sha256,implementation);
   if(progress.status!=='running')throw Error('embedding cache unresolved: '+progress.status);
   await delay(500);
  }
  return cachedScores(read(path),payload,implementation);
 };
}
