import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildFormalAdapter} from './formal-adapters.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const json = (path, value) => writeFileSync(path, JSON.stringify(value));
test('AgentRecBench uses the existing disk index and never returns masked reviews', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-formal-arb-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const data = join(dir, 'data'), tasks = join(dir, 'task'), index = join(dir, 'index.sqlite');
  mkdirSync(data); mkdirSync(join(tasks, 'tasks'), {recursive: true}); mkdirSync(join(tasks, 'groundtruth'));
  const candidates = Array.from({length: 20}, (_, i) => `item-${i}`);
  for (const [kind, rows] of Object.entries({
    item: candidates.slice(0,19).map(item_id => ({item_id, title: item_id, description: item_id===candidates[0]?'full description '+ 'x'.repeat(12000)+' END_OF_DESCRIPTION':'public details', private_label:'DO_NOT_EXPOSE'})), user: [{user_id: 'u', name: 'user'}],
    review: [{review_id: 'hidden', user_id: 'u', item_id: candidates[0], text: 'SECRET_HIDDEN'},
      {review_id: 'visible', user_id: 'u', item_id: candidates[1], text: 'public review'}],
  })) writeFileSync(join(data, `${kind}.json`), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const taskFile = join(tasks, 'tasks/task_0.json');
  json(taskFile, {type: 'recommendation', user_id: 'u', candidate_list: candidates});
  json(join(tasks, 'groundtruth/groundtruth_0.json'), {'ground truth': candidates[0]});
  const build = spawnSync('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from indexed_tool import build_index;build_index(sys.argv[2],sys.argv[3])', resolve(root, 'methods/agentic-waterfall/agentrecbench-data'), data, index], {encoding: 'utf8'});
  assert.equal(build.status, 0, build.stderr);
  const adapter = await buildFormalAdapter({dataset: 'agentrecbench', root, domain: 'amazon', task_file: taskFile, task_dir: tasks, data_dir: data, index_file: index});
  assert.equal(adapter.input.observation.decision_id, 'agentrecbench:short_term:amazon:0');
  assert.equal(adapter.input.observation.environment.candidate_pool.length, 20);
  const pool=adapter.input.observation.environment.candidate_pool;
  assert.equal(JSON.parse(pool[0].text).description.endsWith('END_OF_DESCRIPTION'),true);
  assert.equal(JSON.parse(pool.at(-1).text).metadata_status,'unavailable');
  assert.equal(adapter.toolCalls.filter(call=>call.phase==='candidate_preload').length,20);
  assert.equal(adapter.input.run_meta.candidate_details.preloaded_requests,20);
  assert.deepEqual(adapter.input.run_meta.candidate_details.unavailable_ids,[candidates.at(-1)]);
  assert.equal(JSON.stringify(adapter.input).includes('DO_NOT_EXPOSE'),false);
  const {runEpisode}=await import('../../../demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs');
  const direct=await runEpisode(adapter.input,{decide:async observation=>{
    assert.equal(JSON.parse(observation.environment.candidate_pool[0].text).description.endsWith('END_OF_DESCRIPTION'),true);
    return {decision_id:observation.decision_id,actions:[{action_id:'rank',kind:'recommend',arguments:{ordered_item_ids:candidates,delivery:'replace_pending'},depends_on:[],evidence_refs:[]}]};
  }});
  assert.equal(direct.status,'submitted');
  const reviews = await adapter.acquire({source_ids: ['get_reviews'], mode: 'browse', query: '{"user_id":"u"}'}, {remaining_tool_calls: 1});
  assert.equal(reviews.evidence[0].result.length, 1);
  assert.equal(reviews.evidence[0].result[0].review_id, 'visible');
  assert.equal(JSON.stringify([adapter.input, reviews, adapter.toolCalls]).includes('SECRET_HIDDEN'), false);
  const item = await adapter.acquire({source_ids: ['get_item'], mode: 'browse', target_id: candidates[0]}, {remaining_tool_calls: 1});
  assert.equal(item.items[0].id, candidates[0]);
});

function simbenchFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-formal-claw-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const workspace = 'group_001__user_1', cutoff = 1769990400000;
  function event(number) {
    const folder = join(dir, workspace, `event_${String(number).padStart(2, '0')}`, 'input');
    mkdirSync(folder, {recursive: true});
    json(join(folder, 'manifest.json'), {case_id: `${workspace}__event_${String(number).padStart(2, '0')}`, user_id: '1', runtime_sequence: {current_event_position: number}});
    json(join(folder, 'allowed_sources.json'), {platforms: {'www.bilibili.com': 1, 'www.xiaohongshu.com': 1}});
    writeFileSync(join(folder, 'evidence.visible.jsonl'), JSON.stringify({event: number, step: 1, kind: 'content_interest', record_id: `r${number}`, title: 'robot', platform: 'bilibili', ts_end_ms: cutoff, ground_truth: 'PRIVATE_SENTINEL', context: {next_content_keys: ['unseen']}}) + '\n');
    return folder;
  }
  const snapshot = join(dir, 'snapshot'); mkdirSync(snapshot);
  const rows = [{id: 'past', source: 'bilibili', title: 'robot', text: 'robot', url: 'https://bilibili.com/past', published_at: '2020-01-01T00:00:00Z'},
    {id: 'future', source: 'bilibili', title: 'robot', text: 'robot', url: 'https://bilibili.com/future', published_at: '2030-01-01T00:00:00Z'}];
  const raw = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(join(snapshot, 'catalog.jsonl'), raw);
  json(join(snapshot, 'manifest.json'), {sources: {bilibili: 2}, catalog_sha256: createHash('sha256').update(raw).digest('hex')});
  return {workspace, event, snapshot, task: {dataset: 'clawrec', root, snapshot_dir: snapshot}};
}
test('ClawRec uses the same frozen search cutoff and preserves consecutive own state', async t => {
  const f = simbenchFixture(t), first = await buildFormalAdapter({...f.task, case_input: f.event(1)});
  assert.equal(JSON.stringify(first.input).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(first.input.run_meta.unavailable_sources, ['xiaohongshu']);
  const found = await first.acquire({source_ids: ['bilibili'], mode: 'search', query: 'robot', limit: 100}, {remaining_tool_calls: 1});
  assert.deepEqual(found.items.map(item => item.id), ['past']);
  assert.equal(first.toolCalls[0].arguments.limit, 10);
  const state = {version: 2, records: [{id: 'preference', value: 'robot'}]};
  const second = await buildFormalAdapter({...f.task, case_input: f.event(2)}, {input: first.input, result: {state_after: state}});
  assert.deepEqual(second.input.observation.user_state, state);
  await assert.rejects(buildFormalAdapter({...f.task, case_input: f.event(3)}, {input: first.input, result: {state_after: state}}), /prior state mismatch/);
  await assert.rejects(first.acquire({source_ids: ['xiaohongshu'], mode: 'search', query: 'robot', limit: 10}, {remaining_tool_calls: 1}), /invalid_frozen_search/);
});
test('ClawRec rejects missing prior state and modified snapshots before a model call', async t => {
  const f = simbenchFixture(t);
  await assert.rejects(buildFormalAdapter({...f.task, case_input: f.event(2)}), /prior state required/);
  writeFileSync(join(f.snapshot, 'catalog.jsonl'), '{}\n');
  await assert.rejects(buildFormalAdapter({...f.task, case_input: f.event(1)}), /snapshot_hash_mismatch/);
});
