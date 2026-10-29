import unittest
from agentrecbench_batch import task_ids
class BatchTests(unittest.TestCase):
 def test_selection_preserves_official_order(self):
  self.assertEqual(task_ids([0,1,2],[2,0]),[0,2])
  with self.assertRaises(ValueError):task_ids([0,1],[0,0])
  with self.assertRaises(ValueError):task_ids([0,1],[7])
if __name__=='__main__':unittest.main()
