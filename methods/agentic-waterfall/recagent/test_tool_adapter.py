import unittest
from tool_adapter import MissingItemAdapter
class Fake:
 def get_item(self,item_id=None):return {'item_id':item_id,'name':'Known'} if item_id=='a' else None
 def get_user(self,user_id):return None
 def get_reviews(self,**kwargs):return []
class ToolTests(unittest.TestCase):
 def test_missing_item_has_only_observed_id_and_is_recorded(self):
  t=MissingItemAdapter(Fake());self.assertEqual(t.get_item('a')['name'],'Known');self.assertEqual(t.get_item('b'),{'item_id':'b'});self.assertEqual(t.missing_item_ids,['b']);self.assertEqual(t.get_user('u'),{'user_id':'u'});self.assertEqual(t.missing_user_ids,['u']);self.assertEqual(t.get_reviews(user_id='u'),[])
 def test_repeated_missing_id_is_not_double_counted(self):
  t=MissingItemAdapter(Fake());t.get_item('b');t.get_item('b');self.assertEqual(t.missing_item_ids,['b'])
if __name__=='__main__':unittest.main()
