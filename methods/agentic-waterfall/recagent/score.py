"""Score frozen RecAgent output via the pinned official HR evaluator."""
import argparse,hashlib,json,sys
from pathlib import Path
from bench_paths import resolve_paths,ROOT
sys.path.insert(0,str(ROOT/'experiments/agentic-waterfall/agentrecbench/scripts'))
sys.path.insert(0,str(ROOT/'methods/agentic-waterfall'))
from official_components import load_components
from resource_report import collect_runs
from error_policy import operational_failure

def safe_predictions(tasks,rows):
    lookup={r['task_id']:r for r in rows}
    if len(lookup)!=len(rows):raise ValueError('duplicate results')
    if set(lookup)!={x['task_id'] for x in tasks}:raise ValueError('missing or unexpected results')
    if any(operational_failure(row) for row in rows):raise ValueError('operationally incomplete results')
    predictions=[];invalid=[]
    for task in tasks:
        row=lookup.get(task['task_id'],{});rank=row.get('ordered_item_ids',[]);ids=task['candidates']
        valid=row.get('status')=='submitted' and isinstance(rank,list) and len(rank)==len(ids) and all(isinstance(x,str) for x in rank) and len(set(rank))==len(rank) and set(rank)==set(ids)
        predictions.append(rank if valid else [])
        if not valid:invalid.append(task['task_id'])
    return predictions,invalid

def missing_summary(rows):
    return {'tasks_with_missing_items':sum(bool(r.get('missing_item_ids')) for r in rows),'missing_item_occurrences':sum(len(r.get('missing_item_ids',[])) for r in rows),'tasks_with_missing_user':sum(bool(r.get('missing_user_ids')) for r in rows),'basis':'metadata accessed in completed result files'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--batch',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    batch=Path(a.batch);manifest_bytes=(batch/'manifest.json').read_bytes();m=json.loads(manifest_bytes);paths=resolve_paths(m['domain'],True);tasks=[];rows=[];hashes={};runs=[]
    for entry in m['tasks']:
        taskid=entry['task_id'];path=paths['taskdir']/'tasks'/f'task_{taskid}.json';raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('public task changed since freeze')
        task=json.loads(raw);tasks.append({'task_id':taskid,'candidates':task['candidate_list']});run=batch/f'task-{taskid:06d}';runs.append(run)
        file=run/'result.json'
        if file.exists():
            data=file.read_bytes();row=json.loads(data)
            if row.get('task_id')!=taskid:raise ValueError('result task mismatch')
            rows.append(row);hashes[str(taskid)]=hashlib.sha256(data).hexdigest()
    predictions,invalid=safe_predictions(tasks,rows)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    (out/'frozen.json').write_text(json.dumps({'batch_manifest_sha256':hashlib.sha256(manifest_bytes).hexdigest(),'result_sha256':hashes,'tasks':len(tasks),'labels_accessed':False},indent=2)+'\n')
    labels=[]
    for t in tasks:
        label=json.loads((paths['taskdir']/'groundtruth'/f"groundtruth_{t['task_id']}.json").read_text())['ground truth']
        if label not in t['candidates']:raise ValueError('label not in candidates')
        labels.append(label)
    metric=load_components().RecommendationEvaluator().calculate_hr_at_n(labels,predictions,0).__dict__
    result={'method':'recagent-candidate-complete','domain':m['domain'],'tasks':len(tasks),'metrics':metric,'invalid_task_ids':invalid,'invalid_fallback':'empty ranking; retained in denominator','missing_metadata_observed':missing_summary(rows),'resource_usage':collect_runs(runs),'labels_accessed_after_freeze':True}
    (out/'metrics.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'tasks':len(tasks),'invalid':len(invalid),'output':str(out)}))
if __name__=='__main__':main()
