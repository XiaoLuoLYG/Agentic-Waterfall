import unittest
from live_smoke import convert_request, normalize_compact_explanation

class RequestTest(unittest.TestCase):
    def test_compact_explanation_only_changes_rank_request_when_enabled(self):
        rank={'messages':[{'role':'assistant','content':'rank'}], 'response_format':{'json_schema':{'schema':{'required':['rerank_list'],'properties':{}}}}}
        default=convert_request(rank,4096)
        compact=convert_request(rank,8192,True)
        self.assertNotIn('a concise summary',default['messages'][0]['content'])
        self.assertIn('a concise summary',compact['messages'][0]['content'])
        self.assertEqual(compact['max_tokens'],8192)
        other={'messages':[{'role':'assistant','content':'state'}], 'response_format':{'json_schema':{'schema':{'required':['state'],'properties':{}}}}}
        self.assertNotIn('a concise summary',convert_request(other,8192,True)['messages'][0]['content'])

    def test_string_explanation_normalization_preserves_ranking(self):
        value={'rerank_list':[2,1],'explanation':'summary'}
        self.assertEqual(normalize_compact_explanation(value,True),{'rerank_list':[2,1],'explanation':['summary']})
        unchanged={'rerank_list':[2,1],'explanation':'summary'}
        self.assertEqual(normalize_compact_explanation(unchanged,False),unchanged)
