#!/usr/bin/env python3
"""Freeze <=3 dev tasks using only public task IDs; identical scope for all compared methods."""
import argparse,hashlib,json,pathlib,sqlite3,subprocess
from protocol import stable_seed
ROOT=pathlib.Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser();p.add_argument('--prepared',type=pathlib.Path,default=ROOT/'data'/'prepared');p.add_argument('--output',type=pathlib.Path,default=ROOT/'data'/'model-subset')
    p.add_argument('--count',type=int,default=3);p.add_argument('--history-events',type=int,default=64)
    p.add_argument('--fixed-task-ids',type=pathlib.Path,help='Prior public manifest; preserve these exact task IDs without replacement')
    p.add_argument('--top-k',type=int,default=101,choices=[20,101]);a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=False)
    inputs=[json.loads(x) for x in (a.prepared/'public-inputs.jsonl').read_text().splitlines()]
    inputs=[x for x in inputs if ':dev:' in x['observation']['decision_id']]
    missing=[]
    if a.fixed_task_ids:
        requested=json.loads(a.fixed_task_ids.read_text())['task_ids'];byid={x['observation']['decision_id']:x for x in inputs}
        missing=[key for key in requested if key not in byid];inputs=[byid[key] for key in requested if key in byid]
    else:inputs=sorted(inputs,key=lambda x:stable_seed('model:'+x['observation']['decision_id']))[:a.count]
    # Selection above never loads hidden targets, ranks, feedback on current items or results.
    ids=[x['observation']['decision_id'] for x in inputs]
    db=sqlite3.connect(a.prepared/'catalog.sqlite')
    for x in inputs:
        obs=x['observation'];all_events=obs['behavior_events'];obs['behavior_events']=all_events[-a.history_events:]
        for e in obs['behavior_events']:
            v=int(e['item_id'].split(':')[1]);row=db.execute('SELECT payload FROM items WHERE video_id=?',(v,)).fetchone()
            if row:e['payload']['content_metadata']=json.loads(row[0])['text']
        x['run_meta'].update(history_policy=f'last {a.history_events} completed raw events; common scope for SASRec and Waterfall subset',
            archived_history_events=len(all_events),memory_retention='full prepared logs retained; model state persisted; no clearing/forgetting experiment',
            content_scope='basic metadata only; semantic captions not downloaded',selection='lowest seeded SHA256 of eligible public dev task ID, before model output')
        x['protocol']['max_model_calls']=3
        x['protocol'].update(top_k=a.top_k,require_full_ranking=a.top_k==101)
        x['run_meta']['temporal_protocol']=json.loads((a.prepared/'preparation-manifest.json').read_text()).get('protocol_version')
    db.close()
    serialized=''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in inputs)
    checked=subprocess.run(['node',str(ROOT/'scripts'/'preflight.mjs')],input=serialized,text=True,capture_output=True)
    (a.output/'preflight.log').write_text(checked.stdout+checked.stderr)
    if checked.returncode:raise RuntimeError('Actual runtime input preflight failed; see preflight.log')
    (a.output/'public-inputs.jsonl').write_text(serialized)
    # Evaluator-only copy, loaded only after the public selection is frozen.
    tasks=[json.loads(x) for x in (a.prepared/'private-tasks.jsonl').read_text().splitlines()]
    byid={t['task_id']:t for t in tasks};private=[]
    for x in inputs:
        t=byid[x['observation']['decision_id']];t['history']=t['history'][-a.history_events:]
        if a.top_k==20:t['required_ranking_length']=20
        private.append(t)
    (a.output/'private-tasks.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in private))
    synthetic=json.loads((a.prepared/'preparation-manifest.json').read_text()).get('synthetic',False)
    report=dict(kind='smoke' if synthetic else 'subset',synthetic=synthetic,task_ids=ids,n=len(ids),history_event_limit=a.history_events,
        fixed_task_source=str(a.fixed_task_ids) if a.fixed_task_ids else None,unavailable_fixed_task_ids=missing,top_k=a.top_k,
        input_sha256=hashlib.sha256((a.output/'public-inputs.jsonl').read_bytes()).hexdigest(),max_model_requests=3*len(ids),
        scientific_scope='development smoke; no semantic captions; no effectiveness conclusion')
    (a.output/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
