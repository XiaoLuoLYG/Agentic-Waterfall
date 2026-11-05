"""Frozen native inputs and float32 models; GPU only, bounded attention workspace."""
import os,sys,json,hashlib,time,resource
from pathlib import Path
from datetime import datetime,timezone
OUT=Path(__file__).resolve().parent.parent
ARCHIVE=Path('/Users/luoyige/Documents/ChatGPT/waterfall/output/agentic-waterfall/baseline-faithful-overnight-20261103-013025')
FROZEN=ARCHIVE/'frozen/fixed-v2'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(FROZEN/'source-manifest.json')=='3cdbbb63c7fcee50a8cba1d4cc098d7afcd5961cfa02a31c23ea3511e879cb32'
source_manifest=json.loads((FROZEN/'source-manifest.json').read_text())
for name,info in source_manifest['files'].items():assert sha(FROZEN/name)==info['sha256']
assert sha(FROZEN/'resource-policy.json')==source_manifest['resource_policy_sha256']
policy_path=ARCHIVE/'frozen/fixed-gpu-only-v3/resource-policy.json';assert sha(policy_path)=='3c6cd070c7abe096c993d77b9f2cdcb8d3ccf7a9d49bca611fcfcf7b67e2fb50';policy=json.loads(policy_path.read_text());assert sha(ARCHIVE/'gpu_attention.py')==policy['attention_sha256'];gate=json.loads((ARCHIVE/'probes/mps-4096-capacity.json').read_text());assert gate['exit_code']==0 and gate['finite'] and gate['resource_policy_sha256']==source_manifest['resource_policy_sha256']
device=sys.argv.pop(1);assert device=='mps', 'CPU model inference is disabled by user request';output=Path(sys.argv[sys.argv.index('--output')+1]).resolve();assert output.is_relative_to(OUT) and not output.exists();output.parent.mkdir(parents=True,exist_ok=True)
os.environ['PYTORCH_ENABLE_MPS_FALLBACK']='0'
import torch
sys.path.insert(0,str(ARCHIVE))
from gpu_attention import gpu_attention, STATS
torch.nn.functional.scaled_dot_product_attention=gpu_attention
assert device!='mps' or torch.backends.mps.is_available();torch.backends.mps.is_available=lambda:device=='mps';torch.set_num_threads(2);torch.set_num_interop_threads(1)
sys.path.insert(0,str(FROZEN));import retrieval,kuairec_batch
retrieval.ROOT=Path('/Users/luoyige/Documents/ChatGPT/waterfall/methods/agentic-waterfall/fixed-retrieval')
sys.path.insert(0,str(ARCHIVE/'code/methods/agentic-waterfall/formal-run'));from gpu_lock import locked
receipt_path=output.with_suffix('.runtime.json');assert not receipt_path.exists();receipt={'device':device,'dtype':'float32','pid':os.getpid(),'started_at':datetime.now(timezone.utc).isoformat(),'command':[sys.executable,str(Path(__file__).resolve()),device,*sys.argv[1:]],'nice':os.getpriority(os.PRIO_PROCESS,0),'cpu_threads':2,'interop_threads':1,'training':False,'model_api_calls':0,'labels_read':False,'source_manifest_sha256':sha(FROZEN/'source-manifest.json'),'resource_policy_sha256':sha(policy_path),'attention_sha256':policy['attention_sha256'],'cpu_fallback':False,'worker_sha256':sha(__file__),'loaded_models':[],'gpu_lock':policy['gpu_lock']};receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
original_models=retrieval.models

def check_gpu_model(model, args):
 assert all(p.device.type=='mps' and p.dtype==torch.float32 for p in model.parameters())
 receipt['inference_device_verified']='mps'

def factory(base):
 class Factory:
  @staticmethod
  def from_pretrained(*args,**kwargs):
   model=base.from_pretrained(*args,**kwargs);model.register_forward_pre_hook(check_gpu_model);dtype=str(next(model.parameters()).dtype);assert dtype=='torch.float32';receipt['loaded_models'].append({'path':str(args[0]),'dtype':dtype});return model
 return Factory

def measured_models():
 module,tok,encoder,ranker,actual=original_models();assert actual==device;return module,tok,factory(encoder),factory(ranker),actual
retrieval.models=measured_models
original_inputs=retrieval.reranker_inputs

def measured_inputs(*args,**kwargs):
 inputs,audits=original_inputs(*args,**kwargs);shape=list(inputs['input_ids'].shape)
 if shape[1]>8192:raise ValueError('native model capacity exceeded; no clipping or CPU fallback')
 entry={'at':datetime.now(timezone.utc).isoformat(),'device':device,'shape':shape,'input_sha256':[r['model_input_sha256'] for r in audits]}
 if device=='mps':entry.update(mps_live_bytes=torch.mps.current_allocated_memory(),mps_driver_bytes=torch.mps.driver_allocated_memory())
 with output.with_suffix('.batches.jsonl').open('a') as stream:stream.write(json.dumps(entry)+'\n')
 print(json.dumps(entry),flush=True);return inputs,audits
retrieval.reranker_inputs=measured_inputs
started=time.monotonic()
try:
 with locked():kuairec_batch.main()
 receipt['exit_code']=0
except BaseException as error:receipt.update(exit_code=1,error=str(error));raise
finally:
 receipt.update(attention_stats=dict(STATS),ended_at=datetime.now(timezone.utc).isoformat(),elapsed_seconds=time.monotonic()-started,peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss);receipt_path.write_text(json.dumps(receipt,indent=2)+'\n')
