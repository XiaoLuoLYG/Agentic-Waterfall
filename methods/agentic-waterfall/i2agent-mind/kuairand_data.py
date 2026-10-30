"""Map KuaiRand long-view history and fixed candidate videos to i2Agent."""
import argparse
import json
import itertools
import sqlite3
from pathlib import Path
from adapter import prepare_task

ROOT=Path(__file__).resolve().parents[3]


def prepare_kuairand(data, contrast):
    obs=data['observation']
    if obs.get('dialogue'):raise ValueError('KuaiRand adapter expects no explicit instruction')
    history=[]
    for event in obs['behavior_events']:
        payload=event['payload']
        if payload.get('long_view')==1:
            history.append({'id':event['item_id'],'title':payload.get('caption_excerpt') or event['item_id'],
                            'description':payload.get('content_metadata') or '', 'review':''})
    candidates=[{'id':x['id'],'title':x.get('title') or x['id'],'description':x.get('text') or ''}
                for x in obs['environment']['candidate_pool']]
    contrast={'id':contrast['id'],'title':contrast.get('title') or contrast['id'],'description':contrast.get('text') or ''}
    return prepare_task(history,candidates,contrast)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--line',type=int,default=0,help='zero-based nonempty public input line')
    args=parser.parse_args()
    if args.line < 0: raise ValueError('line must be nonnegative')
    with Path(args.input).open() as f:sample=json.loads(next(itertools.islice((line for line in f if line.strip()),args.line,None)))
    obs=sample['observation'];excluded={e['item_id'] for e in obs['behavior_events']}
    excluded.update(x['id'] for x in obs['environment']['candidate_pool'])
    catalog=ROOT/'datasets/agentic-waterfall/kuairand-1k/prepared-v2/catalog.sqlite'
    db=sqlite3.connect(catalog.resolve().as_uri()+'?mode=ro',uri=True)
    contrast=None
    try:
        for _,payload in db.execute('SELECT video_id,payload FROM items ORDER BY video_id'):
            item=json.loads(payload)
            if item['id'] not in excluded:contrast=item;break
    finally:db.close()
    if contrast is None:raise ValueError('no independent training-catalog contrast')
    task,mapping=prepare_kuairand(sample,contrast)
    output={'source':'KuaiRand-1K v2 public input, long-view task; no current target label',
            'task_id':obs['decision_id'],'task':task,'candidate_id_by_index':mapping,
            'contrast_rule':'first training-catalog item outside history and candidates; unobserved, not a dislike',
            'adaptation':'long-view records used as observed positive history; reviews and instructions are absent',
            'content_time':'verified caption supplement is a later static release, not established as available in 2022'}
    with Path(args.output).open('x') as f:json.dump(output,f,ensure_ascii=False,indent=2)
    print(json.dumps({'history_count':len(task['asin']),'candidates':len(mapping),'output':args.output}))

if __name__=='__main__':main()
