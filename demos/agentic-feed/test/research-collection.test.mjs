import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { id } from '../core.mjs';

async function fixture(t, config = null) {
  const dir = mkdtempSync(join(tmpdir(), 'awf-collection-'));
  const app = createServer({ dataDir: dir, config, sourceConfig: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`; let cookie = '';
  async function req(path, data) {
    const res = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { cookie, ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
    return { status: res.status, body: await res.json() };
  }
  await req('/api/identity', { username: 'research-test', type: 'human' });
  await req('/api/settings', { settings: { sources: ['local'] } });
  const session = await req('/api/session', { consent: true, recordKind: 'human', interests: [], profile: '喜欢自然' });
  return { ...app, req, sid: session.body.session.session_id };
}

test('episode export connects actual input, decisions, content, exposure, behavior and dialogue', async t => {
  const { req, sid } = await fixture(t);
  const entered = await req('/api/interaction', { sessionId: sid, type: 'enter', eventTime: new Date().toISOString() });
  assert.equal(entered.status, 201);
  const command = await req('/api/interaction', { sessionId: sid, type: 'command', text: '看看自然', eventTime: new Date().toISOString() });
  assert.equal(command.status, 201);
  const response = await req('/api/run', { sessionId: sid, command: '看看自然', commandId: command.body.id });
  assert.equal(response.status, 200); const run = response.body.run; const item = run.slate[0];
  const update = { sessionId:sid, type:'feed_update', eventTime:new Date().toISOString(), referenceId:run.id, delivery:'append', addedIds:run.slate.map(item => item.id), removedIds:[], visibleIds:[item.id], pendingIds:[], visibleCards:[{referenceId:run.id,contentId:item.id,position:1}], pendingCards:[] };
  assert.equal((await req('/api/interaction', update)).status, 201);
  assert.equal((await req('/api/interaction', { ...update, visibleCards:[{referenceId:run.id,contentId:'fabricated',position:1}] })).status, 400);
  const exposureId = id(); const common = { sessionId: sid, track: 'feed', referenceId: run.id, contentId: item.id, position: 1, eventTime: new Date().toISOString(), exposureId };
  assert.equal((await req('/api/event', { ...common, type: 'exposure', phase: 'start', visibleMs: 0, visibilityRule: 'interaction' })).status, 201);
  const feedback = await req('/api/event', { ...common, type: 'feedback', value: 'like' });
  assert.equal(feedback.status, 201);
  assert.equal((await req('/api/event', { ...common, type: 'exposure', phase: 'end', visibleMs: 1200, visibilityRule: 'interaction' })).status, 201);
  assert.equal((await req('/api/interaction', { sessionId: sid, type: 'scroll', eventTime: new Date().toISOString(), scrollY: 240 })).status, 201);
  const exported = await req(`/api/export?sessionId=${sid}&format=json`);
  assert.equal(exported.status, 200); const ep = exported.body;
  assert.equal(ep.schema_version, 'awf-collection/1.0'); assert.equal(ep.metadata.data_origin, 'human');
  assert(ep.decisions.some(d => d.phase === 'plan' && d.input.command === '看看自然' && d.validation.valid));
  const plan = ep.decisions.find(d => d.phase === 'plan'); assert(plan.dispatch_groups[0].parallel_actions.length); assert(plan.execution_results.some(r => r.result?.started_at)); assert(plan.dispatch_groups[0].parallel_actions.every(id => plan.normalized_output.actions.some(a => a.action_id === id)));
  assert(ep.decisions.some(d => d.phase === 'rank' && d.execution_results.some(x => x.action.type === 'recommend')));
  assert(ep.environment_snapshot.corpus.some(x => x.id === item.id));
  assert(ep.slates.some(s => s.slate_id === run.id && s.item_ids.includes(item.id)));
  assert(ep.dialogue_log.some(d => d.id === command.body.id && d.text === '看看自然'));
  const window = ep.feedback_windows.find(w => w.exposure_id === exposureId);
  assert.equal(window.observation_status, 'complete'); assert(window.feedback_event_ids.includes(feedback.body.id));
  assert(ep.event_log.some(e => e.type === 'scroll')); assert(ep.event_log.some(e => e.type === 'feed_update')); assert.deepEqual(ep.final_snapshot.feed.visible_cards, update.visibleCards); assert(ep.source_records.some(e => e.id === feedback.body.id));
  assert(!('evaluation_private' in ep));
});

test('model failure retains the actual model response and input without credentials', async t => {
  const model = http.createServer(async (req, res) => { for await (const _ of req) {} res.setHeader('content-type','application/json'); res.end(JSON.stringify({ model:'test-model', choices:[{ message:{ content:'{"actions":[{"type":"unknown"}]}' }, finish_reason:'stop' }] })); });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve)); t.after(() => { model.closeAllConnections(); model.close(); });
  const { req, sid } = await fixture(t, { key:'secret-fixture-key', model:'test-model', endpoint:`http://127.0.0.1:${model.address().port}`, timeoutMs:5000 });
  assert.notEqual((await req('/api/run', { sessionId:sid, command:'hello' })).status, 200);
  const ep = (await req(`/api/export?sessionId=${sid}&format=json`)).body;
  const failure = ep.decisions.find(d => d.validation.valid === false);
  assert(failure); assert.match(failure.raw_output, /unknown/); assert(failure.model_call.messages.length);
  assert(!JSON.stringify(ep).includes('secret-fixture-key'));
});

test('cross-session history includes only the owner’s cited behavior and content', async t => {
  const { req, sid: first } = await fixture(t);
  const oldRun = (await req('/api/run', { sessionId:first, command:'过去的兴趣' })).body.run;
  const oldItem = oldRun.slate[0], exposureId = id();
  const common = { sessionId:first, track:'feed', referenceId:oldRun.id, contentId:oldItem.id, position:1, eventTime:new Date().toISOString(), exposureId };
  await req('/api/event', { ...common, type:'exposure', phase:'start', visibleMs:0 });
  const like = await req('/api/event', { ...common, type:'feedback', value:'like' });
  await req('/api/event', { ...common, type:'exposure', phase:'end', visibleMs:1400 });
  const next = (await req('/api/session', { consent:true, recordKind:'human', interests:[], profile:'' })).body.session.session_id;
  const run = (await req('/api/run', { sessionId:next, command:'继续' })).body.run;
  assert(run);
  await req('/api/identity', { username:'other-person', type:'human' });
  const other = (await req('/api/session', { consent:true, recordKind:'human', interests:[], profile:'OTHER_PRIVATE_MARKER' })).body.session.session_id;
  assert(other);
  await req('/api/identity', { username:'research-test', type:'human' });
  const ep = (await req(`/api/export?sessionId=${next}&format=json`)).body;
  assert(ep.referenced_context.some(r => r.id === like.body.id));
  assert(ep.referenced_context.some(r => r.id === oldRun.id));
  assert(ep.environment_snapshot.corpus.some(item => item.id === oldItem.id));
  assert(!JSON.stringify(ep).includes('OTHER_PRIVATE_MARKER'));
});
