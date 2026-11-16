const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeUrl=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const downloadUrl=value=>typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')?value:safeUrl(value);
const json=value=>esc(typeof value==='string'?value:JSON.stringify(value??[],null,2));
function preview(item){
 const url=safeUrl(item.url),image=safeUrl(item.image_url);
 return `<article class="research-card" data-item="${esc(item.id)}">${image?`<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<div class="card-body"><p class="research-source">${esc(item.source)}</p><h2>${esc(item.title)}</h2>${item.summary?`<p class="card-summary">${esc(item.summary)}</p>`:''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-research-open="${esc(item.id)}">打开原内容 ↗</a>`:''}</div></article>`;
}
function sharedInput(input){
 const evidence=input?.evidence||[],commands=evidence.filter(event=>event.type==='command'&&event.text).slice(-5);
 return `<h3>共同原始画像</h3><pre tabindex="0">${json(input?.provided_profile)}</pre><h3>正常浏览与近期指令（共 ${evidence.length} 条）</h3><p>最近指令（最多 5 条）：${commands.length?commands.map(event=>esc(event.text)).join('；'):'暂无'}</p><details><summary>查看完整行为输入</summary><pre tabindex="0">${json(evidence)}</pre></details>`;
}

export function createResearchView({api,getSession,getUser=()=>null,notice,onPreparing}){
 const root=document.querySelector('#researchView');let mode='rating',study=null,preparation=null,pending=null,question=null,busy=false,outbound=null,generation=0,observer=null,pollTimer=null,active=false,error='',backendReady=true;
 const shown=new Map();
 root.innerHTML='<header class="section-header"><h1 id="researchTitle">内容评分</h1><p id="researchIntro"></p></header><p class="research-policy">评分与选择只用于研究评价，不会改变你的推荐。</p><p id="researchProgress" role="status" aria-live="polite"></p><section id="researchPreparation" class="research-input" hidden aria-label="本组共同输入"></section><div id="researchContent"></div><div id="researchChoices" class="research-choices"></div><div class="research-controls"><button id="researchStart" type="button" class="primary">查看本组输入</button><button id="researchConfirm" type="button" class="primary" hidden>确认输入并开始</button><button id="researchStop" type="button" class="quiet" hidden>结束并保留记录</button></div>';
 const el=id=>root.querySelector('#'+id);
 const request=(path,data)=>api('/api/research/'+path,{sessionId:getSession()?.session_id,...data});
 const current=(token,sid,expectedMode)=>active&&token===generation&&getSession()?.session_id===sid&&mode===expectedMode;
 const clearPoll=()=>{clearTimeout(pollTimer);pollTimer=null;};
 const unavailable='参评系统计算后端暂不可用，无法开始本组评测。请稍后重试；不会切换到旧双系统或单系统。';
 async function recordVisible(){
  if(!active||!study||study.stopped||!question||root.hidden||document.visibilityState!=='visible'||!document.hasFocus())return;
  const token=generation,sid=getSession()?.session_id,expectedMode=mode,studyId=study.id,questionId=question.id;
  const cards=[...el('researchContent').querySelectorAll('.research-card')];
  await Promise.all(cards.map(async card=>{
   const rect=card.getBoundingClientRect(),visible=Math.max(0,Math.min(rect.bottom,window.innerHeight)-Math.max(rect.top,0));
   const key=`${studyId}:${questionId}:${card.dataset.item}`;if(visible<rect.height*.5)return;if(shown.has(key))return shown.get(key);
   const promise=request('present',{sessionId:sid,studyId,questionId,itemId:card.dataset.item}).catch(cause=>{shown.delete(key);if(current(token,sid,expectedMode))notice(cause.message,true);});
   shown.set(key,promise);return promise;
  }));
 }
 function render(){
  observer?.disconnect();
  const blind=mode==='blind';el('researchTitle').textContent=blind?'匿名盲选':'内容评分';
  el('researchIntro').textContent=blind?'请比较两组匿名推荐，选择此刻更想看的内容；每侧最多 5 条。':'同一份共同输入下，评价本轮各系统的实际推荐；内容去重后打乱，逐条作答。可以持续做题。';
  el('researchProgress').textContent=error||(pending?'参评系统正在生成本组内容，完成后会自动显示。可以离开本页，稍后回来继续。':busy?'正在读取本组信息，请稍候…':study?`已完成 ${study.completed} / ${study.total}${study.incomplete_methods?` · ${study.incomplete_methods} 个系统缺席或未完整交付，缺失与失败单列；本组不能视为完整参评系统比较。`:""}`:'开始前请先查看并确认本组实际使用的共同输入。');
  const previousQuestion=question?.id;question=study&&!study.stopped?(blind?study.pairs:study.items)?.find(item=>!item.answered):null;
  if(previousQuestion&&question?.id!==previousQuestion)window.scrollTo?.({top:0,behavior:'instant'});
  el('researchStop').hidden=!study||study.stopped||!question;el('researchStop').disabled=busy;
  el('researchStart').hidden=!!question||!!pending&&busy;el('researchStart').disabled=busy;
  el('researchStart').textContent=pending?'重新连接本组':preparation?'重新查看共同输入':study?'查看下一组输入':'查看本组输入';
  el('researchStart').className=preparation?'secondary':'primary';
  el('researchPreparation').hidden=!preparation;
  el('researchConfirm').hidden=!preparation||!!pending;
  el('researchConfirm').disabled=busy||!backendReady;
  el('researchPreparation').innerHTML=preparation?`<h2>开始前确认共同输入</h2><p>共同输入截止时间：<time>${esc(preparation.captured_at)}</time></p>${sharedInput(preparation.public_input)}<h3>参与方法（不展示题目对应关系）</h3><p>${(preparation.methods||[]).map(method=>esc(typeof method==='string'?method:method.id||method.name)).join('、')}</p>${preparation.deferred_methods?.length?`<p>本轮暂不参与：${preparation.deferred_methods.map(id=>esc(id==='fixed-retrieval'?'BM25＋BGE（耗时过长，暂缓）':id)).join('、')}。</p>`:''}<h3>本组实际可检索来源</h3>${preparation.unavailable_sources?.length?`<p role="status">本组未使用的已选来源：${preparation.unavailable_sources.map(esc).join("、")}。它们不在本次参评系统共同检索范围内。</p>`:""}<p>${(preparation.sources||[]).map(source=>esc(typeof source==='string'?source:[source.id,source.name].filter(Boolean).join(' · '))).join('、')}</p><details><summary>查看完整来源信息</summary><pre tabindex="0">${json(preparation.sources)}</pre></details><p class="research-policy">确认后冻结这份共同用户输入。各系统另用自己的状态、提示词和工具结果决策，完整调用可在评测结束后下载。过去评分、盲选及评价区事件不进入推荐输入。</p>`:'';
  if(!question){el('researchContent').innerHTML=study?'<p class="research-finished">已保留本次记录。可在“我的数据”查看本人答案；完成或结束后可查看方法结果与下载原始记录。</p>':'';el('researchChoices').innerHTML='';return;}
  if(blind){
   el('researchContent').innerHTML=`${question.unavailable?'<p role="status">本题有一方未完整交付，保留为无法判断。</p>':''}<div class="research-lists"><section><h2>推荐 A</h2>${question.A.map(preview).join('')}</section><section><h2>推荐 B</h2>${question.B.map(preview).join('')}</section></div>`;
   el('researchChoices').innerHTML=[['A','更想看 A'],['B','更想看 B'],['tie','两组都想看'],['neither','两组都不想看'],['insufficient','无法判断']].map(([value,label])=>`<button class="secondary" type="button" data-choice="${value}"${question.unavailable&&value!=='insufficient'||question.same_content&&['A','B'].includes(value)?' disabled':''}>${label}</button>`).join('');
  }else{
   el('researchContent').innerHTML=preview(question.item);
   el('researchChoices').innerHTML=['0 · 不感兴趣','1 · 一般','2 · 喜欢','3 · 很喜欢'].map((label,value)=>`<button class="secondary" type="button" data-rating="${value}">${label}</button>`).join('')+'<button class="quiet" type="button" data-rating="unable">无法判断</button>';
  }
  if(getUser()?.type==='agent')el('researchChoices').innerHTML='<button class="primary" type="button" data-simulate="true">'+(blind?'让 Agent 选择本题':'让 Agent 评价本题')+'</button>';
  observer=new IntersectionObserver(()=>recordVisible(),{threshold:[.5]});for(const card of el('researchContent').querySelectorAll('.research-card'))observer.observe(card);
  requestAnimationFrame(()=>recordVisible());
 }
 function receive(result){
  backendReady=result.full_comparison_available!==false;
  if(result.study&&result.study.mode!==mode)throw new Error('服务返回的评测类型不匹配，请重新打开本页。');
  if(result.study?.mode===mode){study=result.study;pending=null;preparation=null;return;}
  pending=result.pending||null;
  if(pending&&['failed','interrupted'].includes(pending.status)){const message=pending.error||'本组计算未完成，请重新查看共同输入后重试。';pending=null;throw new Error(message);}
  if(!pending&&!backendReady)error=unavailable;
 }
 function schedulePoll(token,sid,expectedMode){clearPoll();pollTimer=setTimeout(()=>loadCurrent(token,sid,expectedMode),2000);}
 async function loadCurrent(token,sid,expectedMode){
  try{
   const result=await api(`/api/research/current?sessionId=${encodeURIComponent(sid)}&mode=${expectedMode}`);
   if(!current(token,sid,expectedMode))return;error='';receive(result);busy=!!pending;onPreparing(busy);render();if(pending)schedulePoll(token,sid,expectedMode);
  }catch(cause){if(current(token,sid,expectedMode)){busy=false;onPreparing(false);error=`评测暂时无法读取：${cause.message}`;render();notice(error,true);}}
 }
 async function prepare(){
  if(busy)return;const token=++generation,sid=getSession()?.session_id,expectedMode=mode;clearPoll();error='';busy=true;onPreparing(true);render();
  if(pending){await loadCurrent(token,sid,expectedMode);return;}
  try{
   const result=await request('prepare',{sessionId:sid,mode:expectedMode});if(!current(token,sid,expectedMode))return;
   if(!result.preparation?.id||result.preparation.mode!==expectedMode||!result.preparation.public_input)throw new Error('服务未返回本组共同输入，尚未开始评测。');
   preparation=result.preparation;study=null;backendReady=preparation.backend_ready===true&&preparation.methods?.length>=2;
   if(!backendReady)error=unavailable;
  }catch(cause){if(current(token,sid,expectedMode)){preparation=null;error=`无法准备评测：${cause.message}`;notice(error,true);}}
  finally{if(current(token,sid,expectedMode)){busy=false;onPreparing(false);render();}}
 }
 async function start(){
  if(busy||!preparation||!backendReady)return;const token=++generation,sid=getSession()?.session_id,expectedMode=mode;clearPoll();busy=true;error='';onPreparing(true);render();
  try{
   const result=await request('start',{sessionId:sid,mode:expectedMode,preparationId:preparation.id});if(!current(token,sid,expectedMode))return;
   if(!result.study&&!result.pending)throw new Error('参评系统后端未返回任务，尚未开始评测。');receive(result);
  }catch(cause){if(current(token,sid,expectedMode)){error=`评测未开始：${cause.message}`;if(cause.status===409)preparation=null;notice(error,true);}}
  finally{if(current(token,sid,expectedMode)){busy=!!pending;onPreparing(busy);render();if(pending)schedulePoll(token,sid,expectedMode);}}
 }
 el('researchStart').addEventListener('click',prepare);
 el('researchConfirm').addEventListener('click',start);
 el('researchStop').addEventListener('click',async()=>{
  if(busy||!study)return;const token=++generation,sid=getSession()?.session_id,expectedMode=mode,studyId=study.id;busy=true;error='';
  try{const result=await request('stop',{sessionId:sid,studyId});if(current(token,sid,expectedMode))study=result.study;}
  catch(cause){if(current(token,sid,expectedMode)){error=cause.message;notice(error,true);}}
  finally{if(current(token,sid,expectedMode)){busy=false;render();}}
 });
 el('researchChoices').addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!question||busy||button.disabled)return;
  const token=++generation,sid=getSession()?.session_id,expectedMode=mode;
  busy=true;error='';for(const item of el('researchChoices').querySelectorAll('button'))item.disabled=true;
  const reference={sessionId:sid,studyId:study.id,questionId:question.id};
  const label=mode==='blind'?{choice:button.dataset.choice}:{rating:button.dataset.rating==='unable'?null:Number(button.dataset.rating),status:button.dataset.rating==='unable'?'unable':'rated'};
  try{
   await recordVisible();if(!current(token,sid,expectedMode))return;
   const result=await request(button.dataset.simulate?'simulate':'answer',button.dataset.simulate?reference:{...reference,...label});if(current(token,sid,expectedMode))study=result.study;
  }catch(cause){if(current(token,sid,expectedMode)){error=cause.message;notice(error,true);}}
  finally{if(current(token,sid,expectedMode)){busy=false;render();}}
 });
 root.addEventListener('click',event=>{
  const link=event.target.closest('[data-research-open]');if(!active||!link||!question)return;
  const token=generation,sid=getSession()?.session_id,expectedMode=mode;
  outbound={sessionId:sid,studyId:study.id,questionId:question.id,event:'return',itemId:link.dataset.researchOpen};
  outbound.opened=request('interaction',{...outbound,event:'open'}).catch(cause=>{if(current(token,sid,expectedMode))notice(cause.message,true);});
 });
 window.addEventListener('focus',()=>{recordVisible();if(outbound){const event=outbound;outbound=null;if(active&&event.sessionId===getSession()?.session_id){const token=generation,expectedMode=mode,{opened,...reference}=event;opened.then(()=>{if(current(token,event.sessionId,expectedMode))return request('interaction',reference);}).catch(cause=>{if(current(token,event.sessionId,expectedMode))notice(cause.message,true);});}}});
 function leave(){active=false;generation++;clearPoll();observer?.disconnect();outbound=null;busy=false;onPreparing(false);}
 return {async enter(next){leave();active=true;const token=generation,sid=getSession()?.session_id;mode=next;study=null;preparation=null;pending=null;error='';backendReady=true;busy=true;shown.clear();render();await loadCurrent(token,sid,next);},leave,reset(){leave();shown.clear();study=null;preparation=null;pending=null;question=null;error='';render();}};
}

