import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

test('agent requires a profile and simulated actions remain linked to its content', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'waterfall-agent-'));
  let invalid = false;
  const model = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: invalid ? '{bad json' : JSON.stringify({ actions: ['like', 'save'], comment: '', command: '' }) } }] })); });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const { server, store } = createServer({ dataDir: dir, sourceConfig: {}, config: { endpoint: `http://127.0.0.1:${model.address().port}`, key: 'test', model: 'test', timeoutMs: 5000 } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); model.closeAllConnections(); model.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(data) });
  const identity = await post('/api/identity', { username: '小雨', type: 'agent' });
  const cookie = identity.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/api/session', { consent: true, recordKind: 'synthetic', interests: [] }, cookie)).status, 400);
  const created = await post('/api/session', { consent: true, recordKind: 'synthetic', interests: [], profile: '喜欢摄影' }, cookie);
  const session = (await created.json()).session;
  const item = { id: 'one', content_hash: 'hash', title: '摄影', topic: '摄影', source: 'test' };
  const run = store.record('run', session.session_id, { result: { slate: [item] } });
  const response = await post('/api/agent-step', { sessionId: session.session_id, referenceId: run.id, position: 1 }, cookie);
  assert.equal(response.status, 200);
  const rows = store.rows.filter(row => row.simulated);
  assert.deepEqual(rows.filter(row => row.kind === 'feedback').map(row => row.value), ['like', 'save']);
  assert(rows.every(row => row.record_kind === 'synthetic' && row.content_id === item.id));
  assert.equal(new Set(rows.filter(row => row.exposure_id).map(row => row.exposure_id)).size, 1);
  invalid = true; assert.notEqual((await post('/api/agent-step', { sessionId:session.session_id, referenceId:run.id, position:1 }, cookie)).status, 200);
  const exported = await (await fetch(`${base}/api/export?sessionId=${session.session_id}&format=json`, { headers:{cookie} })).json();
  assert.equal(exported.metadata.data_origin, 'synthetic'); assert(exported.simulator_decisions.some(row => row.kind === 'agent_attempt')); assert(exported.simulator_decisions.some(row => row.kind === 'agent_decision' && row.attempt_id)); assert(exported.simulator_decisions.some(row => row.kind === 'agent_failure' && row.raw_output === '{bad json'));

});

test('simulator input is visible in the trace while its model request is still running', async t => {
  const dir=mkdtempSync(join(tmpdir(),'waterfall-agent-pending-'));
  let release,announce;const gate=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{announce=resolve;});
  const model=http.createServer(async(req,res)=>{for await(const _ of req){} announce();await gate;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"actions":[],"comment":"","command":""}'}}]}));});
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const {server,store}=createServer({dataDir:dir,sourceConfig:{},config:{endpoint:`http://127.0.0.1:${model.address().port}`,key:'fixture',model:'fixture',timeoutMs:5000}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{release();server.closeAllConnections();server.close();model.closeAllConnections();model.close();rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
  async function post(path,data){return fetch(base+path,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(data)});}
  const identity=await post('/api/identity',{username:'pending-agent',type:'agent'});cookie=identity.headers.get('set-cookie').split(';')[0];
  const created=await post('/api/session',{consent:true,recordKind:'synthetic',interests:[],profile:'喜欢自然'});const sid=(await created.json()).session.session_id;
  const item={id:'one',title:'自然',source:'test'};const run=store.record('run',sid,{track:'feed',result:{slate:[item]}});
  const pending=post('/api/agent-step',{sessionId:sid,referenceId:run.id,position:1});await started;
  const trace=await (await fetch(`${base}/api/trace?sessionId=${sid}`,{headers:{cookie}})).json();
  assert(trace.simulator_decisions.some(row=>row.kind==='agent_attempt' && row.messages[1].content.includes('喜欢自然')));
  assert(!trace.simulator_decisions.some(row=>row.kind==='agent_decision'));
  release();assert.equal((await pending).status,200);
});
