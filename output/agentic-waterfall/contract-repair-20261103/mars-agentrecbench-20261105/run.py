"""One authorized addition; reuse the existing public assignments and official scorer."""
import argparse
from collections import Counter, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

HERE=Path(__file__).resolve().parent
BATCH=HERE.parent
CONTROLS=BATCH/'agentrecbench-fixed-controls-20261103'
spec=importlib.util.spec_from_file_location('existing_fixed_controls',CONTROLS/'run.py')
controls=importlib.util.module_from_spec(spec)
spec.loader.exec_module(controls)
read,save,sha,verify_files=controls.read,controls.save,controls.sha,controls.verify_files
controls.HERE=HERE
controls.METHODS=('mars',)
ENTRY=HERE/'run-case.mjs'
MODEL='DeepSeek-V4.1-Flash-1017'
ENV={**os.environ,'WATERFALL_FORMAL_ROUTE':'1','WATERFALL_MODEL_TIMEOUT_MS':'180000',
     'WATERFALL_REQUEST_GATE_DIR':str(controls.AR/'request-gates'),'MODEL_CONFIG_FILE':str(controls.CONFIG)}
for key in ('NODE_OPTIONS','BASELINE_REPLAY_DIR','BASELINE_REPLAY_ONLY','KREC_REPLAY_PREFIX'):
    ENV.pop(key,None)

def command(mode,source,domain,out):
    return list(map(str,['/usr/bin/sandbox-exec','-f',CONTROLS/'labels-denied.sb','node',
      '--import',BATCH/'transport-retry/register.mjs',ENTRY,mode,source,domain,out]))

def prepare():
    rows=read(CONTROLS/'assignment.json')['rows']
    assert len(rows)==300 and sum(r['pilot'] for r in rows)==6
    for row in rows:
        assert sha(Path(row['input']))==row['input_sha256']
        obs=read(Path(row['input']))['observation']
        assert [x['id'] for x in obs['environment']['candidate_pool']]==row['candidate_ids']
    domains=HERE/'domains';domains.mkdir(exist_ok=True)
    for domain,noun in [('amazon','products'),('goodreads','books'),('yelp','businesses')]:
        items={}
        for row in rows:
            if row['domain']==domain:
                for item in read(Path(row['input']))['observation']['environment']['candidate_pool']:
                    if len(item['text'])>80:items[item['id']]={'id':item['id'],'text':item['text']}
        import hashlib
        selected=sorted(items,key=lambda key:hashlib.sha256(key.encode()).hexdigest())[:10]
        assert len(selected)==10
        seed={'domain':domain,'item_noun':noun,'items':[items[key] for key in selected],
              'selection':'first ten public IDs by SHA256; no labels or performance used'}
        path=domains/(domain+'-seed.json')
        if path.exists():assert read(path)==seed
        else:save(path,seed)
    code=BATCH/'frozen/v6/code/methods/agentic-waterfall/mars'
    files=[Path(__file__),ENTRY,HERE/'adapter.mjs',HERE/'adapter.test.mjs',CONTROLS/'run.py',
      BATCH/'transport-retry/register.mjs',BATCH/'transport-retry/model-client.mjs',
      BATCH/'transport-retry/ledger-store.mjs',BATCH/'transport-retry/request-gate.mjs',
      CONTROLS/'labels-denied.sb',*code.glob('*.mjs'),code/'prompts.json',*domains.glob('*-seed.json')]
    files=[p for p in files if '.test.' not in p.name or p.parent==HERE]
    assignment={'rows':rows,'files':{str(p):sha(p) for p in files},'model':MODEL,
      'workers':36,'pilot_cases':6,'assigned':300,'max_native_calls_per_case':3,
      'method':'paper-aligned-retrospective-fixed-candidate-adaptation','labels_read':False}
    path=HERE/'assignment.json'
    if path.exists():assert read(path)==assignment
    else:save(path,assignment)
    save(HERE/'offline-acceptance.json',{'passed':True,'assigned':300,'same_public_inputs':True,
      'twenty_candidates_preserved':True,'pilot_cases':6,'new_model_calls':0,'assignment_sha256':sha(path)})

