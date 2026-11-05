"""Frozen KuaiRand local protocol. Pure Python, no model or hidden-label repair."""
import hashlib, itertools, math, random
SEED=42
WINDOWS={'train':(20220408,20220421),'dev':(20220422,20220428),'test':(20220429,20220508)}
def split(date):
    return next((name for name,(lo,hi) in WINDOWS.items() if lo<=int(date)<=hi),None)
def stable_seed(value,seed=SEED):
    return int.from_bytes(hashlib.sha256(f'{seed}:{value}'.encode()).digest()[:8],'big')
def cohort(user_ids,count,seed=SEED):
    return sorted(sorted(set(user_ids),key=lambda u:(stable_seed(f'user:{u}',seed),u))[:count])
def available_at(e):
    # Published logs lack a wall-clock end timestamp. This is the documented playback-end proxy.
    return e['time_ms']+max(0,e['play_time_ms'])
def candidate_ids(catalog,seen,target,task_id,seed=SEED):
    excluded=set(seen)|{target}
    if len(catalog)-len(set(catalog)&excluded)<100: return None
    rng=random.Random(stable_seed(task_id,seed)); out=[]; used=set(excluded)
    while len(out)<100:
        v=catalog[rng.randrange(len(catalog))]
        if v not in used: used.add(v); out.append(v)
    out.append(target); rng.shuffle(out)
    return out
def user_tasks(user_id,events,catalog,seed=SEED):
    """Select first novel positive BEFORE coverage checks, independently in each stratum/window."""
    ordered=sorted(events,key=lambda e:(e['time_ms'],e['event_id']))
    catalog=sorted(set(catalog)); catalog_set=set(catalog)
    seen=set(); selected={}; earlier=[]
    for timestamp,group in itertools.groupby(ordered,key=lambda e:e['time_ms']):
        group=list(group)
        for e in group:
            window=split(e['date']); stratum='random' if e['is_rand'] else 'standard'; key=(window,stratum)
            if window not in ('dev','test') or key in selected or e['long_view']!=1 or e['video_id'] in seen: continue
            task_id=f'kuairand:{user_id}:{window}:{stratum}'
            history=[x for x in earlier if available_at(x)<=timestamp]
            task=dict(task_id=task_id,user_id=user_id,split=window,stratum=stratum,
                      target=e['video_id'],target_event_id=e['event_id'],decision_time_ms=timestamp,
                      history=history,excluded_unfinished_history=len(earlier)-len(history))
            if e['video_id'] not in catalog_set: task.update(eligible=False,exclusion='target_outside_catalog')
            else:
                candidates=candidate_ids(catalog,seen,e['video_id'],task_id,seed)
                task.update(eligible=candidates is not None,candidate_ids=candidates,
                            exclusion=None if candidates is not None else 'fewer_than_100_controls')
            selected[key]=task
        seen.update(e['video_id'] for e in group); earlier.extend(group)
    for window in ('dev','test'):
        for stratum in ('standard','random'):
            if (window,stratum) not in selected:
                selected[(window,stratum)]=dict(task_id=f'kuairand:{user_id}:{window}:{stratum}',user_id=user_id,
                    split=window,stratum=stratum,eligible=False,exclusion='no_novel_long_view_target')
    return list(selected.values())
def metrics(target,ranking):
    rank=ranking.index(target)+1 if target in ranking else math.inf
    return {f'{name}@{k}':(float(rank<=k) if name=='Hit' else (1/math.log2(rank+1) if rank<=k else 0.0))
            for k in (10,20) for name in ('Hit','NDCG')}
def evaluate(tasks,predictions):
    """All eligible rows stay in denominator. Score actual valid delivery, never invent a ranking."""
    groups={}; strict_groups={}; details=[]
    for task in tasks:
        if not task['eligible']: continue
        candidates=[f'kuairand:{i}' for i in task['candidate_ids']]
        output=predictions.get(task['task_id'],{})
        ranking=output.get('ordered_item_ids',[])
        minimum=task.get('required_ranking_length',len(candidates))
        valid=(output.get('status','ok') in ('ok','completed','success','submitted') and isinstance(ranking,list) and all(isinstance(x,str) for x in ranking)
               and minimum<=len(ranking)<=len(candidates) and len(set(ranking))==len(ranking) and set(ranking)<=set(candidates))
        if not valid: ranking=[]
        strict=valid and not output.get('error') and not output.get('continuation_error') and not output.get('action_failures')
        values=metrics(f"kuairand:{task['target']}",ranking)
        details.append(dict(task_id=task['task_id'],valid=valid,fallback=False,strict_episode_success=strict,**values))
        for group in ('all',task['split']+':'+task['stratum']):
            acc=groups.setdefault(group,dict(n=0,invalid=0,**{k:0.0 for k in values}))
            acc['n']+=1; acc['invalid']+=not valid
            for k,v in values.items(): acc[k]+=v
            strict_acc=strict_groups.setdefault(group,dict(n=0,invalid=0,**{k:0.0 for k in values}))
            strict_acc['n']+=1;strict_acc['invalid']+=not strict
            for k,v in values.items():strict_acc[k]+=v if strict else 0.0
    for acc in [*groups.values(),*strict_groups.values()]:
        for k in list(acc):
            if k not in ('n','invalid'): acc[k]/=acc['n']
        acc['invalid_rate']=acc['invalid']/acc['n']
    return dict(groups=groups,strict_groups=strict_groups,per_task=details,fallback='none; invalid or missing delivery scores zero')
