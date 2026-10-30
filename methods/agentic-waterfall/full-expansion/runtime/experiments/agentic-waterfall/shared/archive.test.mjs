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
