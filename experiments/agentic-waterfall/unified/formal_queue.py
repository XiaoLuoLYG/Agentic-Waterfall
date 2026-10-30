"""Single-worker Waterfall queue; preserve attempts and bound transient-service retries."""
import argparse,collections,datetime,hashlib,json,os,pathlib,re,shutil,signal,subprocess,time

TRANSIENT_ERRORS={'model_http_502','model_http_503','model_http_504','model_timeout','model_transport_error'}
RETRY_DELAYS=(30,90)

def save(path,value):
    path=pathlib.Path(path);tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');os.replace(tmp,path)

def result_state(output,started):
    if output.exists():return 'completed'
    if started.exists():return 'interrupted'
    return 'pending'

def infrastructure_failure(result):
    errors=[result.get('error'),result.get('continuation_error')]+[x.get('error') for x in result.get('model_calls',[])]
    return next((e for e in errors if e and (e in {'model_transport_error','model_timeout','model_missing_content','model_slots_busy','ledger_locked_manual_inspection_required','model_calls_not_enabled'} or e.startswith(('model_http_','global_request_','experiment_request_')))),None)

def failure_reason(result):
    failure=infrastructure_failure(result) or result.get('continuation_error')
    if failure:return failure
    if result.get('status')!='submitted':return result.get('error') or 'no_valid_submission'
    trace=result.get('trace',[])
    for call in result.get('model_calls',[]):
        if call.get('error') not in {'model_invalid_json','model_output_truncated','invalid_batch_ranking'}:continue
        index=call.get('context',{}).get('call_index')
        corrected=type(index) is int and any(type(step.get('call_index')) is int and step['call_index']>index and any(r.get('kind')=='recommend' and r.get('status')=='success' for r in step.get('execution_results',[])) for step in trace)
        if not corrected:return call['error']
    receipts=[receipt for step in trace for receipt in step.get('execution_results',[])]
    recoverable={'unacquired_recommendation','invalid_candidate_indices','invalid_ranking','incomplete_ranking','too_many_recommendations','invalid_delivery'}
    for i,receipt in enumerate(receipts):
        if receipt.get('status')=='skipped' or receipt.get('error')=='dependency_failed':return 'skipped_dependency; inspect before continuing'
        if receipt.get('status')!='failed':continue
        corrected=receipt.get('kind')=='recommend' and receipt.get('error') in recoverable and any(r.get('kind')=='recommend' and r.get('status')=='success' for r in receipts[i+1:])
        if not corrected:return 'failed_tool_action; inspect before continuing'
    return None

def retryable_failure(result):
    if result.get('status')!='failed' or result.get('ordered_item_ids'):return None
    errors=[result.get('error'),result.get('continuation_error')]+[x.get('error') for x in result.get('model_calls',[])]
    errors=[error for error in errors if error]
    if not errors or any(error not in TRANSIENT_ERRORS for error in errors):return None
    if any(r.get('status') in {'failed','skipped'} or r.get('error') for step in result.get('trace',[]) for r in step.get('execution_results',[])):return None
    return errors[0]

def read_committed(output,task):
    row=json.loads(output.read_text());result=row['result']
    if (row['task']['id']!=task['id'] or row['task']['dataset']!=task['dataset'] or
        not isinstance(row.get('input',{}).get('observation',{}).get('decision_id'),str) or
        result.get('decision_id')!=row['input']['observation']['decision_id'] or
        not isinstance(result.get('model_calls'),list) or
        result.get('status') not in {'submitted','failed','idle'}):raise ValueError('committed_result_identity_or_structure_mismatch')
    return result

def archive_attempt(run,task,number):
    folder=run/'attempts'/task['id']/f'service-attempt-{number:03d}';folder.mkdir(parents=True,exist_ok=True)
    files={'result.json':run/'results'/(task['id']+'.json'),'started.json':run/'started'/(task['id']+'.json'),'log.txt':run/'logs'/(task['id']+'.log')}
    hashes={}
    for name,source in files.items():
        digest=hashlib.sha256(source.read_bytes()).hexdigest();target=folder/name
        if target.exists():
            if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise ValueError('attempt_archive_mismatch')
        else:shutil.copy2(source,target)
        hashes[name]=digest
    receipt={'attempt':number,'task':task['id'],'sha256':hashes};saved=folder/'receipt.json'
    if saved.exists() and json.loads(saved.read_text())!=receipt:raise ValueError('attempt_receipt_mismatch')
    if not saved.exists():save(saved,receipt)

