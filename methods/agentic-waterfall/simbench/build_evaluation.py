"""Verify the frozen pool before invoking the existing evaluator-only builder."""
import argparse,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'experiments/agentic-waterfall/clawrec/scripts'))
from build_blind_pool import build

def load_frozen(folder,case_id):
    folder=Path(folder);freeze=json.loads((folder/'freeze.json').read_text())
    if freeze.get('case_id')!=case_id or freeze.get('hidden_labels_accessed') is not False:raise ValueError('wrong case or freeze')
    values=[]
    for name in ('rankings.json','catalog.json'):
        raw=(folder/name).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=freeze['files'][name]:raise ValueError('frozen pool changed')
        values.append(json.loads(raw))
    return values

def main():
    p=argparse.ArgumentParser();p.add_argument('--freeze',required=True);p.add_argument('--cases-root',required=True);p.add_argument('--workspace',required=True);p.add_argument('--event',required=True,type=int);p.add_argument('--output',required=True);a=p.parse_args()
    rankings,catalog=load_frozen(a.freeze,f'{a.workspace}__event_{a.event:02d}')
    payload,mapping=build(a.cases_root,a.workspace,a.event,rankings,catalog)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    (out/'blind-judge-input.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');(out/'evaluator-mapping.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cards':len(payload['cards']),'status':'ready_for_judge'}))
if __name__=='__main__':main()
