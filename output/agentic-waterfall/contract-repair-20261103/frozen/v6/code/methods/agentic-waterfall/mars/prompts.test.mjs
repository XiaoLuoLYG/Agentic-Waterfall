import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest, parseResponse} from './prompts.mjs';
const domain = {name:'test', item_noun:'videos', categories:['topic','author','style','mood','duration','audience']};

test('a complete Markdown wrapper does not turn valid model output into a method failure', () => {
  assert.deepEqual(parseResponse('extract', '```json\n[]\n```'), {preferences:[]});
  assert.deepEqual(parseResponse('plan', '```json\n{"actions":[]}\n```'), {actions:[]});
  assert.equal(parseResponse('rank', '```text\n101 | 9 | strong | relevant\n```').scores[0].id, '101');
  assert.throws(() => parseResponse('extract', '```json\n[]\n```\nunexpected trailing text'));
  assert.throws(() => parseResponse('extract', '```json\n['));
});

test('paper scoring anchors and every complete candidate reach ranking without JSON-only coercion', () => {
  const marker = 'tail of a long description';
  const request = buildRequest('rank', {domain, profile:'public profile', events:[], instruction:'nature', candidates:[{id:'101',text:'x'.repeat(5000)+marker}]});
  assert(request.messages[1].content.includes(marker));
  assert(request.messages[1].content.includes('Best match should score 9+'));
  assert(request.messages[1].content.includes('worst should score 2 or below'));
  assert(request.messages[1].content.includes('ITEM_ID | SCORE | TIER | brief_reason'));
  assert.equal(request.response_format, undefined);
});

test('native extraction array, profile text and pointwise lines are parsed without dropping scores or reasons', () => {
  assert.deepEqual(parseResponse('extract', '[]'), {preferences:[]});
  assert.deepEqual(parseResponse('synthesize', 'This user enjoys fiction.'), {profile:'This user enjoys fiction.'});
  const result = parseResponse('rank', '101 | 9 | strong | matches preference\n102 | 1 | weak | unrelated');
  assert.equal(result.scores.length, 2);assert.equal(result.scores[0].reason, 'matches preference');
  assert.throws(() => parseResponse('rank', '101 | 9 | strong | x\n101 | 2 | weak | x'), /duplicate/);
  assert.throws(() => parseResponse('rank', '101 | | weak | x'), /invalid/);
  assert.throws(() => parseResponse('extract', JSON.stringify(Array(6).fill({}))), /at most five/);
});

test('extraction uses the fixed categories, pending signals and incremental paper actions', () => {
  const request = buildRequest('extract', {domain, events:[{signal_id:'e1',text:'visible'}], preferences:[]});
  const content = request.messages[1].content;
  for (const category of domain.categories) assert(content.includes(category));
  for (const token of ['Maximum 5','create','strengthen','weaken','evidence_ids','e1']) assert(content.includes(token));
  assert.equal(request.response_format, undefined);
});

test('identical repeated pointwise assertions are losslessly normalized, conflicting assertions fail',()=>{
 const result=parseResponse('rank','a | 3 | weak | same reason\nb | 8 | strong | another reason\na | 3 | weak | same reason');
 assert.deepEqual(result.scores,[{id:'a',score:3,tier:'weak',reason:'same reason'},{id:'b',score:8,tier:'strong',reason:'another reason'}]);
 assert.deepEqual(result.format_normalization,{kind:'identical_pointwise_rows',removed_rows:1,ids:['a']});
 assert.throws(()=>parseResponse('rank','a | 3 | weak | first\na | 3 | weak | different'),/duplicate/);
 assert.throws(()=>parseResponse('rank','a | 3 | weak | same\na | 4 | weak | same'),/duplicate/);
});
