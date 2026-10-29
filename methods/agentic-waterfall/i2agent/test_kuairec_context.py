import unittest
from kuairec_data import prepare_kuairec
class BoundPoolTests(unittest.TestCase):
 def test_different_user_pool_is_rejected(self):
  sample={'observation':{'decision_id':'u1','dialogue':[],'behavior_events':[]}}
  with self.assertRaisesRegex(ValueError,'context mismatch'):
   prepare_kuairec(sample,{'context_id':'u2'},[])
if __name__=='__main__':unittest.main()
