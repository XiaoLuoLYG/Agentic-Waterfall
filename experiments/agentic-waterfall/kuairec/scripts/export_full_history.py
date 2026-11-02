"""Export every public big-table event for an explicit frozen split subset."""
import argparse
import hashlib
import json
import pathlib
import numpy as np
import pandas as pd
from public_content import item_record


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):h.update(block)
    return h.hexdigest()


def build_histories(big, small, captions, users, chunksize=250000):
    # Pair eligibility is independent of relevance; never read small watch_ratio.
    held_out=pd.read_csv(small,usecols=['user_id','video_id'])
    if held_out.isna().any().any() or held_out.duplicated(['user_id','video_id']).any():
        raise ValueError('invalid_small_pairs')
    if not set(users)<=set(held_out.user_id):raise ValueError('unknown_selected_user')
    small_pairs=np.sort(held_out.user_id.to_numpy(dtype=np.int64)*20000+held_out.video_id.to_numpy(dtype=np.int64))
    histories={int(user):[] for user in users}
    big_rows=overlap=0
    for frame in pd.read_csv(big,usecols=['user_id','video_id','watch_ratio','timestamp'],chunksize=chunksize):
        if not np.isfinite(frame.to_numpy()).all() or not frame.video_id.between(0,10727).all():
            raise ValueError('invalid_big_event')
        pairs=frame.user_id.to_numpy(dtype=np.int64)*20000+frame.video_id.to_numpy(dtype=np.int64)
        ix=np.searchsorted(small_pairs,pairs)
        valid=ix<len(small_pairs)
        overlap+=int(np.count_nonzero(small_pairs[ix[valid]]==pairs[valid]))
        for user,group in frame[frame.user_id.isin(users)].groupby('user_id',sort=False):
            events=group[['video_id','watch_ratio','timestamp']].copy()
            events['source_row']=events.index+1
            histories[int(user)].extend(events.to_dict('records'))
        big_rows+=len(frame)
    if overlap:raise ValueError(f'big_small_pair_overlap: {overlap}')
    # Official captions use LF records, with four literal CR bytes inside captions.
    text=pd.read_csv(captions,lineterminator='\n').fillna('')
    if text.video_id.duplicated().any():raise ValueError('duplicate_caption_id')
    items={int(row['video_id']):item_record(row['video_id'],row) for row in text.to_dict('records')}
    source_hashes={path.name:digest(path) for path in [big,small,captions]}
    rows=[]
    for user,events in histories.items():
        events.sort(key=lambda event:(event['timestamp'],event['video_id'],event['source_row']))
        for event in events:event['item']=items[event['video_id']]
        rows.append({'user_id':user,'events':events,'history_meta':{'version':'kuairec-full-big-history-v1','selection':'all big_matrix.csv rows for this user; all timestamps; no watch_ratio filter or deduplication','order':'timestamp, video_id, source_row (1-based data row)','event_count':len(events),'big_small_pair_overlap':overlap,'source_sha256':source_hashes}})
    return rows,{'version':'kuairec-full-big-history-v1','big_rows':big_rows,'small_pair_rows':len(held_out),'big_small_pair_overlap':overlap,'source_sha256':source_hashes,'users':[{'user_id':row['user_id'],'events':len(row['events'])} for row in rows]}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-dir',type=pathlib.Path,required=True)
    parser.add_argument('--splits',type=pathlib.Path,required=True)
    parser.add_argument('--split',choices=['dev','test','subset_dev16'],required=True)
    parser.add_argument('--limit',type=int,required=True,help='Explicit user subset size; histories are never limited')
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    if args.limit<1:parser.error('--limit must be positive')
    audit_path=args.output.with_suffix('.audit.json')
    if args.output.exists() or audit_path.exists():parser.error('output and audit must not exist')
    users=json.loads(args.splits.read_text())[args.split][:args.limit]
    if not users or len(users)!=len(set(users)):parser.error('empty or duplicate split users')
    rows,audit=build_histories(args.raw_dir/'big_matrix.csv',args.raw_dir/'small_matrix.csv',args.raw_dir/'kuairec_caption_category.csv',users)
    audit.update({'split':args.split,'splits_sha256':digest(args.splits),'exported_users':len(rows),'output':str(args.output)})
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x') as stream:
        for row in rows:stream.write(json.dumps(row,ensure_ascii=False)+'\n')
    audit['output_sha256']=digest(args.output)
    with audit_path.open('x') as stream:json.dump(audit,stream,ensure_ascii=False,indent=2)
    print(json.dumps(audit,ensure_ascii=False))


if __name__=='__main__':main()
