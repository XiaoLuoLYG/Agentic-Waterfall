import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {normalizeContent} from './dataset-format.mjs';
import {check} from './core.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const latest=(store,sessionId)=>{
 const captures=new Map();
 for(const row of store.rows)if(row.session_id===sessionId&&['dataset_capture','dataset_archive'].includes(row.kind))captures.set(row.capture_id,row);
 return [...captures.values()];
};
const safeRequest=request=>Object.fromEntries(['source','mode','query','modality','page','limit'].filter(key=>request?.[key]!==undefined).map(key=>[key,request[key]]));
const observationKeys=['captured_at','views','view_count','score'];
const observations=item=>Object.fromEntries(observationKeys.filter(key=>item[key]!==undefined).map(key=>[key,item[key]]));

async function pendingCapture(store,row){
 if(Array.isArray(row.capture?.results))return row.capture;
 if(row.fallback_chunk_ids){
  const found=await store.db.prepare("SELECT id,payload FROM events WHERE user_id=? AND session_id=? AND kind='dataset_capture_chunk' AND id IN (SELECT value FROM json_each(?))").bind(store.userId,row.session_id,JSON.stringify(row.fallback_chunk_ids)).all();
  const chunks=new Map(found.results.map(chunk=>[chunk.id,JSON.parse(chunk.payload).text]));
  check(row.fallback_chunk_ids.every(id=>chunks.has(id)),'待重试的来源记录不完整，请保留记录并联系维护者',503);
  return JSON.parse(row.fallback_chunk_ids.map(id=>chunks.get(id)).join(''));
 }
 const source=await store.db.prepare('SELECT payload FROM events WHERE user_id=? AND session_id=? AND id=?').bind(store.userId,row.session_id,row.id).first();
 check(source,'待重试的来源记录不存在',503);const record=JSON.parse(source.payload);check(Array.isArray(record.capture?.results)||record.fallback_chunk_ids,'待重试的来源记录不完整',503);return pendingCapture(store,{...record,session_id:row.session_id});
}

async function putJson(bucket,key,value){
 const body=JSON.stringify(value),bytes=gzipSync(body),existing=await bucket.head(key);
 if(!existing)await bucket.put(key,bytes,{httpMetadata:{contentType:'application/gzip'},customMetadata:{sha256:sha(body)}});
 return {key,sha256:sha(body),byte_size:existing?.size??bytes.length,encoding:'gzip',availability:'private_archive'};
}
async function archive(store,bucket,sessionId,capture){
 try{
  if(!bucket)throw Error('archive_unconfigured');
  const prefix=`dataset/${store.userId}`,results=[],unique=new Map();
  // Bound storage requests without changing source order or recommendation inputs.
  for(let start=0;start<capture.results.length;start+=10){
   const group=await Promise.all(capture.results.slice(start,start+10).map(async item=>{
    const {original_item_id,...content}=item;for(const key of observationKeys)delete content[key];
    const body=JSON.stringify(content),key=`${prefix}/contents/${sha(body)}.json.gz`;
    let pending=unique.get(key);if(!pending){pending=putJson(bucket,key,content);unique.set(key,pending);}
    return {...await pending,content_id:content.content_id,content_version_id:content.content_version_id,original_item_id:original_item_id??null,...observations(item)};
   }));
   results.push(...group);
  }
  const artifact=await putJson(bucket,`${prefix}/captures/${capture.capture_id}.json.gz`,{...capture,results});
  return await store.record('dataset_archive',sessionId,{capture_id:capture.capture_id,archive_status:'ready',returned_count:results.length,artifact,content_refs:[...new Map(results.map(ref=>[ref.key,ref])).values()]});
 }catch{
  // The source survives R2 failures; a later retry appends a receipt to this event.
  const body=JSON.stringify(capture),fallback_chunk_ids=[];
  // D1 rows are bounded even when a provider returns a large lightweight catalog.
  if(Buffer.byteLength(body)>500000)for(let start=0;start<body.length;start+=100000)fallback_chunk_ids.push((await store.record('dataset_capture_chunk',sessionId,{capture_id:capture.capture_id,text:body.slice(start,start+100000)})).id);
  return await store.record('dataset_archive',sessionId,{capture_id:capture.capture_id,archive_status:'pending',returned_count:capture.results.length,content_refs:capture.results.map(({content_id,content_version_id})=>({content_id,content_version_id})),error:bucket?'archive_write_failed':'archive_unconfigured',...(fallback_chunk_ids.length?{fallback_chunk_ids}:{capture})});
 }
}

