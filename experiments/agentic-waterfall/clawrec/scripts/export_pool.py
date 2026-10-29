"""Extract the actual acquired snapshots and delivered Waterfall ranking for scoring."""
import argparse, json
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--result',type=Path,required=True);p.add_argument('--catalog',type=Path,required=True);p.add_argument('--rankings',type=Path,required=True)
a=p.parse_args();result=json.loads(a.result.read_text())['result'];items=result['candidate_pool_after'];ranking=result['ordered_item_ids'];catalog={item['id']:{k:v for k,v in item.items() if k!='id'} for item in items}
if len(catalog)!=len(items) or len(ranking)!=len(set(ranking)) or not set(ranking)<=set(catalog):raise ValueError('invalid acquired candidates or ranking')
if a.catalog.exists() or a.rankings.exists():raise FileExistsError('output already exists')
with a.catalog.open('x') as f:json.dump(catalog,f,ensure_ascii=False,indent=2);f.write('\n')
with a.rankings.open('x') as f:json.dump({'Waterfall':ranking},f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({'candidates':len(catalog),'delivered':len(ranking),'status':result['status']}))
