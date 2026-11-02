import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,chmodSync,lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,existsSync,constants} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createCloudHandler} from '../lib/waterfall/server.mjs';
import {CloudAccounts,CloudStore} from '../lib/waterfall/cloud-store.mjs';
import {startSession} from '../lib/waterfall/core.mjs';

const siteRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataRoot=resolve(siteRoot,'../local-qa'),dbPath=resolve(dataRoot,'preview.sqlite');
const port=Number(process.env.DATASET_PREVIEW_PORT||4195);
assert(Number.isInteger(port)&&port>0&&port<=65535,'Invalid DATASET_PREVIEW_PORT');
const base=`http://127.0.0.1:${port}`,modelName='synthetic_test_only_scripted_model';
const csp="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};

function privateDirectory(path){
 mkdirSync(path,{recursive:true,mode:0o700});
 assert(lstatSync(path).isDirectory()&&!lstatSync(path).isSymbolicLink(),'QA directory must be a real directory');chmodSync(path,0o700);
}

function privateArchive(){
 const directory=resolve(dataRoot,'artifacts');privateDirectory(directory);
 const file=key=>resolve(directory,createHash('sha256').update(String(key)).digest('hex')+'.gz');
 return {
  async head(key){const path=file(key);if(!existsSync(path))return null;const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink(),'QA artifact must be a regular file');return {size:stat.size};},
  async put(key,bytes){
   const target=file(key),temporary=target+'.'+randomUUID()+'.tmp',fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
   renameSync(temporary,target);
  },
  async get(key){if(!await this.head(key))return null;const bytes=readFileSync(file(key));return {async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};}
 };
}

function database(){
 if(existsSync(dbPath))assert(lstatSync(dbPath).isFile()&&!lstatSync(dbPath).isSymbolicLink(),'QA database must be a regular file');
 const native=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);
 try{
  native.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS __preview_migrations (name TEXT PRIMARY KEY)');
  for(const name of readdirSync(resolve(siteRoot,'drizzle')).filter(file=>file.endsWith('.sql')).sort()){
   if(native.prepare('SELECT name FROM __preview_migrations WHERE name=?').get(name))continue;
   native.exec('BEGIN');try{native.exec(readFileSync(resolve(siteRoot,'drizzle',name),'utf8'));native.prepare('INSERT INTO __preview_migrations(name) VALUES (?)').run(name);native.exec('COMMIT');}catch(error){native.exec('ROLLBACK');throw error;}
  }
 }catch(error){native.close();throw error;}
 const db={prepare(sql){return {bind(...args){const statement=native.prepare(sql);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){statement.run(...args);return {success:true};}};}};}};
 return {native,db};
}

function scriptedDecision(request){
 assert.equal(request.model,modelName,'Only the QA scripted model is allowed');
 const {observation,context}=JSON.parse(request.messages.findLast(message=>message.role==='user').content);
 const action={action_id:`qa-${observation.decision_id}-${context.call_index}`,evidence_refs:[],depends_on:[]};
 if(context.call_index===0)return {decision_id:observation.decision_id,actions:[{...action,kind:'acquire',arguments:{source_ids:['hackernews'],mode:'search',query:'AI',content_types:['text'],constraint_refs:[],limit:5}}]};
 const returned=observation.environment.tool_results.filter(receipt=>receipt.kind==='acquire'&&receipt.status==='success').flatMap(receipt=>receipt.result?.item_ids||[]);
 const ids=[...new Set(returned)].filter(id=>observation.environment.candidate_pool.some(item=>item.id===id)).slice(0,2);
 return {decision_id:observation.decision_id,actions:[ids.length?{...action,kind:'recommend',arguments:{ordered_item_ids:ids,delivery:'replace_pending'}}:{...action,kind:'idle',arguments:{mode:'wait'}}]};
}

async function readJson(req){
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2_097_152)throw Object.assign(Error('Request too large'),{status:413});chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function send(res,status,body,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':csp});res.end(body);
}
function listen(server,port){return new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);accept();});});}
function closeServer(server){return new Promise((accept,reject)=>{if(!server?.listening)return accept();server.close(error=>error?reject(error):accept());server.closeIdleConnections();});}

