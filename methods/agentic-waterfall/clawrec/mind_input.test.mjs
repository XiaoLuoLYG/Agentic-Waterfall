import test from 'node:test';
import assert from 'node:assert/strict';
import {toMindInput} from './mind_input.mjs';

test('uses clicked news and public candidates, excludes hidden labels and does not invent times',()=>{
 const sample={observation:{dialogue:[],behavior_events:[{type:'click',item:{id:'h',title:'past',abstract:'old',label:'SECRET'}}],environment:{candidate_pool:[{id:'a',title:'news',abstract:'current',label:'SECRET'}]}}};
 const input=toMindInput(sample);
 assert.deepEqual(input.history,[{id:'h',title:'past',text:'old'}]);
 assert.deepEqual(input.candidates,[{id:'a',title:'news',text:'current'}]);
 assert(!JSON.stringify(input).includes('SECRET'));assert(!JSON.stringify(input).includes('timestamp'));
});
