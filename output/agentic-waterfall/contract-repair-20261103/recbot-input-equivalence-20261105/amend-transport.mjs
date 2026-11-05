import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {HERE,BATCH,read,hash,ref} from './run-case.mjs';

const flag=process.argv[2]??'--check';assert.ok(['--check','--write'].includes(flag));
const summaryPath=resolve(HERE,'summary.json'),hashesPath=resolve(HERE,'sourcehashes.json');
const beforeSummary=ref(summaryPath),beforeHashes=ref(hashesPath),summary=read(summaryPath),sources=read(hashesPath);
const allowed=new Set(['model-client.mjs','ledger-store.mjs'].map(x=>resolve(BATCH,'transport-retry',x)));
const changes=[];
for(const source of summary.execution_sources){
 const current=ref(source.path);
 if(current.sha256!==source.sha256){assert.ok(allowed.has(source.path),'change is outside the authorized transport-only amendment');changes.push({before:{...source},after:current});}
}
for(const source of summary.bge_files){const info=statSync(source.path);assert.equal(info.size,source.size);assert.equal(info.mtimeMs,source.mtime_ms);}
if(flag==='--write'&&changes.length){
 const reason='Parent-authorized SQLite busy-retry transport repair; unchanged request payloads and model logic; no 90-second ledger wait introduced; same shared caps/RPM.';
 for(const change of changes){Object.assign(summary.execution_sources.find(x=>x.path===change.before.path),change.after);Object.assign(sources.files.find(x=>x.path===change.before.path),change.after);}
 const at=new Date().toISOString();
 summary.transport_amendments=[...(summary.transport_amendments??[]),{at,reason,changes}];
 assert.equal(hash(readFileSync(summaryPath)),beforeSummary.sha256);assert.equal(hash(readFileSync(hashesPath)),beforeHashes.sha256);
 writeFileSync(summaryPath,JSON.stringify(summary,null,2)+'\n');writeFileSync(hashesPath,JSON.stringify(sources,null,2)+'\n');
 appendFileSync(resolve(HERE,'transport-amendments.jsonl'),JSON.stringify({at,reason,changes,before_summary:beforeSummary,after_summary:ref(summaryPath),before_sourcehashes:beforeHashes,after_sourcehashes:ref(hashesPath),new_model_requests:0,original_617_input_audit_unchanged:true,bge_weights_rehashed:false})+'\n');
}
console.log(JSON.stringify({mode:flag,changes,model_requests:0,inputs_reaudited:0,bge_weights_rehashed:false}));
