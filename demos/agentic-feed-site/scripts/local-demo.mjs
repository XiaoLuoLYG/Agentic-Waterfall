import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,chmodSync,lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {handleApi,modelConfig} from '../lib/waterfall/cloud-entry.mjs';
import {createRemoteResearchBackend} from '../lib/waterfall/research-backend.mjs';
import {createPrivateObjectStore} from './research-preview.mjs';
import {hash} from '../lib/waterfall/core.mjs';

const siteRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json; charset=utf-8'};
const csp="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function lockDirectory(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())throw Error('Local data directory must be a real directory');
 chmodSync(directory,0o700);
 // The same lock and filenames allow a stopped preview to reopen without moving its data.
 const path=resolve(directory,'preview.lock'),identity=JSON.stringify({pid:process.pid,nonce:randomUUID()});
 for(let attempt=0;attempt<2;attempt++){
  try{
   const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,identity);fsyncSync(fd);}finally{closeSync(fd);}
   return ()=>{try{if(readFileSync(path,'utf8')===identity)unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}};
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw Error('Local directory lock must be a regular file');
   const previous=readFileSync(path,'utf8');let owner;
   try{owner=JSON.parse(previous);}catch{throw Error('Local directory lock is unreadable; inspect it before restarting');}
   if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('Local directory lock has no valid owner');
   try{process.kill(owner.pid,0);throw Error('Local data directory already has a running process');}catch(check){if(check.code!=='ESRCH')throw check;}
   if(readFileSync(path,'utf8')!==previous)throw Error('Local directory lock changed during startup');unlinkSync(path);
  }
 }
 throw Error('Could not acquire local directory lock');
}

function database(path){
 let stat;try{stat=lstatSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw Error('Local database must be a regular file');
 const native=new DatabaseSync(path);chmodSync(path,0o600);
 try{
  native.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS __preview_migrations (name TEXT PRIMARY KEY)');
  for(const file of readdirSync(resolve(siteRoot,'drizzle')).filter(name=>name.endsWith('.sql')).sort()){
   if(native.prepare('SELECT name FROM __preview_migrations WHERE name=?').get(file))continue;
   native.exec('BEGIN');try{native.exec(readFileSync(resolve(siteRoot,'drizzle',file),'utf8'));native.prepare('INSERT INTO __preview_migrations(name) VALUES (?)').run(file);native.exec('COMMIT');}catch(error){native.exec('ROLLBACK');throw error;}
  }
 }catch(error){native.close();throw error;}
 return {native,db:{prepare(sql){return {bind(...args){const statement=native.prepare(sql);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){statement.run(...args);return {success:true};}};}};}}};
}

function configuration(file,override,key){
 if(!file)return null;
 let raw;
 try{const path=resolve(file);if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error();raw=JSON.parse(readFileSync(path,'utf8'));if(!raw||typeof raw!=='object'||Array.isArray(raw)||!modelConfig({...raw,apiKey:key||raw.apiKey},undefined,override))throw Error();}
 catch{throw Error('Local model/source configuration is unreadable or invalid');}
 return raw;
}

function closeServer(server){return new Promise((accept,reject)=>{if(!server?.listening)return accept();server.close(error=>error?reject(error):accept());server.closeIdleConnections();});}

