import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { Store, startSession, inputSnapshot, validateActions, rulePlan, executePolicy, applyUpdates, seeds, id } from '../core.mjs';

const sources = [{ id: 'youtube', name: 'YouTube', modes: ['search', 'explore'], modalities: ['video'] }];
const settings = { interests: ['视频剪辑'], sources: ['youtube'], contentTypes: ['video'], language: 'zh' };
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-personal-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const create = (userId, previous = null) => startSession(store, { consent: true, recordKind: 'synthetic', interests: ['视频剪辑'] }, { id: userId }, previous).session_id;
  return { store, create };
}

test('personal history and persistent memory follow their owner across sessions, excluding blind labels', t => {
  const { store, create } = setup(t); const first = create('alice'), other = create('bob');
  store.record('feedback', first, { track: 'feed', value: 'like', title: '剪辑教程', source: 'youtube' });
  store.record('feedback', other, { track: 'feed', value: 'like', title: 'other-account-secret' });
  store.record('input', first, { track: 'feed', input_snapshot: { id: 'past-user-command', command: '电脑已经买好了' } });
  store.record('input', other, { track: 'feed', input_snapshot: { id: 'other', command: 'other-account-secret' } });
  store.record('input', first, { track: 'blind', input_snapshot: { id: 'blind', command: 'evaluation-only-command' } });
  store.record('evaluation', first, { track: 'blind', choice: 'B' });
  const prior = { ...store.state(first), profile: '初学者', entries: [{ lifetime: 'persistent', value: '电脑已购买' }, { lifetime: 'session', value: '今天在地铁' }] };
  const current = create('alice', prior); const snapshot = inputSnapshot(store, current, '', settings, sources);
  assert.equal(snapshot.behavior.length, 1); assert.equal(snapshot.behavior[0].title, '剪辑教程');
  assert.equal(snapshot.state.profile, '初学者'); assert.equal(snapshot.state.entries.length, 2);
  assert.deepEqual(snapshot.recent_commands.map(x => x.command), ['电脑已经买好了']);
  assert(!JSON.stringify(snapshot).includes('other-account-secret'));
});

test('recent explicit feedback survives a long sequence of exposure segments', t => {
  const { store, create } = setup(t); const sid = create('alice');
  store.record('feedback', sid, { track: 'feed', value: 'like', title: '剪辑教程' });
  for (let i = 0; i < 70; i++) store.record('exposure', sid, { track: 'feed', phase: 'end', visible_ms: 3000, title: `内容${i}` });
  const history = inputSnapshot(store, sid, '', settings, sources).behavior;
  assert(history.some(event => event.type === 'feedback' && event.value === 'like'));
  assert(history.some(event => event.title === '内容69'));
  assert(history.length <= 60);
});

test('source and type preferences apply to reused candidates and constrain available actions', t => {
  const { store, create } = setup(t); const sid = create('alice');
  const video = { id: 'video', source: 'youtube', modality: 'video' }, article = { id: 'article', source: 'github', modality: 'text' };
  store.record('run', sid, { result: { content_snapshot: { items: [video, article] }, slate: [article, video] } });
  const snapshot = inputSnapshot(store, sid, '', settings, sources);
  assert.deepEqual(snapshot.candidate_pool, [video]); assert.deepEqual(snapshot.previous_slate_ids, ['video']);
  const acquire = { type: 'acquire', source: 'youtube', query: '剪辑入门', mode: 'search', modality: 'video' };
  assert.equal(validateActions({ actions: [acquire] }, 'plan', snapshot).length, 1);
  assert.throws(() => validateActions({ actions: [{ ...acquire, source: 'github' }] }, 'plan', snapshot), /来源/);
  assert.throws(() => validateActions({ actions: [{ ...acquire, modality: 'text' }] }, 'plan', snapshot), /类型/);
  assert(rulePlan(snapshot, 'joint-v1').actions.filter(a => a.type === 'acquire').every(a => a.source === 'youtube'));
});

test('empty source preferences fail before sending a model request', async t => {
  const { store, create } = setup(t); const sid = create('alice');
  await assert.rejects(executePolicy(inputSnapshot(store, sid, '', settings, []), 'joint-v1', { endpoint: 'must-not-be-called' }), /偏好设置/);
});

test('adaptive refresh ranks unviewed cards together with newly retrieved content', async t => {
  const { store, create } = setup(t); const sid = create('alice');
  const queued = { id: 'queued-unseen', source: 'local', modality: 'text', title: '足球', topic: '足球', url: 'https://example.com/football' };
  const local = [{ id: 'local', modes: ['explore'], modalities: ['text'] }];
  const snapshot = inputSnapshot(store, sid, '电脑已经买了', { interests: ['足球'], sources: [], contentTypes: ['text'] }, local, [queued]);
  assert.deepEqual(snapshot.candidate_pool, [queued]);
  const result = await executePolicy(snapshot, 'joint-v1', null);
  assert(result.content_snapshot.items.some(item => item.id === queued.id));
  assert(result.content_snapshot.items.some(item => item.id !== queued.id));
});

test('prefetch does not select content already rendered in the feed', async t => {
  const { store, create } = setup(t); const sid = create('alice');
  const local = [{ id: 'local', modes: ['explore'], modalities: ['text'] }];
  const rendered = seeds().slice(0, 3).map(item => item.id);
  const snapshot = inputSnapshot(store, sid, '', { interests: [], sources: [], contentTypes: ['text'] }, local, null, rendered);
  const result = await executePolicy(snapshot, 'joint-v1', null);
  assert(result.slate.length > 0);
  assert(result.slate.every(item => !rendered.includes(item.id)));
});

