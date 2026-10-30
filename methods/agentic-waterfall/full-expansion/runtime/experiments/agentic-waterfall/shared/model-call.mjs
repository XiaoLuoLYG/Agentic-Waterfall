import {readFileSync,writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {callModel} from './model-client.mjs';
const {values}=parseArgs({options:{experiment:{type:'string'},request:{type:'string'},output:{type:'string'}}});
if(!values.experiment||!values.request||!values.output) throw new Error('--experiment --request --output required');
try {
  const result=await callModel(JSON.parse(readFileSync(values.request,'utf8')),{experiment:values.experiment});
  writeFileSync(values.output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,attempt_id:result.attempt_id,usage:result.usage}));
} catch(e) { writeFileSync(values.output,JSON.stringify({status:'failed',error:e.message,receipt:e.receipt||null},null,2)+'\n',{flag:'wx'}); process.exitCode=1; }
