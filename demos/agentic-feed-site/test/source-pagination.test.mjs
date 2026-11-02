import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../lib/waterfall/sources.mjs';
const action={source:'bilibili',mode:'search',query:'new interest'};
const input={kind:'input',session_id:'s',track:'feed',input_snapshot:{id:'i'}};
const capture=(query,page,extra={})=>({kind:'dataset_capture',session_id:'s',input_snapshot_id:'i',capture_status:'ok',returned_count:4,request:{source:'bilibili',mode:'search',query,page},...extra});
test('new source queries start at page one regardless of prior unrelated runs',()=>{
 assert.equal(typeof sources.nextSourcePage,'function');
 const rows=[input,...Array.from({length:19},()=>({kind:'run',session_id:'s'})),capture('old interest',20)];
 assert.equal(sources.nextSourcePage(rows,'s',action),1);
 assert.equal(sources.nextSourcePage(rows,'s',{...action,query:'old interest'}),21);
});
test('query pagination uses issued order and ignores other sessions, modes and failed captures',()=>{
 assert.equal(typeof sources.nextSourcePage,'function');
 const rows=[input,capture(action.query,2,{request_started_at:'2026-10-31T10:00:02Z'}),capture(action.query,1,{request_started_at:'2026-10-31T10:00:01Z'}),capture(action.query,40,{session_id:'other'}),capture(action.query,20,{request:{...action,mode:'explore',page:20}}),capture(action.query,30,{capture_status:'failed',returned_count:0})];
 assert.equal(sources.nextSourcePage(rows,'s',action),3);
});
test('page wrapping and empty responses retain a bounded truthful cursor',()=>{
 assert.equal(typeof sources.nextSourcePage,'function');
 assert.equal(sources.nextSourcePage([input,capture(action.query,50)],'s',action),1);
 assert.equal(sources.nextSourcePage([input,capture(action.query,1),capture(action.query,2,{capture_status:'empty',returned_count:0})],'s',action),2);
});
