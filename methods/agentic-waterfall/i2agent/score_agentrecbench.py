"""Score complete i2Agent and optional RecAgent runs on the same eligible tasks."""
import argparse,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'methods/agentic-waterfall/recagent'),str(ROOT/'experiments/agentic-waterfall/agentrecbench/scripts'),str(ROOT/'methods/agentic-waterfall')]
from bench_paths import resolve_paths
from score import safe_predictions
from official_components import load_components
from resource_report import collect_runs
from error_policy import operational_failure

def classify(records,results):
    eligible=[];excluded=[]
    for r in records:
        tid=r['task_id'];result=results.get(tid)
        if not result:raise ValueError('batch incomplete: '+str(tid))
        if r['status']=='not_applicable':
            if result.get('status')!='not_applicable':raise ValueError('inapplicable status mismatch')
            excluded.append(tid)
        elif r['status']=='eligible':
            if result.get('status') not in ('submitted','failed'):raise ValueError('eligible result status invalid')
            if operational_failure(result):raise ValueError('operationally incomplete task')
            eligible.append(tid)
        else:raise ValueError('invalid input status')
    if not eligible:raise ValueError('no applicable tasks')
    return eligible,excluded

def main():
    p=argparse.ArgumentParser();p.add_argument('--i2-batch',required=True);p.add_argument('--recagent-batch');p.add_argument('--output',required=True);a=p.parse_args();base=Path(a.i2_batch);mb=(base/'manifest.json').read_bytes();m=json.loads(mb);paths=resolve_paths(m['domain'],True);byid={r['task_id']:r for r in m['records']};results={};hashes={};runs=[]
    for tid in byid:
        folder=base/f'task-{tid:06d}';f=folder/'result.json'
        if f.exists():
            raw=f.read_bytes();results[tid]=json.loads(raw);hashes[str(tid)]=hashlib.sha256(raw).hexdigest()
            if results[tid].get('task_id')!=tid:raise ValueError('task result mismatch')
        if byid[tid]['status']=='eligible':runs.append(folder/'run')
    eligible,excluded=classify(m['records'],results);tasks=[]
    for tid in eligible:
        raw=(paths['taskdir']/'tasks'/f'task_{tid}.json').read_bytes()
        if hashlib.sha256(raw).hexdigest()!=byid[tid]['public_task_sha256']:raise ValueError('official task changed')
        tasks.append({'task_id':tid,'candidates':json.loads(raw)['candidate_list']})
    methods={'i2agent':{'rows':[results[i] for i in eligible],'runs':runs}};rec_hashes={};rec_manifest_sha=None
    if a.recagent_batch:
        other=Path(a.recagent_batch);rec_manifest_raw=(other/'manifest.json').read_bytes();rm=json.loads(rec_manifest_raw);rec_manifest_sha=hashlib.sha256(rec_manifest_raw).hexdigest()
        if rm['domain']!=m['domain']:raise ValueError('different domains')
        frozen={r['task_id']:r['sha256'] for r in rm['tasks']};other_rows=[];other_runs=[]
        for task in tasks:
            tid=task['task_id'];f=other/f'task-{tid:06d}'/'result.json'
            if frozen.get(tid)!=byid[tid]['public_task_sha256'] or not f.exists():raise ValueError('comparison incomplete or different task')
            raw=f.read_bytes();r=json.loads(raw)
            if r.get('task_id')!=tid or r.get('status') not in ('submitted','failed') or operational_failure(r):raise ValueError('invalid or incomplete comparison result')
            other_rows.append(r);other_runs.append(f.parent);rec_hashes[str(tid)]=hashlib.sha256(raw).hexdigest()
        methods['recagent']={'rows':other_rows,'runs':other_runs}
    prepared={name:safe_predictions(tasks,x['rows']) for name,x in methods.items()};out=Path(a.output);out.mkdir(parents=True,exist_ok=False);(out/'frozen.json').write_text(json.dumps({'i2_manifest_sha256':hashlib.sha256(mb).hexdigest(),'i2_result_sha256':hashes,'recagent_manifest_sha256':rec_manifest_sha,'recagent_result_sha256':rec_hashes,'eligible_ids':eligible,'not_applicable_ids':excluded,'labels_accessed':False},indent=2)+'\n')
    labels=[json.loads((paths['taskdir']/'groundtruth'/f'groundtruth_{t["task_id"]}.json').read_text())['ground truth'] for t in tasks]
    if any(label not in task['candidates'] for label,task in zip(labels,tasks)):raise ValueError('target not in candidates')
    evaluator=load_components().RecommendationEvaluator();summary={}
    for name,(predictions,invalid) in prepared.items():summary[name]={'metrics':evaluator.calculate_hr_at_n(labels,predictions,0).__dict__,'invalid_task_ids':invalid,'resource_usage':collect_runs(methods[name]['runs'])}
    (out/'metrics.json').write_text(json.dumps({'domain':m['domain'],'scope':'matched i2Agent-applicable subset','eligible':len(eligible),'not_applicable':len(excluded),'excluded_ids':excluded,'methods':summary,'invalid_fallback':'empty ranking; retained in eligible denominator','labels_accessed_after_freeze':True},indent=2)+'\n');print(json.dumps({'eligible':len(eligible),'not_applicable':len(excluded),'methods':list(methods)}))
if __name__=='__main__':main()
