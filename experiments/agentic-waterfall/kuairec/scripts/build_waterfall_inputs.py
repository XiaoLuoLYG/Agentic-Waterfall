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
args=parser.parse_args()
if args.limit is not None and args.limit<1:parser.error('--limit must be positive')
processed=args.data_dir
split_name=args.split or 'subset_dev16'
split=json.loads((processed/'splits.json').read_text())[split_name]
limit=args.limit if args.limit is not None else (4 if args.split is None else None)
if limit is not None:split=split[:limit]
histories={r['user_id']:r['events'] for r in map(json.loads,(processed/'histories.jsonl').read_text().splitlines())}
output=args.output or processed/'waterfall-dev4.jsonl'
with output.open('x') as f:
    for user in split:
        events=[]
        for i,e in enumerate(histories[user]):
            events.append({'id':f'big-{user}-{i}','type':'play','item_id':str(e['video_id']),'occurred_at':datetime.datetime.fromtimestamp(e['timestamp'],datetime.timezone.utc).isoformat(),'source_channels':['behavior'],'payload':{'watch_ratio':e['watch_ratio'],'item_text':e['item']['text'],'item_category':e['item']['category']}})
        observation={'schema_version':'1','decision_id':f'kuairec-static-dev-{user}','user_id':str(user),'session_id':f'kuairec-static-{user}','observed_at':'2026-10-29T00:00:00Z','trigger':{'type':'offline_catalog_recommendation','description':'Recommend 10 videos from the KuaiRec catalog using only available past viewing records. No explicit user request is present. watch_ratio is cumulative viewing, not a like.'},'dialogue':[],'behavior_events':events,'user_state':{'version':0,'records':[]},'environment':{'candidate_pool':[],'sources':[{'id':'kuairec','modes':['search','hot'],'description':'Frozen 3327-video KuaiRec small catalog with later published Chinese captions/categories. Search uses BM25; hot uses positive-watch counts from big only. Per-user unknown entries are ineligible. Fetch no more than 100 unique candidates, then recommend exactly 10.'}],'pending_queue':[],'visible_item_ids':[],'content_version':'zenodo-18164998-v2-caption-2024'}}
        row={'observation':observation,'protocol':{'mode':'acquire','top_k':10,'require_full_ranking':False,'max_model_calls':3,'max_tool_calls':10,'max_acquired_items':100,'max_output_tokens':4096},'run_meta':{'kind':'subset','synthetic':False,'split':split_name,'history_source':'big only','dialogue_available':False,'initial_memory':'empty; retained during episode and archived after; no cross-session experiment'}}
        f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(json.dumps({'user_id':user,'history_events':len(events),'input_bytes_excluding_catalog':len(json.dumps(row,ensure_ascii=False).encode())}))
