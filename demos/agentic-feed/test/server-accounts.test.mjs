import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { startSession } from '../core.mjs';
import { acquireSource } from '../sources.mjs';

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function setup(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-http-account-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = createServer({ dataDir: dir, config: null, ...options });
  const base = await listen(t, app.server);
  return { ...app, dir, base };
}
async function request(base, path, cookie = '', value) {
  const response = await fetch(base + path, { method: value === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const raw = await response.text(); let body; try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: response.status, body, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const signup = (base, username = 'reader') => request(base, '/api/register', '', { username, password: 'test password', displayName: username });
const start = (base, cookie, interests = []) => request(base, '/api/session', cookie, { consent: true, recordKind: 'synthetic', interests });

test('cookies restore own latest session, logout revokes access, and old anonymous logs stay private', async t => {
  const { base, store, dir, server } = await setup(t);
  const legacy = startSession(store, { consent: true, recordKind: 'synthetic', interests: [] });
  assert.deepEqual((await request(base, '/api/me')).body, { user: null, sessionInfo: null });
  assert.equal((await request(base, `/api/session?id=${legacy.session_id}`)).status, 401);
  const a = await signup(base); assert.equal(a.status, 201); assert.equal(a.body.sessionInfo, null);
  const setCookie = a.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Strict/i); assert.match(setCookie, /Max-Age=2592000/);
  assert(!JSON.stringify(a.body).includes('token')); assert(!JSON.stringify(a.body).includes('password'));
  const first = await start(base, a.cookie, ['设计']); const sid = first.body.session.session_id;
  assert.equal(first.status, 201); assert.equal(first.body.session.user_id, a.body.user.id);
  assert.equal((await request(base, `/api/session?id=${sid}`, a.cookie)).body.session.session_id, sid);
  const me = await request(base, '/api/me', a.cookie); assert.equal(me.body.sessionInfo.session.session_id, sid); assert.deepEqual(me.body.user.settings.interests, ['设计']);
  assert.deepEqual((await request(base, '/api/sessions', a.cookie)).body.sessions.map(x => x.session_id), [sid]);
  assert.equal((await request(base, `/api/export?sessionId=${legacy.session_id}`, a.cookie)).status, 404);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  const restarted = createServer({ dataDir: dir, config: null }); const secondBase = await listen(t, restarted.server);
  assert.equal((await request(secondBase, '/api/me', a.cookie)).body.sessionInfo.session.session_id, sid);
  const logout = await request(secondBase, '/api/logout', a.cookie, {}); assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request(secondBase, `/api/session?id=${sid}`, a.cookie)).status, 401);
  const loggedIn = await request(secondBase, '/api/login', '', { username: 'reader', password: 'test password' });
  assert.equal(loggedIn.status, 200); assert.equal(loggedIn.body.sessionInfo.session.session_id, sid);
});

test('every session route rejects another account without exposing or mutating its data', async t => {
  const { base, store } = await setup(t); const a = await signup(base, 'owner'); const b = await signup(base, 'other');
  const session = await start(base, a.cookie); const sid = session.body.session.session_id; const before = store.rows.length;
  for (const path of [`/api/session?id=${sid}`, `/api/analysis?sessionId=${sid}`, `/api/export?sessionId=${sid}`, `/api/trace?sessionId=${sid}`, `/api/progress?sessionId=${sid}`]) {
    assert.equal((await request(base, path, b.cookie)).status, 404, path);
    assert.equal((await request(base, path)).status, 401, path);
  }
  const posts = [
    ['/api/state', { sessionId: sid, version: 1, profile: '', memory: '', context: '' }],
    ['/api/run', { sessionId: sid, command: '' }], ['/api/compare', { sessionId: sid, command: '' }],
    ['/api/event', { sessionId: sid, type: 'feedback' }], ['/api/evaluate', { sessionId: sid }]
  ];
  for (const [path, value] of posts) assert.equal((await request(base, path, b.cookie, value)).status, 404, path);
  assert.equal(store.rows.length, before);
  assert.deepEqual((await request(base, '/api/sessions', b.cookie)).body.sessions, []);
  assert.equal((await request(base, '/api/me', b.cookie)).body.sessionInfo, null);
});

