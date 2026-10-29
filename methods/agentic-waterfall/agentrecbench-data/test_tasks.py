import unittest
from tasks import check_entries,git_blob_id
class TaskListTests(unittest.TestCase):
 def test_pairs_numeric_task_and_private_label_without_reading_them(self):
  def e(name):return {'type':'file','path':name,'oid':'x','size':3}
  root='task/short_term/yelp/'
  a=[e(root+'tasks/task_0.json'),e(root+'tasks/task_1.json')];b=[e(root+'groundtruth/groundtruth_1.json'),e(root+'groundtruth/groundtruth_0.json')]
  self.assertEqual(check_entries('yelp',a,b),[0,1])
  with self.assertRaises(ValueError):check_entries('yelp',a,b[:1])
 def test_blob_hash(self):
  self.assertEqual(git_blob_id(b'hello\n'),'ce013625030ba8dba906f756967f9e9ca394464a')
if __name__=='__main__':unittest.main()
