import unittest
from filter_predictions import select_predictions
class FilterTests(unittest.TestCase):
 def test_preserves_cohort_order_and_rejects_gaps(self):
  inputs=[{'observation':{'decision_id':'b'}},{'observation':{'decision_id':'a'}}]
  rows=[{'decision_id':'a','value':1},{'decision_id':'c'},{'decision_id':'b','value':2}]
  self.assertEqual([x['decision_id'] for x in select_predictions(inputs,rows)],['b','a'])
  with self.assertRaises(ValueError):select_predictions(inputs,rows[:2])
 def test_duplicate_predictions_rejected(self):
  with self.assertRaises(ValueError):select_predictions([{'observation':{'decision_id':'a'}}],[{'decision_id':'a'},{'decision_id':'a'}])
if __name__=='__main__':unittest.main()
