"""Download pinned official short-window task and evaluator-only label files."""
import argparse,concurrent.futures,hashlib,json,re,time,urllib.request
from pathlib import Path
from download import DATA,CONTROL,REV

def git_blob_id(raw):return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
def check_entries(domain,tasks,truth):
    def ids(entries,kind):
        prefix='task' if kind=='tasks' else 'groundtruth';pattern=rf'task/short_term/{domain}/{kind}/{prefix}_(\d+)\.json';out=[]
        for e in entries:
            m=re.fullmatch(pattern,e.get('path',''))
            if e.get('type')!='file' or not m:raise ValueError('unexpected remote task path')
            out.append(int(m.group(1)))
        if len(out)!=len(set(out)):raise ValueError('duplicate task')
        return set(out)
    a=ids(tasks,'tasks');b=ids(truth,'groundtruth')
    if not a or a!=b:raise ValueError('task/label ID sets mismatch')
    return sorted(a)

def listing(domain,kind):
    url=f'https://huggingface.co/api/datasets/SGJQovo/AgentRecBench/tree/{REV}/task/short_term/{domain}/{kind}?limit=1000'
    with urllib.request.urlopen(url,timeout=45) as r:
        data=json.load(r)
        if r.headers.get('Link'):raise RuntimeError('task listing paginated; refuse partial list')
    return data

def fetch(entry,out):
    src=entry['path'];relative=Path(src).relative_to('task');dst=out/relative;dst.parent.mkdir(parents=True,exist_ok=True)
    if dst.exists():
        data=dst.read_bytes()
        if len(data)!=entry['size'] or git_blob_id(data)!=entry['oid']:raise RuntimeError('existing task differs; preserving file')
        return
    url=f'https://huggingface.co/datasets/SGJQovo/AgentRecBench/resolve/{REV}/{src}'
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=45) as r:data=r.read(entry['size']+1)
            if len(data)!=entry['size'] or git_blob_id(data)!=entry['oid']:raise RuntimeError('task object verification failed')
            with dst.open('xb') as f:f.write(data)
            return
        except (OSError,RuntimeError):
            if attempt==2:raise
            time.sleep(0.5*(attempt+1))

def main():
    p=argparse.ArgumentParser();p.add_argument('--domain',choices=['amazon','yelp','goodreads'],required=True);a=p.parse_args()
    ctl=json.loads(CONTROL.read_text());
    if not ctl.get('allowed'):raise RuntimeError('download not enabled')
    t=listing(a.domain,'tasks');g=listing(a.domain,'groundtruth');ids=check_entries(a.domain,t,g);out=DATA/'task-full'
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:list(ex.map(lambda entry:fetch(entry,out),t+g))
    for e in t:
        task=json.loads((out/Path(e['path']).relative_to('task')).read_text());c=task.get('candidate_list',[])
        if task.get('type')!='recommendation' or len(c)!=20 or len(set(c))!=20:raise ValueError('invalid public task')
    info={'revision':REV,'domain':a.domain,'scenario':'short_term','task_ids':ids,'tasks':len(t),'evaluator_only_files':len(g),'labels_decoded':False,'model_calls':0}
    p=out/'short_term'/a.domain/'download-manifest.json';p.write_text(json.dumps(info,indent=2)+'\n');print(json.dumps({'domain':a.domain,'tasks':len(t),'label_files':len(g),'status':'verified'}),flush=True)
if __name__=='__main__':main()
