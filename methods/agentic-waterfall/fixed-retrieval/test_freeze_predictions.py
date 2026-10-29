import unittest
from freeze_predictions import validate
class FreezeTests(unittest.TestCase):
 def test_complete_and_unique_users_required(self):
  manifest={'user_ids':['1','2']};rows=[{'user_id':'1','status':'submitted'},{'user_id':'2','status':'submitted'}]
  validate(manifest,rows)
  with self.assertRaises(ValueError):validate(manifest,rows[:1])
  with self.assertRaises(ValueError):validate(manifest,[rows[0],rows[0]])
if __name__=='__main__':unittest.main()
