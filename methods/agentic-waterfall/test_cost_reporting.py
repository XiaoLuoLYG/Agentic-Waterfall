import unittest
from cost_reporting import summarize_usage
class CostTests(unittest.TestCase):
 def test_aggregate_usage_without_inventing_price(self):
  r=summarize_usage([{'model_request_count':1,'model_calls':[{'attempt_id':'1','usage':{'prompt_tokens':3,'completion_tokens':2,'total_tokens':5},'duration_ms':100,'requested_model':'example'}]}])
  self.assertEqual(r['model_requests'],1);self.assertEqual(r['total_tokens'],5);self.assertEqual(r['model_call_duration_ms'],100);self.assertIsNone(r['monetary_cost']);self.assertEqual(r['missing_usage_calls'],0)
 def test_missing_is_not_zero_and_failed_calls_count(self):
  r=summarize_usage([{'model_request_count':1,'model_calls':[{'attempt_id':'failed','status':'failed'}]},{}])
  self.assertIsNone(r['model_requests']);self.assertIsNone(r['total_tokens']);self.assertEqual(r['missing_usage_calls'],1);self.assertEqual(r['rows_missing_request_count'],1)
if __name__=='__main__':unittest.main()
