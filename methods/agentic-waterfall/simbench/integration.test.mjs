import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {runRound} from './round.mjs';
test('both methods can search the same frozen synthetic corpus without hidden target',async()=>{
 const root=dirname(fileURLToPath(import.meta.url)),d=mkdtempSync(join(tmpdir(),'aw-simbench-'));
 try{
  const records=[{id:'a',source:'zhihu',title:'摄影入门',text:'摄影技巧',url:'https://zhihu.com/a',published_at:'2026-01-01T00:00:00Z'}];writeFileSync(join(d,'src.jsonl'),JSON.stringify(records[0])+'\n');
  let p=spawnSync('python3',[resolve(root,'freeze_catalog.py'),'--input',join(d,'src.jsonl'),'--output',join(d,'snapshot')],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);
  mkdirSync(join(d,'case','event_01','input'),{recursive:true});const input=join(d,'case','event_01','input');writeFileSync(join(input,'manifest.json'),JSON.stringify({case_id:'c',user_id:'u',runtime_sequence:{current_event_position:1}}));writeFileSync(join(input,'allowed_sources.json'),JSON.stringify({platforms:{zhihu:1}}));writeFileSync(join(input,'evidence.visible.jsonl'),JSON.stringify({event:1,step:1,kind:'search_intent',platform:'zhihu',record_id:'e',title:'摄影',ts_end_ms:1769990400000})+'\n');
  p=spawnSync('python3',[resolve(root,'case_input.py'),input],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);const evidence=JSON.parse(p.stdout);
  const search=async(source,query,limit)=>{const z=spawnSync('python3',[resolve(root,'search_cli.py'),join(d,'snapshot')],{input:JSON.stringify({source,query,limit,as_of_ms:evidence.as_of_ms}),encoding:'utf8'});assert.equal(z.status,0,z.stderr);return JSON.parse(z.stdout);};
  const model=async(stage)=>stage==='state'?{state:'own'}:stage==='plan'?{queries:[{source:'zhihu',query:'摄影'}]}:stage==='followup'?{queries:[]}:{ordered_indices:[1]};
  for(const method of ['clawrec','generic-agent']){const r=await runRound({method,evidence:evidence.evidence,priorState:null,allowedSources:evidence.allowed_sources,model,search});assert.deepEqual(r.ordered_item_ids,['a']);assert.equal(r.search_count,1);}
  assert.equal(JSON.parse(readFileSync(join(d,'snapshot','manifest.json'))).count,1);
 }finally{rmSync(d,{recursive:true,force:true});}
});
