import json,tempfile,unittest
from pathlib import Path
from case_input import load_case
class CaseTests(unittest.TestCase):
 def test_only_visible_paths_and_case_identity(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'case'/'event_01';p=root/'input';p.mkdir(parents=True)
   (p/'manifest.json').write_text(json.dumps({'case_id':'c','user_id':'u','runtime_sequence':{'current_event_position':1}}));(p/'allowed_sources.json').write_text(json.dumps({'platforms':{'www.xiaohongshu.com':1}}));(p/'evidence.visible.jsonl').write_text(json.dumps({'event':1,'step':1,'kind':'content_interest','record_id':'r','title':'visible','platform':'xiaohongshu','ts_end_ms':1769990400000,'ground_truth':'SECRET'})+'\n')
   x=load_case(p);self.assertEqual(x['user_id'],'u');self.assertEqual(x['allowed_sources'],['xiaohongshu']);self.assertEqual(x['as_of_ms'],1769990400000);self.assertNotIn('SECRET',str(x))
   (p/'evidence.visible.jsonl').write_text(json.dumps({'event':1,'step':5,'kind':'content_interest','platform':'zhihu','ts_end_ms':1769990400000})+'\n')
   with self.assertRaises(ValueError):load_case(p)
   with self.assertRaises(ValueError):load_case(root)
if __name__=='__main__':unittest.main()
