import test from 'node:test';import assert from 'node:assert/strict';import {normalizeRecord,makePlan} from './collection.mjs';
test('plans bounded public source queries independently of hidden cases',()=>{
 const p=makePlan(['摄影入门','视频剪辑']);assert.equal(p.length,8);assert.deepEqual([...new Set(p.map(x=>x.source))].sort(),['bilibili','youtube','zhihu']);
});
test('only real public result fields are projected and unsafe URLs rejected',()=>{
 const item={title:'a',summary:'text',url:'https://example.org/a',published_at:'2026-01-01T00:00:00Z',captured_at:'2026-10-29T00:00:00Z',target:'SECRET'};const x=normalizeRecord('zhihu',item);assert.equal(x.source,'zhihu');assert.equal(x.published_at,'2026-01-01T00:00:00Z');assert.equal(x.captured_at,'2026-10-29T00:00:00Z');assert(!JSON.stringify(x).includes('SECRET'));assert.throws(()=>normalizeRecord('zhihu',{...item,url:'https://name:pass@example.org/a'}),/url/);
});
