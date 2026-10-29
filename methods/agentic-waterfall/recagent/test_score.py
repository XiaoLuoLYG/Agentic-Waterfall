import unittest
from score import safe_predictions,missing_summary
class ScoreTests(unittest.TestCase):
 def test_complete_ranking_kept_and_failure_retained(self):
  tasks=[{'task_id':0,'candidates':['a','b']},{'task_id':1,'candidates':['c','d']}]
  rows=[{'task_id':0,'status':'submitted','ordered_item_ids':['b','a']},{'task_id':1,'status':'failed'}]
  predictions,invalid=safe_predictions(tasks,rows);self.assertEqual(predictions,[['b','a'],[]]);self.assertEqual(invalid,[1])
 def test_invalid_duplicate_ranking_is_failure_not_dropped(self):
  p,b=safe_predictions([{'task_id':0,'candidates':['a','b']}],[{'task_id':0,'status':'submitted','ordered_item_ids':['a','a']}]);self.assertEqual(p,[[]]);self.assertEqual(b,[0])
 def test_missing_metadata_is_reported_not_silently_filled(self):
  r=missing_summary([{'missing_item_ids':['a','b'],'missing_user_ids':['u']},{'missing_item_ids':[],'missing_user_ids':[]}]);self.assertEqual(r['tasks_with_missing_items'],1);self.assertEqual(r['missing_item_occurrences'],2);self.assertEqual(r['tasks_with_missing_user'],1)
 def test_unrun_or_operational_failure_must_not_be_scored(self):
  tasks=[{'task_id':0,'candidates':['a']} ]
  with self.assertRaises(ValueError):safe_predictions(tasks,[])
  with self.assertRaises(ValueError):safe_predictions(tasks,[{'task_id':0,'status':'failed','error':'global_request_budget_exhausted'}])
 def test_duplicate_results_rejected(self):
  with self.assertRaises(ValueError):safe_predictions([{'task_id':0,'candidates':['a']}],[{'task_id':0},{'task_id':0}])
if __name__=='__main__':unittest.main()

class IntegrationTests(unittest.TestCase):
 def test_fake_labels_score_only_after_results_frozen(self):
  import hashlib,json,tempfile,sys
  from pathlib import Path
  from unittest.mock import patch
  import score
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);bench=root/'bench';(bench/'tasks').mkdir(parents=True);(bench/'groundtruth').mkdir();batch=root/'batch';batch.mkdir();entries=[]
   for i in range(2):
    raw=json.dumps({'candidate_list':[str(x) for x in range(20)]}).encode();(bench/'tasks'/f'task_{i}.json').write_bytes(raw);(bench/'groundtruth'/f'groundtruth_{i}.json').write_text(json.dumps({'ground truth':'0'}));entries.append({'task_id':i,'sha256':hashlib.sha256(raw).hexdigest()});run=batch/f'task-{i:06d}';run.mkdir();(run/'result.json').write_text(json.dumps({'task_id':i,'status':'submitted','ordered_item_ids':[str(x) for x in range(20)]}))
   (batch/'manifest.json').write_text(json.dumps({'domain':'amazon','tasks':entries}));out=root/'scores'
   with patch.object(score,'resolve_paths',return_value={'taskdir':bench}),patch.object(sys,'argv',['score','--batch',str(batch),'--output',str(out)]):score.main()
   r=json.loads((out/'metrics.json').read_text());self.assertEqual(r['tasks'],2);self.assertEqual(r['invalid_task_ids'],[]);self.assertTrue(r['labels_accessed_after_freeze']);self.assertFalse(json.loads((out/'frozen.json').read_text())['labels_accessed'])
