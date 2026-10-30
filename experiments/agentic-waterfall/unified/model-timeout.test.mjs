import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTimeoutMs} from '../shared/model-client.mjs';
test('full-run timeout is explicit and bounded, old callers keep 60 seconds',()=>{
 const previous=process.env.WATERFALL_MODEL_TIMEOUT_MS;
 try{delete process.env.WATERFALL_MODEL_TIMEOUT_MS;assert.equal(modelTimeoutMs(),60000);process.env.WATERFALL_MODEL_TIMEOUT_MS='180000';assert.equal(modelTimeoutMs(),180000);for(const invalid of ['0','180001','bad','1.5']){process.env.WATERFALL_MODEL_TIMEOUT_MS=invalid;assert.throws(()=>modelTimeoutMs(),/invalid_model_timeout/);}}finally{if(previous===undefined)delete process.env.WATERFALL_MODEL_TIMEOUT_MS;else process.env.WATERFALL_MODEL_TIMEOUT_MS=previous;}
});
test('only the selected reasoning model permits the longer explicit wait',()=>{
 const previous=process.env.WATERFALL_MODEL_TIMEOUT_MS;
 try{process.env.WATERFALL_MODEL_TIMEOUT_MS='600000';assert.equal(modelTimeoutMs('GLM-5.3-Flash'),600000);assert.throws(()=>modelTimeoutMs('DeepSeek-V4.1-Flash'),/invalid_model_timeout/);process.env.WATERFALL_MODEL_TIMEOUT_MS='600001';assert.throws(()=>modelTimeoutMs('GLM-5.3-Flash'),/invalid_model_timeout/);}finally{if(previous===undefined)delete process.env.WATERFALL_MODEL_TIMEOUT_MS;else process.env.WATERFALL_MODEL_TIMEOUT_MS=previous;}
});
