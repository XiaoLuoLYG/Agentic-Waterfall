import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SCHEMA_VERSION} from '../lib/waterfall/dataset-format.mjs';

test('the collector uses the exact declared dataset formatter artifact',()=>{
 const pin=JSON.parse(readFileSync(new URL('../.openai/dataset-format.json',import.meta.url)));
 const source=readFileSync(new URL('../lib/waterfall/dataset-format.mjs',import.meta.url));
 assert.equal(createHash('sha256').update(source).digest('hex'),pin.sha256);
 assert.equal(SCHEMA_VERSION,pin.schema_version);
});
