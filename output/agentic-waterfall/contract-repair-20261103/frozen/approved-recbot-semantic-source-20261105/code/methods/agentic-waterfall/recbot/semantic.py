"""Score text with local BGE-M3; no collaborative component or training."""
import json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'fixed-retrieval'))
from retrieval import embeddings

def score(data):
    import numpy as np
    items=data['items'];positive=data['positive'];negative=data['negative']
    texts=[i['text'] for i in items]+[s for s in (positive,negative) if s]
    if not texts or any(not isinstance(s,str) for s in texts):raise ValueError('invalid text')
    v=embeddings(texts); n=len(items); offset=n
    pos=(v[:n]@v[offset]).tolist() if positive else [0.0]*n
    offset+=bool(positive)
    neg=(v[:n]@v[offset]).tolist() if negative else [0.0]*n
    if not np.isfinite(pos).all() or not np.isfinite(neg).all():raise ValueError('nonfinite scores')
    return {'semantic':{x['id']:float(y) for x,y in zip(items,pos)},'negative':{x['id']:float(y) for x,y in zip(items,neg)}}
if __name__=='__main__':json.dump(score(json.load(sys.stdin)),sys.stdout)
