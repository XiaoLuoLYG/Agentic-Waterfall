import json,tempfile,unittest
from pathlib import Path
from indexed_tool import build_index,IndexedTool
class IndexTests(unittest.TestCase):
 def test_indexed_queries_match_official_mask_on_synthetic_data(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);data=root/'data';data.mkdir();task=root/'task';(task/'tasks').mkdir(parents=True);(task/'groundtruth').mkdir()
   rows={'user':[{'user_id':'u','name':'x'}],'item':[{'item_id':'a','title':'a'},{'item_id':'b','title':'b'}],'review':[{'review_id':'r1','user_id':'u','item_id':'a','text':'hidden'},{'review_id':'r2','user_id':'u','item_id':'b','text':'visible'}]}
   for k,v in rows.items():(data/(k+'.json')).write_text(''.join(json.dumps(x)+'\n' for x in v))
   (task/'tasks/task_0.json').write_text(json.dumps({'type':'recommendation','user_id':'u','candidate_list':['a','b']}));(task/'groundtruth/groundtruth_0.json').write_text(json.dumps({'ground truth':'a'}))
   idx=root/'index.sqlite';build_index(data,idx);tool=IndexedTool(data,idx,task)
   import sys
   scripts=Path(__file__).resolve().parents[3]/'experiments/agentic-waterfall/agentrecbench/scripts';sys.path.insert(0,str(scripts))
   from official_components import load_components
   official=load_components().InteractionTool(str(data),str(task))
   self.assertEqual(tool.get_user('u'),official.get_user('u'));self.assertEqual(tool.get_item('a'),official.get_item('a'))
   for kwargs in ({'user_id':'u'},{'item_id':'a'},{'item_id':'b'},{'review_id':'r1'},{'review_id':'r2'}):self.assertEqual(tool.get_reviews(**kwargs),official.get_reviews(**kwargs))
   self.assertEqual(tool.get_user('u')['name'],'x');self.assertEqual(tool.get_item('b')['title'],'b');self.assertEqual([x['review_id'] for x in tool.get_reviews(user_id='u')],['r2']);self.assertEqual(tool.get_reviews(review_id='r1'),[]);self.assertEqual(tool.get_reviews(item_id='b')[0]['text'],'visible');tool.close()
 def test_index_cannot_overwrite_existing(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'index.sqlite';p.write_text('preserve')
   with self.assertRaises(FileExistsError):build_index(Path(t),p)
if __name__=='__main__':unittest.main()
