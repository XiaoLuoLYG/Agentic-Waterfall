import unittest
from bench_paths import resolve_paths
class PathTests(unittest.TestCase):
 def test_defaults_preserve_original_amazon_short(self):
  x=resolve_paths('amazon',False);self.assertTrue(str(x['taskdir']).endswith('/data/task/short_term/amazon'));self.assertTrue(str(x['data']).endswith('/data/amazon-short'))
 def test_other_domains_require_index_and_fully_downloaded_tasks(self):
  x=resolve_paths('yelp',True);self.assertTrue(str(x['taskdir']).endswith('/task-full/short_term/yelp'));self.assertTrue(str(x['data']).endswith('/agentrecbench/yelp-short'));self.assertTrue(x['requires_index'])
 def test_unknown_domain_rejected(self):
  with self.assertRaises(ValueError):resolve_paths('unknown',True)
if __name__=='__main__':unittest.main()
