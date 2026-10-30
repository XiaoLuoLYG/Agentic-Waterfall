import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

test('three calls share two slots and archive all receipts without growing the shared ledger', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aw-bridge-'));
  const local = join(tmp, 'experiments/agentic-waterfall/shared');
  mkdirSync(local, {recursive: true});
  mkdirSync(join(tmp, 'experiments/agentic-waterfall/method-deployment'));
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, 'model-client.mjs'), 'utf8').replace(
    "resolve(ROOT, '../../../../formal-20261029-224252/experiments/agentic-waterfall/shared/model-ledger.json')",
    "resolve(ROOT, 'shared/model-ledger.json')");
  assert.notEqual(source, readFileSync(join(here, 'model-client.mjs'), 'utf8'));
  writeFileSync(join(local, 'model-client.mjs'), source);
  copyFileSync(join(here, 'archive.mjs'), join(local, 'archive.mjs'));
  writeFileSync(join(local, 'model-ledger.json'), JSON.stringify({limit: 100, max_concurrent: 2, attempts: []}));
  writeFileSync(join(tmp, 'experiments/agentic-waterfall/method-deployment/CONTROL.json'), JSON.stringify({model_calls_enabled: true, model_request_limit: 100}));
  let active = 0, peak = 0;
  const server = createServer((req, res) => {
    active++; peak = Math.max(peak, active);
    req.resume();
    setTimeout(() => { active--; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({model:'mock', choices:[{message:{content:'{}'},finish_reason:'stop'}], usage:{total_tokens:42}})); }, 300);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = join(tmp, 'config.json');
  writeFileSync(config, JSON.stringify({apiKey:'test', modelName:'mock', apiBase:`http://127.0.0.1:${server.address().port}`}));
  const js = `import {callModel} from ${JSON.stringify(pathToFileURL(join(local, 'model-client.mjs')).href)}; await callModel({messages:[{role:'user',content:'hello'}]},{experiment:'method-deployment'});`;
  const child = () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', js], {env:{...process.env, MODEL_CONFIG_FILE:config, OPENAI_API_KEY:'', OPENAI_MODEL:'mock', OPENAI_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
    let err=''; p.stderr.on('data', b => err+=b); p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(new Error(err)));
  });
  try {
    await Promise.all([child(), child(), child()]);
    assert.equal(peak, 2);
    assert.equal(JSON.parse(readFileSync(join(local, 'model-ledger.json'))).attempts.length, 0);
    const db = new DatabaseSync(join(local, 'expansion-ledger.sqlite'));
    assert.equal(db.prepare('select count(*) as n from attempts').get().n, 3);
    assert.equal(db.prepare("select sum(json_extract(record,'$.usage.total_tokens')) as n from attempts").get().n, 126);
    db.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(tmp, {recursive:true, force:true});
  }
});
