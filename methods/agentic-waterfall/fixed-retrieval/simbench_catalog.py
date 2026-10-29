"""Project the verified SimBench snapshot into the fixed retriever's public catalog."""
import argparse,hashlib,json
from pathlib import Path

def make_catalog(docs):return sorted([{'id':x['id'],'text':x['title']+'\n'+x['text']} for x in docs],key=lambda x:x['id'])
def main():
    p=argparse.ArgumentParser();p.add_argument('--snapshot',required=True);p.add_argument('--output',required=True);a=p.parse_args();root=Path(a.snapshot);raw=(root/'catalog.jsonl').read_bytes();m=json.loads((root/'manifest.json').read_text())
    if hashlib.sha256(raw).hexdigest()!=m['catalog_sha256']:raise ValueError('snapshot changed')
    docs=[json.loads(x) for x in raw.splitlines() if x.strip()];out=Path(a.output)
    with out.open('x') as f:json.dump(make_catalog(docs),f,ensure_ascii=False,sort_keys=True)
    print(json.dumps({'records':len(docs),'snapshot_sha256':m['catalog_sha256'],'labels_read':False}))
if __name__=='__main__':main()
