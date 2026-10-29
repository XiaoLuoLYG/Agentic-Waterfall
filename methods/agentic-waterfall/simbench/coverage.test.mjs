import test from 'node:test';import assert from 'node:assert/strict';import {sourceCoverage} from './coverage.mjs';
test('only exposes sources present in both benchmark and frozen corpus',()=>{
 const x=sourceCoverage(['zhihu','xiaohongshu','bilibili'],{sources:{zhihu:5,bilibili:2,youtube:1}});assert.deepEqual(x.active,['zhihu','bilibili']);assert.deepEqual(x.unavailable,['xiaohongshu']);
 assert.throws(()=>sourceCoverage(['xiaohongshu'],{sources:{zhihu:2}}),/no shared/);
});
