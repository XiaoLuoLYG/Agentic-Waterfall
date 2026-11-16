import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync,
  readSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const strings = ['index', 'manifest', 'out', 'python', 'transport', 'config', 'prior-api'];
const {values} = parseArgs({options: {
  ...Object.fromEntries(strings.map(name => [name, {type: 'string'}])),
  workers: {type: 'string', default: '48'},
  recover: {type: 'boolean', default: false},
  'previous-capacity': {type: 'string'},
  'final-retry': {type: 'string'},
}});
for (const name of strings) if (!values[name]) throw Error('--' + name + ' is required');
const workers = Number(values.workers);
assert(Number.isInteger(workers) && workers >= 1 && workers <= 48);
const finalRetryPath = values['final-retry'] ? resolve(values['final-retry']) : null;
assert(!finalRetryPath || values.recover, 'final retry requires an existing recovery run');
const out = resolve(values.out);
const adapter = fileURLToPath(new URL('./mind.py', import.meta.url));
const loader = fileURLToPath(new URL('../../../experiments/agentic-waterfall/agentrecbench/scripts/recagent_all_candidates.py', import.meta.url));
const here = fileURLToPath(import.meta.url);
const now = () => new Date().toISOString();
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(name, value) {
  const path = join(out, name);
  const temp = path + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  renameSync(temp, path);
}

mkdirSync(out, {recursive: true, mode: 0o700});
const lock = join(out, 'runner.lock');
writeFileSync(lock, String(process.pid) + '\n', {flag: 'wx', mode: 0o600});
let phase = 'preparing', stopped = false, fatal = null, db, input, api, progressTimer;
const stop = () => { stopped = true; };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

const modelParameters = {enable_thinking: false, thinking: {type: 'disabled'},
  extra_body: {thinking: {type: 'disabled'}}};
const startup = now();
const firstConnectionHoldMs = 2000;
const maxConnectionHoldMs = 15000;
const connectionErrors = new Set([
  'model_transport_error', 'model_timeout', 'model_http_408', 'model_http_500',
  'model_http_502', 'model_http_503', 'model_http_504', 'model_http_520',
  'model_http_521', 'model_http_522', 'model_http_523', 'model_http_524',
]);
const interrupted = new Error('stopped before a model response');
let connectionFailures = 0, holdUntil = 0, probeInFlight = false, deferredRequests = 0;
let pauseMs = firstConnectionHoldMs;

function restoreConnection() {
  connectionFailures = 0;
  holdUntil = 0;
  pauseMs = firstConnectionHoldMs;
}

async function awaitConnection() {
  while (holdUntil && !stopped) {
    const remaining = holdUntil - Date.now();
    if (remaining <= 0 && !probeInFlight) {
      probeInFlight = true;
      return true;
    }
    await sleep(Math.max(100, Math.min(remaining, 1000)));
  }
  return false;
}

async function rankThroughGateway(payload, row, turn) {
  let deferrals = 0;
  while (!stopped) {
    const probe = await awaitConnection();
    if (stopped) break;
    try {
      const reply = await api.complete(payload, {
        stage: 'recagent_mind_rank', decision_id: row.decision_id, turn, transport_deferrals: deferrals,
      });
      if (!holdUntil || probe) restoreConnection();
      return reply;
    } catch (error) {
      const code = error.code ?? error.message;
      const connectionError = connectionErrors.has(code);
      const localCapacity = code === 'api_capacity_wait_exceeded' ||
        /^request_gate_(?:wait_exceeds_(?:90|300)s|call_deadline_exceeded)$/.test(code);
      const throttle = code === 'model_http_429' && error.retryable !== false;
      if (!api.stats().slots.some(slot => slot.enabled.flash)) throw error;
      if (connectionError || (probe && localCapacity)) {
        connectionFailures++;
        if (probe || (!holdUntil && connectionFailures >= 3)) {
          holdUntil = Date.now() + pauseMs;
          pauseMs = Math.min(pauseMs * 2, maxConnectionHoldMs);
        }
      } else if ((!holdUntil || probe) && !localCapacity) {
        restoreConnection();
      }
      if (!(connectionError || localCapacity || throttle)) throw error;
      deferrals++;
      deferredRequests++;
      appendFileSync(join(out, 'deferred-transport.jsonl'), JSON.stringify({
        at: now(), decision_id: row.decision_id, turn, deferral: deferrals, error: code,
        status: error.status ?? null,
      }) + '\n', {mode: 0o600});
      if (connectionError && !holdUntil) await sleep(250);
    } finally {
      if (probe) probeInFlight = false;
    }
  }
  throw interrupted;
}

