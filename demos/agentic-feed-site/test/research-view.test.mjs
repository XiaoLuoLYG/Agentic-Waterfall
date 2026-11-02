import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchView,createResearchDataView} from '../public/research-view.js';

function deferred(){
 let resolve;
 const promise=new Promise(accept=>{resolve=accept;});
 return {promise,resolve};
}

function dom(t){
 const elements=new Map(),frames=new Set(),timers=new Map();let timerId=0;
 const element=()=>({
  innerHTML:'',textContent:'',hidden:false,disabled:false,handlers:{},
  addEventListener(type,handler){this.handlers[type]=handler;},
  querySelector(selector){return get(selector);},querySelectorAll(){return [];},
  getClientRects(){return [{}];},
  getBoundingClientRect(){return {top:0,bottom:100,left:0,right:300,width:300,height:100};}
 });
 const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const replacements={
  document:{querySelector:get,visibilityState:'visible',hasFocus:()=>true,addEventListener(){}},
  window:{innerHeight:800,innerWidth:1200,addEventListener(){}},
  IntersectionObserver:class{observe(){}unobserve(){}disconnect(){}},
  requestAnimationFrame:callback=>{const frame=setImmediate(()=>{frames.delete(frame);callback(performance.now());});frames.add(frame);return frame;},
  cancelAnimationFrame:frame=>{clearImmediate(frame);frames.delete(frame);},
  setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id;},
  clearTimeout:id=>timers.delete(id)
 };
 const previous=new Map(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 t.after(()=>{
  for(const frame of frames)clearImmediate(frame);
  for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 });
 get.timers=timers;get.runTimer=async()=>{const [id,callback]=timers.entries().next().value;timers.delete(id);await callback();};return get;
}

function rating(id,title){
 return {id,mode:'rating',items:[{id:id+'-question',item:{id:id+'-item',title},answered:false}],pairs:[],completed:0,total:1};
}

function preparation(mode='rating',ready=true){
 return {id:'prepared-input',mode,captured_at:'2026-10-31T02:00:00Z',context_hash:'input-hash',public_input:{provided_profile:{interests:['摄影','足球']},evidence:[{type:'command',text:'也想了解天文'}]},methods:['waterfall','clawrec','i2agent','general','fixed'],sources:['冻结内容库'],backend_ready:ready};
}

test('preparing shows the shared input and requires confirmation before starting',async t=>{
 const get=dom(t),requests=[];
 const view=createResearchView({getSession:()=>({session_id:'account-A'}),notice:()=>{},onPreparing:()=>{},api:async(path,data)=>{
  requests.push({path,data});
  if(path==='/api/research/prepare')return {preparation:preparation()};
  if(path==='/api/research/start')return {study:rating('new','CONFIRMED CARD')};
  return {study:null,full_comparison_available:true};
 }});
 await view.enter('rating');
 await get('#researchStart').handlers.click();
 assert.equal(requests.at(-1).path,'/api/research/prepare');
 assert.equal(requests.some(request=>request.path==='/api/research/start'),false);
 assert.match(get('#researchPreparation').innerHTML,/摄影/);
 assert.match(get('#researchPreparation').innerHTML,/也想了解天文/);
 assert.match(get('#researchPreparation').innerHTML,/2026-10-31/);
 assert.match(get('#researchPreparation').innerHTML,/冻结内容库/);
 await get('#researchConfirm').handlers.click();
 assert.deepEqual(requests.find(request=>request.path==='/api/research/start').data,{sessionId:'account-A',mode:'rating',preparationId:'prepared-input'});
 assert.match(get('#researchContent').innerHTML,/CONFIRMED CARD/);
});

