"""Resume validated official byte ranges, then verify the full official checksum."""
import concurrent.futures,hashlib,json,os,re,sys,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
DATA=ROOT/'datasets/agentic-waterfall/kuairand-1k'
URL='https://zenodo.org/api/records/18159199/files/kuairand_video_captions.csv/content'
TOTAL=3222932768;MD5='9fd4e7587ffd0c8dc289d013858fb229';COUNT=16
DIR=DATA/'caption-chunks-20261029';FINAL=DATA/'kuairand-video-captions-20261029.csv'

def part(n):
    start=TOTAL*n//COUNT;end=TOTAL*(n+1)//COUNT-1;p=DIR/f'{n:02d}.part';size=p.stat().st_size if p.exists() else 0;expected=end-start+1
    if size>expected:raise ValueError('oversized range')
    for attempt in range(10):
        if size==expected:return n
        req=urllib.request.Request(URL,headers={'Range':f'bytes={start+size}-{end}','Accept-Encoding':'identity'})
        try:
            with urllib.request.urlopen(req,timeout=120) as r:
                if r.status!=206 or r.headers.get('Content-Range')!=f'bytes {start+size}-{end}/{TOTAL}':raise ValueError('server did not honor exact byte range')
                with p.open('ab') as f:
                    while True:
                        block=r.read(1024*1024)
                        if not block:break
                        size+=len(block)
                        if size>expected:raise ValueError('excess bytes')
                        f.write(block)
            if size==expected:return n
        except Exception:
            if attempt==9:raise
        time.sleep(min(30,2*(attempt+1)));size=p.stat().st_size if p.exists() else 0
    raise RuntimeError('incomplete range')

def main():
    DIR.mkdir(exist_ok=True);first=DATA/'kuairand-video-captions-20261029.csv.partial';p=DIR/'00.part'
    if first.exists() and not p.exists():os.rename(first,p)
    if FINAL.exists():raise FileExistsError('final file already exists')
    with concurrent.futures.ThreadPoolExecutor(max_workers=COUNT) as pool:
        futures=[pool.submit(part,n) for n in range(COUNT)]
        for f in concurrent.futures.as_completed(futures):print(json.dumps({'completed_chunk':f.result(),'chunks':COUNT}),flush=True)
    temporary=DATA/'kuairand-video-captions-20261029.merging';h=hashlib.md5();sha=hashlib.sha256();size=0
    with temporary.open('xb') as out:
        for n in range(COUNT):
            with (DIR/f'{n:02d}.part').open('rb') as source:
                for block in iter(lambda:source.read(8*1024*1024),b''):
                    out.write(block);h.update(block);sha.update(block);size+=len(block)
    if size!=TOTAL or h.hexdigest()!=MD5:raise ValueError('full file checksum mismatch; chunks retained')
    os.rename(temporary,FINAL);(DATA/'captions-full-20261029-manifest.json').write_text(json.dumps({'url':URL,'bytes':size,'md5':h.hexdigest(),'sha256':sha.hexdigest(),'official_md5_verified':True,'chunks':COUNT},indent=2)+'\n');print(json.dumps({'complete':True,'bytes':size,'md5_verified':True}),flush=True)
if __name__=='__main__':main()
