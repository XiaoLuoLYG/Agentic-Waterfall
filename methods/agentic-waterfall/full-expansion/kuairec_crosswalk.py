"""Match KuaiRec users across frozen public inputs without changing model outputs."""
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
WORK=HERE.parents[2]


def crosswalk(waterfall, baseline):
    def index(rows):
        out={}
        for row in rows:
            obs=row['observation'];user=str(obs['user_id'])
            if user in out:raise ValueError('duplicate user: '+user)
            out[user]=obs
        return out
    a,b=index(waterfall),index(baseline)
    if set(a)!=set(b):raise ValueError('user sets differ')
    result=[]
    for user in sorted(a):
        x,y=a[user],b[user]
        if {k:v for k,v in x.items() if k!='decision_id'}!={k:v for k,v in y.items() if k!='decision_id'}:
            raise ValueError('observation mismatch: '+user)
        result.append({'user_id':user,'waterfall_decision_id':x['decision_id'],'baseline_decision_id':y['decision_id']})
    return result


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__=='__main__':
    result={'labels_read':False,'matching':'same split and user ID; public observation equal except decision_id','splits':{}}
    for split,size in [('dev',282),('test',1129)]:
        a=WORK/'output/agentic-waterfall/waterfall-full-20261029/input-preparation'/f'kuairec-{split}.jsonl'
        b=WORK/'methods/agentic-waterfall/protocols/kuairec-public-20261029'/f'kuairec-{split}-public-20261029.jsonl'
        with a.open() as f, b.open() as g:rows=crosswalk(map(json.loads,f),map(json.loads,g))
        if len(rows)!=size:raise ValueError('unexpected split size')
        result['splits'][split]={'count':len(rows),'waterfall_sha256':sha(a),'baseline_sha256':sha(b),'pairs':rows}
    target=HERE/'kuairec-public-crosswalk.json'
    with target.open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:v['count'] for k,v in result['splits'].items()}))
