"""Run the remaining isolated agent benchmarks, preserving each user/method state."""
import hashlib,json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];M=ROOT/'methods/agentic-waterfall';B=ROOT/'formal';sys.path.insert(0,str(M))
from error_policy import operational_failure
STOP=False

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def save(path,obj):
    t=path.with_name(path.name+'.tmp');t.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n');os.replace(t,path)
def classify(result):
    if result.get('status') in ('submitted','no_delivery'):return result['status']
    if operational_failure(result):return 'operational_failure'
    return 'method_failure'
def next_attempt(folder):
    return 1+max([int(p.name[8:11]) for p in folder.glob('attempt-[0-9][0-9][0-9]*') if p.name[8:11].isdigit()] or [0])
def outcome(folder):
    link=folder/'run'
    if link.is_symlink() and (link/'result.json').exists():return json.loads((link/'result.json').read_text())
    if link.exists() or link.is_symlink():raise ValueError('unexpected final run path')
    return None

def main():
 global STOP
 plan=json.loads((B/'additional-plan.json').read_text());groups=plan['groups'];expected={};models=[]
 for domain in ('amazon','yelp','goodreads'):
  for method in ('recagent','i2agent'):
   base=B/'agentrecbench'/domain/method;m=json.loads((base/'manifest.json').read_text());idx=M/f'agentrecbench-data/index/{domain}-short.sqlite'
   if sha(idx)!=m['index_sha256']:raise ValueError('AgentRecBench index changed')
   st=idx.stat();expected[str(idx)]=(st.st_size,st.st_mtime_ns)
 for split in ('dev','test'):
  path=M/f'protocols/kuairec-public-20261029/kuairec-{split}-public-20261029.jsonl';data=path.read_bytes();st=path.stat();expected[str(path)]=(st.st_size,st.st_mtime_ns)
  for method in ('clawrec','generic-agent'):
   m=json.loads((B/'kuairec'/split/method/'manifest.json').read_text())
   if hashlib.sha256(data).hexdigest()!=m['input_sha256']:raise ValueError('KuaiRec input changed')
   for source,h in m['source_sha256'].items():
    if sha(source)!=h:raise ValueError('KuaiRec source changed')
    st2=Path(source).stat();expected[source]=(st2.st_size,st2.st_mtime_ns)
 snapshot=M/'simbench/snapshots/public-generic-with-dates-20261029';snapsha=sha(snapshot/'catalog.jsonl')
 for method in ('clawrec','generic-agent'):
  m=json.loads((B/'simbench'/method/'manifest.json').read_text())
  if m['snapshot_sha256']!=snapsha:raise ValueError('SimBench snapshot changed')
  for source,h in m['source_hashes'].items():
   path=M/'simbench'/source
   if sha(path)!=h:raise ValueError('SimBench source changed')
 def verify_unchanged():
  for path,(size,mtime) in expected.items():
   s=Path(path).stat()
   if (s.st_size,s.st_mtime_ns)!=(size,mtime):raise ValueError('frozen source changed: '+path)
 stats={'submitted':0,'no_delivery':0,'method_failure':0,'retrying_output':0,'operational_failure':0,'skipped_existing':0,'blocked_by_prior_failure':0,'jobs_completed':0};events=B/'additional-events.jsonl'
 def emit(row):
  with events.open('a') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
  stats[row['outcome']]+=1;save(B/'additional-progress.json',{**stats,'running':not STOP,'training':False,'recommendation_reads_labels':False,'last':row})
 def run_one(folder,kind,make_command,result_path=None):
  global STOP
  folder.mkdir(parents=True,exist_ok=True);existing=outcome(folder)
  if existing is not None:emit({'kind':kind,'case':str(folder.relative_to(ROOT)),'outcome':'skipped_existing'});return existing
  infra_failures=0;output_failures=0
  while True:
   n=next_attempt(folder);attempt=folder/f'attempt-{n:03d}';command,actual=make_command(attempt,n);proc=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
   (folder/f'attempt-{n:03d}.process.log').write_text(proc.stdout+proc.stderr)
   result_file=actual/'result.json';result=json.loads(result_file.read_text()) if result_file.exists() else {'status':'failed','error':'runner_before_result'};status=classify(result)
   if status in ('submitted','no_delivery'):
    os.symlink(os.path.relpath(actual,folder),folder/'run');save(folder/'result.json',result)
    if kind=='agentrecbench-reca':
     for receipt in actual.glob('*response.json'):
      os.link(receipt,folder/f'attempt-{n:03d}.response.json')
    emit({'kind':kind,'case':str(folder.relative_to(ROOT)),'outcome':status,'attempt':n});return result
   if status=='method_failure':
    output_failures+=1
    if output_failures<2 and not STOP:emit({'kind':kind,'case':str(folder.relative_to(ROOT)),'outcome':'retrying_output','attempt':n,'error':str(result.get('error',''))[:300]});continue
    STOP=True;emit({'kind':kind,'case':str(folder.relative_to(ROOT)),'outcome':'method_failure','attempt':n,'error':str(result.get('error',''))[:300]});return result
   infra_failures+=1
   if infra_failures<3 and not STOP:time.sleep(5*infra_failures);continue
   STOP=True;emit({'kind':kind,'case':str(folder.relative_to(ROOT)),'outcome':'operational_failure','attempt':n,'error':str(result.get('error',''))[:300]});return result
 def agentrecbench(j):
  method=j['method'];domain=j['domain'];tid=j['task_id'];base=B/'agentrecbench'/domain/method;entry=j['entry'];folder=base/f'task-{tid:06d}';index=M/f'agentrecbench-data/index/{domain}-short.sqlite';public=ROOT/f'datasets/agentic-waterfall/agentrecbench/task-full/short_term/{domain}/tasks/task_{tid}.json'
  if sha(public)!=(entry['sha256'] if method=='recagent' else entry['public_task_sha256']):raise ValueError('public task changed')
  if method=='recagent':
   def command(dest,n):return ([str(ROOT/'experiments/agentic-waterfall/agentrecbench/.venv/bin/python'),str(M/'recagent/agentrecbench_smoke.py'),'--domain',domain,'--full-tasks','--index',str(index),'--task-id',str(tid),'--output',str(dest)],dest)
   kind='agentrecbench-reca'
  else:
   data=folder/'input.json'
   if sha(data)!=entry['input_sha256']:raise ValueError('i2Agent input changed')
   def command(dest,n):return ([sys.executable,str(M/'i2agent/live_smoke.py'),'--input',str(data),'--output',str(dest),'--rank-max-tokens','4096'],dest)
   kind='agentrecbench-i2'
  run_one(folder,kind,command)
 def simbench(j):
  method=j['method'];prior=None;blocked=False
  for e in j['events']:
   if STOP:return
   folder=B/'simbench'/method/e['case_id'];public=Path(e['input'])
   if blocked:
    folder.mkdir(parents=True,exist_ok=True);save(folder/'blocked.json',{'status':'blocked_by_previous_failure','user_id':j['user_id'],'event':e['event']});emit({'kind':'simbench','case':e['case_id'],'outcome':'blocked_by_prior_failure'});continue
   for name,h in e['input_hashes'].items():
    if sha(public/name)!=h:raise ValueError('SimBench public input changed')
   if sha(snapshot/'catalog.jsonl')!=snapsha:raise ValueError('SimBench snapshot changed')
   def command(dest,n):
    cmd=['node',str(M/'simbench/run_round.mjs'),method,str(public),str(snapshot),str(dest)]
    if prior:cmd.append(str(prior))
    return cmd,dest
   result=run_one(folder,'simbench',command)
   if classify(result) in ('submitted','no_delivery'):prior=folder/'run'/'next-state.json'
   else:blocked=True
 def kuairec(j):
  method=j['method'];split=j['split'];entry=j['entry'];n=entry['line'];folder=B/'kuairec'/split/method/f'task-{n:06d}';inp=M/f'protocols/kuairec-public-20261029/kuairec-{split}-public-20261029.jsonl'
  def command(dest,k):
   runid=entry['run_id']+f'-a{k:03d}';actual=M/method/'runs'/runid;return ['node',str(M/method/'kuairec_run.mjs'),runid,str(inp),str(n)],actual
  result=run_one(folder,'kuairec',command)
  if result.get('status') in ('submitted','no_delivery'):
   state=folder/'run'/('next-state.json' if method=='clawrec' else 'state.json')
   if not state.exists() or str(json.loads(state.read_text()).get('user_id'))!=str(entry['user_id']):raise ValueError('KuaiRec state user mismatch')
 def sig(*_):
  global STOP;STOP=True
 signal.signal(signal.SIGINT,sig);signal.signal(signal.SIGTERM,sig)
 try:
  for n in range(max(len(g['items']) for g in groups)):
   for g in groups:
    if STOP:break
    if n>=len(g['items']):continue
    verify_unchanged();job=g['items'][n]
    if job['kind']=='agentrecbench':agentrecbench(job)
    elif job['kind']=='simbench_sequence':simbench(job)
    elif job['kind']=='kuairec':kuairec(job)
    else:raise ValueError('unknown job')
    stats['jobs_completed']+=1
   if STOP:break
 except Exception as e:
  STOP=True;save(B/'additional-fatal.json',{'error':str(e),'training':False,'labels_read':False});raise
 finally:save(B/'additional-progress.json',{**stats,'running':False,'stopped':STOP,'training':False,'recommendation_reads_labels':False})
if __name__=='__main__':main()
