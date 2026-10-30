import test from 'node:test';
import assert from 'node:assert/strict';
import {serial,readInput,makeKuaiRecAcquirer} from './formal_task.mjs';
import {runEpisode} from '../../../demos/agentic-feed/waterfall-core.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('resource gate serializes requests without losing a failure',async()=>{
  let running=0,max=0;const order=[];
  const call=serial(async n=>{running++;max=Math.max(max,running);await new Promise(r=>setTimeout(r,5));order.push(n);running--;if(n===2)throw Error('failed');return n;});
  const results=await Promise.allSettled([call(1),call(2),call(3)]);
  assert.equal(max,1);assert.deepEqual(order,[1,2,3]);assert.equal(results[1].status,'rejected');assert.equal(results[2].value,3);
});
test('large input streams are sliced by bytes including Unicode',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wf-slice-'));
 try{const first=Buffer.from('{"title":"中文"}\n'),second=Buffer.from('{"title":"next"}\n'),path=join(dir,'input.jsonl');writeFileSync(path,Buffer.concat([first,second]));assert.deepEqual(readInput({input_path:path,input_offset:first.length,input_bytes:second.length}),{title:'next'});assert.throws(()=>readInput({input_path:path,input_offset:first.length,input_bytes:second.length+1}),/truncated/);}finally{rmSync(dir,{recursive:true});}
});
test('model transport failure prevents already queued requests from being sent',async()=>{
  let issued=0;const call=serial(async()=>{issued++;throw Object.assign(Error('model_timeout'),{receipt:{attempt_id:'only-actual-call'}});},true);
  const results=await Promise.allSettled([call(),call(),call()]);
  assert.equal(issued,1);assert.ok(results.every(x=>x.status==='rejected'&&x.reason.message==='model_timeout'));
  assert.equal(results.filter(x=>x.reason.receipt).length,1);
});
test('queued KuaiRec acquisitions use the remaining capacity at execution time',async()=>{
 const requests=[];let next=0;
 const input={observation:{user_id:'u',environment:{candidate_pool:[]}},protocol:{max_acquired_items:100}};
 const fetch=async request=>{requests.push(request);const n=Math.min(request.arguments.limit,request.remaining_acquired_items);return {items:Array.from({length:n},()=>({id:String(next++)})),actual_requests:1};};
 const run=serial(makeKuaiRecAcquirer(input,fetch));
 const stale={observation:{environment:{candidate_pool:[],budget:{remaining_acquired_items:100}}}};
 const out=await Promise.all([50,30,30,20].map(limit=>run({limit},stale)));
 assert.deepEqual(requests.map(x=>x.remaining_acquired_items),[100,50,20,0]);
 assert.deepEqual(out.map(x=>x.items.length),[50,30,20,0]);
 assert.equal(new Set(out.flatMap(x=>x.items.map(item=>item.id))).size,100);
 assert.equal(requests[3].exclude.length,100);
});
test('parallel queued searches preserve the acquisition cap and still submit',async()=>{
 let next=0;
 const input={observation:{decision_id:'d',user_id:'u',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:[],sources:[{id:'kuairec',modes:['search']}]}},protocol:{mode:'acquire',top_k:1,max_model_calls:1,max_tool_calls:10,max_acquired_items:100}};
 const fetch=async request=>({items:Array.from({length:Math.min(request.arguments.limit,request.remaining_acquired_items)},()=>({id:String(next++),source_id:'kuairec',text:'fixture'})),actual_requests:1});
 const acquire=serial(makeKuaiRecAcquirer(input,fetch));
 const actions=[50,30,30,20].map((limit,i)=>({action_id:'a'+i,kind:'acquire',arguments:{source_ids:['kuairec'],mode:'search',query:'q',limit},depends_on:[],evidence_refs:[]}));
 actions.push({action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:['0'],delivery:'append'},depends_on:['a0','a1','a2','a3'],evidence_refs:[]});
 const result=await runEpisode(input,{acquire,decide:async()=>({decision_id:'d',actions})});
 assert.equal(result.status,'submitted');assert.equal(result.acquired_items,100);
 assert(result.trace.flatMap(step=>step.execution_results).every(receipt=>receipt.status==='success'));
});
