"""Freeze and run the existing KuaiRec ClawRec or generic-agent adaptation."""
import argparse,hashlib,json,subprocess
from pathlib import Path
from error_policy import operational_failure
ROOT=Path(__file__).resolve().parent
WORKSPACE=ROOT.parents[1]

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def prediction(user,method,result,searches):
    acquired=[]
    for search in searches:
        for item in search['output']['items']:
            item_id=str(item['id'])
            if item_id in acquired:raise ValueError('duplicate acquired item')
            acquired.append(item_id)
    status=result.get('status','missing');ids=result.get('ordered_item_ids',[]) if status=='submitted' else []
    if not isinstance(ids,list) or len(ids)>10 or len(ids)!=len(set(ids)) or not set(ids)<=set(acquired) or len(acquired)>100:raise ValueError('invalid ranking or retrieval')
    return {'user_id':user,'method':method,'status':status,'acquisition_required':True,'ordered_item_ids':ids,'acquired_item_ids':acquired}

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--method',choices=('clawrec','generic-agent'),required=True);p.add_argument('--output',required=True);p.add_argument('--execute',action='store_true');p.add_argument('--resume',action='store_true');p.add_argument('--limit',type=int,help='diagnostic first N users; omit for complete split');a=p.parse_args()
    inp=Path(a.input).resolve();lines=[json.loads(x) for x in inp.read_text().splitlines() if x.strip()];full_total=len(lines)
    if a.limit is not None:
        if a.limit<1 or a.limit>full_total:raise ValueError('invalid limit')
        lines=lines[:a.limit]
    users=[r['observation']['user_id'] for r in lines]
    if not lines or len(users)!=len(set(users)):raise ValueError('missing or duplicate users')
    out=Path(a.output).resolve();run_token=hashlib.sha256(str(out).encode()).hexdigest()[:10]
    sources=[ROOT/a.method/'kuairec_run.mjs',ROOT/'kuairec-input.mjs',WORKSPACE/'experiments/agentic-waterfall/kuairec/scripts/acquire_cli.py',WORKSPACE/'experiments/agentic-waterfall/kuairec/scripts/retrieval.py',WORKSPACE/'experiments/agentic-waterfall/kuairec/data/processed/catalog.json',WORKSPACE/'experiments/agentic-waterfall/kuairec/data/processed/eligibility.npz',Path(__file__)]
    if a.method=='clawrec':sources+=[ROOT/'clawrec/plan.mjs',ROOT/'clawrec/kuairec_data.py',ROOT/'clawrec/source-snapshot/clawrec-making-content-plan/references/planning-rubric.md']+list((ROOT/'clawrec/source-snapshot').glob('*/SKILL.md'))
    else:sources+=[ROOT/'generic-agent/contract.mjs']
    records=[{'line':i,'user_id':user,'run_id':f'kuairec-{run_token}-{i}'} for i,user in enumerate(users)]
    manifest={'schema':'kuairec-public-batch-v1','method':a.method,'input_sha256':sha(inp),'source_sha256':{str(f):sha(f) for f in sources},'records':records,'full_split_size':full_total,'diagnostic_limit':a.limit,'labels_read':False,'training':False,'protocol':'one independent static event per user; common observed eligibility mask'}
    if a.resume:
        if not a.execute:raise ValueError('resume requires execute')
        saved=json.loads((out/'manifest.json').read_text())
        if saved!=manifest:raise ValueError('batch inputs or sources changed')
    else:
        out.mkdir(parents=True,exist_ok=False);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','users':len(users)}));return
    attempts=[]
    for row in records:
        if sha(inp)!=manifest['input_sha256'] or any(sha(f)!=h for f,h in manifest['source_sha256'].items()):raise ValueError('input or source changed')
        run_dir=ROOT/a.method/'runs'/row['run_id']
        if (run_dir/'result.json').exists():continue
        if run_dir.exists():
            (run_dir/'result.json').write_text(json.dumps({'status':'failed','error':'interrupted before result was committed'})+'\n');continue
        run=subprocess.run(['node',str(ROOT/a.method/'kuairec_run.mjs'),row['run_id'],str(inp),str(row['line'])],capture_output=True,text=True)
        run_dir=ROOT/a.method/'runs'/row['run_id'];result=json.loads((run_dir/'result.json').read_text()) if (run_dir/'result.json').exists() else {'status':'failed','error':'runner_before_result'}
        attempts.append({'user_id':row['user_id'],'status':result['status'],'exit_code':run.returncode});(out/'progress.json').write_text(json.dumps(attempts,indent=2)+'\n')
        if operational_failure(result):break
    print(json.dumps({'attempted':len(attempts),'total':len(records)}))

if __name__=='__main__':main()
