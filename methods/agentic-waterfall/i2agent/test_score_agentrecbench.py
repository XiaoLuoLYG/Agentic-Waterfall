import unittest
from score_agentrecbench import classify
class ScoreTests(unittest.TestCase):
 def test_not_applicable_excluded_and_failures_retained(self):
  records=[{'task_id':0,'status':'eligible'},{'task_id':1,'status':'not_applicable'},{'task_id':2,'status':'eligible'}]
  results={0:{'status':'submitted'},1:{'status':'not_applicable'},2:{'status':'failed'}}
  self.assertEqual(classify(records,results),([0,2],[1]))
  with self.assertRaises(ValueError):classify(records,{0:{'status':'submitted'},1:{'status':'not_applicable'}})
  with self.assertRaises(ValueError):classify(records,{0:{'status':'submitted'},1:{'status':'submitted'},2:{'status':'failed'}})
if __name__=='__main__':unittest.main()

class SyntheticScoringTest(unittest.TestCase):
 def test_shared_subset_is_frozen_before_labels(self):
  import tempfile,json,hashlib,sys
  from pathlib import Path
  from unittest.mock import patch
  import score_agentrecbench as s
  class Eval:
   def calculate_hr_at_n(self,labels,predictions,_):
    self.labels=labels
    return type('Metrics',(),{'__dict__':property(lambda x:{'hr_at_1':float(predictions[0][0]==labels[0])})})()
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);tasks=d/'tasks';gt=d/'groundtruth';tasks.mkdir();gt.mkdir();raw=json.dumps({'candidate_list':['a','b']}).encode();(tasks/'task_0.json').write_bytes(raw);(gt/'groundtruth_0.json').write_text(json.dumps({'ground truth':'a'}));digest=hashlib.sha256(raw).hexdigest()
   i=d/'i2';r=d/'rec';i.mkdir();r.mkdir();(i/'manifest.json').write_text(json.dumps({'domain':'amazon','records':[{'task_id':0,'status':'eligible','public_task_sha256':digest},{'task_id':1,'status':'not_applicable'}]}));(r/'manifest.json').write_text(json.dumps({'domain':'amazon','tasks':[{'task_id':0,'sha256':digest}]}))
   for folder,name,record in [(i,'task-000000',{'task_id':0,'status':'submitted','ordered_item_ids':['a','b']}),(i,'task-000001',{'task_id':1,'status':'not_applicable'}),(r,'task-000000',{'task_id':0,'status':'submitted','ordered_item_ids':['b','a']})]:
    q=folder/name;q.mkdir();(q/'result.json').write_text(json.dumps(record))
   out=d/'scores';fake=type('Components',(),{'RecommendationEvaluator':Eval})
   with patch.object(s,'resolve_paths',return_value={'taskdir':d}),patch.object(s,'load_components',return_value=fake),patch.object(s.sys,'argv',['score','--i2-batch',str(i),'--recagent-batch',str(r),'--output',str(out)]):s.main()
   self.assertEqual(json.loads((out/'frozen.json').read_text())['not_applicable_ids'],[1]);self.assertEqual(json.loads((out/'metrics.json').read_text())['eligible'],1)
