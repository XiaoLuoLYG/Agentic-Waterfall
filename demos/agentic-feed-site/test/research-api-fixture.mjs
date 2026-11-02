import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {handleApi} from '../lib/waterfall/cloud-entry.mjs';
const methods=['waterfall','clawrec','i2agent','generic-agent','fixed-retrieval'];
export function fixture({makeResult}={}){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
 const DB={prepare(query){return {bind(...args){const statement=sql.prepare(query);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){statement.run(...args);return {success:true};}};}};}};
 const objects=new Map(),jobs=new Map();let starts=0,failPut=false;
 const env={DB,RESEARCH_ARCHIVE:{async put(key,bytes){if(failPut)throw Error('storage offline');objects.set(key,Buffer.from(bytes));},async get(key){const bytes=objects.get(key);return bytes?{async arrayBuffer(){return bytes;}}:null;}},RESEARCH_BACKEND:{
  async info(){return {ready:true,methods,model:'offline-model',catalog_sha256:'catalog-sha',catalog_count:25,source_sha256:{core:'version'},sources:[{id:'zhihu',modes:['search','explore'],modalities:['text']}]};},
  async start(input){if(!jobs.has(input.job_id)){starts++;const result=makeResult?await makeResult({snapshot:input.snapshot,history:input.history,session:{session_id:input.session_id},userId:input.user_id}):{input_snapshot:input.snapshot,methods:methods.map((method_id,index)=>({method_id,status:'submitted',method_version:'v1',slate:Array.from({length:5},(_,i)=>({id:method_id+i,title:'Real public title',source:'zhihu',url:`https://example.test/${index}/${i}`})),trace:[{private:'LARGE_PRIVATE_TRACE'.repeat(1000)}]}))},bytes=gzipSync(JSON.stringify(result));jobs.set(input.job_id,{...input,status:'running',summary:{run_id:input.job_id,methods:result.methods.map(({trace,...method})=>method),environment:{catalog_count:25}},artifact:{encoding:'gzip',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length},bytes});}return this.poll(input.job_id);},
  async poll(id){const {bytes,snapshot,history,...job}=jobs.get(id);return job;},async artifact(id){return new Response(jobs.get(id).bytes,{headers:{'Content-Type':'application/gzip'}});}
 }};
 return {env,jobs,objects,get starts(){return starts;},set failPut(value){failPut=value;}};
}
export async function account(env,name,recordKind='human'){const identity=await handleApi(new Request('https://app.test/api/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,type:'human'})}),env),cookie=identity.headers.get('set-cookie').split(';')[0];const raw=(path,data)=>handleApi(new Request('https://app.test'+path,{headers:{cookie,'Content-Type':'application/json'},...(data?{method:'POST',body:JSON.stringify(data)}:{})}),env);const api=async(path,data)=>{const response=await raw(path,data);return {status:response.status,body:await response.json()};};const created=await api('/api/session',{consent:true,recordKind,interests:['摄影'],profile:'明确提供的摄影画像'});return {api,raw,sid:created.body.session.session_id,user:created.body.session.user_id,session:created.body.session};}

