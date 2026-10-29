"""Validate public task access and evaluator masking without revealing labels."""
import argparse,hashlib,json
from pathlib import Path
from indexed_tool import IndexedTool

def audit_task(task,tool):
    problems=[];user=task['user_id'];ids=task['candidate_list']
    if tool.get_user(user) is None:problems.append('missing_user')
    if any(tool.get_item(item) is None for item in ids):problems.append('missing_item')
    for group in [tool.get_reviews(user_id=user),*(tool.get_reviews(item_id=i) for i in ids)]:
        if any((r['user_id'],r['item_id']) in tool.blocked for r in group):problems.append('blocked_review');break
    return problems

def main():
    p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--index',required=True);p.add_argument('--taskdir',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    folder=Path(a.taskdir);m=json.loads((folder/'download-manifest.json').read_text());tool=IndexedTool(a.data,a.index,folder);bad=[];count=0
    try:
        for task_id in m['task_ids']:
            task=json.loads((folder/'tasks'/f'task_{task_id}.json').read_text());errors=audit_task(task,tool);count+=1
            if errors:bad.append({'task_id':task_id,'errors':errors})
    finally:tool.close()
    report={'tasks':count,'failures':bad,'domain':m['domain'],'scenario':m['scenario'],'index_sha256':hashlib.sha256(Path(a.index).read_bytes()).hexdigest(),'labels_exported':False,'model_calls':0}
    with Path(a.output).open('x') as f:json.dump(report,f,indent=2)
    print(json.dumps({'domain':m['domain'],'tasks':count,'failures':len(bad)}))
    if bad:raise SystemExit(1)
if __name__=='__main__':main()