test('pending cards cannot reference a different account or invented positions', async t => {
  const { base, store } = await setup(t); const a = await signup(base, 'pending-a'); const b = await signup(base, 'pending-b');
  const sa = (await start(base, a.cookie)).body.session.session_id, sb = (await start(base, b.cookie)).body.session.session_id;
  const item = { id: 'private-item', source: 'local', modality: 'text', title: 'private' };
  const run = store.record('run', sa, { result: { slate: [item], content_snapshot: { items: [item] } } });
  const pending = [{ referenceId: run.id, contentId: item.id, position: 1 }];
  assert.equal((await request(base, '/api/run', b.cookie, { sessionId: sb, command: '', pending })).status, 404);
  assert.equal((await request(base, '/api/run', a.cookie, { sessionId: sa, command: '', pending: [{ ...pending[0], position: 2 }] })).status, 400);
});

test('settings and persistent profile carry into only the same account new session', async t => {
  const { base } = await setup(t); const a = await signup(base, 'owner'); const b = await signup(base, 'other');
  const first = await start(base, a.cookie, ['阅读']); const sid = first.body.session.session_id;
  assert.equal((await request(base, '/api/settings', a.cookie, { settings: { sources: ['unknown'] } })).status, 400);
  assert.equal((await request(base, '/api/settings', a.cookie, { settings: { theme: 'dark' }, displayName: '' })).status, 400);
  assert.equal((await request(base, '/api/me', a.cookie)).body.user.settings.theme, 'light');
  const saved = await request(base, '/api/settings', a.cookie, { settings: { sources: ['local'], theme: 'dark', interests: ['科学'] }, displayName: '新的名字' });
  assert.equal(saved.status, 200); assert.equal(saved.body.user.displayName, '新的名字');
  await request(base, '/api/state', a.cookie, { sessionId: sid, version: 1, profile: '只读中文', memory: '电脑已买', context: '这次临时的' });
  const next = await start(base, a.cookie);
  assert.equal(next.body.state.profile, '只读中文'); assert.equal(next.body.state.memory, '电脑已买'); assert.equal(next.body.state.context, '');
  assert.deepEqual(next.body.state.interests, ['科学']);
  const other = await start(base, b.cookie); assert.equal(other.body.state.profile, ''); assert.equal(other.body.state.memory, '');
  const list = (await request(base, '/api/sessions', a.cookie)).body.sessions;
  assert.deepEqual(list.map(x => x.session_id), [next.body.session.session_id, sid]);
});

test('progress exposes bounded phases and blocks settings while a run is active', async t => {
  let announce; const started = new Promise(resolve => { announce = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const model = http.createServer(async (req, res) => {
    for await (const ignored of req) void ignored;
    announce(); await gate;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actions: [{ type: 'keep', text: '保持' }] }) }, finish_reason: 'stop' }] }));
  });
  const endpoint = await listen(t, model);
  const { base } = await setup(t, { config: { key: 'fixture-key', model: 'fixture', endpoint }, sourceConfig: {} });
  const a = await signup(base); const session = await start(base, a.cookie); const sid = session.body.session.session_id;
  assert.equal((await request(base, `/api/progress?sessionId=${sid}`, a.cookie)).body.phase, 'idle');
  const pending = request(base, '/api/run', a.cookie, { sessionId: sid, command: '保持' });
  await started;
  try {
    const progress = await request(base, `/api/progress?sessionId=${sid}`, a.cookie);
    assert.equal(progress.body.phase, 'planning'); assert(Number.isFinite(Date.parse(progress.body.updated_at)));
    assert.equal((await request(base, '/api/settings', a.cookie, { settings: { theme: 'dark' } })).status, 409);
    assert.equal((await request(base, '/api/run', a.cookie, { sessionId: sid, command: '' })).status, 409);
  } finally { release(); }
  assert.equal((await pending).status, 200);
  assert.equal((await request(base, `/api/progress?sessionId=${sid}`, a.cookie)).body.phase, 'complete');
});

