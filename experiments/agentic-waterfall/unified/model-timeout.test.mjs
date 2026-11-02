import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTimeoutMs} from '../shared/model-client.mjs';
test('full-run timeout is explicit and bounded, old callers keep 60 seconds',()=>{
 const previous=process.env.WATERFALL_MODEL_TIMEOUT_MS;
 try{delete process.env.WATERFALL_MODEL_TIMEOUT_MS;assert.equal(modelTimeoutMs(),60000);process.env.WATERFALL_MODEL_TIMEOUT_MS='180000';assert.equal(modelTimeoutMs(),180000);process.env.WATERFALL_MODEL_TIMEOUT_MS='600000';assert.equal(modelTimeoutMs(),600000);for(const invalid of ['0','600001','bad','1.5']){process.env.WATERFALL_MODEL_TIMEOUT_MS=invalid;assert.throws(()=>modelTimeoutMs(),/invalid_model_timeout/);}}finally{if(previous===undefined)delete process.env.WATERFALL_MODEL_TIMEOUT_MS;else process.env.WATERFALL_MODEL_TIMEOUT_MS=previous;}
});
