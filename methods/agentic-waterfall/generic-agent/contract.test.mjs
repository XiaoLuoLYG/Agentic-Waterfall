import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan, validateRanking} from './contract.mjs';

test('accepts bounded actual queries and rejects fabricated or excessive actions',()=>{
 assert.deepEqual(validatePlan({queries:['美食','旅行'],memory:'likes travel'}),{queries:['美食','旅行'],memory:'likes travel'});
 assert.throws(()=>validatePlan({queries:Array(11).fill('x'),memory:''}),/queries/);
 assert.throws(()=>validatePlan({queries:[''],memory:''}),/queries/);
});
test('rejects rankings outside acquired items or with duplicates',()=>{
 assert.deepEqual(validateRanking(['b','a'],['a','b']),['b','a']);
 assert.throws(()=>validateRanking(['a','a'],['a','b']),/ranking/);
 assert.throws(()=>validateRanking(['unknown'],['a','b']),/ranking/);
});
