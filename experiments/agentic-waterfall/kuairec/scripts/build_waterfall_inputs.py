"""Export public big-history observations; small relevance is never loaded."""
import argparse
import datetime
import json
import pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--data-dir',type=pathlib.Path,default=ROOT/'data/processed')
parser.add_argument('--split',choices=['dev','test','subset_dev16'])
parser.add_argument('--limit',type=int)
parser.add_argument('--output',type=pathlib.Path)
parser.add_argument('--histories',type=pathlib.Path,help='Explicit public history export; requires a separate --output')
args=parser.parse_args()
if args.limit is not None and args.limit<1:parser.error('--limit must be positive')
if args.histories is not None and args.output is None:parser.error('--histories requires --output')
processed=args.data_dir
split_name=args.split or 'subset_dev16'
split=json.loads((processed/'splits.json').read_text())[split_name]
split_size=len(split)
limit=args.limit if args.limit is not None else (4 if args.split is None else None)
if limit is not None:split=split[:limit]
kind='split_complete' if split_name in ('dev','test') and len(split)==split_size else 'subset'
decision_split=args.split or 'dev'
metadata_path=processed/'public-content-metadata.json'
metadata=json.loads(metadata_path.read_text()).get('items',{}) if metadata_path.exists() else {}
source=json.loads((ROOT/'scripts/source.json').read_text())
histories={r['user_id']:r for r in map(json.loads,(args.histories or processed/'histories.jsonl').read_text().splitlines())}
output=args.output or processed/'waterfall-dev4.jsonl'
with output.open('x') as f:
    for user in split:
        events=[]
        history=histories[user]
        history_meta=history.get('history_meta')
        if history_meta is not None:
            if history_meta['event_count']!=len(history['events']):raise ValueError('history_event_count_mismatch')
        for i,e in enumerate(history['events']):
            events.append({'id':f'big-{user}-row-{e["source_row"]}' if 'source_row' in e else f'big-{user}-{i}','type':'play','item_id':str(e['video_id']),'occurred_at':datetime.datetime.fromtimestamp(e['timestamp'],datetime.timezone.utc).isoformat(),'source_channels':['behavior'],'payload':{'watch_ratio':e['watch_ratio'],'item_text':e['item']['text'],'item_category':e['item']['category'],**metadata.get(str(e['video_id']),{}),**({'source_row':e['source_row'],'source_timestamp':e['timestamp']} if 'source_row' in e else {})}})
        observation={'schema_version':'1','decision_id':f'kuairec-static-{decision_split}-{user}','user_id':str(user),'session_id':f'kuairec-static-{user}','observed_at':'2026-10-29T00:00:00Z','trigger':{'type':'offline_catalog_recommendation','description':'Recommend the 10 catalog videos most likely to receive a watch_ratio strictly greater than 2 from this user. This is the public relevance definition of this offline task. watch_ratio is cumulative viewing time divided by video duration and may exceed 1; it is not an explicit like. Use the available past viewing records, comparing the content of high-ratio and low-ratio events to predict this outcome for unseen candidates. No explicit user request is present.'},'dialogue':[],'behavior_events':events,'user_state':{'version':0,'records':[]},'environment':{'candidate_pool':[],'sources':[source],'pending_queue':[],'visible_item_ids':[],'content_version':'zenodo-18164998-v2-caption-2024'}}
        row={'observation':observation,'protocol':{'mode':'acquire','top_k':10,'require_full_ranking':False,'max_model_calls':3,'max_tool_calls':10,'max_acquired_items':100,'max_output_tokens':4096},'run_meta':{'kind':kind,'synthetic':False,'split':split_name,'history_source':'big only','dialogue_available':False,'initial_memory':'empty; retained during episode and archived after; no cross-session experiment'}}
        if history_meta is not None:row['run_meta']['history_protocol']=history_meta
        f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(json.dumps({'user_id':user,'history_events':len(events),'input_bytes_excluding_catalog':len(json.dumps(row,ensure_ascii=False).encode())}))
