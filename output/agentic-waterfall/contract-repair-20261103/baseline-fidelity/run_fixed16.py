"""Authorized 16-case pilot, one frozen GPU worker at a time; never score or retry."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parent.parent
INPUT=ROOT/'inputs/pilot-kuairec.jsonl'
ELIGIBLE=ROOT/'public-data/kuairec/eligible-users.json'
WORKER=Path(__file__).with_name('fixed-worker.py')
BASE=Path('/Users/luoyige/Documents/ChatGPT/waterfall')
INDEX=BASE/'methods/agentic-waterfall/fixed-retrieval/runs/kuairec-full-index-20261029'
PYTHON=BASE/'methods/agentic-waterfall/fixed-retrieval/.venv/bin/python'
OUT=ROOT/'pilot-fixed-v1'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def now():return datetime.now(timezone.utc).isoformat()

def main():
    assert sha(INPUT)=='61f9deefd977d27fd63985994ff2cdb0766a60a7a053fedf8ebd6fc1f441ab9e'
    assert sha(WORKER)=='83aca8380fc12c6ad544a4cae6a393cfb17ff9bb81eb8459909f20566770c4d6'
    samples=[json.loads(line) for line in INPUT.read_text().splitlines() if line.strip()]
    users=[str(row['observation']['user_id']) for row in samples];assert len(users)==len(set(users))==16
    eligible=json.loads(ELIGIBLE.read_text());assert all(user in eligible for user in users)
    source={str(path):sha(path) for path in [INPUT,ELIGIBLE,WORKER,Path(__file__),INDEX/'index.json',INDEX/'vectors.npy']}
    original=json.loads((INDEX/'index.json').read_text())['catalog']
    public=json.loads((ROOT/'public-data/kuairec/catalog.json').read_text())
    assert {x['id']:x['text'] for x in original}=={x['id']:x['text'] for x in public}
    OUT.mkdir(exist_ok=False);(OUT/'cases').mkdir()
    env={**os.environ,'OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2',
        'VECLIB_MAXIMUM_THREADS':'2','TOKENIZERS_PARALLELISM':'false','HF_HUB_OFFLINE':'1',
        'TRANSFORMERS_OFFLINE':'1','PYTHONDONTWRITEBYTECODE':'1','PYTORCH_MPS_HIGH_WATERMARK_RATIO':'0.7',
        'PYTORCH_MPS_LOW_WATERMARK_RATIO':'0.6','PYTORCH_ENABLE_MPS_FALLBACK':'0'}
    save(OUT/'manifest.json',{'scope':'authorized fixed16 pilot','source_sha256':source,'user_ids':users,
        'model_processes':1,'model_api_calls':0,'labels_read':False,'training':False,'outer_retries':0,
        'worker_source_manifest':'fixed-v2; verified within worker','started_at':now(),'pid':os.getpid()})
    records=[]
    for i,user in enumerate(users):
        assert all(sha(path)==digest for path,digest in source.items()),'source or public input changed'
        output=OUT/'cases'/f'{i:04d}'
        argv=['nice','-n','10',str(PYTHON),str(WORKER),'mps','--input',str(INPUT),'--index',str(INDEX),
            '--eligible-users',str(ELIGIBLE),'--start',str(i),'--limit','1','--output',str(output),'--execute']
        save(output.with_suffix('.command.json'),argv)
        with output.with_suffix('.log').open('x') as log:proc=subprocess.run(argv,env=env,stdout=log,stderr=subprocess.STDOUT)
        assert all(sha(path)==digest for path,digest in source.items()),'source or public input changed during worker'
        runtime_path=output.with_suffix('.runtime.json');runtime=json.loads(runtime_path.read_text()) if runtime_path.exists() else {}
        prediction_path=output/'predictions.jsonl'
        predictions=[json.loads(line) for line in prediction_path.read_text().splitlines() if line.strip()] if prediction_path.exists() else []
        audit_errors=[]
        if proc.returncode or runtime.get('exit_code')!=0:audit_errors.append(runtime.get('error','worker failed'))
        if len(predictions)!=1:audit_errors.append('one complete prediction required')
        row=predictions[0] if len(predictions)==1 else {'user_id':user,'method':'fixed-bm25-bge-reranker','status':'failed','ordered_item_ids':[],'acquired_item_ids':[]}
        assert row['user_id']==user
        if not audit_errors:
            assert runtime['device']=='mps' and runtime['dtype']=='float32' and runtime['cpu_fallback'] is False
            assert not runtime['training'] and not runtime['labels_read'] and runtime['model_api_calls']==0
            assert runtime['worker_sha256']==source[str(WORKER)]
            assert row['status']=='no_delivery' or runtime['inference_device_verified']=='mps'
            manifest=json.loads((output/'manifest.json').read_text())
            assert manifest['input_sha256']==source[str(INPUT)] and manifest['public_eligibility_sha256']==source[str(ELIGIBLE)]
            assert row['history_input_audit']['visible_events']==len(samples[i]['observation']['behavior_events'])
            for receipts in row.get('query_token_audit',{}).values():
                for receipt in receipts:
                    if receipt['truncation_reason'] is not None or receipt['dropped_history_records'] or receipt['partial_history_records']:audit_errors.append('native input token truncation')
            if row.get('trace'):assert sha(row['trace']['path'])==row['trace']['sha256']
        record={'index':i,'user_id':user,'returncode':proc.returncode,'status':row['status'],
            'audit_status':'passed' if not audit_errors else 'failed','audit_errors':audit_errors,'prediction':row,
            'result_path':str(prediction_path),'result_sha256':sha(prediction_path) if prediction_path.exists() else None,
            'runtime_path':str(runtime_path),'runtime_sha256':sha(runtime_path) if runtime_path.exists() else None}
        records.append(record);save(OUT/'progress.json',{'completed':len(records),'total':16,'active':None,'records':records,'at':now()})
        print(json.dumps({k:record[k] for k in ['index','user_id','status','audit_status','audit_errors']},ensure_ascii=False),flush=True)
    assert len(records)==16
    freeze={'records':records,'source_sha256':source,'user_ids':users,'model_api_calls':0,'labels_read':False,
        'all_inputs_untruncated':all(r['audit_status']=='passed' for r in records),'frozen_at':now()}
    save(OUT/'predictions-frozen.json',freeze)
    (OUT/'predictions.jsonl').write_text(''.join(json.dumps(r['prediction'],ensure_ascii=False)+'\n' for r in records))
    save(OUT/'freeze-sha256.json',{name:sha(OUT/name) for name in ['manifest.json','predictions-frozen.json','predictions.jsonl']})
    print(json.dumps({'status':'frozen','count':len(records),'all_inputs_untruncated':freeze['all_inputs_untruncated'],'labels_read':False}),flush=True)

if __name__=='__main__':main()