test('live catalog refreshes health and snapshots filter source, modality and failed modes', async t => {
  const inputs = [];
  const model = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    inputs.push(JSON.parse(JSON.parse(raw).messages[1].content).input);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actions: [{ type: 'keep', text: '保持' }] }) }, finish_reason: 'stop' }] }));
  });
  const endpoint = await listen(t, model);
  const sourceConfig = { providers: { ZHIHU_API_KEY: 'fixture-provider-secret' }, composio: { apiKey: 'fixture-composio-secret', userId: 'fixture', baseUrl: 'https://invalid.example/api/v3' }, allowed: { github: { allowed: false } } };
  const { base, store } = await setup(t, { config: { key: 'fixture-model-key', model: 'fixture', endpoint }, sourceConfig });
  const a = await signup(base); const session = await start(base, a.cookie); const sid = session.body.session.session_id;
  assert.equal((await request(base, '/api/settings', a.cookie, { settings: { sources: ['twitch'] } })).status, 400);
  assert.equal((await request(base, '/api/settings', a.cookie, { settings: { sources: ['github'] } })).status, 400);
  const visible = await request(base, '/api/config'); assert(!JSON.stringify(visible.body).includes('fixture-provider-secret')); assert(!JSON.stringify(visible.body).includes('fixture-composio-secret')); assert(!JSON.stringify(visible.body).includes('fixture-model-key'));
  await request(base, '/api/settings', a.cookie, { settings: { sources: ['youtube', 'zhihu'], contentTypes: ['text'] } });
  assert.equal((await request(base, '/api/run', a.cookie, { sessionId: sid, command: '保持' })).status, 200);
  assert.deepEqual(inputs.at(-1).available_sources.map(x => x.id), ['zhihu']);
  await request(base, '/api/settings', a.cookie, { settings: { sources: ['youtube'], contentTypes: ['video'] } });
  const failed = await acquireSource({ source: 'youtube', query: '', mode: 'explore', modality: 'video' }, sourceConfig);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'composio_endpoint_not_allowed');
  const refreshed = (await request(base, '/api/config')).body.sources.find(x => x.id === 'youtube');
  assert.equal(refreshed.mode_checks.explore.status, 'failed');
  await request(base, '/api/run', a.cookie, { sessionId: sid, command: '保持' });
  assert.deepEqual(inputs.at(-1).available_sources[0].modes, ['search']);
  await acquireSource({ source: 'youtube', query: 'test', mode: 'search', modality: 'video' }, sourceConfig);
  const calls = inputs.length;
  assert.equal((await request(base, '/api/run', a.cookie, { sessionId: sid, command: '保持' })).status, 400);
  assert.equal(inputs.length, calls);
  assert.deepEqual(store.rows.findLast(row => row.kind === 'input').input_snapshot.available_sources, []);
});

test('auth limits request rate and concurrent password hashing', async t => {
  const { base } = await setup(t);
  const results = await Promise.all(['first', 'second', 'third'].map(name => signup(base, name)));
  assert.equal(results.filter(x => x.status === 201).length, 2); assert.equal(results.filter(x => x.status === 429).length, 1);
  for (let i = 0; i < 12; i++) assert.equal((await request(base, '/api/login', '', { username: 'nobody', password: 'short' })).status, 400);
  const limited = await request(base, '/api/login', '', { username: 'nobody', password: 'short' });
  assert.equal(limited.status, 429); assert(limited.headers.has('retry-after'));
});

test('trace polling returns changes only for the selected owned session', async t => {
  const { base } = await setup(t); const a = await signup(base,'trace-owner'); const b = await signup(base,'trace-other');
  const sid=(await start(base,a.cookie)).body.session.session_id;
  const first=await request(base,`/api/trace?sessionId=${sid}`,a.cookie);
  assert.equal(first.status,200); assert(first.body.revision>0); assert(first.body.state_records.length);
  const unchanged=await request(base,`/api/trace?sessionId=${sid}&after=${first.body.revision}`,a.cookie);
  assert.deepEqual(unchanged.body,{unchanged:true,revision:first.body.revision});
  assert.equal((await request(base,`/api/trace?sessionId=${sid}&after=${first.body.revision}`,b.cookie)).status,404);
  assert.equal((await request(base,'/api/interaction',a.cookie,{sessionId:sid,type:'command',text:'新的方向',eventTime:new Date().toISOString()})).status,201);
  const changed=await request(base,`/api/trace?sessionId=${sid}&after=${first.body.revision}`,a.cookie);
  assert(changed.body.revision>first.body.revision); assert(changed.body.event_log.some(row=>row.type==='command'&&row.payload.text==='新的方向'));
});
