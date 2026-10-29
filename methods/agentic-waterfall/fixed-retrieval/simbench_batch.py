"""Fixed BM25/BGE retrieval on the same frozen SimBench snapshot and cutoff."""
import argparse,hashlib,json,sys,time
from pathlib import Path
from retrieval import search
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE.parent/'simbench'))
from catalog import published_ms
from case_input import load_case

def eligible_records(docs,sources,cutoff):
    return [x['id'] for x in docs if x['source'] in sources and (t:=published_ms(x.get('published_at',''))) is not None and t<=cutoff]
def query_from_evidence(evidence):
    parts=[]
    for row in evidence:
        for key in ('title','normalized_query'):
            value=row.get(key)
            if isinstance(value,str) and value.strip() and value.strip() not in parts:parts.append(value.strip())
    return ' '.join(parts)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--cases',required=True);p.add_argument('--snapshot',required=True);p.add_argument('--catalog',required=True);p.add_argument('--index',required=True);p.add_argument('--output',required=True);p.add_argument('--limit',type=int);p.add_argument('--execute',action='store_true');a=p.parse_args()
    snap=Path(a.snapshot);raw=(snap/'catalog.jsonl').read_bytes();meta=json.loads((snap/'manifest.json').read_text());snapsha=digest(raw)
    if snapsha!=meta['catalog_sha256']:raise ValueError('snapshot changed')
    docs=[json.loads(x) for x in raw.splitlines() if x.strip()];catalog_raw=Path(a.catalog).read_bytes();index=Path(a.index);idx=json.loads((index/'index.json').read_text())
    if digest(catalog_raw)!=idx['catalog_sha256']:raise ValueError('index built from different catalog')
    expected=sorted([{'id':x['id'],'text':x['title']+'\n'+x['text']} for x in docs],key=lambda x:x['id'])
    if json.loads(catalog_raw)!=expected:raise ValueError('catalog does not match snapshot')
    folders=sorted(Path(a.cases).glob('group_*__user_*/event_*/input'));total=len(folders)
    if a.limit is not None:
        if not 1<=a.limit<=total:raise ValueError('invalid limit')
        folders=folders[:a.limit]
    if not folders:raise ValueError('no cases')
    records=[]
    for folder in folders:
        case=load_case(folder);active=sorted(set(case['allowed_sources'])&set(meta['sources']))
        if not active:raise ValueError('no shared source')
        records.append({'case_id':case['case_id'],'user_id':case['user_id'],'event':case['event'],'input':str(folder.resolve()),'active_sources':active,'input_hashes':{n:digest((folder/n).read_bytes()) for n in ('manifest.json','allowed_sources.json','evidence.visible.jsonl')}})
    sources=[Path(__file__),HERE/'retrieval.py',HERE.parent/'simbench/catalog.py',HERE.parent/'simbench/case_input.py',HERE.parent/'simbench/runtime_input.py']
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False);manifest={'source_sha256':{str(x):digest(x.read_bytes()) for x in sources},'method':'fixed-bm25-bge-reranker','snapshot_sha256':snapsha,'catalog_sha256':digest(catalog_raw),'index_sha256':{n:digest((index/n).read_bytes()) for n in ('index.json','vectors.npy')},'cases':records,'full_case_count':total,'diagnostic_limit':a.limit,'query_rule':'deduplicated titles and queries from visible evidence','labels_read':False,'training':False};(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    if not a.execute:print(json.dumps({'status':'prepared_no_model_calls','cases':len(records)}));return
    for entry in records:
        folder=Path(entry['input'])
        if any(digest((folder/n).read_bytes())!=h for n,h in entry['input_hashes'].items()) or digest((snap/'catalog.jsonl').read_bytes())!=snapsha or any(digest(Path(f).read_bytes())!=h for f,h in manifest['source_sha256'].items()) or any(digest((index/n).read_bytes())!=h for n,h in manifest['index_sha256'].items()):raise ValueError('frozen inputs or sources changed')
        case=load_case(folder);case.update(active_sources=entry['active_sources'],unavailable_sources=sorted(set(case['allowed_sources'])-set(entry['active_sources'])),snapshot_sha256=snapsha,method=manifest['method']);run=out/case['case_id'];run.mkdir();(run/'input.json').write_text(json.dumps(case,ensure_ascii=False,indent=2)+'\n')
        eligible=eligible_records(docs,case['active_sources'],case['as_of_ms']);query=query_from_evidence(case['evidence']);started=time.monotonic();result={'method':manifest['method'],'case_id':case['case_id'],'user_id':case['user_id'],'event':case['event'],'snapshot_sha256':snapsha,'model_stages_attempted':0}
        if not eligible or not query:result.update(status='no_delivery',acquired_ids=[],ordered_item_ids=[])
        else:
            try:
                rank=search(index,query,eligible,[],None);result.update(status='submitted',acquired_ids=rank['acquired_ids'],ordered_item_ids=rank['ordered_item_ids'][:20])
            except Exception as e:
                result.update(status='failed',error='local_inference_failed: '+str(e),acquired_ids=[],ordered_item_ids=[]);(run/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');raise
        result['local_inference_seconds']=time.monotonic()-started;(run/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':'completed','cases':len(records),'labels_read':False}))
if __name__=='__main__':main()
