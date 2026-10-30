import unittest
from adapter import run_i2agent
from test_adapter import sample


class MindRepairTests(unittest.TestCase):
    def test_repairs_invalid_rank_using_model_without_inventing_ids(self):
        values={'recommend_content':'choice','profile':'profile','knowledge':'knowledge',
                'dynamic_interest':'interest','dynamic_profile':'profile','explanation':['fixture']}
        ranks=[[1]*20, list(range(20,0,-1))]
        calls=[]
        def model(request):
            fields=request['response_format']['json_schema']['schema']['required'];calls.append(request)
            if 'rerank_list' in fields:
                return {'rerank_list':ranks.pop(0),'explanation':['fixture']}
            return {field:values[field] for field in fields}
        result=run_i2agent(sample(),model)
        self.assertEqual(result['ordered_indices'],list(range(20,0,-1)))
        self.assertEqual(len(calls),6)
        self.assertIn('duplicate', calls[-1]['messages'][-1]['content'].lower())
        self.assertNotIn('ground truth',str(calls[-1]).lower())

    def test_truncated_rank_can_be_retried_but_transport_failure_is_not(self):
        values={'recommend_content':'choice','profile':'profile','knowledge':'knowledge',
                'dynamic_interest':'interest','dynamic_profile':'profile'}
        attempts=[]
        def model(request):
            fields=request['response_format']['json_schema']['schema']['required'];attempts.append(fields)
            if 'rerank_list' not in fields:return {field:values[field] for field in fields}
            if sum('rerank_list' in x for x in attempts)==1:raise RuntimeError('model response truncated')
            return {'rerank_list':list(range(1,21)),'explanation':['ok']}
        self.assertEqual(len(run_i2agent(sample(),model)['ordered_indices']),20)
        self.assertEqual(len(attempts),6)
