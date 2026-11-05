import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,writeFileSync,renameSync,copyFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const names=['primary','secondary','tertiary'];
const columns=r=>[r.id,r.experiment,r.status,r.credential_slot||'primary',r.credential_fingerprint??null,
  r.completed_at??null,r.http_request_started_at??null,r.provider_response_model??null,
  r.http_error?.status??null,Number(r.http_error?.type==='budget_exceeded'&&r.http_error.retryable===false),JSON.stringify(r)];
const insert='INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?)';

export function initializeLedger(file){
  if(existsSync(file+'.sqlite.enabled'))throw Error('ledger_already_migrated');
  const original=JSON.parse(readFileSync(file,'utf8'));
  if(existsSync(file+'.sqlite'))throw Error('inspect_existing_sqlite_ledger');
  copyFileSync(file,file+'.before-sqlite');
  const db=new DatabaseSync(file+'.sqlite');
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE attempts(id TEXT PRIMARY KEY,experiment TEXT,status TEXT,slot TEXT,fingerprint TEXT,
      completed TEXT,http_started TEXT,provider_model TEXT,http_status INTEGER,quota INTEGER,record TEXT NOT NULL);
    CREATE INDEX active_slots ON attempts(status,slot);
    CREATE INDEX experiment_count ON attempts(experiment);
    CREATE INDEX route_history ON attempts(slot,fingerprint,completed);
    CREATE TABLE receipts(id TEXT PRIMARY KEY,record TEXT NOT NULL); BEGIN IMMEDIATE;`);
  const {attempts,...settings}=original;
  const put=db.prepare(insert);
  for(const row of attempts)put.run(...columns(row));
  const meta=db.prepare('INSERT INTO meta VALUES(?,?)');
  meta.run('settings',JSON.stringify(settings));meta.run('revision','0');meta.run('exported_revision','0');
  db.exec('COMMIT');db.close();
  writeFileSync(file+'.sqlite.enabled',JSON.stringify({schema:1})+'\n',{flag:'wx'});
  return attempts.length;
}

export function openLedger(file){
  if(!existsSync(file+'.sqlite.enabled'))return null;
  const db=new DatabaseSync(file+'.sqlite',{timeout:0});
  db.exec('PRAGMA synchronous=FULL;');
  const statements=new Map();
  const stmt=sql=>{if(!statements.has(sql))statements.set(sql,db.prepare(sql));return statements.get(sql);};
  const meta=key=>stmt('SELECT value FROM meta WHERE key=?').get(key).value;
  const settings=()=>JSON.parse(meta('settings'));
  async function write(fn){
    const deadline=Date.now()+10000;
    for(;;){
      try{return fn();}
      catch(error){
        if((error.errcode&255)!==5||Date.now()>=deadline)throw error;
        await delay(25+Math.floor(Math.random()*25));
      }
    }
  }
  function transaction(fn){return write(()=>{
    db.exec('BEGIN IMMEDIATE');
    try{const result=fn();if(result!==null)stmt("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}
  });}
  function available(attempt,control,dual,credentialCount){
    const s=settings();
    if(control.model_calls_enabled===false)throw Error('model_calls_not_enabled');
    if(!Number.isSafeInteger(s.limit)||s.limit<1)throw Error('invalid_global_request_limit');
    if(!Number.isSafeInteger(s.max_concurrent)||s.max_concurrent<1||s.max_concurrent>10)throw Error('invalid_max_concurrent');
    if(stmt('SELECT count(*) AS n FROM attempts').get().n>=s.limit)throw Error('global_request_budget_exhausted');
    if(stmt('SELECT count(*) AS n FROM attempts WHERE experiment=?').get(attempt.experiment).n>=(control.model_request_limit||0))throw Error('experiment_request_budget_exhausted');
    const active=stmt("SELECT slot,count(*) AS n FROM attempts WHERE status='in_progress' GROUP BY slot").all();
    const total=active.reduce((n,r)=>n+r.n,0);
    if(dual&&s.max_concurrent_per_credential!==undefined){
      const caps=Object.fromEntries(names.slice(0,credentialCount).map(slot=>[slot,s.credential_policy?.max_concurrent?.[slot]??s.credential_concurrency_overrides?.[slot]??s.max_concurrent_per_credential]));
      if(Object.values(caps).some(n=>!Number.isSafeInteger(n)||n<1||n>16))throw Error('invalid_credential_concurrency');
      return total<Object.values(caps).reduce((a,b)=>a+b,0)&&(active.find(r=>r.slot===attempt.credential_slot)?.n??0)<caps[attempt.credential_slot];
    }
    return total<s.max_concurrent;
  }
  return {
    settings,
    close:()=>db.close(),
    reserve(attempt,control,dual,credentialCount){
      if(!available(attempt,control,dual,credentialCount))return null;
      return transaction(()=>{
        if(!available(attempt,control,dual,credentialCount))return null;
        stmt(insert).run(...columns(attempt));return attempt;
      });
    },
    update(id,patch,receipt){return transaction(()=>{
      const row=stmt('SELECT record FROM attempts WHERE id=?').get(id);if(!row)throw Error('unknown_ledger_attempt');
      const value={...JSON.parse(row.record),...patch};
      stmt('UPDATE attempts SET experiment=?,status=?,slot=?,fingerprint=?,completed=?,http_started=?,provider_model=?,http_status=?,quota=?,record=? WHERE id=?').run(...columns(value).slice(1),id);
      if(receipt)stmt('INSERT OR REPLACE INTO receipts VALUES(?,?)').run(id,JSON.stringify(receipt));
      return value;
    });},
    providerLimit(slot,fingerprint,field,limit){return transaction(()=>{
      const s=settings(),p=s.credential_policy;
      if(!p||!Number.isSafeInteger(limit)||limit<1||p.fingerprints?.[slot]&&p.fingerprints[slot]!==fingerprint)return null;
      p[field][slot]=Math.min(p[field][slot],limit);
      (p.observed_provider_limits??={})[slot]={...(p.observed_provider_limits[slot]||{}),[field]:limit,observed_at:new Date().toISOString()};
      stmt("UPDATE meta SET value=? WHERE key='settings'").run(JSON.stringify(s));return true;
    });},
    rejected(routes,kind){
      const unavailable=new Set();
      routes.forEach((route,index)=>{
        const identity='slot=? AND (fingerprint=? OR (fingerprint IS NULL AND ?))';
        const params=[names[index],route.fingerprint,Number(!route.replacesCredential)];
        const rejection=stmt('SELECT max(completed) AS at FROM attempts WHERE '+identity+
          (kind==='budget'?' AND quota=1':' AND http_status IN (401,403)')).get(...params).at;
        if(rejection&&!stmt("SELECT 1 FROM attempts WHERE "+identity+" AND status='success' AND http_started>? LIMIT 1").get(...params,rejection))unavailable.add(index);
      });return unavailable;
    },
    receipt:id=>{const r=stmt('SELECT record FROM receipts WHERE id=?').get(id);return r?JSON.parse(r.record):null;},
    attempt:id=>{const r=stmt('SELECT record FROM attempts WHERE id=?').get(id);return r?JSON.parse(r.record):null;},
    spare(slot,available){
      const s=settings(),caps=s.credential_policy?.max_concurrent||s.credential_concurrency_overrides||{};
      const active=new Map(stmt("SELECT slot,count(*) AS n FROM attempts WHERE status='in_progress' GROUP BY slot").all().map(r=>[r.slot,r.n]));
      return available.some(name=>name!==slot&&(active.get(name)||0)<(caps[name]??s.max_concurrent_per_credential));
    },
    pick(available,preferred){
      const s=settings(),caps=s.credential_policy?.max_concurrent||s.credential_concurrency_overrides||{};
      const active=new Map(stmt("SELECT slot,count(*) AS n FROM attempts WHERE status='in_progress' GROUP BY slot").all().map(r=>[r.slot,r.n]));
      return [...available].sort((a,b)=>(active.get(a)||0)/(caps[a]??s.max_concurrent_per_credential)
        -(active.get(b)||0)/(caps[b]??s.max_concurrent_per_credential)||(a===preferred?-1:b===preferred?1:0))[0];
    },
    revision:()=>Number(meta('revision')),
    async published(){
      const revision=Number(meta('revision')),deadline=Date.now()+10000;
      while(Number(meta('exported_revision'))<revision){if(Date.now()>deadline)throw Error('ledger_snapshot_pending_durable_receipt_retained');await delay(25);}
    },
    async exportSnapshot(){
      db.exec('BEGIN');
      let revision,header,rows;
      try{revision=Number(meta('revision'));if(revision<=Number(meta('exported_revision'))){db.exec('COMMIT');return false;}
        header=meta('settings');rows=stmt('SELECT record FROM attempts ORDER BY rowid').all();db.exec('COMMIT');}
      catch(error){db.exec('ROLLBACK');throw error;}
      const temporary=file+'.'+randomUUID()+'.tmp';
      writeFileSync(temporary,header.slice(0,-1)+',"attempts":['+rows.map(r=>r.record).join(',')+']}\n');renameSync(temporary,file);
      await write(()=>stmt("UPDATE meta SET value=? WHERE key='exported_revision'").run(String(revision)));return true;
    },
  };
}
