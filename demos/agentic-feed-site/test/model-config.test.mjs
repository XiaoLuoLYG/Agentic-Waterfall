import test from 'node:test';
import assert from 'node:assert/strict';
import {modelConfig,handleApi} from '../lib/waterfall/cloud-entry.mjs';
import {fixture} from './research-api-fixture.mjs';
test('cloud model override preserves credentials, endpoint, request settings and defaults',()=>{
 const raw={apiKey:'synthetic-secret',apiBase:'https://example.test/v1',recommendationModelName:'DeepSeek-V4.1-Flash'};
 const original=modelConfig(raw),corrected=modelConfig(raw,undefined,'DeepSeek-V4.1-Flash-1017');
 assert.equal(original.model,'DeepSeek-V4.1-Flash');assert.equal(corrected.model,'DeepSeek-V4.1-Flash-1017');
 assert.deepEqual({...corrected,model:original.model},original);assert.equal(raw.recommendationModelName,'DeepSeek-V4.1-Flash');
 assert.equal(modelConfig(null,undefined,'DeepSeek-V4.1-Flash-1017'),null);
});

test('cloud model calls use the rotated secret while preserving the bundled source configuration',async t=>{
 const {env}=fixture();env.WATERFALL_CONFIG=JSON.stringify({apiKey:'fixture-previous-key',apiBase:'https://model.example/v1',recommendationModelName:'fixture-model',providers:{ZHIHU_API_KEY:'fixture-source-key'}});env.WATERFALL_API_KEY='fixture-replacement-key';
 const config=await (await handleApi(new Request('https://app.test/api/config'),env)).json();
 assert.equal(config.sources.find(source=>source.id==='zhihu').configured,true);
 assert.ok(!JSON.stringify(config).includes('fixture-previous-key'));assert.ok(!JSON.stringify(config).includes('fixture-replacement-key'));
 const identity=await handleApi(new Request('https://app.test/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'rotated-key-test',type:'agent'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];
 let authorization;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://model.example/v1/chat/completions');authorization=options.headers.Authorization;return Response.json({choices:[{message:{content:'虚构测试人物'}}]});});
 const result=await handleApi(new Request('https://app.test/api/generate-profile',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({prompt:'测试人物'})}),env);
 assert.equal(result.status,200);assert.equal(authorization,'Bearer fixture-replacement-key');
});