export async function captureDataset(store,bucket,sessionId,raw){
 // shortcut: new acquisitions retry one pending capture; explicit retry drains an outage backlog.
 const pending=latest(store,sessionId).find(row=>row.archive_status==='pending');
 if(bucket&&pending)try{await archive(store,bucket,sessionId,await pendingCapture(store,pending));}catch{console.error('dataset_archive_retry_failed');}
 const capture_id=randomUUID(),results=(raw.results||[]).map(item=>({...normalizeContent(item),original_item_id:item.original_item_id??item.id??null,...observations(item)}));
 const intent=await store.record('dataset_capture',sessionId,{capture_id,archive_status:'writing',returned_count:results.length,source:raw.source,input_snapshot_id:raw.input_snapshot_id??null,request:safeRequest(raw.request),request_started_at:raw.started_at??null,capture_status:raw.status??'unknown'});
 const capture={capture_id,run_id:raw.run_id??null,input_snapshot_id:raw.input_snapshot_id??null,source:raw.source,request:safeRequest(raw.request),results,projection:'source_adapter_public_fields_not_raw_http',started_at:raw.started_at??null,completed_at:raw.completed_at??null,status:raw.status??'unknown',...(raw.error?{error:raw.error}:{}),source_record_id:intent.id};
 return archive(store,bucket,sessionId,capture);
}
export async function retryDatasetArchives(store,bucket,sessionId){
 for(const row of latest(store,sessionId))if(row.archive_status==='pending'){
  const capture=await pendingCapture(store,row);
  if(capture)await archive(store,bucket,sessionId,capture);
 }
 return datasetStatus(store,bucket,sessionId);
}

export function datasetStatus(store,bucket,sessionId,{storage='cloud-d1+r2'}={}){
 const rows=latest(store,sessionId),ready=rows.filter(row=>row.archive_status==='ready'),pending=rows.filter(row=>row.archive_status==='pending'),incomplete=rows.filter(row=>row.archive_status==='writing');
 const contents=new Map(ready.flatMap(row=>row.content_refs||[]).map(ref=>[ref.content_version_id,ref]));
 for(const row of pending)for(const item of row.content_refs||row.capture?.results||[])if(!contents.has(item.content_version_id))contents.set(item.content_version_id,item);
 const files=new Map(ready.flatMap(row=>[row.artifact,...row.content_refs||[]]).filter(Boolean).map(ref=>[ref.key,ref]));
 return {persistence:'server_automatic',storage,local_copy:'browser_download_required',archive_binding:'DATASET_ARCHIVE',archive_configured:!!bucket,archive_ready:!!bucket&&!pending.length&&!incomplete.length,captures:{total:rows.length,ready:ready.length,pending:pending.length,incomplete:incomplete.length},returned_items:rows.reduce((n,row)=>n+(row.returned_count||0),0),contents:contents.size,archive_bytes:[...files.values()].reduce((n,ref)=>n+(ref.byte_size||0),0),history_scope:'online_captures_since_dataset_integration'};
}

async function getJson(bucket,ref,userId){
 check(bucket&&ref?.key?.startsWith(`dataset/${userId}/`),'内容归档未配置或不属于当前账号',503);
 const object=await bucket.get(ref.key);check(object,'内容归档暂不可读取，请稍后重试',503);
 let body;try{body=gunzipSync(new Uint8Array(await object.arrayBuffer())).toString('utf8');}catch{check(false,'内容归档损坏，请保留记录并联系维护者',503);}
 check(sha(body)===ref.sha256,'内容归档校验失败，请保留记录并联系维护者',503);
 return JSON.parse(body);
}
export async function readDatasetCaptures(store,bucket,sessionId){
 const captures=[],cache=new Map();
 const resolveRun=capture=>{const run=store.rows.findLast(event=>event.session_id===sessionId&&(event.kind==='run'&&event.result?.input_snapshot?.id===capture.input_snapshot_id&&!event.result?.partial||event.kind==='failure'&&event.input_snapshot_id===capture.input_snapshot_id));return {...capture,run_id:capture.run_id??run?.id??null};};
 for(const row of latest(store,sessionId)){
  if(row.archive_status==='pending'){captures.push({...resolveRun(await pendingCapture(store,row)),archive_status:'pending'});continue;}
  if(row.archive_status!=='ready'){captures.push({capture_id:row.capture_id,source:row.source,results:[],status:'interrupted_capture',source_record_id:row.id,archive_status:'incomplete',returned_count:row.returned_count});continue;}
  const capture=await getJson(bucket,row.artifact,store.userId),results=[];
  for(const ref of capture.results){if(!cache.has(ref.key))cache.set(ref.key,getJson(bucket,ref,store.userId));results.push({...await cache.get(ref.key),original_item_id:ref.original_item_id,...observations(ref)});}
  captures.push({...resolveRun(capture),results,archive_status:'ready'});
 }
 return captures;
}
export function datasetArtifactRefs(store,sessionId){
 return latest(store,sessionId).map(row=>row.archive_status==='ready'?{...row.artifact,kind:'online_capture',capture_id:row.capture_id}:{kind:'online_capture',capture_id:row.capture_id,availability:row.archive_status==='pending'?'pending_retry':'incomplete',returned_count:row.returned_count});
}
