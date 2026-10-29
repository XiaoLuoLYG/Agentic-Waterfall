"""Evaluate saved Waterfall outputs with the official AgentRecBench metrics."""
import argparse, json
from pathlib import Path
from adapter import official_metrics, validate_ranking

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--task-dir',type=Path,required=True);p.add_argument('--task-ids',help='Comma-separated assigned IDs; missing results count as failures');p.add_argument('--output',type=Path,required=True);p.add_argument('results',nargs='*',type=Path)
a=p.parse_args();labels=[];predictions=[];failures=[];by_id={}
for file in a.results:
    data=json.loads(file.read_text());task_id=str(data['input']['run_meta']['task_id'])
    if not task_id.isdigit() or task_id in by_id:raise ValueError('invalid or duplicate task ID')
    by_id[task_id]=data['result']
ids=a.task_ids.split(',') if a.task_ids else list(by_id)
if not ids or any(not iid.isdigit() for iid in ids) or len(set(ids))!=len(ids) or not set(by_id)<=set(ids):raise ValueError('invalid assigned task IDs')
for task_id in ids:
    task=json.loads((a.task_dir/'tasks'/f'task_{task_id}.json').read_text());label=json.loads((a.task_dir/'groundtruth'/f'groundtruth_{task_id}.json').read_text())['ground truth']
    result=by_id.get(task_id,{'status':'failed','error':'missing_prediction'});ranking=result.get('ordered_item_ids',[])
    try:
        if result.get('status')!='submitted':raise ValueError(result.get('error') or 'not submitted')
        validate_ranking(ranking,task['candidate_list'])
    except ValueError as error:
        ranking=[];failures.append({'task_id':task_id,'error':str(error)})
    labels.append(label);predictions.append(ranking)
metrics=official_metrics(labels,predictions)
result={'n':len(labels),'failed':len(failures),'failures':failures,'scorer':'official','metrics':metrics}
with a.output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'n':len(labels),'failed':len(failures),'output':str(a.output)}))
