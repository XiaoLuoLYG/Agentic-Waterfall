import unittest
from freeze_catalog import freeze
class FreezeTests(unittest.TestCase):
 def test_canonical_order_and_source_counts(self):
  d=[{'id':'b','source':'zhihu','title':'B','text':'b','url':'https://zhihu.com/b'},{'id':'a','source':'bilibili','title':'A','text':'a','url':'https://bilibili.com/a'}]
  raw,manifest=freeze(d);self.assertEqual(manifest['count'],2);self.assertEqual(manifest['sources'],{'bilibili':1,'zhihu':1});self.assertLess(raw.index(b'"a"'),raw.index(b'"b"'))
 def test_rejects_private_fields(self):
  with self.assertRaises(ValueError):freeze([{'id':'a','source':'x','title':'a','text':'','url':'https://x.test/a','target':'hidden'}])
if __name__=='__main__':unittest.main()
