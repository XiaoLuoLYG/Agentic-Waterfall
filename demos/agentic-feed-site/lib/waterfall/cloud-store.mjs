import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { check, exact, VERSION } from './core.mjs';
import { settingsPatch } from './accounts.mjs';
const settings = () => ({ interests:[], sources:[], contentTypes:['text','video','image'], layout:'cards', theme:'light', density:'comfortable', language:'zh' });
const tokenHash = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash('sha256').update(token).digest('hex') : null;
const publicUser = row => ({id:row.id,username:row.username,displayName:row.display_name || row.username,type:row.type,settings:JSON.parse(row.settings),created_at:row.created_at});
export class CloudStore {
  constructor(db) { this.db=db;this.rows=[];this.userId=null; }
  async load(userId,{compact=false}={}) {
    this.userId=userId;
    const query=compact?`SELECT e.sequence,CASE WHEN e.kind='run' THEN json_remove(e.payload,'$.result.trace','$.result.input_snapshot.behavior','$.result.input_snapshot.candidate_pool','$.result.input_snapshot.state','$.result.input_snapshot.available_sources','$.result.input_snapshot.recent_commands',CASE WHEN e.sequence=(SELECT MAX(last.sequence) FROM events last WHERE last.user_id=e.user_id AND last.session_id=e.session_id AND last.kind='run') THEN '$.result.__retained' ELSE '$.result.content_snapshot.items' END) WHEN e.kind='input' THEN json_remove(e.payload,'$.input_snapshot.behavior','$.input_snapshot.candidate_pool','$.input_snapshot.state','$.input_snapshot.available_sources','$.input_snapshot.recent_commands') WHEN e.kind='failure' THEN json_remove(e.payload,'$.partial_trace','$.completed_policy_results') ELSE e.payload END AS payload FROM events e WHERE e.user_id=? AND e.kind<>'decision_trace' ORDER BY e.sequence`:'SELECT sequence,payload FROM events WHERE user_id = ? ORDER BY sequence';
    this.rows=(await this.db.prepare(query).bind(userId).all()).results.map(row=>({...JSON.parse(row.payload),sequence:row.sequence}));
  }
  async loadEvent(userId,{sessionId,referenceId,exposureId}) {
    this.userId=userId;
    const query="SELECT sequence,CASE WHEN kind='run' THEN json_remove(payload,'$.result.trace','$.result.content_snapshot','$.result.input_snapshot') ELSE payload END AS payload FROM events WHERE user_id=? AND session_id=? AND (kind='session' OR (id=? AND kind IN ('run','comparison')) OR (kind='exposure' AND json_extract(payload,'$.exposure_id')=?)) ORDER BY sequence";
    this.rows=(await this.db.prepare(query).bind(userId,typeof sessionId==='string'?sessionId:'',typeof referenceId==='string'?referenceId:'',typeof exposureId==='string'?exposureId:'').all()).results.map(row=>({...JSON.parse(row.payload),sequence:row.sequence}));
  }
  async add(kind,data={}) {
    const row={...data,id:randomUUID(),kind,available_at:new Date().toISOString(),schema_version:VERSION};
    const inserted=await this.db.prepare('INSERT INTO events (id,user_id,session_id,kind,comparison_id,payload) VALUES (?,?,?,?,?,?) RETURNING sequence').bind(row.id,this.userId,row.session_id,kind,row.comparison_id || null,JSON.stringify(row)).first();
    row.sequence=inserted.sequence;this.rows.push(row);return row;
  }
  session(sessionId) { const row=this.rows.find(row=>row.kind==='session'&&row.session_id===sessionId);check(row,'会话不存在，请重新开始',404);return row; }
  state(sessionId) { this.session(sessionId);return this.rows.findLast(row=>row.session_id===sessionId&&row.kind==='state').state; }
  async record(kind,sessionId,data={}) { const s=this.session(sessionId);return this.add(kind,{...data,session_id:sessionId,participant_id:s.participant_id,record_kind:s.record_kind}); }
  async recordIfCurrent(kind,sessionId,data,sequence,owner=null) {
    const s=this.session(sessionId),row={...data,session_id:sessionId,participant_id:s.participant_id,record_kind:s.record_kind,id:randomUUID(),kind,available_at:new Date().toISOString(),schema_version:VERSION};
    const inserted=await this.db.prepare("INSERT INTO events (id,user_id,session_id,kind,comparison_id,payload) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM events WHERE user_id=? AND session_id=? AND sequence>? AND kind IN ('command','feedback')) AND (? IS NULL OR EXISTS (SELECT 1 FROM active_operations WHERE user_id=? AND owner=?)) RETURNING sequence").bind(row.id,this.userId,sessionId,kind,row.comparison_id||null,JSON.stringify(row),this.userId,sessionId,sequence,owner,this.userId,owner).first();
    if(!inserted)return null;row.sequence=inserted.sequence;this.rows.push(row);return row;
  }
}
export class CloudAccounts {
  constructor(db){this.db=db;}
  async selectIdentity(input){
    exact(input,['username','type']);check(typeof input.username==='string'&&input.username.trim()&&[...input.username.trim()].length<=32&&!/[\u0000-\u001f\u007f]/.test(input.username),'用户名无效');check(['human','agent'].includes(input.type),'请选择用户或 Agent');
    const name=input.username.trim().toLowerCase(), createdAt=new Date().toISOString();
    await this.db.prepare('INSERT INTO accounts (id,username,type,settings,created_at) VALUES (?,?,?,?,?) ON CONFLICT(username) DO NOTHING').bind(randomUUID(),name,input.type,JSON.stringify(settings()),createdAt).run();
    const row=await this.db.prepare('SELECT * FROM accounts WHERE username = ?').bind(name).first();check(row.type===input.type,'这个用户名已有不同的账号类型',409);
    const token=randomBytes(32).toString('base64url');await this.db.prepare('INSERT INTO account_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(tokenHash(token),row.id,Date.now()+2592000000).run();return {user:publicUser(row),token};
  }
  async getUser(token){const hash=tokenHash(token);if(!hash)return null;const row=await this.db.prepare('SELECT a.* FROM accounts a JOIN account_sessions s ON s.user_id=a.id WHERE s.token_hash=? AND s.expires_at>?').bind(hash,Date.now()).first();return row?publicUser(row):null;}
  async logout(token){const hash=tokenHash(token);if(hash)await this.db.prepare('DELETE FROM account_sessions WHERE token_hash = ?').bind(hash).run();}
  async updateSettings(userId,patch){const changes=settingsPatch(patch),row=await this.db.prepare('SELECT * FROM accounts WHERE id = ?').bind(userId).first();check(row,'账户不存在',404);const merged={...JSON.parse(row.settings),...changes};await this.db.prepare('UPDATE accounts SET settings = ? WHERE id = ?').bind(JSON.stringify(merged),userId).run();return {...publicUser(row),settings:merged};}
  async updateProfile(userId,patch){exact(patch,['displayName']);check(typeof patch.displayName==='string'&&patch.displayName.trim()&&[...patch.displayName.trim()].length<=40,'显示名无效');await this.db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').bind(patch.displayName.trim(),userId).run();const row=await this.db.prepare('SELECT * FROM accounts WHERE id = ?').bind(userId).first();check(row,'账户不存在',404);return publicUser(row);}
}