test('the confirmation preview keeps full evidence and sources collapsed while showing recent commands',async t=>{
 const get=dom(t),input=preparation();
 input.public_input.evidence=[...Array.from({length:60},(_,index)=>({type:'open',id:'behavior-'+index})),...Array.from({length:7},(_,index)=>({type:'command',text:'近期指令-'+index}))];
 input.methods=input.methods.map(id=>({id}));input.sources=[{id:'articles',name:'图文库',settings:{large:'完整来源配置'}},{id:'videos',name:'视频库'}];
 const view=createResearchView({getSession:()=>({session_id:'account-A'}),notice:()=>{},onPreparing:()=>{},api:async path=>path==='/api/research/prepare'?{preparation:input}:{study:null}});
 await view.enter('rating');await get('#researchStart').handlers.click();
 const html=get('#researchPreparation').innerHTML,visible=html.replace(/<details>[\s\S]*?<\/details>/g,'');
 assert.match(html,/正常浏览与近期指令（共 67 条）/);
 assert.match(html,/<details><summary>查看完整行为输入<\/summary>/);
 assert.match(html,/<details><summary>查看完整来源信息<\/summary>/);
 assert.equal(/<details\s+open/.test(html),false);
 assert.match(visible,/摄影/);assert.match(visible,/最近/);
 for(let index=2;index<7;index++)assert.match(visible,new RegExp('近期指令-'+index));
 assert.equal(visible.includes('近期指令-0'),false);assert.equal(visible.includes('近期指令-1'),false);
 assert.equal(visible.includes('behavior-59'),false);assert.equal(visible.includes('完整来源配置'),false);
 assert.match(html,/behavior-59/);assert.match(html,/近期指令-0/);assert.match(html,/完整来源配置/);
 assert.match(visible,/waterfall、clawrec、i2agent、general、fixed/);
 assert.match(visible,/articles · 图文库、videos · 视频库/);
});

test('a delayed start cannot show the previous account study after reset',async t=>{
 const get=dom(t),started=deferred(),requests=[];
 let session={session_id:'account-A'};
 const view=createResearchView({getSession:()=>session,notice:()=>{},onPreparing:()=>{},api:async(path,data)=>{
  requests.push({path,data});
  if(path==='/api/research/prepare')return {preparation:preparation()};
  if(path==='/api/research/start')return started.promise;
  return {study:null,saved:true};
 }});
 await view.enter('rating');
 await get('#researchStart').handlers.click();
 const start=get('#researchConfirm').handlers.click();
 assert.equal(requests.at(-1).data.sessionId,'account-A');
 view.reset();session={session_id:'account-B'};
 await view.enter('rating');
 started.resolve({study:rating('old-A','PRIVATE ACCOUNT A CARD')});
 await start;
 assert.equal(get('#researchContent').innerHTML.includes('PRIVATE ACCOUNT A CARD'),false);
 assert.equal(get('#researchStart').hidden,false);
});

test('a delayed enter from an earlier mode visit cannot replace the current study',async t=>{
 const get=dom(t),oldVisit=deferred();let ratings=0;
 const view=createResearchView({getSession:()=>({session_id:'same-account'}),notice:()=>{},onPreparing:()=>{},api:async path=>{
  if(path.includes('/current?')&&path.endsWith('mode=rating'))return ++ratings===1?oldVisit.promise:{study:rating('current','CURRENT RATING CARD')};
  return {study:null,saved:true};
 }});
 const firstEnter=view.enter('rating');
 await view.enter('blind');
 await view.enter('rating');
 assert.match(get('#researchContent').innerHTML,/CURRENT RATING CARD/);
 oldVisit.resolve({study:rating('stale','STALE RATING CARD')});
 await firstEnter;
 assert.match(get('#researchContent').innerHTML,/CURRENT RATING CARD/);
 assert.equal(get('#researchContent').innerHTML.includes('STALE RATING CARD'),false);
});

test('pending work resumes through current and leaving cancels polling and stale results',async t=>{
 const get=dom(t),polled=deferred(),requests=[];let loads=0;
 const view=createResearchView({getSession:()=>({session_id:'account-A'}),notice:()=>{},onPreparing:()=>{},api:async(path,data)=>{
  requests.push({path,data});
  if(path.includes('/current?'))return ++loads===1?{study:null,pending:{id:'job',status:'running'}}:polled.promise;
  return {study:null};
 }});
 await view.enter('rating');
 assert.equal(get.timers.size,1);
 assert.match(get('#researchProgress').textContent,/五系统正在生成/);
 const oldPoll=get.runTimer();
 view.leave();
 assert.equal(get.timers.size,0);
 polled.resolve({study:rating('old','STALE POLL CARD')});await oldPoll;
 assert.equal(get('#researchContent').innerHTML.includes('STALE POLL CARD'),false);
 assert.equal(requests.some(request=>request.path==='/api/research/start'),false);
});

