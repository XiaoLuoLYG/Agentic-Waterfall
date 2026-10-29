"""Freeze all official AgentRecBench tasks and run eligible i2Agent inputs."""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
from agentrecbench_data import prepare_from_tool
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
sys.path[:0]=[str(ROOT/'methods/agentic-waterfall/recagent'),str(ROOT/'methods/agentic-waterfall/agentrecbench-data')]
from bench_paths import resolve_paths
from indexed_tool import IndexedTool
sys.path.insert(0,str(ROOT/'methods/agentic-waterfall'))
from error_policy import operational_failure

def task_ids(official,chosen=None):
    if chosen is None:return official
    if not chosen or len(set(chosen))!=len(chosen) or not set(chosen)<=set(official):raise ValueError('invalid task selection')
    return [i for i in official if i in set(chosen)]
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--domain',choices=['amazon','yelp','goodreads'],required=True);p.add_argument('--index',required=True);p.add_argument('--output',required=True);p.add_argument('--task-id',type=int,action='append');p.add_argument('--execute',action='store_true');a=p.parse_args()
    paths=resolve_paths(a.domain,True);taskdir=paths['taskdir'];index=Path(a.index).resolve();official=json.loads((taskdir/'download-manifest.json').read_text())['task_ids'];chosen=task_ids(official,a.task_id);ordering='file' if a.domain in ('yelp','goodreads') else 'timestamp';out=Path(a.output);out.mkdir(parents=True,exist_ok=False);tool=IndexedTool(paths['data'],index,taskdir);records=[]
    try:
        for tid in chosen:
            public=taskdir/'tasks'/f'task_{tid}.json';raw=public.read_bytes();task=json.loads(raw);history=tool.get_reviews(user_id=task['user_id']);entry={'task_id':tid,'public_task_sha256':hashlib.sha256(raw).hexdigest(),'history_count':len(history)};folder=out/f'task-{tid:06d}';folder.mkdir()
            if len(history)<2:
                entry.update(status='not_applicable',reason='fewer_than_two_available_reviews');(folder/'result.json').write_text(json.dumps({'method':'i2agent','task_id':tid,'status':'not_applicable','reason':entry['reason']},indent=2)+'\n')
            else:
                projected,mapping=prepare_from_tool(task,tool,ordering=ordering,allow_id_only=a.domain=='yelp');payload={'source':f'AgentRecBench {a.domain} short_term','task_id':tid,'task':projected,'candidate_id_by_index':mapping,'history_order':ordering,'target_time_verified':False,'missing_metadata_policy':'public ID only' if a.domain=='yelp' else 'strict public metadata'};data=(json.dumps(payload,ensure_ascii=False,indent=2)+'\n').encode();(folder/'input.json').write_bytes(data);entry.update(status='eligible',input_sha256=hashlib.sha256(data).hexdigest())
            records.append(entry)
    finally:tool.close()
    manifest={'method':'i2agent-author-adapted','domain':a.domain,'scenario':'short_term','records':records,'index_sha256':sha(index),'preparation_sha256':sha(HERE/'agentrecbench_data.py'),'adapter_sha256':sha(HERE/'adapter.py'),'ordering':ordering,'not_applicable_rule':'fewer than two available reviews','masking':'official target-pair exclusion','labels_used_for_selection':False,'training':False,'nominal_model_requests':5*sum(x['status']=='eligible' for x in records)};(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','tasks':len(records),'eligible':sum(x['status']=='eligible' for x in records)}));return
    attempted=submitted=0
    for entry in records:
        if entry['status']!='eligible':continue
        folder=out/f"task-{entry['task_id']:06d}";raw=(folder/'input.json').read_bytes()
        if hashlib.sha256(raw).hexdigest()!=entry['input_sha256'] or sha(index)!=manifest['index_sha256'] or sha(HERE/'agentrecbench_data.py')!=manifest['preparation_sha256'] or sha(HERE/'adapter.py')!=manifest['adapter_sha256']:raise ValueError('frozen input or source changed')
        run=folder/'run';proc=subprocess.run([sys.executable,str(HERE/'live_smoke.py'),'--input',str(folder/'input.json'),'--output',str(run),'--rank-max-tokens','4096'],capture_output=True,text=True);(folder/'process.log').write_text(proc.stdout+proc.stderr);attempted+=1
        result=json.loads((run/'result.json').read_text()) if (run/'result.json').exists() else {'status':'failed','error':'runner_before_result'};result['task_id']=entry['task_id'];(folder/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');submitted+=result.get('status')=='submitted'
        if operational_failure(result):break
    summary={'tasks':len(records),'eligible':sum(x['status']=='eligible' for x in records),'not_applicable':sum(x['status']=='not_applicable' for x in records),'attempted':attempted,'submitted':submitted};(out/'batch-status.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary));
    if attempted!=summary['eligible'] or submitted!=attempted:raise SystemExit(1)
if __name__=='__main__':main()
