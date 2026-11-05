"""Freeze unchanged public rows and prove result reuse without loading models or labels."""
import ast,gzip,hashlib,json,statistics
from pathlib import Path
from run_fixed_full import ROOT,OLD,NEW,V2,V3,sha,digest,save,audit_case

HERE=Path(__file__).resolve().parent
BASE=Path('/Users/luoyige/Documents/ChatGPT/waterfall')
SOURCE=ROOT.parent/'overnight-20261103/full-public-inputs/kuairec-test.jsonl'
ELIGIBLE=ROOT/'public-data/kuairec/eligible-users.json'
INDEX=BASE/'methods/agentic-waterfall/fixed-retrieval/runs/kuairec-full-index-20261029'
NATIVE=OLD/'frozen/fixed-v2'
WORKER=HERE/'fixed-worker.py'
OUTPUT=ROOT/'full-kuairec-fixed-v3'

def main():
 assert sha(SOURCE)=='241d45c827651f84b90c9f64bb18377431f959d30a279e2d03a8e019cb72cb69'
 assert sha(ELIGIBLE)==sha(OLD/'inputs/kuairec-eligible-users.json')=='1d65881982b546e551c92c33647167e8a1328b94c49889ad93d8ab5345c968c4'
 assert sha(WORKER)==NEW and sha(OLD/'run_fixed_case_v2.py')==V2 and sha(OLD/'run_fixed_case_gpu_v3.py')==V3
 oldplan=json.loads((OLD/'frozen/fixed-gpu-only-v3/full1129-plan.json').read_text())
 original=json.loads((INDEX/'index.json').read_text())['catalog'];public=json.loads((ROOT/'public-data/kuairec/catalog.json').read_text())
 assert {r['id']:r['text'] for r in original}=={r['id']:r['text'] for r in public}
 native_manifest=json.loads((NATIVE/'source-manifest.json').read_text());files={str(NATIVE/name):entry['sha256'] for name,entry in native_manifest['files'].items()}
 paths=[WORKER,HERE/'run_fixed_full.py',Path(__file__),NATIVE/'source-manifest.json',NATIVE/'resource-policy.json',OLD/'frozen/fixed-gpu-only-v3/resource-policy.json',OLD/'gpu_attention.py',OLD/'run_fixed_case_v2.py',OLD/'run_fixed_case_gpu_v3.py',OLD/'code/methods/agentic-waterfall/formal-run/gpu_lock.py',ELIGIBLE,INDEX/'index.json',INDEX/'vectors.npy']
 files.update({str(p):sha(p) for p in paths});assert all(sha(p)==h for p,h in files.items())
 weights=BASE/'methods/agentic-waterfall/fixed-retrieval/weights';assets={};asset_stats={}
 revisions={'bge-m3':'5617a9f61b028005a4858fdac845db406aefb181','bge-reranker-v2-m3':'953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e'}
 for model,revision in revisions.items():
  for meta in (weights/model/'.cache/huggingface/download').glob('*.metadata'):
   commit,expected,*_=meta.read_text().splitlines();assert commit==revision;p=weights/model/meta.name.removesuffix('.metadata');actual=sha(p)
   if len(expected)==64:assert actual==expected
   else:assert hashlib.sha1(b'blob '+str(p.stat().st_size).encode()+b'\0'+p.read_bytes()).hexdigest()==expected
   assets[str(p)]=actual;asset_stats[str(p)]=[p.stat().st_size,p.stat().st_mtime_ns];files[str(meta)]=sha(meta)
 assert len(assets)==12
 plan={'version':'fixed-contract-repair-full-v3','output':str(OUTPUT),'public_population':str(SOURCE),'public_population_sha256':sha(SOURCE),'eligibility':str(ELIGIBLE),'eligibility_sha256':sha(ELIGIBLE),'index':str(INDEX),'index_sha256':{p:sha(INDEX/p) for p in ('index.json','vectors.npy')},'native_source_manifest_sha256':sha(NATIVE/'source-manifest.json'),'legacy_resource_policy_sha256':sha(NATIVE/'resource-policy.json'),'gpu_resource_policy_sha256':sha(OLD/'frozen/fixed-gpu-only-v3/resource-policy.json'),'attention_sha256':sha(OLD/'gpu_attention.py'),'files_sha256':files,'model_assets_sha256':assets,'asset_stats':asset_stats,'source_population_verified_at_start_and_completion':True,'cases':[],'labels_read':False,'training':False,'downloads':False,'model_api_calls':0,'outer_retries':0,'device':'mps','dtype':'float32','cpu_fallback':False,'native_token_limit':8192,'concurrency':1,'no_deadline':True}
 plan['environment']={'OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2','VECLIB_MAXIMUM_THREADS':'2','TOKENIZERS_PARALLELISM':'false','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','PYTHONDONTWRITEBYTECODE':'1','PYTORCH_MPS_HIGH_WATERMARK_RATIO':'0.7','PYTORCH_MPS_LOW_WATERMARK_RATIO':'0.6','PYTORCH_ENABLE_MPS_FALLBACK':'0'}
 tree=ast.parse((NATIVE/'kuairec_batch.py').read_text());fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='history_parts');ns={};exec(compile(ast.Module(body=[fn],type_ignores=[]),'frozen-history-parts','exec'),ns);parts_for=ns['history_parts']
 inputs=ROOT/'inputs/full-kuairec-fixed-v3';inputs.mkdir(exist_ok=True);proofdir=HERE/'fixed-reuse';proofdir.mkdir(exist_ok=True);reuse_counts={};rejected=[];times=[];pilot_equivalence=[]
 with SOURCE.open('rb') as population:
  for i,line in enumerate(population):
   row=json.loads(line);obs=row['observation'];user=obs['user_id'];prior=oldplan['cases'][i];assert user==prior['user_id'] and i==prior['source_line']
   old_input=Path(prior['public_input']);assert sha(old_input)==prior['public_input_sha256'];assert json.loads(old_input.read_text())['observation']['behavior_events']==obs['behavior_events']
   path=inputs/f'{i:04d}.jsonl'
   if path.exists():assert path.read_bytes()==line
   else:path.write_bytes(line)
   events=obs['behavior_events'];parts=parts_for(events);query=' '.join(parts)
   job={'index':i,'source_line':i,'user_id':user,'input':str(path),'input_sha256':sha(path),'history_sha256':digest(events),'query_sha256':hashlib.sha256(query.encode()).hexdigest(),'history_input_audit':{'visible_events':len(events),'positive_events':sum(e['payload'].get('watch_ratio',0)>2 for e in events),'text_records':len(parts),'history_record_cap':None,'selection_rule':'watch_ratio > 2 with nonempty public item_text'}}
   job['argv']=['nice','-n','10',str(BASE/'methods/agentic-waterfall/fixed-retrieval/.venv/bin/python'),str(WORKER),'mps','--input',str(path),'--index',str(INDEX),'--eligible-users',str(ELIGIBLE),'--start','0','--limit','1','--output','{OUTPUT}','--execute']
   old_result=OLD/f'formal/kuairec/fixed-retrieval-gpu-only-v3/case-{i:04d}/result.json'
   if i<16:inference=ROOT/f'pilot-fixed-v1/cases/{i:04d}';origin='reused_current_pilot'
   elif old_result.exists():
    oldrow=json.loads(old_result.read_text());prov=oldrow['inference_provenance'];assert sha(prov['source_prediction'])==prov['source_prediction_sha256'] and sha(prov['source_runtime'])==prov['source_runtime_sha256'];inference=Path(prov['source_runtime'].removesuffix('.runtime.json'));origin='reused_old_unaffected'
   else:inference=None
   if inference:
    try:
     prediction,proof_files=audit_case(inference,job,plan);runtime=json.loads(inference.with_suffix('.runtime.json').read_text())
     if old_result.exists():proof_files[str(old_result)]=sha(old_result)
     proof={'user_id':user,'source_line':i,'origin':origin,'prediction':str(inference/'predictions.jsonl'),'artifact_sha256':proof_files,'history_sha256':job['history_sha256'],'query_sha256':job['query_sha256'],'same_public_history':True,'same_native_sources_index_eligibility':True,'same_pinned_model_asset_hashes':True,'dtype':'float32','device':'mps','no_native_token_truncation':True,'legacy_forward_observability':'weaker: native factory verifies actual mps route, model/input .to(mps), float32 loader and MPS batch allocator receipts; no per-forward assertion/explicit fallback env receipt' if runtime['worker_sha256']==V2 else 'mps forward prehook and no-fallback receipt','attention_equivalence':'legacy <=4096 takes unchanged native SDPA' if runtime['worker_sha256']==V2 else 'same GPU v3 attention wrapper','worker_sha256':runtime['worker_sha256']}
     proofpath=proofdir/f'{i:04d}.json';save(proofpath,proof);job['reuse']={'origin':origin,'proof':str(proofpath),'proof_sha256':sha(proofpath)};reuse_counts[origin]=reuse_counts.get(origin,0)+1;times.append(runtime['elapsed_seconds'])
     if i<16:
      oldrow=json.loads(old_result.read_text());a=json.loads(gzip.decompress(Path(oldrow['trace']['path']).read_bytes()));b=json.loads(gzip.decompress(Path(prediction['trace']['path']).read_bytes()));assert a==b;pilot_equivalence.append(i)
    except Exception as error:rejected.append({'index':i,'user_id':user,'error':repr(error)})
   plan['cases'].append(job)
 assert len(plan['cases'])==1129 and len({j['user_id'] for j in plan['cases']})==1129
 assert len(pilot_equivalence)==16,'all current-pilot results must be reused with exact full trace equality'
 plan['reuse_counts']=reuse_counts;plan['new_cases']=1129-sum(reuse_counts.values());plan['legacy_forward_evidence_limitation']='Old v2 lacks per-forward assertion and explicit CPU-fallback-env receipt; same native MPS route/float32 and <=4096 original SDPA verified from pinned source, batch device/memory receipts and exact current-pilot trace equality.'
 plan['eta_hours_from_completed_mean']=plan['new_cases']*statistics.mean(times)/3600
 save(HERE/'fixed-full-plan.json',plan);save(HERE/'fixed-full-reuse-audit.json',{'cases':1129,'reuse_counts':reuse_counts,'new_cases':plan['new_cases'],'rejected_reuse':rejected,'full_history_equal_to_old_per_user':1129,'current_pilot_old_trace_bit_exact':pilot_equivalence,'all_model_assets_verified':assets,'eta_hours':plan['eta_hours_from_completed_mean'],'labels_read':False});print(json.dumps({'reuse_counts':reuse_counts,'new_cases':plan['new_cases'],'rejected':rejected,'eta_hours':plan['eta_hours_from_completed_mean'],'plan_sha256':sha(HERE/'fixed-full-plan.json')}))

if __name__=='__main__':main()
