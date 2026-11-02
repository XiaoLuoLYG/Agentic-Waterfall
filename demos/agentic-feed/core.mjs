import {exact,check,INTERESTS,short,id} from '../agentic-feed-site/lib/waterfall/core.mjs';
export * from '../agentic-feed-site/lib/waterfall/core.mjs';

// Local file storage is synchronous; cloud storage uses the canonical async entry.
export function startSession(store, input, user = null, previousState = null, previousSessionId = null) {
  exact(input, ['consent', 'recordKind', 'interests', 'profile']); check(input.consent === true, '请先阅读并确认本地记录说明');
  check(['human', 'synthetic'].includes(input.recordKind), '请选择人工记录或合成演示');
  check(Array.isArray(input.interests) && input.interests.length <= (user ? 60 : 3) && input.interests.every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 40 && (user || INTERESTS.includes(x))), '兴趣格式无效');
  const profile = short(input.profile || '', '个人画像');
  const sessionId = id();
  const s = store.add('session', { session_id: sessionId, participant_id: user?.id || id(), user_id: user?.id || null, record_kind: input.recordKind, initial_settings: user?.settings ? structuredClone(user.settings) : null, consent_version: 'local-v2', event_time: new Date().toISOString() });
  const entries=structuredClone(previousState?.entries || []).map(entry=>entry.lifetime==='session'&&!entry.origin_session_id?{...entry,origin_session_id:previousSessionId}:entry);
  if(previousState?.context)entries.push({type:'update_state',target:'context',value:previousState.context,scope:'session',topic:'会话情境',lifetime:'session',origin:'session_archive',origin_session_id:previousSessionId,evidence_ids:[]});
  const state = { version: 1, profile: previousState?.profile || profile, memory: previousState?.memory || '', context: '', interests: [...new Set(input.interests.map(x => x.trim()))], entries };
  store.record('state', sessionId, { state, reason: 'cold_start' }); return s;
}
