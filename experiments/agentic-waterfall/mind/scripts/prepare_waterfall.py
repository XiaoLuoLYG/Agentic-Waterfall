from pathlib import Path
import json,datetime,hashlib
root=Path(__file__).resolve().parents[1]
for split in ['validation','test']:
 inputs=[json.loads(l) for l in (root/f'data/prepared/{split}/inputs.jsonl').read_text().splitlines()]
 rows=[]
 for inp in inputs:
  # Original history has no per-click timestamps: preserve order and mark cutoff-relative availability, never invent event times.
  events=[{'id':f'{inp["decision_id"]}:history:{i}','type':'click','item_id':n['id'],'item':n,'history_position':i,'time_precision':'before_impression_no_exact_timestamp','source_channels':['behavior']} for i,n in enumerate(inp['history'])]
  o={'schema_version':'1.0','decision_id':inp['decision_id'],'user_id':inp['user_id'],'session_id':f'mind:{inp["user_id"]}','trigger':{'kind':'recommendation_request','dataset_time':inp['timestamp']},'dialogue':[],'behavior_events':events,'user_state':{'version':0,'records':[]},'environment':{'candidate_pool':inp['candidates'],'sources':[],'pending_queue':[],'visible_item_ids':[n['id'] for n in inp['history']],'content_version':'MINDsmall-2115068f-local-v1'}}
  rows.append({'observation':o,'protocol':{'mode':'fixed_candidates','top_k':len(inp['candidates']),'require_full_ranking':True,'max_model_calls':2,'max_tool_calls':0,'max_acquired_items':0,'max_output_tokens':4096},'run_meta':{'dataset':'MIND-small / local split','split':split,'stage':'subset','synthetic':False,'seed':20261029,'cutoff_time_basis':'dataset-naive; no timezone invented','expression_origin':'absent_in_dataset','profile_origin':'absent_in_dataset'}})
 dest=root/'data/waterfall';dest.mkdir(exist_ok=True)
 for name,rs in [(f'{split}-32.jsonl',rows),(f'{split}-smoke4.jsonl',rows[:4])]:
  (dest/name).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rs))
 print(split,'rows',len(rows),'max_input_bytes',max(len(json.dumps(r).encode()) for r in rows),'smoke4_candidates',[len(r['observation']['environment']['candidate_pool']) for r in rows[:4]])
