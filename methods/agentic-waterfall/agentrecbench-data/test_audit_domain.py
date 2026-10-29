import unittest
from audit_domain import audit_task
class Fake:
 blocked={('u','a')}
 def get_user(self,user_id):return {'user_id':user_id}
 def get_item(self,item_id):return {'item_id':item_id}
 def get_reviews(self,user_id=None,item_id=None):return [{'user_id':'u','item_id':'b','review_id':'r'}]
class AuditTests(unittest.TestCase):
 def test_detects_missing_records(self):
  task={'user_id':'u','candidate_list':['a','b']};self.assertEqual(audit_task(task,Fake()),[])
  t=Fake();t.get_item=lambda item_id:None;self.assertIn('missing_item',audit_task(task,t))
 def test_detects_blocked_pair_leak(self):
  t=Fake();t.get_reviews=lambda **kw:[{'user_id':'u','item_id':'a','review_id':'secret'}]
  self.assertIn('blocked_review',audit_task({'user_id':'u','candidate_list':['a']},t))
if __name__=='__main__':unittest.main()
