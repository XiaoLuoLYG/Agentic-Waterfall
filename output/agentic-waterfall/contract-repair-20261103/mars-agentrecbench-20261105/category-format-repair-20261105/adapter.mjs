import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseFor as original} from '../adapter.mjs';
import {applyCategories} from './category.mjs';
export {project,requestFor} from '../adapter.mjs';

export function parseFor(stage,content){
  const parsed=original(stage,content);
  if(stage!=='extract')return parsed;
  const selection=JSON.parse(readFileSync(process.env.MARS_CATEGORY_CORRECTION,'utf8'));
  assert.equal(createHash('sha256').update(content).digest('hex'),selection.original_content_sha256);
  const raw=readFileSync(selection.response.path);assert.equal(createHash('sha256').update(raw).digest('hex'),selection.response.sha256);
  const receipt=JSON.parse(raw);assert.equal(receipt.status,'success');assert.equal(receipt.provider_response_model,'DeepSeek-V4.1-Flash-1017');
  assert.notEqual(receipt.finish_reason,'length');
  const corrected=applyCategories(parsed.preferences,JSON.parse(receipt.content),selection.domain);
  return {preferences:corrected,format_normalization:{kind:'user-approved-single-category-format-call',
    selection_file:process.env.MARS_CATEGORY_CORRECTION,original_content_sha256:selection.original_content_sha256,
    correction_receipt_sha256:selection.response.sha256,non_category_assertions_preserved:true}};
}
