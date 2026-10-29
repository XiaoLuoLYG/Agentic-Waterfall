from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]

def resolve_paths(domain,full_tasks):
    if domain not in ('amazon','yelp','goodreads'):raise ValueError('unknown domain')
    exp=ROOT/'experiments/agentic-waterfall/agentrecbench';data=ROOT/'datasets/agentic-waterfall/agentrecbench'
    if domain!='amazon' and not full_tasks:raise ValueError('new domains require complete task set')
    return {'taskdir':data/'task-full'/'short_term'/domain if full_tasks else exp/'data/task/short_term/amazon',
            'data':data/(domain+'-short') if full_tasks or domain!='amazon' else exp/'data/amazon-short',
            'requires_index':full_tasks or domain!='amazon'}
