import {randomUUID} from 'node:crypto';
import {check} from './core.mjs';

const delay=(ms,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new Error('来源请求已取消'));
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},ms);
  function abort(){clearTimeout(timer);reject(new Error('来源请求已取消'))}
  signal?.addEventListener('abort',abort,{once:true});
});

export async function requestBrowserSource(db,userId,sessionId,action,signal,{pollMs=1000,timeoutMs=20000}={}){
  check(['applepodcasts','bilibili'].includes(action.source) && typeof action.query==='string' && action.query.length<=120 && (action.source!=='bilibili'||Number.isInteger(action.page)&&action.page>=1&&action.page<=50),'来源请求无效');
  if(action.source==='bilibili'){const status=await db.prepare("SELECT updated_at FROM relay_status WHERE name='bilibili'").bind().first();check(status && Date.now()-status.updated_at<20000,'B 站中转不可用',502);}
  const id=randomUUID(),expires=Date.now()+timeoutMs;
  await db.prepare('DELETE FROM source_jobs WHERE expires_at<?').bind(Date.now()).run();
  const query=action.source==='bilibili'?JSON.stringify({query:action.query,page:action.page}):action.query;
  await db.prepare('INSERT INTO source_jobs (id,user_id,session_id,source,query,expires_at) VALUES (?,?,?,?,?,?)').bind(id,userId,sessionId,action.source,query,expires).run();
  try{
    while(Date.now()<expires){
      if(signal?.aborted)throw new Error('来源请求已取消');
      const row=await db.prepare('SELECT result FROM source_jobs WHERE id=? AND user_id=?').bind(id,userId).first();
      if(row?.result){const result=JSON.parse(row.result);check(!result.error,'来源暂时无法获取内容',502);return {results:result.results};}
      await delay(Math.min(pollMs,Math.max(0,expires-Date.now())),signal);
    }
    check(false,'来源请求超时',502);
  }finally{await db.prepare('DELETE FROM source_jobs WHERE id=? AND user_id=?').bind(id,userId).run();}
}

export async function pendingBrowserSources(db,userId,sessionId){
  return (await db.prepare("SELECT id,source,query FROM source_jobs WHERE user_id=? AND session_id=? AND source='applepodcasts' AND expires_at>? AND result IS NULL ORDER BY expires_at").bind(userId,sessionId,Date.now()).all()).results;
}

export async function pendingRelaySources(db){
  const now=Date.now();await db.prepare("INSERT INTO relay_status (name,updated_at) VALUES ('bilibili',?) ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at WHERE relay_status.updated_at<?").bind(now,now-10000).run();
  const rows=(await db.prepare("SELECT id,query FROM source_jobs WHERE source='bilibili' AND expires_at>? AND result IS NULL ORDER BY expires_at LIMIT 10").bind(Date.now()).all()).results;
  return rows.map(row=>({id:row.id,...JSON.parse(row.query)}));
}

export async function completeRelaySource(db,id,rows,failed=false){
  check(typeof id==='string' && typeof failed==='boolean' && Array.isArray(rows) && rows.length<=50,'来源结果格式无效');
  const job=await db.prepare("SELECT id FROM source_jobs WHERE id=? AND source='bilibili' AND expires_at>? AND result IS NULL").bind(id,Date.now()).first();check(job,'来源任务不存在',404);
  const results=rows.map(row=>{
    check(row && typeof row.id==='string' && /^BV[A-Za-z0-9]{10}$/.test(row.id) && typeof row.title==='string' && row.title.length>0 && row.title.length<=300,'来源内容格式无效');
    let image='';try{const u=new URL(row.image);if(u.protocol==='https:' && (u.hostname.endsWith('.hdslb.com')||u.hostname.endsWith('.bilibili.com')) && !u.username && !u.password && !u.port)image=u.href}catch{}
    return {id:row.id,title:row.title,summary:String(row.summary||'').slice(0,1600),author:String(row.author||'').slice(0,160),published:String(row.published||'').slice(0,80),duration:String(row.duration||'').slice(0,40),image};
  });
  await db.prepare("UPDATE source_jobs SET result=? WHERE id=? AND source='bilibili' AND result IS NULL").bind(JSON.stringify(failed?{error:true}:{results}),id).run();
}

export async function completeBrowserSource(db,userId,sessionId,id,rows,failed=false){
  check(typeof id==='string' && typeof failed==='boolean' && Array.isArray(rows) && rows.length<=200,'来源结果格式无效');
  const job=await db.prepare('SELECT source FROM source_jobs WHERE id=? AND user_id=? AND session_id=? AND expires_at>? AND result IS NULL').bind(id,userId,sessionId,Date.now()).first();
  check(job && job.source==='applepodcasts','来源任务不存在',404);
  const results=rows.map(row=>{
    check(row && Number.isSafeInteger(row.collectionId) && row.collectionId>0 && typeof row.collectionName==='string' && row.collectionName.length<=300,'来源内容格式无效');
    let link;try{link=new URL(row.collectionViewUrl)}catch{check(false,'来源链接无效')}
    check(link.protocol==='https:' && ['podcasts.apple.com','itunes.apple.com'].includes(link.hostname) && !link.username && !link.password && !link.port && new RegExp(`(?:^|/)id${row.collectionId}(?:/|$)`).test(link.pathname),'来源链接无效');
    let artwork='';try{const image=new URL(row.artworkUrl600);if(image.protocol==='https:' && image.hostname.endsWith('.mzstatic.com') && !image.username && !image.password && !image.port)artwork=image.href}catch{}
    return {collectionId:row.collectionId,collectionName:row.collectionName,collectionViewUrl:link.href,artworkUrl600:artwork,artistName:String(row.artistName||'').slice(0,160),genres:Array.isArray(row.genres)?row.genres.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,40)):[],trackCount:Number.isFinite(row.trackCount)?Math.max(0,row.trackCount):0,releaseDate:typeof row.releaseDate==='string'?row.releaseDate.slice(0,80):''};
  });
  await db.prepare('UPDATE source_jobs SET result=? WHERE id=? AND user_id=? AND session_id=? AND result IS NULL').bind(JSON.stringify(failed?{error:true}:{results}),id,userId,sessionId).run();
}
