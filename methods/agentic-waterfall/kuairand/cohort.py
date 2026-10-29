"""Freeze the user-selected common i2Agent-eligible public task cohort."""
import argparse,hashlib,json
from pathlib import Path

def split_tasks(rows):
    selected=[];excluded=[];seen=set()
    for row in rows:
        obs=row['observation'];task=obs['decision_id']
        if task in seen:raise ValueError('duplicate task ID')
        seen.add(task);count=sum(e['payload'].get('long_view')==1 for e in obs['behavior_events'])
        if count>=2:selected.append(row)
        else:excluded.append({'task_id':task,'positive_history_count':count,'reason':'i2agent requires two positive history events'})
    return selected,excluded

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args();raw=Path(a.input).read_bytes();selected,excluded=split_tasks([json.loads(x) for x in raw.splitlines() if x.strip()]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False);data=(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in selected)).encode();(out/'inputs-eligible.jsonl').write_bytes(data);(out/'ineligible.json').write_text(json.dumps(excluded,indent=2)+'\n');(out/'manifest.json').write_text(json.dumps({'source_sha256':hashlib.sha256(raw).hexdigest(),'selected_sha256':hashlib.sha256(data).hexdigest(),'selected_task_ids':[r['observation']['decision_id'] for r in selected],'eligible':len(selected),'ineligible':len(excluded),'selection':'user selected common i2agent-eligible cohort','labels_read':False},indent=2)+'\n');print(json.dumps({'eligible':len(selected),'ineligible':len(excluded)}))
if __name__=='__main__':main()
