import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';
import {callModel} from '../shared/model-client.mjs';

const {values}=parseArgs({options:{experiment:{type:'string'},input:{type:'string'},output:{type:'string'},variant:{type:'string',default:'full'}}});
if(!values.experiment||!values.input||!values.output)throw Error('--experiment --input --output required');
const inputs=readFileSync(values.input,'utf8').split('\n').filter(line=>line.trim()).map(JSON.parse);
writeFileSync(values.output,'',{flag:'wx'});let failed=0;
for(const input of inputs){
 let result;try{result=await runEpisode(input,{experiment:values.experiment,variant:values.variant,modelCall:callModel});}catch(error){result={decision_id:input.observation?.decision_id,status:'failed',error:error.message};}
 appendFileSync(values.output,JSON.stringify(result)+'\n');if(result.status==='failed')failed++;
 console.log(JSON.stringify({decision_id:result.decision_id,status:result.status,error:result.error,model_request_count:result.model_request_count}));
}
console.log(JSON.stringify({samples:inputs.length,failed,output:values.output}));if(failed)process.exitCode=2;
