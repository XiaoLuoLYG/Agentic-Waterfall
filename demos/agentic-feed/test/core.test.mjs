import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { Store, startSession, inputSnapshot, seeds, rulePlan, ruleRank, applyUpdates, validateActions, executePolicy, comparisonAssignment, id } from '../core.mjs';
import { createServer, loadConfig } from '../server.mjs';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-demo-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const session = startSession(store, { consent: true, recordKind: 'synthetic', interests: [] });
  return { dir, store, sid: session.session_id };
}
const frozen = () => ({ id: id(), items: seeds() });

test('cold start allows skipping interests, keeps synthetic origin, and restores after restart', t => {
  const { dir, store, sid } = setup(t);
  assert.deepEqual(store.state(sid).interests, []); assert.equal(store.session(sid).record_kind, 'synthetic');
  store.record('state', sid, { state: { ...store.state(sid), profile: '设计', version: 2 }, reason: 'user_edit' });
  const reopened = new Store(dir); assert.equal(reopened.state(sid).profile, '设计'); assert.equal(reopened.state(sid).version, 2);
  assert.equal(readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').length, store.rows.length);
  assert.throws(() => startSession(store, { consent: false, recordKind: 'human', interests: [] }), /确认/);
  assert.throws(() => startSession(store, { consent: true, recordKind: 'human', interests: ['unknown'] }), /兴趣/);
});

test('completed purchase updates only scoped goal and ranks tutorials ahead of buying', t => {
  const { store, sid } = setup(t); const snapshot = inputSnapshot(store, sid, '电脑已经买了，想看看上手教程');
  const plan = validateActions(rulePlan(snapshot, 'joint-v1'), 'plan', snapshot); const next = applyUpdates(snapshot.state, plan, snapshot.id);
  assert.equal(snapshot.state.version, 1); assert.equal(next.version, 2);
  assert(next.entries.some(x => x.target === 'goal' && x.topic === '电脑购买' && x.value === 'completed' && x.scope === 'topic'));
  const items = seeds(); const rank = validateActions(ruleRank(snapshot, 'joint-v1', items, next), 'rank', snapshot, items);
  assert.equal(items.find(x => x.id === rank[0].candidate_ids[0]).source_item_id, 'computer-guide');
  assert(next.entries.every(x => x.evidence_ids.includes(snapshot.id)));
});

test('action validator rejects invented candidates, early recommendations, unknown keys and forged evidence', t => {
  const { store, sid } = setup(t); const snapshot = inputSnapshot(store, sid, '电脑已买'); const items = seeds();
  assert.throws(() => validateActions({ actions: [{ type: 'recommend', candidate_ids: ['invented'], reason: '' }] }, 'rank', snapshot, items), /候选/);
  assert.throws(() => validateActions({ actions: [{ type: 'recommend', candidate_ids: [items[0].id], reason: '' }] }, 'plan', snapshot), /工具结果/);
  assert.throws(() => validateActions({ actions: [{ type: 'keep', text: 'ok', leak: true }] }, 'plan', snapshot), /字段/);
  const update = rulePlan(snapshot, 'joint-v1').actions.find(x => x.type === 'update_state');
  assert.throws(() => validateActions({ actions: [{ ...update, evidence_ids: ['forged'] }] }, 'plan', snapshot), /证据/);
});

test('evaluation labels and blind exposure never enter controller input; feed behavior does', t => {
  const { store, sid } = setup(t); const before = inputSnapshot(store, sid, '下一条');
  store.record('evaluation', sid, { track: 'blind', choice: 'B' });
  store.record('exposure', sid, { track: 'blind', visible_ms: 1000 });
  const after = inputSnapshot(store, sid, '下一条'); assert.deepEqual(after.state, before.state); assert.deepEqual(after.behavior, before.behavior);
  store.record('feedback', sid, { track: 'feed', value: 'like', topic: '设计' });
  assert.equal(inputSnapshot(store, sid, '').behavior.length, 1);
});

test('frozen snapshots use real IDs; keep and rerank reuse acquired pool without fetching', async t => {
  const { store, sid } = setup(t); const snapshot = inputSnapshot(store, sid, '电脑已经买了');
  const result = await executePolicy(snapshot, 'joint-v1', null, frozen());
  assert(result.slate.every(x => result.content_snapshot.items.some(c => c.id === x.id)));
  assert.equal(result.trace[1].results[0].status, 'frozen'); store.record('run', sid, { track: 'feed', result });
  const kept = await executePolicy(inputSnapshot(store, sid, '继续看'), 'joint-v1', null);
  assert.deepEqual(kept.slate.map(x => x.id), result.slate.map(x => x.id)); assert.equal(kept.trace[1].results[0].status, 'reused');
  assert(!kept.trace[0].actions.some(a => a.type === 'acquire'));
  const reordered = await executePolicy(inputSnapshot(store, sid, '重新排序'), 'joint-v1', null);
  assert.equal(reordered.trace[1].results[0].source, 'existing_pool');
});

test('blind assignment stores exact probability and a complete policy mapping', () => {
  for (let i = 0; i < 50; i++) {
    const a = comparisonAssignment(); assert.equal(a.assignment_probability, .5);
    assert.notEqual(a.mapping.A, a.mapping.B); assert.equal(a.mapping.A, a.random_seed % 2 ? 'command-v1' : 'joint-v1');
  }
});

test('OpenAI-compatible two-stage path returns tools before ranking and retains failed trace', async t => {
  const { store, sid } = setup(t); let calls = 0; let invalid = false; let truncated = false; let keep = false;
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; const body = JSON.parse(raw); calls++;
    const input = JSON.parse(body.messages[1].content);
    const plan = body.messages[0].content.includes('Phase plan.');
    if (!plan) assert(input.tool_results[0].items.length > 0);
    const output = plan ? { actions: [{ type: 'acquire', source: 'local', query: 'science', mode: 'explore', modality: 'text' }] } : keep ? { actions: [{ type: 'keep', text: 'preserve current feed' }] } : { actions: [{ type: 'recommend', candidate_ids: [invalid ? 'fake' : input.tool_results[0].items[0].id], reason: 'test' }] };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'provider-label', choices: [{ message: { content: truncated ? '' : JSON.stringify(output), reasoning_content: 'must-not-be-logged' }, finish_reason: truncated ? 'length' : 'stop' }], usage: { total_tokens: 50 } }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve)); t.after(() => { mock.closeAllConnections(); mock.close(); });
  const config = { endpoint: `http://127.0.0.1:${mock.address().port}/v1/chat/completions`, model: 'mock-model', key: 'test-only' };
  const result = await executePolicy(inputSnapshot(store, sid, ''), 'joint-v1', config);
  assert.equal(calls, 2); assert.equal(result.mode, 'llm'); assert.equal(result.trace[0].usage.total_tokens, 50); assert.equal(result.trace[0].requested_model, 'mock-model'); assert.equal(result.trace[0].provider_response_model, 'provider-label');
  invalid = true;
  await assert.rejects(executePolicy(inputSnapshot(store, sid, ''), 'joint-v1', config), error => error.partial_trace.some(x => x.phase === 'tool_result') && /候选/.test(error.message));
  invalid = false;
  await assert.rejects(executePolicy(inputSnapshot(store, sid, ''), 'joint-v1', config, { id: id(), items: [] }), error => error.partial_trace.some(x => x.phase === 'tool_result') && /没有新的内容/.test(error.message));
  truncated = true;
  await assert.rejects(executePolicy(inputSnapshot(store, sid, ''), 'joint-v1', config), error => {
    const failure = error.partial_trace.at(-1);
    assert.equal(failure.model_metadata.finish_reason, 'length');
    assert.equal(failure.model_metadata.usage.total_tokens, 50);
    assert(!JSON.stringify(error.partial_trace).includes('must-not-be-logged'));
    return /token 上限/.test(error.message);
  });
  truncated = false; keep = true;
  const previous = { ...seeds()[0], id: 'already-acquired-old-content' };
  const snapshot = { ...inputSnapshot(store, sid, ''), candidate_pool: [previous], previous_slate_ids: [previous.id] };
  const kept = await executePolicy(snapshot, 'joint-v1', config);
  assert.equal(kept.slate[0].id, previous.id);
  assert(kept.content_snapshot.items.some(c => c.id === previous.id));
});

