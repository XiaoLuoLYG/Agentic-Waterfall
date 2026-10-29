#!/usr/bin/env python3
"""Score committed shared-pool labels. Unknown labels are errors, not negatives."""
import argparse,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'adapters'))
from shared_pool_metrics import score_pool
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--mapping',type=pathlib.Path,required=True);p.add_argument('--labels',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
m=json.loads(a.mapping.read_text());by_card=json.loads(a.labels.read_text())
if set(by_card)!=set(m['card_id_to_item_id']):raise ValueError('judge must label every pooled card exactly once')
labels={m['card_id_to_item_id'][card]:rel for card,rel in by_card.items()}
r=score_pool(m['rankings'],labels,k=m['k']);r['content_pool_sha256']=m['pool_sha256'];a.output.write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
