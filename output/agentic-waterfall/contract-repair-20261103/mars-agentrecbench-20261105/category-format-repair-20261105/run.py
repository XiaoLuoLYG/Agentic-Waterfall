"""Repair exactly five schema failures; reuse the other 295 frozen outcomes."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import argparse
import fcntl
import importlib.util
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
OLD=HERE.parent
BATCH=OLD.parent
spec=importlib.util.spec_from_file_location('frozen_mars_controller',OLD/'run.py')
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
read,save,sha,verify_files=native.read,native.save,native.sha,native.verify_files
IDS={f'ar-amazon-{i}-waterfall' for i in ('002','012','038','073','074')}

def reference(p):return {'path':str(p),'sha256':sha(p)}

def prepare():
    base=read(OLD/'full-predictions-frozen.json');assignment=read(OLD/'assignment.json')
    assert len(base)==300 and len(IDS)==5
    rows={r['id']:r for r in assignment['rows']};outcomes={r['id']:r for r in base};repairs=[]
    files=[Path(__file__),*HERE.glob('*.mjs'),OLD/'run.py',OLD/'run-case.mjs',OLD/'adapter.mjs',
      BATCH/'agentrecbench-fixed-controls-20261103/run.py',
      BATCH/'agentrecbench-fixed-controls-20261103/labels-denied.sb',
      BATCH/'transport-retry/register.mjs',BATCH/'transport-retry/model-client.mjs',
      BATCH/'transport-retry/ledger-store.mjs',BATCH/'transport-retry/request-gate.mjs',
      OLD/'domains/amazon.json',OLD/'full-predictions-frozen.json',OLD/'full-metrics.json',OLD/'assignment.json']
    files.extend((BATCH/'frozen/v6/code/methods/agentic-waterfall/mars').glob('*.mjs'))
    files.append(BATCH/'frozen/v6/code/methods/agentic-waterfall/mars/prompts.json')
    for ident in sorted(IDS):
        row=rows[ident];prior=outcomes[ident];path=Path(prior['result_path']);result=read(path)
        assert sha(path)==prior['result_sha256'] and result['status']=='failed' and result['error']=='invalid preference update'
        assert result['model_request_count']==1 and sha(Path(row['input']))==row['input_sha256']
        data={**row,'prior_result':reference(path),'prior_dir':str(path.parent),'domain_file':str(OLD/'domains/amazon.json')}
        for key,name in [('extract_request','01-extract.request.json'),('extract_response','01-extract.response.json'),('extract_payload','01-extract.payload.json')]:
            data[key]=reference(path.parent/name);files.append(path.parent/name)
        files.extend([path,Path(row['input'])]);repairs.append(data)
    plan={'user_approved_one_category_correction_per_case':True,'approval':'2026-11-05: 只修这5题，每题加1次格式纠正，其他成功结果复用，不全量重跑。',
      'selection':'All five frozen category-type ambiguity failures, selected by schema only; no target/hit selection.',
      'previous_full_scores_already_evaluated':True,'new_model_requests_contain_no_evaluator_labels':True,
      'max_additional_format_calls_per_case':1,'max_native_plus_format_calls_per_case':4,
      'max_new_successful_model_calls':15,'new_format_calls':5,'remaining_native_calls_max':10,
      'base_freeze':reference(OLD/'full-predictions-frozen.json'),'repair_rows':repairs,
      'files':{str(p):sha(p) for p in files}}
    path=HERE/'plan.json'
    if path.exists():assert read(path)==plan
    else:save(path,plan)
    save(HERE/'offline-acceptance.json',{'passed':True,'authorized_ids':sorted(IDS),'unchanged_outcomes':295,'new_model_calls':0,'plan_sha256':sha(path)})

def execute_case(row,files):
    verify_files(files);assert sha(Path(row['input']))==row['input_sha256']
    folder=HERE/'cases'/row['id'];folder.mkdir(parents=True,exist_ok=True)
    correction=folder/'correction';out=folder/'native-continuation';receipt=folder/'outcome.json'
    if not (correction/'selection.json').exists():
        assert not correction.exists(),'inspect interrupted format call; never resample it'
        cmd=['/usr/bin/sandbox-exec','-f',native.CONTROLS/'labels-denied.sb','node','--import',BATCH/'transport-retry/register.mjs',
          HERE/'correct.mjs',HERE/'plan.json',row['id'],correction]
        with (folder/'correction.log').open('xb') as log:
            p=subprocess.run(list(map(str,cmd)),env=native.ENV,cwd=HERE,stdout=log,stderr=subprocess.STDOUT,timeout=600)
        assert p.returncode==0,f'{row["id"]}: category correction failed; see preserved receipt'
    selection=read(correction/'selection.json');assert selection['task_id']==row['id'] and selection['additional_format_calls']==1
    reply=read(Path(selection['response']['path']));assert sha(Path(selection['response']['path']))==selection['response']['sha256']
    assert reply['status']=='success' and reply['provider_response_model']==native.MODEL
    if not (out/'result.json').exists():
        assert not out.exists(),'inspect interrupted native continuation before resuming'
        env={**native.ENV,'MARS_EXACT_PRIOR':row['prior_dir'],'MARS_CATEGORY_CORRECTION':str(correction/'selection.json')}
        cmd=['/usr/bin/sandbox-exec','-f',native.CONTROLS/'labels-denied.sb','node','--import',BATCH/'transport-retry/register.mjs',
          '--import',HERE/'register.mjs',OLD/'run-case.mjs','case',row['input'],row['domain_file'],out]
        with (folder/'continuation.log').open('xb') as log:
            p=subprocess.run(list(map(str,cmd)),env=env,cwd=HERE,stdout=log,stderr=subprocess.STDOUT,timeout=900)
        assert p.returncode in (0,1)
    value=native.check_case(row,out);result=read(out/'result.json')
    assert result['reused_model_request_count']==1 and result['new_model_request_count']<=2
    assert read(out/'01-extract.request.json')==read(Path(row['extract_request']['path']))
    assert read(out/'01-extract.response.json')==read(Path(row['extract_response']['path']))
    value.update(additional_format_calls=1,total_logical_calls=result['model_request_count']+1,
      new_successful_model_calls=result['new_model_request_count']+1,category_selection=reference(correction/'selection.json'))
    assert value['total_logical_calls']<=4
    verify_files(files)
    if receipt.exists():assert read(receipt)==value
    else:save(receipt,value)
    return value

def execute():
    plan=read(HERE/'plan.json');files={**plan['files'],str(HERE/'plan.json'):sha(HERE/'plan.json')};verify_files(files)
    replacements={}
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures=[pool.submit(execute_case,row,files) for row in plan['repair_rows']]
        for future in as_completed(futures):
            value=future.result();replacements[value['id']]=value
            save(HERE/'progress.json',{'status':'running','completed':len(replacements),'assigned':5})
    assert set(replacements)==IDS
    before=read(OLD/'full-predictions-frozen.json');merged=[replacements.get(r['id'],r) for r in before]
    assert len(merged)==300
    for old,current in zip(before,merged):
        if old['id'] not in IDS:assert old==current and sha(Path(old['result_path']))==old['result_sha256']
    # Freeze the updated predictions before the new official and independent scoring passes.
    native.controls.HERE=HERE
    rows=read(OLD/'assignment.json')['rows']
    metrics=native.controls.score('full',rows,merged)['mars']
    eligible={k.removesuffix('-i2agent') for k,v in read(native.controls.AR/'evaluation/predictions-frozen.json')['outcomes'].items()
      if v['method']=='i2agent' and v['status']!='not_applicable'}
    by_id={r['id']:r for r in merged};manual={}
    for group in ('amazon','goodreads','yelp','all','matched220'):
        selected=[r for r in rows if r['domain']==group or group=='all' or group=='matched220' and r['id'].removesuffix('-waterfall') in eligible]
        hits=0
        for row in selected:
            public=Path(row['public_task']);assert sha(public)==row['public_sha256']
            target=read(public.parent.parent/'groundtruth'/f'groundtruth_{row["task_id"]}.json')['ground truth']
            hits+=target in by_id[row['id']]['ordered_item_ids'][:5]
        manual[group]={'hits':hits,'assigned':len(selected),'hit_at_5':hits/len(selected)}
    assert metrics==manual
    artifacts={str(p):sha(p) for p in (HERE/'cases').glob('**/*.json')}
    acceptance={'passed':True,'assigned':300,'repaired_cases':5,'repair_valid_deliveries':sum(r['status']=='submitted' for r in replacements.values()),
      'unchanged_outcomes_reused':295,'unchanged_legal_rankings_reused':286,'native_candidate_failures_preserved':9,
      'all_original_extract_responses_reused':True,'format_calls':5,'new_calls_successful_max':15,
      'original_inputs_candidates_models_and_denominators_preserved':True,'only_category_fields_changed':True,
      'updated_prediction_freeze_precedes_this_rescoring':True,'original_full_scores_preexisted_this_repair':True,
      'selection_was_schema_based_not_target_or_score_based':True,'official_metrics_independently_recomputed':True,
      'strict_equal_cost_claimed':False,'metrics_sha256':sha(HERE/'full-metrics.json'),
      'freeze_sha256':sha(HERE/'full-predictions-frozen.json'),'artifact_sha256':artifacts,'at':datetime.now(timezone.utc).isoformat()}
    save(HERE/'acceptance.json',acceptance);save(HERE/'progress.json',{'status':'completed','completed':5,'assigned':5})
    print(json.dumps({k:v for k,v in acceptance.items() if k!='artifact_sha256'},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=('prepare','run'));args=parser.parse_args()
    with (HERE/'queue.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        prepare() if args.mode=='prepare' else execute()
