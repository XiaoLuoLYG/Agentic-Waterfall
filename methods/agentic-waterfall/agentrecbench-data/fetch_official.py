"""Install the pinned MIT-licensed AgentSocietyChallenge source without overwriting files."""
import hashlib,io,os,tarfile,tempfile,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];DEST=ROOT/'experiments/agentic-waterfall/agentrecbench/upstream';COMMIT='3f575247a5778d34c3ae6b0297139c7d4a3597fd';NAME='AgentSocietyChallenge-'+COMMIT
URL='https://codeload.github.com/tsinghua-fib-lab/AgentSocietyChallenge/tar.gz/'+COMMIT
SHA='176bf9873ab3970dc7d4a41fc5638249fd166231ad150fa76de891c07583c19d'

def install(raw,dest=DEST):
    if hashlib.sha256(raw).hexdigest()!=SHA:raise ValueError('official archive SHA-256 mismatch')
    dest=Path(dest);dest.mkdir(parents=True,exist_ok=True);target=dest/NAME
    if target.exists():raise FileExistsError('upstream source already exists; do not overwrite')
    with tempfile.TemporaryDirectory(dir=dest,prefix='.upstream-') as tmp,tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        members=archive.getmembers()
        if sum(x.size for x in members)>100_000_000:raise ValueError('archive expands beyond limit')
        for entry in members:
            parts=Path(entry.name).parts
            if not parts or parts[0]!=NAME or '..' in parts or Path(entry.name).is_absolute() or not (entry.isfile() or entry.isdir()):raise ValueError('unsafe archive entry')
        archive.extractall(tmp,members=members);target.mkdir()
        for child in (Path(tmp)/NAME).iterdir():os.rename(child,target/child.name)
    return str(target)

def main():
    req=urllib.request.Request(URL,headers={'User-Agent':'agentic-waterfall-research'})
    with urllib.request.urlopen(req,timeout=60) as response:raw=response.read(10_000_000)
    print(install(raw))
if __name__=='__main__':main()
