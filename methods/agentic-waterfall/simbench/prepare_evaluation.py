"""Freeze actual output for the existing shared-pool evaluator; no hidden labels are read."""
import argparse,hashlib,json
from pathlib import Path
from catalog import published_ms

def prepare(runs,docs):
    if not runs:raise ValueError('no runs')
    first=runs[0][0];rankings={};catalog={}
    for data,result in runs:
        for k in ('case_id','user_id','event','snapshot_sha256'):
            if data.get(k)!=first.get(k) or result.get(k)!=data.get(k):raise ValueError('different cases or snapshots')
        if data['as_of_ms']!=first['as_of_ms'] or data['active_sources']!=first['active_sources']:raise ValueError('different tool environment')
        method=result['method'];
        if data.get('method')!=method:raise ValueError('method mismatch')
        ids=result.get('ordered_item_ids',[]);acquired=result.get('acquired_ids',[])
        if result.get('status')=='failed' and any(x in str(result.get('error','')) for x in ('budget_exhausted','model_calls_disabled','snapshot search failed')):raise ValueError('operationally incomplete run')
        if method in rankings or result.get('status') not in ('submitted','no_delivery','failed') or not isinstance(ids,list) or len(ids)>20 or len(ids)!=len(set(ids)) or not set(ids)<=set(acquired):raise ValueError('invalid ranking')
        if result['status']!='submitted' and ids:raise ValueError('failed run cannot submit items')
        rankings[method]=ids
        for item_id in ids:
            r=docs[item_id];date=published_ms(r.get('published_at',''))
            if r['source'] not in data['active_sources'] or date is None or date>data['as_of_ms']:raise ValueError('ineligible item')
            catalog[item_id]={'id':item_id,'source_id':r['source'],'title':r['title'],'text':r['text'],'url':r['url']}
    return rankings,catalog

def main():
    p=argparse.ArgumentParser();p.add_argument('--snapshot',required=True);p.add_argument('--run',action='append',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    snap=Path(a.snapshot);raw=(snap/'catalog.jsonl').read_bytes();sha=hashlib.sha256(raw).hexdigest()
    if sha!=json.loads((snap/'manifest.json').read_text())['catalog_sha256']:raise ValueError('snapshot changed')
    docs={x['id']:x for x in map(json.loads,raw.splitlines())};runs=[];hashes={}
    for name in a.run:
        path=Path(name);ib=(path/'input.json').read_bytes();rb=(path/'result.json').read_bytes();data=json.loads(ib);result=json.loads(rb)
        if data['snapshot_sha256']!=sha:raise ValueError('run used a different snapshot')
        runs.append((data,result));hashes[result['method']]={'input_sha256':hashlib.sha256(ib).hexdigest(),'result_sha256':hashlib.sha256(rb).hexdigest()}
    rankings,catalog=prepare(runs,docs);out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    files={}
    for name,obj in [('rankings.json',rankings),('catalog.json',catalog)]:
        raw=(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode();(out/name).write_bytes(raw);files[name]=hashlib.sha256(raw).hexdigest()
    (out/'freeze.json').write_text(json.dumps({'case_id':runs[0][0]['case_id'],'snapshot_sha256':sha,'runs':hashes,'files':files,'hidden_labels_accessed':False},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'methods':list(rankings),'pooled_items':len(catalog),'labels_accessed':False}))
if __name__=='__main__':main()