test('server validates boundary, links feedback to exposure and keeps blind state proposals isolated', async t => {
  const { dir } = setup(t); const { server, store } = createServer({ dataDir: dir, config: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const post = async (path, value, extra = {}) => { const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: cookie, ...extra }, body: JSON.stringify(value) }); return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] }; };
  const registered = await post('/api/register', { username: 'http-test', password: 'test password', displayName: 'HTTP 测试' });
  assert.equal(registered.status, 201); cookie = registered.cookie;
  const started = await post('/api/session', { consent: true, recordKind: 'human', interests: ['设计'] }); const sid = started.body.session.session_id;
  const result = await executePolicy(inputSnapshot(store, sid, ''), 'joint-v1', null, frozen());
  const run = store.record('run', sid, { track: 'feed', result }); const item = result.slate[0];
  const common = { sessionId: sid, track: 'feed', referenceId: run.id, contentId: item.id, position: 1, eventTime: new Date().toISOString() };
  assert.equal((await post('/api/event', { ...common, type: 'open', exposureId: null })).status, 201);
  assert.equal(store.rows.findLast(row => row.kind === 'open').exposure_id, null);
  assert.equal((await post('/api/event', { ...common, type: 'feedback', exposureId: null, value: 'save' })).status, 201);
  assert.equal((await post('/api/event', { ...common, type: 'feedback', exposureId: id(), value: 'like' })).status, 400);
  const exposureId = id(); assert.equal((await post('/api/event', { ...common, type: 'exposure', exposureId, phase: 'start', visibleMs: 0 })).status, 201);
  assert.equal((await post('/api/event', { ...common, type: 'feedback', exposureId, value: 'like' })).status, 201);
  assert.equal((await post('/api/event', { ...common, type: 'exposure', exposureId, phase: 'end', visibleMs: -1 })).status, 400);
  assert.equal((await post('/api/state', { sessionId: sid, version: 1, profile: 'x'.repeat(2001), memory: '', context: '' })).status, 400);
  assert.equal((await post('/api/run', { sessionId: sid, command: 'x' }, { Origin: 'https://evil.invalid' })).status, 403);
  const before = structuredClone(store.state(sid));
  const compared = await post('/api/compare', { sessionId: sid, command: '电脑已经买了', frozenSnapshotId: result.content_snapshot.id });
  assert.equal(compared.status, 200); assert(!JSON.stringify(compared.body).includes('joint-v1')); assert.deepEqual(store.state(sid), before);
  const cid = compared.body.comparison.id; const vote = { sessionId: sid, comparisonId: cid, choice: 'A', eventTime: new Date().toISOString() };
  assert.equal((await post('/api/evaluate', vote)).status, 201); assert.equal((await post('/api/evaluate', vote)).status, 409);
  const stats = await (await fetch(`${base}/api/analysis?sessionId=${sid}`, { headers: { Cookie: cookie } })).json();
  assert.equal(Object.values(stats.policy_counts).reduce((n, p) => n + p.wins, 0), 1);
  assert.equal(stats.liked_topics[item.topic], 1);
  const feedback = store.rows.findLast(row => row.kind === 'feedback'); assert.equal(feedback.title, item.title); assert.equal(feedback.source, item.source);
  const exported = await (await fetch(`${base}/api/export?sessionId=${sid}&format=jsonl`, { headers: { Cookie: cookie } })).text(); assert(exported.includes('evaluation_only_never_controller_input'));
  assert(!exported.includes('test-only')); assert.equal(inputSnapshot(store, sid, '').behavior.filter(x => x.type === 'feedback').length, 2);
  const restored = await (await fetch(`${base}/api/session?id=${sid}`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(restored.feedback_by_content, { [item.id]: 'like' });
  assert.equal((await post('/api/event', { ...common, type: 'feedback', exposureId, value: 'dislike' })).status, 201);
  assert.equal((await post('/api/event', { ...common, type: 'feedback', exposureId, value: 'comment', text: '评论不应覆盖赞踩状态' })).status, 201);
  const loggedIn = await post('/api/login', { username: 'http-test', password: 'test password' });
  assert.deepEqual(loggedIn.body.sessionInfo.feedback_by_content, { [item.id]: 'dislike' });
});

