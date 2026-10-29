import unittest
from batch_public import make_manifest
class BatchTests(unittest.TestCase):
 def test_batch_preserves_frozen_order_and_estimates_calls(self):
  samples=[{'observation':{'decision_id':'d1','environment':{'candidate_pool':[{'id':str(i)} for i in range(11)]}}},{'observation':{'decision_id':'d2','environment':{'candidate_pool':[{'id':'a'}]}}}]
  m=make_manifest(samples,'mars','mind','abc');self.assertEqual(m['task_ids'],['d1','d2']);self.assertEqual(m['max_expected_calls'],7)
 def test_clawrec_fixed_batch_estimates_two_calls_per_sample(self):
  x={'observation':{'decision_id':'x','environment':{'candidate_pool':[{'id':'a'}]}}}
  self.assertEqual(make_manifest([x],'clawrec','mind','h')['max_expected_calls'],2)
 def test_i2agent_five_stage_call_estimate(self):
  x={'observation':{'decision_id':'x','environment':{'candidate_pool':[{'id':'a'}]}}}
  self.assertEqual(make_manifest([x],'i2agent','mind','h')['max_expected_calls'],5)
 def test_duplicate_decision_rejected(self):
  x={'observation':{'decision_id':'same','environment':{'candidate_pool':[{'id':'a'}]}}}
  with self.assertRaises(ValueError):make_manifest([x,x],'recbot','mind','abc')
if __name__=='__main__':unittest.main()
