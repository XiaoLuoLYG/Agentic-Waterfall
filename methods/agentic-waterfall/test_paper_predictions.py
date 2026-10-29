import unittest
from paper_predictions import export_rows
class ExportTests(unittest.TestCase):
 def test_mind_and_kuai_formats(self):
  source={'context_id':'d','user_id':'12','candidates':[{'id':'a'},{'id':'b'}]}
  result={'status':'submitted','context_id':'d','method':'mars','ordered_item_ids':['b','a']}
  m=export_rows('mind',[(source,result)])[0];self.assertEqual(m['decision_id'],'d');self.assertEqual(m['ordered_item_ids'],['b','a'])
  k=export_rows('kuairec',[(source,result)])[0];self.assertEqual(k['user_id'],'12');self.assertEqual(k['acquired_item_ids'],['a','b'])
 def test_error_cause_is_preserved(self):
  source={'context_id':'d','user_id':'u','candidates':[{'id':'a'}]};result={'status':'failed','context_id':'d','method':'mars','error':'model_http_429'}
  self.assertEqual(export_rows('mind',[(source,result)])[0]['error'],'model_http_429')
 def test_failed_mind_is_preserved_for_evaluator_fallback(self):
  source={'context_id':'d','user_id':'u','candidates':[{'id':'a'}]};result={'status':'failed','context_id':'d','method':'mars'}
  self.assertEqual(export_rows('mind',[(source,result)])[0]['status'],'failed')
  with self.assertRaises(ValueError):export_rows('kuairec',[(source,result)])
 def test_refuses_mismatch_and_duplicate(self):
  source={'context_id':'d','user_id':'u','candidates':[{'id':'a'}]};result={'status':'submitted','context_id':'d','method':'mars','ordered_item_ids':['fake']}
  with self.assertRaises(ValueError):export_rows('mind',[(source,result)])
  result['ordered_item_ids']=['a'];
  with self.assertRaises(ValueError):export_rows('mind',[(source,result),(source,result)])
if __name__=='__main__':unittest.main()

class ReceiptTests(unittest.TestCase):
 def test_i2agent_replays_are_not_counted_as_new_calls(self):
  import json,tempfile
  from pathlib import Path
  from paper_predictions import load_receipts
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'response-01.json').write_text(json.dumps({'attempt_id':'old','status':'success'}));(p/'response-02.json').write_text(json.dumps({'attempt_id':'new','status':'success'}))
   receipts=load_receipts(p,{'replayed_stages':[1]});self.assertEqual([x['attempt_id'] for x in receipts],['new'])
