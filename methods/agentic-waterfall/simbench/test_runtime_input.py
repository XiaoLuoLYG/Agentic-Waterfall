import unittest
from runtime_input import normalize_source,project_evidence
class InputTests(unittest.TestCase):
 def test_visible_only_and_no_future_fields(self):
  row={'kind':'content_interest','record_id':'e1','title':'public','platform':'www.xiaohongshu.com','ts_start_ms':10,'url':'https://x.test','ground_truth':'hidden'}
  out=project_evidence([row]);self.assertNotIn('ground_truth',out[0]);self.assertEqual(out[0]['platform'],'xiaohongshu')
 def test_forward_references_must_be_visible(self):
  rows=[{'kind':'search_intent','platform':'zhihu','context':{'next_content_keys':['visible','future']}},{'kind':'content_interest','platform':'zhihu','content_key':'visible'}]
  self.assertEqual(project_evidence(rows)[0]['context']['next_content_keys'],['visible'])
 def test_source_alias(self):self.assertEqual(normalize_source('www.xiaohongshu.com'),'xiaohongshu');self.assertEqual(normalize_source('zhihu'),'zhihu')
 def test_unknown_event_kind_rejected(self):
  with self.assertRaises(ValueError):project_evidence([{'kind':'private_target'}])
if __name__=='__main__':unittest.main()