def setup_domains(files):
    for name in ('amazon','goodreads','yelp'):
        folder=HERE/'domains';domain=folder/(name+'.json');out=folder/(name+'-generation')
        if domain.exists():
            receipt=read(out/'acceptance.json');assert receipt['passed'] and sha(domain)==receipt['domain_sha256']
            continue
        verify_files(files)
        assert not out.exists(),'inspect interrupted domain generation before resuming'
        with (folder/(name+'.log')).open('xb') as stream:
            p=subprocess.run(command('domain',folder/(name+'-seed.json'),domain,out),env=ENV,
                             cwd=HERE,stdout=stream,stderr=subprocess.STDOUT,timeout=600)
        assert p.returncode==0, f'{name}: domain preparation failed; see domain log'
    return {str(HERE/'domains'/(name+'.json')):sha(HERE/'domains'/(name+'.json'))
            for name in ('amazon','goodreads','yelp')}

def check_case(row,out):
    result=read(out/'result.json');native=read(out/'input.json');obs=read(Path(row['input']))['observation']
    assert native['source_input_sha256']==row['input_sha256']==sha(Path(row['input']))
    assert native['candidates']==[{'id':x['id'],'text':x['text']} for x in obs['environment']['candidate_pool']]
    assert [json.loads(e['text']) for e in native['history']]==obs['behavior_events']
    assert result['context_id']==obs['decision_id'] and result['method']=='mars'
    requests=sorted(out.glob('*.request.json'));responses=sorted(out.glob('*.response.json'))
    if result['status']=='failed':
        error=result['error']
        if re.search(r'model_http|model_timeout|model_transport|request_gate|budget_exhausted|model_calls_not_enabled|provider_model|ledger_|credential_|database is locked',error):
            raise RuntimeError(f'infrastructure error in {row["id"]}: {error}')
        return {'id':row['id'],'method':'mars','status':'failed','ordered_item_ids':[],
                'error':error,'result_path':str(out/'result.json'),'result_sha256':sha(out/'result.json')}
    assert result['status']=='submitted'
    assert len(requests)==len(responses)==result['model_request_count'] and 1<=len(requests)<=3
    for request,response in zip(requests,responses):
        receipt=read(response);assert receipt['status']=='success' and receipt['provider_response_model']==MODEL
        assert receipt['finish_reason']!='length'
        payload=read(request.with_name(request.name.replace('.request.','.payload.')))
        req=read(request);context=req['messages'][0]['content'].split('Public benchmark context (provided metadata, not user speech): ',1)[1].split('\n',1)[0]
        assert json.loads(context)==native['task_context']
        if '-extract.' in request.name:
            events=[{k:v for k,v in e.items() if k!='signal_id'} for e in payload['events']]
            assert events==native['history']
        if '-rank.' in request.name:
            assert payload['candidates']==native['candidates'] and payload['instruction']==''
            assert payload['events']==read(out/'state.json')['events']
    ids=result['ordered_item_ids'];assert len(ids)==len(set(ids))==20 and set(ids)==set(row['candidate_ids'])
    order={key:i for i,key in enumerate(row['candidate_ids'])}
    assert [x['id'] for x in sorted(result['scores'],key=lambda x:(-x['score'],order[x['id']]))]==ids
    assert len(result['scores'])==20 and all(0<=s['score']<=10 for s in result['scores'])
    return {'id':row['id'],'method':'mars','status':'submitted','ordered_item_ids':ids,
      'result_path':str(out/'result.json'),'result_sha256':sha(out/'result.json'),'requests':len(requests)}

def run_case(row,files):
    verify_files(files)
    assert sha(Path(row['input']))==row['input_sha256'],'public input changed before inference'
    folder=HERE/'cases'/row['id'].removesuffix('-waterfall');folder.mkdir(parents=True,exist_ok=True)
    out=folder/'attempt-01';receipt=folder/'outcome.json'
    env=ENV
    if (folder/'recovery.json').exists():
        recovery=read(folder/'recovery.json');out=Path(recovery['attempt']);receipt=folder/'recovery-outcome.json'
        env={**ENV,'MARS_EXACT_PRIOR':recovery['prior']}
    if receipt.exists():
        old=read(receipt);assert old==check_case(row,out);return old
    if not out.exists():
        with (folder/('recovery.log' if out.name!='attempt-01' else 'process.log')).open('xb') as stream:
            p=subprocess.run(command('case',row['input'],HERE/'domains'/(row['domain']+'.json'),out),
              cwd=HERE,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=900)
        assert p.returncode in (0,1), f'{row["id"]}: runner exited {p.returncode}'
    assert (out/'result.json').exists(),f'{row["id"]}: interrupted attempt needs prefix audit'
    value=check_case(row,out);verify_files(files);save(receipt,value);return value

