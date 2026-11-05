"""Compressed complete score/token artifacts, with small prediction references."""
import gzip,hashlib,json

def persist_trace(out,user,result):
    folder=out/'traces';folder.mkdir(exist_ok=True)
    path=folder/(user+'.json.gz')
    data=gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
    with path.open('xb') as stream:stream.write(data)
    compact={stage:[{key:value for key,value in receipt.items() if key not in ('model_input','query_token_ids','document_token_ids')} for receipt in receipts] for stage,receipts in result.get('query_token_audit',{}).items()}
    return {'path':str(path.resolve()),'sha256':hashlib.sha256(data).hexdigest(),'format':'gzip JSON; full eligible BM25/dense scores/ranks, complete acquired rerank order/logits, exact padded model inputs'},compact

