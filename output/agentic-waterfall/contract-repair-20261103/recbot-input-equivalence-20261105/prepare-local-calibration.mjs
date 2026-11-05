import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {HERE,read,checked,hash,capture,nativeInput,verifyResources} from './run-case.mjs';
import {readFileSync} from 'node:fs';

verifyResources(read(resolve(HERE,'summary.json')));
const rows=readFileSync(resolve(HERE,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const output=resolve(HERE,'local-calibration');mkdirSync(resolve(output,'inputs'),{recursive:true});
const assignments=[];
for(const item of read(resolve(HERE,'pilot6.json')).cases){
 const row=rows.find(x=>x.task_id===item.task_id);
 const input=await nativeInput(checked(row.current_input));
 const effective=await capture(input,JSON.parse(checked(row.stages.parser.response).content));
 assert.equal(effective.embedding===null?null:hash(effective.embedding),row.embedding.current_payload_sha256);
 const path=effective.embedding===null?null:resolve(output,'inputs',item.task_id.replaceAll(':','-')+'.json');
 if(path)writeFileSync(path,JSON.stringify(effective.embedding)+'\n');
 assignments.push({task_id:item.task_id,path,payload_sha256:effective.embedding===null?null:hash(effective.embedding),
  reason:item.reason,embedding_skipped:effective.embedding===null});
}
writeFileSync(resolve(output,'assignment.json'),JSON.stringify({method_prediction:false,scoring:false,model_requests:0,
 planner_assumption:'all supplied candidates allowed solely to calibrate identical local embedding inputs; this is not a method prediction',assignments},null,2)+'\n');
console.log(JSON.stringify({cases:assignments.length,embedding_cases:assignments.filter(x=>x.path).length,model_requests:0}));
