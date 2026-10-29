"""Map a KuaiRec public prefix and fixed R0 retrieval to i2Agent."""
import argparse
import json
import itertools
from pathlib import Path
from adapter import prepare_task


def prepare_kuairec(sample,retrieval,catalog):
    obs=sample['observation']
    if retrieval.get('context_id') is not None and retrieval['context_id'] != obs['decision_id']: raise ValueError('retrieval context mismatch')
    if obs.get('dialogue'):raise ValueError('sample has an unsupported instruction')
    history=[]
    for event in obs['behavior_events']:
        payload=event['payload']
        if payload.get('watch_ratio',0)>2:
            text=payload.get('item_text') or ''
            history.append({'id':str(event['item_id']),'title':text,'description':text,'review':''})
    table={str(x['id']):x for x in catalog}
    if len(table)!=len(catalog):raise ValueError('duplicate catalog ID')
    candidate_ids=retrieval['acquired_ids']
    if not candidate_ids or len(set(candidate_ids))!=len(candidate_ids) or any(x not in table for x in candidate_ids):
        raise ValueError('invalid acquired candidates')
    def project(item_id):
        text=table[item_id]['text']
        if not isinstance(text,str):raise ValueError('invalid catalog text')
        return {'id':item_id,'title':text,'description':text}
    excluded=set(candidate_ids)|{str(e['item_id']) for e in obs['behavior_events']}
    contrast=next((project(i) for i in sorted(table) if i not in excluded),None)
    if contrast is None:raise ValueError('no independent contrast item')
    return prepare_task(history,[project(i) for i in candidate_ids],contrast)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--retrieval',required=True);parser.add_argument('--catalog',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--line',type=int,default=0,help='zero-based nonempty public input line')
    args=parser.parse_args()
    if args.line < 0: raise ValueError('line must be nonnegative')
    with Path(args.input).open() as f:sample=json.loads(next(itertools.islice((line for line in f if line.strip()),args.line,None)))
    retrieved=json.loads(Path(args.retrieval).read_text());catalog=json.loads(Path(args.catalog).read_text())
    task,mapping=prepare_kuairec(sample,retrieved,catalog)
    output={'source':'KuaiRec public prefix and independent BM25+BGE-M3 RRF acquired pool',
            'task_id':sample['observation']['decision_id'],'task':task,'candidate_id_by_index':mapping,
            'contrast_rule':'first sorted public catalog item outside all history and retrieved candidates; unobserved, not a dislike',
            'adaptation':'watch_ratio>2 used as long-view positive history; no review or explicit instruction',
            'visibility_warning':'per-user eligibility is derived from observed evaluation matrix; audit before formal comparison'}
    with Path(args.output).open('x') as f:json.dump(output,f,ensure_ascii=False,indent=2)
    print(json.dumps({'history_count':len(task['asin']),'candidates':len(mapping),'output':args.output}))

if __name__=='__main__':main()
