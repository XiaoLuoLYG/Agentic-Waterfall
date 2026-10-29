import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const lines=file=>readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const temp=t=>{const dir=mkdtempSync(join(tmpdir(),'waterfall-dataset-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const sample=()=>({observation:{decision_id:'test',user_id:'7',session_id:'s',observed_at:'2026-01-01T00:00:00Z',dialogue:[],behavior_events:[],user_state:{version:0,records:[]},environment:{candidate_pool:[{id:'item-1',title:'item',source_id:'test'}],sources:[]}},protocol:{mode:'fixed_candidates',top_k:1,max_model_calls:1,max_tool_calls:0,max_output_tokens:100}});

test('KuaiRand accepts an explicitly supplied batch beyond the original smoke limit',t=>{
 const dir=temp(t),example=sample();
 const input=join(dir,'input.jsonl'),output=join(dir,'out.jsonl');
 writeFileSync(input,Array.from({length:4},(_,i)=>JSON.stringify({...example,observation:{...example.observation,decision_id:`test-${i}`}})).join('\n')+'\n');
 const run=spawnSync(process.execPath,[join(root,'kuairand/scripts/run_waterfall.mjs'),'--input',input,'--output',output],{encoding:'utf8',env:{...process.env,MODEL_CONFIG_FILE:join(dir,'absent-config.json')}});
 assert.equal(run.status,2,run.stderr);assert.equal(lines(output).length,4);assert(lines(output).every(row=>row.status==='failed'));
});

test('KuaiRand never replaces an existing saved state file',t=>{
 const dir=temp(t),input=join(dir,'input.jsonl'),output=join(dir,'out.jsonl');
 writeFileSync(input,JSON.stringify(sample())+'\n');writeFileSync(output+'.states.json','saved state');
 const run=spawnSync(process.execPath,[join(root,'kuairand/scripts/run_waterfall.mjs'),'--input',input,'--output',output,'--fixture'],{encoding:'utf8'});
 assert.notEqual(run.status,0);assert.equal(readFileSync(output+'.states.json','utf8'),'saved state');
});

test('KuaiRec runner reads the requested input and writes only requested output paths',t=>{
 const dir=temp(t),input=join(dir,'input.jsonl'),output=join(dir,'out.jsonl'),predictions=join(dir,'predictions.jsonl');writeFileSync(input,JSON.stringify(sample())+'\n');
 const run=spawnSync(process.execPath,[join(root,'kuairec/scripts/run_waterfall.mjs'),'--input',input,'--output',output,'--predictions',predictions],{encoding:'utf8',env:{...process.env,MODEL_CONFIG_FILE:join(dir,'absent-config.json')}});
 assert.equal(run.status,2,run.stderr);assert.equal(lines(output).length,1);assert.equal(lines(predictions).length,1);
});

test('KuaiRec input builder exports a selected split without overwriting the development file',t=>{
 const dir=temp(t),scripts=join(dir,'scripts'),data=join(dir,'processed');mkdirSync(scripts);mkdirSync(data);
 copyFileSync(join(root,'kuairec/scripts/build_waterfall_inputs.py'),join(scripts,'build_waterfall_inputs.py'));
 writeFileSync(join(data,'splits.json'),JSON.stringify({test:[7,8],subset_dev16:[3]}));
 writeFileSync(join(data,'histories.jsonl'),[3,7,8].map(user_id=>JSON.stringify({user_id,events:[]})).join('\n')+'\n');
 const output=join(dir,'test-inputs.jsonl');
 const run=spawnSync('python3',[join(scripts,'build_waterfall_inputs.py'),'--data-dir',data,'--split','test','--output',output],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(lines(output).map(row=>row.observation.user_id),['7','8']);assert(!existsSync(join(data,'waterfall-dev4.jsonl')));
});

test('KuaiRec includes assigned users with missing predictions in the denominator',{skip:!existsSync(join(root,'kuairec/.venv/bin/python'))},t=>{
 const dir=temp(t),scripts=join(dir,'scripts'),data=join(dir,'data/processed'),privateDir=join(data,'evaluator_only');mkdirSync(scripts,{recursive:true});mkdirSync(privateDir,{recursive:true});copyFileSync(join(root,'kuairec/scripts/evaluate.py'),join(scripts,'evaluate.py'));
 const python=join(root,'kuairec/.venv/bin/python'),setup="import numpy as np,sys;d=sys.argv[1];u=np.array([7,8]);i=np.array([1,2]);np.savez(d+'/eligibility.npz',users=u,items=i,observed=np.array([[1,1],[1,1]],dtype=bool));np.savez(d+'/evaluator_only/labels.npz',users=u,items=i,relevant=np.array([[1,0],[0,1]],dtype=bool))";assert.equal(spawnSync(python,['-c',setup,data]).status,0);
 const input=join(dir,'input.jsonl'),pred=join(dir,'pred.jsonl'),output=join(dir,'score.json');writeFileSync(input,[7,8].map(user_id=>JSON.stringify({observation:{user_id:String(user_id)}})).join('\n')+'\n');writeFileSync(pred,JSON.stringify({user_id:7,method:'waterfall',status:'submitted',acquisition_required:true,ordered_item_ids:['1'],acquired_item_ids:['1']})+'\n');
 const run=spawnSync(python,[join(scripts,'evaluate.py'),'--input',input,'--predictions',pred,'--output',output],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);const result=JSON.parse(readFileSync(output,'utf8'));assert.equal(result.n_users,2);assert.equal(result.rows[1].status,'failed');assert.equal(result.rows[1].recall_at_10,0);
});

test('MIND scores Waterfall predictions alone while retaining failed impressions',{skip:!existsSync(join(root,'mind/.venv/bin/python'))||!existsSync(join(root,'mind/upstream/MIND/evaluate.py'))},t=>{
 const dir=temp(t),truth=join(dir,'truth.json'),pred=join(dir,'predictions.jsonl'),output=join(dir,'score.json');
 writeFileSync(truth,JSON.stringify([{impression_id:'1',labels:[1,0],original_candidate_ids:['n1','n2']},{impression_id:'2',labels:[0,1],original_candidate_ids:['n3','n4']}]));
 writeFileSync(pred,[{decision_id:'mind:test:1',status:'submitted',ordered_item_ids:['n1','n2']},{decision_id:'mind:test:2',status:'failed',ordered_item_ids:[],error:'model_failed'}].map(JSON.stringify).join('\n')+'\n');
 const run=spawnSync(join(root,'mind/.venv/bin/python'),[join(root,'mind/scripts/score_waterfall.py'),'--truth',truth,'--predictions',pred,'--output',output],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const result=JSON.parse(readFileSync(output,'utf8'));assert.equal(result.impressions,2);assert.equal(result.invalid_outputs,1);assert.equal(result.failures[0].id,'2');assert(Number.isFinite(result.metrics.AUC));
});

test('MIND counts assigned impressions missing from the predictions',{skip:!existsSync(join(root,'mind/.venv/bin/python'))||!existsSync(join(root,'mind/upstream/MIND/evaluate.py'))},t=>{
 const dir=temp(t),truth=join(dir,'truth.json'),input=join(dir,'input.jsonl'),pred=join(dir,'predictions.jsonl'),output=join(dir,'score.json');
 writeFileSync(truth,JSON.stringify([{impression_id:'1',labels:[1,0],original_candidate_ids:['n1','n2']},{impression_id:'2',labels:[0,1],original_candidate_ids:['n3','n4']}]));
 writeFileSync(input,['1','2'].map(i=>JSON.stringify({observation:{decision_id:`mind:test:${i}`}})).join('\n')+'\n');writeFileSync(pred,JSON.stringify({decision_id:'mind:test:1',status:'submitted',ordered_item_ids:['n1','n2']})+'\n');
 const run=spawnSync(join(root,'mind/.venv/bin/python'),[join(root,'mind/scripts/score_waterfall.py'),'--truth',truth,'--input',input,'--predictions',pred,'--output',output],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const result=JSON.parse(readFileSync(output,'utf8'));assert.equal(result.impressions,2);assert.equal(result.invalid_outputs,1);assert.equal(result.failures[0].id,'2');
});

test('AgentRecBench local tool server exposes only official retrieval methods',()=>{
 const script=`import sys,threading,json,urllib.request,urllib.error\nsys.path.insert(0,sys.argv[1])\nfrom waterfall_tool_server import create_server\nclass Tool:\n def get_item(self,item_id):return {'item_id':item_id}\ns=create_server(Tool(),0);threading.Thread(target=s.serve_forever,daemon=True).start()\nurl='http://127.0.0.1:'+str(s.server_port)\ndef call(tool):\n req=urllib.request.Request(url,data=json.dumps({'tool':tool,'arguments':{'item_id':'item'}}).encode(),headers={'Content-Type':'application/json'})\n try:\n  with urllib.request.urlopen(req) as r:return r.status,json.load(r)\n except urllib.error.HTTPError as e:return e.code,json.load(e)\nassert call('get_item')==(200,{'result':{'item_id':'item'}})\nassert call('__class__')[0]==400\ns.shutdown();s.server_close()`;
 const run=spawnSync('python3',['-c',script,join(root,'agentrecbench/scripts')],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
});

test('AgentRecBench scores saved Waterfall outputs and counts failures',{skip:!existsSync(join(root,'agentrecbench/.venv/bin/python'))||!existsSync(join(root,'agentrecbench/upstream'))},t=>{
 const dir=temp(t),tasks=join(dir,'tasks'),truth=join(dir,'groundtruth');mkdirSync(tasks);mkdirSync(truth);
 const candidates=Array.from({length:20},(_,i)=>`item-${i}`);
 for(let i=0;i<2;i++){writeFileSync(join(tasks,`task_${i}.json`),JSON.stringify({candidate_list:candidates}));writeFileSync(join(truth,`groundtruth_${i}.json`),JSON.stringify({'ground truth':'item-0'}));writeFileSync(join(dir,`result-${i}.json`),JSON.stringify({input:{run_meta:{task_id:String(i)}},result:{status:i?'failed':'submitted',ordered_item_ids:i?[]:candidates,error:i?'model_failed':null}}));}
 const output=join(dir,'score.json'),run=spawnSync(join(root,'agentrecbench/.venv/bin/python'),[join(root,'agentrecbench/scripts/score_waterfall.py'),'--task-dir',dir,'--output',output,join(dir,'result-0.json'),join(dir,'result-1.json')],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const result=JSON.parse(readFileSync(output,'utf8'));assert.equal(result.n,2);assert.equal(result.failed,1);assert.equal(result.metrics.top_1_hit_rate,0.5);
});

test('AgentRecBench counts assigned tasks with no saved result',{skip:!existsSync(join(root,'agentrecbench/.venv/bin/python'))||!existsSync(join(root,'agentrecbench/upstream'))},t=>{
 const dir=temp(t),tasks=join(dir,'tasks'),truth=join(dir,'groundtruth');mkdirSync(tasks);mkdirSync(truth);const candidates=Array.from({length:20},(_,i)=>`item-${i}`);
 for(let i=0;i<2;i++){writeFileSync(join(tasks,`task_${i}.json`),JSON.stringify({candidate_list:candidates}));writeFileSync(join(truth,`groundtruth_${i}.json`),JSON.stringify({'ground truth':'item-0'}));}
 const result=join(dir,'result.json');writeFileSync(result,JSON.stringify({input:{run_meta:{task_id:'0'}},result:{status:'submitted',ordered_item_ids:candidates}}));
 const output=join(dir,'score.json'),run=spawnSync(join(root,'agentrecbench/.venv/bin/python'),[join(root,'agentrecbench/scripts/score_waterfall.py'),'--task-dir',dir,'--task-ids','0,1','--output',output,result],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const score=JSON.parse(readFileSync(output,'utf8'));assert.equal(score.n,2);assert.equal(score.failed,1);assert.equal(score.metrics.top_1_hit_rate,0.5);
});

test('ClawRec evaluator accepts exactly one valid judge label per pooled card',async()=>{
 const {judgeLabels}=await import('../clawrec/scripts/judge_waterfall.mjs');
 const pool={evaluation_id:'test',cards:[{card_id:'a'},{card_id:'b'}]};
 assert.deepEqual(judgeLabels(pool,{evaluation_id:'test',card_relevance:[{card_id:'a',rel:3},{card_id:'b',rel:5}]}),{a:3,b:5});
 assert.throws(()=>judgeLabels(pool,{evaluation_id:'test',card_relevance:[{card_id:'a',rel:3},{card_id:'a',rel:5}]}),/invalid_judge_output/);
 assert.throws(()=>judgeLabels(pool,{evaluation_id:'test',card_relevance:[{card_id:'a',rel:0},{card_id:'b',rel:5}]}),/invalid_judge_output/);
});

test('ClawRec converts saved acquired items and ranking into evaluator inputs',t=>{
 const dir=temp(t),result=join(dir,'result.json'),catalog=join(dir,'catalog.json'),ranking=join(dir,'ranking.json');
 writeFileSync(result,JSON.stringify({result:{status:'submitted',ordered_item_ids:['item'],candidate_pool_after:[{id:'item',title:'title',url:'https://example.test/item',source_id:'bilibili'}]}}));
 const run=spawnSync('python3',[join(root,'clawrec/scripts/export_pool.py'),'--result',result,'--catalog',catalog,'--rankings',ranking],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(readFileSync(ranking,'utf8')),{Waterfall:['item']});assert.equal(JSON.parse(readFileSync(catalog,'utf8')).item.title,'title');
});
