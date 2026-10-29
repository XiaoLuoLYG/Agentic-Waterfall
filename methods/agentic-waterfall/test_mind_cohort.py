import unittest
from mind_cohort import split_samples
class CohortTests(unittest.TestCase):
 def sample(self,id,n):return {'observation':{'decision_id':id,'user_id':id,'behavior_events':[{'type':'click'}]*n,'environment':{'candidate_pool':[{'id':'a'}]}}}
 def test_partition_preserves_order_and_exposes_no_labels(self):
  s=[self.sample('a',2),self.sample('b',1),self.sample('c',0),self.sample('d',3)]
  yes,no=split_samples(s);self.assertEqual([x['observation']['decision_id'] for x in yes],['a','d']);self.assertEqual([(x['decision_id'],x['observed_click_count']) for x in no],[('b',1),('c',0)])
 def test_duplicate_ids_rejected(self):
  with self.assertRaises(ValueError):split_samples([self.sample('x',2),self.sample('x',1)])
if __name__=='__main__':unittest.main()
