import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { patchedHybridWorker } from './comparison-runtime.mjs';

const worker = fileURLToPath(new URL('../../../output/agentic-waterfall/comparison-20261106-synthetic-10x20-all-methods-v4/author-methods/fixed-retrieval/persistent_worker.py', import.meta.url));
const python = fileURLToPath(new URL('../../../methods/agentic-waterfall/fixed-retrieval/.venv/bin/python', import.meta.url));

test('frozen document vectors are encoded once and gathered in eligible ID order', () => {
  const testCode = [
    'import numpy as np, sys',
    'from types import SimpleNamespace',
    'ns = {"__name__": "offline_test"}',
    'exec(sys.stdin.read(), ns)',
    'ranker = ns["PersistentHybridRanker"].__new__(ns["PersistentHybridRanker"])',
    'ranker.np, ranker.document_cache = np, None',
    'calls = []',
    'def vectors(texts):',
    '    calls.append(list(texts))',
    '    return np.array([[len(text), ord(text[0])] for text in texts], dtype="float32")',
    'ranker.vectors = vectors',
    'pool = [{"id":"b","text":"bee"}, {"id":"a","text":"ant"}, {"id":"c","text":"cat"}]',
    'eligible = ns["validate_catalog"]([pool[2],pool[1]])',
    'first, built = ranker.document_vectors(eligible, pool)',
    'again, hit = ranker.document_vectors(eligible[::-1])',
    'assert calls == [["ant", "bee", "cat"]], calls',
    'assert (first == [[3,97],[3,99]]).all() and (again == [[3,99],[3,97]]).all()',
    'assert built["status"] == "built" and hit["status"] == "hit"',
    'try: ranker.document_vectors([{"id":"a","text":"changed"}])',
    'except ValueError: pass',
    'else: raise AssertionError("changed text accepted")',
  ].join('\n');
  const result = spawnSync(python, ['-c', testCode], { input: patchedHybridWorker(readFileSync(worker, 'utf8')),
    env: { ...process.env, PYTHONPATH: dirname(worker), PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error);
});
