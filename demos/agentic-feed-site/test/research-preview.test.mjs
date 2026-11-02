import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createPrivateObjectStore} from '../scripts/research-preview.mjs';

test('preview object storage keeps gzip private and retrievable across store reconstruction',async()=>{
 const directory=mkdtempSync(resolve(tmpdir(),'research-files-'));
 try{const store=createPrivateObjectStore(directory),data=Buffer.from([31,139,3,4]);await store.put('research/user/job.json.gz',data);assert.deepEqual(Buffer.from(await (await createPrivateObjectStore(directory).get('research/user/job.json.gz')).arrayBuffer()),data);assert.equal(statSync(directory).mode&0o777,0o700);assert.equal(statSync(resolve(directory,readdirSync(directory)[0])).mode&0o777,0o600);assert.equal(await store.get('missing'),null);}finally{rmSync(directory,{recursive:true,force:true});}
});
