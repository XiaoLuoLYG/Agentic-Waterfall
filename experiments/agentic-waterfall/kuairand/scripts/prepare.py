#!/usr/bin/env python3
"""Prepare global time split and a label-blind evaluation user cohort from official CSVs."""
import argparse,collections,csv,datetime,hashlib,json,pathlib,sqlite3
from protocol import SEED,WINDOWS,available_at,cohort,split,user_tasks
ROOT=pathlib.Path(__file__).resolve().parents[1]
FIELDS=['user_id','video_id','date','time_ms','long_view','is_rand','play_time_ms','duration_ms','is_click','is_like','is_hate','is_follow','is_comment','is_forward']
OPTIONAL_FIELDS=['hourmin','profile_stay_time','comment_stay_time','is_profile_enter','tab']
FEEDBACK_CONTRACT=json.loads((ROOT.parents[2]/'methods/agentic-waterfall/i2agent/kuairand-feedback-contract.json').read_text())
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
    return h.hexdigest()
def iso_ms(value):return datetime.datetime.fromtimestamp(value/1000,datetime.timezone.utc).isoformat()
def main():
    p=argparse.ArgumentParser();p.add_argument('--raw',type=pathlib.Path,default=ROOT/'data'/'raw')
    p.add_argument('--output',type=pathlib.Path,default=ROOT/'data'/'prepared')
    p.add_argument('--eval-users',type=int,default=32);p.add_argument('--seed',type=int,default=SEED);p.add_argument('--synthetic',action='store_true')
    p.add_argument('--training-cutoff-ms',type=int,help='Global label-independent training completion cutoff; recorded as protocol v2')
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
    user_file=a.raw/'user_features_1k.csv'
    with user_file.open() as f: users=sorted(int(r['user_id']) for r in csv.DictReader(f))
    user_set=set(users)
    chosen=cohort(users,min(a.eval_users,len(users)),a.seed);chosen_set=set(chosen)
    (a.output/'cohort.json').write_text(json.dumps(dict(seed=a.seed,users=chosen,rule='lowest SHA256(seed:user:ID); chosen before labels'),indent=2))
    histories=collections.defaultdict(list);train=collections.defaultdict(list);train_seen=set();stats=[]
    train_end=int(datetime.datetime(2022,4,22,tzinfo=datetime.timezone(datetime.timedelta(hours=8))).timestamp()*1000)
    if a.training_cutoff_ms is not None:train_end=min(train_end,a.training_cutoff_ms)
    excluded_train_rows=0;excluded_train_positives=0
    for name in ['log_standard_4_08_to_4_21_1k.csv','log_standard_4_22_to_5_08_1k.csv','log_random_4_22_to_5_08_1k.csv']:
        path=a.raw/name;count=0;dates=collections.Counter();bad_dates=0;u_seen=set();v_min=None;v_max=None
        with path.open(newline='') as f:
            reader=csv.DictReader(f)
            missing=set(FIELDS)-set(reader.fieldnames)
            if missing:raise ValueError(f'{name} missing {missing}')
            for count,r in enumerate(reader,1):
                e={k:int(r[k]) for k in FIELDS+OPTIONAL_FIELDS if k in r};e['event_id']=name+':'+str(count)
                if any(e[k] not in (0,1) for k in ('long_view','is_rand')):raise ValueError('invalid feedback flag')
                if split(e['date']) is None:raise ValueError('date outside declared windows')
                if e['user_id'] not in user_set:raise ValueError('unknown user ID')
                if bool(e['is_rand'])!=name.startswith('log_random'):raise ValueError('exposure stratum/file mismatch')
                dates[e['date']]+=1;u_seen.add(e['user_id']);v=e['video_id'];v_min=v if v_min is None else min(v_min,v);v_max=v if v_max is None else max(v_max,v)
                actual_date=int(datetime.datetime.fromtimestamp(e['time_ms']/1000,datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d'))
                bad_dates+=actual_date!=e['date']
                if split(e['date'])=='train':
                    completed=available_at(e)<train_end
                    if a.training_cutoff_ms is None or completed:train_seen.add(v)
                    if not completed:excluded_train_rows+=1;excluded_train_positives+=e['long_view']==1
                    if e['long_view']==1 and completed:train[e['user_id']].append((e['time_ms'],e['event_id'],v))
                if e['user_id'] in chosen_set:histories[e['user_id']].append(e)
                if count%1000000==0:print(json.dumps(dict(file=name,rows=count)),flush=True)
        stats.append(dict(file=name,rows=count,date_counts=dates,users=len(u_seen),video_min=v_min,video_max=v_max,date_time_mismatches=bad_dates,sha256=sha(path)))
    db=sqlite3.connect(a.output/'catalog.sqlite');db.execute('CREATE TABLE items(video_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
    valid=set();basic_count=0;batch=[]
    with (a.raw/'video_features_basic_1k.csv').open(newline='') as f:
        for r in csv.DictReader(f):
            basic_count+=1;v=int(r['video_id'])
            if v not in train_seen:continue
            duration=r.get('video_duration','');tag=r.get('tag','')
            if not any(x and x.lower() not in ('nan','null') for x in (duration,tag)):continue
            item=dict(id=f'kuairand:{v}',source_id='kuairand-1k',content_type='video',
                title=f'KuaiRand video {v}',text='; '.join(f'{k}={r.get(k, "")}' for k in ('video_duration','author_id','video_type','upload_dt','tag')),tags=[x.strip() for x in tag.split(',') if x.strip()],
                metadata={k:r.get(k,'') for k in ('video_duration','author_id','video_type','upload_dt','upload_type','music_id')},
                content_provenance='KuaiRand-1K basic metadata; ID display name, no invented caption; no monthly statistics')
            batch.append((v,json.dumps(item,ensure_ascii=False)));valid.add(v)
            if len(batch)>=10000:db.executemany('INSERT INTO items VALUES (?,?)',batch);batch=[]
    if batch:db.executemany('INSERT INTO items VALUES (?,?)',batch)
    db.commit();catalog=sorted(valid)
    (a.output/'catalog-ids.json').write_text(json.dumps(catalog))
    itemmap={v:i+1 for i,v in enumerate(catalog)}
    (a.output/'id-map.json').write_text(json.dumps(dict(items={str(k):v for k,v in itemmap.items()},users={str(u):i+1 for i,u in enumerate(users)})))
    train_seq={str(u):[v for _,_,v in sorted(es) if v in valid] for u,es in train.items()}
    (a.output/'train-sequences.json').write_text(json.dumps(train_seq))
    tasks=[]
    for u in chosen:tasks.extend(user_tasks(u,histories[u],catalog,a.seed))
    with (a.output/'private-tasks.jsonl').open('w') as private,(a.output/'public-inputs.jsonl').open('w') as public:
        for t in tasks:
            private.write(json.dumps(t)+'\n')
            if not t['eligible']:continue
            candidates=[json.loads(db.execute('SELECT payload FROM items WHERE video_id=?',(v,)).fetchone()[0]) for v in t['candidate_ids']]
            behavior=[dict(id=e['event_id'],type='video_exposure_feedback',item_id=f"kuairand:{e['video_id']}",
                occurred_at=iso_ms(e['time_ms']),available_at=iso_ms(available_at(e)),payload={k:e[k] for k in FIELDS+OPTIONAL_FIELDS if k in e and k not in ('user_id','video_id','time_ms')}) for e in t['history']]
            observation=dict(schema_version='1',decision_id=t['task_id'],user_id=f'kuairand-user:{t["user_id"]}',
                session_id=f'kuairand-log:{t["user_id"]}',observed_at=iso_ms(t['decision_time_ms']),trigger='offline_next_item',dialogue=[],
                behavior_events=behavior,user_state=dict(version=0,records=[]),environment=dict(data_contract=FEEDBACK_CONTRACT,candidate_pool=candidates,
                sources=[],pending_queue=[],visible_item_ids=[],content_version='kuairand-1k-basic-train-window-v1'))
            public.write(json.dumps(dict(observation=observation,protocol=dict(mode='fixed_candidates',top_k=101,
                require_full_ranking=True,max_model_calls=3,max_tool_calls=10,max_output_tokens=8192),
                run_meta=dict(kind='smoke' if a.synthetic else 'subset',synthetic=a.synthetic,seed=a.seed,history_policy='all completed prefix; no truncation in prepared input',
                feedback_availability='time_ms + play_time_ms proxy; no published wall-clock completion timestamp',
                no_user_expression=True)),ensure_ascii=False)+'\n')
    counts=collections.Counter((t['split']+':'+t['stratum']+':'+('eligible' if t['eligible'] else t['exclusion'])) for t in tasks)
    report=dict(kind='smoke' if a.synthetic else ('subset' if len(chosen)<len(users) else 'full'),synthetic=a.synthetic,seed=a.seed,windows=WINDOWS,
        eval_users=chosen,train_users=len(train_seq),train_positive_events=sum(map(len,train_seq.values())),
        train_seen_items=len(train_seen),catalog_items=len(catalog),missing_basic_items=len(train_seen)-len(catalog),
        basic_rows=basic_count,files=stats,task_counts=counts,target_definition='first novel long_view=1 per user/window/stratum, before coverage',
        candidate_rule='target plus 100 distinct unseen controls; deterministic shuffled order',
        completion_proxy='time_ms + play_time_ms; use published date for global split',
        training_cutoff_ms=train_end,protocol_version='v2-global-completed-event-cutoff' if a.training_cutoff_ms is not None else 'v1-date-only-catalog',
        excluded_train_rows_by_completion_cutoff=excluded_train_rows,excluded_train_positive_rows_by_completion_cutoff=excluded_train_positives,
        monthly_statistics_used=False,semantic_supplement_used=False)
    db.close();report['catalog_sha256']=sha(a.output/'catalog-ids.json')
    (a.output/'preparation-manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
