import unittest
from adapter import run_i2agent, prepare_task


def sample():
    return {'instruction':'synthetic instruction', 'title':['old','recent'],
            'description':['old description','recent description'], 'asin':['h1','h2'],
            'reviewText':['first review','second review'], 'neg_sample_title':'historical alternative',
            'neg_sample_descript':'historical alternative description', 'answer':None,
            'ranked_list_str':'synthetic items', 'pure_ranked_list':list(range(1,21))}


class AdapterTest(unittest.TestCase):
    def test_real_data_projection_excludes_extra_fields_and_keeps_candidate_mapping(self):
        history=[{'id':'h1','title':'first','description':'old','review':'good'},
                 {'id':'h2','title':'second','description':'new','review':'liked'}]
        candidates=[{'id':'a','title':'A','description':'one','ground truth':'SECRET'},
                    {'id':'b','title':'B','description':'two'}]
        task, mapping=prepare_task(history,candidates,{'id':'other','title':'Other','description':'third'})
        self.assertEqual(mapping,{1:'a',2:'b'})
        self.assertEqual(task['pure_ranked_list'],[1,2])
        self.assertEqual(task['reviewText'],['good','liked'])
        self.assertIsNone(task['answer'])
        self.assertNotIn('SECRET',str(task))
        self.assertEqual(task['instruction'],'')

    def test_original_stages_and_all_twenty_candidates(self):
        required = {'recommend_content':'choice', 'profile':'profile', 'knowledge':'knowledge',
                    'dynamic_interest':'interest', 'dynamic_profile':'dynamic profile',
                    'rerank_list':list(range(20,0,-1)), 'explanation':['fixture']}
        calls=[]
        def model(request):
            fields=request['response_format']['json_schema']['schema']['required']
            calls.append(fields)
            return {field:required[field] for field in fields}
        result=run_i2agent(sample(),model)
        self.assertEqual(len(calls),5)
        self.assertEqual(result['ordered_indices'],list(range(20,0,-1)))
        self.assertNotIn('answer',str(calls))

    def test_refuses_hidden_target(self):
        task=sample();task['answer']=3
        with self.assertRaisesRegex(ValueError,'hidden target'):
            run_i2agent(task,lambda _: {})

    def test_transport_failure_does_not_retry(self):
        calls=[]
        def fail(request):
            calls.append(request)
            raise RuntimeError('offline failure')
        with self.assertRaisesRegex(RuntimeError,'offline failure'):
            run_i2agent(sample(),fail)
        self.assertEqual(len(calls),1)

    def test_malformed_ranking_is_not_accepted(self):
        def model(request):
            fields=request['response_format']['json_schema']['schema']['required']
            values={'recommend_content':'choice','profile':'profile','knowledge':'knowledge',
                    'dynamic_interest':'interest','dynamic_profile':'profile',
                    'rerank_list':[1]*20,'explanation':['fixture']}
            return {field:values[field] for field in fields}
        with self.assertRaisesRegex(ValueError,'invalid ranking'):
            run_i2agent(sample(),model)


class PublicDataTest(unittest.TestCase):
    def test_agentrecbench_maps_review_history_and_candidates_without_labels(self):
        from agentrecbench_data import prepare_from_tool
        class Tool:
            item_data={'h1':{}, 'h2':{}, 'a':{}, 'b':{}, 'other':{}}
            def get_reviews(self, user_id):
                return [{'item_id':'h2','timestamp':2,'text':'second'},
                        {'item_id':'h1','timestamp':1,'text':'first'}]
            def get_item(self, item_id):
                return {'item_id':item_id,'title':item_id,'description':['public'],
                        'ground truth':'SECRET'}
        task,mapping=prepare_from_tool({'user_id':'u','candidate_list':['a','b']},Tool())
        self.assertEqual(task['asin'],['h1','h2'])
        self.assertEqual(task['reviewText'],['first','second'])
        self.assertEqual(mapping,{1:'a',2:'b'})
        self.assertNotIn('SECRET',str(task))
        self.assertIsNone(task['answer'])

