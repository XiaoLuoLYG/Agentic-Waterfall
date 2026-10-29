"""Freeze every batch prediction, including failures and missing runs, before scoring."""
import argparse,hashlib,json
from pathlib import Path
from kuairec_batch import ROOT,prediction

def main():
    p=argparse.ArgumentParser();p.add_argument('--batch',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    manifest_path=Path(a.batch)/'manifest.json';raw=manifest_path.read_bytes();m=json.loads(raw);rows=[];hashes={}
    for entry in m['records']:
        run=ROOT/m['method']/'runs'/entry['run_id'];rp=run/'result.json';sp=run/'search-results.json'
        if not rp.exists():raise ValueError('batch incomplete; missing result for '+entry['run_id'])
        result=json.loads(rp.read_bytes())
        if 'budget_exhausted' in result.get('error','') or result.get('error')=='interrupted before result was committed':raise ValueError('operationally incomplete result: '+entry['run_id'])
        searches=json.loads(sp.read_bytes()) if sp.exists() else []
        if result.get('status')=='submitted':
            state=run/('next-state.json' if m['method']=='clawrec' else 'state.json')
            if not state.exists() or str(json.loads(state.read_text()).get('user_id'))!=str(entry['user_id']):raise ValueError('result user mismatch')
        hashes[entry['run_id']]={'result_sha256':hashlib.sha256(rp.read_bytes()).hexdigest(),'searches_sha256':hashlib.sha256(sp.read_bytes()).hexdigest() if sp.exists() else None}
        rows.append(prediction(entry['user_id'],m['method'],result,searches))
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False);data=''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows);(out/'predictions.jsonl').write_text(data);(out/'freeze.json').write_text(json.dumps({'batch_manifest_sha256':hashlib.sha256(raw).hexdigest(),'predictions_sha256':hashlib.sha256(data.encode()).hexdigest(),'result_hashes':hashes,'count':len(rows),'labels_read':False},indent=2)+'\n');print(json.dumps({'users':len(rows),'submitted':sum(r['status']=='submitted' for r in rows),'labels_read':False}))
if __name__=='__main__':main()