def execute(phase,rows,files):
    pending=deque(rows);active={};records=[];halt=None
    with ThreadPoolExecutor(max_workers=36) as pool:
        while pending or active:
            while pending and len(active)<36 and not halt:
                row=pending.popleft();active[pool.submit(run_case,row,files)]=row
            done,_=wait(active,timeout=10,return_when=FIRST_COMPLETED)
            for future in done:
                row=active.pop(future)
                try:records.append(future.result())
                except Exception as error:halt=f'{row["id"]}: {error}';pending.clear()
            save(HERE/'progress.json',{'phase':phase,'status':'needs_attention' if halt else 'running',
              'pid':os.getpid(),'at':datetime.now(timezone.utc).isoformat(),'completed':len(records),'assigned':len(rows),
              'active':len(active),'status_counts':dict(Counter(r['status'] for r in records)),'error':halt})
    if halt:raise RuntimeError(halt)
    outcomes=sorted(records,key=lambda r:r['id'])
    if phase=='pilot':assert all(r['status']=='submitted' for r in outcomes),'pilot native output failure; inspect before full phase'
    metrics=controls.score(phase,rows,outcomes)['mars']
    independent={}
    eligible={k.removesuffix('-i2agent') for k,v in read(controls.AR/'evaluation/predictions-frozen.json')['outcomes'].items()
              if v['method']=='i2agent' and v['status']!='not_applicable'}
    by_id={r['id']:r for r in outcomes}
    for group in ('amazon','goodreads','yelp','all','matched220'):
        selected=[r for r in rows if (r['domain']==group or group=='all' or
                  group=='matched220' and r['id'].removesuffix('-waterfall') in eligible)]
        hits=0
        for row in selected:
            public=Path(row['public_task']);assert sha(public)==row['public_sha256']
            target=read(public.parent.parent/'groundtruth'/f'groundtruth_{row["task_id"]}.json')['ground truth']
            hits+=target in by_id[row['id']]['ordered_item_ids'][:5]
        independent[group]={'hits':hits,'assigned':len(selected),'hit_at_5':hits/len(selected) if selected else 0}
    assert independent==metrics
    acceptance={'passed':True,'assigned':len(rows),'valid_deliveries':sum(r['status']=='submitted' for r in outcomes),
      'native_method_failures':sum(r['status']=='failed' for r in outcomes),'same_public_inputs_and_twenty_candidates':True,
      'original_denominator_preserved':True,'frozen_before_labels':True,'official_metrics_independently_recomputed':True,
      'metrics_sha256':sha(HERE/f'{phase}-metrics.json'),'prediction_freeze_sha256':sha(HERE/f'{phase}-predictions-frozen.json'),
      'at':datetime.now(timezone.utc).isoformat()}
    save(HERE/f'{phase}-acceptance.json',acceptance)
    return acceptance

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=('prepare','run'));args=parser.parse_args()
    with (HERE/'queue.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.mode=='prepare':prepare()
        else:
            assignment=read(HERE/'assignment.json');files=assignment['files'];verify_files(files)
            files={**files,str(HERE/'assignment.json'):sha(HERE/'assignment.json'),**setup_domains(files)}
            pilot=execute('pilot',[r for r in assignment['rows'] if r['pilot']],files)
            save(HERE/'gate.json',{'passed':pilot['passed'],'pilot_acceptance_sha256':sha(HERE/'pilot-acceptance.json')})
            full=execute('full',assignment['rows'],files)
            save(HERE/'progress.json',{'phase':'full','status':'completed','completed':300,'assigned':300,
              'valid_deliveries':full['valid_deliveries'],'native_method_failures':full['native_method_failures'],
              'at':datetime.now(timezone.utc).isoformat()})
