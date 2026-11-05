import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const replay = new URL('../kuairec-clawrec-targeted-repair-20261104/client.mjs', import.meta.url);
test('the main queue can verify its frozen replay client', () => {
  const plan = JSON.parse(readFileSync(new URL('./plan.json', replay)));
  assert.equal(createHash('sha256').update(readFileSync(replay)).digest('hex'), plan.files_sha256[fileURLToPath(replay)]);
});

for (const [stage, payload, allowed, expected] of [
  ['plan', {}, {plan:true}, 'offline_repair_boundary'],
  ['worker', {task_id:'worker-1'}, {allWorkers:true}, 'offline_repair_boundary'],
  ['unaffected state', {prior_state:{}}, {plan:true,allWorkers:true}, 'exact_replay_miss_for_unaffected_step'],
]) test(`recovery preserves the ${stage} boundary without changing the frozen client`, () => {
  const prior = mkdtempSync(join(tmpdir(), 'krec-replay-'));
  try {
    const child = spawnSync(process.execPath, ['--import='+fileURLToPath(new URL('./register.mjs', import.meta.url)),
      '--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        globalThis.fetch = () => { throw Error('network_forbidden'); };
        const {callModel} = await import(process.argv[1]);
        await assert.rejects(callModel({messages:[{role:'user',content:'INPUT:'+process.argv[2]}]},
          {experiment:'method-deployment'}), {message:process.argv[3]});
      `, replay.href, JSON.stringify(payload), expected], {encoding:'utf8', env:{...process.env,
        MODEL_CONFIG_FILE:'/dev/null', KREC_REPAIR_PRIORS:JSON.stringify([prior]),
        KREC_REPAIR_ALLOWED:JSON.stringify(allowed), KREC_REPAIR_OFFLINE:'1'}});
    assert.equal(child.status, 0, child.stderr);
  } finally { rmSync(prior, {recursive:true,force:true}); }
});
