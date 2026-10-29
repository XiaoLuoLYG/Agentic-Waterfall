import unittest
from mind_comparison import validate_predictions, rank_lines
class CompareTests(unittest.TestCase):
 def test_freeze_full_same_inputs_and_order(self):
  inputs=[{'observation':{'decision_id':'mind:test:1','user_id':'u','environment':{'candidate_pool':[{'id':'a'},{'id':'b'},{'id':'c'}]}}}]
  methods={'one':[{'decision_id':'mind:test:1','status':'submitted','ordered_item_ids':['c','a','b']}], 'two':[{'decision_id':'mind:test:1','status':'failed','ordered_item_ids':[]}]}
  fixed=validate_predictions(inputs,methods);truth={'1':{'ids':['a','b','c'],'labels':[1,0,1]}}
  _,prediction,invalid=rank_lines(inputs,fixed['one'],truth);self.assertEqual(prediction,'1 [2,3,1]\n');self.assertEqual(invalid,[])
  _,prediction,invalid=rank_lines(inputs,fixed['two'],truth);self.assertEqual(prediction,'1 [1,1,1]\n');self.assertEqual(invalid,['mind:test:1'])
 def test_baseline_without_status_is_accepted(self):
  inputs=[{'observation':{'decision_id':'x:1','user_id':'u','environment':{'candidate_pool':[{'id':'a'},{'id':'b'}]}}}]
  fixed=validate_predictions(inputs,{'baseline':[{'decision_id':'x:1','ordered_item_ids':['a','b']}]})
  self.assertEqual(rank_lines(inputs,fixed['baseline'],{'1':{'ids':['a','b'],'labels':[1,0]}})[2],[])
 def test_refuses_operational_interruption_before_label_access(self):
  inputs=[{'observation':{'decision_id':'d','user_id':'u','environment':{'candidate_pool':[{'id':'a'}]}}}]
  with self.assertRaises(ValueError):validate_predictions(inputs,{'x':[{'decision_id':'d','status':'failed','error':'model_http_429'}]})
 def test_refuses_missing_or_duplicate_output(self):
  inputs=[{'observation':{'decision_id':'d','user_id':'u','environment':{'candidate_pool':[{'id':'a'}]}}}]
  with self.assertRaises(ValueError):validate_predictions(inputs,{'x':[]})
  with self.assertRaises(ValueError):validate_predictions(inputs,{'x':[{'decision_id':'d'},{'decision_id':'d'}]})
if __name__=='__main__':unittest.main()
