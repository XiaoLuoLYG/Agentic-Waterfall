import test from 'node:test';
import assert from 'node:assert/strict';
import {correctionRequest,applyCategories} from './category.mjs';

const domain={name:'amazon',categories:['product category','compatibility','build quality','functionality','ease of use','value']};
const prefs=[{category:['product category','functionality'],text:'Recorded preference',strength:0.8,action:'create',evidence_ids:['e1','e2']},
  {category:'value',text:'Recorded value preference',strength:0.4,action:'create',evidence_ids:['e3']}];
test('one category is selected from each original set and every other assertion stays identical',()=>{
  const fixed=applyCategories(prefs,{categories:['functionality','value']},domain);
  assert.equal(fixed[0].category,'functionality');assert.equal(fixed.length,prefs.length);
  for(let i=0;i<prefs.length;i++){
    const {category:before,...a}=prefs[i],{category:after,...b}=fixed[i];assert.deepEqual(a,b);
  }
  assert.deepEqual(prefs[0].category,['product category','functionality']);
});
test('wrong count, new categories and multi-label corrections are rejected',()=>{
  for(const categories of [['functionality'],['value','value'],[['product category','functionality'],'value'],['functionality','compatibility']]){
    assert.throws(()=>applyCategories(prefs,{categories},domain));
  }
});
test('the correction receives original assertions and dimensions, with no evaluator data',()=>{
  const request=correctionRequest(prefs,domain);
  assert.equal(request.temperature,0);assert.equal(request.max_tokens,1024);
  assert.equal(request.response_format.type,'json_object');
  assert(request.messages[1].content.includes('Recorded preference'));
  assert(!request.messages[1].content.includes('groundtruth'));
});
