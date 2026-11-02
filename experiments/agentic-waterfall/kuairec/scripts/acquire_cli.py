"""One JSON request/response bridge for the shared JS runtime and future ClawRec."""
import json
import pathlib
import sys
import numpy as np
from retrieval import CatalogRetriever, public_result
ROOT=pathlib.Path(__file__).resolve().parents[1]
req=json.load(sys.stdin);a=req['arguments']
assert a['source_ids']==['kuairec']
assert a['mode']=='search'
assert not a.get('content_types') or a['content_types']==['video']
data=np.load(ROOT/'data/processed/eligibility.npz')
i=np.flatnonzero(data['users']==int(req['user_id']))
assert len(i)==1
eligible=data['items'][data['observed'][i[0]]]
if a.get('target_id') is not None:eligible=[v for v in eligible if str(v)==str(a['target_id'])]
catalog=json.loads((ROOT/'data/processed/catalog.json').read_text())
result=CatalogRetriever(catalog).acquire(a.get('query') or '',eligible,limit=min(a['limit'],req['remaining_acquired_items']),mode=a['mode'],exclude=req.get('exclude',[]))
metadata_path=ROOT/'data/processed/public-content-metadata.json'
metadata=json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
json.dump(public_result(result,metadata),sys.stdout,ensure_ascii=False)
