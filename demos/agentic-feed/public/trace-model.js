const labels = { session_start:'开始会话', enter:'进入信息流', leave:'离开信息流', scroll:'滚动信息流', command:'输入指令', response:'收到回复', open:'打开内容', return:'返回信息流', like:'点赞', dislike:'不感兴趣', save:'收藏', unsave:'取消收藏', comment:'发表评论', feed_update:'信息流更新', settings_change:'调整偏好' };
const names = { bilibili:'哔哩哔哩', zhihu:'知乎', youtube:'YouTube', wikipedia:'维基百科', hackernews:'Hacker News', local:'本地演示', github:'GitHub', reddit:'Reddit', x:'X', twitch:'Twitch', applepodcasts:'Apple Podcasts', steam:'Steam 新闻', cnnews:'中文资讯', globalnews:'国际资讯' };
const actionNames = { acquire:'获取内容', recommend:'挑选内容', update_state:'更新画像', respond:'回复', keep:'保持当前内容' };
const shorten = (text, max=140) => typeof text === 'string' && text.length > max ? `${text.slice(0,max)}…` : text || '';
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export function buildTimeline(episode) {
  const out=[];
  const items=new Map();let lastOpen=null;
  for(const d of episode.decisions || []) { for(const item of [...(d.input?.candidate_pool || []),...(d.rule_input?.candidates || []),...(d.model_input?.tool_results || []).flatMap(result=>result.items || []),...(d.execution_results || []).flatMap(result=>result.result?.items || [])]) if(item?.id)items.set(item.id,item.title || item.id); }

  for (const event of episode.event_log || []) {
    const p=event.payload || {}, simulated=!!p.simulated || p.record_kind==='synthetic';
    const title=event.type === 'exposure' ? (simulated ? (p.phase === 'end' ? '模拟曝光结束' : '模拟看到内容') : (p.phase === 'end' ? '卡片离开视野' : '卡片进入视野')) : (labels[event.type] || event.type);
    let description = p.title || p.text || '';
    if(event.type==='open' && !simulated) lastOpen=event;
    if(event.type==='return' && !simulated && lastOpen?.item_id && lastOpen.item_id===event.item_id) { const elapsed=time(event.occurred_at || event.available_at)-time(lastOpen.occurred_at || lastOpen.available_at); if(elapsed>=0 && time(lastOpen.occurred_at || lastOpen.available_at)) description+=`${description?' · ':''}打开到返回 ${(elapsed/1000).toFixed(1)} 秒（不代表播放时长）`; lastOpen=null; }
    if(event.type==='comment' && p.text) description=`${p.title || '内容'}：${p.text}`;
    if(event.type==='exposure' && p.phase==='end' && Number.isFinite(p.visible_ms)) description += `${description?' · ':''}${simulated?'模拟曝光':`可见 ${(p.visible_ms/1000).toFixed(1)} 秒`}`;
    if(event.type==='scroll') description=`滚动到 ${p.scroll_y ?? '未知'} px`;
    if(event.type==='feed_update') description=`${p.delivery === 'replace_pending'?'调整待看内容':'补充内容'} · 新增 ${(p.added_ids || []).length} 条，移除 ${(p.removed_ids || []).length} 条`;
    out.push({ id:`event:${event.id}`, at:event.occurred_at || event.available_at, sequence:p.sequence, kind:event.type==='exposure'?'exposure':simulated?'simulation':['scroll','feed_update'].includes(event.type)?'system':'user', title, description:shorten(description), status:null, details:{记录:event} });
  }
  for(const message of episode.dialogue_log || []) if(message.origin==='legacy_recorded_at_execution' && !(episode.event_log||[]).some(e=>e.id===message.id)) out.push({id:`legacy:${message.id}`,at:message.available_at,kind:'user',title:'输入指令',description:shorten(message.text),details:{记录:message}});
  for (const decision of episode.decisions || []) {
    const call=decision.model_call || {}, failed=!!decision.failure_id && decision.validation?.valid !== true, incomplete=decision.phase==='incomplete';
    const phase=decision.phase==='plan'?'理解与规划':decision.phase==='rank'?'选择与排序':incomplete?'决策尚未完成':decision.phase==='retrieval'?'获取过程出错':'决策过程出错';
    const output=decision.parsed_output?.actions || [];
    const summary=output.length ? output.map(a=>a.type==='acquire'?`${names[a.source] || a.source || '来源'}${a.query ? `「${a.query}」` : ''}`:a.type==='recommend'?`推荐 ${(a.candidate_ids || []).slice(0,2).map(id=>items.get(id) || id).join('、')}${(a.candidate_ids || []).length>2 ? ` 等 ${a.candidate_ids.length} 条` : ''}`:a.type==='update_state'?`更新${a.topic || '记忆'}：${a.value}`:a.type==='respond'?`回复：${a.text}`:actionNames[a.type] || a.type).join(' · ') : decision.validation?.errors?.[0] || (incomplete?'保留了开始时的输入':'');
    const actual=decision.model_input?.input || decision.rule_input?.snapshot || decision.input || null, state=actual?.state;
    const profile=state ? state.profile || state.memory || (state.interests?.length ? `兴趣 ${state.interests.join('、')}` : '未填写') : '未记录';
    const highlights=actual ? [`指令：${shorten(typeof actual.command==='string' ? actual.command || '无新指令' : '未记录',45)}`, `行为：${Array.isArray(actual.behavior) ? `${actual.behavior.length} 条` : '未记录'}`, `画像：${shorten(profile,45)}`] : [];

    const input={ model_messages:call.messages ?? null, model_input:decision.model_input ?? null, rule_input:decision.rule_input ?? null, original_input_snapshot:decision.input ?? null };
    const result={ raw_output:decision.raw_output ?? null, parsed_output:decision.parsed_output ?? null, validation:decision.validation ?? null, normalized_output:decision.normalized_output ?? null, proposed_state_after:decision.proposed_state_after ?? null, state_after:decision.state_after ?? null };
    if(!incomplete && decision.phase !== 'retrieval' && (call.messages || decision.rule_input || decision.input)) out.push({id:`decision:${decision.decision_id}:input`,at:call.started_at || (decision.phase==='plan' ? decision.input?.captured_at : null) || decision.recorded_at,kind:'agent',title:`Agent · ${phase} · 输入`,description:!call.messages && !decision.rule_input ? '早期记录仅保留输入快照' : '',highlights,details:{输入:input,调用:call}});
    out.push({id:`decision:${decision.decision_id}:output`,at:call.completed_at || decision.recorded_at,kind:'agent',title:`Agent · ${phase}${incomplete || decision.phase === 'retrieval' ? '' : ' · 输出'}`,description:shorten(summary),status:failed?'error':incomplete?'pending':null,details:incomplete?{输入:input}:{输出:result,调用:call}});
    for (let i=0;i<(decision.execution_results || []).length;i++) {
      const execution=decision.execution_results[i], action=execution.action || {}, result=execution.result;
      if(action.type!=='acquire' || !result)continue;
      const source=names[action.source] || action.source || '未知来源', status=execution.status, count=Array.isArray(result.items)?result.items.length:null;
      if(result.started_at) out.push({id:`tool:${decision.decision_id}:${i}:start`,at:result.started_at,kind:'tool',title:`来源工具 · ${source} · 调用`,description:shorten(action.query ? `搜索「${action.query}」` : '获取内容'),details:{调用:action}});
      out.push({id:`tool:${decision.decision_id}:${i}:result`,at:result.completed_at || decision.recorded_at,kind:'tool',title:`来源工具 · ${source} · 结果`,description:shorten(`${count === null ? '返回结果' : `返回 ${count} 条`}${count ? `：${result.items.slice(0,2).map(item=>item.title).filter(Boolean).join('、')}` : ''}${['failed','error'].includes(status)?' · 失败':''}`),status:['failed','error'].includes(status)?'error':null,details:result.started_at?{结果:result}:{调用:action,结果:result}});
    }
  }
  for(const row of episode.simulator_decisions || []) {
    const failed=row.kind==='agent_failure', attempt=row.kind==='agent_attempt';
    if(attempt || !row.attempt_id) out.push({id:`sim:${row.id}:input`,at:row.started_at || row.event_time || row.available_at,sequence:row.sequence,kind:'simulation',title:'模拟用户 · 输入',description:shorten(row.title || ''),details:{输入:{messages:row.messages,model:row.model}}});
    if(!attempt) out.push({id:`sim:${row.id}:output`,at:row.event_time || row.completed_at || row.available_at,sequence:row.sequence,kind:'simulation',title:failed?'模拟用户 · 决策失败':'模拟用户 · 选择操作',description:shorten(row.title || row.error || ''),status:failed?'error':null,details:{输出:{raw_output:row.raw_output,decision:row.decision,error:row.error}}});
  }
  for(const row of episode.state_records || []) {
    const titles={cold_start:'初始化画像',user_edit:'修改画像',controller:'更新记忆'};
    out.push({id:`state:${row.id}`,at:row.event_time || row.available_at,kind:'state',title:titles[row.reason] || '画像状态变化',description:`版本 ${row.state?.version ?? '未知'}`,details:{状态:row.state,记录:row}});
  }
  return out.sort((a,b)=>time(a.at)-time(b.at) || ((a.sequence ?? Infinity)-(b.sequence ?? Infinity)));
}

// Only merge adjacent rows; the original event order and details stay intact.
export function groupTimeline(rows) {
  const groups=[];
  for(const row of rows) {
    const previous=groups.at(-1), currentTime=Date.parse(row.at), lastTime=previous ? Date.parse(previous.items.at(-1).at) : NaN;
    const sameDay=Number.isFinite(currentTime) && Number.isFinite(lastTime) && new Date(currentTime).toDateString()===new Date(lastTime).toDateString();
    if(previous && previous.kind===row.kind && sameDay && currentTime-lastTime>=0 && currentTime-lastTime<=20000) previous.items.push(row);
    else groups.push({id:row.id,kind:row.kind,items:[row]});
  }
  return groups;
}

export function selectTimeline(rows, filter) {
  if (filter === 'actions') return rows.filter(row => row.kind === 'user' || row.kind === 'simulation');
  if (filter === 'viewing') return rows.filter(row => row.kind === 'exposure');
  if (filter === 'agent') return rows.filter(row => row.kind === 'agent' || row.kind === 'tool');
  return rows;
}
