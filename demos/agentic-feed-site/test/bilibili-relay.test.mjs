import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processJob} from '../scripts/bilibili-relay.mjs';

test('local relay searches only Bilibili with the requested page and bounded fields',async()=>{
 let seen;const result=await processJob({id:'job-1',query:'自然',page:3},async(action,_config,options)=>{seen={action,options};return {status:'ok',items:[{source_item_id:'BV1xx411c7mD',title:'自然',summary:'视频',image_url:'https://i0.hdslb.com/a.jpg',author:'作者',published_at:'2026-01-01',duration:'02:00',privateField:'omit'}]}});
 assert.equal(seen.action.source,'bilibili');assert.equal(seen.action.query,'自然');assert.equal(seen.options.page,3);assert.equal(seen.options.limit,50);assert.equal(result.rows[0].id,'BV1xx411c7mD');assert(!('privateField'in result.rows[0]));assert.equal(result.failed,false);
});
test('local relay rejects malformed requests and reports upstream failures',async()=>{
 await assert.rejects(()=>processJob({id:'job',query:'自然',page:51}),/任务无效/);
 const result=await processJob({id:'job',query:'自然',page:1},async()=>({status:'failed',items:[]}));assert.equal(result.failed,true);assert.deepEqual(result.rows,[]);
});
