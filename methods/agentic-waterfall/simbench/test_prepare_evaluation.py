import unittest
from prepare_evaluation import prepare
class PrepareTest(unittest.TestCase):
 def test_refuses_wrong_case_and_unacquired_items(self):
  data={'method':'a','case_id':'x','user_id':'u','event':1,'snapshot_sha256':'h','as_of_ms':2000000000000,'active_sources':['x']}
  result={'method':'a','case_id':'x','user_id':'u','event':1,'snapshot_sha256':'h','status':'submitted','acquired_ids':['one'],'ordered_item_ids':['one']}
  docs={'one':{'id':'one','source':'x','title':'a','text':'b','url':'https://example.com/a','published_at':'2020-01-01T00:00:00+00:00'}}
  ranks,catalog=prepare([(data,result)],docs);self.assertEqual(ranks,{'a':['one']});self.assertEqual(catalog['one']['source_id'],'x')
  failed={**result,'status':'failed','ordered_item_ids':[],'acquired_ids':[]};self.assertEqual(prepare([(data,failed)],docs)[0],{'a':[]})
  with self.assertRaises(ValueError):prepare([(data,{**failed,'error':'global_request_budget_exhausted'})],docs)
  with self.assertRaises(ValueError):prepare([(data,{**failed,'error':'local_inference_failed'})],docs)
  with self.assertRaises(ValueError):prepare([(data,{**failed,'error':'model_calls_not_enabled'})],docs)
  with self.assertRaises(ValueError):prepare([(data,{**result,'ordered_item_ids':['bad']})],docs)
  with self.assertRaises(ValueError):prepare([(data,{**result,'case_id':'other'})],docs)
if __name__=='__main__':unittest.main()
