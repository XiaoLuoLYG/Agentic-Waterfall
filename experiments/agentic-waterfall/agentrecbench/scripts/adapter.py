"""Benchmark boundary: fixed candidates, original tools, labels evaluator-only.

The coordinator supplies the Waterfall runner and budgeted model callable. This
module does not implement or silently approximate Waterfall or Baseline666.
"""
from pathlib import Path
import copy, json
from official_components import load_components

SCENARIOS = ['classic','long_term','short_term','user_cold_start','item_cold_start']
CORPUS_WINDOW = {'classic':'all','user_cold_start':'all','item_cold_start':'all','long_term':'long','short_term':'short'}

def load_task(path):
    raw = json.loads(Path(path).read_text())
    candidates = raw['candidate_list']
    if raw.get('type') != 'recommendation' or len(candidates)!=20 or len(set(candidates))!=20:
        raise ValueError('Expected an official recommendation task with 20 unique candidates')
    official = load_components()
    return official.RecommendationTask(**{k:raw[k] for k in ['user_id','candidate_category','candidate_list','loc']})

def validate_ranking(ranking, candidates):
    if not isinstance(ranking,list) or not all(isinstance(x,str) for x in ranking):
        raise ValueError('Ranking must be a list of string IDs')
    if len(ranking)!=len(candidates) or len(set(ranking))!=len(ranking) or set(ranking)!=set(candidates):
        raise ValueError('Ranking must be a permutation of the original 20 candidates')
    return ranking

class LoggedTools:
    """No label argument. Official tool receives blocked corpus before agent access."""
    def __init__(self, official_tool):
        self.tool = official_tool
        self.calls = []
    def _call(self, name, **kwargs):
        result = getattr(self.tool,name)(**kwargs)
        self.calls.append({'tool':name,'arguments':kwargs,'result':copy.deepcopy(result)})
        return result
    def get_user(self,user_id): return self._call('get_user',user_id=user_id)
    def get_item(self,item_id=None): return self._call('get_item',item_id=item_id)
    def get_reviews(self,item_id=None,user_id=None,review_id=None):
        return self._call('get_reviews',item_id=item_id,user_id=user_id,review_id=review_id)

class WaterfallAdapter:
    def __init__(self, task, tools, scenario, task_id):
        self.task=task.to_dict(); self.tools=tools
        self.scenario=scenario; self.task_id=task_id
    def initial_input(self):
        return {'schema_version':'agentic-waterfall-v1','decision_id':f'{self.scenario}:{self.task_id}:0',
            'user_id':self.task['user_id'],'session_id':f'agentrecbench:{self.scenario}:{self.task_id}',
            'observed_at':None,'trigger':'benchmark_recommendation',
            # No invented user utterance or timestamp; public history is available through tools.
            'dialogue':[],'behavior_events':[],'user_state':{'version':0,'records':[]},
            'environment':{'benchmark':'AgentRecBench','scenario':self.scenario,
                'task':copy.deepcopy(self.task),'candidate_pool':[{'id':x} for x in self.task['candidate_list']],
                'tool_names':['get_user','get_item','get_reviews'],
                'candidate_policy':'Acquire evidence about original candidates; never add candidates',
                'memory_policy':'Retain records; independent benchmark tasks never inherit hidden labels'}}
    def tool_call(self,name,arguments):
        if name not in ['get_user','get_item','get_reviews']: raise ValueError('Unknown benchmark tool')
        return getattr(self.tools,name)(**arguments)
    def final_output(self,ranking): return validate_ranking(ranking,self.task['candidate_list'])

def official_metrics(labels, predictions, number_sim=0):
    if len(labels)!=len(predictions): raise ValueError('One prediction entry per assigned task required, including failures')
    if not 0<=number_sim<=len(labels): raise ValueError('Invalid synthetic-task count')
    return load_components().RecommendationEvaluator().calculate_hr_at_n(labels,predictions,number_sim).__dict__