def wait_for_retry(seconds,stopped):
    for _ in range(seconds):
        if stopped():return False
        time.sleep(1)
    return not stopped()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-dir',type=pathlib.Path,required=True);parser.add_argument('--max-new-tasks',type=int);args=parser.parse_args()
    run=args.run_dir.resolve();plan=json.loads((run/'plan.json').read_text());tasks=[json.loads(x) for x in (run/'tasks.jsonl').read_text().splitlines()]
    lock=run/'queue.lock';lock.mkdir();(lock/'pid').write_text(str(os.getpid()))
    stop=False
    def stopping(*_):
        nonlocal stop
        stop=True
    signal.signal(signal.SIGTERM,stopping);signal.signal(signal.SIGINT,stopping)
    env=dict(os.environ,MODEL_CONFIG_FILE=plan['model_config_file'],WATERFALL_MODEL_TIMEOUT_MS='180000',NODE_OPTIONS='--max-old-space-size=384',OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1',VECLIB_MAXIMUM_THREADS='1',TOKENIZERS_PARALLELISM='false',PYTHONDONTWRITEBYTECODE='1')
    if plan.get('model_name'):env['OPENAI_MODEL']=plan['model_name']
    counts=collections.Counter();start=time.time();peak_rss=0;new_tasks=0
    def progress(status,**extra):
        save(run/'progress.json',{'status':status,'pid':os.getpid(),'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'total':len(tasks),'counts':dict(counts),'elapsed_seconds':round(time.time()-start),'peak_child_rss_kib':peak_rss,**extra})
    try:
        for task in tasks:
            if stop:progress('stopped');return
            output=run/'results'/(task['id']+'.json');started=run/'started'/(task['id']+'.json')
            state=result_state(output,started)
            attempt=1;retry=None
            if state=='completed':
                result=read_committed(output,task);failure=failure_reason(result)
                if not failure or (run/'reviewed'/(task['id']+'.json')).exists():counts[task['dataset']+':'+result['status']]+=1;continue
                attempt=json.loads(started.read_text()).get('attempt',1)
                retry=retryable_failure(result)
                if not retry or attempt>=3:progress('needs_attention',task=task['id'],reason=failure,attempt=attempt);return
                archive_attempt(run,task,attempt)
                attempt+=1
            if state=='interrupted':progress('needs_attention',task=task['id'],reason='previous_attempt_without_committed_result; inspect ledger before any retry');return
            if state=='pending' and (run/'attempts'/task['id']).exists():progress('needs_attention',task=task['id'],reason='archived_attempt_without_current_result; inspect before continuing');return
            if args.max_new_tasks is not None and new_tasks>=args.max_new_tasks:progress('preflight_complete');return
            previous=run/'results'/(task['previous']+'.json') if task.get('previous') else None
            if previous and not previous.exists():progress('needs_attention',task=task['id'],reason='missing_previous_state');return
            if previous:
                prior_state=json.loads(previous.read_text())['result'].get('state_after',{})
                if not isinstance(prior_state.get('version'),int) or not isinstance(prior_state.get('records'),list):progress('needs_attention',task=task['id'],reason='previous_state_invalid');return
            while True:
                if retry:
                    delay=RETRY_DELAYS[attempt-2];progress('waiting_for_service',task=task['id'],reason=retry,attempt=attempt,delay_seconds=delay)
                    if not wait_for_retry(delay,lambda:stop):progress('stopped');return
                while shutil.disk_usage(run).free<20*1024**3 or memory_free()<20:
                    progress('waiting_for_resources',task=task['id'],attempt=attempt)
                    if not wait_for_retry(30,lambda:stop):progress('stopped');return
                if stop:progress('stopped');return
                logfile=run/'logs'/(task['id']+'.log')
                if retry:
                    # Every removed canonical file already has a verified immutable attempt copy.
                    for path in (output,started,logfile):path.unlink()
                save(started,{'task':task['id'],'attempt':attempt,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
                taskfile=run/'task-configs'/(task['id']+'.json');save(taskfile,task);cmd=['node',str(run/'code/experiments/agentic-waterfall/unified/formal_task.mjs'),str(taskfile),str(output)]
                if previous:cmd.append(str(previous))
                progress('running',current=task['id'],attempt=attempt)
                with logfile.open('x') as log:
                    child=subprocess.Popen(cmd,cwd=run/'code',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);deadline=time.time()+1800
                    while child.poll() is None:
                        time.sleep(3)
                        if time.time()>deadline:
                            os.killpg(child.pid,signal.SIGTERM)
                            try:child.wait(timeout=30)
                            except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
                            progress('needs_attention',task=task['id'],reason='task_hard_timeout_1800s');return
                        ps=subprocess.run(['ps','-o','rss=','-p',str(child.pid)],capture_output=True,text=True)
                        if ps.stdout.strip().isdigit():peak_rss=max(peak_rss,int(ps.stdout.strip()))
                    code=child.returncode
                if code!=0 or not output.exists():progress('needs_attention',task=task['id'],exit_code=code,reason='task_process_failed; no automatic retry');return
                result=read_committed(output,task)
                with (run/'events.jsonl').open('a') as f:f.write(json.dumps({'id':task['id'],'attempt':attempt,'status':result['status'],'error':result.get('error'),'model_requests':result.get('model_request_count'),'duration_ms':result.get('duration_ms')})+'\n')
                failure=failure_reason(result)
                if not failure:
                    counts[task['dataset']+':'+result['status']]+=1;new_tasks+=1;break
                retry=retryable_failure(result)
                if not retry or attempt>=3:counts[task['dataset']+':'+result['status']]+=1;progress('needs_attention',task=task['id'],reason=failure,attempt=attempt);return
                archive_attempt(run,task,attempt)
                attempt+=1
            progress('running',last=task['id'])
        progress('scoring')
        with (run/'scoring.log').open('a') as log:
            scored=subprocess.run(['python3',str(run/'code/experiments/agentic-waterfall/unified/score_formal.py'),'--run-dir',str(run)],env=env,stdout=log,stderr=subprocess.STDOUT)
        if scored.returncode==0:
            with (run/'scoring.log').open('a') as log:scored=subprocess.run(['python3',str(run/'code/experiments/agentic-waterfall/unified/score_formal_clawrec.py'),'--run-dir',str(run)],env=env,stdout=log,stderr=subprocess.STDOUT)
        progress('completed' if scored.returncode==0 else 'predictions_complete_scoring_needs_attention',scoring_exit_code=scored.returncode)
    except (OSError,ValueError,KeyError,TypeError) as error:
        progress('needs_attention',reason=f'queue_artifact_error: {error}')
    finally:
        (lock/'pid').unlink();lock.rmdir()

def memory_free():
    checked=subprocess.run(['memory_pressure','-Q'],capture_output=True,text=True)
    found=re.search(r'memory free percentage:\s*(\d+)%',checked.stdout)
    return int(found[1]) if found else 100

if __name__=='__main__':main()
