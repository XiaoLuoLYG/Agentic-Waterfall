import test from 'node:test';
import assert from 'node:assert/strict';
import {demoModelCall} from '../lib/waterfall/unified-demo.mjs';
import {runEpisode} from '../lib/waterfall/waterfall-core.mjs';

test('demo transport preserves truncated output so the common core can correct it',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{
  calls++;
  const content=calls===1?'{"actions":[':JSON.stringify({decision_id:'demo-format',actions:[{action_id:'corrected',kind:'recommend',arguments:{ordered_item_ids:['one'],delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]});
  return Response.json({model:'synthetic',choices:[{message:{content},finish_reason:calls===1?'length':'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
 };
 try{
  const input={observation:{decision_id:'demo-format',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:[{id:'one',title:'One'}],sources:[]}},protocol:{mode:'fixed_candidates',require_full_ranking:true,top_k:1,max_model_calls:2}};
  const result=await runEpisode(input,{modelCall:demoModelCall({endpoint:'https://model.invalid/chat/completions',key:'synthetic',model:'synthetic'})});
  assert.equal(result.status,'submitted');assert.equal(calls,2);assert.equal(result.model_calls[0].content,'{"actions":[');assert.equal(result.model_calls[0].error,'model_output_truncated');assert.deepEqual(result.ordered_item_ids,['one']);
 }finally{globalThis.fetch=previous;}
});

test('HTTP failures retain status and a redacted provider explanation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid max_tokens',echo:'private-test-key'},{status:400}));
 await assert.rejects(()=>demoModelCall({endpoint:'https://model.invalid',key:'private-test-key',model:'fixture'})({messages:[]}),error=>{
  assert.equal(error.receipt.http_status,400);assert.match(error.receipt.response_body,/invalid max_tokens/);assert(!error.receipt.response_body.includes('private-test-key'));return true;
 });
});

test('demo uses the validated thinking configuration and preserves streamed usage',async t=>{
 let body,wait;
 t.mock.method(AbortSignal,'timeout',ms=>{wait=ms;return new AbortController().signal;});
 t.mock.method(globalThis,'fetch',async(_,options)=>{
  body=JSON.parse(options.body);
  return new Response('data: '+JSON.stringify({model:'fixture',choices:[{index:0,delta:{reasoning_content:'synthetic',content:'{}'},finish_reason:'stop'}],usage:{completion_tokens:9,completion_tokens_details:{reasoning_tokens:7}}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 const result=await demoModelCall({endpoint:'https://model.invalid',key:'synthetic',model:'fixture',timeoutMs:60000,requestParameters:{enable_thinking:false,thinking:{type:'disabled'},extra_body:{thinking:{type:'disabled'}}}},undefined,{thinkingMode:'enabled'})({messages:[],max_tokens:32768});
 assert.equal(wait,600000);assert.equal(body.stream,true);assert.equal(body.stream_options.include_usage,true);
 assert.equal(body.enable_thinking,true);assert.equal(body.thinking.type,'enabled');assert.equal(body.extra_body.thinking.type,'enabled');
 assert.equal(result.content,'{}');assert.equal(result.reasoning_content,'synthetic');assert.equal(result.stream_metadata.complete,true);assert.equal(result.usage.completion_tokens_details.reasoning_tokens,7);
 assert.equal(result.request_settings.thinking.type,'enabled');assert.equal(result.request_settings.max_tokens,32768);
});

test('demo preserves an interrupted stream as a failed receipt',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'{"partial"'}}]})+'\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 await assert.rejects(demoModelCall({endpoint:'https://model.invalid',key:'synthetic',model:'fixture'})({messages:[]}),error=>{
  assert.equal(error.receipt.status,'failed');assert.equal(error.receipt.partial_response.choices[0].message.content,'{"partial"');assert.equal(error.receipt.stream_diagnostic.complete,false);return true;
 });
});
