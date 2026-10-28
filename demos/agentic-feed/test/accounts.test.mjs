import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../accounts.mjs';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-account-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new AccountStore(dir) };
}
const credentials = { username: 'reader', password: 'a private passphrase', displayName: '读者' };
const failsWith = status => error => error.status === status;

test('register/login preserve account, settings and session across new store instances', async t => {
  const { dir, store } = setup(t);
  const created = await store.register({ ...credentials, username: ' Reader ' });
  assert.equal(created.user.username, 'reader');
  assert.equal(created.user.displayName, '读者');
  assert.deepEqual(created.user.settings, {
    interests: [], sources: [], contentTypes: ['text', 'video', 'image'],
    layout: 'cards', theme: 'light', density: 'comfortable', language: 'zh'
  });
  store.updateSettings(created.user.id, { interests: ['设计'], theme: 'dark' });
  store.updateProfile(created.user.id, { displayName: '小读者' });
  const reopened = new AccountStore(dir);
  assert.equal(reopened.getUser(created.token).displayName, '小读者');
  assert.deepEqual(reopened.getUser(created.token).settings.interests, ['设计']);
  const login = await reopened.login({ username: 'READER', password: credentials.password });
  assert.equal(login.user.id, created.user.id);
  assert.equal(login.user.settings.theme, 'dark');
  assert.notEqual(login.token, created.token);
  await assert.rejects(reopened.register(credentials), failsWith(409));
});

test('wrong and unknown credentials use the same error and malformed registration is rejected', async t => {
  const { store } = setup(t);
  await store.register(credentials);
  let wrong;
  try { await store.login({ username: 'reader', password: 'wrong password' }); } catch (error) { wrong = error; }
  assert.equal(wrong?.status, 401);
  await assert.rejects(store.login({ username: 'nobody', password: 'wrong password' }), error => error.status === 401 && error.message === wrong.message);
  for (const patch of [{ password: 'short' }, { password: 'x'.repeat(129) }, { username: '../reader' }, { username: 'ab' }, { displayName: ' ' }, { displayName: '字'.repeat(41) }, { admin: true }]) {
    await assert.rejects(store.register({ ...credentials, username: 'new-reader', ...patch }), failsWith(400));
  }
});

test('settings reject out-of-range and unknown values without changing saved data', async t => {
  const { store } = setup(t); const { user, token } = await store.register(credentials);
  const original = store.getUser(token);
  const invalid = [null, [], { interests: '设计' }, { interests: Array(61).fill('设计') }, { interests: ['字'.repeat(41)] },
    { sources: Array(31).fill('local') }, { sources: [null] }, { sources: [''] }, { sources: ['s'.repeat(81)] },
    { contentTypes: [] }, { contentTypes: ['audio'] }, { layout: 'grid' }, { theme: 'blue' }, { density: 'dense' },
    { language: 'en' }, { password: 'overwrite' }, JSON.parse('{"__proto__":{"admin":true}}')];
  for (const patch of invalid) assert.throws(() => store.updateSettings(user.id, patch), failsWith(400));
  assert.deepEqual(store.getUser(token), original);
  const changed = store.updateSettings(user.id, { interests: ['  设计  ', '设计'], sources: ['wikipedia'], contentTypes: ['image', 'text'], layout: 'list', theme: 'system', density: 'compact', language: 'all' });
  assert.deepEqual(changed.settings.interests, ['设计']);
  assert.deepEqual(changed.settings.sources, ['wikipedia']);
  assert.equal(changed.settings.layout, 'list');
  assert.throws(() => store.updateProfile(user.id, { displayName: '' }), failsWith(400));
  assert.throws(() => store.updateProfile(user.id, { displayName: 'x', password: 'new' }), failsWith(400));
  assert.throws(() => store.updateSettings('missing-user', { theme: 'dark' }), failsWith(404));
});

