"""Fixed BM25 + BGE-M3 RRF retrieval and BGE reranking over a public catalog."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from query_tokens import embedding_inputs, reranker_inputs, bounded_batches, native_length, NATIVE_MAX_LENGTH, TOKEN_POLICY

ROOT = Path(__file__).resolve().parent
_index_encoding_receipts = {}


def verify_index_encoding(tokenizer, metadata):
    """Reuse legacy vectors only when every actual document input is identical."""
    limit = native_length(tokenizer)
    previous = metadata.get('max_length')
    if type(previous) is not int or previous < 2:
        raise ValueError('missing original index token policy')
    key = hashlib.sha256(json.dumps(metadata, sort_keys=True).encode()).hexdigest()
    key = (key, tokenizer.name_or_path, limit)
    if key not in _index_encoding_receipts:
        maximum = 0
        for item in metadata['catalog']:
            old = tokenizer(item['text'], truncation=True, max_length=previous)['input_ids']
            current = tokenizer(item['text'], truncation=True, max_length=limit)['input_ids']
            if old != current:
                raise ValueError('index_token_policy_changed_rebuild_required: '+item['id'])
            maximum = max(maximum, len(current))
        _index_encoding_receipts[key] = {'original_max_length': previous, 'active_max_length': limit,
            'documents_checked': len(metadata['catalog']), 'maximum_document_tokens_with_specials': maximum,
            'actual_document_token_ids_identical': True, 'index_metadata_sha256': key[0]}
    return dict(_index_encoding_receipts[key])


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


def embeddings(texts, history_queries=None, input_audit=None):
    import numpy as np
    torch, tokenizer_cls, model_cls, _, device = models()
    path=ROOT/'weights/bge-m3'
    tokenizer=tokenizer_cls.from_pretrained(path,local_files_only=True)
    model=model_cls.from_pretrained(path,local_files_only=True).to(device).eval()
    vectors=[]
    lengths=[min(native_length(tokenizer),len(tokenizer.encode(text,verbose=False))) for text in texts]
    with torch.inference_mode():
        for start,end in bounded_batches(lengths):
            queries={i-start:spec for i,spec in (history_queries or {}).items() if start<=i<end}
            batch,audit=embedding_inputs(tokenizer,texts[start:end],queries)
            if input_audit is not None:input_audit.extend({**r,'input_index':r['input_index']+start} for r in audit)
            batch=batch.to(device)
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
              'pooling':'normalized CLS','max_length':NATIVE_MAX_LENGTH,'token_policy':TOKEN_POLICY,'vector_shape':list(matrix.shape)}
    with (out/'index.json').open('x') as f:json.dump(metadata,f,ensure_ascii=False)
    return {'catalog_items':len(catalog),'vector_shape':list(matrix.shape)}


def search(index, query, eligible=None, exclude=None, hot_order=None, history=None):
    if not isinstance(query,str): raise ValueError('invalid query')
    if not query.strip(): raise ValueError('empty_query_no_popularity_fallback')
    if hot_order is not None: raise ValueError('popularity_fallback_disabled')
    import numpy as np
    from rank_bm25 import BM25Okapi
    index=Path(index);metadata=json.loads((index/'index.json').read_text())
    catalog=validate_catalog(metadata['catalog'])
    vectors=np.load(index/'vectors.npy',allow_pickle=False)
    if vectors.shape != tuple(metadata['vector_shape']) or vectors.shape[0]!=len(catalog) or not np.isfinite(vectors).all():
        raise ValueError('index metadata and vectors do not match')
    _, tokenizer_cls, _, _, _ = models()
    index_tokenizer=tokenizer_cls.from_pretrained(ROOT/'weights/bge-m3',local_files_only=True)
    index_encoding_audit=verify_index_encoding(index_tokenizer,metadata)
    selected=select_catalog(catalog,eligible,exclude)
    catalog=[catalog[i] for i in selected]
    vectors=vectors[selected]
    query_audit=[];reranker_audit=[]
    query_vector=embeddings([query],{0:history} if history is not None else None,query_audit)[0]
    lexical=BM25Okapi([tokenize(x['text']) for x in catalog]).get_scores(tokenize(query))
    dense=vectors@query_vector
    lexical_order=[catalog[i]['id'] for i in np.argsort(-lexical,kind='stable')]
    dense_order=[catalog[i]['id'] for i in np.argsort(-dense,kind='stable')]
    lexical_ids=lexical_order[:100];dense_ids=dense_order[:100]
    acquired=reciprocal_rank_fusion(lexical_ids,dense_ids,100)
    items={x['id']:x for x in catalog}
    torch, tokenizer_cls, _, model_cls, device = models()
    path=ROOT/'weights/bge-reranker-v2-m3'
    tokenizer=tokenizer_cls.from_pretrained(path,local_files_only=True)
    model=model_cls.from_pretrained(path,local_files_only=True).to(device).eval()
    scores=[]
    query_length=len(tokenizer.encode(query,add_special_tokens=False,verbose=False))
    lengths=[min(native_length(tokenizer),query_length+len(tokenizer.encode(items[x]['text'],add_special_tokens=False,verbose=False))+tokenizer.num_special_tokens_to_add(pair=True)) for x in acquired]
    with torch.inference_mode():
        for start,end in bounded_batches(lengths):
            batch=acquired[start:end]
            inputs,audit=reranker_inputs(tokenizer,query,[items[x]['text'] for x in batch],history)
            reranker_audit.extend({**r,'item_id':batch[r['input_index']]} for r in audit)
            inputs=inputs.to(device)
            scores.extend(model(**inputs).logits.view(-1).float().cpu().tolist())
            del inputs
            if device=='mps':
                torch.mps.synchronize()
                torch.mps.empty_cache()
    if not np.isfinite(scores).all(): raise ValueError('invalid reranker scores')
    ordered=sorted(zip(acquired,scores),key=lambda x:(-x[1],x[0]))
    lexical_rank={item_id:i+1 for i,item_id in enumerate(lexical_order)}
    dense_rank={item_id:i+1 for i,item_id in enumerate(dense_order)}
    retrieval_scores={item['id']:{'bm25':float(lexical[i]),'dense':float(dense[i]),
        'bm25_rank':lexical_rank[item['id']],'dense_rank':dense_rank[item['id']],
        'rrf':sum(1/(60+r) for r in (lexical_rank[item['id']],dense_rank[item['id']]) if r<=100),
        'acquired':item['id'] in acquired} for i,item in enumerate(catalog)}
    return {'query':query,'acquired_ids':acquired,'ordered_item_ids':[x[0] for x in ordered],
            'scores':{item_id:score for item_id,score in ordered},'retrieval':'BM25+BGE-M3 RRF(60)',
            'retrieval_scores':retrieval_scores,'dense_query_vector':query_vector.tolist(),
            'index_encoding_audit':index_encoding_audit,'token_policy':TOKEN_POLICY,
            'reranker':'BAAI/bge-reranker-v2-m3@953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e','max_length':NATIVE_MAX_LENGTH,
            'query_token_audit':{'embedding':query_audit,'reranker':reranker_audit}}


def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    index=sub.add_parser('index');index.add_argument('--catalog',required=True);index.add_argument('--output',required=True)
    find=sub.add_parser('search');find.add_argument('--index',required=True);find.add_argument('--query',required=True);find.add_argument('--output',required=True);find.add_argument('--eligible',help='JSON array of allowed string IDs');find.add_argument('--exclude',help='JSON array of already seen string IDs')
    args=parser.parse_args()
    if args.command=='index': result=build_index(args.catalog,args.output)
    else:
        eligible=json.loads(Path(args.eligible).read_text()) if args.eligible else None
        exclude=json.loads(Path(args.exclude).read_text()) if args.exclude else None
        result=search(args.index,args.query,eligible,exclude)
        with Path(args.output).open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({'command':args.command,'status':'ok','count':result.get('catalog_items',len(result.get('ordered_item_ids',[])))}))

if __name__=='__main__': main()
