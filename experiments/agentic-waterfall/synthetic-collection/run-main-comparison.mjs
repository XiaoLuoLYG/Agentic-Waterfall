import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { installMeteredFetch } from './api.mjs';
import { bailianComparisonApi } from './bailian-comparison-api.mjs';
import { loadDualDataset } from './check-dual-dataset.mjs';
import { comparisonMethods, runComparison } from './comparison.mjs';
import { errorText, now, read, save, sha } from './collection.mjs';
import { prepareMainResume } from './prepare-main-resume.mjs';

const [previousArg, outputArg, mode, ...args] = process.argv.slice(2);
const useGateway = mode === '--gateway';
const retryFailed = args.includes('--retry-failed');
const positional = args.filter(value => value !== '--retry-failed');
const [configPath, interruptedArg, mindArg] = useGateway ? positional : [mode, ...positional];
assert(previousArg && outputArg && configPath && (!useGateway || (interruptedArg && mindArg)),
  'Usage: node run-main-comparison.mjs PREVIOUS_RUN_DIR NEW_RUN_DIR KEY_FILE [INTERRUPTED_RUN_DIR] or --gateway CONFIG INTERRUPTED_RUN_DIR PAUSED_MIND_DIR [--retry-failed]');
assert(!retryFailed || interruptedArg, 'failure retry requires a prior run');
const previous = realpathSync(previousArg);
const root = join(realpathSync(dirname(resolve(outputArg))), resolve(outputArg).split('/').at(-1));
assert(root !== previous && !root.startsWith(previous + '/') && !existsSync(root), 'new comparison requires its own unused directory');
const interruptedRun = interruptedArg && realpathSync(interruptedArg);
assert(!interruptedRun || !root.startsWith(interruptedRun + '/'), 'continuation must keep its source intact');
const originals = ['plan.json', 'comparison/manifest.json', 'comparison/analysis.json'].map(file => join(previous, file));
const oldHashes = () => Object.fromEntries(originals.map(path => [path, sha(readFileSync(path))]));
const preserved = oldHashes();
const original = read(originals[0]), frozen = read(originals[1]).frozen;
assert.equal(read(originals[2]).status, 'completed');
assert.deepEqual(original.methods, comparisonMethods);
mkdirSync(root, { mode: 0o700 });
const abort = new AbortController();
const stop = error => abort.abort(error);
let api, gateway, mindEvidence;
process.once('SIGINT', () => stop(Error('SIGINT')));
process.once('SIGTERM', () => stop(Error('SIGTERM')));
const state = { pid: process.pid, started_at: now(), status: 'preparing', phase: 'validating frozen dataset' };
const update = () => save(join(root, 'progress.json'), { ...state, updated_at: now(), ...(api ? { api: api.stats() } : {}) });
update();
const heartbeat = setInterval(update, 5000);
try {
  if (useGateway) {
    const mind = realpathSync(mindArg);
    const p = read(join(mind, 'progress.json'));
    assert(p.phase === 'stopped' && p.running === 0 && p.retry_running === 0 && !existsSync(join(mind, 'runner.lock')),
      'RecAgent MIND must be stopped and drained');
    const ledgers = readdirSync(join(mind, 'gateway')).sort().reverse()
      .map(dir => join(mind, 'gateway', dir, 'api', 'stats.json'));
    const ledger = ledgers.find(file => existsSync(file) && read(file).pid === p.pid);
    assert(ledger, 'missing closed MIND API ledger');
    const prior = read(ledger);
    assert(prior.closed_at && prior.in_flight === 0 && prior.waiting === 0 && prior.pending.length === 0 &&
      prior.slots.length === 3 && /^[a-f0-9]{64}$/.test(prior.credential_set_sha256), 'MIND gateway did not drain all three keys');
    const parallelism = [10, 16, 10];
    gateway = await installMeteredFetch({ configPath, outputDir: root, parallelism, expectedCredentialSet: prior.credential_set_sha256 });
    mindEvidence = { run: mind, closed_ledger: ledger, parallelism };
    const protect = call => async (...parameters) => {
      try { return await call(...parameters); }
      catch (error) {
        if (!gateway.stats().slots.some(slot => slot.enabled.flash)) stop(Error('No verified Flash API slot'));
        throw error;
      }
    };
    api = { raw: {}, flashModel: gateway.flashModel.toLowerCase(), complete: protect(gateway.complete), generate: protect(gateway.generate),
      stats() {
        const s = gateway.stats();
        return { endpoint: gateway.endpoint, model: api.flashModel, credential_set_sha256: s.credential_set_sha256,
          requests: s.attempts, successes: s.successes, failed: s.failures, throttled: s.throttled,
          active: s.http_in_flight, waiting: s.waiting, peak_inflight: s.peak_http_in_flight,
          total_tokens: s.prompt_tokens + s.completion_tokens, slots: s.slots };
      } };
  } else api = bailianComparisonApi(configPath, root, stop);
  for (const setting of [frozen.method_model, frozen.judge_model]) assert.equal(setting.name.toLowerCase(), api.flashModel);
  const { inputs, tracks, ready } = loadDualDataset(original.dataset);
  assert.equal(ready.manifest_sha256, original.dataset_manifest_sha256);
  assert.equal(ready.comparison_cutoffs_sha256, original.comparison_cutoffs_sha256);
  assert.deepEqual(ready.pools, original.pools);
  assert.equal(inputs.length, original.checkpoints);
  const code = Object.fromEntries(['run-main-comparison.mjs', 'bailian-comparison-api.mjs', 'comparison.mjs',
    'comparison-pool.mjs', 'comparison-runtime.mjs', 'prepare-main-resume.mjs', ...(useGateway ? ['api.mjs'] : [])].map(file => {
    const bytes = readFileSync(new URL('./' + file, import.meta.url));
    save(join(root, 'code', file), bytes);
    return [file, sha(bytes)];
  }));
  const { credential_set_sha256, endpoint, model, quota } = api.stats();
  if (interruptedRun) {
    const saved = read(join(interruptedRun, 'plan.json'));
    const pinned = { model, dataset_manifest_sha256: ready.manifest_sha256, comparison_cutoffs_sha256: ready.comparison_cutoffs_sha256 };
    if (!useGateway) Object.assign(pinned, { credential_set_sha256, endpoint });
    for (const [field, expected] of Object.entries(pinned)) {
      assert.equal(saved[field], expected, 'continuation changed ' + field);
    }
    for (const file of ['comparison.mjs', 'comparison-pool.mjs', 'comparison-runtime.mjs', 'bailian-comparison-api.mjs']) {
      assert.equal(saved.code[file], code[file], 'continuation changed ' + file);
    }
  }
  save(join(root, 'plan.json'), { protocol: 'synthetic-independent-recall-v1', preserved, dataset: original.dataset,
    dataset_manifest_sha256: ready.manifest_sha256, comparison_cutoffs_sha256: ready.comparison_cutoffs_sha256,
    pools: ready.pools, methods: comparisonMethods, checkpoints: inputs.length, method_slots: inputs.length * comparisonMethods.length,
    model, endpoint, quota, credential_set_sha256, code, ...(interruptedRun ? { continued_from: interruptedRun } : {}),
    ...(mindEvidence ? { gateway: mindEvidence } : {}), ...(retryFailed ? { retry_failed: true } : {}) });
  state.phase = 'verifying pinned model';
  update();
  if (useGateway) {
    const checks = await gateway.preflight({ includePro: false, verifyThinking: true });
    state.gateway_preflight = checks;
    assert(checks.some(check => check.ok), 'none of the three gateway keys passed the pinned-model probes');
    update();
  } else for (const enable_thinking of [true, false]) {
    const max_tokens = enable_thinking ? frozen.method_model.max_tokens : frozen.judge_model.max_tokens;
    const result = await api.complete({ messages: [{ role: 'user', content: 'Return only the JSON object {"ok":true}.' }],
      temperature: enable_thinking ? frozen.method_model.temperature : frozen.judge_model.temperature,
      enable_thinking, max_tokens, response_format: { type: 'json_object' } }, { stage: 'preflight', signal: abort.signal });
    assert.equal(JSON.parse(result.choices[0].message.content).ok, true);
    if (enable_thinking) assert(result.choices[0].message.reasoning_content, 'thinking-enabled preflight did not return reasoning');
  }
  if (interruptedRun) {
    const recovered = await prepareMainResume(interruptedRun, join(root, 'comparison'), tracks, comparisonMethods, credential_set_sha256,
      useGateway ? endpoint : undefined, { retryFailed });
    save(join(root, 'continuation.json'), recovered);
    state.reused = { method_runs: recovered.kept_runs, labels: recovered.kept_labels };
  }
  state.status = 'running';
  state.phase = 'independent recall and blind judging';
  update();
  const result = await runComparison({ root: join(root, 'comparison'), inputs, api, dualPool: ready.pools,
    independentRecall: true, signal: abort.signal, onProgress: evaluation => { state.evaluation = evaluation; } });
  assert.deepEqual(oldHashes(), preserved, 'previous experiment artifacts changed');
  const newFrozen = read(join(root, 'comparison', 'manifest.json')).frozen;
  const core = 'lib/waterfall/waterfall-core.mjs';
  assert.equal(newFrozen.source_files[core], frozen.source_files[core], 'Waterfall core version changed');
  assert.deepEqual(newFrozen.weights, frozen.weights, 'BGE weights changed');
  assert.deepEqual(newFrozen.limits, frozen.limits, 'comparison budget changed');
  assert(result.integrity.passed && result.coverage.done === original.method_slots && result.coverage.contexts_done === original.checkpoints,
    'comparison did not finish every slot: ' + JSON.stringify(result.failures.slice(0, 5)));
  assert(result.coverage.label_failures / Math.max(1, result.coverage.labels_done) <= original.max_label_failure_rate, 'judge failure rate exceeds prior protocol threshold');
  state.status = 'completed';
  state.phase = 'verified';
  console.log(JSON.stringify({ status: state.status, coverage: result.coverage, api: api.stats() }));
} catch (error) {
  state.status = 'incomplete';
  state.error = errorText(error);
  console.error(state.error);
  process.exitCode = 1;
} finally {
  gateway?.restore();
  state.finished_at = now();
  update();
  clearInterval(heartbeat);
}
