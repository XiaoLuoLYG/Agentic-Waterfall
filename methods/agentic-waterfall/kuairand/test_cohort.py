import unittest
from cohort import split_tasks
class CohortTests(unittest.TestCase):
 def test_eligibility_uses_only_positive_public_history(self):
  def row(i,h):return {'observation':{'decision_id':i,'behavior_events':[{'payload':{'long_view':v}} for v in h]}}
  selected,excluded=split_tasks([row('a',[1,1,0]),row('b',[1,0])]);self.assertEqual([x['observation']['decision_id'] for x in selected],['a']);self.assertEqual(excluded[0]['task_id'],'b')
if __name__=='__main__':unittest.main()
