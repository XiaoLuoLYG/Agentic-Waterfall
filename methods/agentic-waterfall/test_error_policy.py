import unittest
from error_policy import operational_failure
class ErrorPolicyTests(unittest.TestCase):
 def test_infrastructure_and_invalid_model_output_are_distinct(self):
  self.assertTrue(operational_failure({'status':'failed','error':'model_http_429'}))
  self.assertTrue(operational_failure({'status':'failed','error':'global_request_budget_exhausted'}))
  self.assertFalse(operational_failure({'status':'failed','error':'invalid candidate permutation'}))
if __name__=='__main__':unittest.main()
