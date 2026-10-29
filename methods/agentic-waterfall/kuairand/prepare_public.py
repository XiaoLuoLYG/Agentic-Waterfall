"""Freeze all prepared public tasks with the existing last-64-event policy; never read target labels."""
import hashlib,json,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];DATA=ROOT/'datasets/agentic-waterfall/kuairand-1k';SRC=DATA/'prepared-v2';OUT=DATA/'model-36-public-v2'

def main():
    raw=(SRC/'public-inputs.jsonl').read_bytes();rows=[json.loads(x) for x in raw.splitlines()];db=sqlite3.connect(f'file:{SRC / "catalog.sqlite"}?mode=ro',uri=True)
    with db:
        for row in rows:
            obs=row['observation'];all_events=obs['behavior_events'];obs['behavior_events']=all_events[-64:]
            for e in obs['behavior_events']:
                v=int(e['item_id'].split(':')[1]);found=db.execute('SELECT payload FROM items WHERE video_id=?',(v,)).fetchone()
                if found:e['payload']['content_metadata']=json.loads(found[0])['text']
            row['run_meta'].update(history_policy='last 64 completed observed events',archived_history_events=len(all_events),content_scope='basic metadata; captions will be added only after source verification',selection='all existing v2 public tasks; no target-dependent selection')
    db.close();data=''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows).encode();ids=[r['observation']['decision_id'] for r in rows]
    if len(rows)!=36 or len(ids)!=len(set(ids)):raise ValueError('unexpected public tasks')
    OUT.mkdir(exist_ok=False);(OUT/'public-inputs.jsonl').write_bytes(data);(OUT/'manifest.json').write_text(json.dumps({'rows':len(rows),'source_sha256':hashlib.sha256(raw).hexdigest(),'public_sha256':hashlib.sha256(data).hexdigest(),'task_ids':ids,'labels_read':False,'history_limit':64},indent=2)+'\n');print(json.dumps({'tasks':len(rows),'sha256':hashlib.sha256(data).hexdigest()}))
if __name__=='__main__':main()
