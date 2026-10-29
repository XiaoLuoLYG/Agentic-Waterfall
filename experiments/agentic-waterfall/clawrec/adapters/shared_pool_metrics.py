"""SimBench paper-aligned shared evaluation pool, exponential gain, no imputed labels."""
import hashlib, json, math

def dcg(rels):
    return sum((2**r-1)/math.log2(i+2) for i,r in enumerate(rels))

def score_pool(rankings, labels, k=20):
    if type(k) is not int or k<1: raise ValueError('k must be a positive integer')
    if not isinstance(rankings,dict) or not rankings: raise ValueError('explicit methods required')
    pool=set()
    for method,ids in rankings.items():
        if not isinstance(method,str) or not isinstance(ids,list):raise ValueError('invalid method/list')
        if any(not isinstance(i,str) or not i for i in ids): raise ValueError('item IDs must be non-empty strings')
        if len(ids)!=len(set(ids)):raise ValueError('duplicate item in method ranking')
        pool.update(ids[:k])
    if any(i not in labels for i in pool):raise ValueError('unjudged pooled items; never impute zero')
    for i in pool:
        if type(labels[i]) is not int or labels[i] not in range(1,6):raise ValueError('relevance must be integer in [1,5]')
    ordered_pool=sorted(pool); rels={i:labels[i] for i in ordered_pool}
    pool_hash=hashlib.sha256(json.dumps(rels,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    ideal=dcg(sorted(rels.values(),reverse=True)[:k]); scores={}
    for method,ids in rankings.items():
        r=[labels[i] for i in ids[:k]];d=dcg(r);own=dcg(sorted(r,reverse=True))
        scores[method]={'dcg_at_k':d,'idcg_shared_at_k':ideal,'ndcg_shared_at_k':d/ideal if ideal else 0.,'idcg_self_at_k':own,'ndcg_self_at_k':d/own if own else 0.,'hit_at_k':int(any(x>=3 for x in r)),'returned_count':len(r),'shortfall':max(0,k-len(r))}
    return {'k':k,'gain':'2^rel-1','relevance_range':[1,5],'hit_threshold':3,'pool_size':len(pool),'pool_label_sha256':pool_hash,'scores':scores}
