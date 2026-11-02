"""Public-only fixed BM25 backend; relevance labels are not imported here."""
import re
import time
import numpy as np
from rank_bm25 import BM25Okapi

def tokenize(text):
    out=re.findall(r'[a-z0-9]+',text.lower())
    for s in re.findall(r'[\u3400-\u9fff]+',text):
        out.extend(s)
        out.extend(s[i:i+2] for i in range(len(s)-1))
    return out

class CatalogRetriever:
    def __init__(self,catalog):
        self.catalog=sorted(catalog,key=lambda x:int(x['id']))
        self.ids=[str(x['id']) for x in self.catalog]
        self.bm25=BM25Okapi([tokenize(x['text']) or ['__empty_document__'] for x in self.catalog],k1=1.5,b=0.75,epsilon=0.25)

    def acquire(self,query,eligible,limit=100,mode='search',exclude=()):
        if limit<0 or limit>100: raise ValueError('Invalid acquisition limit')
        if mode not in ['search','hot']: raise ValueError('Unsupported acquire mode')
        start=time.perf_counter();allowed=set(map(str,eligible))-set(map(str,exclude))
        tokens=tokenize(query)
        if mode=='hot' or not tokens:
            scores=np.asarray([x['big_positive_count'] for x in self.catalog],dtype=float)
            actual_mode='hot_big_only'
        else:
            scores=self.bm25.get_scores(tokens);actual_mode='bm25'
        candidates=[(str(x['id']),float(scores[i]),x) for i,x in enumerate(self.catalog) if str(x['id']) in allowed]
        candidates.sort(key=lambda r:(-r[1],int(r[0])))
        selected=candidates[:limit]
        return {'items':[x[2] for x in selected],'scores':{x[0]:x[1] for x in selected},'evidence':{'query':query,'backend':actual_mode,'elapsed_seconds':time.perf_counter()-start,'catalog_items_scored':len(self.catalog),'eligible_items':len(allowed),'returned_items':len(selected)},'actual_requests':1}

def history_query(events):
    seen=set();texts=[]
    for event in reversed(events):
        item=str(event['video_id'])
        if event['watch_ratio']<=2 or item in seen: continue
        seen.add(item);texts.append(event['item']['text'])
        if len(texts)>=20:break
    return ' '.join(reversed(texts))


def public_result(result,metadata):
    """One public tool projection shared by Waterfall and the comparison adapters."""
    evidence=result['evidence']
    items=[]
    for row in result['items']:
        item={'id':row['id'],'source_id':'kuairec','content_type':'video','text':row['text']}
        duration=metadata.get('items',{}).get(row['id'],{}).get('duration_ms')
        if duration is not None:item['duration_ms']=duration
        if row['id'] in result.get('scores',{}):
            item.update(retrieval_score=result['scores'][row['id']],retrieval_backend=evidence['backend'],retrieval_query=evidence['query'])
        items.append(item)
    return {**result,'items':items,'scores':{row['id']:result['scores'][row['id']] for row in items if row['id'] in result.get('scores',{})},'evidence':[evidence]}
