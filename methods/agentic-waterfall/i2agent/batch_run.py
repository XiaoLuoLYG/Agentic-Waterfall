"""Run one fixed public input through the pinned i2Agent workflow."""
import argparse,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def public_view(sample,dataset):
    if dataset not in ('mind','kuairand'):raise ValueError('unsupported dataset')
    obs=sample['observation'];items=[]
    for x in obs['environment']['candidate_pool']:
        if not isinstance(x.get('id'),str) or not isinstance(x.get('title'),str):raise ValueError('invalid candidate')
        text=x.get('abstract') or '' if dataset=='mind' else x.get('text') or ''
        if not isinstance(text,str):raise ValueError('invalid public text')
        items.append({'id':x['id'],'text':'\n'.join(v for v in (x['title'],text) if v)})
    if not items or len({x['id'] for x in items})!=len(items):raise ValueError('empty or duplicate candidate')
    return {'context_id':obs['decision_id'],'user_id':obs['user_id'],'candidates':items,'source':dataset+' public input; no current labels'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--line',type=int,default=0);p.add_argument('--dataset',choices=['mind','kuairand'],required=True);p.add_argument('--output',required=True);p.add_argument('--rank-max-tokens',type=int,default=4096);a=p.parse_args()
    if a.line<0:raise ValueError('invalid line')
    lines=[x for x in Path(a.input).read_bytes().splitlines() if x.strip()];raw=lines[a.line];sample=json.loads(raw);view=public_view(sample,a.dataset)
    out=Path(a.output);out.mkdir(parents=True,exist_ok=False);view['input_sha256']=hashlib.sha256(raw).hexdigest();(out/'input.json').write_text(json.dumps(view,ensure_ascii=False,indent=2)+'\n')
    result={'status':'failed','method':'i2agent','variant':'author-adapted-fixed-candidates','context_id':view['context_id'],'model_request_count':0}
    env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
    try:
        task=out/'task.json';prepare=ROOT/('mind_data.py' if a.dataset=='mind' else 'kuairand_data.py')
        proc=subprocess.run([sys.executable,str(prepare),'--input',str(Path(a.input).resolve()),'--line',str(a.line),'--output',str(task.resolve())],capture_output=True,text=True,env=env,timeout=120)
        (out/'prepare.log').write_text(proc.stdout+proc.stderr)
        if proc.returncode:raise RuntimeError('public task preparation failed')
        run=out/'runtime';proc=subprocess.run([sys.executable,str(ROOT/'live_smoke.py'),'--input',str(task.resolve()),'--output',str(run.resolve()),'--rank-max-tokens',str(a.rank_max_tokens)],capture_output=True,text=True,env=env,timeout=420)
        (out/'process.log').write_text(proc.stdout+proc.stderr)
        if not (run/'result.json').exists():raise RuntimeError('runtime result missing')
        response=json.loads((run/'result.json').read_text());
        for f in run.glob('response-*.json'):shutil.copyfile(f,out/f.name)
        result.update(status=response['status'],model_request_count=response['model_requests'],model_stages_attempted=response['model_stages_attempted'],replayed_stages=response['replayed_stages'])
        if response.get('ordered_item_ids') is not None:result['ordered_item_ids']=response['ordered_item_ids']
        if response.get('error'):result['error']=response['error']
        if proc.returncode and result['status']=='submitted':raise RuntimeError('unexpected subprocess exit')
    except (RuntimeError,subprocess.SubprocessError) as e:result['error']=str(e)
    (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':result['status'],'context_id':result['context_id'],'model_requests':result['model_request_count'],'error':result.get('error')}))
    if result['status']!='submitted':raise SystemExit(1)
if __name__=='__main__':main()
