import {runEpisode as runUnifiedEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';
import {callModel} from './model-client.mjs';
export * from '../../../demos/agentic-feed/waterfall-core.mjs';
export const runEpisode=(input,options={})=>runUnifiedEpisode(input,{modelCall:callModel,...options});
