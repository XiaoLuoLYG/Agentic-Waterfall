import test from 'node:test';
import assert from 'node:assert/strict';
import {toKuaiRandInput} from './kuairand_input.mjs';
test('keeps real feedback and strips private fields from candidates',()=>{
 const x={observation:{observed_at:'2022-01-01T00:02:00Z',dialogue:[],behavior_events:[{item_id:'h',occurred_at:'2022-01-01T00:00:00Z',available_at:'2022-01-01T00:01:00Z',payload:{long_view:1,is_like:0,is_hate:0,caption_excerpt:'old',content_metadata:'public',label:'SECRET'}}],environment:{candidate_pool:[{id:'a',title:'one',text:'item',label:'SECRET'}]}}};
 const r=toKuaiRandInput(x);assert.equal(r.history[0].long_view,1);assert.equal(r.history[0].is_like,0);assert.equal(r.candidates[0].id,'a');assert(!JSON.stringify(r).includes('SECRET'));
});
test('rejects feedback unavailable at the cutoff',()=>{
 const x={observation:{observed_at:'2022-01-01T00:00:00Z',dialogue:[],behavior_events:[{item_id:'h',available_at:'2022-01-01T00:01:00Z',payload:{}}],environment:{candidate_pool:[]}}};
 assert.throws(()=>toKuaiRandInput(x),/future/);
});