test('confirmed asynchronous start polls until the study exists without starting again',async t=>{
 const get=dom(t),requests=[];let loads=0;
 const view=createResearchView({getSession:()=>({session_id:'account-A'}),notice:()=>{},onPreparing:()=>{},api:async(path,data)=>{
  requests.push({path,data});
  if(path==='/api/research/prepare')return {preparation:preparation()};
  if(path==='/api/research/start')return {pending:{id:'job',status:'queued'}};
  if(path.includes('/current?'))return ++loads===1?{study:null}:{study:rating('complete','ASYNC CARD')};
  return {saved:true};
 }});
 await view.enter('rating');await get('#researchStart').handlers.click();await get('#researchConfirm').handlers.click();
 assert.equal(get.timers.size,1);await get.runTimer();
 assert.match(get('#researchContent').innerHTML,/ASYNC CARD/);
 assert.equal(get.timers.size,0);
 assert.equal(requests.filter(request=>request.path==='/api/research/start').length,1);
});

test('an unavailable five-system backend cannot be confirmed or silently downgraded',async t=>{
 const get=dom(t),requests=[];
 const view=createResearchView({getSession:()=>({session_id:'account-A'}),notice:()=>{},onPreparing:()=>{},api:async(path,data)=>{
  requests.push({path,data});return path==='/api/research/prepare'?{preparation:preparation('blind',false)}:{study:null,full_comparison_available:false};
 }});
 await view.enter('blind');await get('#researchStart').handlers.click();
 assert.match(get('#researchProgress').textContent,/五系统计算后端暂不可用/);
 assert.equal(get('#researchConfirm').disabled,true);await get('#researchConfirm').handlers.click();
 assert.equal(requests.some(request=>request.path==='/api/research/start'),false);
 assert.equal(requests.some(request=>request.path.startsWith('/api/blind/')),false);
});

test('my data keeps unfinished mappings hidden and only opens sealed results and artifacts',async t=>{
 const get=dom(t),requests=[];
 const studies=[{id:'open',session_id:'account-A',mode:'rating',created_at:'today',completed:1,total:4,sealed:false,can_stop:true,input:{provided_profile:'MY INPUT'},answers:[{choice:'A'}],methods:['SECRET OPEN METHOD']},{id:'sealed',mode:'rating',created_at:'yesterday',completed:5,total:5,sealed:true,input:{},answers:[]}];
 const view=createResearchDataView({getSession:()=>({session_id:'account-A'}),notice:()=>{},api:async(path)=>{
  requests.push(path);return path.includes('/details?')?{methods:[{id:'revealed',status:'ok'}],artifact_url:'/api/research/artifact?studyId=sealed'}:{storage:{kind:'sqlite+files'},studies,export_url:'/api/export'};
 }});
 await view.enter();
 assert.match(get('#dataStudies').innerHTML,/MY INPUT/);
 assert.equal(get('#dataStudies').innerHTML.includes('SECRET OPEN METHOD'),false);
 assert.match(get('#dataStudies').innerHTML,/结束并保留未答/);
 assert.equal(get('#dataStudies').innerHTML.includes('旧版'),false);
 assert.match(get('#dataStorage').innerHTML,/本机私有存储/);
 assert.match(get('#dataStorage').innerHTML,/所有会话/);
 assert.match(get('#dataStorage').innerHTML,/完整记录自动保存在本机/);
 assert.match(get('#dataStorage').innerHTML,/当前会话/);
 assert.equal(get('#dataStorage').innerHTML.includes('sqlite'),false);
 assert.equal(get('#dataStudies').innerHTML.includes('data-study-details="open"'),false);
 assert.equal(get('#dataExport').innerHTML.includes('下载当前会话数据'),false);
 assert.match(get('#dataExport').innerHTML,/下载正式数据包/);
 await get('#dataStudies').handlers.click({target:{closest:selector=>selector==='[data-study-details]'?{dataset:{studyDetails:'open'}}:null}});
 assert.equal(requests.length,1);
 await get('#dataStudies').handlers.click({target:{closest:selector=>selector==='[data-study-details]'?{dataset:{studyDetails:'sealed'}}:null}});
 assert.match(get('#dataDetails').innerHTML,/revealed/);
 assert.match(get('#dataDetails').innerHTML,/\/api\/research\/artifact\?studyId=sealed/);
 assert.match(get('#dataDetails').innerHTML,/下载本组方法原始记录（gzip）/);
 assert.match(get('#dataDetails').innerHTML,/下载本组输入与答案（JSON）/);
 assert.match(get('#dataDetails').innerHTML,/\/api\/research\/details\?sessionId=account-A&amp;studyId=sealed&amp;download=1/);
});

