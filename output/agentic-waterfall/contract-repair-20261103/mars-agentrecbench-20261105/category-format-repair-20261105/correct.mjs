import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {callModel} from '../../full-agentrecbench-20261103/frozen/client.mjs';
import {parseFor,project,requestFor} from '../adapter.mjs';
import {correctionRequest,applyCategories,AUTHORIZED_IDS} from './category.mjs';

const read=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const [planPath,id,outPath]=process.argv.slice(2),plan=read(planPath);
assert(plan.user_approved_one_category_correction_per_case===true);
assert.deepEqual(plan.repair_rows.map(r=>r.id).sort(),[...AUTHORIZED_IDS].sort());
const row=plan.repair_rows.find(r=>r.id===id);assert(row,'case outside the five authorized repairs');
for(const [file,expected] of Object.entries(plan.files))assert.equal(sha(file),expected,file);
assert.equal(sha(row.input),row.input_sha256);assert.equal(sha(row.prior_result.path),row.prior_result.sha256);
const previous=read(row.prior_result.path);assert.equal(previous.status,'failed');assert.equal(previous.error,'invalid preference update');
const visible=project(read(row.input)),domain=read(row.domain_file),receipt=read(row.extract_response.path);
assert.equal(previous.context_id,visible.context_id);assert.equal(previous.method,'mars');assert.equal(previous.model_request_count,1);
assert.equal(receipt.status,'success');assert.equal(receipt.provider_response_model,'DeepSeek-V4.1-Flash-1017');assert.notEqual(receipt.finish_reason,'length');
assert.equal(sha(row.extract_request.path),row.extract_request.sha256);assert.equal(sha(row.extract_response.path),row.extract_response.sha256);
const payload=read(row.extract_payload.path);assert.equal(sha(row.extract_payload.path),row.extract_payload.sha256);
assert.deepEqual(requestFor('extract',payload,visible.task_context),read(row.extract_request.path));
const prefs=parseFor('extract',receipt.content).preferences;
assert(prefs.some(p=>Array.isArray(p.category)&&p.category.length>1),'no multi-category ambiguity');
const out=resolve(outPath);mkdirSync(out,{recursive:false});
const save=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const request=correctionRequest(prefs,domain);save('request.json',request);
try{
  const reply=await callModel(request,{experiment:'method-deployment'});save('response.json',reply);
  assert.equal(reply.status,'success');assert.equal(reply.provider_response_model,'DeepSeek-V4.1-Flash-1017');assert.notEqual(reply.finish_reason,'length');
  const corrected=applyCategories(prefs,JSON.parse(reply.content),domain);save('corrected-preferences.json',corrected);
  save('selection.json',{task_id:id,domain,original_content_sha256:createHash('sha256').update(receipt.content).digest('hex'),
    response:{path:resolve(out,'response.json'),sha256:sha(resolve(out,'response.json'))},additional_format_calls:1,non_category_assertions_preserved:true});
}catch(error){save('error.json',error.receipt||{error:error.message});throw error;}