/** Serves the production API and public files without making startup requests. */
export async function createLocalDemo({port=Number(process.env.LOCAL_DEMO_PORT||4196),dataDir=process.env.LOCAL_DEMO_DATA_DIR,configFile=process.env.MODEL_CONFIG_FILE,modelOverride=process.env.OPENAI_MODEL,modelKey=process.env.WATERFALL_API_KEY,backend=null,backendUrl=process.env.RESEARCH_BACKEND_URL,backendToken=process.env.RESEARCH_BACKEND_TOKEN}={}){
 assert(Number.isInteger(port)&&port>=0&&port<=65535,'Invalid LOCAL_DEMO_PORT');
 const raw=configuration(configFile,modelOverride,modelKey),sampleMode=raw===null;
 const dataRoot=resolve(dataDir||resolve(siteRoot,sampleMode?'.sites-runtime/local-demo-sample':'../local-demo-data')),dbPath=resolve(dataRoot,'preview.sqlite');
 const info={mode:sampleMode?'sample':'llm',model:sampleMode?null:modelOverride||raw.recommendationModelName||raw.modelName,storage:'sqlite+files'};
 if(!sampleMode&&!backend&&(backendUrl||backendToken))createRemoteResearchBackend({url:backendUrl,token:backendToken});
 const unlock=lockDirectory(dataRoot);let native,server;
 try{
  const connection=database(dbPath);native=connection.native;
  for(const row of native.prepare("SELECT payload FROM events WHERE kind='session'").iterate()){
   assert((JSON.parse(row.payload).demo_mode==='sample')===sampleMode,'Data directory contains sessions from a different demo mode. Use another LOCAL_DEMO_DATA_DIR.');
  }
  const objectDirectory=resolve(dataRoot,'artifacts'),objects=createPrivateObjectStore(objectDirectory);
  objects.head=async key=>{const path=resolve(objectDirectory,hash(String(key))+'.gz');if(!existsSync(path))return null;const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Private object must be a regular file');return {size:stat.size};};
  const env={DB:connection.db,WATERFALL_CONFIG:raw?JSON.stringify(raw):undefined,WATERFALL_API_KEY:modelKey,OPENAI_MODEL:modelOverride,RESEARCH_BACKEND:backend,RESEARCH_BACKEND_URL:backendUrl,RESEARCH_BACKEND_TOKEN:backendToken,RESEARCH_ARCHIVE:objects,DATASET_ARCHIVE:objects,RESEARCH_STORAGE:'sqlite+files',BILIBILI_RELAY_TOKEN:process.env.BILIBILI_RELAY_TOKEN};
  const publicRoot=realpathSync(resolve(siteRoot,'public'));
  const send=(res,status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':csp});res.end(value);};
  server=createServer(async(req,res)=>{
   try{
    const actualPort=server.address().port;
    if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(req.headers.host))return send(res,403,JSON.stringify({error:'Local host required'}));
    const base=`http://${req.headers.host}`;
    const url=new URL(req.url,base);
    if(url.pathname==='/api/health')return send(res,req.method==='GET'?200:405,JSON.stringify({status:'ok',...info}));
    if(url.pathname.startsWith('/api/')){
     let size=0;const chunks=[];
     for await(const chunk of req){size+=chunk.length;if(size>2097152)return send(res,413,JSON.stringify({error:'Request too large'}));chunks.push(chunk);}
     const body=chunks.length?Buffer.concat(chunks):undefined;
     const request=new Request(base+url.pathname+url.search,{method:req.method,headers:req.headers,...(body?{body}:{})});
     const response=await handleApi(request,env,{sampleMode});res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if(!['GET','HEAD'].includes(req.method))return send(res,405,'Method not allowed','text/plain; charset=utf-8');
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return send(res,400,'Invalid path','text/plain; charset=utf-8');}
    if(pathname.includes('\0')||pathname.includes('\\'))return send(res,400,'Invalid path','text/plain; charset=utf-8');
    const candidate=resolve(publicRoot,'.'+(pathname==='/'?'/index.html':pathname));
    if(!candidate.startsWith(publicRoot+sep))return send(res,403,'Forbidden','text/plain; charset=utf-8');
    let file;try{file=realpathSync(candidate);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return send(res,404,'Not found','text/plain; charset=utf-8');throw error;}
    if(!file.startsWith(publicRoot+sep)||!lstatSync(file).isFile())return send(res,403,'Forbidden','text/plain; charset=utf-8');
    send(res,200,req.method==='HEAD'?'':readFileSync(file),mime[extname(file)]||'application/octet-stream');
   }catch{if(!res.headersSent)send(res,500,JSON.stringify({error:'Local demo request failed'}));else res.end();}
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);accept();});});
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;try{await closeServer(server);native.close();}finally{unlock();}};
  return {server,close,info:{port:server.address().port,db_path:dbPath,...info}};
 }catch(error){try{await closeServer(server);native?.close();}finally{unlock();}throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.length>2)throw Error('Usage: node scripts/local-demo.mjs (configure with LOCAL_DEMO_PORT, LOCAL_DEMO_DATA_DIR and MODEL_CONFIG_FILE)');
  const demo=await createLocalDemo();console.log(JSON.stringify({url:`http://127.0.0.1:${demo.info.port}`,...demo.info}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>demo.close().catch(()=>{process.exitCode=1;}));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
