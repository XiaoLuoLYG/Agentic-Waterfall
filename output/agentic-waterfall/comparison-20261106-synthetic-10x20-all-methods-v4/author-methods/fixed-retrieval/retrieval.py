"""Fixed BM25 + BGE-M3 RRF retrieval and BGE reranking over a public catalog."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def validate_catalog(catalog):
    if not isinstance(catalog,list) or not catalog:
        raise ValueError('empty catalog')
    cleaned=[]
    for item in catalog:
        if not isinstance(item,dict) or not isinstance(item.get('id'),(str,int)) or not isinstance(item.get('text'),str):
            raise ValueError('each item needs an id and public text')
        cleaned.append({'id':str(item['id']),'text':item['text']})
    if len({x['id'] for x in cleaned}) != len(cleaned):
        raise ValueError('duplicate catalog IDs')
    return sorted(cleaned,key=lambda x:x['id'])


def select_catalog(catalog, eligible=None, exclude=None):
    known={item['id'] for item in catalog}
    if eligible is not None:
        if not isinstance(eligible,list) or any(not isinstance(x,str) for x in eligible):
            raise ValueError('eligible IDs must be strings')
        if set(eligible)-known: raise ValueError('unknown eligible ID')
        allowed=set(eligible)
    else:
        allowed=known
    if exclude is not None and (not isinstance(exclude,list) or any(not isinstance(x,str) for x in exclude)):
        raise ValueError('excluded IDs must be strings')
    indices=[i for i,item in enumerate(catalog) if item['id'] in allowed and item['id'] not in set(exclude or [])]
    if not indices: raise ValueError('empty eligible catalog')
    return indices


def frozen_hot_fallback(known_ids, hot_order, eligible_ids):
    if not isinstance(hot_order,list) or any(not isinstance(x,str) for x in hot_order) or len(hot_order)!=len(known_ids) or len(set(hot_order))!=len(hot_order) or set(hot_order)!=set(known_ids):
        raise ValueError('frozen hot order must cover the entire catalog exactly once')
    eligible=set(eligible_ids)
    return [item_id for item_id in hot_order if item_id in eligible][:100]


def reciprocal_rank_fusion(lexical, dense, limit=100):
    if type(limit) is not int or limit < 1:
        raise ValueError('invalid limit')
    scores={}
    for ranking in (lexical,dense):
        if len(set(ranking)) != len(ranking):
            raise ValueError('duplicate ranking IDs')
        for rank,item_id in enumerate(ranking,1):
            scores[item_id]=scores.get(item_id,0)+1/(60+rank)
    return sorted(scores,key=lambda x:(-scores[x],x))[:limit]


def tokenize(text):
    tokens=re.findall(r'[a-z0-9]+',text.lower())
    for part in re.findall(r'[\u3400-\u9fff]+',text):
        tokens.extend(part)
        tokens.extend(part[i:i+2] for i in range(len(part)-1))
    return tokens or ['__empty__']


def models():
    import torch
    from transformers import AutoTokenizer, AutoModel, AutoModelForSequenceClassification
    torch.set_num_threads(2)
    device='mps' if torch.backends.mps.is_available() else 'cpu'
    return torch,AutoTokenizer,AutoModel,AutoModelForSequenceClassification,device


def embeddings(texts):
    import numpy as np
    torch, tokenizer_cls, model_cls, _, device = models()
    path=ROOT/'weights/bge-m3'
    tokenizer=tokenizer_cls.from_pretrained(path,local_files_only=True)
    model=model_cls.from_pretrained(path,local_files_only=True).to(device).eval()
    vectors=[]
    with torch.inference_mode():
        for start in range(0,len(texts),8):
            batch=tokenizer(texts[start:start+8],padding=True,truncation=True,max_length=512,return_tensors='pt').to(device)
            vector=model(**batch).last_hidden_state[:,0,:].float()
            vector=torch.nn.functional.normalize(vector,p=2,dim=1)
            vectors.append(vector.cpu().numpy())
    del model
    if device=='mps': torch.mps.empty_cache()
    return np.concatenate(vectors,axis=0)


def build_index(catalog_path, output):
    import numpy as np
    raw=Path(catalog_path).read_bytes()
    catalog=validate_catalog(json.loads(raw))
    out=Path(output);out.mkdir(parents=True,exist_ok=False)
    matrix=embeddings([x['text'] for x in catalog])
    if matrix.shape[0]!=len(catalog) or not np.isfinite(matrix).all():
        raise ValueError('invalid dense vectors')
    with (out/'vectors.npy').open('xb') as f:np.save(f,matrix,allow_pickle=False)
    metadata={'catalog':catalog,'catalog_sha256':hashlib.sha256(raw).hexdigest(),
              'embedding_model':'BAAI/bge-m3@5617a9f61b028005a4858fdac845db406aefb181',
              'pooling':'normalized CLS','max_length':512,'vector_shape':list(matrix.shape)}
    with (out/'index.json').open('x') as f:json.dump(metadata,f,ensure_ascii=False)
    return {'catalog_items':len(catalog),'vector_shape':list(matrix.shape)}


def search(index, query, eligible=None, exclude=None, hot_order=None):
    import numpy as np
    from rank_bm25 import BM25Okapi
    if not isinstance(query,str): raise ValueError('invalid query')
    index=Path(index);metadata=json.loads((index/'index.json').read_text())
    catalog=validate_catalog(metadata['catalog'])
    vectors=np.load(index/'vectors.npy',allow_pickle=False)
    if vectors.shape != tuple(metadata['vector_shape']) or vectors.shape[0]!=len(catalog) or not np.isfinite(vectors).all():
        raise ValueError('index metadata and vectors do not match')
    selected=select_catalog(catalog,eligible,exclude)
    known_ids=[item['id'] for item in catalog]
    catalog=[catalog[i] for i in selected]
    vectors=vectors[selected]
    if not query.strip():
        ids=frozen_hot_fallback(known_ids,hot_order,[item['id'] for item in catalog])
        return {'query':query,'acquired_ids':ids,'ordered_item_ids':ids,'retrieval':'frozen_train_popularity','reranker':None}
    query_vector=embeddings([query])[0]
    lexical=BM25Okapi([tokenize(x['text']) for x in catalog]).get_scores(tokenize(query))
    dense=vectors@query_vector
    lexical_ids=[catalog[i]['id'] for i in np.argsort(-lexical,kind='stable')[:100]]
    dense_ids=[catalog[i]['id'] for i in np.argsort(-dense,kind='stable')[:100]]
    acquired=reciprocal_rank_fusion(lexical_ids,dense_ids,100)
    items={x['id']:x for x in catalog}
    torch, tokenizer_cls, _, model_cls, device = models()
    path=ROOT/'weights/bge-reranker-v2-m3'
    tokenizer=tokenizer_cls.from_pretrained(path,local_files_only=True)
    model=model_cls.from_pretrained(path,local_files_only=True).to(device).eval()
    scores=[]
    with torch.inference_mode():
        for start in range(0,len(acquired),8):
            batch=acquired[start:start+8]
            inputs=tokenizer([query]*len(batch),[items[x]['text'] for x in batch],padding=True,truncation=True,max_length=512,return_tensors='pt').to(device)
            scores.extend(model(**inputs).logits.view(-1).float().cpu().tolist())
    if not np.isfinite(scores).all(): raise ValueError('invalid reranker scores')
    ordered=sorted(zip(acquired,scores),key=lambda x:(-x[1],x[0]))
    return {'query':query,'acquired_ids':acquired,'ordered_item_ids':[x[0] for x in ordered],
            'scores':{item_id:score for item_id,score in ordered},'retrieval':'BM25+BGE-M3 RRF(60)',
            'reranker':'BAAI/bge-reranker-v2-m3@953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e','max_length':512}


def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    index=sub.add_parser('index');index.add_argument('--catalog',required=True);index.add_argument('--output',required=True)
    find=sub.add_parser('search');find.add_argument('--index',required=True);find.add_argument('--query',required=True);find.add_argument('--output',required=True);find.add_argument('--eligible',help='JSON array of allowed string IDs');find.add_argument('--exclude',help='JSON array of already seen string IDs');find.add_argument('--hot-order',help='frozen train-only catalog popularity IDs')
    args=parser.parse_args()
    if args.command=='index': result=build_index(args.catalog,args.output)
    else:
        eligible=json.loads(Path(args.eligible).read_text()) if args.eligible else None
        exclude=json.loads(Path(args.exclude).read_text()) if args.exclude else None
        hot=json.loads(Path(args.hot_order).read_text()) if args.hot_order else None
        result=search(args.index,args.query,eligible,exclude,hot)
        with Path(args.output).open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({'command':args.command,'status':'ok','count':result.get('catalog_items',len(result.get('ordered_item_ids',[])))}))

if __name__=='__main__': main()
