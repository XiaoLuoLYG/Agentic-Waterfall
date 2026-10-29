import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RefreshQueue} from '../public/refresh-queue.js';

test('feedback launches a fresh decision without waiting for the previous one',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),calls=[];
 const queue=new RefreshQueue(async task=>{calls.push(task.reason);if(task.reason==='prefetch')await gate;});
 queue.fill();queue.changed();
 try{assert.deepEqual(calls,['prefetch','feedback']);}finally{release();queue.stop();}
});
