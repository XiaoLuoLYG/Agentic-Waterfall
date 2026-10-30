"""Fetch the pinned author's model.py locally, checking its known SHA-256."""
import hashlib,os,urllib.request
from pathlib import Path
from adapter import SOURCE,SOURCE_SHA256
URL='https://raw.githubusercontent.com/agiresearch/iAgent/e546d17848fadbcaf00e4022aa949289d7e7900b/model.py'

def install(raw,path=SOURCE):
    if hashlib.sha256(raw).hexdigest()!=SOURCE_SHA256:raise ValueError('author source SHA-256 mismatch')
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if path.read_bytes()!=raw:raise FileExistsError('different author source already exists')
        return 'already_present'
    temp=path.with_suffix('.download');temp.write_bytes(raw)
    try:os.link(temp,path)
    finally:temp.unlink(missing_ok=True)
    return 'installed'

def main():
    req=urllib.request.Request(URL,headers={'User-Agent':'agentic-waterfall-research'})
    with urllib.request.urlopen(req,timeout=30) as response:raw=response.read(2_000_000)
    print(install(raw))
if __name__=='__main__':main()
