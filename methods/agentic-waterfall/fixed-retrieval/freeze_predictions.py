"""Freeze completed fixed-retrieval results before any test label is read."""
import argparse,hashlib,json
from pathlib import Path

def validate(manifest,rows):
    if [r.get('user_id') for r in rows]!=manifest['user_ids'] or any(r.get('status')!='submitted' for r in rows):raise ValueError('batch incomplete, duplicate or out of order')

def main():
    p=argparse.ArgumentParser();p.add_argument('--batch',required=True);p.add_argument('--output',required=True);a=p.parse_args();batch=Path(a.batch);mb=(batch/'manifest.json').read_bytes();pb=(batch/'predictions.jsonl').read_bytes();validate(json.loads(mb),[json.loads(x) for x in pb.splitlines()]);out=Path(a.output);out.mkdir(parents=True,exist_ok=False);(out/'predictions.jsonl').write_bytes(pb);(out/'freeze.json').write_text(json.dumps({'batch_manifest_sha256':hashlib.sha256(mb).hexdigest(),'predictions_sha256':hashlib.sha256(pb).hexdigest(),'labels_read':False},indent=2)+'\n');print(json.dumps({'status':'frozen','labels_read':False}))
if __name__=='__main__':main()
