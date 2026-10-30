import test from 'node:test';
import assert from 'node:assert/strict';
import {readModelResponse} from '../shared/model-client.mjs';

function stream(events,done=true){
 const text=events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+(done?'data: [DONE]\n\n':'');
 const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
test('fragmented UTF8 stream assembles content and retains final usage separately from thinking',async()=>{
 const response=await readModelResponse(stream([
  {model:'GLM-5.3-Flash',choices:[{index:0,delta:{reasoning_content:'thinking only'}}]},
  {choices:[{index:0,delta:{content:'{"title":"中文'}}]},
  {choices:[{index:0,delta:{content:'"}'},finish_reason:'stop'}]},
  {choices:[],usage:{prompt_tokens:10,completion_tokens:100,total_tokens:110}}
 ]));
 assert.equal(response.model,'GLM-5.3-Flash');assert.equal(response.choices[0].message.content,'{"title":"中文"}');assert.equal(response.choices[0].finish_reason,'stop');assert.equal(response.usage.total_tokens,110);
});
test('missing completion and service error preserve partial output without accepting it',async()=>{
 const partial={model:'GLM-5.3-Flash',choices:[{index:0,delta:{content:'partial'}}]};
 await assert.rejects(readModelResponse(stream([partial],false)),e=>e.message==='model_stream_incomplete'&&e.model_response.choices[0].message.content==='partial');
 await assert.rejects(readModelResponse(stream([partial,{error:{code:403,message:'denied'}}])),e=>e.message==='model_http_403'&&e.model_response.choices[0].message.content==='partial');
});
test('length termination stays explicit and ordinary JSON responses still work',async()=>{
 const response=await readModelResponse(stream([{choices:[{index:0,delta:{content:''},finish_reason:'length'}]}]));
 assert.equal(response.choices[0].finish_reason,'length');
 assert.deepEqual(await readModelResponse(Response.json({choices:[]})),{choices:[]});
});
