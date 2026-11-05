"""Run the fixed retriever on complete, frozen public KuaiRec histories."""
import argparse,hashlib,json,time
from pathlib import Path
from collections import Counter
from retrieval import search
from trace_output import persist_trace
from query_tokens import TOKEN_POLICY,NATIVE_MAX_LENGTH
HERE=Path(__file__).resolve().parent

def history_parts(events):
    texts=[e['payload'].get('item_text','') for e in events if e['payload'].get('watch_ratio',0)>2]
    return [t for t in texts if isinstance(t,str) and t.strip()]

def history_query(events):return ' '.join(history_parts(events))

def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def public_rows(path):
    with Path(path).open() as stream:
        for line in stream:
            if line.strip():yield json.loads(line)


def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--index',required=True);p.add_argument('--eligible-users',required=True);p.add_argument('--output',required=True);p.add_argument('--limit',type=int);p.add_argument('--start',type=int,default=0);p.add_argument('--execute',action='store_true');a=p.parse_args()
    all_users=[str(r['observation']['user_id']) for r in public_rows(a.input)];total=len(all_users)
    if not all_users or len(set(all_users))!=total:raise ValueError('invalid users')
    if a.start<0 or a.start>=total:raise ValueError('invalid start')
    if a.limit is not None and (a.limit<1 or a.start+a.limit>total):raise ValueError('invalid limit')
    users=all_users[a.start:a.start+a.limit] if a.limit is not None else all_users[a.start:]
    eligible_users=json.loads(Path(a.eligible_users).read_text())
    if not isinstance(eligible_users,dict) or any(not isinstance(u,str) or not isinstance(ids,list) or not ids or any(not isinstance(v,str) for v in ids) or len(ids)!=len(set(ids)) for u,ids in eligible_users.items()):raise ValueError('invalid public eligible users')
    if any(user not in eligible_users for user in users):raise ValueError('missing public eligible user')
    index=Path(a.index).resolve();out=Path(a.output)
    sources=[HERE/name for name in ('kuairec_batch.py','retrieval.py','query_tokens.py','trace_output.py')]
    manifest={'method':'fixed-bm25-bge-reranker','adaptation_version':'20261103-full-public-history-native-tokenizer-full-trace','token_policy':TOKEN_POLICY,'max_length':NATIVE_MAX_LENGTH,'input_sha256':sha(a.input),'index_sha256':{n:sha(index/n) for n in ('index.json','vectors.npy')},'public_eligibility_sha256':sha(a.eligible_users),'candidate_scope':'public user whitelist minus visible history; no matrix or label reads','user_ids':users,'full_split_size':total,'diagnostic_start':a.start,'diagnostic_limit':a.limit,'query_rule':'all supplied chronological watch_ratio>2 nonempty texts; no record cap or custom recency packing; downloaded native tokenizer only','source_sha256':{str(path):sha(path) for path in sources},'labels_read':False,'training':False}
    out.mkdir(parents=True,exist_ok=False);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','users':len(users)}));return
    selected=set(users);statuses=Counter()
    with (out/'predictions.jsonl').open('x') as predictions:
        for r in public_rows(a.input):
            obs=r['observation'];user=str(obs['user_id'])
            if user not in selected:continue
            if any(sha(path)!=digest for path,digest in manifest['source_sha256'].items()):raise ValueError('frozen method source changed')
            events=obs['behavior_events'];parts=history_parts(events);query=' '.join(parts);started=time.monotonic()
            row={'user_id':user,'method':manifest['method'],'acquisition_required':True,'model_requests':0,'history_input_audit':{'visible_events':len(events),'positive_events':sum(e['payload'].get('watch_ratio',0)>2 for e in events),'text_records':len(parts),'history_record_cap':None,'selection_rule':'watch_ratio > 2 with nonempty public item_text'}}
            if not query.strip():
                row.update(status='no_delivery',reason='no_public_positive_text; no popularity fallback',ordered_item_ids=[],acquired_item_ids=[],query_token_audit={})
            else:
                try:
                    result=search(index,query,eligible_users[user],[str(e['item_id']) for e in events],history={'parts':parts})
                    trace,audit=persist_trace(out,user,result)
                    row.update(status='submitted',ordered_item_ids=result['ordered_item_ids'][:10],acquired_item_ids=result['acquired_ids'],trace=trace,query_token_audit=audit)
                except Exception as error:
                    (out/'error.json').write_text(json.dumps({'user_id':user,'error':str(error)},indent=2)+'\n');raise
            row['local_inference_seconds']=time.monotonic()-started;statuses[row['status']]+=1
            predictions.write(json.dumps(row)+'\n');predictions.flush()
    print(json.dumps({'status':'completed','users':len(users),'statuses':dict(statuses),'labels_read':False}))
if __name__=='__main__':main()
