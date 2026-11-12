"""Strict multi-positive evaluator. Only this module reads held-out relevance."""
import argparse
import json
import math
import pathlib
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parents[1]

def score_user(ranked, acquired, eligible, positives, acquisition_required=True):
    ranked=[str(x) for x in ranked]
    acquired=[str(x) for x in acquired]
    eligible=set(map(str,eligible));positives=set(map(str,positives))
    if len(ranked)>10 or len(ranked)!=len(set(ranked)): raise ValueError('Top10 size/duplicate violation')
    if len(acquired)!=len(set(acquired)): raise ValueError('Acquisition IDs must be distinct')
    if acquisition_required and len(acquired)>100: raise ValueError('Acquisition budget exceeded')
    if not set(ranked)<=eligible or not set(acquired)<=eligible: raise ValueError('Ineligible output')
    if acquisition_required and not set(ranked)<=set(acquired): raise ValueError('Recommendation not acquired')
    if not positives<=eligible: raise ValueError('Invalid evaluator positive mask')
    hits=sum(v in positives for v in ranked)
    dcg=sum((1/math.log2(i+2)) for i,v in enumerate(ranked) if v in positives)
    idcg=sum(1/math.log2(i+2) for i in range(min(10,len(positives))))
    return {'recall_at_10':hits/len(positives) if positives else None,'ndcg_at_10':dcg/idcg if idcg else None,'precision_at_10':hits/10,'acquired_recall_at_100':len(positives.intersection(acquired))/len(positives) if positives and acquisition_required else None,'hits_at_10':hits,'positive_count_full_eligible_catalog':len(positives),'eligible_items':len(eligible),'acquired_items':len(acquired),'recommended_items':len(ranked)}

def evaluate_file(predictions_path,output_path,input_path=None,data_root=None):
    data_root=pathlib.Path(data_root) if data_root else ROOT/'data/processed'
    masks=np.load(data_root/'eligibility.npz')
    labels=np.load(data_root/'evaluator_only/labels.npz')
    assert np.array_equal(masks['users'],labels['users']) and np.array_equal(masks['items'],labels['items'])
    index={int(u):i for i,u in enumerate(masks['users'])}
    rows=[json.loads(s) for s in pathlib.Path(predictions_path).read_text().splitlines() if s.strip()]
    assert len({r['user_id'] for r in rows})==len(rows),'duplicate user output'
    if input_path:
        assigned=[int(json.loads(s)['observation']['user_id']) for s in pathlib.Path(input_path).read_text().splitlines() if s.strip()]
        assert len(set(assigned))==len(assigned),'duplicate assigned user'
        by_user={int(r['user_id']):r for r in rows};assert set(by_user)<=set(assigned),'prediction outside assigned users'
        method=rows[0]['method'] if rows else 'waterfall'
        rows=[by_user.get(u,{'user_id':u,'method':method,'status':'failed','error':'missing_prediction','acquisition_required':True,'ordered_item_ids':[],'acquired_item_ids':[]}) for u in assigned]
    scored=[]
    for row in rows:
        i=index[int(row['user_id'])]
        eligible=masks['items'][masks['observed'][i]];positives=labels['items'][labels['relevant'][i]]
        if not set(map(str,positives))<=set(map(str,eligible)):raise ValueError('Invalid evaluator positive mask')
        invalid=None
        try:
            if row.get('status','ok') not in ('ok','completed','success','submitted'):raise ValueError(row.get('error') or 'not_submitted')
            if not isinstance(row.get('ordered_item_ids'),list) or not row['ordered_item_ids']:raise ValueError('missing_delivery')
            metrics=score_user(row['ordered_item_ids'],row.get('acquired_item_ids',[]),eligible,positives,row.get('acquisition_required',True))
        except (ValueError,TypeError) as error:
            invalid=str(error);metrics=score_user([],[],eligible,positives,row.get('acquisition_required',True))
        strict=invalid is None and not row.get('error') and not row.get('continuation_error') and not row.get('action_failures')
        scored.append({'user_id':row['user_id'],'method':row['method'],'status':row.get('status','ok'),
                       'delivery_valid':invalid is None,'delivery_error':invalid,'strict_episode_success':strict,
                       'error':row.get('error'),'continuation_error':row.get('continuation_error'),'action_failures':row.get('action_failures',[]),**metrics})
    keys=['recall_at_10','ndcg_at_10','precision_at_10','acquired_recall_at_100']
    summary={'n_users':len(rows),'no_positive_users':sum(x['positive_count_full_eligible_catalog']==0 for x in scored),'method':rows[0]['method'] if rows else None,'mean':{k:float(np.mean([r[k] for r in scored if r[k] is not None])) if any(r[k] is not None for r in scored) else None for k in keys},'strict_mean':{k:float(np.mean([r[k] if r['strict_episode_success'] else 0.0 for r in scored if r[k] is not None])) if any(r[k] is not None for r in scored) else None for k in keys},'rows':scored,'exit_code':0,'note':'Recall and IDCG use every positive in the full eligible small catalog; retrieval misses remain in denominator.'}
    pathlib.Path(output_path).write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='rows'}))
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--data-root');p.add_argument('--predictions',required=True);p.add_argument('--output',required=True)
    args=p.parse_args();evaluate_file(args.predictions,args.output,args.input,args.data_root)
