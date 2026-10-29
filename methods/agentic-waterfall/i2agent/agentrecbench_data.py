"""Map AgentRecBench public task and author-masked tool records to i2Agent."""
import argparse
import json
import sys
from pathlib import Path
from adapter import prepare_task

ROOT = Path(__file__).resolve().parents[3]
EXPERIMENT = ROOT / 'experiments/agentic-waterfall/agentrecbench'


def prepare_from_tool(task, tool, ordering='timestamp', allow_id_only=False):
    if ordering not in ('timestamp','file'):raise ValueError('invalid history ordering')
    ids = task['candidate_list']
    if len(ids) != 20 or len(set(ids)) != 20:
        # The projection also supports small synthetic fixtures.
        if len(ids) < 2 or len(set(ids)) != len(ids):
            raise ValueError('invalid candidate list')
    def item(item_id):
        value = tool.get_item(item_id)
        if not isinstance(value,dict):
            if not allow_id_only:raise ValueError('missing public item title')
            value={}
        if not isinstance(value.get('title'),str) or not value['title'].strip():
            if not allow_id_only:raise ValueError('missing public item title')
            value={**value,'title':item_id}
        description = value.get('description') or ''
        if isinstance(description, list):
            description = ' '.join(str(x) for x in description)
        if not isinstance(description, str):
            raise ValueError('invalid public item description')
        return {'id':item_id, 'title':value['title'], 'description':description}
    reviews = tool.get_reviews(user_id=task['user_id'])
    if ordering=='timestamp':
        if any(type(r.get('timestamp')) is not int for r in reviews):raise ValueError('history ordering requires timestamps')
        reviews=sorted(reviews,key=lambda r:(r['timestamp'],str(r['item_id'])))
    history = []
    for review in reviews:
        record = item(review['item_id'])
        record['review'] = review.get('text') or ''
        if not isinstance(record['review'], str):
            raise ValueError('invalid review text')
        history.append(record)
    blocked = set(ids) | {x['id'] for x in history}
    contrast = None
    item_ids=(row[0] for row in tool.db.execute('SELECT id FROM item ORDER BY id')) if hasattr(tool,'db') else iter(sorted(tool.item_data))
    for item_id in item_ids:
        if item_id not in blocked:
            try:
                contrast = item(item_id)
                break
            except ValueError:
                continue
    if contrast is None:
        raise ValueError('no independent public contrast item')
    return prepare_task(history, [item(item_id) for item_id in ids], contrast)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--task-id',type=int,default=0)
    parser.add_argument('--domain',choices=['amazon','yelp','goodreads'],default='amazon')
    parser.add_argument('--full-tasks',action='store_true')
    parser.add_argument('--index')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    sys.path.insert(0,str(EXPERIMENT/'scripts'))
    from official_components import load_components
    if args.full_tasks:
        sys.path.insert(0,str(ROOT/'methods/agentic-waterfall/recagent'))
        sys.path.insert(0,str(ROOT/'methods/agentic-waterfall/agentrecbench-data'))
        from bench_paths import resolve_paths
        from indexed_tool import IndexedTool
        paths=resolve_paths(args.domain,True);taskdir=paths['taskdir']
        if not args.index:raise ValueError('full tasks require an index')
        tool=IndexedTool(paths['data'],args.index,taskdir)
    else:
        if args.domain!='amazon':raise ValueError('new domains require full tasks')
        taskdir=EXPERIMENT/'data/task/short_term/amazon';tool=load_components().InteractionTool(str(EXPERIMENT/'data/amazon-short'),str(taskdir))
    raw=json.loads((taskdir/f'tasks/task_{args.task_id}.json').read_text())
    if raw.get('type') != 'recommendation' or len(raw['candidate_list']) != 20:
        raise ValueError('expected an official 20-candidate task')
    ordering='file' if args.domain in ('yelp','goodreads') else 'timestamp'
    try:task,mapping=prepare_from_tool(raw,tool,ordering=ordering,allow_id_only=args.domain=='yelp')
    finally:
        if args.full_tasks:tool.close()
    output={'source':f'AgentRecBench {args.domain} short_term; official InteractionTool target-pair masking',
            'task_id':args.task_id,'task':task,'candidate_id_by_index':mapping,
            'contrast_rule':'first sorted item outside visible history and all candidates; unobserved, not a dislike',
            'temporal_boundary':('official file order; timestamps missing, not a chronological claim' if ordering=='file' else 'review timestamp sorting; benchmark target time not independently verified'),
            'missing_metadata_policy':'public ID only' if args.domain=='yelp' else 'strict public metadata'}
    destination=Path(args.output)
    with destination.open('x') as f: json.dump(output,f,ensure_ascii=False,indent=2)
    print(json.dumps({'history_count':len(task['asin']),'candidates':len(mapping),'output':str(destination)}))

if __name__=='__main__': main()