test('my data describes online private storage without backend technology names',async t=>{
 const get=dom(t);
 const view=createResearchDataView({getSession:()=>({session_id:'account-A'}),notice:()=>{},api:async()=>({storage:{kind:'d1+r2'},studies:[],export_url:'/api/export?sessionId=account-A'})});
 await view.enter();
 assert.match(get('#dataStorage').innerHTML,/云端私有存储/);
 assert.match(get('#dataStorage').innerHTML,/历史组在下方单独下载/);
 assert.equal(get('#dataStorage').innerHTML.includes('d1+r2'),false);
 assert.match(get('#dataExport').innerHTML,/下载当前会话数据/);
 assert.equal(get('#dataExport').innerHTML.includes('下载本人全部数据'),false);
});

test('a delayed my-data response cannot render after an account change',async t=>{
 const get=dom(t),old=deferred();let session={session_id:'A'};
 const view=createResearchDataView({getSession:()=>session,notice:()=>{},api:async path=>path.includes('sessionId=A')?old.promise:{studies:[]}});
 const loading=view.enter();view.reset();session={session_id:'B'};await view.enter();
 old.resolve({studies:[{id:'private',input:'PRIVATE ACCOUNT A',answers:[]}]});await loading;
 assert.equal(get('#dataStudies').innerHTML.includes('PRIVATE ACCOUNT A'),false);
});

test('an unfinished legacy blind group can be ended in its original session without an answer',async t=>{
 const get=dom(t),requests=[];let sealed=false;
 const view=createResearchDataView({getSession:()=>({session_id:'current-session'}),notice:()=>{},api:async(path,data)=>{
  requests.push({path,data});
  if(path==='/api/research/stop'){sealed=true;return {saved:true};}
  if(path.includes('/api/research/details?'))return {methods:[{name:'legacy-method'}],artifact_url:'/api/research/artifact?studyId=legacy-comparison'};
  return {studies:[{id:'legacy-comparison',session_id:'original-session',mode:'blind',legacy:true,can_stop:!sealed,sealed,completed:0,total:1,input:{},answers:[]}]};
 }});
 await view.enter();
 assert.match(get('#dataStudies').innerHTML,/旧版盲选/);
 assert.match(get('#dataStudies').innerHTML,/结束旧版评测并保留未答/);
 assert.equal(get('#dataStudies').innerHTML.includes('data-study-details="legacy-comparison"'),false);
 const button={dataset:{studyStop:'legacy-comparison'}};
 await get('#dataStudies').handlers.click({target:{closest:selector=>selector==='[data-study-stop]'?button:null}});
 assert.deepEqual(requests.find(request=>request.path==='/api/research/stop').data,{sessionId:'original-session',studyId:'legacy-comparison'});
 assert.equal(requests.filter(request=>request.path.includes('/api/research/data?')).length,2);
 assert.equal(requests.some(request=>request.path.includes('/answer')||request.path.includes('/evaluate')),false);
 assert.match(get('#dataStudies').innerHTML,/已答 0 \/ 1/);
 assert.match(get('#dataStudies').innerHTML,/data-study-details="legacy-comparison"/);
 assert.equal(get('#dataStudies').innerHTML.includes('data-study-stop="legacy-comparison"'),false);
 await get('#dataStudies').handlers.click({target:{closest:selector=>selector==='[data-study-details]'?{dataset:{studyDetails:'legacy-comparison'}}:null}});
 assert.match(requests.at(-1).path,/sessionId=original-session&studyId=legacy-comparison/);
 assert.match(get('#dataDetails').innerHTML,/legacy-method/);
 assert.match(get('#dataDetails').innerHTML,/sessionId=original-session&amp;studyId=legacy-comparison&amp;download=1/);
});
