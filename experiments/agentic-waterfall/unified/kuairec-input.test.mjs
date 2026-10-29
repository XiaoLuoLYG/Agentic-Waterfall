import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('KuaiRec export identifies complete splits and preserves the default dev4 identifiers',t=>{
  const dir=mkdtempSync(join(tmpdir(),'waterfall-kuairec-input-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'splits.json'),JSON.stringify({dev:[7,8],test:[9,10],subset_dev16:[1,2,3,4,5]}));
  writeFileSync(join(dir,'histories.jsonl'),[1,2,3,4,5,7,8,9,10].map(user_id=>JSON.stringify({user_id,events:[]})).join('\n')+'\n');
  const script=resolve(import.meta.dirname,'../kuairec/scripts/build_waterfall_inputs.py');
  for(const [name,args,users,split,kind,idSplit] of [
    ['default',[],[1,2,3,4],'subset_dev16','subset','dev'],
    ['dev',['--split','dev'],[7,8],'dev','split_complete','dev'],
    ['test',['--split','test'],[9,10],'test','split_complete','test'],
    ['test-part',['--split','test','--limit','1'],[9],'test','subset','test'],
    ['test-full-limit',['--split','test','--limit','2'],[9,10],'test','split_complete','test'],
    ['dev16',['--split','subset_dev16'],[1,2,3,4,5],'subset_dev16','subset','subset_dev16'],
  ]){
    const output=join(dir,`${name}.jsonl`);
    const run=spawnSync('python3',[script,'--data-dir',dir,'--output',output,...args],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const rows=readFileSync(output,'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(row=>row.observation.user_id),users.map(String));
    assert.deepEqual(rows.map(row=>row.observation.decision_id),users.map(user=>`kuairec-static-${idSplit}-${user}`));
    assert(rows.every(row=>row.run_meta.split===split&&row.run_meta.kind===kind));
  }
});
