#!/usr/bin/env python3
"""Evaluator-only pool builder; never run inside a method's observation path.

Inputs are actual committed system rankings and shared acquired-content snapshots.
No generation, model requests, or label fabrication are performed by this CLI.
"""
import argparse,hashlib,json,pathlib,random,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'adapters'))
from simbench import read_public_event

def build(cases_root,workspace,event,rankings,catalog,k=20,seed=42):
    if not rankings:raise ValueError('methods required, including explicit [] for failed/empty delivery')
    ids=set()
    for method,items in rankings.items():
        if not isinstance(items,list) or len(items)!=len(set(items)):raise ValueError('invalid or duplicate ranking')
        ids.update(items[:k])
    missing=ids-set(catalog)
    if missing:raise ValueError('ranking contains items without public acquired snapshots')
    # Identity must already be unified by the retrieval layer; reject duplicate URLs under distinct IDs.
    by_url={}
    for i in ids:
        c=catalog[i]
        if not c.get('url') or not c.get('title'):raise ValueError('public snapshot needs URL and title')
        if c['url'] in by_url and by_url[c['url']]!=i:raise ValueError('duplicate URL uses inconsistent unified IDs')
        by_url[c['url']]=i
    ordered=sorted(ids);random.Random(seed).shuffle(ordered)
    cards=[];mapping={}
    # Only frozen content fields reach the judge, never per-method rationales, ranks or internal state.
    for n,i in enumerate(ordered,1):
        card_id=f'pool_{n:04d}';c=catalog[i];mapping[card_id]=i
        cards.append({'card_id':card_id,**{key:c[key] for key in ('title','url','source_id','content_type','text','abstract','snapshot_sha256') if key in c}})
    public=read_public_event(cases_root,workspace,event)
    hidden_path=pathlib.Path(cases_root)/workspace/f'event_{event:02d}'/'private/hidden_step.jsonl'
    hidden=[json.loads(l) for l in hidden_path.read_text().splitlines() if l.strip()]
    if not hidden or any(r['event']!=event or r['step']!=5 for r in hidden):raise ValueError('invalid heldout step')
    payload={'evaluation_id':f'{workspace}__event_{event:02d}', 'visible_evidence':public['evidence'],'heldout_step':hidden,'cards':cards}
    return payload,{'card_id_to_item_id':mapping,'rankings':{m:r[:k] for m,r in rankings.items()},'k':k,'seed':seed,'pool_sha256':hashlib.sha256(json.dumps(cards,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'origin':'actual_rankings_required','target_source':'private/hidden_step.jsonl','review_md_used':False}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cases-root',required=True);p.add_argument('--workspace',required=True);p.add_argument('--event',type=int,required=True);p.add_argument('--rankings',type=pathlib.Path,required=True);p.add_argument('--catalog',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    payload,mapping=build(a.cases_root,a.workspace,a.event,json.loads(a.rankings.read_text()),json.loads(a.catalog.read_text()))
    a.output.mkdir(parents=True,exist_ok=False)
    (a.output/'blind-judge-input.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2));(a.output/'evaluator-mapping.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2))
    print(json.dumps({'cards':len(payload['cards']),'model_requests':0,'output':str(a.output),'exit_code':0}))
if __name__=='__main__':main()
