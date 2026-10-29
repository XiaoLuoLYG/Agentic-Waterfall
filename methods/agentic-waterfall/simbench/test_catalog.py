import unittest
from catalog import FrozenCatalog,SearchSession
class CatalogTests(unittest.TestCase):
 def setUp(self):
  self.docs=[{'id':'a','source':'bilibili','title':'摄影入门','text':'拍照技巧','url':'https://www.bilibili.com/a'}, {'id':'b','source':'zhihu','title':'摄影教程','text':'相机构图','url':'https://www.zhihu.com/b'}]
 def test_deterministic_search_is_source_bounded_and_real(self):
  c=FrozenCatalog(self.docs);s=SearchSession(c,['bilibili']);x=s.search('bilibili','摄影',2);self.assertEqual([a['id'] for a in x],['a']);self.assertEqual(s.searches,1)
  with self.assertRaisesRegex(ValueError,'source'):s.search('zhihu','摄影',1)
 def test_no_hidden_labels_or_fabricated_content(self):
  d=[dict(self.docs[0],ground_truth='secret')]
  with self.assertRaisesRegex(ValueError,'fields'):FrozenCatalog(d)
  with self.assertRaisesRegex(ValueError,'duplicate'):FrozenCatalog([self.docs[0],self.docs[0]])
 def test_publication_dates_are_preserved(self):
  d=[dict(self.docs[0],published_at='2026-01-01T00:00:00Z',captured_at='2026-10-29T00:00:00Z')]
  self.assertEqual(FrozenCatalog(d).records[0]['published_at'],'2026-01-01T00:00:00Z')
 def test_search_excludes_future_and_unknown_publication_dates(self):
  d=[dict(self.docs[0],published_at='2026-01-01T00:00:00Z'),dict(self.docs[1],source='bilibili',published_at='1800000000'),dict(self.docs[0],id='c',url='https://bilibili.com/c',published_at='')]
  c=FrozenCatalog(d);found=c.search('bilibili','摄影',10,as_of_ms=1769990400000);self.assertEqual([x['id'] for x in found],['a'])
 def test_search_budget_is_independent_per_session(self):
  c=FrozenCatalog(self.docs);a=SearchSession(c,['bilibili']);b=SearchSession(c,['bilibili'])
  for _ in range(10):a.search('bilibili','摄影',1)
  with self.assertRaisesRegex(ValueError,'budget'):a.search('bilibili','摄影',1)
  self.assertEqual(b.searches,0)
if __name__=='__main__':unittest.main()