const browserScript=`
const output=document.querySelector('#output'),login=document.querySelector('#login'),run=document.querySelector('#run'),status=document.querySelector('#status');let sid=null;
async function call(path,body){const response=await fetch(path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw Error(data.error||('HTTP '+response.status));return data;}
function show(data){output.textContent=JSON.stringify(data,null,2);}
login.onclick=async()=>{try{const data=await call('/api/identity',{username:document.querySelector('#username').value,type:'human'});sid=data.sessionInfo.session.session_id;run.disabled=false;status.disabled=false;for(const [id,format]of [['dataset','&format=dataset'],['normal','']]){const link=document.querySelector('#'+id);link.href='/api/export?sessionId='+encodeURIComponent(sid)+format;link.hidden=false;}show({logged_in:true,sessionId:sid,record_kind:data.sessionInfo.session.record_kind});}catch(error){show({error:error.message});}};
run.onclick=async()=>{run.disabled=true;show({running:true,note:'Scripted model; actual Hacker News HTTPS search. No paid model.'});try{show(await call('/api/run',{sessionId:sid,trigger:'command',command:'synthetic/test_only QA: search Hacker News for AI, then recommend the first two actual returned items.'}));}catch(error){show({error:error.message});}finally{run.disabled=false;}};
status.onclick=async()=>{try{show(await call('/api/dataset/status?sessionId='+encodeURIComponent(sid)));}catch(error){show({error:error.message});}};
`;

