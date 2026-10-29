"""Prepare every eligible KuaiRand test task with the frozen v2 protocol, one user at a time."""
import argparse
import collections
import csv
import hashlib
import heapq
import itertools
import json
import pathlib
import resource
import sqlite3
import sys
import time

WORKSPACE=pathlib.Path(__file__).resolve().parents[3]
SCRIPTS=WORKSPACE/'experiments/agentic-waterfall/kuairand/scripts'
sys.path.insert(0,str(SCRIPTS))
from prepare import FIELDS,iso_ms,sha
from protocol import SEED,available_at,split,user_tasks
sys.path.insert(0,str(WORKSPACE/'methods/agentic-waterfall/kuairand'))
from attach_captions import checked_caption,clip

LOGS=['log_standard_4_08_to_4_21_1k.csv','log_standard_4_22_to_5_08_1k.csv','log_random_4_22_to_5_08_1k.csv']


def events(path,users,counts):
    previous=-1
    with path.open(newline='') as f:
        reader=csv.DictReader(f)
        if set(FIELDS)-set(reader.fieldnames):raise ValueError(f'missing fields: {path.name}')
        for number,row in enumerate(reader,1):
            event={key:int(row[key]) for key in FIELDS}
            user=event['user_id']
            if user<previous:raise ValueError(f'logs not ordered by user: {path.name}:{number}')
            if user not in users or split(event['date']) is None:raise ValueError('unknown user or date')
            if event['long_view'] not in (0,1) or event['is_rand'] not in (0,1):raise ValueError('invalid flag')
            if bool(event['is_rand'])!=path.name.startswith('log_random'):raise ValueError('stratum mismatch')
            previous=user
            event['event_id']=f'{path.name}:{number}'
            counts[path.name]+=1
            yield event


def public_input(task,db):
    candidates=[]
    for video in task['candidate_ids']:
        found=db.execute('SELECT payload FROM items WHERE video_id=?',(video,)).fetchone()
        if not found:raise ValueError('candidate absent from frozen catalog')
        candidates.append(json.loads(found[0]))
    behavior=[]
    for event in task['history'][-64:]:
        payload={key:event[key] for key in FIELDS if key not in ('user_id','video_id','time_ms')}
        found=db.execute('SELECT payload FROM items WHERE video_id=?',(event['video_id'],)).fetchone()
        if found:payload['content_metadata']=json.loads(found[0])['text']
        behavior.append(dict(id=event['event_id'],type='video_exposure_feedback',item_id=f"kuairand:{event['video_id']}",
            occurred_at=iso_ms(event['time_ms']),available_at=iso_ms(available_at(event)),payload=payload))
    observation=dict(schema_version='1',decision_id=task['task_id'],user_id=f"kuairand-user:{task['user_id']}",
        session_id=f"kuairand-log:{task['user_id']}",observed_at=iso_ms(task['decision_time_ms']),trigger='offline_next_item',
        dialogue=[],behavior_events=behavior,user_state=dict(version=0,records=[]),
        environment=dict(candidate_pool=candidates,sources=[],pending_queue=[],visible_item_ids=[],content_version='kuairand-1k-basic-train-window-v2'))
    return dict(observation=observation,protocol=dict(mode='fixed_candidates',top_k=101,require_full_ranking=True,
        max_model_calls=3,max_tool_calls=10,max_output_tokens=8192),run_meta=dict(kind='split_complete',synthetic=False,
        split='test',stratum=task['stratum'],seed=SEED,history_policy='last 64 completed raw events',
        archived_history_events=len(task['history']),memory_retention='original raw histories preserved; per-user model state persisted by runner',
        temporal_protocol='v2-global-completed-event-cutoff',feedback_availability='time_ms + play_time_ms proxy',
        selection='all eligible test tasks from all 1000 users; original first novel positive before coverage rule',no_user_expression=True))


