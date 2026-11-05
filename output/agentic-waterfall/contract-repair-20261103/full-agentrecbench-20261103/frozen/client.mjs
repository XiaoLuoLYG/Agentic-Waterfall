import {callModel as live} from './code/experiments/agentic-waterfall/shared/model-client.mjs';
export async function callModel(request, options){
 const receipt=await live(request,options);
 if(receipt.provider_response_model!=='DeepSeek-V4.1-Flash-1017'){
   const error=Error('baseline_provider_model_mismatch');error.receipt=receipt;throw error;
 }
 return receipt;
}
