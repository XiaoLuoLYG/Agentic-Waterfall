"""Prepare or execute a frozen public fixed-candidate batch without training."""
import argparse,hashlib,json,math,subprocess,sys
from pathlib import Path
from error_policy import operational_failure
ROOT=Path(__file__).resolve().parent

def make_manifest(samples,method,dataset,input_hash):
    if method not in ('mars','recbot','clawrec','i2agent','generic-agent') or dataset not in ('mind','kuairand') or not samples:raise ValueError('invalid or empty batch')
    ids=[];calls=0
    for sample in samples:
        obs=sample['observation'];ids.append(obs['decision_id']);pool=obs['environment']['candidate_pool']
        if not isinstance(pool,list) or not pool:raise ValueError('empty candidate pool')
        calls+=5 if method=='i2agent' else 3 if method=='generic-agent' else 2+(math.ceil(len(pool)/10) if method=='mars' else 0)
    if len(ids)!=len(set(ids)):raise ValueError('duplicate decision')
    return {'schema':'paper-reproduction-public-batch-v1','method':method,'dataset':dataset,'input_sha256':input_hash,'task_ids':ids,'max_expected_calls':calls,'training':False,'labels_read':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--method',choices=['mars','recbot','clawrec','i2agent','generic-agent'],required=True);p.add_argument('--dataset',choices=['mind','kuairand'],required=True);p.add_argument('--output',required=True);p.add_argument('--start',type=int,default=0);p.add_argument('--count',type=int,required=True);p.add_argument('--execute',action='store_true');a=p.parse_args()
    if a.start<0 or a.count<1:raise ValueError('invalid sample range')
    data=Path(a.input).read_bytes();lines=[x for x in data.splitlines() if x.strip()];selected=lines[a.start:a.start+a.count]
    if len(selected)!=a.count:raise ValueError('sample range exceeds input')
    samples=[json.loads(x) for x in selected];manifest=make_manifest(samples,a.method,a.dataset,hashlib.sha256(data).hexdigest());manifest.update(start=a.start,count=a.count,method_source_sha256=hashlib.sha256((ROOT/a.method/('fixed_candidates.mjs' if a.method in ('clawrec','generic-agent') else 'adapter.py' if a.method=='i2agent' else a.method+'.mjs')).read_bytes()).hexdigest())
    runner=ROOT/('i2agent/batch_run.py' if a.method=='i2agent' else 'paper-reproductions-run.mjs')
    manifest['runner_sha256']=hashlib.sha256(runner.read_bytes()).hexdigest()
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    for i,line in enumerate(selected):
        folder=out/f'task-{a.start+i:06d}';folder.mkdir();(folder/'public-input.jsonl').write_bytes(line+b'\n')
    if not a.execute:
        print(json.dumps({'status':'prepared_no_model_calls',**manifest},ensure_ascii=False));return
    attempted=0;submitted=0
    for i in range(a.count):
        folder=out/f'task-{a.start+i:06d}';run=folder/'run'
        command=[sys.executable,str(ROOT/'i2agent/batch_run.py'),'--input',str((folder/'public-input.jsonl').resolve()),'--line','0','--dataset',a.dataset,'--output',str(run.resolve())] if a.method=='i2agent' else ['node',str(ROOT/'paper-reproductions-run.mjs'),a.method,str(folder/'public-input.jsonl'),'0',str(run),a.dataset]
        proc=subprocess.run(command,capture_output=True,text=True)
        (folder/'process.log').write_text(proc.stdout+proc.stderr);attempted+=1
        result=json.loads((run/'result.json').read_text()) if (run/'result.json').exists() else {'status':'failed','error':'runner_before_result'}
        submitted+=result.get('status')=='submitted'
        if operational_failure(result):
            break
    status={'attempted':attempted,'submitted':submitted,'planned':a.count,'all_submitted':submitted==a.count}
    (out/'batch-status.json').write_text(json.dumps(status,indent=2)+'\n');print(json.dumps(status))
    if not status['all_submitted']:raise SystemExit(1)
if __name__=='__main__':main()
