import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../accounts.mjs';

test('local identities restore the same account and retain its type', t => {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-identity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new AccountStore(dir);
  const first = store.selectIdentity({ username: '小雨', type: 'agent' });
  assert.equal(first.user.type, 'agent');
  const again = new AccountStore(dir).selectIdentity({ username: '小雨', type: 'agent' });
  assert.equal(first.user.id, again.user.id);
  assert.throws(() => store.selectIdentity({ username: '小雨', type: 'human' }), /类型/);
  assert.notEqual(store.selectIdentity({ username: '小明', type: 'human' }).user.id, first.user.id);
});
