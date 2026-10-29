import unittest
from kuairec_batch import prediction
class PredictionTest(unittest.TestCase):
 def test_success_and_failed_are_both_in_denominator(self):
  searches=[{'output':{'items':[{'id':'a'},{'id':'b'}]}}]
  row=prediction('1','clawrec',{'status':'submitted','ordered_item_ids':['b']},searches)
  self.assertEqual(row['ordered_item_ids'],['b']);self.assertEqual(row['acquired_item_ids'],['a','b'])
  self.assertEqual(prediction('2','clawrec',{'status':'failed'},[])['ordered_item_ids'],[])
  with self.assertRaises(ValueError):prediction('1','clawrec',{'status':'submitted','ordered_item_ids':['bad']},searches)
if __name__=='__main__':unittest.main()
