import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {archiveAttempt} from './archive.mjs';

test('archive preserves receipt and removes only the completed reservation', () => {
  const db = new DatabaseSync(':memory:');
  const ledger = {attempts: [{id: 'one', status: 'in_progress'}, {id: 'two', status: 'in_progress'}]};
  archiveAttempt(db, ledger, 'one', {status: 'success', usage: {total_tokens: 42}}, '2026-10-30T00:00:00Z', 100);
  assert.deepEqual(ledger.attempts.map(x => x.id), ['two']);
  const saved = JSON.parse(db.prepare('select record from attempts where id=?').get('one').record);
  assert.equal(saved.usage.total_tokens, 42);
  assert.equal(saved.status, 'success');
});

test('storage failure leaves the reservation in place', () => {
  const db = new DatabaseSync(':memory:');
  db.close();
  const ledger = {attempts: [{id: 'one', status: 'in_progress'}]};
  assert.throws(() => archiveAttempt(db, ledger, 'one', {status: 'failed'}, '2026-10-30T00:00:00Z', 100));
  assert.equal(ledger.attempts[0].status, 'in_progress');
});

test('failed HTTP diagnostics and gate waiting survive SQLite archival',()=>{
 const db=new DatabaseSync(':memory:');const ledger={attempts:[{id:'limited',status:'in_progress'}]};
 const receipt={status:'failed',error:'model_http_429',http_error:{status:429,retryable:true,retry_after_seconds:60,message:'api_key: [REDACTED]'},request_gate_wait_ms:1334};
 archiveAttempt(db,ledger,'limited',receipt,'2026-10-30T06:39:10Z',1500);
 const saved=JSON.parse(db.prepare('SELECT record FROM attempts WHERE id=?').get('limited').record);db.close();
 assert.deepEqual(saved.http_error,receipt.http_error);assert.equal(saved.request_gate_wait_ms,1334);assert.equal(saved.error,'model_http_429');assert.equal(ledger.attempts.length,0);
});
