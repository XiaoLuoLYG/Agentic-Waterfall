import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../lib/waterfall/sources.mjs';
import {runDemo} from '../lib/waterfall/unified-demo.mjs';
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

test('multi-source acquisition reserves room for slower sources and reuses empty shares',async()=>{
 for(const empty of [false,true]){
  const ids=['github','youtube'];let calls=0;
  const result=await runDemo({id:'multi-source',state:{version:1,entries:[]},available_sources:ids.map(id=>({id,modes:['search'],modalities:['text']})),candidate_pool:[],previous_slate_ids:[]},{
   userId:'test',sessionId:'test',
   acquireSource:async source=>{
    if(source==='youtube')await new Promise(setImmediate);
    return {source,status:empty&&source==='youtube'?'failed':'ok',items:empty&&source==='youtube'?[]:[0,1].map(n=>({id:source+n,title:source+n,source,modality:'text'}))};
   },
   modelCall:async request=>{
    const {observation:o}=JSON.parse(request.messages[1].content);calls++;
    return {content:JSON.stringify({decision_id:o.decision_id,actions:[{action_id:'action-'+calls,kind:calls===1?'acquire':'recommend',arguments:calls===1?{source_ids:ids,mode:'search',query:'camera',limit:2}:{ordered_item_ids:o.environment.candidate_pool.map(item=>item.id),delivery:'replace_pending'},evidence_refs:[],depends_on:[]}]})};
   }
  });
  assert.deepEqual(result.content_items.map(item=>item.source).sort(),empty?['github','github']:ids);
  assert.equal(result.slate.length,2);
 }
});
