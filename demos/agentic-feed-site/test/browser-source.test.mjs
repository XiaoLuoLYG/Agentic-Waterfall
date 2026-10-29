import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {requestBrowserSource, pendingBrowserSources, completeBrowserSource, pendingRelaySources, completeRelaySource} from '../lib/waterfall/browser-source.mjs';
import {acquireSource} from '../lib/waterfall/sources.mjs';
import {fetchApplePodcasts} from '../public/browser-source.js';

function database(){const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(`drizzle/${f}`,'utf8'));db.prepare('INSERT INTO accounts (id,username,type,settings,created_at) VALUES (?,?,?,?,?)').run('user-a','a','human','{}','now');db.prepare('INSERT INTO accounts (id,username,type,settings,created_at) VALUES (?,?,?,?,?)').run('user-b','b','human','{}','now');return {prepare(sql){return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){s.run(...args);return {success:true}}}}}}}}

test('browser source returns only the requesting user’s verified Apple links',async()=>{
 const db=database();const pending=requestBrowserSource(db,'user-a','session-a',{source:'applepodcasts',query:'nature'},undefined,{pollMs:5,timeoutMs:1000});
 await new Promise(resolve=>setTimeout(resolve,10));const jobs=await pendingBrowserSources(db,'user-a','session-a');assert.equal(jobs.length,1);assert.deepEqual(await pendingBrowserSources(db,'user-b','session-a'),[]);
 const rows=[{collectionId:123,collectionName:'Nature',collectionViewUrl:'https://podcasts.apple.com/us/podcast/nature/id123',artworkUrl600:'https://is1-ssl.mzstatic.com/image.jpg',artistName:'Author',genres:['Science'],trackCount:4}];
 await assert.rejects(()=>completeBrowserSource(db,'user-b','session-a',jobs[0].id,rows),/不存在/);
 await completeBrowserSource(db,'user-a','session-a',jobs[0].id,rows);const output=await pending;assert.equal(output.results[0].collectionId,123);assert.equal((await pendingBrowserSources(db,'user-a','session-a')).length,0);
});
test('browser source rejects forged links and removes interrupted jobs',async()=>{
 const db=database(),controller=new AbortController();const pending=requestBrowserSource(db,'user-a','session-a',{source:'applepodcasts',query:'science'},controller.signal,{pollMs:5,timeoutMs:1000});
 await new Promise(resolve=>setTimeout(resolve,10));const [job]=await pendingBrowserSources(db,'user-a','session-a');
 await assert.rejects(()=>completeBrowserSource(db,'user-a','session-a',job.id,[{collectionId:1,collectionName:'Bad',collectionViewUrl:'https://evil.example/id1'}]),/链接/);
 controller.abort();await assert.rejects(pending,/取消/);assert.equal((await pendingBrowserSources(db,'user-a','session-a')).length,0);
});
test('Apple rate limiting falls back to the browser and returns real normalized content',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>new Response('',{status:429});let calls=0;
 const config={providers:{},allowed:{},browserAcquire:async action=>{calls++;assert.equal(action.query,'nature');return {results:[{collectionId:123,collectionName:'Nature',collectionViewUrl:'https://podcasts.apple.com/us/podcast/nature/id123'}]}}};
 const result=await acquireSource({source:'applepodcasts',query:'nature',mode:'search',modality:'text'},config);assert.equal(result.status,'ok');assert.equal(calls,1);assert.equal(result.items[0].source,'applepodcasts');assert.equal(result.items[0].source_item_id,'123');
});
test('browser queries Apple with the requested term and sends only bounded podcast fields',async()=>{
 let address;const rows=await fetchApplePodcasts('自然',async url=>{address=new URL(url);return Response.json({results:[{collectionId:123,collectionName:'Nature',collectionViewUrl:'https://podcasts.apple.com/us/podcast/nature/id123',unrelated_private:'omit'}]})});
 assert.equal(address.hostname,'itunes.apple.com');assert.equal(address.searchParams.get('term'),'自然');assert.equal(address.searchParams.get('country'),'CN');assert.equal(rows[0].collectionName,'Nature');assert.equal('unrelated_private' in rows[0],false);
});
test('Bilibili 412 uses the authorized local relay and returns original video content',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});globalThis.fetch=async()=>new Response('',{status:412});let used=0;
 const config={providers:{},allowed:{},bilibiliRelay:true,browserAcquire:async action=>{used++;assert.equal(action.query,'自然');assert.equal(action.page,3);return {results:[{id:'BV1xx411c7mD',title:'自然',summary:'简介',author:'作者'}]}}};
 const result=await acquireSource({source:'bilibili',query:'自然',mode:'search',modality:'video'},config,{page:3});assert.equal(result.status,'ok');assert.equal(used,1);assert.equal(result.items[0].url,'https://www.bilibili.com/video/BV1xx411c7mD');
});
test('Bilibili without an available relay returns the original failure',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:412})};
 const result=await acquireSource({source:'bilibili',query:'自然',mode:'search',modality:'video'},{providers:{},allowed:{}});assert.equal(result.status,'failed');assert.equal(result.error,'http_412');assert.equal(calls,1);assert.deepEqual(result.items,[]);
});
test('Bilibili relay jobs preserve page and return bounded genuine video fields',async()=>{
 const db=database();await pendingRelaySources(db);const pending=requestBrowserSource(db,'user-a','session-a',{source:'bilibili',query:'自然',page:4},undefined,{pollMs:5,timeoutMs:1000});await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(await pendingBrowserSources(db,'user-a','session-a'),[]);const jobs=await pendingRelaySources(db);assert.equal(jobs.length,1);assert.equal(jobs[0].query,'自然');assert.equal(jobs[0].page,4);
 await assert.rejects(()=>completeRelaySource(db,jobs[0].id,[{id:'evil',title:'x'}]),/内容/);
 await completeRelaySource(db,jobs[0].id,[{id:'BV1xx411c7mD',title:'自然',summary:'简介',image:'https://i0.hdslb.com/a.jpg',extra:'drop'}]);const result=await pending;assert.equal(result.results[0].id,'BV1xx411c7mD');assert(!('extra'in result.results[0]));assert.deepEqual(await pendingRelaySources(db),[]);
});
test('Bilibili relay does not delay the feed when the Mac relay is offline',async()=>{
 const db=database();await assert.rejects(()=>requestBrowserSource(db,'user-a','session-a',{source:'bilibili',query:'自然',page:1},undefined,{pollMs:5,timeoutMs:1000}),/中转不可用/);
});
test('Bilibili relay can return more than six genuine videos',async()=>{
 const db=database();await pendingRelaySources(db);const pending=requestBrowserSource(db,'user-a','session-a',{source:'bilibili',query:'自然',page:1},undefined,{pollMs:5,timeoutMs:1000});await new Promise(resolve=>setTimeout(resolve,10));const [job]=await pendingRelaySources(db);
 const rows=Array.from({length:12},(_,i)=>({id:`BV${String(i).padStart(10,'0')}`,title:`video ${i}`}));await completeRelaySource(db,job.id,rows);assert.equal((await pending).results.length,12);
});