test('a temporary goal does not erase the persistent goal carried into the next session', t => {
  const { store, create } = setup(t); const sid = create('alice');
  const persistent = { type: 'update_state', target: 'goal', topic: '阅读', scope: 'topic', lifetime: 'persistent', value: '每月读一本书', version: 1, evidence_ids: ['input'] };
  const state = applyUpdates(store.state(sid), [persistent], 'input');
  const changed = applyUpdates(state, [{ ...persistent, lifetime: 'session', value: '今天想看短篇', version: 2 }], 'input2');
  assert.equal(changed.entries.length, 2);
  const next = create('alice', changed);
  assert.deepEqual(store.state(next).entries.map(e => e.value), ['每月读一本书','今天想看短篇']);
});

test('xuanji request parameters reach both model calls; progress and traces retain no key or reasoning', async t => {
  const { store, create } = setup(t); const sid = create('alice'), stages = [], requests = [];
  const video = { id: 'actual-video', source: 'youtube', modality: 'video', title: '剪辑入门' };
  const article = { id: 'filtered-article', source: 'github', modality: 'text' };
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw); requests.push(body);
    const input = JSON.parse(body.messages[1].content);
    const plan = body.messages[0].content.includes('Phase plan.');
    if (!plan) { assert.deepEqual(input.tool_results[0].items, [video]); assert.equal(input.input.candidate_pool, undefined); assert(body.messages[0].content.includes('"enum":["actual-video"]')); assert(!body.messages[0].content.includes('"const":"update_state"')); assert(!body.messages[0].content.includes('"const":"acquire"')); }
    else assert(!body.messages[0].content.includes('"const":"recommend"'));
    const actions = plan ? [{ type: 'acquire', source: 'youtube', mode: 'search', modality: 'video', query: '剪辑入门' }] : [{ type: 'recommend', candidate_ids: [video.id], reason: '适合入门' }];
    res.end(JSON.stringify({ model: 'test-provider', choices: [{ message: { content: JSON.stringify({ actions }), reasoning_content: 'private-reasoning' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve)); t.after(() => { mock.closeAllConnections(); mock.close(); });
  const requestParameters = { max_tokens: 4096, temperature: .3, enable_thinking: false, thinking: { type: 'disabled' }, extra_body: { thinking: { type: 'disabled' } } };
  const config = { key: 'private-api-key', endpoint: `http://127.0.0.1:${mock.address().port}`, model: 'configured-recommender', requestParameters };
  const result = await executePolicy(inputSnapshot(store, sid, '', settings, sources), 'joint-v1', config, { id: id(), items: [video, article] }, null, p => stages.push(p.phase));
  assert.equal(requests.length, 2); assert(requests.every(r => r.extra_body.thinking.type === 'disabled' && r.max_tokens === 4096));
  assert.deepEqual(stages, ['planning', 'retrieving', 'ranking', 'complete']); assert.deepEqual(result.slate, [video]);
  assert(!JSON.stringify(result).includes('private-api-key')); assert(!JSON.stringify(result).includes('private-reasoning'));
});

test('planning considers feedback as evidence for a scoped state update', async t => {
  const {store,create}=setup(t);const sid=create('profile-evidence');
  const feedback=store.record('feedback',sid,{track:'feed',value:'save',title:'摄影教程',topic:'摄影'});
  const snapshot=inputSnapshot(store,sid,'');let planPrompt='';
  const mock=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    const plan=body.messages[0].content.includes('Phase plan.');
    if(plan)planPrompt=body.messages[0].content;
    const actions=plan?[
      {type:'update_state',target:'memory',value:'近期关注摄影教程',scope:'topic',topic:'摄影',lifetime:'session',version:snapshot.state.version,evidence_ids:[feedback.id]},
      {type:'acquire',source:'local',mode:'explore',modality:'text',query:'摄影'}
    ]:[{type:'recommend',candidate_ids:['item-profile'],reason:'摄影'}];
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({actions})},finish_reason:'stop'}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));t.after(()=>{mock.closeAllConnections();mock.close();});
  const config={key:'fixture',endpoint:`http://127.0.0.1:${mock.address().port}`,model:'fixture'};
  const result=await executePolicy(snapshot,'joint-v1',config,{id:id(),items:[{id:'item-profile',source:'local',modality:'text',title:'摄影'}]});
  assert.match(planPrompt,/behavior.*feedback/i);
  assert.match(planPrompt,/tentative/i);
  assert.equal(result.state_after.entries[0].evidence_ids[0],feedback.id);
  assert.equal(result.state_after.entries[0].lifetime,'session');
});

test('model connection failures explain that profile updates could not run', async t => {
  const {store,create}=setup(t);const snapshot=inputSnapshot(store,create('offline-profile'),'');
  await assert.rejects(executePolicy(snapshot,'joint-v1',{key:'fixture',endpoint:'http://127.0.0.1:1',model:'fixture'}),error=>{
    assert.match(error.message,/模型接口.*连接/);
    assert.equal(error.partial_trace.at(-1).failed_phase,'plan');
    return true;
  });
});
