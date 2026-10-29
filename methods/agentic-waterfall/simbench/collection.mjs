import {createHash} from 'node:crypto';
export function makePlan(topics){
 if(!Array.isArray(topics)||!topics.length||topics.length>75||topics.some(x=>typeof x!=='string'||!x.trim()||x.length>120)||new Set(topics).size!==topics.length)throw Error('invalid fixed topics');
 return topics.flatMap(query=>[{source:'bilibili',query,page:1},{source:'bilibili',query,page:2},{source:'zhihu',query,page:1},{source:'youtube',query,page:1}]);
}
export function normalizeRecord(source,item){
 if(!['bilibili','zhihu','youtube'].includes(source)||typeof item?.title!=='string'||!item.title.trim()||typeof item?.url!=='string')throw Error('invalid content');
 let u;try{u=new URL(item.url);}catch{throw Error('invalid url');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)||u.hostname.endsWith('.local'))throw Error('invalid url');
 u.hash='';const url=u.href,id=source+':'+createHash('sha256').update(url).digest('hex');
 return {id,source,title:item.title.trim().slice(0,1000),text:String(item.summary||'').trim().slice(0,8000),url,published_at:typeof item.published_at==='string'?item.published_at:'',captured_at:typeof item.captured_at==='string'?item.captured_at:''};
}
