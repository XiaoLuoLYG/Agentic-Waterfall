import unittest
from live_smoke import convert_request

class RequestTest(unittest.TestCase):
    def test_compact_explanation_only_changes_rank_request_when_enabled(self):
        rank={'messages':[{'role':'assistant','content':'rank'}], 'response_format':{'json_schema':{'schema':{'required':['rerank_list'],'properties':{}}}}}
        default=convert_request(rank,4096)
        compact=convert_request(rank,8192,True)
        self.assertNotIn('one concise summary',default['messages'][0]['content'])
        self.assertIn('one concise summary',compact['messages'][0]['content'])
        self.assertEqual(compact['max_tokens'],8192)
        other={'messages':[{'role':'assistant','content':'state'}], 'response_format':{'json_schema':{'schema':{'required':['state'],'properties':{}}}}}
        self.assertNotIn('one concise summary',convert_request(other,8192,True)['messages'][0]['content'])