def attach_captions(data,source,dest,required):
    path=data/'kuairand-video-captions-20261029.csv'
    manifest=json.loads((data/'captions-full-20261029-manifest.json').read_text())
    if not manifest.get('official_md5_verified') or path.stat().st_size!=manifest['bytes'] or sha(path)!=manifest['sha256']:
        raise ValueError('full caption source hash mismatch')
    basic={}
    with (data/'raw/video_features_basic_1k.csv').open(newline='') as f:
        for row in csv.DictReader(f):
            video=int(row['video_id'])
            if video in required:basic[video]={'video_duration':row.get('video_duration')}
    selected={};states={};previous=-1
    with path.open(newline='') as f:
        reader=csv.DictReader(f,strict=True)
        if reader.fieldnames!=['final_video_id','caption','show_cover_text','duration']:raise ValueError('caption columns changed')
        for row in reader:
            video=int(row['final_video_id'])
            if video!=previous+1:raise ValueError('caption ID order changed')
            previous=video
            if video not in required:continue
            if any(value is None for value in row.values()):raise ValueError('incomplete caption row')
            status=checked_caption(basic.get(video,{}),row)
            if status=='matched':
                if not row['caption'] and not row['show_cover_text']:status='empty'
                selected[video]={'caption':clip(row['caption'],64),'cover':clip(row['show_cover_text'],32),
                    'hash':hashlib.sha256(json.dumps(row,ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
            states[video]=status
            if len(states)==len(required):break
    for video in required-states.keys():states[video]='missing'
    with source.open() as inp,dest.open('x') as output:
        for line in inp:
            row=json.loads(line);obs=row['observation']
            for item in obs['environment']['candidate_pool']:
                video=int(item['id'].split(':')[1]);caption=selected.get(video)
                item['caption_status']=states[video]
                if caption:
                    item['title']=caption['caption'] or item['title']
                    item['text']+='; cover_text='+caption['cover'];item['content_hash']=caption['hash']
            for event in obs['behavior_events']:
                video=int(event['item_id'].split(':')[1]);caption=selected.get(video)
                event['payload']['caption_status']=states[video]
                if caption:event['payload'].update(caption_excerpt=caption['caption'],cover_excerpt=caption['cover'])
            row['run_meta'].update(content_scope='official caption first 64 UTF8 bytes and cover first 32 bytes; verified against basic duration',
                caption_missing_policy='retain basic metadata and explicit status for missing, empty, unverifiable or mismatched captions; never replace tasks',
                caption_temporal_scope='2026 retrospective supplement; not claimed available in 2022')
            output.write(json.dumps(row,ensure_ascii=False)+'\n')
    return dict(full_caption_sha256=manifest['sha256'],required_ids=len(required),status_counts=dict(collections.Counter(states.values())))


def prepare(data,output):
    started=time.monotonic();output.mkdir(parents=True,exist_ok=False)
    private=output/'evaluator-only';private.mkdir()
    prepared=data/'prepared-v2';frozen=json.loads((prepared/'preparation-manifest.json').read_text())
    if frozen['protocol_version']!='v2-global-completed-event-cutoff':raise ValueError('v2 catalog required')
    source_hashes={}
    for info in frozen['files']:
        path=data/'raw'/info['file'];source_hashes[str(path)]=sha(path)
        if source_hashes[str(path)]!=info['sha256']:raise ValueError('raw data changed since v2 preparation')
    for path in (data/'raw/user_features_1k.csv',data/'raw/video_features_basic_1k.csv',prepared/'catalog.sqlite'):
        source_hashes[str(path)]=sha(path)
    if sha(prepared/'catalog-ids.json')!=frozen['catalog_sha256']:raise ValueError('frozen catalog IDs changed')
    catalog=json.loads((prepared/'catalog-ids.json').read_text())
    with (data/'raw/user_features_1k.csv').open() as f:users=sorted(int(row['user_id']) for row in csv.DictReader(f))
    if len(users)!=len(set(users)):raise ValueError('duplicate user')
    user_set=set(users);counts=collections.Counter();task_counts=collections.Counter();required=set();task_ids=[];seen_users=set()
    db=sqlite3.connect(f'file:{prepared / "catalog.sqlite"}?mode=ro',uri=True)
    db.execute('PRAGMA cache_size=-16384')
    merged=heapq.merge(*(events(data/'raw'/name,user_set,counts) for name in LOGS),key=lambda e:e['user_id'])
    base=output/'public-basic-inputs.jsonl'
    with base.open('x') as public,(private/'private-tasks.jsonl').open('x') as hidden:
        for user,group in itertools.groupby(merged,key=lambda e:e['user_id']):
            seen_users.add(user)
            tasks=user_tasks(user,list(group),catalog,SEED)
            for task in tasks:
                if task['split']!='test':continue
                task_counts[f"test:{task['stratum']}:{'eligible' if task['eligible'] else task['exclusion']}"]+=1
                if task['eligible']:
                    row=public_input(task,db);task_ids.append(task['task_id'])
                    required.update(int(item['id'].split(':')[1]) for item in row['observation']['environment']['candidate_pool'])
                    required.update(int(event['item_id'].split(':')[1]) for event in row['observation']['behavior_events'])
                    public.write(json.dumps(row,ensure_ascii=False)+'\n')
                task['history']=task.get('history',[])[-64:]
                hidden.write(json.dumps(task)+'\n')
            if len(seen_users)%25==0:print(json.dumps(dict(phase='tasks',users=len(seen_users),eligible=len(task_ids),elapsed_s=round(time.monotonic()-started,1))),flush=True)
        for user in user_set-seen_users:
            for task in user_tasks(user,[],catalog,SEED):
                if task['split']=='test':
                    task_counts[f"test:{task['stratum']}:{task['exclusion']}"]+=1
                    hidden.write(json.dumps(task)+'\n')
    db.close()
    if dict(counts)!={entry['file']:entry['rows'] for entry in frozen['files']}:raise ValueError('raw row count changed')
    if len(task_ids)!=len(set(task_ids)):raise ValueError('duplicate public task')
    print(json.dumps(dict(phase='captions',eligible=len(task_ids),required_ids=len(required))),flush=True)
    captions=attach_captions(data,base,output/'public-inputs.jsonl',required)
    report=dict(kind='split_complete',dataset='KuaiRand-1K',split='test',synthetic=False,seed=SEED,users=len(users),
        users_with_logs=len(seen_users),n=len(task_ids),task_ids=task_ids,task_counts=dict(task_counts),raw_rows=dict(counts),
        input_sha256=sha(output/'public-inputs.jsonl'),evaluator_sha256=sha(private/'private-tasks.jsonl'),
        source_sha256=source_hashes,prepared_manifest_sha256=sha(prepared/'preparation-manifest.json'),
        catalog_sha256=frozen['catalog_sha256'],training_cutoff_ms=frozen['training_cutoff_ms'],
        script_sha256=sha(pathlib.Path(__file__)),protocol_sha256=sha(SCRIPTS/'protocol.py'),
        history_event_limit=64,top_k=101,max_model_requests=3*len(task_ids),caption_join=captions,
        selection='original v2 first novel long_view target before catalog coverage; every eligible test task retained',
        labels_used_for_model_selection=False,model_calls=0,downloads=0,elapsed_seconds=time.monotonic()-started,
        peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss if sys.platform=='darwin' else 1024*resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    (output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({key:report[key] for key in ('n','users','task_counts','caption_join','elapsed_seconds','peak_rss_bytes')},ensure_ascii=False),flush=True)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data',type=pathlib.Path,default=WORKSPACE/'experiments/agentic-waterfall/kuairand/data')
    parser.add_argument('--output',type=pathlib.Path,required=True);args=parser.parse_args()
    prepare(args.data.resolve(),args.output.resolve())
