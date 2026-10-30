"""Index Waterfall's frozen KuaiRand test inputs without evaluator labels."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from prepare_mind import METHODS, WORK

HERE = Path(__file__).resolve().parent/'kuairand'
SOURCE = WORK/'output/agentic-waterfall/waterfall-full-20261029/input-preparation/kuairand/public-inputs.jsonl'
LEGACY = WORK/'methods/agentic-waterfall/protocols/kuairand-common-35-caption-v2-20261029/inputs-eligible.jsonl'


def clean(x):
    if isinstance(x, dict): return {k: clean(v) for k,v in x.items() if k != 'caption_status'}
    if isinstance(x, list): return [clean(v) for v in x]
    return x


def public_content(x):
    o=x['observation']
    return clean(o['behavior_events']), clean(o['environment']['candidate_pool'])


def build_index(source, old, output, expected_total, expected_old, expected_hash=None):
    if output.exists(): raise FileExistsError(output)
    with old.open() as f:
        legacy={x['observation']['decision_id']:public_content(x) for x in map(json.loads,f) if ':test:' in x['observation']['decision_id']}
    if len(legacy)!=expected_old: raise ValueError('legacy count mismatch')
    temp=output.with_name(output.name+'.building')
    if temp.exists(): raise FileExistsError(temp)
    db=sqlite3.connect(temp); digest=hashlib.sha256(); c={'total':0,'eligible':0,'legacy':0,'jobs':0}
    try:
        db.executescript('CREATE TABLE tasks (id INTEGER PRIMARY KEY, decision_id TEXT UNIQUE NOT NULL, offset INTEGER NOT NULL, bytes INTEGER NOT NULL, eligible INTEGER NOT NULL, legacy INTEGER NOT NULL); CREATE TABLE jobs (task INTEGER NOT NULL, decision_id TEXT NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT "pending", attempt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(task,method));')
        with source.open('rb') as f:
            while True:
                offset=f.tell();line=f.readline()
                if not line:break
                digest.update(line);x=json.loads(line);obs=x['observation'];decision=obs['decision_id'];history,candidates=public_content(x)
                if ':test:' not in decision or not candidates or len({v['id'] for v in candidates})!=len(candidates):raise ValueError('invalid public test input')
                eligible=sum(e.get('payload',{}).get('long_view')==1 for e in history)>=2; was_old=decision in legacy
                if was_old and (history,candidates)!=legacy[decision]:raise ValueError('legacy input mismatch: '+decision)
                index=c['total'];db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?)',(index,decision,offset,len(line),eligible,was_old))
                if not was_old:
                    rows=[(index,decision,m) for m in METHODS if m!='i2agent' or eligible];db.executemany('INSERT INTO jobs(task,decision_id,method) VALUES(?,?,?)',rows);c['jobs']+=len(rows)
                c['total']+=1;c['eligible']+=eligible;c['legacy']+=was_old
        if c['total']!=expected_total or c['legacy']!=expected_old:raise ValueError('full or legacy count mismatch')
        if expected_hash and digest.hexdigest()!=expected_hash:raise ValueError('full input hash mismatch')
        db.execute('CREATE INDEX job_status ON jobs(status,task,method)');db.commit();c['source_sha256']=digest.hexdigest()
    finally:db.close()
    os.rename(temp,output);return c


if __name__=='__main__':
    HERE.mkdir(exist_ok=True)
    src=json.loads((SOURCE.parent/'manifest.json').read_text())
    result=build_index(SOURCE,LEGACY,HERE/'mind-index.sqlite',617,14,src['input_sha256'])
    (HERE/'mind-index-manifest.json').write_text(json.dumps({**result,'source':str(SOURCE),'legacy_source':str(LEGACY),'split':'test','labels_read':False,'training':False,'comparison_note':'legacy lacks caption_status; all history and candidate content otherwise identical'},indent=2)+'\n')
    print(json.dumps(result))
