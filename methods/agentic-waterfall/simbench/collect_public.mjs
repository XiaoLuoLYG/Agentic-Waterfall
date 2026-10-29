import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {loadSourceConfig,acquireSource} from '../../../demos/agentic-feed-site/lib/waterfall/sources.mjs';import {makePlan,normalizeRecord} from './collection.mjs';
const root=dirname(fileURLToPath(import.meta.url));const run=process.argv[2];if(!run||!/^[a-z0-9-]+$/.test(run))throw Error('run id required');
const control=JSON.parse(readFileSync(resolve(root,'../model-control/simbench-collection.json'),'utf8'));if(!control.allowed||control.max_queries<1||control.max_records<1)throw Error('collection not authorized');
const topics=['摄影入门技巧','视频剪辑基础','数码电脑选购','手机拍照技巧','旅行攻略','日常健身入门','跑步训练计划','家常菜做法','烘焙入门','亲子陪伴','儿童教育方法','学习英语技巧','职业发展规划','办公软件教程','心理健康调节','睡眠改善方法','家庭收纳整理','家居生活建议','养老护理知识','电影观影推荐','音乐欣赏入门','阅读书单推荐','宠物养护知识','公共交通出行','自然风景摄影','科学知识入门','历史文化介绍','理财基础知识'];
const plan=makePlan(topics);if(plan.length>control.max_queries)throw Error('query limit exceeded');
const out=resolve(root,'collections',run);mkdirSync(out,{recursive:false});mkdirSync(resolve(out,'queries'));const hash=x=>createHash('sha256').update(x).digest('hex');const save=(p,x)=>writeFileSync(resolve(out,p),JSON.stringify(x,null,2)+'\n',{flag:'wx'});
save('plan.json',{schema:'simbench-public-snapshot-collection-v1',basis:'fixed generic topics, not derived from hidden test targets',topics,plan,planned_queries:plan.length,max_records:control.max_records,source_snapshot:'public search result title/summary/url',xiaohongshu:'not available in current configured search provider',prepared_at:new Date().toISOString()});
const config=loadSourceConfig(resolve(root,'../../../HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json'));const documents=new Map();const stats={ok:0,empty:0,failed:0,rejected_items:0};let index=0;
for(const q of plan){
 const n=String(++index).padStart(3,'0');const r=await acquireSource({source:q.source,mode:'search',query:q.query,modality:q.source==='zhihu'?'text':'video'},config,{limit:10,page:q.page});
 const safe={source:q.source,query:q.query,page:q.page,status:r.status,error:r.error||null,completed_at:r.completed_at,items:r.items||[]};save(`queries/${n}.json`,safe);stats[r.status]=(stats[r.status]||0)+1;
 for(const item of safe.items){try{const doc=normalizeRecord(q.source,item);if(!documents.has(doc.id)&&documents.size<control.max_records)documents.set(doc.id,doc);}catch{stats.rejected_items++;}}
 if(index%10===0)console.log(JSON.stringify({completed:index,planned:plan.length,records:documents.size,stats}));
 await delay(250);
}
const raw=[...documents.values()].map(x=>JSON.stringify(x)).join('\n')+'\n';writeFileSync(resolve(out,'public-records.jsonl'),raw,{flag:'wx'});save('collection-summary.json',{planned:plan.length,completed:index,records:documents.size,stats,raw_sha256:hash(raw),finished_at:new Date().toISOString(),note:'Only public source search results; no test targets or user-private content. Source availability, temporal validity and coverage must be audited before formal comparison.'});
console.log(JSON.stringify({status:'collected',queries:index,records:documents.size,stats}));
