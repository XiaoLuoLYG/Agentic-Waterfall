import test from 'node:test';
import assert from 'node:assert/strict';
import {modelConfig} from '../lib/waterfall/cloud-entry.mjs';
test('cloud model override preserves credentials, endpoint, request settings and defaults',()=>{
 const raw={apiKey:'synthetic-secret',apiBase:'https://example.test/v1',recommendationModelName:'DeepSeek-V4.1-Flash'};
 const original=modelConfig(raw),corrected=modelConfig(raw,undefined,'DeepSeek-V4.1-Flash-1017');
 assert.equal(original.model,'DeepSeek-V4.1-Flash');assert.equal(corrected.model,'DeepSeek-V4.1-Flash-1017');
 assert.deepEqual({...corrected,model:original.model},original);assert.equal(raw.recommendationModelName,'DeepSeek-V4.1-Flash');
 assert.equal(modelConfig(null,undefined,'DeepSeek-V4.1-Flash-1017'),null);
});
