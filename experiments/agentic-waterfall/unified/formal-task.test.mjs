import test from 'node:test';
import assert from 'node:assert/strict';
import {serial,readInput} from './formal_task.mjs';
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
