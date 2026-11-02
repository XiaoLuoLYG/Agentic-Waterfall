import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,chmodSync,lstatSync,realpathSync,openSync,writeSync,writeFileSync,fsyncSync,fchmodSync,constants,closeSync,unlinkSync,existsSync,renameSync} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {handleApi} from '../lib/waterfall/cloud-entry.mjs';
import {CloudStore} from '../lib/waterfall/cloud-store.mjs';
import {hash,inputSnapshot} from '../lib/waterfall/core.mjs';
import {createResearchService} from './research-service.mjs';
import {createRemoteResearchBackend} from '../lib/waterfall/research-backend.mjs';

const siteRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dataRoot=resolve(siteRoot,'../qa-data'),dbPath=resolve(dataRoot,'preview.sqlite');
const port=Number(process.env.RESEARCH_PREVIEW_PORT||4191),base=`http://127.0.0.1:${port}`;
assert(Number.isInteger(port)&&port>0&&port<=65535,'Invalid QA preview port');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};

function researchDirectory(){
 if(process.env.WATERFALL_RESEARCH_ROOT)return realpathSync(resolve(process.env.WATERFALL_RESEARCH_ROOT));
 for(let at=siteRoot;;at=dirname(at)){
  const candidate=resolve(at,'methods/agentic-waterfall');if(existsSync(resolve(candidate,'simbench/round.mjs')))return realpathSync(candidate);
  if(dirname(at)===at)break;
 }
 throw Error('Set WATERFALL_RESEARCH_ROOT to the local methods/agentic-waterfall directory');
}

function lockDirectory(){
 mkdirSync(dataRoot,{recursive:true,mode:0o700});if(lstatSync(dataRoot).isSymbolicLink()||!lstatSync(dataRoot).isDirectory())throw Error('QA data directory must be a real directory');chmodSync(dataRoot,0o700);
 const path=resolve(dataRoot,'preview.lock'),identity={pid:process.pid,nonce:randomUUID()},text=JSON.stringify(identity);
 for(let attempt=0;attempt<2;attempt++){
  try{const fd=openSync(path,'wx',0o600);try{writeSync(fd,text);}finally{closeSync(fd);}return ()=>{try{if(readFileSync(path,'utf8')===text)unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}};}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   if(lstatSync(path).isSymbolicLink())throw Error('QA preview lock must not be a symlink');
   const previous=readFileSync(path,'utf8');let owner;try{owner=JSON.parse(previous);}catch{throw Error('QA preview lock is unreadable; inspect it before starting another process');}
   if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('QA preview lock has no valid owner');
   try{process.kill(owner.pid,0);throw Error('QA data directory already has a running preview process');}
   catch(check){if(check.code!=='ESRCH')throw check;}
   if(readFileSync(path,'utf8')!==previous)throw Error('QA preview lock changed during startup');unlinkSync(path);
  }
 }
 throw Error('Could not acquire the QA preview lock');
}

// Synchronous fsync keeps each completed receipt durable before another call can start.
export function createPrivateArchive(directory=dataRoot){
 return entry=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.run_id))throw Error('Invalid archive run identity');
  const fd=openSync(resolve(directory,`research-${entry.run_id}.jsonl`),constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  try{fchmodSync(fd,0o600);writeFileSync(fd,JSON.stringify(entry)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 };
}

export function createPrivateObjectStore(directory=resolve(dataRoot,'artifacts')){
 mkdirSync(directory,{recursive:true,mode:0o700});if(lstatSync(directory).isSymbolicLink())throw Error('Private object directory must not be a symlink');chmodSync(directory,0o700);
 const file=key=>resolve(directory,hash(String(key))+'.gz');
 return {
  async put(key,data){const target=file(key),temporary=target+'.'+randomUUID()+'.tmp',fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,data);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,target);},
  async get(key){const target=file(key);if(!existsSync(target))return null;if(lstatSync(target).isSymbolicLink())throw Error('Private object must not be a symlink');const data=readFileSync(target);return {async arrayBuffer(){return data;}};}
 };
}

function database(){
 if(existsSync(dbPath)&&(!lstatSync(dbPath).isFile()||lstatSync(dbPath).isSymbolicLink()))throw Error('QA database must be a regular file');
 const native=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);
 try{
  native.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS __preview_migrations (name TEXT PRIMARY KEY)');
  for(const file of readdirSync(resolve(siteRoot,'drizzle')).filter(name=>name.endsWith('.sql')).sort()){
   if(native.prepare('SELECT name FROM __preview_migrations WHERE name=?').get(file))continue;
   native.exec('BEGIN');try{native.exec(readFileSync(resolve(siteRoot,'drizzle',file),'utf8'));native.prepare('INSERT INTO __preview_migrations(name) VALUES (?)').run(file);native.exec('COMMIT');}catch(error){native.exec('ROLLBACK');throw error;}
  }
 }catch(error){native.close();throw error;}
 return {native,db:{prepare(sql){return {bind(...args){const statement=native.prepare(sql);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){statement.run(...args);return {success:true};}};}};}}};
}

