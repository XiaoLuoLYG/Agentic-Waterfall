import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProfile, parseProfile } from '../public/profile-format.js';

test('one profile editor preserves and edits older memory fields', () => {
  const state = { profile: '喜欢足球', memory: '买过电脑', context: '学剪辑' };
  assert.deepEqual(parseProfile(formatProfile(state), state), state);
  assert.deepEqual(parseProfile('喜欢摄影', state), { ...state, profile: '喜欢摄影' });
  assert.deepEqual(parseProfile('喜欢足球\n\n【长期记忆】\n新的记忆\n\n【当前关注】\n', state), { profile: '喜欢足球', memory: '新的记忆', context: '' });
  const legacy = { profile: '', memory: '保留旧记忆', context: '当前任务' };
  assert.deepEqual(parseProfile(formatProfile(legacy), legacy), legacy);
});
