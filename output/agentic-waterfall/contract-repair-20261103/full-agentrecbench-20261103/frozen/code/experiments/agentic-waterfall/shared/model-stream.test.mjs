import test from 'node:test';
import assert from 'node:assert/strict';
import {readModelResponse} from './model-client.mjs';
function stream(frames){
 const bytes=new TextEncoder().encode(frames.join(''));
 return new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
}
const data=x=>'data: '+JSON.stringify(x)+'\r\n\r\n';
test('stream preserves fragmented UTF8, reasoning, content and final usage without truncation',async()=>{
 const result=await readModelResponse(stream([': keepalive\r\n\r\n',data({model:'frozen',choices:[{index:0,delta:{reasoning_content:'synthetic 中文'}}]}),data({choices:[{index:0,delta:{content:'{"a":'}}]}),data({choices:[{index:0,delta:{content:'1}'},finish_reason:'stop'}]}),data({choices:[],usage:{completion_tokens:12,completion_tokens_details:{reasoning_tokens:8}}}),'data: [DONE]\r\n\r\n']));
 assert.equal(result.choices[0].message.content,'{"a":1}');assert.equal(result.choices[0].message.reasoning_content,'synthetic 中文');assert.equal(result.usage.completion_tokens,12);assert.equal(result.stream_metadata.complete,true);assert.equal(result.stream_metadata.events,4);
});
test('an interrupted stream retains its partial result and never fabricates completion',async()=>{
 await assert.rejects(readModelResponse(stream([data({choices:[{index:0,delta:{content:'{"incomplete"'}}]})])),e=>{assert.equal(e.message,'model_transport_error');assert.equal(e.partialResponse.choices[0].message.content,'{"incomplete"');assert.equal(e.streamDiagnostic.complete,false);return true;});
});
test('JSON fallback and explicit provider length termination remain visible',async()=>{
 assert.deepEqual(await readModelResponse(new Response('{"choices":[]}')), {choices:[]});
 const r=await readModelResponse(stream([data({choices:[{index:0,delta:{reasoning_content:'synthetic'},finish_reason:'length'}]}),'data: [DONE]\n\n']));assert.equal(r.choices[0].finish_reason,'length');assert.equal(r.choices[0].message.content,'');
});
