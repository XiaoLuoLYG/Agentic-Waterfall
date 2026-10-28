import { buildTimeline, groupTimeline, selectTimeline } from './trace-model.js';
import { ui } from './icons.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timeText = value => { const d=new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '时间未知'; };
const dateText = value => { const d=new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'}) : '时间未知'; };
const actor = { user:['用户操作','user','profile'], agent:['Agent 决策','agent','brain'], tool:['来源工具','tool','tool'], exposure:['浏览记录','exposure','eye'], state:['画像与记忆','state','memory'], simulation:['模拟用户','simulation','robot'], system:['信息流','system','sources'] };

export function createTraceView() {
  const list=$('#traceTimeline'), status=$('#traceStatus'), select=$('#traceSession'), pop=$('#tracePopover'), popTitle=$('#tracePopoverTitle'), popContent=$('#tracePopoverContent');
  let active=false,currentSession='',selected='',timer=null,requestId=0,rows=[],signature='',pinned=false,currentButton=null,closeTimer=null,pendingData=null,suppressFocus=false,revision=null,isAgent=false,filter='all',lastData=null;
  const expandedGroups=new Set();
  async function get(url) { const res=await fetch(url,{cache:'no-store'}); const body=await res.json(); if(!res.ok) throw new Error(body.error || '读取失败'); return body; }
  function hide() { clearTimeout(closeTimer);pop.hidden=true;pinned=false;currentButton?.setAttribute('aria-expanded','false');currentButton=null;if(pendingData){const data=pendingData;pendingData=null;render(data);} }
  function scheduleHide() { clearTimeout(closeTimer);if(!pinned)closeTimer=setTimeout(hide,180); }
  function show(button,pin=false) {
    clearTimeout(closeTimer);const row=rows[Number(button.dataset.row)], label=button.dataset.detail; if(!row || !Object.hasOwn(row.details || {},label))return;
    if(currentButton && currentButton!==button)currentButton.setAttribute('aria-expanded','false');
    currentButton=button;if(pin)pinned=true;button.setAttribute('aria-expanded','true');popTitle.textContent=row.title.endsWith(` · ${label}`)?row.title:`${row.title} · ${label}`;
    const value=row.details[label];popContent.textContent=typeof value==='string'?value:JSON.stringify(value,null,2) ?? '暂无记录';
    pop.hidden=false;const rect=button.getBoundingClientRect();const width=Math.min(520,window.innerWidth-24);pop.style.width=`${width}px`;
    const right=rect.right+12, left=right+width<=window.innerWidth-12?right:Math.max(12,rect.left-width-12);
    pop.style.left=`${left}px`;pop.style.top=`${Math.max(12,Math.min(rect.top,window.innerHeight-pop.offsetHeight-12))}px`;
  }
  function render(data) {
    if(!pop.hidden){pendingData=data;return;}
    lastData=data;const next=selectTimeline(buildTimeline(data),filter);
    const newSignature=JSON.stringify(next.map(row=>[row.id,row.at,row.description,row.status,Object.keys(row.details||{})]));
    if(newSignature===signature){rows=next;return;}
    const follow=!signature || list.scrollHeight-list.scrollTop-list.clientHeight<100;
    signature=newSignature;rows=next;status.hidden=rows.length>0;
    if(!rows.length){status.textContent=filter==='all'?'还没有可展示的轨迹。开始浏览后，操作会出现在这里。':'这一类暂时没有记录。';list.innerHTML='';return;}
    const indices=new Map(rows.map((row,index)=>[row,index]));let day='';
    const itemHTML = row => {
      const index=indices.get(row);
      const buttons=Object.keys(row.details||{}).map(detail=>`<button class="trace-detail-button" data-row="${index}" data-detail="${escape(detail)}" aria-controls="tracePopover" aria-expanded="false">${escape(detail)} <span aria-hidden="true">${ui.northeast}</span></button>`).join('');
      const flag=row.status==='error'?'<span class="trace-flag error">未完成</span>':row.status==='pending'?'<span class="trace-flag">进行中或中断</span>':'';
      return `<div class="trace-item"><div class="trace-item-main"><div class="trace-item-title"><h3>${escape(row.title.replace(/^(Agent · |来源工具 · |模拟用户 · )/,''))}</h3>${flag}<time>${escape(timeText(row.at))}</time></div>${row.highlights?.length?`<div class="trace-context">${row.highlights.map(value=>`<span>${escape(value)}</span>`).join('')}</div>`:''}${row.description?`<p>${escape(row.description)}</p>`:''}</div><div class="trace-details">${buttons}</div></div>`;
    };
    list.innerHTML=groupTimeline(rows).map(group=>{
      const date=dateText(group.items[0].at), separator=date===day?'':`<div class="trace-date"><span>${escape(date)}</span></div>`;day=date;
      const [label,kind,icon]=actor[group.kind]||actor.user;
      const showLatest=filter==='viewing'&&group.kind==='exposure'&&group.items.length>3;
      const visible=showLatest?group.items.slice(-2):group.kind!=='user' && group.kind!=='simulation' && group.items.length>3?group.items.slice(0,2):group.items;
      const rest=showLatest?group.items.slice(0,-2):group.items.slice(visible.length), more=rest.length?`<details class="trace-more" data-group="${escape(group.id)}"${expandedGroups.has(group.id)?' open':''}><summary><span class="more-closed">展开另外 ${rest.length} 条</span><span class="more-open">收起</span>${ui.down}</summary>${rest.map(itemHTML).join('')}</details>`:'';
      return `${separator}<div class="trace-row ${kind}"><time>${escape(timeText(group.items[0].at))}</time><div class="trace-node" aria-hidden="true"></div><article class="trace-card"><div class="trace-card-top"><div class="trace-actor-icon" aria-hidden="true">${ui[icon]||''}</div><strong class="trace-actor">${escape(label)}</strong><span class="trace-count">${group.items.length} 条</span></div><div class="trace-items">${showLatest?more:''}${visible.map(itemHTML).join('')}${showLatest?'':more}</div></article></div>`;
    }).join('');
    if(follow)list.scrollTop=list.scrollHeight;
  }
  async function refresh() {
    if(!active||!selected)return;const serial=++requestId;
    try { const data=await get(`/api/trace?sessionId=${encodeURIComponent(selected)}${revision === null ? '' : `&after=${revision}`}`);if(!active||serial!==requestId)return;revision=data.revision;if(data.unchanged){status.hidden=rows.length>0;return;}render(data); }
    catch(error) { if(!active||serial!==requestId)return;status.hidden=false;status.textContent=`轨迹暂时无法读取：${error.message}`; }
    finally { if(active&&serial===requestId&&selected===currentSession)timer=setTimeout(refresh,5000); }
  }
  async function enter(id,type) {
    expandedGroups.clear();lastData=null;active=true;isAgent=type==='agent';$('#traceAgentToggle').hidden=!isAgent;currentSession=id;selected=id;$('.trace-live').hidden=false;revision=null;signature='';rows=[];pendingData=null;list.innerHTML='';status.hidden=false;status.textContent='正在读取轨迹…';select.disabled=true;const serial=++requestId;
    try { const data=await get('/api/sessions');if(!active||serial!==requestId)return;const sessions=data.sessions || [];select.innerHTML=sessions.map(s=>`<option value="${escape(s.session_id)}">${escape(dateText(s.event_time))} ${escape(timeText(s.event_time))}${s.session_id===id?' · 当前会话':''}${s.record_kind==='synthetic'?' · 模拟用户':''}</option>`).join('');select.value=id;select.disabled=false;await refresh(); }
    catch(error) { if(active&&serial===requestId){status.textContent=`轨迹暂时无法读取：${error.message}`;select.disabled=false;} }
  }
  function leave(){active=false;requestId++;clearTimeout(timer);hide();}
  function closeAndRestore(){const button=currentButton;hide();if(button?.isConnected){suppressFocus=true;button.focus();suppressFocus=false;}}
  document.querySelectorAll('[data-trace-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.traceFilter;document.querySelectorAll('[data-trace-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));expandedGroups.clear();signature='';hide();if(lastData)render(lastData);}));
  $('#traceLatest').addEventListener('click',()=>{list.scrollTop=list.scrollHeight;});
  select.addEventListener('change',()=>{expandedGroups.clear();lastData=null;selected=select.value;revision=null;$('.trace-live').hidden=selected!==currentSession;$('#traceAgentToggle').hidden=!isAgent||selected!==currentSession;clearTimeout(timer);requestId++;hide();signature='';list.innerHTML='';status.hidden=false;status.textContent='正在读取轨迹…';refresh();});
  list.addEventListener('toggle',e=>{if(!e.target.matches('.trace-more'))return;e.target.open?expandedGroups.add(e.target.dataset.group):expandedGroups.delete(e.target.dataset.group);},true);
  list.addEventListener('pointerover',e=>{const button=e.target.closest('.trace-detail-button');if(button&&!pinned)show(button);});
  list.addEventListener('pointerout',e=>{const button=e.target.closest('.trace-detail-button');if(button&&!button.contains(e.relatedTarget))scheduleHide();});
  list.addEventListener('focusin',e=>{const button=e.target.closest('.trace-detail-button');if(button&&!pinned&&!suppressFocus)show(button);});
  list.addEventListener('focusout',e=>{if(!pop.contains(e.relatedTarget))scheduleHide();});
  list.addEventListener('click',e=>{const button=e.target.closest('.trace-detail-button');if(!button)return;if(pinned&&currentButton===button)hide();else {pinned=false;show(button,true);popContent.focus({preventScroll:true});}});
  pop.addEventListener('pointerenter',()=>clearTimeout(closeTimer));pop.addEventListener('pointerleave',scheduleHide);
  $('#tracePopoverClose').addEventListener('click',()=>closeAndRestore());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pop.hidden){closeAndRestore();}});
  window.addEventListener('scroll',()=>{if(!pop.hidden&&!pinned)hide();},{passive:true});
  list.addEventListener('scroll',()=>{if(!pop.hidden&&!pinned)hide();},{passive:true});
  window.addEventListener('resize',()=>{if(!pop.hidden&&currentButton)show(currentButton,pinned);});
  return {enter,leave};
}
