"""Download a user-approved domain subset from audited official byte ranges."""
import argparse,hashlib,json,os,shutil,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
AUDIT=ROOT/'experiments/agentic-waterfall/agentrecbench/metadata/domain_ranges.json'
DATA=ROOT/'datasets/agentic-waterfall/agentrecbench'
CONTROL=ROOT/'methods/agentic-waterfall/model-control/agentrecbench-download.json'
REV='288f7f09ca0387e5169a61b219047aea397e4b06'

def resume_interval(start,end_exclusive,have):
    if not 0<=have<=end_exclusive-start:raise ValueError('invalid partial size')
    return None if have==end_exclusive-start else (start+have,end_exclusive-1)

def validate_content_range(status,header,start,end,total):
    if status!=206 or header!=f'bytes {start}-{end}/{total}':raise ValueError('server did not honor the exact byte range')

def sha_file(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('--domain',choices=['yelp','goodreads'],required=True);a=p.parse_args()
    control=json.loads(CONTROL.read_text())
    if not control.get('allowed') or a.domain not in control['domains']:raise RuntimeError('user-approved download is not enabled')
    audit=json.loads(AUDIT.read_text());
    if audit['revision']!=REV:raise RuntimeError('dataset revision mismatch')
    out=DATA/(a.domain+'-short');out.mkdir(parents=True,exist_ok=True);records=[]
    for item in audit['files']:
        spec=item['domains'][a.domain];start=spec['start'];end=spec['end_exclusive'];target=out/Path(item['path']).name;part=target.with_suffix('.json.part');record=out/(target.name+'.receipt.json')
        if target.exists():
            if not record.exists():raise RuntimeError('existing file without receipt; preserving it')
            old=json.loads(record.read_text());
            if old['bytes']!=target.stat().st_size or old['sha256']!=sha_file(target):raise RuntimeError('existing target does not match receipt')
            records.append(old);continue
        have=part.stat().st_size if part.exists() else 0;interval=resume_interval(start,end,have)
        if shutil.disk_usage(DATA).free-(end-start-have)<20*1024**3:raise RuntimeError('20 GiB disk reserve')
        url=f"https://huggingface.co/datasets/SGJQovo/AgentRecBench/resolve/{REV}/{item['path']}";beg=time.time()
        if interval:
            a0,b0=interval;req=urllib.request.Request(url,headers={'Range':f'bytes={a0}-{b0}','Accept-Encoding':'identity','User-Agent':'AgentRecBench-research/1.0'})
            with urllib.request.urlopen(req,timeout=90) as response:
                validate_content_range(response.status,response.headers.get('Content-Range'),a0,b0,item['full_bytes'])
                with part.open('ab' if have else 'xb') as f:
                    last=have
                    while True:
                        block=response.read(1024*1024)
                        if not block:break
                        have+=len(block)
                        if have>end-start:raise RuntimeError('download exceeded audited range')
                        f.write(block)
                        if have-last>=128*1024*1024:print(json.dumps({'domain':a.domain,'file':target.name,'downloaded':have,'expected':end-start}),flush=True);last=have
                    f.flush();os.fsync(f.fileno())
        if part.stat().st_size!=end-start:raise RuntimeError('incomplete download; part preserved')
        count=0
        with part.open() as f:
            for line in f:
                row=json.loads(line)
                if row.get('source')!=a.domain:raise RuntimeError('unexpected domain; part preserved')
                count+=1
        sha=sha_file(part);os.link(part,target);part.unlink();info={'path':str(target),'source_url':url,'revision':REV,'range_start':start,'range_end_exclusive':end,'bytes':target.stat().st_size,'sha256':sha,'rows':count,'full_object_lfs_sha256':item['full_lfs_sha256'],'validation':'every JSONL row parses and source matches; range sha is local, not the whole-object hash','seconds':round(time.time()-beg,2)}
        with record.open('x') as f:json.dump(info,f,indent=2)
        records.append(info);print(json.dumps({'domain':a.domain,'file':target.name,'rows':count,'bytes':info['bytes'],'status':'validated'}),flush=True)
    manifest={'domain':a.domain,'window':'short','revision':REV,'completed_at':datetime.now(timezone.utc).isoformat(),'files':records,'total_bytes':sum(x['bytes'] for x in records)}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'domain':a.domain,'status':'complete','total_bytes':manifest['total_bytes']}),flush=True)
if __name__=='__main__':main()
