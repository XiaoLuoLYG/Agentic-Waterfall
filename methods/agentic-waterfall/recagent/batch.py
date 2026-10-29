"""Freeze and optionally run RecAgent's full short-window public task set."""
import argparse,hashlib,json,re,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from error_policy import operational_failure
from bench_paths import resolve_paths

def freeze_tasks(path):
    entries=[]
    for p in Path(path).glob('task_*.json'):
        m=re.fullmatch(r'task_(\d+)\.json',p.name)
        if not m:raise ValueError('invalid task filename')
        raw=p.read_bytes();task=json.loads(raw);c=task.get('candidate_list',[])
        if task.get('type')!='recommendation' or len(c)!=20 or len(set(c))!=20:raise ValueError('invalid task')
        entries.append({'task_id':int(m.group(1)),'sha256':hashlib.sha256(raw).hexdigest()})
    entries.sort(key=lambda x:x['task_id'])
    if not entries or len({x['task_id'] for x in entries})!=len(entries):raise ValueError('empty or duplicate tasks')
    return entries

def select_tasks(tasks,ids):
    if not isinstance(ids,list) or any(type(x) is not int for x in ids) or len(set(ids))!=len(ids):raise ValueError('invalid task selection')
    wanted=set(ids);known={x['task_id'] for x in tasks}
    if not wanted or not wanted<=known:raise ValueError('unknown or empty task selection')
    return [x for x in tasks if x['task_id'] in wanted]

def main():
    p=argparse.ArgumentParser();p.add_argument('--domain',choices=['amazon','yelp','goodreads'],required=True);p.add_argument('--index',required=True);p.add_argument('--output',required=True);p.add_argument('--count',type=int);p.add_argument('--task-ids',help='JSON list selected before evaluation');p.add_argument('--allow-missing-metadata',action='store_true');p.add_argument('--execute',action='store_true');a=p.parse_args()
    if a.domain=='yelp':a.allow_missing_metadata=True
    paths=resolve_paths(a.domain,True);taskdir=paths['taskdir'];index=Path(a.index).resolve()
    if not (taskdir/'download-manifest.json').exists() or not index.is_file():raise ValueError('verified task set and index required')
    tasks=freeze_tasks(taskdir/'tasks');expected=json.loads((taskdir/'download-manifest.json').read_text())['task_ids']
    if [x['task_id'] for x in tasks]!=expected:raise ValueError('task set no longer matches manifest')
    if a.task_ids:
        if a.count is not None:raise ValueError('choose count or task IDs')
        tasks=select_tasks(tasks,json.loads(Path(a.task_ids).read_text()))
    if a.count is not None:
        if not 1<=a.count<=len(tasks):raise ValueError('invalid count')
        tasks=tasks[:a.count]
    h=hashlib.sha256()
    with index.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    manifest={'schema':'recagent-batch-v1','domain':a.domain,'scenario':'short_term','method':'recagent-candidate-complete','tasks':tasks,'index_sha256':h.hexdigest(),'labels_read_for_selection':False,'training':False,'allow_missing_metadata':a.allow_missing_metadata,'nominal_model_requests':len(tasks)}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','tasks':len(tasks),'domain':a.domain}));return
    done=0;submitted=0
    for row in tasks:
        run=out/f"task-{row['task_id']:06d}";cmd=[sys.executable,str(Path(__file__).with_name('agentrecbench_smoke.py')),'--domain',a.domain,'--full-tasks','--index',str(index),'--task-id',str(row['task_id']),'--output',str(run)]
        if a.allow_missing_metadata:cmd.append('--allow-missing-metadata')
        proc=subprocess.run(cmd,capture_output=True,text=True);done+=1
        if run.is_dir():(run/'batch-process.log').write_text(proc.stdout+proc.stderr)
        r=json.loads((run/'result.json').read_text()) if (run/'result.json').exists() else {'status':'failed','error':'runner_before_result'};submitted+=r.get('status')=='submitted'
        if operational_failure(r):break
    status={'attempted':done,'submitted':submitted,'planned':len(tasks),'all_submitted':submitted==len(tasks)};(out/'batch-status.json').write_text(json.dumps(status,indent=2)+'\n');print(json.dumps(status))
    if not status['all_submitted']:raise SystemExit(1)
if __name__=='__main__':main()
