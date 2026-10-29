"""MIND comparison from frozen complete predictions, with the official scorer."""
import argparse,collections,hashlib,importlib.util,io,json
from pathlib import Path
from cost_reporting import summarize_usage
from error_policy import operational_failure

ROOT=Path(__file__).resolve().parents[2]
MIND=ROOT/'experiments/agentic-waterfall/mind'

def validate_predictions(inputs,methods):
    if not inputs or not methods: raise ValueError('no inputs or methods')
    ids=[x['observation']['decision_id'] for x in inputs]
    if len(set(ids))!=len(ids): raise ValueError('duplicate input decision')
    for x in inputs:
        c=[i['id'] for i in x['observation']['environment']['candidate_pool']]
        if not c or len(c)!=len(set(c)): raise ValueError('invalid public candidate pool')
    fixed={}
    for name,rows in methods.items():
        index={x['decision_id']:x for x in rows}
        if len(index)!=len(rows) or set(index)!=set(ids): raise ValueError(f'{name}: incomplete or duplicate decisions')
        if any(operational_failure(row) for row in rows):raise ValueError(f'{name}: operationally incomplete decisions')
        fixed[name]=index
    return fixed

def rank_lines(inputs,records,truth):
    truth_lines=[];prediction=[];invalid=[]
    for x in inputs:
        obs=x['observation'];decision=obs['decision_id'];iid=decision.rsplit(':',1)[-1];t=truth[iid]
        candidates=[c['id'] for c in obs['environment']['candidate_pool']]
        if len(set(t['ids']))!=len(t['ids']) or set(t['ids'])!=set(candidates): raise ValueError('truth/public candidate mismatch')
        row=records[decision];rank=row.get('ordered_item_ids',[])
        valid=row.get('status','ok') in ('ok','completed','success','submitted') and isinstance(rank,list) and len(rank)==len(candidates) and all(isinstance(v,str) for v in rank) and len(set(rank))==len(rank) and set(rank)==set(candidates)
        if valid:
            byid={v:i+1 for i,v in enumerate(rank)};ranks=[byid[i] for i in t['ids']]
        else:ranks=[1]*len(t['ids']);invalid.append(decision)
        truth_lines.append(iid+' '+json.dumps(t['labels'],separators=(',',':'))+'\n')
        prediction.append(iid+' '+json.dumps(ranks,separators=(',',':'))+'\n')
    return ''.join(truth_lines),''.join(prediction),invalid

def load_truth(path,wanted):
    found={}
    with Path(path).open() as f:
        for line in f:
            fields=line.rstrip('\n').split('\t');iid=fields[0]
            if iid not in wanted:continue
            if len(fields)<5 or iid in found:raise ValueError('invalid truth row')
            parts=[x.rsplit('-',1) for x in fields[-1].split()]
            if any(len(x)!=2 or x[1] not in ('0','1') for x in parts):raise ValueError('invalid labels')
            found[iid]={'ids':[x[0] for x in parts],'labels':[int(x[1]) for x in parts]}
    if set(found)!=wanted:raise ValueError('missing truth')
    return found

def main():
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--predictions',nargs='+',required=True,help='method=prediction.jsonl');p.add_argument('--behaviors',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    inputs=[json.loads(x) for x in Path(a.inputs).read_text().splitlines() if x.strip()];methods={};hashes={}
    for arg in a.predictions:
        name,path=arg.split('=',1)
        if not name or name in methods:raise ValueError('invalid method name')
        data=Path(path).read_bytes();methods[name]=[json.loads(x) for x in data.splitlines() if x.strip()];hashes[name]=hashlib.sha256(data).hexdigest()
    fixed=validate_predictions(inputs,methods)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
    receipt={'input_sha256':hashlib.sha256(Path(a.inputs).read_bytes()).hexdigest(),'prediction_sha256':hashes,'decisions':len(inputs),'labels_accessed':False}
    (out/'frozen.json').write_text(json.dumps(receipt,indent=2)+'\n')
    wanted={x['observation']['decision_id'].rsplit(':',1)[-1] for x in inputs};truth=load_truth(a.behaviors,wanted)
    spec=importlib.util.spec_from_file_location('mind_official',MIND/'upstream/MIND/evaluate.py');official=importlib.util.module_from_spec(spec);spec.loader.exec_module(official)
    import numpy as np
    keys=['AUC','MRR','NDCG@5','NDCG@10'];per={};summary={}
    for name,records in fixed.items():
        t,pred,invalid=rank_lines(inputs,records,truth);ts=t.splitlines(True);ps=pred.splitlines(True)
        per[name]=np.array([official.scoring(io.StringIO(tl),io.StringIO(pl)) for tl,pl in zip(ts,ps)])
        scores=official.scoring(io.StringIO(t),io.StringIO(pred));summary[name]={'metrics':dict(zip(keys,map(float,scores))),'invalid_count':len(invalid),'invalid_decisions':invalid,'resource_usage':summarize_usage(list(records.values()))}
    clusters=collections.defaultdict(list)
    for i,x in enumerate(inputs):clusters[x['observation']['user_id']].append(i)
    groups=list(clusters.values());rng=np.random.RandomState(20261029);samples={name:[] for name in fixed}
    for _ in range(1000):
        ix=np.concatenate([groups[i] for i in rng.randint(0,len(groups),len(groups))])
        for name in fixed:samples[name].append(np.mean(per[name][ix],axis=0))
    for name in fixed:
        low,high=np.percentile(np.asarray(samples[name]),[2.5,97.5],axis=0);summary[name]['user_cluster_bootstrap_95']=dict(zip(keys,[[float(x),float(y)] for x,y in zip(low,high)]))
    first=next(iter(fixed));paired={}
    for name in list(fixed)[1:]:
        diff=np.array(samples[first])-np.array(samples[name]);lo,hi=np.percentile(diff,[2.5,97.5],axis=0);observed=np.mean(per[first],axis=0)-np.mean(per[name],axis=0)
        paired[f'{first}_minus_{name}']=dict(zip(keys,[{'observed':float(x),'bootstrap_95':[float(l),float(h)]} for x,l,h in zip(observed,lo,hi)]))
    result={'decisions':len(inputs),'users':len(groups),'methods':summary,'paired':paired,'bootstrap_replicates':1000,'seed':20261029,'invalid_fallback':'all ranks 1','labels_accessed_after_frozen_receipt':True,'comparison_model_call_cap':None,'resource_control':'operational safety caps are independent of comparison protocol'}
    (out/'metrics.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'decisions':len(inputs),'methods':list(methods),'output':str(out)}))
if __name__=='__main__':main()
