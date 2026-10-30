import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
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


class RankingCorrectionTest(unittest.TestCase):
    def run_task(self, rankings):
        from live_smoke import main
        from test_adapter import sample
        task=sample()
        values={'recommend_content':'choice','profile':'profile','knowledge':'knowledge',
                'dynamic_interest':'interest','dynamic_profile':'profile','explanation':['fixture']}
        requests=[]
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp); source=folder/'input.json'; out=folder/'run'
            source.write_text(json.dumps({'source':'AgentRecBench amazon short_term','task_id':69,
                                         'task':task,'candidate_id_by_index':{str(i):f'item-{i}' for i in range(1,21)}}))
            def transport(cmd, **_):
                request=json.loads(Path(cmd[cmd.index('--request')+1]).read_text());requests.append(request)
                if len(requests)<5:
                    schema=json.loads(request['messages'][0]['content'].split('schema: ',1)[1].split('. Treat item text',1)[0])
                    content={field:values[field] for field in schema['required']}
                else:
                    content={'rerank_list':rankings[min(len(requests)-5,len(rankings)-1)],'explanation':['fixture']}
                Path(cmd[cmd.index('--output')+1]).write_text(json.dumps({'status':'success','attempt_id':f'call-{len(requests)}','finish_reason':'stop','content':json.dumps(content),'usage':{'prompt_tokens':10,'completion_tokens':10}}))
                return SimpleNamespace(returncode=0,stdout='',stderr='')
            with patch('sys.argv',['live_smoke','--input',str(source),'--output',str(out)]), patch('live_smoke.subprocess.run',side_effect=transport), contextlib.redirect_stdout(io.StringIO()):
                try:main()
                except SystemExit as error:self.assertEqual(error.code,1)
            result=json.loads((out/'result.json').read_text())
            receipts=[json.loads(path.read_text()) for path in sorted(out.glob('response-*.json'))]
        return result,requests,receipts

    def test_partial_recorded_rankings_get_two_corrections_inside_five_author_stages(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/ranking-format-failures.json').read_text())
        partial=[x['rerank_list'] for x in fixture['responses']]
        result,requests,receipts=self.run_task(partial+[list(range(20,0,-1))])
        self.assertEqual(result['status'],'submitted')
        self.assertEqual(result['ordered_item_ids'],[f'item-{i}' for i in range(20,0,-1)])
        self.assertEqual(result['model_stages_attempted'],5)
        self.assertEqual(result['model_requests'],7)
        self.assertEqual(len(receipts),7)
        self.assertEqual(json.loads(receipts[4]['content'])['rerank_list'],[12,13,15,8,5,17,9,6,14,1])
        self.assertIn('missing indices: [2, 3, 4, 7, 10, 11, 16, 18, 19, 20]',requests[5]['messages'][-1]['content'])
        self.assertIn('from 1 to 20',requests[5]['messages'][-1]['content'])

    def test_valid_first_ranking_keeps_the_initial_request_and_five_calls(self):
        result,requests,receipts=self.run_task([list(range(20,0,-1))])
        self.assertEqual(result['status'],'submitted')
        self.assertEqual(result['model_requests'],5)
        self.assertEqual(result['model_stages_attempted'],5)
        self.assertEqual(len(receipts),5)
        self.assertEqual(requests[4]['messages'][-1]['role'],'user')
        self.assertNotIn('Correct the previous output',requests[4]['messages'][-1]['content'])

    def test_persistent_partial_ranking_stops_without_filling_missing_indices(self):
        result,requests,receipts=self.run_task([[1]*20])
        self.assertEqual(result['status'],'failed')
        self.assertEqual(result['error'],'ValueError: invalid ranking')
        self.assertNotIn('ordered_item_ids',result)
        self.assertEqual(len(receipts),7)
        self.assertIn('duplicate indices: [1]',requests[5]['messages'][-1]['content'])

    def test_noninteger_indices_are_rejected_and_transport_errors_are_not_retried(self):
        from live_smoke import request_ranking
        request={'messages':[{'role':'user','content':'rank'}]}
        replies=iter([{'rerank_list':[True,2]},{'rerank_list':[2,1]}])
        self.assertEqual(request_ranking(request,[1,2],lambda _:next(replies))['rerank_list'],[2,1])
        self.assertEqual(request,{'messages':[{'role':'user','content':'rank'}]})
        calls=[]
        def fail(current):
            calls.append(current)
            raise RuntimeError('transport unavailable')
        with self.assertRaisesRegex(RuntimeError,'transport unavailable'):
            request_ranking(request,[1,2],fail)
        self.assertEqual(len(calls),1)
