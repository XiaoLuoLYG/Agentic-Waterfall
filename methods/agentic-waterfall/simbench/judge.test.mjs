import {test} from 'node:test';import assert from 'node:assert/strict';import {labelsFromJudgment} from './judge.mjs';
test('accept exactly one valid judgment for each anonymized card',()=>{
 const cards=[{card_id:'pool_0001'},{card_id:'pool_0002'}], judgment={card_relevance:[{rank:1,card_id:'pool_0001',rel:5},{rank:2,card_id:'pool_0002',rel:1}]};
 assert.deepEqual(labelsFromJudgment(cards,judgment),{pool_0001:5,pool_0002:1});
 assert.throws(()=>labelsFromJudgment(cards,{card_relevance:[{rank:1,card_id:'pool_0001',rel:true}]}));
 assert.throws(()=>labelsFromJudgment(cards,{card_relevance:[{rank:1,card_id:'pool_0001',rel:5},{rank:1,card_id:'pool_0001',rel:1}]}));
});
