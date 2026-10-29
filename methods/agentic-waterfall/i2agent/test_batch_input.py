import unittest
from batch_run import public_view
class PublicViewTests(unittest.TestCase):
 def test_mind_projects_only_visible_candidates(self):
  x={'observation':{'decision_id':'d','user_id':'u','environment':{'candidate_pool':[{'id':'a','title':'Title','abstract':'Text','label':'SECRET'}]}}}
  p=public_view(x,'mind');self.assertEqual(p['candidates'],[{'id':'a','text':'Title\nText'}]);self.assertNotIn('SECRET',str(p))
 def test_kuairand_projects_and_rejects_duplicate(self):
  c={'id':'a','title':'Title','text':'Text'};x={'observation':{'decision_id':'d','user_id':'u','environment':{'candidate_pool':[c,c]}}}
  with self.assertRaisesRegex(ValueError,'duplicate'):public_view(x,'kuairand')
if __name__=='__main__':unittest.main()
