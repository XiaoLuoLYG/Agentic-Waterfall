"""Run user-authorized, label-free one-task readiness checks once caption preparation succeeds."""
import json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent;CONTROL=ROOT/'methods/agentic-waterfall/model-control/CONTROL.json';LEDGER=ROOT/'experiments/agentic-waterfall/shared/model-ledger.json';LOCK=Path(str(LEDGER)+'.lock');STATUS=HERE/'caption-live-check-status.json';PHASE='kuairand-caption-live-readiness';RESERVE=26

def save(path,obj):
    tmp=path.with_name(path.name+'.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n');os.replace(tmp,path)
def with_ledger(action):
    for _ in range(600):
        try:LOCK.mkdir();break
        except FileExistsError:time.sleep(.05)
    else:raise RuntimeError('shared ledger lock unavailable')
    try:
        data=json.loads(LEDGER.read_text());value=action(data);save(LEDGER,data);return value
    finally:LOCK.rmdir()
def main():
    signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(SystemExit('terminated')))
    pid=int(sys.argv[1]);save(STATUS,{'status':'waiting_for_caption_preflight','training':False,'labels_read':False})
    while True:
        s=json.loads((HERE/'caption-finalization-status.json').read_text())
        if s['status']=='data_and_preflight_complete':break
        if s['status']=='failed':save(STATUS,{'status':'blocked_by_caption_preparation','details':s});return
        try:os.kill(pid,0)
        except ProcessLookupError:save(STATUS,{'status':'blocked_by_caption_preparation','error':'preparation process stopped'});return
        time.sleep(15)
    control=json.loads(CONTROL.read_text())
    if control.get('model_calls_enabled') or control.get('local_training_allowed'):save(STATUS,{'status':'not_started','error':'model control is already active'});return
    cohort=ROOT/'methods/agentic-waterfall/protocols/kuairand-common-35-caption-v2-20261029/inputs-eligible.jsonl';rows=[json.loads(x) for x in cohort.read_text().splitlines()];index=next(i for i,r in enumerate(rows) if ':dev:' in r['observation']['decision_id']);task=rows[index]['observation']['decision_id']
    def reserve(d):
        before=sum(x.get('experiment')=='method-deployment' for x in d['attempts']);d['limit']+=RESERVE;return before
    before=with_ledger(reserve);results={}
    try:
        save(STATUS,{'status':'running','task_id':task,'training':False,'labels_read':False})
        control.update({'model_calls_enabled':True,'model_request_limit':before+RESERVE,'phase':PHASE,'notes':'User-authorized single-task caption readiness checks; no training or effect scores.'});save(CONTROL,control)
        for method in ('clawrec','i2agent','mars','recbot','generic-agent'):
            out=ROOT/f'methods/agentic-waterfall/{method}/runs/kuairand-caption-live-readiness-20261029'
            cmd=[sys.executable,str(ROOT/'methods/agentic-waterfall/batch_public.py'),'--input',str(cohort),'--method',method,'--dataset','kuairand','--start',str(index),'--count','1','--output',str(out),'--execute']
            with (HERE/f'live-{method}.log').open('x') as log:
                proc=subprocess.run(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            p=out/'batch-status.json';status=json.loads(p.read_text()) if p.exists() else {};results[method]={'exit_code':proc.returncode,'status':status}
            save(STATUS,{'status':'running','task_id':task,'results':results,'training':False,'labels_read':False})
    finally:
        current=json.loads(CONTROL.read_text())
        if current.get('phase')==PHASE:current.update({'model_calls_enabled':False,'phase':'readiness-tests-complete'});save(CONTROL,current)
        def release(d):
            used=sum(x.get('experiment')=='method-deployment' for x in d['attempts'])-before
            if used<0 or used>RESERVE:raise ValueError('unexpected shared method usage; inspect before adjusting')
            d['limit']=max(len(d['attempts']),d['limit']-(RESERVE-used));return used
        used=with_ledger(release)
        save(STATUS,{'status':'checks_finished','task_id':task,'results':results,'model_attempts':used,'training':False,'labels_read':False,'interpretation':'one task per method; not an effectiveness result'})
if __name__=='__main__':main()
