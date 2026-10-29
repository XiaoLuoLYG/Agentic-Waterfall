import json,tempfile,unittest
from pathlib import Path
from build_evaluation import build
from prepare_evaluation import prepare
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'experiments/agentic-waterfall/clawrec/adapters'))
from shared_pool_metrics import score_pool
class EvaluationTest(unittest.TestCase):
 def test_synthetic_shared_pool_and_private_boundary(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);workspace='group_001__user_1';event=root/workspace/'event_01';p=event/'input';p.mkdir(parents=True);(event/'private').mkdir()
   (p/'evidence.visible.jsonl').write_text(json.dumps({'event':1,'step':1,'kind':'content_interest','context':{}})+'\n');(p/'allowed_sources.json').write_text('{}');(p/'budget.json').write_text('{}');(event/'private/hidden_step.jsonl').write_text(json.dumps({'event':1,'step':5})+'\n')
   data={'method':'fixture_unique_method','case_id':workspace+'__event_01','user_id':'1','event':1,'snapshot_sha256':'h','as_of_ms':2000000000000,'active_sources':['x']};res={'method':'fixture_unique_method','case_id':data['case_id'],'user_id':'1','event':1,'snapshot_sha256':'h','status':'submitted','acquired_ids':['i'],'ordered_item_ids':['i']};docs={'i':{'id':'i','source':'x','title':'title','text':'text','url':'https://example.org/i','published_at':'2020-01-01T00:00:00Z'}}
   ranks,catalog=prepare([(data,res)],docs);payload,mapping=build(root,workspace,1,ranks,catalog);self.assertEqual(len(payload['cards']),1);self.assertNotIn('fixture_unique_method',json.dumps(payload));self.assertEqual(score_pool(ranks,{'i':4})['scores']['fixture_unique_method']['hit_at_k'],1)
if __name__=='__main__':unittest.main()
