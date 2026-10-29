"""Freeze public SimBench cases and optionally run each user's sequential events."""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
from case_input import load_case
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from error_policy import operational_failure

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def plan(cases,snapshot):
    manifest=json.loads((snapshot/'manifest.json').read_text());digest=sha(snapshot/'catalog.jsonl')
    if digest!=manifest['catalog_sha256']:raise ValueError('snapshot changed')
    records=[]
    for folder in sorted(cases.glob('group_*__user_*/event_*/input')):
        data=load_case(folder);active=sorted(set(data['allowed_sources'])&set(manifest['sources']))
        if not active:raise ValueError('no shared source for '+data['case_id'])
        records.append({'case_id':data['case_id'],'user_id':data['user_id'],'event':data['event'],'input':str(folder.resolve()),'active_sources':active,'input_hashes':{n:sha(folder/n) for n in ('manifest.json','allowed_sources.json','budget.json','evidence.visible.jsonl')}})
    if not records:raise ValueError('no cases')
    seen={}
    for r in records:
        user=r['user_id'];expected=seen.get(user,0)+1
        if r['event']!=expected:raise ValueError('incomplete or duplicate user sequence')
        seen[user]=expected
    sources=('batch.py','run_round.mjs','round.mjs','sequence.mjs','coverage.mjs','case_input.py','runtime_input.py','search_cli.py','catalog.py','../clawrec/source-snapshot/clawrec-synthesizing-user-state/SKILL.md','../clawrec/source-snapshot/clawrec-making-content-plan/SKILL.md','../clawrec/source-snapshot/clawrec-curating-display-data/SKILL.md')
    return {'schema':'simbench-batch-v1','snapshot_sha256':digest,'source_hashes':{name:sha(Path(__file__).parent/name) for name in sources},'cases':records,'labels_read':False,'training':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('--cases',required=True);p.add_argument('--snapshot',required=True);p.add_argument('--method',choices=('clawrec','generic-agent'),required=True);p.add_argument('--output',required=True);p.add_argument('--execute',action='store_true');a=p.parse_args()
    cases=Path(a.cases);snapshot=Path(a.snapshot).resolve();m=plan(cases,snapshot);m['method']=a.method;out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=False);(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','cases':len(m['cases'])}));return
    state={};failed=set();results=[]
    for row in m['cases']:
        user=row['user_id'];dest=out/row['case_id']
        if user in failed:results.append({'case_id':row['case_id'],'status':'blocked_by_previous_failure'});continue
        if any(sha(Path(row['input'])/n)!=h for n,h in row['input_hashes'].items()) or sha(snapshot/'catalog.jsonl')!=m['snapshot_sha256'] or any(sha(Path(__file__).parent/n)!=h for n,h in m['source_hashes'].items()):raise ValueError('input or source changed after freeze')
        cmd=['node',str(Path(__file__).with_name('run_round.mjs')),a.method,row['input'],str(snapshot),str(dest)]
        if row['event']>1:cmd.append(str(state[user]))
        run=subprocess.run(cmd,capture_output=True,text=True);result=json.loads((dest/'result.json').read_text()) if (dest/'result.json').exists() else {'status':'failed','error':'runner_before_result'};status=result['status']
        results.append({'case_id':row['case_id'],'status':status,'exit_code':run.returncode})
        (out/'progress.json').write_text(json.dumps(results,indent=2)+'\n')
        if run.returncode or status not in ('submitted','no_delivery'):failed.add(user)
        else:state[user]=dest/'next-state.json'
        if operational_failure(result):break
    print(json.dumps({'attempted':len(results),'failures':sum(x['status'] not in ('submitted','no_delivery') for x in results)}))
if __name__=='__main__':main()
