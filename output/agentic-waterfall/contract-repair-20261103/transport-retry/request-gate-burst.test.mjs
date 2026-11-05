import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('available concurrency can burst while every rolling minute remains within 50 requests',async()=>{
 const root=mkdtempSync(join(tmpdir(),'rolling-rpm-'));let now=0;
 const {createRequestGate}=await import(process.env.GATE_TEST_SOURCE?pathToFileURL(process.env.GATE_TEST_SOURCE):new URL('./request-gate.mjs',import.meta.url));
 const gate=createRequestGate({endpoint:'https://fixture.test/v1',key:'fixture'},{directory:root,now:()=>now,wait:async ms=>{now+=ms;}});
 try{await gate.setRateLimit(50);const starts=[];for(let i=0;i<50;i++)starts.push(await gate.admit());
  assert(starts.every(t=>t===0),'An unused RPM allowance must not artificially serialize available concurrency');
  assert.equal(await gate.admit(),60000);assert.equal(now,60000);
 }finally{rmSync(root,{recursive:true,force:true});}
});
