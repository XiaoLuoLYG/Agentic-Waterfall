"""Prepare author-provided long-history reviews and read-only domain indices."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path

HERE=Path(__file__).resolve().parent
WORK=HERE.parents[2]
SOURCE=HERE/'agentrecbench/reviews/long-review.json'
EXPECTED='86b54f452108cc4fdec8b1e8402f625bb012ec85e9ce768e7fc7269b37ea23f4'
DOMAINS=('amazon','yelp','goodreads')


def split_reviews(source,out,expected):
    out=Path(out);handles={};hashes={d:hashlib.sha256() for d in DOMAINS};counts={d:0 for d in DOMAINS};digest=hashlib.sha256()
    for d in DOMAINS:
        directory=out/d;directory.mkdir(parents=True,exist_ok=True)
        if (directory/'review.json').exists() or (directory/'review.json.part').exists():raise FileExistsError('preserve existing or partial review')
    try:
        handles={d:(out/d/'review.json.part').open('xb') for d in DOMAINS}
        with Path(source).open('rb') as f:
            for line in f:
                digest.update(line);row=json.loads(line);domain=row.get('source')
                if domain not in handles:raise ValueError('unexpected source: '+str(domain))
                handles[domain].write(line);hashes[domain].update(line);counts[domain]+=1
        if digest.hexdigest()!=expected:raise ValueError('review file SHA256 mismatch')
        for handle in handles.values():handle.flush();os.fsync(handle.fileno())
    finally:
        for handle in handles.values():handle.close()
    for d in DOMAINS:
        part=out/d/'review.json.part';target=out/d/'review.json';os.link(part,target);part.unlink()
        (out/d/'review.json.receipt.json').write_text(json.dumps({'bytes':target.stat().st_size,'sha256':hashes[d].hexdigest(),'rows':counts[d],'source_sha256':expected},indent=2)+'\n')
    return {'counts':counts,'source_sha256':digest.hexdigest(),'domain_sha256':{d:hashes[d].hexdigest() for d in DOMAINS}}


def main():
    out=HERE/'agentrecbench/prepared/long_term'
    report=split_reviews(SOURCE,out,EXPECTED)
    (out/'split-manifest.json').write_text(json.dumps({**report,'labels_read':False,'source_order_preserved':True},indent=2)+'\n')
    indexer=WORK/'output/agentic-waterfall/formal-20261029-224252/methods/agentic-waterfall/agentrecbench-data/indexed_tool.py'
    spec=importlib.util.spec_from_file_location('official_indexer',indexer);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    for domain in DOMAINS:
        directory=out/domain;existing=WORK/'datasets/agentic-waterfall/agentrecbench'/(domain+'-short')
        for kind in ('item','user'):
            target=existing/(kind+'.json')
            if not target.is_file():raise FileNotFoundError(target)
            (directory/(kind+'.json')).symlink_to(target)
            receipt=target.with_name(target.name+'.receipt.json')
            if receipt.exists():(directory/(kind+'.json.receipt.json')).symlink_to(receipt)
        print(json.dumps({'domain':domain,'status':'indexing'}),flush=True)
        module.build_index(directory,out/(domain+'.sqlite'))
        print(json.dumps({'domain':domain,'status':'index_complete'}),flush=True)
    (out/'index-manifest.json').write_text(json.dumps({'domains':list(DOMAINS),'indexer_sha256':hashlib.sha256(indexer.read_bytes()).hexdigest(),'labels_read':False,'model_calls':0},indent=2)+'\n')


if __name__=='__main__':main()