try {
  const manifest = json(resolve(values.manifest));
  const source = resolve(manifest.source);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(source)) digest.update(chunk);
  assert.equal(digest.digest('hex'), manifest.source_sha256, 'source hash changed');
  const indexPath = resolve(values.index);
  const plan = {
    dataset: 'MIND-small/original-dev', eligible: manifest.eligible,
    cohort: 'at least two historical clicks', source, source_sha256: manifest.source_sha256,
    index_sha256: hash(readFileSync(indexPath)),
    adapter_sha256: hash(readFileSync(adapter)), loader_sha256: hash(readFileSync(loader)),
    runner_sha256: hash(readFileSync(here)), transport_sha256: hash(readFileSync(resolve(values.transport))),
    model: 'DeepSeek-V4.1-Flash-1017', ranking: 'single direct candidate index permutation',
    retries_per_impression: 1, retry_policy: 'after first pass, same request, failed impressions only',
    previous_pilot_predictions_reused: 0, labels_read: false,
  };
  const planFile = join(out, 'plan.json');
  if (existsSync(planFile)) {
    const original = json(planFile);
    assert.deepEqual(values.recover ? {
      ...plan, runner_sha256: original.runner_sha256, transport_sha256: original.transport_sha256,
    } : plan, original, 'frozen model or input changed');
    if (values.recover) {
      const recoveryPlan = {...plan, original_plan_sha256: hash(readFileSync(planFile)),
        recovery: 'one additional model response for unresolved impressions; defer connectivity and rate limits'};
      const recoveryFile = join(out, 'recovery-plan.json');
      if (existsSync(recoveryFile)) {
        const previous = json(recoveryFile);
        assert.deepEqual({...recoveryPlan, runner_sha256: previous.runner_sha256,
          transport_sha256: previous.transport_sha256}, previous, 'frozen recovery protocol changed');
        if (plan.runner_sha256 !== previous.runner_sha256 || plan.transport_sha256 !== previous.transport_sha256) {
          const revision = 'recovery-plan-' + hash(JSON.stringify(recoveryPlan)).slice(0, 12) + '.json';
          const path = join(out, revision);
          if (existsSync(path)) assert.deepEqual(json(path), recoveryPlan);
          else snapshot(revision, recoveryPlan);
        }
      } else snapshot('recovery-plan.json', recoveryPlan);
    }
  } else {
    assert(!values.recover, 'recovery requires the original run');
    snapshot('plan.json', plan);
  }

  input = openSync(source, 'r');
  db = new DatabaseSync(join(out, 'run.sqlite'));
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;' +
    "CREATE TABLE IF NOT EXISTS impressions(id INTEGER PRIMARY KEY, decision_id TEXT UNIQUE NOT NULL, offset INTEGER NOT NULL, bytes INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', first_outcome TEXT, prediction TEXT, error TEXT);" +
    'CREATE INDEX IF NOT EXISTS impressions_state ON impressions(state,id);' +
    'CREATE TABLE IF NOT EXISTS attempts(id INTEGER NOT NULL, turn INTEGER NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, request_sha256 TEXT, failed_request TEXT, response TEXT, result TEXT, PRIMARY KEY(id,turn));'
  );
  const totalRows = () => db.prepare('SELECT count(*) AS count FROM impressions').get().count;
  if (!totalRows()) {
    const index = new DatabaseSync(indexPath, {readOnly: true});
    try {
      const insert = db.prepare('INSERT INTO impressions(id,decision_id,offset,bytes) VALUES (?,?,?,?)');
      db.exec('BEGIN IMMEDIATE');
      for (const row of index.prepare('SELECT id,decision_id,offset,bytes FROM tasks WHERE eligible=1 ORDER BY id').iterate()) {
        insert.run(row.id, row.decision_id, row.offset, row.bytes);
      }
      assert.equal(totalRows(), manifest.eligible);
      db.exec('COMMIT');
    } finally { index.close(); }
  }
  assert.equal(totalRows(), manifest.eligible);
  assert(!db.prepare("SELECT 1 FROM impressions WHERE state IN ('running','retry_running','recovery_running','final_retry_running') LIMIT 1").get(),
    'interrupted requests require receipt reconciliation before resume');
  const status = db.prepare('SELECT state,first_outcome,count(*) AS n FROM impressions GROUP BY state,first_outcome');
  const failures = db.prepare('SELECT decision_id,state,error FROM impressions WHERE error IS NOT NULL ORDER BY id DESC LIMIT 8');
  const attemptsDone = db.prepare('SELECT count(*) AS n FROM attempts WHERE turn=2 AND finished_at IS NOT NULL');
  const firstErrors = db.prepare("SELECT count(*) AS n FROM impressions WHERE first_outcome='failed'");
  const recoveryDone = db.prepare('SELECT count(*) AS n FROM attempts WHERE turn=3 AND finished_at IS NOT NULL');
  const recoveryPending = db.prepare(
    "SELECT count(*) AS n FROM impressions i WHERE state='exhausted' AND NOT EXISTS " +
    '(SELECT 1 FROM attempts a WHERE a.id=i.id AND a.turn=3 AND a.finished_at IS NOT NULL)'
  );
  const finalDone = db.prepare('SELECT count(*) AS n FROM attempts WHERE turn=4 AND finished_at IS NOT NULL');
  const finalTargets = new Map();
  if (finalRetryPath) {
    const assignment = json(finalRetryPath);
    for (const row of assignment.cases) {
      assert(typeof row.request_sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.request_sha256));
      finalTargets.set(row.decision_id, row.request_sha256);
    }
    assert.equal(assignment.count, assignment.cases.length);
    assert.equal(finalTargets.size, assignment.count);
    const eligible = db.prepare(
      "SELECT i.decision_id,a.request_sha256 FROM impressions i JOIN attempts a ON a.id=i.id AND a.turn=3 " +
      "WHERE a.finished_at IS NOT NULL AND (i.state='exhausted' OR EXISTS (SELECT 1 FROM attempts b WHERE b.id=i.id AND b.turn=4))"
    ).all();
    assert.equal(eligible.length, finalTargets.size, 'final retry cohort changed');
    for (const row of eligible) {
      assert.equal(finalTargets.get(row.decision_id), row.request_sha256, 'final retry assignment changed');
    }
    assert.equal(recoveryPending.get().n, 0, 'fault recovery still has pending work');
  }
  const counts = () => {
    const result = {pending: 0, running: 0, retry_pending: 0, retry_running: 0,
      recovery_running: 0, final_retry_running: 0, submitted: 0, exhausted: 0};
    let firstDone = 0;
    for (const row of status.all()) {
      result[row.state] += row.n;
      if (row.first_outcome) firstDone += row.n;
    }
    const recovery_pending = values.recover ? recoveryPending.get().n : 0;
    const recovery_done = recoveryDone.get().n;
    const final_retry_done = finalDone.get().n;
    const final_retry_total = finalTargets.size;
    const final_retry_pending = finalRetryPath ? final_retry_total - final_retry_done - result.final_retry_running : 0;
    return {...result, first_done: firstDone, first_failed: firstErrors.get().n, retries_done: attemptsDone.get().n,
      recovery_pending, recovery_done, recovery_total: recovery_pending + result.recovery_running + recovery_done,
      final_retry_pending, final_retry_done, final_retry_total};
  };
  const priorProgress = existsSync(join(out, 'progress.json')) ? json(join(out, 'progress.json')) : null;
  const started = priorProgress?.started_at ?? startup;
  function progress() {
    const stats = api?.stats();
    snapshot('progress.json', {
      pid: process.pid, phase, started_at: started, updated_at: now(), dataset: plan.dataset, total: plan.eligible,
      ...counts(), recent_failures: failures.all(), error: fatal,
      transport: {deferred_requests: deferredRequests, hold_until: holdUntil ? new Date(holdUntil).toISOString() : null,
        checking_connection: probeInFlight},
      gateway: stats ? {attempts: stats.attempts, http_in_flight: stats.http_in_flight,
        peak_http_in_flight: stats.peak_http_in_flight, prompt_tokens: stats.prompt_tokens,
        completion_tokens: stats.completion_tokens, slots: stats.slots.map(
          ({id, enabled, http_in_flight, max_concurrent, configured_rpm, rpm_60s, attempts, cooldown_until}) =>
            ({id, enabled: enabled.flash, http_in_flight, max_concurrent, configured_rpm, rpm_60s, attempts, cooldown_until})
        )} : null,
    });
  }
  progress();
  progressTimer = setInterval(() => {
    try { progress(); }
    catch (error) { fatal ??= error.message; stopped = true; }
  }, 3000);

  const gatewayRoot = join(out, 'gateway');
  mkdirSync(gatewayRoot, {recursive: true, mode: 0o700});
  const launchDir = join(gatewayRoot, String(Date.now()));
  mkdirSync(launchDir, {mode: 0o700});
  const {installMeteredFetch} = await import(pathToFileURL(resolve(values.transport)).href);
  api = await installMeteredFetch({
    configPath: resolve(values.config), outputDir: launchDir, verifiedPriorDir: resolve(values['prior-api']),
    previousCapacityPath: values['previous-capacity'] ? resolve(values['previous-capacity']) : undefined,
  });
  assert(api.stats().slots.some(slot => slot.enabled.flash), 'no approved Flash slot');

  const find = db.prepare('SELECT id,decision_id,offset,bytes FROM impressions WHERE state=? ORDER BY id LIMIT 1');
  const findRecovery = db.prepare(
    "SELECT id,decision_id,offset,bytes FROM impressions i WHERE state='exhausted' AND NOT EXISTS " +
    '(SELECT 1 FROM attempts a WHERE a.id=i.id AND a.turn=? AND a.finished_at IS NOT NULL) ORDER BY id LIMIT 1'
  );
  const waitingState = [null, 'pending', 'retry_pending', 'exhausted', 'exhausted'];
  const runningState = [null, 'running', 'retry_running', 'recovery_running', 'final_retry_running'];
  const setRunning = db.prepare('UPDATE impressions SET state=? WHERE id=?');
  const attemptStart = db.prepare(
    'INSERT INTO attempts(id,turn,started_at) VALUES (?,?,?) ON CONFLICT(id,turn) DO UPDATE ' +
    'SET started_at=attempts.started_at WHERE attempts.finished_at IS NULL'
  );
  const oldHash = db.prepare('SELECT request_sha256 FROM attempts WHERE id=? AND turn=1');
  const noteRequest = db.prepare('UPDATE attempts SET request_sha256=? WHERE id=? AND turn=?');
  const noteResponse = db.prepare('UPDATE attempts SET response=? WHERE id=? AND turn=?');
  const attemptEnd = db.prepare('UPDATE attempts SET finished_at=?,failed_request=?,result=? WHERE id=? AND turn=?');
  const firstEnd = db.prepare('UPDATE impressions SET state=?,first_outcome=?,prediction=?,error=? WHERE id=?');
  const retryEnd = db.prepare('UPDATE impressions SET state=?,prediction=?,error=? WHERE id=?');
  function transaction(body) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = body(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function claim(turn) {
    const row = turn >= 3 ? findRecovery.get(turn) : find.get(waitingState[turn]);
    if (!row) return null;
    if (turn === 4) assert(finalTargets.has(row.decision_id), 'final retry target outside frozen cohort');
    transaction(() => {
      setRunning.run(runningState[turn], row.id);
      assert.equal(attemptStart.run(row.id, turn, now()).changes, 1, 'attempt already finalized');
    });
    return row;
  }

  async function work(turn) {
    const child = spawn(values.python, [adapter, '--stream'], {env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
    const closed = new Promise(done => { child.once('error', () => done(null)); child.once('close', done); });
    child.stdin.on('error', () => {});
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4096); });
    const lines = createInterface({input: child.stdout, crlfDelay: Infinity})[Symbol.asyncIterator]();
    async function receive() {
      const next = await lines.next();
      if (next.done) throw Error('RecAgent worker exited' + (stderr ? ': ' + stderr : ''));
      return JSON.parse(next.value);
    }
    try {
      while (!stopped) {
        const row = claim(turn);
        if (!row) return;
        let payload = null, result, detail = null;
        try {
          const bytes = Buffer.alloc(row.bytes);
          assert.equal(readSync(input, bytes, 0, row.bytes, row.offset), row.bytes);
          const record = JSON.parse(bytes.toString('utf8'));
          assert.equal(record.observation.decision_id, row.decision_id);
          assert(record.observation.behavior_events.length >= 2);
          child.stdin.write(JSON.stringify(record) + '\n');
          let message = await receive();
          if (message.type === 'model_request') {
            payload = {...message.request, ...modelParameters};
            const requestHash = hash(JSON.stringify(payload));
            if (turn > 1) {
              const first = oldHash.get(row.id)?.request_sha256;
              if (first) assert.equal(requestHash, first, 'retry payload differs from first pass');
            }
            if (turn === 4) {
              assert.equal(requestHash, finalTargets.get(row.decision_id), 'final retry payload differs from the frozen request');
            }
            noteRequest.run(requestHash, row.id, turn);
            let answer;
            try {
              const reply = await rankThroughGateway(payload, row, turn);
              noteResponse.run(JSON.stringify(reply), row.id, turn);
              answer = {type: 'model_response', content: reply.choices[0].message.content};
            } catch (error) {
              if (error === interrupted) {
                setRunning.run(waitingState[turn], row.id);
                return;
              }
              const code = error.code ?? error.message;
              detail = {code, status: error.status ?? null, detail: error.detail ?? null};
              answer = {type: 'model_error', error: code};
              if (!api.stats().slots.some(slot => slot.enabled.flash) || code === 'api_ledger_unavailable') {
                fatal ??= code;
                stopped = true;
              }
            }
            child.stdin.write(JSON.stringify(answer) + '\n');
            message = await receive();
          }
          const {type, ...outcome} = message;
          assert.equal(type, 'result');
          assert.equal(outcome.decision_id, row.decision_id);
          assert(['submitted', 'failed'].includes(outcome.status));
          if (!payload) {
            fatal ??= outcome.error || 'worker finished without a model request';
            stopped = true;
            setRunning.run(waitingState[turn], row.id);
            return;
          }
          result = {...outcome, attempt: turn, ...(detail ? {transport_error: detail} : {})};
        } catch (error) {
          fatal ??= error.message;
          stopped = true;
          result = {status: 'failed', decision_id: row.decision_id, attempt: turn, error: 'runner_failure'};
        }
        const ok = result.status === 'submitted';
        const state = ok ? 'submitted' : turn === 1 ? 'retry_pending' : 'exhausted';
        const serialized = JSON.stringify(result);
        transaction(() => {
          attemptEnd.run(now(), !ok && payload ? JSON.stringify(payload) : null, serialized, row.id, turn);
          if (turn === 1) firstEnd.run(state, ok ? 'submitted' : 'failed', serialized, result.error ?? null, row.id);
          else retryEnd.run(state, serialized, result.error ?? null, row.id);
        });
        if (!ok) {
          appendFileSync(join(out, 'failures.jsonl'), JSON.stringify({
            at: now(), decision_id: row.decision_id, attempt: turn, error: result.error, ...(detail ? {transport_error: detail} : {}),
          }) + '\n', {mode: 0o600});
        }
      }
    } finally {
      child.stdin.end();
      await closed;
    }
  }
  async function stage(turn) {
    phase = [null, 'first_pass', 'retry', 'recovery', 'final_retry'][turn];
    progress();
    const results = await Promise.allSettled(Array.from({length: workers}, async () => {
      try { await work(turn); }
      catch (error) { fatal ??= error.message; stopped = true; throw error; }
    }));
    for (const result of results) if (result.status === 'rejected') fatal ??= result.reason.message;
  }
  if (!stopped && counts().pending) await stage(1);
  if (!stopped && counts().retry_pending) await stage(2);
  if (!stopped && counts().recovery_pending) await stage(3);
  if (!stopped && counts().final_retry_pending) await stage(4);
  const tally = counts();
  phase = fatal ? 'needs_attention' : stopped ? 'stopped' : tally.exhausted ? 'review_required' : 'complete';
  if (phase === 'complete' || phase === 'review_required') {
    assert.equal(tally.submitted + tally.exhausted, plan.eligible);
    if (finalRetryPath) assert.equal(tally.final_retry_done, finalTargets.size);
    const path = join(out, 'predictions.jsonl');
    const fd = openSync(path + '.tmp', 'w', 0o600);
    const digest = createHash('sha256');
    try {
      for (const row of db.prepare('SELECT prediction FROM impressions ORDER BY id').iterate()) {
        assert(row.prediction);
        const line = row.prediction + '\n';
        writeSync(fd, line);
        digest.update(line);
      }
    } finally { closeSync(fd); }
    renameSync(path + '.tmp', path);
    snapshot('frozen-predictions.json', {...tally, input_sha256: plan.source_sha256,
      predictions_sha256: digest.digest('hex'), labels_read: false});
  }
  api.restore();
  progress();
  if (fatal) process.exitCode = 1;
} catch (error) {
  console.error(error.stack ?? error.message);
  snapshot('run-error.json', {at: now(), pid: process.pid, phase, error: error.message});
  process.exitCode = 1;
} finally {
  clearInterval(progressTimer);
  api?.restore();
  if (input !== undefined) closeSync(input);
  db?.close();
  unlinkSync(lock);
}
