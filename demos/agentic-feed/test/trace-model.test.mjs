import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, groupTimeline, selectTimeline } from '../public/trace-model.js';

test('timeline places user events, actual model calls, tool results and state in time order', () => {
  const ep = {
    event_log:[{ id:'command', type:'command', occurred_at:'2026-01-01T00:00:01Z', available_at:'2026-01-01T00:00:01Z', payload:{text:'看看摄影'} },{ id:'click',type:'like',occurred_at:'2026-01-01T00:00:05Z',available_at:'2026-01-01T00:00:05Z',item_id:'x',payload:{title:'摄影教程'} }],
    decisions:[{decision_id:'d1',phase:'plan',recorded_at:'2026-01-01T00:00:02Z',model_call:{started_at:'2026-01-01T00:00:02Z',messages:[{role:'user',content:'actual'}]},raw_output:'actual raw',parsed_output:{actions:[]},validation:{valid:true},execution_results:[{action:{type:'acquire',source:'bilibili',query:'摄影'},status:'ok',result:{started_at:'2026-01-01T00:00:03Z',completed_at:'2026-01-01T00:00:04Z',items:[{id:'x'}]}}]}],
    simulator_decisions:[], state_records:[{id:'state',kind:'state',reason:'user_edit',available_at:'2026-01-01T00:00:06Z',state:{profile:'文字'}}]
  };
  const timeline=buildTimeline(ep);
  assert.deepEqual(timeline.map(e=>e.kind), ['user','agent','agent','tool','tool','user','state']);
  assert.equal(timeline[0].description, '看看摄影');
  assert.equal(timeline[1].details['输入'].model_messages[0].content,'actual');
  assert.equal(timeline[2].details['输出'].raw_output,'actual raw');
  assert.equal(timeline[4].details['结果'].items[0].id, 'x');
  assert.match(timeline[5].description,/摄影教程/);
});

test('timeline distinguishes incomplete, failure, simulation and old command records', () => {
  const rows=buildTimeline({event_log:[],state_records:[],dialogue_log:[{id:'old',role:'user',origin:'legacy_recorded_at_execution',text:'旧指令',available_at:'2026-01-01T00:00:01Z'}],decisions:[{decision_id:'bad',phase:'rank',failure_id:'fail',recorded_at:'2026-01-01T00:00:02Z',validation:{valid:false,errors:['bad']},model_call:{},execution_results:[]}],simulator_decisions:[{id:'sim',kind:'agent_decision',simulated:true,event_time:'2026-01-01T00:00:03Z',title:'视频',messages:[],decision:{actions:['like']}}]});
  assert.equal(rows[0].title,'输入指令'); assert.equal(rows[1].status,'error'); assert.equal(rows[2].kind,'simulation'); assert.equal(rows[3].kind,'simulation');
  assert.deepEqual(buildTimeline({}),[]);
});

test('simulator output precedes the actions it generated when timestamps match', () => {
  const instant='2026-01-01T00:00:02Z';
  const rows=buildTimeline({event_log:[{id:'like',type:'like',occurred_at:instant,payload:{simulated:true,sequence:12,title:'内容'}}],simulator_decisions:[{id:'sim',kind:'agent_decision',sequence:11,started_at:'2026-01-01T00:00:01Z',event_time:instant,completed_at:'2026-01-01T00:00:03Z',messages:[],decision:{actions:['like']}}]});
  assert.deepEqual(rows.map(row=>row.title),['模拟用户 · 输入','模拟用户 · 选择操作','点赞']);
});

test('groups only adjacent actions of the same role without changing their order', () => {
  const entries = [
    { id:'a', kind:'user', at:'2026-01-01T00:00:00Z' },
    { id:'b', kind:'agent', at:'2026-01-01T00:00:01Z' },
    { id:'c', kind:'agent', at:'2026-01-01T00:00:02Z' },
    { id:'d', kind:'tool', at:'2026-01-01T00:00:03Z' },
    { id:'e', kind:'agent', at:'2026-01-01T00:00:04Z' },
    { id:'f', kind:'agent', at:'2026-01-01T00:05:04Z' }
  ];
  const groups=groupTimeline(entries);
  assert.deepEqual(groups.map(g=>g.items.map(x=>x.id)), [['a'],['b','c'],['d'],['e'],['f']]);
  assert.deepEqual(groups.flatMap(g=>g.items.map(x=>x.id)),entries.map(e=>e.id));
});

test('exposure records use a distinct browsing category and retain timing details', () => {
  const start={id:'x',type:'exposure',occurred_at:'2026-01-01T00:00:01Z',payload:{phase:'start',title:'教程',exposure_id:'v'}};
  const end={id:'y',type:'exposure',occurred_at:'2026-01-01T00:00:05Z',payload:{phase:'end',title:'教程',visible_ms:4000,exposure_id:'v'}};
  const entries=buildTimeline({event_log:[start,end]});
  assert.deepEqual(entries.map(x=>x.kind),['exposure','exposure']);
  assert.deepEqual(entries.map(x=>x.title),['卡片进入视野','卡片离开视野']);
  assert.equal(entries[1].details['记录'].payload.visible_ms,4000);
  assert.equal(groupTimeline(entries)[0].items.length,2);
});

test('trace filters make interactions and viewing durations discoverable without losing agent records', () => {
  const rows=[{kind:'user',title:'点赞'},{kind:'exposure',title:'卡片离开视野'},{kind:'agent',title:'决策'},{kind:'tool',title:'工具'},{kind:'simulation',title:'模拟操作'}];
  assert.deepEqual(selectTimeline(rows,'all'),rows);
  assert.deepEqual(selectTimeline(rows,'actions').map(row=>row.title),['点赞','模拟操作']);
  assert.deepEqual(selectTimeline(rows,'viewing').map(row=>row.title),['卡片离开视野']);
  assert.deepEqual(selectTimeline(rows,'agent').map(row=>row.title),['决策','工具']);
});

test('return shows the open-to-return interval without claiming playback duration', () => {
  const rows=buildTimeline({event_log:[
    {id:'o',type:'open',item_id:'video',occurred_at:'2026-01-01T00:00:00Z',payload:{title:'视频'}},
    {id:'r',type:'return',item_id:'video',occurred_at:'2026-01-01T00:00:12Z',payload:{title:'视频'}}
  ]});
  assert.match(rows[1].description,/打开到返回 12\.0 秒/);
  assert.match(rows[1].description,/不代表播放时长/);
});
