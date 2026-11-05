"""Frozen serial continuation of fixed16; no training, scoring, outer retry or deadline."""
import argparse,collections,fcntl,gzip,hashlib,json,os,signal,subprocess,time
from datetime import datetime,timezone
from functools import lru_cache
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OLD=ROOT.parent/'baseline-faithful-overnight-20261103-013025'
V2='22d4ffb6fb30e65a9bbc2ce199058e347a03efb24e9f283a46949798bc84360f'
V3='17892c7ca4faf1f71463fd94a6257035fc2b0ca17339855711ed41d090480599'
NEW='83aca8380fc12c6ad544a4cae6a393cfb17ff9bb81eb8459909f20566770c4d6'
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def digest(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def now():return datetime.now(timezone.utc).isoformat()
def save(p,v):
 p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');t.replace(p)
def verify(files):
 for p,h in files.items():assert sha(p)==h,'frozen file changed: '+p
@lru_cache(maxsize=2)
def eligibility(path):return json.loads(Path(path).read_text())
def audit_case(path,job,plan):
 path=Path(path);prediction=path/'predictions.jsonl';runtime_path=path.with_suffix('.runtime.json');manifest_path=path/'manifest.json'
 row=json.loads(prediction.read_text());rt=json.loads(runtime_path.read_text());m=json.loads(manifest_path.read_text())
 assert row['user_id']==job['user_id'] and row['status'] in ('submitted','no_delivery')
 assert rt['exit_code']==0 and rt['device']=='mps' and rt['dtype']=='float32'
 assert not rt['training'] and not rt['labels_read'] and rt['model_api_calls']==0
 assert rt['source_manifest_sha256']==plan['native_source_manifest_sha256']
 assert rt['worker_sha256'] in (V2,V3,NEW)
 assert rt['resource_policy_sha256']==plan['legacy_resource_policy_sha256' if rt['worker_sha256']==V2 else 'gpu_resource_policy_sha256']
 assert rt['gpu_lock']==str(OLD/'code/methods/agentic-waterfall/formal-run/gpu.lock')
 native=OLD/'frozen/fixed-v2'
 assert m['source_sha256']=={str(native/name):sha(native/name) for name in ('kuairec_batch.py','retrieval.py','query_tokens.py','trace_output.py')}
 assert m['index_sha256']==plan['index_sha256'] and m['public_eligibility_sha256']==plan['eligibility_sha256']
 previous_input=Path(rt['command'][rt['command'].index('--input')+1]);previous_input=previous_input if previous_input.is_absolute() else OLD/previous_input;assert sha(previous_input)==m['input_sha256']
 visible=next(json.loads(line) for line in previous_input.open() if json.loads(line)['observation']['user_id']==job['user_id'])
 events=visible['observation']['behavior_events'];assert digest(events)==job['history_sha256']
 assert row['history_input_audit']==job['history_input_audit']
 paths=[prediction,runtime_path,manifest_path,previous_input]
 if row['status']=='no_delivery':
  assert job['query_sha256']==hashlib.sha256(b'').hexdigest() and not row['ordered_item_ids'] and not row['acquired_item_ids']
 else:
  assert len(rt['loaded_models'])==2 and all(x['dtype']=='torch.float32' for x in rt['loaded_models'])
  if rt['worker_sha256']!=V2:assert rt['cpu_fallback'] is False and rt['inference_device_verified']=='mps' and rt['attention_sha256']==plan['attention_sha256']
  trace_path=Path(row['trace']['path']);assert sha(trace_path)==row['trace']['sha256'];trace=json.loads(gzip.decompress(trace_path.read_bytes()))
  assert hashlib.sha256(trace['query'].encode()).hexdigest()==job['query_sha256']
  assert row['ordered_item_ids']==trace['ordered_item_ids'][:10] and row['acquired_item_ids']==trace['acquired_ids']
  eligible=set(eligibility(plan['eligibility'])[job['user_id']]);excluded={str(e['item_id']) for e in events}
  assert set(row['acquired_item_ids'])<=eligible-excluded and len(row['acquired_item_ids'])==len(set(row['acquired_item_ids']))
  assert len(row['ordered_item_ids'])==10 and len(set(row['ordered_item_ids']))==10 and set(row['ordered_item_ids'])<=set(row['acquired_item_ids'])
  for stage,receipts in row['query_token_audit'].items():
   for i,a in enumerate(receipts):
    assert a['policy']=='native-8192-original-tokenizer-v1' and a['max_length']==8192 and a['truncation_reason'] is None
    assert a['original_tokens']==a['used_tokens'] and a['document_original_tokens']==a['document_used_tokens']
    assert a['dropped_history_records']==a['partial_history_records']==0
    assert a['history_records']==a['kept_history_records']==job['history_input_audit']['text_records']
    assert all(x['status']=='complete' and x['used_tokens']==x['original_tokens'] for x in a['history_record_audit'])
    full=trace['query_token_audit'][stage][i]
    assert all(full[k]==v for k,v in a.items())
    if rt['worker_sha256']==V2:assert len(full['model_input']['input_ids'])<=4096
  batch_path=path.with_suffix('.batches.jsonl');actual=collections.Counter()
  for batch in map(json.loads,batch_path.read_text().splitlines()):
   assert batch['device']=='mps' and batch['shape'][1]<=(4096 if rt['worker_sha256']==V2 else 8192)
   assert batch['mps_driver_bytes']>0;actual.update(batch['input_sha256'])
  assert actual==collections.Counter(a['model_input_sha256'] for a in row['query_token_audit']['reranker'])
  paths.extend([trace_path,batch_path])
 return row,{str(p):sha(p) for p in paths}

def run_job(job,plan,folder,env):
 verify(plan['files_sha256']);assert sha(job['input'])==job['input_sha256']
 for path,stat in plan['asset_stats'].items():
  s=Path(path).stat();assert [s.st_size,s.st_mtime_ns]==stat,'model asset changed'
 case=Path(folder)/'cases'/f"{job['index']:04d}";result=case/'result.json'
 if result.exists():
  record=json.loads(result.read_text());verify(record['artifact_sha256']);assert record['index']==job['index'] and record['user_id']==job['user_id']
  if record['status']!='failed':
   prediction=next(p for p in record['artifact_sha256'] if Path(p).name=='predictions.jsonl');assert record['prediction']==json.loads(Path(prediction).read_text()),'saved result changed'
  return record
 case.mkdir(parents=True,exist_ok=True)
 if job.get('reuse'):
  proof=json.loads(Path(job['reuse']['proof']).read_text());assert sha(job['reuse']['proof'])==job['reuse']['proof_sha256'];verify(proof['artifact_sha256'])
  row=json.loads(Path(proof['prediction']).read_text());record={'index':job['index'],'user_id':job['user_id'],'status':row['status'],'origin':job['reuse']['origin'],'prediction':row,'artifact_sha256':proof['artifact_sha256'],'proof':job['reuse']['proof']};save(result,record);return record
 inference=case/'inference';started=case/'started.json';runtime_path=inference.with_suffix('.runtime.json')
 if started.exists():
  if not runtime_path.exists() or json.loads(runtime_path.read_text()).get('exit_code') is None:raise RuntimeError('unresolved prior episode; never start another: '+str(case))
  returncode=json.loads(runtime_path.read_text())['exit_code']
 else:
  argv=[str(x).replace('{OUTPUT}',str(inference)) for x in job['argv']]
  save(started,{'started_at':now(),'command':argv,'outer_attempt':1});save(case/'command.json',argv)
  with (case/'inference.log').open('x') as log:
   proc=subprocess.run(argv,env=env or None,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  returncode=proc.returncode
 verify(plan['files_sha256']);assert sha(job['input'])==job['input_sha256']
 if returncode:
  record={'index':job['index'],'user_id':job['user_id'],'status':'failed','origin':'new','prediction':{'user_id':job['user_id'],'method':'fixed-bm25-bge-reranker','status':'failed','ordered_item_ids':[],'acquired_item_ids':[]},'error':'worker_failed','returncode':returncode,'artifact_sha256':{str(runtime_path):sha(runtime_path)} if runtime_path.exists() else {}}
 else:
  try:row,files=audit_case(inference,job,plan)
  except Exception as error:
   record={'index':job['index'],'user_id':job['user_id'],'status':'failed','origin':'new','prediction':{'user_id':job['user_id'],'method':'fixed-bm25-bge-reranker','status':'failed','ordered_item_ids':[],'acquired_item_ids':[]},'error':'audit_failed: '+repr(error),'artifact_sha256':{str(runtime_path):sha(runtime_path)}}
  else:record={'index':job['index'],'user_id':job['user_id'],'status':row['status'],'origin':'new','prediction':row,'artifact_sha256':files}
 save(result,record);return record

def main():
 p=argparse.ArgumentParser();p.add_argument('--plan',required=True);p.add_argument('--execute',action='store_true');a=p.parse_args();plan_path=Path(a.plan);plan=json.loads(plan_path.read_text());folder=Path(plan['output'])
 assert folder.is_relative_to(ROOT) and len(plan['cases'])==1129 and [j['index'] for j in plan['cases']]==list(range(1129))
 verify(plan['files_sha256']);verify(plan['model_assets_sha256']);verify({j['input']:j['input_sha256'] for j in plan['cases']});assert sha(plan['public_population'])==plan['public_population_sha256']
 identity={'plan':str(plan_path),'plan_sha256':sha(plan_path),'controller_sha256':sha(__file__)};folder.mkdir(parents=True,exist_ok=True)
 with (folder/'queue.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  manifest=folder/'manifest.json'
  if manifest.exists():assert json.loads(manifest.read_text())==identity
  else:save(manifest,identity)
  finished={};stopping=False
  def stop(*args):
   nonlocal stopping
   stopping=True
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  env={**os.environ,**plan['environment']}
  def progress(status,active=None):
   save(folder/'progress.json',{'status':status,'pid':os.getpid(),'total':1129,'completed':len(finished),'remaining':1129-len(finished),'active_case':active,'statuses':dict(collections.Counter(r['status'] for r in finished.values())),'origins':dict(collections.Counter(r['origin'] for r in finished.values())),'plan_sha256':identity['plan_sha256'],'updated_at':now(),'labels_read':False})
  for job in plan['cases']:
   case_result=folder/'cases'/f"{job['index']:04d}"/'result.json'
   if case_result.exists() or job.get('reuse'):
    record=run_job(job,plan,folder,env);finished[job['index']]=record
  progress('prepared')
  if any(r['status']=='failed' for r in finished.values()):progress('needs_attention');return 2
  if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','reused':len(finished)}));return 0
  save(folder/'task-state.json',{'status':'running','pid':os.getpid(),'started_at':now(),'plan_sha256':identity['plan_sha256'],'single_gpu_worker':True,'outer_retries':0})
  for job in plan['cases']:
   if job['index'] in finished:continue
   if stopping:progress('bounded_pause');save(folder/'task-state.json',{'status':'bounded_pause','at':now()});return 0
   assert sha(plan_path)==identity['plan_sha256'] and sha(__file__)==identity['controller_sha256']
   progress('running',job['index'])
   try:record=run_job(job,plan,folder,env)
   except Exception as error:
    save(folder/'attention.json',{'index':job['index'],'error':repr(error),'at':now()});progress('needs_attention',job['index']);return 2
   finished[job['index']]=record;progress('running')
   print(json.dumps({'index':job['index'],'user_id':job['user_id'],'status':record['status'],'completed':len(finished)}),flush=True)
   if record['status']=='failed':progress('needs_attention');save(folder/'task-state.json',{'status':'needs_attention','index':job['index'],'at':now()});return 2
  assert sha(plan['public_population'])==plan['public_population_sha256'];verify(plan['model_assets_sha256'])
  prediction=folder/'predictions.jsonl';temp=prediction.with_suffix('.tmp')
  with temp.open('w') as f:
   for i in range(1129):f.write(json.dumps(finished[i]['prediction'],ensure_ascii=False)+'\n')
  temp.replace(prediction);save(folder/'freeze.json',{'predictions_sha256':sha(prediction),'plan_sha256':identity['plan_sha256'],'count':1129,'labels_read':False,'at':now()});progress('completed');save(folder/'task-state.json',{'status':'completed','at':now(),'count':1129});return 0

if __name__=='__main__':raise SystemExit(main())
