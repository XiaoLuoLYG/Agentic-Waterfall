import unittest
from kuairec_batch import history_query
class QueryTests(unittest.TestCase):
 def test_only_last_twenty_long_views(self):
  events=[{'payload':{'watch_ratio':3,'item_text':str(i)}} for i in range(25)]+[{'payload':{'watch_ratio':1,'item_text':'ignored'}}]
  q=history_query(events);self.assertEqual(q,' '.join(str(i) for i in range(5,25)));self.assertNotIn('ignored',q)
 def test_no_positive_is_empty(self):self.assertEqual(history_query([{'payload':{'watch_ratio':1,'item_text':'not positive'}}]),'')
if __name__=='__main__':unittest.main()
