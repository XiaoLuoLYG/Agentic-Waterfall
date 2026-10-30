"""Run frozen local fixed-retrieval baselines one case at a time."""
import hashlib,json,os,signal,subprocess,sys,time
from pathlib import Path
from gpu_lock import locked
ROOT=Path(__file__).resolve().parents[1];M=ROOT/'methods/agentic-waterfall';B=ROOT/'formal';STOP=False

def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def save(path,data):
 tmp=path.with_name(path.name+'.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');os.replace(tmp,path)
def main():
 global STOP
 manifests={k:json.loads((B/k/'fixed/manifest.json').read_text()) for k in ('simbench','kuairec/dev','kuairec/test')};sim=manifests['simbench'];cases=Path(sim['cases'][0]['input']).parents[2];snap=M/'simbench/snapshots/public-generic-with-dates-20261029';catalog=M/'fixed-retrieval/data/simbench-public-catalog-20261029.json';python=M/'fixed-retrieval/.venv/bin/python'
 paths=[M/'fixed-retrieval/kuairec_batch.py',M/'fixed-retrieval/simbench_batch.py',M/'fixed-retrieval/retrieval.py',M/'simbench/catalog.py',M/'simbench/case_input.py',M/'simbench/runtime_input.py',B/'gpu_lock.py',Path(__file__)]
 files={str(p):sha(p) for p in paths};plan={'source_sha256':files,'simbench_cases':len(sim['cases']),'kuairec_dev':len(manifests['kuairec/dev']['user_ids']),'kuairec_test':len(manifests['kuairec/test']['user_ids']),'training':False,'labels_read':False}
 planfile=B/'local-plan.json'
 if planfile.exists() and json.loads(planfile.read_text())!=plan:raise ValueError('local runner sources changed')
 if not planfile.exists():save(planfile,plan)
 if sha(snap/'catalog.jsonl')!=sim['snapshot_sha256'] or sha(catalog)!=sim['catalog_sha256']:raise ValueError('snapshot changed')
 for split in ('dev','test'):
  inp=M/f'protocols/kuairec-public-20261029/kuairec-{split}-public-20261029.jsonl'
  if sha(inp)!=manifests['kuairec/'+split]['input_sha256']:raise ValueError('KuaiRec input changed')
 for kind,index in [('simbench','simbench'),('kuairec/dev','kuairec'),('kuairec/test','kuairec')]:
  for name,h in manifests[kind]['index_sha256'].items():
   if sha(M/'fixed-retrieval/indices'/index/name)!=h:raise ValueError('index changed')
 counts={'submitted':0,'no_delivery':0,'skipped_existing':0,'operational_failure':0,'total_planned':sum((len(sim['cases']),len(manifests['kuairec/dev']['user_ids']),len(manifests['kuairec/test']['user_ids'])))}
 def sig(*_):
  global STOP;STOP=True
 signal.signal(signal.SIGTERM,sig);signal.signal(signal.SIGINT,sig)
 def event(row):
  with (B/'local-events.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
  counts[row['outcome']]+=1;save(B/'local-progress.json',{**counts,'running':not STOP,'last':row,'training':False,'labels_read':False})
 try:
  for n in range(max(len(x['cases'] if k=='simbench' else x['user_ids']) for k,x in manifests.items())):
   for kind,m in manifests.items():
    if STOP:break
    size=len(m['cases'] if kind=='simbench' else m['user_ids'])
    if n>=size:continue
    if any(sha(p)!=h for p,h in files.items()):raise ValueError('local runner source changed')
    folder=B/kind/'fixed'/f'task-{n:06d}';folder.mkdir(parents=True,exist_ok=True);final=folder/'run'
    if final.is_symlink() and (final/'result.json').exists():event({'case':str(folder.relative_to(ROOT)),'outcome':'skipped_existing'});continue
    if final.exists() or final.is_symlink():raise ValueError('unexpected run path')
    attempts=[int(p.name.split('-')[1]) for p in folder.glob('attempt-[0-9][0-9][0-9]')];attempt=folder/f'attempt-{max(attempts,default=0)+1:03d}'
    if kind=='simbench':
     entry=m['cases'][n];public=Path(entry['input'])
     if any(sha(public/name)!=h for name,h in entry['input_hashes'].items()):raise ValueError('SimBench case changed')
     command=[str(python),str(M/'fixed-retrieval/simbench_batch.py'),'--cases',str(cases),'--snapshot',str(snap),'--catalog',str(catalog),'--index',str(M/'fixed-retrieval/indices/simbench'),'--output',str(attempt),'--start',str(n),'--limit','1','--execute'];actual=attempt/entry['case_id']
    else:
     split=kind.split('/')[1];inp=M/f'protocols/kuairec-public-20261029/kuairec-{split}-public-20261029.jsonl';command=[str(python),str(M/'fixed-retrieval/kuairec_batch.py'),'--input',str(inp),'--index',str(M/'fixed-retrieval/indices/kuairec'),'--output',str(attempt),'--start',str(n),'--limit','1','--execute'];actual=attempt
    with locked():proc=subprocess.run(command,cwd=ROOT,text=True,capture_output=True)
    (folder/(attempt.name+'.process.log')).write_text(proc.stdout+proc.stderr)
    if proc.returncode:STOP=True;event({'case':str(folder.relative_to(ROOT)),'outcome':'operational_failure','exit_code':proc.returncode});break
    if kind!='simbench':
     rows=[json.loads(x) for x in (actual/'predictions.jsonl').read_text().splitlines() if x]
     if len(rows)!=1 or str(rows[0]['user_id'])!=str(m['user_ids'][n]):raise ValueError('KuaiRec fixed output mismatch')
     save(actual/'result.json',rows[0])
    result=json.loads((actual/'result.json').read_text())
    if result['status'] not in ('submitted','no_delivery'):raise ValueError('unexpected local result')
    os.symlink(os.path.relpath(actual,folder),final);event({'case':str(folder.relative_to(ROOT)),'outcome':result['status']})
    if not STOP:time.sleep(15)
   if STOP:break
 except Exception as e:
  STOP=True;save(B/'local-fatal.json',{'error':str(e),'training':False,'labels_read':False});raise
 finally:save(B/'local-progress.json',{**counts,'running':False,'stopped':STOP,'training':False,'labels_read':False})
if __name__=='__main__':main()
