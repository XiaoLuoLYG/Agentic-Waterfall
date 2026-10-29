"""Freeze the user-selected common MIND cohort without evaluator labels."""
import argparse,hashlib,json
from pathlib import Path

def split_samples(samples):
    included=[];excluded=[];seen=set()
    for sample in samples:
        obs=sample['observation'];decision=obs['decision_id']
        if decision in seen:raise ValueError('duplicate decision')
        seen.add(decision);history=obs['behavior_events']
        if not isinstance(history,list):raise ValueError('invalid history')
        count=sum(e.get('type')=='click' for e in history)
        if count>=2:included.append(sample)
        else:excluded.append({'decision_id':decision,'user_id':obs['user_id'],'observed_click_count':count,'reason':'i2agent_requires_two_positive_history_items'})
    return included,excluded

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    raw=Path(a.input).read_bytes();lines=[x for x in raw.splitlines() if x.strip()];samples=[json.loads(line) for line in lines]
    included,excluded=split_samples(samples);wanted={x['observation']['decision_id'] for x in included}
    subset=b''.join(line+b'\n' for line,sample in zip(lines,samples) if sample['observation']['decision_id'] in wanted)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    (out/'inputs-eligible.jsonl').write_bytes(subset)
    (out/'ineligible.json').write_text(json.dumps(excluded,ensure_ascii=False,indent=2)+'\n')
    manifest={'source':str(Path(a.input).resolve()),'source_sha256':hashlib.sha256(raw).hexdigest(),'eligible_sha256':hashlib.sha256(subset).hexdigest(),'source_count':len(samples),'eligible_count':len(included),'ineligible_count':len(excluded),'eligible_users':len({x['observation']['user_id'] for x in included}),'ineligible_users':len({x['user_id'] for x in excluded}),'criterion':'at least 2 observed clicks before the MIND decision','uses_evaluator_labels':False,'training':False,'model_calls':0}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False))
if __name__=='__main__':main()
