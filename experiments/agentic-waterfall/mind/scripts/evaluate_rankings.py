"""Evaluate committed public predictions, keeping invalid outputs with declared fallback."""
from pathlib import Path
import argparse,json,importlib.util,io
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--waterfall',nargs='+',required=True);p.add_argument('--name',required=True);a=p.parse_args()
spec=importlib.util.spec_from_file_location('official',ROOT/'upstream/MIND/evaluate.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
truth={t['impression_id']:t for t in json.loads((ROOT/'data/evaluation_private/test.json').read_text())}
rows=[json.loads(line) for file in a.waterfall for line in Path(file).read_text().splitlines()]
assert len({r['decision_id'] for r in rows})==len(rows)
ids=[r['decision_id'].split(':')[-1] for r in rows];truth_text=''.join(i+' '+json.dumps(truth[i]['labels'],separators=(',',':'))+'\n' for i in ids)
out={'stage':'smoke' if len(rows)<=4 else 'subset','dataset':'MIND-small / local split','synthetic':False,'impressions':len(rows),'users':len(rows),'candidate_count':sum(len(truth[i]['labels']) for i in ids),'methods':{}}
for name in ['waterfall_prototype','popularity','fixed_content_tfidf'] + (['nrms_subset_trained'] if (ROOT/'results/nrms/test-rankings.jsonl').exists() else []):
 if name=='waterfall_prototype':preds={r['decision_id'].split(':')[-1]:r for r in rows}
 else:
  predfile=ROOT/'results/nrms/test-rankings.jsonl' if name=='nrms_subset_trained' else ROOT/f'results/test/{name}/rankings.jsonl'
  preds={r['impression_id']:r for r in map(json.loads,predfile.read_text().splitlines())}
 lines=[];invalid=[]
 for iid in ids:
  r=preds[iid];t=truth[iid];ranking=r.get('ordered_item_ids',[])
  valid=(name!='waterfall_prototype' or r.get('status')=='submitted') and len(ranking)==len(t['labels']) and len(set(ranking))==len(ranking) and set(ranking)==set(t['original_candidate_ids'])
  if not valid:ranks=[1]*len(t['labels']);invalid.append({'id':iid,'error':r.get('error','invalid_or_incomplete_ranking')})
  else:rankmap={nid:k+1 for k,nid in enumerate(ranking)};ranks=[rankmap[nid] for nid in t['original_candidate_ids']]
  lines.append(iid+' '+json.dumps(ranks,separators=(',',':'))+'\n')
 metrics=dict(zip(['AUC','MRR','NDCG@5','NDCG@10'],map(float,m.scoring(io.StringIO(truth_text),io.StringIO(''.join(lines))))))
 metrics.update(invalid_outputs=len(invalid),invalid_output_rate=len(invalid)/len(ids),failures=invalid,interpretation='fallback-inclusive pipeline diagnostic; not effective model rankings' if invalid else 'real public-data subset ranking; no statistical claim')
 out['methods'][name]=metrics
 dest=ROOT/'results'/a.name/name;dest.mkdir(parents=True,exist_ok=True);(dest/'prediction.txt').write_text(''.join(lines))
out['normalization']={'samples_with_normalization':sum(bool(r.get('normalizations')) for r in rows),'sample_rate':sum(bool(r.get('normalizations')) for r in rows)/len(rows),'operations':sum(len(r.get('normalizations',[])) for r in rows),'runtime_versions':sorted({r.get('runtime_version','unknown') for r in rows})}
out['model_budget']={'calls':sum(r.get('model_request_count',0) for r in rows),'requested_models':sorted({c.get('requested_model','') for r in rows for c in r.get('model_calls',[])}),'response_models':sorted({c.get('provider_response_model','') for r in rows for c in r.get('model_calls',[])}),'tokens':sum(c.get('usage',{}).get('total_tokens',0) for r in rows for c in r.get('model_calls',[])),'duration_ms':sum(r.get('duration_ms',0) for r in rows)}
out['exit_code']=0;(ROOT/'results'/f'{a.name}.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
