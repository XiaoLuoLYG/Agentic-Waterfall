"""Fetch pinned official tasks; keep evaluator files separate and unparsed."""
import concurrent.futures
import hashlib
import json
import re
import shutil
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime
from pathlib import Path

HERE=Path(__file__).resolve().parent/'agentrecbench'
REV='288f7f09ca0387e5169a61b219047aea397e4b06'
BASE=f'https://huggingface.co/datasets/SGJQovo/AgentRecBench/resolve/{REV}/'
API=f'https://huggingface.co/api/datasets/SGJQovo/AgentRecBench/tree/{REV}/'
SCENARIOS=('classic','long_term','user_cold_start','item_cold_start')
DOMAINS=('amazon','yelp','goodreads')


def git_blob_id(raw):return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()


def retry_delay(header, attempt):
    try:
        seconds = float(header)
    except (TypeError, ValueError):
        try: seconds = parsedate_to_datetime(header).timestamp()-time.time()
        except (TypeError, ValueError, OverflowError): seconds = 0
    return max(60*2**min(attempt,4), seconds)


def open_with_backoff(url):
    for attempt in range(8):
        try:return urllib.request.urlopen(url,timeout=45)
        except urllib.error.HTTPError as exc:
            if exc.code!=429 or attempt==7:raise
            delay=retry_delay(exc.headers.get('Retry-After'),attempt)
            print(json.dumps({'status':'rate_limited','retry_after_seconds':round(delay)}),flush=True)
            time.sleep(delay)


def check_entries(scenario,domain,tasks,truth):
    def ids(rows,kind):
        prefix='task' if kind=='tasks' else 'groundtruth'
        pattern=rf'task/{re.escape(scenario)}/{re.escape(domain)}/{kind}/{prefix}_(\d+)\.json'
        out=[]
        for e in rows:
            m=re.fullmatch(pattern,e.get('path',''))
            if e.get('type')!='file' or not m:raise ValueError('unexpected remote task path')
            out.append(int(m.group(1)))
        if len(out)!=len(set(out)):raise ValueError('duplicate task')
        return set(out)
    a,b=ids(tasks,'tasks'),ids(truth,'groundtruth')
    if not a or a!=b:raise ValueError('task/label ID sets mismatch')
    return sorted(a)


def listing(scenario,domain,kind):
    with open_with_backoff(API+f'task/{scenario}/{domain}/{kind}?limit=1000') as r:
        data=json.load(r)
        if r.headers.get('Link'):raise RuntimeError('paginated task list; cannot claim full')
        return data


def fetch(entry):
    path=Path(entry['path']); dst=HERE/path
    dst.parent.mkdir(parents=True,exist_ok=True)
    if dst.exists():
        raw=dst.read_bytes()
        if len(raw)!=entry['size'] or git_blob_id(raw)!=entry['oid']:raise RuntimeError('existing file differs')
        return
    for attempt in range(3):
        try:
            with open_with_backoff(BASE+str(path)) as r:raw=r.read(entry['size']+1)
            if len(raw)!=entry['size'] or git_blob_id(raw)!=entry['oid']:raise ValueError('task hash mismatch')
            with dst.open('xb') as f:f.write(raw)
            time.sleep(1)
            return
        except (OSError,ValueError):
            if attempt==2:raise
            time.sleep(attempt+1)


def main():
    HERE.mkdir(exist_ok=True);summary=[]
    for scenario in SCENARIOS:
        for domain in DOMAINS:
            if shutil.disk_usage(HERE).free<20*1024**3:raise RuntimeError('less than 20 GiB free')
            tasks,truth=listing(scenario,domain,'tasks'),listing(scenario,domain,'groundtruth')
            ids=check_entries(scenario,domain,tasks,truth)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:list(ex.map(fetch,tasks+truth))
            for e in tasks:
                with (HERE/e['path']).open() as f:json.load(f)
            row={'scenario':scenario,'domain':domain,'task_count':len(ids),'task_ids':ids,'revision':REV,'labels_decoded':False}
            summary.append(row);(HERE/f'{scenario}-{domain}.manifest.json').write_text(json.dumps(row,indent=2)+'\n')
            print(json.dumps({'scenario':scenario,'domain':domain,'tasks':len(ids),'verified':True}),flush=True)
    (HERE/'download-manifest.json').write_text(json.dumps({'revision':REV,'sets':summary,'labels_decoded':False},indent=2)+'\n')


if __name__=='__main__':main()
