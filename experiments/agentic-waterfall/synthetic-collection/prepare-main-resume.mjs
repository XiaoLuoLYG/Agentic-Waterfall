import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { read, save, sha } from './collection.mjs';

const hash = value => sha(JSON.stringify(value));
const interrupted = /AccessDenied\.Unpurchased|Bailian response interrupted|operation was aborted|api_request_aborted|api_draining|No verified flash API slot|SIGINT|SIGTERM|request_gate_(?:call_deadline_exceeded|wait_exceeds_(?:90|300)s)/i;

function verified(row) {
  const { record_sha256, ...body } = row;
  assert.equal(record_sha256, hash(body), 'interrupted run record hash changed');
  return row;
}

export async function prepareMainResume(source, target, tracks, methods, credentialHash, newEndpoint, { retryFailed = false } = {}) {
  const old = join(source, 'comparison');
  assert(!existsSync(target) && !existsSync(join(old, 'comparison.lock')), 'resume requires stopped source and an unused target');
  const progress = read(join(source, 'progress.json'));
  const analysis = read(join(old, 'analysis.json'));
  const manifest = read(join(old, 'manifest.json'));
  const config = hash(manifest.frozen);
  assert(progress.status === 'incomplete' || (retryFailed && progress.status === 'completed'), 'resume requires a stopped run');
  assert.equal(analysis.config_sha256, config);
  const priorTransport = manifest.frozen.transport;
  if (!newEndpoint) assert.equal(priorTransport.credential_set_sha256, credentialHash, 'resume requires the same credentials');
  const frozen = newEndpoint ? { ...manifest.frozen,
    transport: { ...priorTransport, credential_set_sha256: credentialHash, model_api: newEndpoint } } : manifest.frozen;
  const nextConfig = hash(frozen);
  const transportChanged = nextConfig !== config;
  assert.deepEqual(analysis.method_ids, methods);
  const snapshots = new Map(analysis.checkpoints.map(row => [JSON.stringify([row.user, row.round]), row]));
  const { createResearchStateStore } = await import(pathToFileURL(join(old, 'runtime/source/site/scripts/research-service.mjs')));
  const copy = rel => {
    const to = join(target, rel);
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    copyFileSync(join(old, rel), to);
  };

  const carry = (rel, { record_sha256, ...body }, gzip = false) => {
    if (!transportChanged) return copy(rel);
    const record = { ...body, config_sha256: nextConfig, resumed_from: {
      config_sha256: config, record_sha256: record_sha256 ?? hash(body), model_api: priorTransport.model_api,
    } };
    const data = record_sha256 ? { ...record, record_sha256: hash(record) } : record;
    save(join(target, rel), gzip ? gzipSync(JSON.stringify(data)) : data);
  };
  if (transportChanged) {
    save(join(target, 'manifest.json'), { ...manifest, frozen, resumed_from: { source, config_sha256: config, transport: priorTransport } });
  } else copy('manifest.json');
  copy('input-lineage.json');
  cpSync(join(old, 'runtime'), join(target, 'runtime'), { recursive: true, errorOnExist: true, force: false });
  const keep = new Map(), kept_by_method = Object.fromEntries(methods.map(method => [method, 0]));
  for (const [user, inputs] of tracks) for (const method of methods) {
    let prior = hash(null), last;
    const stateDir = join('state', user, method);
    for (const input of inputs) {
      const contextKey = JSON.stringify([user, input.round]);
      const snapshot = snapshots.get(contextKey);
      assert.equal(snapshot.input_sha256, input.input_sha256);
      assert.equal(snapshot.public_input_sha256, input.public_input_sha256);
      const run = join('runs', user, String(input.round), method + '.json.gz');
      const attempt = join('attempts', user, String(input.round), method + '.json');
      if (!existsSync(join(old, run))) break;
      const bytes = readFileSync(join(old, run));
      const record = verified(JSON.parse(gunzipSync(bytes)));
      const row = record.methods[0];
      if ((retryFailed && row.status === 'failed') || interrupted.test(row.error ?? '') ||
          row.trace.some(entry => interrupted.test(entry.error ?? ''))) break;
      assert.equal(snapshot.methods[method].run_file_sha256, sha(bytes));
      assert.equal(snapshot.methods[method].run_id, record.run_id);
      assert.equal(row.method_id, method);
      assert.equal(record.config_sha256, config);
      assert.equal(record.state_before_sha256, prior);
      assert.equal(record.input_sha256, input.input_sha256);
      assert.equal(record.public_input_sha256, input.public_input_sha256);
      assert.equal(hash(row.slate), record.slate_sha256);
      const dispatch = read(join(old, attempt));
      assert.equal(dispatch.run_id, record.run_id);
      assert.equal(dispatch.config_sha256, config);
      const archive = join(stateDir, 'archives', record.run_id + '.jsonl');
      const commit = readFileSync(join(old, archive), 'utf8').trimEnd().split('\n').map(JSON.parse)
        .find(entry => entry.event === 'method_complete');
      assert.equal(commit.run_id, record.run_id);
      assert.equal(commit.user_id, input.userId);
      assert.equal(commit.method_id, method);
      assert.equal(commit.state_sha256, record.state_after_sha256);
      assert.equal(hash(commit.next_state), commit.state_sha256);
      carry(run, record, true);
      carry(attempt, dispatch);
      copy(archive);
      prior = commit.state_sha256;
      last = commit;
      keep.set(contextKey, (keep.get(contextKey) ?? 0) + 1);
      kept_by_method[method]++;
    }
    if (last) {
      const store = createResearchStateStore(join(target, stateDir));
      store.set(last.user_id, method, last.next_state, { run_id: last.run_id, state_sha256: last.state_sha256 });
      assert.equal(hash(store.get(last.user_id, method)), prior);
    }
  }

  let kept_labels = 0;
  for (const [user, inputs] of tracks) for (const input of inputs) {
    const dir = join('studies', user, String(input.round));
    const original = join(old, dir);
    if (!existsSync(join(original, 'labels'))) continue;
    const questions = read(join(original, 'questions.json'));
    for (const filename of readdirSync(join(original, 'labels'))) {
      const rel = join(dir, 'labels', filename);
      const label = verified(read(join(old, rel)));
      if (!['answered', 'unable'].includes(label.status)) continue;
      if (label.mode === 'blind' && keep.get(JSON.stringify([user, input.round])) !== methods.length) continue;
      assert.equal(label.provider_model.toLowerCase(), manifest.frozen.judge_model.name.toLowerCase());
      assert.equal(label.config_sha256, config);
      assert.equal(label.input_sha256, input.input_sha256);
      assert.equal(label.phase_sha256, input.phase_sha256);
      assert.equal(label.public_input_sha256, input.public_input_sha256);
      const question = (label.mode === 'rating' ? questions.ratings : questions.blind).find(item => item.id === label.question_id);
      assert.equal(filename, label.question_id + '.json');
      // A previously carried rating can become unused when a method's slate changes.
      if (!question) continue;
      assert.equal(label.material_sha256, question.material_sha256);
      const attempt = join(dir, 'label-attempts', filename);
      const dispatch = read(join(old, attempt));
      assert.equal(dispatch.request_sha256, label.request_sha256);
      assert.equal(dispatch.config_sha256, config);
      carry(rel, label);
      carry(attempt, dispatch);
      kept_labels++;
    }
  }
  const historyPath = join(source, 'continuation.json');
  const history = existsSync(historyPath) ? read(historyPath).prior_api_usage : null;
  return { source, config_sha256: config, continued_config_sha256: nextConfig,
    ...(transportChanged ? { from_endpoint: priorTransport.model_api, to_endpoint: newEndpoint } : {}),
    kept_by_method, kept_runs: Object.values(kept_by_method).reduce((a, b) => a + b, 0), kept_labels,
    prior_api_usage: {
      total_tokens: (progress.api.total_tokens ?? 0) + (history?.total_tokens ?? 0),
      peak_inflight: Math.max(progress.api.peak_inflight ?? 0, history?.peak_inflight ?? 0),
      throttled: (progress.api.throttled ?? 0) + (history?.throttled ?? 0),
    } };
}