/** Starts an isolated localhost QA preview; this function performs no model calls. */
export async function createPreview({fixture=false}={}){
 const unlock=lockDirectory(),previousUmask=process.umask(0o077);let native,server,compute;
 try{
  const researchRoot=researchDirectory(),frozenPath=resolve(researchRoot,'simbench/snapshots/public-generic-with-dates-20261029');
  const raw=readFileSync(resolve(frozenPath,'catalog.jsonl')),manifest=JSON.parse(readFileSync(resolve(frozenPath,'manifest.json'),'utf8'));
  const {createHash}=await import('node:crypto');const catalogHash=createHash('sha256').update(raw).digest('hex');if(catalogHash!==manifest.catalog_sha256)throw Error('QA frozen catalog hash mismatch');
  const catalog=raw.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));if(catalog.length<25)throw Error('QA preview needs at least 25 real frozen catalog cards');
  const sources=[...new Set(catalog.map(item=>item.source))].map(id=>({id,name:`${id} · QA frozen catalog`,modes:['search','explore'],modalities:[['bilibili','youtube'].includes(id)?'video':'text'],configured:true,allowed:true,status:'frozen_public_qa'}));
  const card=item=>({id:item.id,source:item.source,source_item_id:item.id,title:item.title,summary:item.text,topic:'',url:item.url,modality:['bilibili','youtube'].includes(item.source)?'video':'text',published_at:item.published_at,captured_at:item.captured_at,content_hash:hash(item),origin:'frozen_public_catalog'});
  const photography=item=>/摄影|相机|镜头|街拍|拍照|photograph|camera/i.test(item.title+' '+item.text);
  const seedCards=[...catalog.filter(photography),...catalog.filter(item=>!photography(item))].slice(0,25).map(card);
  let backend=null,model=null;
  if(fixture){
   const runner=async input=>({run_id:input.job_id,data_origin:input.data_origin,synthetic:true,input_snapshot:input.snapshot,environment:{data_origin:input.data_origin,mode:'synthetic_ui_fixture',method_execution:false,catalog_sha256:catalogHash},methods:['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'].map((method_id,index)=>{
    const items=seedCards.slice(index*5,index*5+5);return {method_id,status:'submitted',slate:items,content_snapshot:{id:randomUUID(),hash:hash(items),items},trace:[{phase:'synthetic_ui_fixture',method_execution:false,warning:'Real frozen cards assigned for UI testing; no method ran.'}],method_version:'synthetic-ui-fixture-no-method-executed',data_origin:input.data_origin,synthetic:true};
   })});
   model='synthetic_ui_fixture_no_model';runner.info={model,sources,methods:['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'],catalog_count:catalog.length,catalog_sha256:catalogHash,source_sha256:{preview:hash(readFileSync(fileURLToPath(import.meta.url)))}};
   const token=randomBytes(32).toString('base64url');compute=await createResearchService({dataDir:resolve(dataRoot,'fixture-compute'),token,runner});
   const call=async(path,input)=>{const response=await compute.handler(new Request(base+path,{method:input?'POST':'GET',headers:{Authorization:'Bearer '+token,...(input?{'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})}));if(!response.ok)throw Object.assign(Error('Fixture compute request failed'),{status:response.status});return response;};
   backend={async info(){return (await call('/v1/info')).json();},async start(input){return (await call('/v1/jobs',input)).json();},async poll(id){return (await call('/v1/jobs/'+id)).json();},async artifact(id){return call('/v1/jobs/'+id+'/artifact');}};
  }else if(process.env.RESEARCH_BACKEND_URL&&process.env.RESEARCH_BACKEND_TOKEN){
   backend=createRemoteResearchBackend({url:process.env.RESEARCH_BACKEND_URL,token:process.env.RESEARCH_BACKEND_TOKEN});try{model=(await backend.info()).model;}catch{}
  }
  const connection=database();native=connection.native;
  const env={DB:connection.db,RESEARCH_BACKEND:backend,RESEARCH_ARCHIVE:createPrivateObjectStore(),RESEARCH_STORAGE:'sqlite+files'};
  const username=`qa-preview-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
  const post=async(path,body,cookie)=>{const response=await handleApi(new Request(base+path,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)}),env);if(!response.ok)throw Error(`QA seed ${path} failed with HTTP ${response.status}`);return response;};
  const identity=await post('/api/identity',{username,type:'human'}),cookie=identity.headers.get('set-cookie').split(';')[0],user=(await identity.json()).user;
  const profile='虚构 QA 摄影用户：喜欢街头摄影、旅行构图和相机基础，希望查看具体拍摄方法。本账号和全部记录仅用于隔离预览，非真人研究数据。';
  const sessionInfo=await (await post('/api/session',{consent:true,recordKind:'synthetic',interests:['摄影','相机'],profile},cookie)).json();
  const sessionId=sessionInfo.session.session_id,store=new CloudStore(connection.db);await store.load(user.id);
  const snapshot=inputSnapshot(store,sessionId,'摄影 相机',{...user.settings,interests:sessionInfo.state.interests},sources,[],[]);
  const input=await store.record('input',sessionId,{track:'feed',input_snapshot:snapshot,synthetic:true,data_origin:'test_only'});
  const run=await store.record('run',sessionId,{track:'feed',synthetic:true,data_origin:'test_only',input_snapshot_id:input.id,result:{policy_id:'qa-public-content-seed',mode:'synthetic_seed',model:null,synthetic:true,data_origin:'test_only',input_snapshot:snapshot,state_after:store.state(sessionId),slate:seedCards,content_snapshot:{id:randomUUID(),hash:hash(seedCards),items:seedCards},trace:[{phase:'qa_seed',method_execution:false,synthetic:true,note:'Real frozen public cards seeded for isolated UI QA; no recommendation algorithm ran.'}]}});
  for(const [index,value] of ['like','save'].entries())await store.record('feedback',sessionId,{track:'feed',reference_id:run.id,content_id:seedCards[index].id,content_hash:seedCards[index].content_hash,title:seedCards[index].title,source:seedCards[index].source,topic:seedCards[index].topic,position:index+1,value,event_time:new Date().toISOString(),simulated:true,synthetic:true,data_origin:'test_only'});
  const publicRoot=realpathSync(resolve(siteRoot,'public'));
  const send=(res,status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(value);};
  server=createServer(async(req,res)=>{
   try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return send(res,403,JSON.stringify({error:'Local QA host required'}));
    const url=new URL(req.url,base);
    if(url.pathname==='/api/health')return send(res,req.method==='GET'?200:405,JSON.stringify({status:'ok',preview:true,data_origin:'test_only',mode:fixture?'fixture':'live',feed_mode:'rules'}));
    if(url.pathname.startsWith('/api/')){
     let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2097152)return send(res,413,JSON.stringify({error:'Request too large'}));chunks.push(chunk);}
     const body=chunks.length?Buffer.concat(chunks):undefined,request=new Request(base+url.pathname+url.search,{method:req.method,headers:req.headers,...(body?{body}:{})});
     const response=await handleApi(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if(!['GET','HEAD'].includes(req.method))return send(res,405,'Method not allowed','text/plain; charset=utf-8');
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return send(res,400,'Invalid path','text/plain; charset=utf-8');}
    if(pathname.includes('\0')||pathname.includes('\\'))return send(res,400,'Invalid path','text/plain; charset=utf-8');
    const candidate=resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));
    if(!candidate.startsWith(publicRoot+sep))return send(res,403,'Forbidden','text/plain; charset=utf-8');
    let file;try{file=realpathSync(candidate);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return send(res,404,'Not found','text/plain; charset=utf-8');throw error;}
    if(!file.startsWith(publicRoot+sep)||!lstatSync(file).isFile())return send(res,403,'Forbidden','text/plain; charset=utf-8');
    let content=readFileSync(file);if(extname(file)==='.html')content=Buffer.from(content.toString('utf8').replace('<body>','<body><aside role="note" style="position:fixed;bottom:76px;right:8px;z-index:9999;pointer-events:none;padding:6px 10px;border:1px solid #b8a24a;background:#fff8d6;color:#433a17;font:10px system-ui;max-width:180px">隔离 QA 预览 · 全部记录 test_only · '+(fixture?'合成 UI 输出，未执行真实方法':'云端参评系统需确认输入；普通发现为 rules')+'</aside>'));
    send(res,200,req.method==='HEAD'?'':content,mime[extname(file)]||'application/octet-stream');
   }catch{if(!res.headersSent)send(res,500,JSON.stringify({error:'Local QA preview request failed'}));else res.end();}
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);accept();});});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;try{await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));if(compute)await compute.close();native.close();}finally{unlock();process.umask(previousUmask);}};
  return {server,close,info:{port,username,db_path:dbPath,mode:fixture?'fixture':'live',model}};
 }catch(error){if(server?.listening)await new Promise(accept=>server.close(accept));if(compute)await compute.close();if(native)native.close();unlock();process.umask(previousUmask);throw error;}
}

async function selfCheck(){
 const preview=await createPreview({fixture:true});
 try{
  const response=await fetch(base+'/api/health');assert.equal(response.status,200);assert.equal((await response.json()).data_origin,'test_only');
  assert.match(await (await fetch(base+'/')).text(),/隔离 QA 预览/);
  assert.equal((await fetch(base+'/%2e%2e%2fqa-data/preview.sqlite')).status,403);
  await assert.rejects(()=>createPreview({fixture:true}),/already has a running preview/);
 }finally{await preview.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.includes('--self-test'))await selfCheck();
  else{
   if(process.argv.slice(2).some(arg=>arg!=='--fixture'))throw Error('Usage: node scripts/research-preview.mjs [--fixture|--self-test]');
   const preview=await createPreview({fixture:process.argv.includes('--fixture')});console.log(JSON.stringify(preview.info));
   const stop=()=>{preview.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
