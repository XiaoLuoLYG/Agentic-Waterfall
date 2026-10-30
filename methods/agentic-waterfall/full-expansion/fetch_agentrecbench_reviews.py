"""Fetch two pinned official review files at a bounded network rate."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE=Path(__file__).resolve().parent/'agentrecbench/reviews'
REV='288f7f09ca0387e5169a61b219047aea397e4b06'
FILES=(('long',250175866,'86b54f452108cc4fdec8b1e8402f625bb012ec85e9ce768e7fc7269b37ea23f4'),
       ('all',4221139342,'234670e1d67fc287b3b680a4c777f8ed9eab69607882f1722d03134609e958c6'))


def verified(path,size,expected):
    if not path.exists() or path.stat().st_size!=size:return False
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()==expected


def main():
    HERE.mkdir(parents=True,exist_ok=True);done=[]
    for kind,size,sha in FILES:
        dest=HERE/f'{kind}-review.json';part=HERE/f'{kind}-review.json.part'
        if dest.exists():
            if not verified(dest,size,sha):raise RuntimeError('existing review file differs; preserved')
            done.append(kind);continue
        have=part.stat().st_size if part.exists() else 0
        if have>size:raise RuntimeError('partial file exceeds expected size; preserved')
        if shutil.disk_usage(HERE).free-(size-have)<20*1024**3:raise RuntimeError('20 GiB disk reserve')
        url=f'https://huggingface.co/datasets/SGJQovo/AgentRecBench/resolve/{REV}/output_data_{kind}/review.json'
        print(json.dumps({'file':kind,'status':'downloading','existing_bytes':have,'expected_bytes':size,'limit':'1 MiB/s'}),flush=True)
        cmd=['curl','--fail','--location','--silent','--show-error','--retry','8','--retry-all-errors','--retry-delay','60','--retry-max-time','14400','--continue-at','-','--limit-rate','1m','--output',str(part),url]
        subprocess.run(cmd,check=True)
        if not verified(part,size,sha):raise RuntimeError('download size or SHA256 mismatch; partial preserved')
        os.link(part,dest);part.unlink();done.append(kind)
        print(json.dumps({'file':kind,'status':'sha256_verified','bytes':size}),flush=True)
    (HERE/'manifest.json').write_text(json.dumps({'revision':REV,'files':[{'kind':k,'bytes':s,'sha256':h} for k,s,h in FILES],'completed':done,'labels_read':False},indent=2)+'\n')


if __name__=='__main__':main()
