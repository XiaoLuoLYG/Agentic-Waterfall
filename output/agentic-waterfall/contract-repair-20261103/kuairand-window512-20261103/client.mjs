import {setTimeout as delay} from 'node:timers/promises';
import {callModel as live} from '../full-agentrecbench-20261103/frozen/client.mjs';

export async function callModel(request,options){
  const routed={...options,experiment:'method-deployment'};
  try {
    return await live(request,routed);
  } catch (error) {
    if (![502,503,504].includes(error.receipt?.http_error?.status)) throw error;
    const first=error.receipt;
    await delay(750);
    try {
      const receipt=await live(request,routed);
      return {...receipt,service_attempts:[first,...(receipt.service_attempts||[])]};
    } catch (retryError) {
      if (retryError.receipt) retryError.receipt.service_attempts=[first,...(retryError.receipt.service_attempts||[])];
      throw retryError;
    }
  }
}
