import {readFileSync} from 'node:fs';
import {createRuntime,SYSTEM_PROMPT} from '../../../../demos/agentic-feed/waterfall-core.mjs';
const rows=readFileSync(0,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
for(const input of rows){
 const runtime=createRuntime(input,{variant:'full'});
 const observation=runtime.snapshot();
 const messages=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:JSON.stringify({observation,context:{variant:'full',call_index:0,remaining_model_calls:runtime.protocol.max_model_calls}})}];
 const bytes=Buffer.byteLength(JSON.stringify(messages));
 console.log(JSON.stringify({decision_id:observation.decision_id,model_message_bytes:bytes,headroom:100000-bytes}));
 if(bytes>85000)throw new Error('Actual shared model messages exceed conservative 85KB preflight');
}
