"""Freeze IDs without inspecting labels, then export isolated inputs and truth."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,random,collections
ROOT=Path(__file__).resolve().parents[1]
SEED=20261029
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def dump(p,x):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def rows(path):
 for line in path.open():
  iid,uid,ts,hist,imps=line.rstrip('\n').split('\t')
  yield {'id':iid,'user':uid,'time':ts,'datetime':datetime.strptime(ts,'%m/%d/%Y %I:%M:%S %p'),'history':hist.split(),'impressions_raw':imps,'line':line}
def select(rs,split):
 first={}
 for r in rs:
  key=(r['datetime'],int(r['id']))
  if r['user'] not in first or key<(first[r['user']]['datetime'],int(first[r['user']]['id'])):first[r['user']]=r
 users=sorted(first,key=lambda u:digest(f'{SEED}:{split}-user:{u}'))[:32]
 return [first[u] for u in users]
train_all=list(rows(ROOT/'data/MINDsmall_train/behaviors.tsv'))
cut=sorted(r['datetime'] for r in train_all)[int(.8*len(train_all))]
train=[r for r in train_all if r['datetime']<cut]; validation=[r for r in train_all if r['datetime']>=cut]
test=list(rows(ROOT/'data/MINDsmall_dev/behaviors.tsv'))
selected={'validation':select(validation,'validation'),'test':select(test,'test')}
train_small=sorted(train,key=lambda r:digest(f'{SEED}:train-impression:{r["id"]}'))[:4096]
# The sample IDs are written before any label is decoded.
ids={'protocol_sha256':hashlib.sha256((ROOT/'config/protocol-v1.json').read_bytes()).hexdigest(),'frozen_at':datetime.now(timezone.utc).isoformat(),'seed':SEED,'cutoff_dataset_time':cut.isoformat(),'train_impressions':len(train),'validation_impressions':len(validation),'test_impressions':len(test),'training_subset_ids':[r['id'] for r in train_small],'selected':{s:[{'id':r['id'],'user':r['user'],'time':r['time']} for r in rs] for s,rs in selected.items()}}
dump(ROOT/'config/frozen-sample-ids.json',ids)
news={}
for split in ['train','dev']:
 for line in (ROOT/f'data/MINDsmall_{split}/news.tsv').open():
  f=line.rstrip('\n').split('\t'); record={'id':f[0],'category':f[1],'subcategory':f[2],'title':f[3],'abstract':f[4]}
  if f[0] in news:assert news[f[0]]==record
  news[f[0]]=record
fit_ids=set();pop=collections.Counter()
for r in train:
 fit_ids.update(r['history'])
 for imp in r['impressions_raw'].split():
  nid,label=imp.rsplit('-',1);fit_ids.add(nid)
  if label=='1':pop[nid]+=1
assert fit_ids <= news.keys()
dump(ROOT/'data/prepared/training_statistics.json',{'popularity':pop,'content_fit_ids':sorted(fit_ids),'source':'local_train_only'})
dump(ROOT/'data/prepared/news.json',news)
for s,rs in selected.items():
 inputs=[];truth=[]; counts=[]
 for r in rs:
  original=[x.rsplit('-',1)[0] for x in r['impressions_raw'].split()]
  shuffled=original[:];random.Random(int(digest(f'{SEED}:candidates:{r["id"]}'),16)).shuffle(shuffled)
  assert len(original)==len(set(original));assert set(original+r['history'])<=news.keys()
  inp={'decision_id':f'mind:{s}:{r["id"]}','impression_id':r['id'],'user_id':r['user'],'timestamp':r['time'],'expression':[],'profile':{},'history':[news[x] for x in r['history']],'candidates':[news[x] for x in shuffled],'constraints':{'fixed_candidate_mode':True,'require_all_candidates':True,'external_acquisition':False}}
  assert not any(k in json.dumps(inp) for k in ['impressions_raw','click_label','evaluation_private'])
  inputs.append(inp); counts.append(len(original))
  truth.append({'impression_id':r['id'],'original_candidate_ids':original,'labels':[int(x.rsplit('-',1)[1]) for x in r['impressions_raw'].split()]})
 dest=ROOT/f'data/prepared/{s}';dest.mkdir(parents=True,exist_ok=True)
 with (dest/'inputs.jsonl').open('w') as f:
  for inp in inputs:f.write(json.dumps(inp,ensure_ascii=False)+'\n')
 dump(ROOT/f'data/evaluation_private/{s}.json',truth)
 with (ROOT/f'data/evaluation_private/{s}.truth.txt').open('w') as f:
  for t in truth:f.write(t['impression_id']+' '+json.dumps(t['labels'],separators=(',',':'))+'\n')
 ids[s+'_candidate_counts']={'min':min(counts),'max':max(counts),'total':sum(counts)}
 # Baseline trainer can validate on original local validation only, never local test.
 if s=='validation':(dest/'behaviors.tsv').write_text(''.join(r['line'] for r in rs))
for name,rs in [('local_train',train),('nrms_train_subset',train_small)]:
 dest=ROOT/f'data/prepared/{name}';dest.mkdir(parents=True,exist_ok=True);(dest/'behaviors.tsv').write_text(''.join(r['line'] for r in rs))
ids.update(news_count=len(news),content_fit_news_count=len(fit_ids),train_max_time=max(r['datetime'] for r in train).isoformat(),validation_min_time=min(r['datetime'] for r in validation).isoformat(),test_min_time=min(r['datetime'] for r in test).isoformat(),exit_code=0)
dump(ROOT/'results/split-summary.json',ids)
print(json.dumps({k:v for k,v in ids.items() if k not in ['training_subset_ids','selected']},indent=2))
