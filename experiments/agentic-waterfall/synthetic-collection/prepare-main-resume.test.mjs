import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { read, save, sha } from './collection.mjs';
import { prepareMainResume } from './prepare-main-resume.mjs';

test('continuation skips a rating orphaned by a changed slate and carries the active rating', async t => {
  const root = mkdtempSync(join(tmpdir(), 'awf-resume-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), old = join(source, 'comparison'), target = join(root, 'target');
  const tracks = new Map([['u01', [{ round: 1, input_sha256: 'input', public_input_sha256: 'public', phase_sha256: 'phase' }]]]);
  const methods = ['waterfall'];
  const frozen = { transport: { credential_set_sha256: 'key-fixture' }, judge_model: { name: 'Flash' } };
  const hash = value => sha(JSON.stringify(value));
  const config_sha256 = hash(frozen);
  const dirs = 'studies/u01/1';
  save(join(source, 'progress.json'), { status: 'incomplete', api: {} });
  save(join(old, 'manifest.json'), { frozen });
  save(join(old, 'input-lineage.json'), {});
  save(join(old, 'analysis.json'), { config_sha256, method_ids: methods,
    checkpoints: [{ user: 'u01', ...tracks.get('u01')[0] }] });
  save(join(old, 'runtime/source/site/scripts/research-service.mjs'),
    Buffer.from('export function createResearchStateStore() { throw Error("unexpected state restore"); }'));
  save(join(old, dirs, 'questions.json'), { ratings: [{ id: 'active', material_sha256: 'current-card' }], blind: [] });

  for (const [question_id, material_sha256] of [['orphan', 'old-card'], ['active', 'current-card']]) {
    const row = { config_sha256, question_id, material_sha256, status: 'answered', mode: 'rating', provider_model: 'Flash',
      input_sha256: 'input', public_input_sha256: 'public', phase_sha256: 'phase', request_sha256: 'request-' + question_id };
    save(join(old, dirs, 'labels', question_id + '.json'), { ...row, record_sha256: hash(row) });
  }
  save(join(old, dirs, 'label-attempts/active.json'), { config_sha256, request_sha256: 'request-active' });

  const result = await prepareMainResume(source, target, tracks, methods, frozen.transport.credential_set_sha256);
  assert.equal(result.kept_labels, 1);
  assert.deepEqual(read(join(target, dirs, 'labels/active.json')), read(join(old, dirs, 'labels/active.json')));
  assert.equal(existsSync(join(target, dirs, 'labels/orphan.json')), false);
});