function page(username){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dataset collection QA</title><style>body{font:16px system-ui;margin:24px auto;max-width:960px;padding:0 16px;color:#182029}aside{padding:16px;background:#fff1a8;border:2px solid #8a6500}button,input{font:inherit;padding:8px;margin:8px 8px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f4f5;padding:16px}a{display:inline-block;margin:12px 16px 12px 0}</style><body><aside role="note"><strong>synthetic/test_only · 隔离 QA</strong><br>Scripted local model + live public Hacker News search. No real participant, paid model, or frozen catalog. 全部记录仅供开发验收。</aside><h1>在线归档与导出验收</h1><p>先登录测试账号，再点击运行。启动服务不会执行搜索或推荐。</p><label>测试用户名 <input id="username" value="${username}" readonly></label><button id="login">登录测试账号</button><div><button id="run" disabled>运行真实 HN 搜索并推荐 2 条</button><button id="status" disabled>查看归档状态</button></div><a id="dataset" hidden download>下载 dataset.json.gz</a><a id="normal" hidden download>下载原始 JSON</a><pre id="output" role="status" aria-live="polite">尚未登录，未执行搜索或模型调用。</pre><script src="/dataset-preview.js"></script></body></html>`;}

/** Starts isolated QA without issuing any model or online search requests. */
export async function createDatasetPreview(){
 privateDirectory(dataRoot);
 const lockPath=resolve(dataRoot,'preview.lock'),identity=JSON.stringify({pid:process.pid,nonce:randomUUID()});
 let lock;try{lock=openSync(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Dataset QA directory is locked; inspect local-qa/preview.lock before restarting');throw error;}
 try{writeFileSync(lock,identity);fsyncSync(lock);}finally{closeSync(lock);}
 let server,modelServer,native;
 const unlock=()=>{if(readFileSync(lockPath,'utf8')===identity)unlinkSync(lockPath);};
 try{
  const connection=database();native=connection.native;const {db}=connection,datasetArchive=privateArchive();
  modelServer=createServer(async(req,res)=>{
   try{
    if(req.headers.host!==`127.0.0.1:${modelServer.address().port}`)return send(res,403,JSON.stringify({error:'Loopback model host required'}));
    if(req.method!=='POST'||req.url!=='/chat/completions')return send(res,404,JSON.stringify({error:'Not found'}));
    const content=JSON.stringify(scriptedDecision(await readJson(req)));
    send(res,200,JSON.stringify({model:modelName,choices:[{message:{role:'assistant',content},finish_reason:'stop'}]}));
   }catch(error){send(res,error.status||400,JSON.stringify({error:error.message}));}
  });
  await listen(modelServer,0);
  const config={key:'synthetic-local-placeholder',endpoint:`http://127.0.0.1:${modelServer.address().port}/chat/completions`,model:modelName,timeoutMs:30000};
  const username=`qa-dataset-${Date.now().toString(36)}-${randomUUID().slice(0,4)}`,accounts=new CloudAccounts(db);
  let {user}=await accounts.selectIdentity({username,type:'human'});user=await accounts.updateSettings(user.id,{sources:['hackernews'],contentTypes:['text'],interests:['人工智能']});
  const store=new CloudStore(db);await store.load(user.id);
  const session=await startSession(store,{consent:true,recordKind:'synthetic',interests:['人工智能'],profile:'synthetic/test_only: fictitious developer QA account; no human participant.'},user);
  const publicRoot=realpathSync(resolve(siteRoot,'public'));
  server=createServer(async(req,res)=>{
   try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,JSON.stringify({error:'Local QA host required'}));
    const url=new URL(req.url,base);
    if(url.pathname==='/api/health')return send(res,req.method==='GET'?200:405,JSON.stringify({status:'ok',data_origin:'synthetic/test_only',model:modelName,search:'live_public_hackernews',storage:'sqlite+files'}));
    if(url.pathname.startsWith('/api/'))return await createCloudHandler({db,config,sourceConfig:{},datasetArchive,datasetStorage:'sqlite+files'}).handler(req,res);
    if(!['GET','HEAD'].includes(req.method))return send(res,405,'Method not allowed','text/plain; charset=utf-8');
    if(url.pathname==='/')return send(res,200,req.method==='HEAD'?'':page(username),'text/html; charset=utf-8');
    if(url.pathname==='/dataset-preview.js')return send(res,200,req.method==='HEAD'?'':browserScript,'text/javascript; charset=utf-8');
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return send(res,400,'Invalid path','text/plain; charset=utf-8');}
    if(pathname.includes('\0')||pathname.includes('\\'))return send(res,400,'Invalid path','text/plain; charset=utf-8');
    const candidate=resolve(publicRoot,'.'+pathname);
    if(!candidate.startsWith(publicRoot+sep))return send(res,403,'Forbidden','text/plain; charset=utf-8');
    let file;try{file=realpathSync(candidate);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return send(res,404,'Not found','text/plain; charset=utf-8');throw error;}
    if(!file.startsWith(publicRoot+sep)||!lstatSync(file).isFile())return send(res,403,'Forbidden','text/plain; charset=utf-8');
    let content=readFileSync(file);if(extname(file)==='.html')content=Buffer.from(content.toString('utf8').replace('<body>','<body><aside role="note" style="padding:12px;background:#fff1a8;border:2px solid #8a6500">synthetic/test_only · scripted local model + live public search · 隔离 QA</aside>'));
    send(res,200,req.method==='HEAD'?'':content,mime[extname(file)]||'application/octet-stream');
   }catch(error){if(!res.headersSent)send(res,error.status||500,JSON.stringify({error:error.message}));else res.end();}
  });
  await listen(server,port);let closed=false;
  return {info:{port,username,session_id:session.session_id,db_path:dbPath,storage:'sqlite+files',data_origin:'synthetic/test_only',model:modelName},async close(){if(closed)return;closed=true;try{await closeServer(server);await closeServer(modelServer);native.close();}finally{unlock();}}};
 }catch(error){await closeServer(server);await closeServer(modelServer);native?.close();unlock();throw error;}
}

async function selfCheck(){
 const observation={decision_id:'selfcheck',environment:{candidate_pool:[],tool_results:[]}};
 assert.equal(scriptedDecision({model:modelName,messages:[{role:'user',content:JSON.stringify({observation,context:{call_index:0}})}]}).actions[0].kind,'acquire');
 observation.environment={candidate_pool:[{id:'returned-one'},{id:'unrelated'}],tool_results:[{kind:'acquire',status:'success',result:{item_ids:['returned-one','missing']}}]};
 assert.deepEqual(scriptedDecision({model:modelName,messages:[{role:'user',content:JSON.stringify({observation,context:{call_index:1}})}]}).actions[0].arguments.ordered_item_ids,['returned-one']);
 const preview=await createDatasetPreview();
 try{
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.match(await (await fetch(base+'/')).text(),/synthetic\/test_only/);
  assert.equal((await fetch(base+'/%2e%2e%2flocal-qa/preview.sqlite')).status,403);
  const denied=await fetch(base+'/api/dataset/status?sessionId='+preview.info.session_id);assert.equal(denied.status,401);
  const response=await fetch(base+'/api/identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:preview.info.username,type:'human'})});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0],identity=await response.json();assert.equal(identity.sessionInfo.session.record_kind,'synthetic');assert.equal(identity.sessionInfo.lastRun,null);
  const status=await (await fetch(base+'/api/dataset/status?sessionId='+preview.info.session_id,{headers:{cookie}})).json();assert.equal(status.storage,'sqlite+files');assert.equal(status.captures.total,0);
  await assert.rejects(()=>createDatasetPreview(),/directory is locked/);
  console.log(JSON.stringify({self_check:'passed',network_searches:0,paid_model_calls:0}));
 }finally{await preview.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.includes('--self-check'))await selfCheck();
  else{const preview=await createDatasetPreview();console.log(JSON.stringify({url:base,...preview.info}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>preview.close().then(()=>process.exit(0)));}
 }catch(error){console.error(error.message);process.exitCode=1;}
}