test('model configuration fails closed and never returns a secret in public config', t => {
  const { dir } = setup(t);
  const { configInfo } = createServer({ dataDir: dir, config: { key: 'private-test-secret', model: 'test-model', endpoint: 'https://private.example/v1/chat/completions' }, sourceConfig: {} });
  assert(!JSON.stringify(configInfo).includes('private-test-secret'));
  assert(!JSON.stringify(configInfo).includes('private.example'));
  assert.equal(configInfo.mode, 'llm');
  const file = join(dir, 'fake-model.json'); writeFileSync(file, '{}');
  assert.equal(loadConfig({ DEMO_MODE: 'rules', MODEL_CONFIG_FILE: 'does-not-exist' }), null);
  assert.throws(() => loadConfig({ MODEL_CONFIG_FILE: file, OPENAI_API_KEY: 'x' }), /不完整/);
  assert.throws(() => loadConfig({ MODEL_CONFIG_FILE: file, OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'http://external.invalid/v1', OPENAI_MODEL: 'x' }), /HTTPS/);
  assert.equal(loadConfig({ MODEL_CONFIG_FILE: file, OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'https://example.com/v1', OPENAI_MODEL: 'model' }).endpoint, 'https://example.com/v1/chat/completions');
  writeFileSync(file, JSON.stringify({ apiKey: 'fixture-key', apiBase: 'https://example.com/v1/', modelName: 'general', recommendationModelName: 'DeepSeek-V4.1-Flash' }));
  const recommendation = loadConfig({ XUANJI_CONFIG_FILE: file, MODEL_CONFIG_FILE: 'not-read' });
  assert.equal(recommendation.model, 'DeepSeek-V4.1-Flash'); assert.equal(recommendation.timeoutMs, 60000);
  assert.deepEqual(recommendation.requestParameters, { max_tokens: 4096, temperature: .3, enable_thinking: false, thinking: { type: 'disabled' }, extra_body: { thinking: { type: 'disabled' } } });
  assert.equal(loadConfig({ MODEL_CONFIG_FILE: file, OPENAI_MODEL: 'override' }).model, 'override');
});