class TransportTest(unittest.TestCase):
    def test_shared_transport_retains_schema_and_makes_final_prompt_user(self):
        from live_smoke import convert_request
        source={'messages':[{'role':'assistant','content':'previous'}, {'role':'assistant','content':'rank'}],
                'response_format':{'type':'json_schema','json_schema':{'schema':{'type':'object','properties':{'rerank_list':{'type':'array'}},'required':['rerank_list']}}}}
        converted=convert_request(source)
        self.assertEqual(converted['messages'][-1],{'role':'user','content':'rank'})
        self.assertEqual(converted['messages'][-2]['role'],'assistant')
        self.assertIn('rerank_list',converted['messages'][0]['content'])
        self.assertEqual(converted['response_format'],{'type':'json_object'})
        self.assertEqual(source['messages'][-1]['role'],'assistant')
        self.assertEqual(convert_request(source,rank_max_tokens=4096)['max_tokens'],4096)


class MindDataTest(unittest.TestCase):
    def test_missing_user_instructions_and_reviews_stay_empty(self):
        from mind_data import prepare_mind
        sample={'observation':{'dialogue':[], 'behavior_events':[
            {'type':'click','item':{'id':'h1','title':'first','abstract':'A'}},
            {'type':'click','item':{'id':'h2','title':'second','abstract':'B'}}],
            'environment':{'candidate_pool':[{'id':'a','title':'third','abstract':'C'},
                                             {'id':'b','title':'fourth','abstract':'D','label':1}]}}}
        task,mapping=prepare_mind(sample,{'id':'other','title':'contrast','abstract':'X'})
        self.assertEqual(task['instruction'],'')
        self.assertEqual(task['reviewText'],['',''])
        self.assertEqual(mapping,{1:'a',2:'b'})
        self.assertNotIn('label',task['ranked_list_str'])


class ReplayTest(unittest.TestCase):
    def test_replay_only_accepts_the_same_recorded_request(self):
        from live_smoke import replay_response
        request={'messages':[{'role':'user','content':'original'}]}
        receipt={'status':'success','content':'{"profile":"ok"}'}
        self.assertEqual(replay_response(request,request,receipt),{'profile':'ok'})
        with self.assertRaisesRegex(ValueError,'request differs'):
            replay_response({'messages':[]},request,receipt)


class KuaiRandDataTest(unittest.TestCase):
    def test_only_long_views_become_positive_history_without_invented_reviews(self):
        from kuairand_data import prepare_kuairand
        sample={'observation':{'dialogue':[], 'behavior_events':[
            {'item_id':'h1','payload':{'long_view':1,'caption_excerpt':'first','content_metadata':'m1'}},
            {'item_id':'h2','payload':{'long_view':1,'caption_excerpt':'second','content_metadata':'m2'}},
            {'item_id':'h3','payload':{'long_view':0,'caption_excerpt':'third','content_metadata':'m3'}}],
            'environment':{'candidate_pool':[{'id':'a','title':'A','text':'x','label':'SECRET'},
                                             {'id':'b','title':'B','text':'y'}]}}}
        task,mapping=prepare_kuairand(sample,{'id':'other','title':'O','text':'z'})
        self.assertEqual(task['asin'],['h1','h2']);self.assertEqual(task['reviewText'],['',''])
        self.assertEqual(mapping,{1:'a',2:'b'});self.assertNotIn('SECRET',str(task))


class KuaiRecDataTest(unittest.TestCase):
    def test_uses_only_observed_long_plays_and_r0_candidates(self):
        from kuairec_data import prepare_kuairec
        sample={'observation':{'dialogue':[], 'behavior_events':[
            {'item_id':'h1','payload':{'watch_ratio':3,'item_text':'first'}},
            {'item_id':'h2','payload':{'watch_ratio':4,'item_text':'second'}},
            {'item_id':'h3','payload':{'watch_ratio':1,'item_text':'third'}}]}}
        catalog=[{'id':'h1','text':'first'}, {'id':'h2','text':'second'}, {'id':'h3','text':'third'},
                 {'id':'a','text':'item A','label':'SECRET'}, {'id':'b','text':'item B'}, {'id':'other','text':'other'}]
        task,mapping=prepare_kuairec(sample,{'acquired_ids':['b','a']},catalog)
        self.assertEqual(task['asin'],['h1','h2']);self.assertEqual(task['reviewText'],['',''])
        self.assertEqual(mapping,{1:'b',2:'a'});self.assertNotIn('SECRET',str(task))

if __name__ == "__main__": unittest.main()
