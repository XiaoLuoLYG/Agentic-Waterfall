import test from 'node:test';
import assert from 'node:assert/strict';
import {project, requestFor,parseFor} from './adapter.mjs';
import {emptyState,retrospective,rank} from '../frozen/v6/code/methods/agentic-waterfall/mars/mars.mjs';

const sample = () => ({observation:{
  decision_id:'agentrecbench:short_term:amazon:0', user_id:'public-user',
  behavior_events:[{id:'review-1',type:'comment',payload:{review:{stars:1,text:'Disliked this',tail:'complete-review-tail'},item:{title:'Visible item'}}}],
  user_state:{records:[{key:'public_user_metadata',value:{source:'amazon',public_field:'kept'}}]},
  environment:{sources:[{id:'get_user',benchmark_task:{candidate_category:'product',loc:[-1,-1]}}],
    candidate_pool:Array.from({length:20},(_,i)=>({id:`item-${i}`,text:`complete-description-${i}`}))},
}});
test('complete visible history, candidate order and task metadata survive the projection',()=>{
  const input=sample(),out=project(input);
  assert.deepEqual(out.history[0].payload,input.observation.behavior_events[0].payload);
  assert.deepEqual(JSON.parse(out.history[0].text),input.observation.behavior_events[0]);
  assert.deepEqual(out.candidates,input.observation.environment.candidate_pool);
  assert.equal(out.task_context.user_metadata.public_field,'kept');
  assert.equal(out.instruction,'');
  const domain={name:'amazon',item_noun:'products',categories:['a','b','c','d','e','f']};
  const req=requestFor('extract',{domain,events:out.history,preferences:[]},out.task_context);
  assert(req.messages[1].content.includes('complete-review-tail'));
  assert(req.messages[0].content.includes('public_field'));
});
test('empty history and absent user metadata remain empty, with no invented preferences',()=>{
  const input=sample();input.observation.behavior_events=[];input.observation.user_state.records=[];
  const out=project(input);assert.deepEqual(out.history,[]);assert.equal(out.task_context.user_metadata,null);
});
test('invalid benchmark and missing or duplicated candidates fail before inference',()=>{
  for(const mutate of [x=>x.observation.environment.candidate_pool.pop(),
    x=>x.observation.environment.candidate_pool[1].id='item-0',
    x=>x.observation.decision_id='other-benchmark']){
    const input=sample();mutate(input);assert.throws(()=>project(input),/AgentRecBench/);
  }
});
test('the pinned native pipeline consumes complete comments and returns all twenty native scores',async()=>{
  const domain={name:'amazon',item_noun:'products',categories:['a','b','c','d','e','f']};
  for(const populated of [true,false]){
    const input=sample();if(!populated)input.observation.behavior_events=[];
    const visible=project(input),state=emptyState(visible.user_id,domain),stages=[];
    const model=async(stage,payload)=>{
      stages.push(stage);
      if(stage==='extract'){
        assert(payload.events[0].text.includes('complete-review-tail'));
        return {preferences:[{category:'a',text:'Recorded dislike',strength:-0.5,action:'create',evidence_ids:[payload.events[0].signal_id]}]};
      }
      if(stage==='synthesize')return {profile:'Only the recorded review preference'};
      return {scores:payload.candidates.map((c,i)=>({id:c.id,score:i/2}))};
    };
    await retrospective(state,visible.history,model);const result=await rank(state,visible.candidates,'',model);
    assert.deepEqual(stages,populated?['extract','synthesize','rank']:['rank']);
    assert.deepEqual(result.ordered_item_ids,visible.candidates.map(c=>c.id).reverse());
    assert.equal(result.scores.length,20);
  }
});
test('only an unambiguous singleton category wrapper is normalized, without choosing between categories',()=>{
  const pref={category:['a'],text:'Recorded preference',strength:0.5,action:'create',evidence_ids:['e1']};
  const normalized=parseFor('extract',JSON.stringify([pref]));
  assert.equal(normalized.preferences[0].category,'a');
  assert.equal(normalized.format_normalization.kind,'singleton-category-array');
  const multi=parseFor('extract',JSON.stringify([{...pref,category:['a','b']} ]));
  assert.deepEqual(multi.preferences[0].category,['a','b']);
});
