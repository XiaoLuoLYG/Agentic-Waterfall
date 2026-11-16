import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

test('fresh MIND runner verifies a disabled gateway before accepting work, without a prior ledger',t=>{
 const root=mkdtempSync(join(tmpdir(),'waterfall-mind-preflight-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'inputs.jsonl');writeFileSync(source,'');
 const db=new DatabaseSync(join(root,'index.sqlite'));db.exec('CREATE TABLE tasks(id INTEGER,decision_id TEXT,offset INTEGER,bytes INTEGER,eligible INTEGER)');db.close();
 writeFileSync(join(root,'manifest.json'),JSON.stringify({source,source_sha256:createHash('sha256').update('').digest('hex'),eligible:0}));
 writeFileSync(join(root,'config.json'),JSON.stringify({apiKey:'offline-fixture',apiBase:'https://api.jiuwenappless.com/v1'}));
 writeFileSync(join(root,'offline.mjs'),`import assert from 'node:assert/strict';globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://api.jiuwenappless.com/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'DeepSeek-V4.1-Flash-1017');return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{prompt_tokens:10,completion_tokens:5}});};`);
 const run=spawnSync(process.execPath,['--import',join(root,'offline.mjs'),fileURLToPath(new URL('./mind-full.mjs',import.meta.url)),
  '--index',join(root,'index.sqlite'),'--manifest',join(root,'manifest.json'),'--out',join(root,'out'),'--python','unused-python',
  '--transport',fileURLToPath(new URL('../../../experiments/agentic-waterfall/synthetic-collection/api.mjs',import.meta.url)),
  '--config',join(root,'config.json'),'--workers','1'],{encoding:'utf8',timeout:10000});
 const launch=readdirSync(join(root,'out/gateway'))[0];
 assert.equal(run.status,0,(run.stderr||String(run.error))+readFileSync(join(root,'out/gateway',launch,'api/preflight.json'),'utf8'));
 assert.equal(JSON.parse(readFileSync(join(root,'out/gateway',launch,'api/preflight.json')))[0].ok,true);
 assert.equal(JSON.parse(readFileSync(join(root,'out/progress.json'))).phase,'complete');
});
