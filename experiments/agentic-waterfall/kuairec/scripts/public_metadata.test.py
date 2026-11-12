import json, pathlib, tempfile, unittest
from build_public_metadata import build_metadata
from retrieval import public_result

class PublicMetadataChecks(unittest.TestCase):
    def test_only_content_duration_from_big_is_published_with_deterministic_measurement(self):
        with tempfile.TemporaryDirectory() as d:
            path=pathlib.Path(d)/'big_matrix.csv'
            path.write_text('video_id,video_duration,watch_ratio,user_id\n1,1000,9,99\n1,1001,0,99\n1,1000,0,44\n2,4000,99,33\n2,3000,0,22\n')
            result=build_metadata(path)
            self.assertEqual(result['items'],{'1':{'duration_ms':1000.0},'2':{'duration_ms':3000.0}})
            self.assertNotIn('watch_ratio',json.dumps(result))
            self.assertNotIn('user_id',json.dumps(result))
    def test_shared_tool_projection_carries_scores_context_and_duration_only_for_returned_ids(self):
        result={'items':[{'id':'1','text':'caption','secret_label':1}], 'scores':{'1':7,'hidden':99}, 'evidence':{'backend':'hot_big_only','query':''},'actual_requests':1}
        out=public_result(result,{'items':{'1':{'duration_ms':1000.0}}})
        self.assertEqual(out['scores'],{'1':7})
        self.assertEqual(out['items'],[{'id':'1','source':'kuairec','source_id':'kuairec','content_type':'video','title':'','text':'caption','url':'','duration_ms':1000.0,'retrieval_score':7,'retrieval_backend':'hot_big_only','retrieval_query':''}])
        self.assertEqual(out['evidence'],[{'backend':'hot_big_only','query':''}])

if __name__=='__main__':unittest.main()
