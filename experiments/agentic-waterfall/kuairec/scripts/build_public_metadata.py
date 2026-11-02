"""Export content duration from the public big table without reading evaluation labels."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import pathlib
import pandas as pd


def build_metadata(path):
    counts=defaultdict(Counter)
    for frame in pd.read_csv(path,usecols=['video_id','video_duration'],chunksize=500000):
        if frame.isna().any().any() or (frame.video_duration<=0).any():
            raise ValueError('invalid_public_duration')
        for (video_id,duration),count in frame.groupby(['video_id','video_duration']).size().items():
            counts[str(int(video_id))][float(duration)]+=int(count)
    # The same video has small measurement differences across public observations.
    items={key:{'duration_ms':min(values,key=lambda value:(-values[value],value))} for key,values in sorted(counts.items(),key=lambda row:int(row[0]))}
    digest=hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return {'version':'kuairec-public-content-v1','source':'big_matrix.csv:video_duration','source_sha256':digest.hexdigest(),'aggregation':'most frequent duration; smaller duration breaks ties','items':items}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--big',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args()
    result=build_metadata(args.big)
    with args.output.open('x') as stream:json.dump(result,stream,ensure_ascii=False)
    print(json.dumps({'output':str(args.output),'items':len(result['items']),'source_sha256':result['source_sha256']}))
