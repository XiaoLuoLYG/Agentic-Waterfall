"""Map public MIND click history and fixed news candidates to i2Agent."""
import argparse
import json
import itertools
from pathlib import Path
from adapter import prepare_task

ROOT=Path(__file__).resolve().parents[3]


def prepare_mind(data, contrast):
    observation=data['observation']
    if observation.get('dialogue'):
        raise ValueError('MIND adapter expects no user instruction')
    def project(item):
        return {'id':item['id'],'title':item['title'],'description':item.get('abstract') or ''}
    history=[]
    for event in observation['behavior_events']:
        if event.get('type')=='click':
            item=project(event['item']);item['review']='';history.append(item)
    candidates=[project(item) for item in observation['environment']['candidate_pool']]
    return prepare_task(history,candidates,project(contrast))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',required=True,help='public model-input JSONL only')
    parser.add_argument('--line',type=int,default=0,help='zero-based nonempty public input line')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    if args.line < 0: raise ValueError('line must be nonnegative')
    with Path(args.input).open() as f:
        sample=json.loads(next(itertools.islice((line for line in f if line.strip()),args.line,None)))
    data=ROOT/'datasets/agentic-waterfall/mind-small/prepared'
    news=json.loads((data/'news.json').read_text())
    stats=json.loads((data/'training_statistics.json').read_text())
    obs=sample['observation']
    excluded={e['item']['id'] for e in obs['behavior_events'] if 'item' in e}
    excluded.update(x['id'] for x in obs['environment']['candidate_pool'])
    contrast_id=next((i for i in sorted(stats['content_fit_ids']) if i not in excluded and i in news),None)
    if contrast_id is None: raise ValueError('no independent training-catalog contrast')
    task,mapping=prepare_mind(sample,news[contrast_id])
    output={'source':'MIND-small fixed public inputs; no current exposure labels',
            'task_id':obs['decision_id'],'task':task,'candidate_id_by_index':mapping,
            'contrast_rule':'first sorted training-catalog news outside history and candidates; unobserved, not a dislike',
            'adaptation':'MIND contains clicks and no review text or user instruction; these fields remain empty'}
    with Path(args.output).open('x') as f:json.dump(output,f,ensure_ascii=False,indent=2)
    print(json.dumps({'history_count':len(task['asin']),'candidates':len(mapping),'output':args.output}))

if __name__=='__main__':main()
