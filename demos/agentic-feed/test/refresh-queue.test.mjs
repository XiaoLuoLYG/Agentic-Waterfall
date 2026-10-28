import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshQueue } from '../public/refresh-queue.js';

test('feedback refreshes during browsing and queued commands take priority', async () => {
  const calls = [], releases = [];
  const queue = new RefreshQueue(task => { calls.push(task); return new Promise(resolve => releases.push(resolve)); });
  queue.fill(); queue.changed(); queue.changed(); queue.command('换个方向');
  assert.deepEqual(calls, [{ reason: 'prefetch', command: '' }]);
  releases.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[1], { reason: 'command', command: '换个方向' });
  queue.changed(); releases.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[2], { reason: 'feedback', command: '' });
  queue.stop(); releases.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
});

test('automatic retry waits until the feed is ready and stops with the account', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[];let ready=false;
  const queue=new RefreshQueue(task=>{calls.push(task);});
  queue.retry(100,()=>ready);
  t.mock.timers.tick(100);assert.equal(calls.length,0);
  ready=true;t.mock.timers.tick(100);assert.equal(calls.length,1);
  await Promise.resolve();
  queue.retry(100,()=>true);queue.stop();t.mock.timers.tick(100);assert.equal(calls.length,1);
});