test('logout revokes only its token and expiry remains enforced after restart', async t => {
  const { dir, store } = setup(t); const created = await store.register(credentials);
  const other = await store.login({ username: credentials.username, password: credentials.password });
  store.logout(created.token);
  const reopened = new AccountStore(dir);
  assert.equal(reopened.getUser(created.token), null);
  assert.equal(reopened.getUser(other.token).id, created.user.id);
  for (const token of [null, undefined, '', 'bad-token', 42]) assert.equal(reopened.getUser(token), null);
  reopened.logout('bad-token');
  const future = Date.now() + 31 * 24 * 60 * 60 * 1000;
  t.mock.method(Date, 'now', () => future);
  assert.equal(new AccountStore(dir).getUser(other.token), null);
});

test('credentials and raw tokens are never written or exposed through public users', async t => {
  const { dir, store } = setup(t); const a = await store.register(credentials);
  const b = await store.register({ ...credentials, username: 'another' });
  const files = readdirSync(dir);
  assert.deepEqual(files, ['accounts.json']);
  const raw = readFileSync(join(dir, 'accounts.json'), 'utf8');
  assert(!raw.includes(credentials.password)); assert(!raw.includes(a.token)); assert(!raw.includes(b.token));
  assert.equal(statSync(join(dir, 'accounts.json')).mode & 0o777, 0o600);
  const stored = JSON.parse(raw);
  assert.notEqual(stored.users[0].password_salt, stored.users[1].password_salt);
  assert.notEqual(stored.users[0].password_hash, stored.users[1].password_hash);
  for (const user of [a.user, b.user, store.getUser(a.token), store.updateProfile(a.user.id, { displayName: '新名字' })]) {
    assert.deepEqual(Object.keys(user).sort(), ['created_at', 'displayName', 'id', 'settings', 'username']);
    assert(!JSON.stringify(user).includes(stored.users[0].password_hash));
  }
  assert.equal(JSON.stringify(store), '{}');
});

test('accounts stay isolated and caller mutation cannot alter persisted settings', async t => {
  const { dir, store } = setup(t);
  const a = await store.register(credentials); const b = await store.register({ ...credentials, username: 'second', displayName: '第二位' });
  a.user.settings.interests.push('caller mutation');
  store.getUser(b.token).settings.sources.push('caller mutation');
  store.updateSettings(a.user.id, { interests: ['科学'], contentTypes: ['video'] });
  const reopened = new AccountStore(dir);
  assert.deepEqual(reopened.getUser(a.token).settings.interests, ['科学']);
  assert.deepEqual(reopened.getUser(b.token).settings.interests, []);
  assert.deepEqual(reopened.getUser(b.token).settings.sources, []);
  assert.deepEqual(reopened.getUser(b.token).settings.contentTypes, ['text', 'video', 'image']);
});

test('concurrent hashing and multiple instances retain registrations, settings and tokens', async t => {
  const { dir, store } = setup(t); const second = new AccountStore(dir);
  const registrations = await Promise.all([
    store.register(credentials), second.register({ ...credentials, username: 'second' }),
    store.register({ ...credentials, username: 'third' })
  ]);
  const a = registrations[0];
  const pendingLogin = store.login({ username: credentials.username, password: credentials.password });
  second.updateSettings(a.user.id, { theme: 'dark' });
  store.updateSettings(a.user.id, { interests: ['阅读'] });
  const login = await pendingLogin;
  assert.equal(login.user.settings.theme, 'dark'); assert.deepEqual(login.user.settings.interests, ['阅读']);
  const reopened = new AccountStore(dir);
  for (const result of registrations) assert.equal(reopened.getUser(result.token).id, result.user.id);
  assert.equal(reopened.getUser(login.token).id, a.user.id);
  const duplicates = await Promise.allSettled([store.register({ ...credentials, username: 'same' }), second.register({ ...credentials, username: 'same' })]);
  assert.equal(duplicates.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(duplicates.find(x => x.status === 'rejected').reason.status, 409);
});

test('corrupt account storage fails without overwriting it or unrelated demo logs', t => {
  const { dir } = setup(t); const file = join(dir, 'accounts.json');
  writeFileSync(join(dir, 'events.jsonl'), 'existing research logs\n');
  writeFileSync(file, '{broken account data');
  assert.throws(() => new AccountStore(dir), /账户/);
  assert.equal(readFileSync(file, 'utf8'), '{broken account data');
  assert.equal(readFileSync(join(dir, 'events.jsonl'), 'utf8'), 'existing research logs\n');
});
