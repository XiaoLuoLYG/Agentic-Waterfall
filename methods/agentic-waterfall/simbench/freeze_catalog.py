"""Create an immutable public content snapshot; input must contain no labels."""
import argparse,hashlib,json
from collections import Counter
from pathlib import Path
from catalog import FrozenCatalog

def freeze(records):
    c=FrozenCatalog(records);docs=sorted(c.records,key=lambda x:x['id']);raw=(''.join(json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n' for x in docs)).encode()
    return raw,{'schema':'simbench-frozen-catalog-v1','count':len(docs),'sources':dict(sorted(Counter(x['source'] for x in docs).items())),'catalog_sha256':hashlib.sha256(raw).hexdigest(),'hidden_labels_allowed':False,'model_calls':0}

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    raw=Path(a.input).read_bytes();records=[json.loads(x) for x in raw.splitlines() if x.strip()];data,manifest=freeze(records);manifest['source_sha256']=hashlib.sha256(raw).hexdigest()
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False);(out/'catalog.jsonl').write_bytes(data);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
if __name__=='__main__':main()
