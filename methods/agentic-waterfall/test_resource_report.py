import json,tempfile,unittest
from pathlib import Path
from resource_report import collect_runs
class ResourceTests(unittest.TestCase):
 def test_deduplicates_and_excludes_replayed_responses(self):
  with tempfile.TemporaryDirectory() as t:
   a=Path(t)/'a';b=Path(t)/'b';a.mkdir();b.mkdir()
   receipt={'attempt_id':'x','status':'success','requested_model':'m','usage':{'prompt_tokens':2,'completion_tokens':1,'total_tokens':3},'duration_ms':7}
   for f in (a/'response-01.json',b/'response-01.json'):f.write_text(json.dumps(receipt))
   (a/'result.json').write_text(json.dumps({'status':'submitted'}));(b/'result.json').write_text(json.dumps({'status':'submitted','replayed_stages':[1]}))
   report=collect_runs([a,b]);self.assertEqual(report['resource_usage']['model_requests'],1);self.assertEqual(report['resource_usage']['total_tokens'],3);self.assertEqual(report['replayed_receipts'],1)
if __name__=='__main__':unittest.main()
