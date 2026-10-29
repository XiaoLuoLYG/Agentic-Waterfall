"""Run the existing fixed retriever over frozen KuaiRec public user histories."""
import argparse,hashlib,json,sys,time
from pathlib import Path
import numpy as np
from retrieval import search
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent

def history_query(events):
    texts=[e['payload'].get('item_text','') for e in events if e['payload'].get('watch_ratio',0)>2]
    return ' '.join(t for t in texts[-20:] if isinstance(t,str) and t.strip())

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--index',required=True);p.add_argument('--output',required=True);p.add_argument('--limit',type=int);p.add_argument('--start',type=int,default=0);p.add_argument('--execute',action='store_true');a=p.parse_args()
    raw=Path(a.input).read_bytes();rows=[json.loads(x) for x in raw.splitlines() if x.strip()];total=len(rows)
    if a.start<0 or a.start>=total:raise ValueError('invalid start')
    if a.limit is not None and (a.limit<1 or a.start+a.limit>total):raise ValueError('invalid limit')
    rows=rows[a.start:a.start+a.limit] if a.limit is not None else rows[a.start:]
    if not rows or len({r['observation']['user_id'] for r in rows})!=len(rows):raise ValueError('invalid users')
    data=ROOT/'experiments/agentic-waterfall/kuairec/data/processed';masks=np.load(data/'eligibility.npz',allow_pickle=False);user_index={str(v):i for i,v in enumerate(masks['users'])};index=Path(a.index).resolve();out=Path(a.output);hot=HERE/'data/kuairec-train-hot-order.json'
    def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    manifest={'method':'fixed-bm25-bge-reranker','input_sha256':hashlib.sha256(raw).hexdigest(),'index_sha256':{n:sha(index/n) for n in ('index.json','vectors.npy')},'eligibility_sha256':sha(data/'eligibility.npz'),'hot_order_sha256':sha(hot),'user_ids':[r['observation']['user_id'] for r in rows],'full_split_size':total,'diagnostic_start':a.start,'diagnostic_limit':a.limit,'query_rule':'last 20 public long-view texts; empty uses train-only popularity','labels_read':False,'training':False}
    if any(str(r['observation']['user_id']) not in user_index for r in rows):raise ValueError('unknown user')
    out.mkdir(parents=True,exist_ok=False);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','users':len(rows)}));return
    popularity=json.loads(hot.read_text());predictions=[]
    for r in rows:
        obs=r['observation'];user=str(obs['user_id']);idx=user_index[user];eligible=[str(v) for v in masks['items'][masks['observed'][idx]]];excluded=[str(e['item_id']) for e in obs['behavior_events']];query=history_query(obs['behavior_events']);started=time.monotonic()
        try:
            result=search(index,query,eligible,excluded,popularity);rank=result['ordered_item_ids'][:10];acquired=result['acquired_ids'];row={'user_id':user,'method':manifest['method'],'status':'submitted','acquisition_required':True,'ordered_item_ids':rank,'acquired_item_ids':acquired,'local_inference_seconds':time.monotonic()-started,'model_requests':0}
        except Exception as e:
            (out/'error.json').write_text(json.dumps({'user_id':user,'error':str(e)},indent=2)+'\n');raise
        predictions.append(row);(out/'predictions.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in predictions))
    print(json.dumps({'status':'submitted','users':len(predictions),'labels_read':False}))
if __name__=='__main__':main()
