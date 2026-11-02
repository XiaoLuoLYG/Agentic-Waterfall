"""Audit official matrices, isolate held-out labels, and build public adapter inputs."""
import datetime
import hashlib
import json
import pathlib
import time
import numpy as np
import pandas as pd
from public_content import item_record as public_item_record

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT/'data/raw'
OUT = ROOT/'data/processed'

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''): h.update(block)
    return h.hexdigest()

def write_json(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def main():
    started=time.time()
    OUT.mkdir(parents=True,exist_ok=True)
    print('Reading small IDs and evaluator labels',flush=True)
    small=pd.read_csv(RAW/'small_matrix.csv',usecols=['user_id','video_id','watch_ratio'])
    assert not small.duplicated(['user_id','video_id']).any(), 'Duplicate small pairs require adjudicated aggregation'
    assert np.isfinite(small.watch_ratio).all(), 'Invalid label'
    users=np.sort(small.user_id.unique())
    items=np.sort(small.video_id.unique())
    assert len(users)==1411 and len(items)==3327,(len(users),len(items))
    perm=np.random.RandomState(42).permutation(users)
    splits={'algorithm':'numpy.random.RandomState(42).permutation(sorted(users))','seed':42,'dev':perm[:282].tolist(),'test':perm[282:].tolist(),'subset_dev16':perm[:16].tolist()}
    write_json(OUT/'splits.json',splits)
    # Masks are independent of relevance. Only unknown items are withheld from methods.
    user_index={int(u):i for i,u in enumerate(users)}
    item_index={int(v):i for i,v in enumerate(items)}
    observed=np.zeros((len(users),len(items)),dtype=bool)
    relevant=np.zeros_like(observed)
    ui=small.user_id.map(user_index).to_numpy()
    vi=small.video_id.map(item_index).to_numpy()
    observed[ui,vi]=True
    relevant[ui,vi]=small.watch_ratio.to_numpy()>2
    np.savez_compressed(OUT/'eligibility.npz',users=users,items=items,observed=observed)
    (OUT/'evaluator_only').mkdir(exist_ok=True)
    np.savez_compressed(OUT/'evaluator_only/labels.npz',users=users,items=items,relevant=relevant)
    small_pairs=np.sort(small.user_id.to_numpy(dtype=np.int64)*20000+small.video_id.to_numpy(dtype=np.int64))
    small_rows=len(small)
    del small,ui,vi
    histories={int(u):[] for u in users}
    item_counts={}
    train_users=[];train_items=[]
    big_rows=overlap=0
    big_users=set();big_items=set()
    min_timestamp=float('inf');max_timestamp=0
    for chunk_id,chunk in enumerate(pd.read_csv(RAW/'big_matrix.csv',usecols=['user_id','video_id','watch_ratio','timestamp'],chunksize=250000)):
        assert chunk.video_id.between(0,10727).all(), 'not expected KuaiRec v2 video ID range'
        assert np.isfinite(chunk.watch_ratio).all()
        # Search sorted held-out pair keys; does not materialize a huge Python set.
        pairs=chunk.user_id.to_numpy(dtype=np.int64)*20000+chunk.video_id.to_numpy(dtype=np.int64)
        ix=np.searchsorted(small_pairs,pairs)
        valid=ix<len(small_pairs)
        overlap+=int(np.count_nonzero(small_pairs[ix[valid]]==pairs[valid]))
        big_rows+=len(chunk)
        big_users.update(chunk.user_id.unique().tolist());big_items.update(chunk.video_id.unique().tolist())
        positive=chunk[chunk.watch_ratio>2]
        train_users.append(positive.user_id.to_numpy(dtype=np.int32))
        train_items.append(positive.video_id.to_numpy(dtype=np.int32))
        for item,count in positive.video_id.value_counts().items(): item_counts[int(item)]=item_counts.get(int(item),0)+int(count)
        for user,g in chunk[chunk.user_id.isin(users)].groupby('user_id',sort=False):
            h=histories[int(user)]
            h.extend(g[['video_id','watch_ratio','timestamp']].to_dict('records'))
            h.sort(key=lambda x:(x['timestamp'],x['video_id']))
            # Keep both recent observations and sufficient positive retrieval history.
            last=h[-64:]
            last_pos=[x for x in h if x['watch_ratio']>2][-20:]
            merged={(x['timestamp'],x['video_id']):x for x in last+last_pos}
            histories[int(user)]=sorted(merged.values(),key=lambda x:(x['timestamp'],x['video_id']))
        min_timestamp=min(min_timestamp,float(chunk.timestamp.min()));max_timestamp=max(max_timestamp,float(chunk.timestamp.max()))
        if chunk_id%5==0: print(json.dumps({'big_rows':big_rows,'overlap_so_far':overlap}),flush=True)
    assert overlap==0,f'big/small overlap: {overlap}'
    assert big_items==set(range(10728)), 'Expected contiguous KuaiRec v2 IDs 0..10727'
    train_u=np.concatenate(train_users);train_i=np.concatenate(train_items)
    train_pairs=train_u.astype(np.int64)*20000+train_i
    positive_events=len(train_pairs)
    unique_pairs=np.unique(train_pairs)
    train_u=(unique_pairs//20000).astype(np.int32)
    train_i=(unique_pairs%20000).astype(np.int32)
    np.savez_compressed(OUT/'big_positive_edges.npz',user_ids=train_u,item_ids=train_i,n_users=max(big_users)+1,n_items=10728)
    print('Reading caption supplement',flush=True)
    # Four unquoted CR bytes occur inside source captions. The official file
    # uses LF records; explicit LF preserves all 10,728 complete rows.
    text=pd.read_csv(RAW/'kuairec_caption_category.csv',lineterminator='\n').fillna('')
    assert 'video_id' in text.columns, text.columns.tolist()
    assert not text.video_id.duplicated().any()
    texts={int(x['video_id']):x for x in text.to_dict('records')}
    assert set(texts)==big_items,'Caption/matrix ID universe mismatch'
    def item_record(v):
        return {**public_item_record(v,texts[int(v)]),'big_positive_count':item_counts.get(int(v),0)}
    catalog=[item_record(v) for v in items]
    write_json(OUT/'catalog.json',catalog)
    with (OUT/'histories.jsonl').open('w') as f:
        for user in users:
            h=histories[int(user)]
            for e in h: e['item']=item_record(e['video_id'])
            f.write(json.dumps({'user_id':int(user),'events':h},ensure_ascii=False)+'\n')
    coverage={'catalog_items':len(catalog),'text_present':sum(bool(x['text'].strip()) for x in catalog),'title_fallback_items':sum(not bool(x['text'].strip()) for x in catalog)}
    audit={'kind':'data_audit','synthetic':False,'exit_code':0,'big_rows':big_rows,'small_rows':small_rows,'small_users':len(users),'small_items':len(items),'big_users':len(big_users),'big_items':len(big_items),'big_small_pair_overlap':overlap,'big_positive_edges':len(train_u),'big_positive_events':positive_events,'big_duplicate_positive_events_collapsed':positive_events-len(train_u),'small_observed_density':float(observed.mean()),'small_missing_pairs':int((~observed).sum()),'small_users_without_positive':int((relevant.sum(axis=1)==0).sum()),'version_check':{'expected':'KuaiRec v2, removed original ID 1225 and decremented subsequent IDs','matrix_ids_contiguous_0_10727':True,'caption_ids_match_all_matrix_ids':True,'caption_columns':text.columns.tolist()},'coverage':coverage,'big_timestamp_range':[min_timestamp,max_timestamp],'elapsed_seconds':time.time()-started,'files':{p.name:{'bytes':p.stat().st_size,'sha256':digest(p)} for p in RAW.glob('*') if p.suffix in ['.csv','.zip']}}
    write_json(ROOT/'results/data_audit.json',audit)
    print(json.dumps(audit,ensure_ascii=False),flush=True)

if __name__=='__main__': main()
