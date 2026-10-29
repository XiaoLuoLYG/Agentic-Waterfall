import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {acquireSource} from '../lib/waterfall/sources.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const endpoint='https://agentic-waterfall-research.scofieldlyg.chatgpt.site/api/bilibili-relay/jobs';

export async function processJob(job,acquire=acquireSource){
  if(!job||typeof job.id!=='string'||job.id.length>100||typeof job.query!=='string'||!job.query.trim()||job.query.length>120||!Number.isInteger(job.page)||job.page<1||job.page>50)throw new Error('来源任务无效');
  const result=await acquire({source:'bilibili',query:job.query,mode:'search',modality:'video'},{providers:{},allowed:{},signal:AbortSignal.timeout(15000)},{page:job.page});
  return {id:job.id,failed:result.status==='failed',rows:result.items.slice(0,6).map(item=>({id:item.source_item_id,title:item.title,summary:item.summary,image:item.image_url,author:item.author,published:item.published_at,duration:item.duration}))};
}

async function main(){
  const token=readFileSync(resolve(root,'.sites-runtime/bilibili-relay-token'),'utf8').trim();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('中转密钥无效');
  const request=async(data)=>{const r=await fetch(endpoint,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`中转接口 HTTP ${r.status}`);return r.json()};
  console.log('B 站中转已启动');let lastError='';
  for(;;){
    try{const {jobs}=await request();if(!Array.isArray(jobs))throw new Error('中转任务格式无效');for(const job of jobs){let result;try{result=await processJob(job)}catch{result={id:job?.id,rows:[],failed:true}}await request(result)}lastError='';}
    catch(error){const message=String(error.message||'中转连接失败');if(message!==lastError){console.error(message);lastError=message}}
    await new Promise(resolve=>setTimeout(resolve,lastError?5000:4000));
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1});
