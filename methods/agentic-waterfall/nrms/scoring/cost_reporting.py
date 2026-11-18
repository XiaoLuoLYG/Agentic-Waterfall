"""Aggregate only observed model usage; never invent a monetary price."""

def summarize_usage(rows):
    missing_counts=0;requests=0;calls=[];missing_receipts=0
    for r in rows:
        n=r.get('model_request_count');entries=r.get('model_calls',[])
        if type(n) is not int or n<0:missing_counts+=1
        else:
            requests+=n
            if not isinstance(entries,list):entries=[]
            missing_receipts+=max(0,n-len(entries))
        calls.extend(entries)
    missing_usage=missing_receipts;missing_duration=missing_receipts;totals={'prompt_tokens':0,'completion_tokens':0,'total_tokens':0};duration=0;models=set()
    for c in calls:
        usage=c.get('usage') or {}
        if not all(type(usage.get(k)) is int and usage[k]>=0 for k in totals):missing_usage+=1
        else:
            for k in totals:totals[k]+=usage[k]
        t=c.get('duration_ms')
        if not isinstance(t,(int,float)) or isinstance(t,bool) or t<0:missing_duration+=1
        else:duration+=t
        if c.get('requested_model'):models.add(c['requested_model'])
    complete=missing_counts==0 and missing_usage==0
    return {'model_requests':requests if missing_counts==0 else None,'known_model_requests':requests,'rows_missing_request_count':missing_counts,'receipts_missing':missing_receipts,'missing_usage_calls':missing_usage,'reported_token_totals':totals,'prompt_tokens':totals['prompt_tokens'] if complete else None,'completion_tokens':totals['completion_tokens'] if complete else None,'total_tokens':totals['total_tokens'] if complete else None,'model_call_duration_ms':duration if missing_counts==0 and missing_duration==0 else None,'requested_models':sorted(models),'monetary_cost':None,'monetary_cost_reason':'no verified per-model pricing or billing receipts supplied','latency_scope':'model-call durations only; excludes unmeasured local inference and wall-clock orchestration'}