function curationControls(study){
 const value=study.curation||{disposition:'pending'},labels={keep:'已保留',exclude:'已排除',pending:'待审核'};
 return `<p>正式数据：${labels[value.disposition]||'待审核'}${value.data_origin&&value.data_origin!=='human'?' · 测试或合成记录':''}</p><div class="research-controls">${[['keep','保留'],['exclude','排除'],['pending','恢复待审核']].map(([disposition,label])=>`<button class="secondary" type="button" data-study-curate="${esc(study.id)}" data-disposition="${disposition}"${value.disposition===disposition||disposition==='keep'&&!value.can_keep||disposition==='pending'&&value.data_origin&&value.data_origin!=='human'?' disabled':''}>${label}</button>`).join('')}</div>`;
}

export function createResearchDataView({api,getSession,notice}){
 const root=document.querySelector('#dataView');let generation=0,active=false,studies=[];
 root.innerHTML='<header class="section-header"><h1>我的数据</h1><a class="export-link" href="/api/export" download>导出账户数据 .json.gz</a><p>这里只显示本人账户的输入、答案和评测记录。完成或明确结束一组后，可查看对应方法与原始记录。</p></header><p id="dataStatus" role="status" aria-live="polite"></p><section id="dataStorage" class="research-input" hidden></section><div id="dataStudies"></div><section id="dataDetails" class="research-input" hidden></section><div id="dataExport"></div><button id="dataRefresh" type="button" class="secondary">刷新记录</button>';
 const el=id=>root.querySelector('#'+id);
 const current=(token,sid)=>active&&token===generation&&getSession()?.session_id===sid;
 function render(result){
  const sample=getSession()?.demo_mode==='sample';
  studies=result.studies||[];el('dataStatus').textContent=studies.length?`共 ${studies.length} 组评测记录`:'还没有评测记录。';
  el('dataStorage').hidden=!result.storage;el('dataStorage').innerHTML=sample?'<h2>本机私有存储</h2><p>浏览、反馈和推荐轨迹自动保存在本机，可下载。</p>':result.storage?`<h2>${result.storage.kind==='sqlite+files'?'本机私有存储':result.storage.kind==='d1+r2'?'云端私有存储':'数据保存与下载'}</h2><p>可在这里查看本账号所有会话的评测；完整记录自动保存在${result.storage.kind==='sqlite+files'?'本机':'云端'}，完成或结束一组后可下载。参评系统评测的本组输入与运行归档也会保存在云端计算后端。排除仅影响正式数据包，不删除原始记录。人工组默认待审核，测试与合成组默认排除。</p><p>导出账户数据包含所有会话和已完成或结束的评测。侧栏可导出当前会话，历史组在下方单独下载。</p>`:'';
  el('dataStudies').innerHTML=studies.map(study=>{const unable=(study.answers||[]).filter(answer=>[answer.status,answer.grade_status,answer.choice].some(value=>['unable','insufficient'].includes(value))).length;return `<article class="research-data-group"><h2>${study.legacy?'旧版盲选':study.mode==='blind'?'匿名盲选':'内容评分'} · ${esc(study.created_at)}</h2><p>已答 ${esc(study.completed)} / ${esc(study.total)} · 未答 ${Math.max(0,study.total-study.completed)} · 无法判断 ${unable} · ${study.stopped?'已结束':study.sealed?'已完成':'进行中'}</p><details><summary>本组输入</summary><pre tabindex="0">${json(study.input)}</pre></details><details><summary>本人答案</summary><pre tabindex="0">${json(study.answers)}</pre></details>${curationControls(study)}${study.can_stop&&!study.sealed?`<button class="secondary" type="button" data-study-stop="${esc(study.id)}">${study.legacy?'结束旧版评测并保留未答':'结束并保留未答'}</button>`:''}${study.sealed?`<button class="secondary" type="button" data-study-details="${esc(study.id)}">查看方法结果与下载</button>`:'<p class="research-policy">完成或结束本组后显示方法对应关系及原始记录下载。</p>'}</article>`;}).join('');
  const href=downloadUrl(result.export_url),sessions=[...new Set([getSession()?.session_id,...studies.map(study=>study.session_id)].filter(Boolean))];
  el('dataExport').innerHTML=(href&&studies.every(study=>study.sealed)?`<p><a class="export-link" href="${esc(href)}" download>下载当前会话数据</a></p>`:'')+(sample?'':sessions.map(sid=>`<p><a class="export-link" href="/api/export?sessionId=${esc(encodeURIComponent(sid))}&amp;format=release" download>下载正式数据包 · ${sid===getSession()?.session_id?'当前会话':esc(sid)}</a></p>`).join('')+'<p>正式数据包只包含明确保留的已完成或已结束人工组；未保留任何组时不会生成。</p>');

 }
 async function enter(){
  const token=++generation,sid=getSession()?.session_id;active=true;studies=[];el('dataStatus').textContent='正在读取本人数据…';el('dataStudies').innerHTML='';el('dataDetails').hidden=true;el('dataDetails').innerHTML='';el('dataStorage').hidden=true;el('dataStorage').innerHTML='';el('dataExport').innerHTML='';
  try{const result=await api(`/api/research/data?sessionId=${encodeURIComponent(sid)}`);if(current(token,sid))render(result);}
  catch(cause){if(current(token,sid)){el('dataStatus').textContent=`本人数据暂时无法读取：${cause.message}`;notice(cause.message,true);}}
 }
 el('dataRefresh').addEventListener('click',enter);
 el('dataStudies').addEventListener('click',async event=>{
  const curate=event.target.closest('[data-study-curate]');
  if(curate){
   const selected=studies.find(study=>study.id===curate.dataset.studyCurate);if(!selected?.session_id||curate.disabled)return;
   const token=++generation,sid=getSession()?.session_id;curate.disabled=true;
   try{await api('/api/research/curate',{sessionId:selected.session_id,studyId:selected.id,disposition:curate.dataset.disposition});if(current(token,sid))await enter();}
   catch(cause){if(current(token,sid)){el('dataStatus').textContent=`本组状态暂时无法保存：${cause.message}`;notice(cause.message,true);}}
   finally{curate.disabled=false;}
   return;
  }
  const stop=event.target.closest('[data-study-stop]');
  if(stop){
   const selected=studies.find(study=>study.id===stop.dataset.studyStop);if(!selected?.can_stop||selected.sealed||stop.disabled)return;
   const token=++generation,sid=getSession()?.session_id;stop.disabled=true;
   try{
    if(!selected.session_id)throw new Error('本组评测缺少所属会话，暂时无法结束。');
    await api('/api/research/stop',{sessionId:selected.session_id,studyId:selected.id});if(current(token,sid))await enter();
   }catch(cause){if(current(token,sid)){el('dataStatus').textContent=`本组评测暂时无法结束：${cause.message}`;notice(cause.message,true);}}
   finally{stop.disabled=false;}
   return;
  }
  const button=event.target.closest('[data-study-details]');if(!button)return;
  const selected=studies.find(study=>study.id===button.dataset.studyDetails);if(!selected?.sealed)return;
  const token=++generation,sid=getSession()?.session_id,detailsUrl=`/api/research/details?sessionId=${encodeURIComponent(selected.session_id||sid)}&studyId=${encodeURIComponent(selected.id)}`;button.disabled=true;el('dataDetails').hidden=false;el('dataDetails').textContent='正在读取本组方法结果…';
  try{
   const result=await api(detailsUrl);if(!current(token,sid))return;
   const details=result.details||result,href=downloadUrl(details.artifact_url);
   el('dataDetails').innerHTML=`<h2>本组方法结果</h2><pre tabindex="0">${json(details.methods)}</pre><p><a class="export-link" href="${esc(detailsUrl+'&download=1')}" download>下载本组输入与答案（JSON）</a></p>${href?`<a class="export-link" href="${esc(href)}" download>下载本组方法原始记录（gzip）</a>`:'<p>本组方法原始记录暂未提供下载。</p>'}`;
  }catch(cause){if(current(token,sid)){el('dataDetails').textContent=`本组详情暂时无法读取：${cause.message}`;notice(cause.message,true);}}
  finally{button.disabled=false;}
 });
 function leave(){active=false;generation++;}
 return {enter,leave,reset(){leave();studies=[];for(const id of ['dataStatus','dataStorage','dataStudies','dataDetails','dataExport'])el(id).innerHTML='';el('dataDetails').hidden=true;el('dataStorage').hidden=true;}};
}
