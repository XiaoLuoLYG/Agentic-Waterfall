import json,unittest
from agentrecbench_data import prepare_from_tool
class FakeTool:
 def __init__(self):
  self.item_data={'a':{},'b':{},'h1':{},'h2':{},'z':{}}
 def get_item(self,item_id):
  if item_id=='b':return {'item_id':'b','title':'','description':'real text'}
  return {'item_id':item_id,'title':item_id,'description':'available'}
 def get_reviews(self,user_id):return [{'item_id':'h2','timestamp':None,'text':'second file row'}, {'item_id':'h1','timestamp':None,'text':'first time unknown'}]
class ProjectionTests(unittest.TestCase):
 def test_file_order_and_id_only_are_explicit(self):
  task,m=prepare_from_tool({'user_id':'u','candidate_list':['a','b']},FakeTool(),ordering='file',allow_id_only=True)
  self.assertEqual(task['asin'],['h2','h1']);self.assertEqual(m,{1:'a',2:'b'});self.assertEqual(json.loads(task['ranked_list_str'])[1]['title'],'b');self.assertEqual(json.loads(task['ranked_list_str'])[1]['description'],'real text')
 def test_timestamp_and_missing_metadata_do_not_silently_fallback(self):
  with self.assertRaises(ValueError):prepare_from_tool({'user_id':'u','candidate_list':['a','b']},FakeTool())
if __name__=='__main__':unittest.main()
