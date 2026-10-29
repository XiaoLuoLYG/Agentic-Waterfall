"""Load pinned upstream recommendation code without unrelated model-download imports.

Every selected class/function body is compiled unchanged from its AST. The live
baseline adapter binds eval to ast.literal_eval for safe output parsing; ranking
logic, prompt, tokenizer and the upstream indentation defect remain unchanged.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Union
import ast, hashlib, json, logging, os, re, sys, types
ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT/'upstream/AgentSocietyChallenge-3f575247a5778d34c3ae6b0297139c7d4a3597fd'

def load_components(baseline=False):
    m = types.ModuleType('agentrecbench_pinned_components')
    sys.modules[m.__name__] = m
    m.__dict__.update({name: globals()[name] for name in
        ['ABC','abstractmethod','dataclass','Any','Dict','List','Optional','Union','ast','json','logging','os','re']})
    m.logger = logging.getLogger('websocietysimulator')
    # RecommendationEvaluator and InteractionTool need no scientific/ML dependency.
    selections = [
        ('websocietysimulator/tools/evaluation_tool.py',
         ['RecommendationMetrics','SimulationMetrics','BaseEvaluator','RecommendationEvaluator']),
        ('websocietysimulator/tools/interaction_tool.py',['InteractionTool']),
        ('websocietysimulator/tasks/recommendation_task.py',['RecommendationTask']),
    ]
    if baseline:
        import tiktoken
        m.tiktoken = tiktoken
        m.eval = ast.literal_eval
        selections += [
            ('websocietysimulator/llm/llm.py',['LLMBase']),
            ('websocietysimulator/agent/agent.py',['Agent']),
            ('websocietysimulator/agent/recommendation_agent.py',['RecommendationAgent']),
            ('websocietysimulator/agent/modules/planning_modules.py',['PlanningBase']),
            ('websocietysimulator/agent/modules/reasoning_modules.py',['ReasoningBase']),
            ('example/RecAgent_baseline.py',['num_tokens_from_string','RecPlanning','RecReasoning','MyRecommendationAgent'])]
        # Annotation only: no cache implementation is invoked in this lightweight path.
        m.CacheInteractionTool = type('UnusedCacheAnnotation', (), {})
    m.source_records = []
    for rel, names in selections:
        path = UPSTREAM/rel; raw = path.read_bytes(); tree = ast.parse(raw)
        nodes = [node for node in tree.body if isinstance(node,(ast.ClassDef,ast.FunctionDef)) and node.name in names]
        assert {node.name for node in nodes} == set(names), rel
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),m.__dict__)
        m.source_records.append({'path':rel,'sha256':hashlib.sha256(raw).hexdigest(),'definitions':names})
    return m
