import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {executePolicy} from '../lib/waterfall/core.mjs';
import {plainSummary} from '../public/content-text.js';
import {buildEpisode} from '../lib/waterfall/research-episode.mjs';

test('steam and encoded HTML summaries show readable text without losing ordinary brackets',()=>{
  assert.equal(plainSummary('[p]\\[ GAMEPLAY ][/p][list][*]Fixed bugs[/list]','steam'),'[ GAMEPLAY ] Fixed bugs');
  assert.equal(plainSummary('&lt;p&gt;你好 &amp;amp; 欢迎&lt;/p&gt;','cnnews'),'你好 & 欢迎');
  assert.equal(plainSummary('Camera [RAW] format','zhihu'),'Camera [RAW] format');
  assert.equal(plainSummary('x < 3 and y > 2','zhihu'),'x < 3 and y > 2');
});

test('invalid ranked ids are corrected by a second model call and both calls are recorded',async t=>{
 let rankCalls=0;const model=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);const rank=request.messages[0].content.includes('Phase rank.');let output;
 if(!rank)output={actions:[{type:'acquire',source:'local',query:'science',mode:'search',modality:'text'}]};else {rankCalls++;const input=JSON.parse(request.messages[1].content);const good=input.tool_results.flatMap(x=>x.items)[0].id;output={actions:[{type:'recommend',candidate_ids:rankCalls===1?['invented-id',good]:[good],reason:'测试'}]};}
 res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));});await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(()=>{model.closeAllConnections();model.close();});
 const snapshot={id:'snapshot',command:'science',state:{version:1,profile:'',memory:'',context:'',entries:[],interests:[]},behavior:[],recent_commands:[],candidate_pool:[],previous_slate_ids:[],available_sources:[{id:'local',modes:['search'],modalities:['text']}],settings:{sources:[],contentTypes:['text']}};
 const result=await executePolicy(snapshot,'joint-v1',{endpoint:`http://127.0.0.1:${model.address().port}`,key:'fixture',model:'fixture',timeoutMs:5000});
 assert.equal(rankCalls,2);assert.equal(result.slate.length,1);assert(result.trace.some(x=>x.phase==='rank_retry'&&x.validation_error));assert(result.trace.some(x=>x.phase==='rank'&&x.raw_output));const episode=buildEpisode([{id:'run',kind:'run',track:'feed',result,session_id:'test'}],{session:{},exportedAt:new Date().toISOString()});const decisions=episode.decisions.filter(x=>x.phase==='rank');assert.equal(decisions.length,2);assert.equal(decisions[0].validation.valid,false);assert.equal(decisions[1].validation.valid,true);assert.notEqual(decisions[0].decision_id,decisions[1].decision_id);
});

test('hidden feed distributes new cards between both columns instead of filling the first',async()=>{
  const {chooseColumn}=await import('../public/feed-layout.js');
  const column=count=>({offsetHeight:0,getClientRects:()=>[],querySelector:()=>({}),querySelectorAll:()=>Array(count)});
  assert.equal(chooseColumn([column(4),column(1)],true),1);
  assert.equal(chooseColumn([column(1),column(4)],true),0);
});

test('a repeated invalid model ranking fails without fabricating a recommendation',async t=>{
 let rankCalls=0;const model=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);const plan=data.messages[0].content.includes('Phase plan.');if(!plan)rankCalls++;const output=plan?{actions:[{type:'acquire',source:'local',query:'science',mode:'search',modality:'text'}]}:{actions:[{type:'recommend',candidate_ids:['never-fetched'],reason:'test'}]};res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]}));});await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(()=>{model.closeAllConnections();model.close();});
 const snapshot={id:'snapshot',command:'',state:{version:1,profile:'',memory:'',context:'',entries:[],interests:[]},behavior:[],recent_commands:[],candidate_pool:[],previous_slate_ids:[],available_sources:[{id:'local',modes:['search'],modalities:['text']}],settings:{sources:[],contentTypes:['text']}};
 await assert.rejects(()=>executePolicy(snapshot,'joint-v1',{endpoint:`http://127.0.0.1:${model.address().port}`,key:'fixture',model:'fixture',timeoutMs:5000}),e=>e.status===502&&e.partial_trace.some(row=>row.phase==='rank_retry'));assert.equal(rankCalls,2);
});
