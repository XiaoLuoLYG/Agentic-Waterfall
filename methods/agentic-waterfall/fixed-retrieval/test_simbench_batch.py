import unittest
from simbench_batch import eligible_records,query_from_evidence
class SimbenchTests(unittest.TestCase):
 def test_only_active_sources_and_known_past_dates(self):
  docs=[{'id':'old','source':'x','published_at':'2020-01-01T00:00:00Z'},{'id':'future','source':'x','published_at':'2030-01-01T00:00:00Z'},{'id':'unknown','source':'x'},{'id':'other','source':'y','published_at':'2020-01-01T00:00:00Z'}]
  self.assertEqual(eligible_records(docs,['x'],1800000000000),['old'])
 def test_query_uses_public_text_only(self):
  self.assertEqual(query_from_evidence([{'title':'one','normalized_query':'two','hidden':'secret'}]),'one two')
if __name__=='__main__':unittest.main()
