"""Score saved Waterfall rankings with the official MIND scorer; labels stay evaluator-only."""
from pathlib import Path
import argparse, importlib.util, io, json

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--truth',type=Path,required=True)
p.add_argument('--input',type=Path,help='Assigned public input JSONL; absent predictions count as failures')
p.add_argument('--predictions',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args()

truth_rows=json.loads(a.truth.read_text())
truth={str(row['impression_id']):row for row in truth_rows}
if len(truth)!=len(truth_rows):raise ValueError('duplicate truth impression')
rows=[json.loads(line) for line in a.predictions.read_text().splitlines() if line.strip()]
ids=[str(row['decision_id']).split(':')[-1] for row in rows]
if len(set(ids))!=len(ids):raise ValueError('duplicate prediction impression')
if a.input:
    assigned=[str(json.loads(line)['observation']['decision_id']).split(':')[-1] for line in a.input.read_text().splitlines() if line.strip()]
    if len(set(assigned))!=len(assigned) or not set(ids)<=set(assigned):raise ValueError('invalid assigned impressions')
    by_id=dict(zip(ids,rows));ids=assigned;rows=[by_id.get(iid,{'decision_id':iid,'status':'failed','error':'missing_prediction'}) for iid in ids]
if not rows:raise ValueError('empty predictions or assignment')
spec=importlib.util.spec_from_file_location('official_mind',ROOT/'upstream/MIND/evaluate.py')
official=importlib.util.module_from_spec(spec);spec.loader.exec_module(official)
truth_lines=[];pred_lines=[];failures=[]
for iid,row in zip(ids,rows):
    t=truth[iid];candidates=t['original_candidate_ids'];labels=t['labels'];ranking=row.get('ordered_item_ids',[])
    valid=row.get('status')=='submitted' and len(ranking)==len(candidates) and len(set(ranking))==len(candidates) and set(ranking)==set(candidates)
    if valid:
        rankmap={item:index+1 for index,item in enumerate(ranking)};ranks=[rankmap[item] for item in candidates]
    else:
        ranks=[1]*len(labels);failures.append({'id':iid,'error':row.get('error') or 'invalid_or_incomplete_ranking'})
    truth_lines.append(iid+' '+json.dumps(labels,separators=(',',':'))+'\n')
    pred_lines.append(iid+' '+json.dumps(ranks,separators=(',',':'))+'\n')
metrics=dict(zip(['AUC','MRR','NDCG@5','NDCG@10'],map(float,official.scoring(io.StringIO(''.join(truth_lines)),io.StringIO(''.join(pred_lines))))))
result={'impressions':len(rows),'invalid_outputs':len(failures),'failures':failures,'metrics':metrics,'failure_policy':'all ranks 1; failures remain in denominator','runtime_versions':sorted({row.get('runtime_version','unknown') for row in rows})}
with a.output.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'impressions':len(rows),'invalid_outputs':len(failures),'output':str(a.output)}))
