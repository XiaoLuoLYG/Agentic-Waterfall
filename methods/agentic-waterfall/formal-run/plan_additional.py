"""Freeze the remaining non-training benchmark tasks without reading scoring labels."""
import json,hashlib
from collections import defaultdict,Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];B=ROOT/'formal';groups=[]
def add(name,items):groups.append({'name':name,'items':items})
def main():
 counts=Counter()
 for domain in ('amazon','yelp','goodreads'):
  for method in ('recagent','i2agent'):
   base=B/'agentrecbench'/domain/method;m=json.loads((base/'manifest.json').read_text());rows=m['tasks'] if method=='recagent' else m['records'];items=[]
   for x in rows:
    if method=='i2agent' and x['status']=='not_applicable':counts['agentrecbench_not_applicable']+=1;continue
    items.append({'kind':'agentrecbench','method':method,'domain':domain,'task_id':x['task_id'],'entry':x})
   add(f'agentrecbench/{domain}/{method}',items);counts['agentrecbench_applicable']+=len(items)
 for method in ('clawrec','generic-agent'):
  m=json.loads((B/'simbench'/method/'manifest.json').read_text());users=defaultdict(list)
  for row in m['cases']:users[row['user_id']].append(row)
  for user,events in users.items():
   if [e['event'] for e in events]!=[1,2,3,4,5]:raise ValueError('invalid event sequence')
  add('simbench/'+method,[{'kind':'simbench_sequence','method':method,'user_id':user,'events':events} for user,events in users.items()]);counts['simbench_cases']+=len(m['cases'])
 for split in ('dev','test'):
  for method in ('clawrec','generic-agent'):
   m=json.loads((B/'kuairec'/split/method/'manifest.json').read_text());items=[{'kind':'kuairec','method':method,'split':split,'entry':row} for row in m['records']];add(f'kuairec/{split}/{method}',items);counts['kuairec_cases']+=len(items)
 result={'schema':'additional-agent-jobs-v1','groups':groups,'counts':dict(counts),'training':False,'recommendation_reads_labels':False,'simbench_failure':'failed event retained; later events for that user/method marked blocked, not fabricated','i2agent_inapplicable':'retain separately; compare on matched applicable tasks'}
 path=B/'additional-plan.json';raw=(json.dumps(result,ensure_ascii=False,sort_keys=True)+'\n').encode()
 if path.exists():
  if path.read_bytes()!=raw:raise ValueError('planned tasks changed')
 else:path.write_bytes(raw)
 print(json.dumps({'groups':len(groups),'counts':dict(counts),'sha256':hashlib.sha256(raw).hexdigest()}))
if __name__=='__main__':main()
