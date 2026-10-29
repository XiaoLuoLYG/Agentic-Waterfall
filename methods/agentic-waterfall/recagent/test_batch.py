import json,tempfile,unittest
from pathlib import Path
from batch import freeze_tasks,select_tasks
class BatchTests(unittest.TestCase):
 def test_fixes_sorted_task_ids_and_validates_schema(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)
   for i in (9,1): (p/f'task_{i}.json').write_text(json.dumps({'type':'recommendation','candidate_list':[str(x) for x in range(20)]}))
   m=freeze_tasks(p);self.assertEqual([x['task_id'] for x in m],[1,9]);self.assertTrue(all(len(x['sha256'])==64 for x in m))
 def test_select_explicit_cohort_without_reordering(self):
  tasks=[{'task_id':0},{'task_id':1},{'task_id':2}]
  self.assertEqual([x['task_id'] for x in select_tasks(tasks,[2,0])],[0,2])
  with self.assertRaises(ValueError):select_tasks(tasks,[99])
 def test_bad_candidate_set_fails(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'task_0.json').write_text(json.dumps({'type':'recommendation','candidate_list':['x']*20}))
   with self.assertRaises(ValueError):freeze_tasks(p)
if __name__=='__main__':unittest.main()
