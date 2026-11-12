import {readFileSync} from 'node:fs';
import {runEpisode} from '../../../../demos/agentic-feed/waterfall-core.mjs';
const rows=readFileSync(0,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
for(const input of rows){
 input.protocol={...input.protocol,delivery_scope:'offline_slate'};
 let messages;
 const result=await runEpisode(input,{modelCall:async request=>{messages=request.messages;throw new Error('preflight_capture_only');}});
 if(!messages)throw new Error(result.error||'no_model_request_to_inspect');
 const observation=JSON.parse(messages[1].content).observation;
 console.log(JSON.stringify({decision_id:observation.decision_id,model_message_bytes:Buffer.byteLength(JSON.stringify(messages)),
  visible_candidate_count:observation.environment.candidate_pool.length,visible_behavior_events:observation.behavior_events.length,
  context_capacity_validated:false,context_validation_reason:'No provider tokenizer and context limit validator is configured; bytes are diagnostic only.'}));
}
