import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const adapter = fileURLToPath(new URL('./mind.py', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const {values: options} = parseArgs({options: Object.fromEntries(
  ['inputs', 'manifest', 'out', 'python', 'transport', 'config'].map(name => [name, {type: 'string'}])
)});
for (const name of ['inputs', 'manifest', 'out', 'python', 'transport', 'config']) {
  if (!options[name]) throw Error('--' + name + ' is required');
}
if (statSync(options.inputs).size > 16 * 1024 * 1024) throw Error('expected a small frozen pilot input');
const data = readFileSync(options.inputs);
const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
const rows = data.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
const ids = rows.map(row => row.observation.decision_id);
if (sha256(data) !== manifest.input_sha256 || rows.length > 32 ||
    ids.length < 2 || new Set(ids).size !== ids.length ||
    ids.some((id, i) => id !== manifest.decision_ids[i]) || ids.length !== manifest.decision_ids.length) {
  throw Error('pilot inputs must match a frozen manifest of 2–32 impressions');
}

const out = resolve(options.out);
mkdirSync(out, {mode: 0o700});
const {installMeteredFetch} = await import(pathToFileURL(resolve(options.transport)).href);
const api = await installMeteredFetch({configPath: resolve(options.config), outputDir: out});
const modelParameters = {
  enable_thinking: false,
  thinking: {type: 'disabled'},
  extra_body: {thinking: {type: 'disabled'}},
};
const results = [];

async function runOne(row, i) {
  const decisionId = ids[i];
  const dir = join(out, 'case-' + String(i + 1).padStart(2, '0'));
  mkdirSync(dir, {mode: 0o700});
  const child = spawn(options.python, [adapter], {env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  const closed = new Promise(done => {
    child.once('error', () => done(null));
    child.once('close', done);
  });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  let requests = 0;
  let result;
  try {
    child.stdin.write(JSON.stringify(row) + '\n');
    for await (const line of createInterface({input: child.stdout, crlfDelay: Infinity})) {
      const message = JSON.parse(line);
      if (message.type === 'result' && !result) {
        const {type, ...record} = message;
        result = record;
        child.stdin.end();
        continue;
      }
      if (message.type !== 'model_request' || requests || result) throw Error('invalid RecAgent worker protocol');
      requests++;
      const payload = {...message.request, ...modelParameters};
      save(join(dir, 'request.json'), payload);
      try {
        const reply = await api.complete(payload, {stage: 'recagent_mind_rank', decision_id: decisionId});
        save(join(dir, 'response.json'), reply);
        child.stdin.end(JSON.stringify({type: 'model_response', content: reply.choices[0].message.content}) + '\n');
      } catch (error) {
        const code = error.code || 'model_transport_failed';
        save(join(dir, 'transport-error.json'), {code, status: error.status ?? null, detail: error.detail ?? null});
        child.stdin.end(JSON.stringify({type: 'model_error', error: code}) + '\n');
      }
    }
    if (await closed !== 0 || result?.decision_id !== decisionId ||
        (result.status === 'submitted' && requests !== 1)) throw Error('RecAgent worker did not return a complete result');
  } catch (error) {
    child.stdin.end();
    child.kill();
    await closed;
    result = {status: 'failed', decision_id: decisionId, error: error.message};
  }
  if (stderr) writeFileSync(join(dir, 'worker.stderr.log'), stderr, {flag: 'wx', mode: 0o600});
  result.model_request_count = requests;
  save(join(dir, 'result.json'), result);
  results[i] = result;
  return result;
}

let probes = [];
let setupError;
try {
  probes = await api.preflight({includePro: false});
  if (!probes.some(probe => probe.ok)) throw Error('no verified original-gateway Flash slot');
  for (let i = 0; i < 2; i++) {
    if ((await runOne(rows[i], i)).status !== 'submitted') break;
  }
  if (results[1]?.status === 'submitted') {
    await Promise.all(rows.slice(2).map((row, i) => runOne(row, i + 2)));
  }
} catch (error) {
  setupError = error.message;
} finally {
  api.restore();
  const attempted = results.filter(Boolean);
  const completed = attempted.filter(row => row.status === 'submitted');
  const summary = {
    status: completed.length === rows.length ? 'pilot_passed' : 'review_required',
    planned: rows.length,
    attempted: attempted.length,
    submitted: completed.length,
    failed: attempted.filter(row => row.status !== 'submitted').map(({decision_id, error}) => ({decision_id, error})),
    ...(setupError ? {setup_error: setupError} : {}),
    probes: probes.map(({slot, ok, provider_model, error}) => ({slot, ok, provider_model, error})),
    request_count: api.stats().attempts,
    peak_http_in_flight: api.stats().peak_http_in_flight,
    input_sha256: manifest.input_sha256,
    adapter_sha256: sha256(readFileSync(adapter)),
    ranking_format: 'candidate_indices',
    transport_sha256: sha256(readFileSync(options.transport)),
    labels_read: false,
  };
  writeFileSync(join(out, 'predictions.jsonl'), attempted.map(row => JSON.stringify(row) + '\n').join(''), {flag: 'wx', mode: 0o600});
  save(join(out, 'summary.json'), summary);
  console.log(JSON.stringify(summary));
  if (summary.status !== 'pilot_passed') process.exitCode = 1;
}
