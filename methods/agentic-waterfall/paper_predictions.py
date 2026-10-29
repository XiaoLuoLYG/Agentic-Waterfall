"""Export committed method outputs; never reads evaluator-only labels."""
import argparse
import json
import re
from pathlib import Path

def export_rows(dataset,pairs):
    if dataset not in {'mind','kuairand','kuairec'} or not pairs: raise ValueError('invalid dataset or empty results')
    rows=[];contexts=set();users=set();methods=set();variants=set()
    for source,result in pairs:
        context=source['context_id'];user=source['user_id'];method=result['method'];variant=result.get('variant');methods.add(method)
        if variant: variants.add(variant)
        if result.get('context_id')!=context or context in contexts: raise ValueError('mismatched or duplicate context')
        submitted=result.get('status')=='submitted'
        if not submitted and dataset=='kuairec': raise ValueError('KuaiRec evaluator has no declared failure fallback')
        contexts.add(context)
        pool=[c['id'] for c in source['candidates']];ranking=result.get('ordered_item_ids',[]) if submitted else []
        if len(pool)!=len(set(pool)) or len(ranking)!=len(set(ranking)) or not set(ranking)<=set(pool): raise ValueError('invalid ranking')
        if dataset in {'mind','kuairand'}:
            if submitted and set(ranking)!=set(pool): raise ValueError('fixed-candidate evaluation requires full permutation')
            rows.append({'decision_id':context,'status':'submitted' if submitted else 'failed','error':result.get('error') if not submitted else None,'ordered_item_ids':ranking,'model_request_count':result.get('model_request_count'),'model_calls':result.get('model_calls',[])})
        else:
            if user in users: raise ValueError('KuaiRec requires unique users')
            users.add(user)
            rows.append({'user_id':user,'method':method+'-'+variant if variant else method,'status':'submitted','ordered_item_ids':ranking[:10], 'acquired_item_ids':pool,'acquisition_required':True,'model_request_count':result.get('model_request_count'),'model_calls':result.get('model_calls',[])})
    if len(methods)!=1 or len(variants)>1: raise ValueError('mixing methods or variants')
    return rows

def load_receipts(folder,result):
    receipts=[];seen=set();skip=set(result.get('replayed_stages',[]))
    files=list(folder.glob('[0-9][0-9]-*.response.json'))+list(folder.glob('[0-9][0-9]-*.error.json'))+list(folder.glob('response-*.json'))
    for file in sorted(files):
        stage=re.fullmatch(r'response-(\d+)\.json',file.name)
        if stage and int(stage.group(1)) in skip:continue
        receipt=json.loads(file.read_text());receipt=receipt.get('receipt',receipt);attempt=receipt.get('attempt_id')
        if attempt and attempt not in seen:
            seen.add(attempt);receipts.append({k:receipt.get(k) for k in ('attempt_id','status','requested_model','provider_response_model','usage','duration_ms')})
    return receipts

def main():
    p=argparse.ArgumentParser();p.add_argument('--dataset',choices=['mind','kuairand','kuairec'],required=True);p.add_argument('--runs',nargs='+',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    pairs=[]
    for r in a.runs:
        folder=Path(r);source=json.loads((folder/'input.json').read_text());result=json.loads((folder/'result.json').read_text())
        receipts=load_receipts(folder,result)
        result['model_request_count']=len(receipts);result['model_calls']=receipts
        pairs.append((source,result))
    rows=export_rows(a.dataset,pairs)
    with Path(a.output).open('x') as f:
        for row in rows:f.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps({'dataset':a.dataset,'runs':len(rows),'output':a.output}))
if __name__=='__main__':main()
