"""Run frozen independent fixed-candidate tasks with isolated retries and receipts."""
import argparse,concurrent.futures,hashlib,json,os,signal,subprocess,sys,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];METHODS=ROOT/'methods/agentic-waterfall';sys.path.insert(0,str(METHODS))
from error_policy import operational_failure
from contextlib import nullcontext
from gpu_lock import locked
STOP=threading.Event();WRITE=threading.Lock()

def save(path,obj):
    temp=path.with_name(path.name+'.tmp');temp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n');os.replace(temp,path)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def classify(result):
    if result.get('status')=='submitted':return 'submitted'
    if operational_failure(result) or any(x in str(result.get('error','')) for x in ('public task preparation failed','runtime result missing','embedding failed')):return 'operational_failure'
    return 'method_failure'
def next_attempt(folder):
    nums=[int(p.name.split('-')[1]) for p in folder.glob('attempt-[0-9][0-9][0-9]') if p.name.split('-')[1].isdigit()]
    return max(nums,default=0)+1

def main():
    p=argparse.ArgumentParser();p.add_argument('--workers',type=int,default=2);p.add_argument('--max-infrastructure-attempts',type=int,default=3);a=p.parse_args()
    if not 1<=a.workers<=2 or not 1<=a.max_infrastructure_attempts<=10:raise ValueError('invalid operational limits')
    plan=json.loads((ROOT/'experiment-plan.json').read_text());base=ROOT/'formal/fixed-candidates';jobs=[];maxcount=max(j['tasks'] for j in plan['jobs'])
    for j in plan['jobs']:
        folder=base/j['dataset']/j['method'];manifest=json.loads((folder/'manifest.json').read_text());input_path=Path(j['input'])
        if sha(input_path.read_bytes())!=j['input_sha256'] or manifest['input_sha256']!=j['input_sha256']:raise ValueError('frozen input changed')
        expected=[]
        for n in range(j['tasks']):
            f=folder/f'task-{n:06d}'/'public-input.jsonl';raw=f.read_bytes();obj=json.loads(raw);expected.append({'task_id':obj['observation']['decision_id'],'sha256':sha(raw)})
        target=folder/'task-input-hashes.json';data={'tasks':expected,'runner_sha256':manifest['runner_sha256'],'method_sha256':manifest['method_source_sha256']}
        if target.exists():
            if json.loads(target.read_text())!=data:raise ValueError('task inputs changed')
        else:save(target,data)
        j['folder']=str(folder);j['expected']=expected;jobs.append(j)
    (ROOT/'formal').mkdir(exist_ok=True);summary=ROOT/'formal/fixed-progress.json';events=ROOT/'formal/fixed-events.jsonl';counts={'submitted':0,'method_failure':0,'operational_failure':0,'skipped_existing':0,'total_planned':sum(j['tasks'] for j in jobs)}
    def emit(event):
        with WRITE:
            with events.open('a') as f:f.write(json.dumps(event,ensure_ascii=False)+'\n')
            counts[event['outcome']]+=1;save(summary,{**counts,'running':not STOP.is_set(),'last':event,'training':False,'labels_read':False})
    def process(j,n):
        folder=Path(j['folder'])/f'task-{n:06d}';source=folder/'public-input.jsonl';expected=j['expected'][n]
        if sha(source.read_bytes())!=expected['sha256']:raise ValueError('public input changed')
        final=folder/'run'
        if final.is_symlink() and (final/'result.json').exists():emit({'dataset':j['dataset'],'method':j['method'],'task_id':expected['task_id'],'outcome':'skipped_existing'});return
        if final.exists() or final.is_symlink():raise FileExistsError('unexpected run path')
        method_path=METHODS/j['method']/('fixed_candidates.mjs' if j['method'] in ('clawrec','generic-agent') else 'adapter.py' if j['method']=='i2agent' else j['method']+'.mjs')
        runner=METHODS/('i2agent/batch_run.py' if j['method']=='i2agent' else 'paper-reproductions-run.mjs');manifest=json.loads((Path(j['folder'])/'manifest.json').read_text())
        if sha(method_path.read_bytes())!=manifest['method_source_sha256'] or sha(runner.read_bytes())!=manifest['runner_sha256']:raise ValueError('method source changed')
        for retry in range(a.max_infrastructure_attempts):
            number=next_attempt(folder);dest=folder/f'attempt-{number:03d}'
            command=[sys.executable,str(METHODS/'i2agent/batch_run.py'),'--input',str(source),'--line','0','--dataset',j['dataset'],'--output',str(dest)] if j['method']=='i2agent' else ['node',str(METHODS/'paper-reproductions-run.mjs'),j['method'],str(source),'0',str(dest),j['dataset']]
            lock=locked() if j['method']=='recbot' else nullcontext()
            with lock:
                run=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
            (folder/f'attempt-{number:03d}.process.log').write_text(run.stdout+run.stderr)
            result=json.loads((dest/'result.json').read_text()) if (dest/'result.json').exists() else {'status':'failed','error':'runner_before_result'};outcome=classify(result)
            if outcome!='operational_failure':
                os.symlink(dest.name,final);emit({'dataset':j['dataset'],'method':j['method'],'task_id':expected['task_id'],'outcome':outcome,'attempt':number});return
            if retry+1<a.max_infrastructure_attempts and not STOP.is_set():time.sleep(5*(retry+1));continue
            STOP.set();emit({'dataset':j['dataset'],'method':j['method'],'task_id':expected['task_id'],'outcome':'operational_failure','attempt':number,'error':str(result.get('error',''))[:300]});return
    def sig(*_):STOP.set()
    signal.signal(signal.SIGINT,sig);signal.signal(signal.SIGTERM,sig)
    task_iter=((j,n) for n in range(maxcount) for j in jobs if n<j['tasks']);pending=set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        while not STOP.is_set():
            while len(pending)<a.workers:
                try:j,n=next(task_iter)
                except StopIteration:break
                pending.add(pool.submit(process,j,n))
            if not pending:break
            done,pending=concurrent.futures.wait(pending,return_when=concurrent.futures.FIRST_COMPLETED)
            for f in done:
                try:f.result()
                except Exception as e:STOP.set();save(ROOT/'formal/fixed-fatal.json',{'error':str(e),'training':False,'labels_read':False})
        for f in concurrent.futures.as_completed(pending):
            try:f.result()
            except Exception as e:save(ROOT/'formal/fixed-fatal.json',{'error':str(e)})
    save(summary,{**counts,'running':False,'stopped':STOP.is_set(),'training':False,'labels_read':False});print(json.dumps(counts))
if __name__=='__main__':main()
