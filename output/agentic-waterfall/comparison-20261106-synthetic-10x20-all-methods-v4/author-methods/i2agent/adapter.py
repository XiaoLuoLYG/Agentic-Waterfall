"""Adapt the pinned i2Agent class to an injected, metered model transport."""
import ast
import copy
import hashlib
import json
import re
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).parent / 'source-snapshot' / 'model.py'
SOURCE_SHA256 = 'a2b44548dffedcb2f32b382902626df67e23cc60dff42adb3d08a51e1a6210cb'
FIELDS = {'instruction', 'title', 'description', 'asin', 'reviewText', 'neg_sample_title',
          'neg_sample_descript', 'answer', 'ranked_list_str', 'pure_ranked_list'}


def prepare_task(history, candidates, contrast, instruction=''):
    if not isinstance(instruction, str) or not isinstance(history, list) or len(history) < 2 or not isinstance(candidates, list) or not candidates:
        raise ValueError('instruction, two history items and candidates are required')
    def project(item, keys):
        if not isinstance(item, dict) or any(not isinstance(item.get(k), str) for k in keys):
            raise ValueError('item fields must be strings')
        return {k:item[k] for k in keys}
    histories = [project(item, ('id','title','description','review')) for item in history]
    items = [project(item, ('id','title','description')) for item in candidates]
    contrast = project(contrast, ('id','title','description'))
    ids = [x['id'] for x in items]
    if any(not item for item in ids) or len(set(ids)) != len(ids) or contrast['id'] in set(ids + [x['id'] for x in histories]):
        raise ValueError('candidate IDs must be unique and contrast must be independent')
    mapping = {i+1:item['id'] for i,item in enumerate(items)}
    ranked = [{'index':i+1,'title':item['title'],'description':item['description']} for i,item in enumerate(items)]
    task = {'instruction':instruction, 'title':[x['title'] for x in histories],
            'description':[x['description'] for x in histories], 'asin':[x['id'] for x in histories],
            'reviewText':[x['review'] for x in histories], 'neg_sample_title':contrast['title'],
            'neg_sample_descript':contrast['description'], 'answer':None,
            'ranked_list_str':json.dumps(ranked,ensure_ascii=False), 'pure_ranked_list':list(mapping)}
    return task,mapping


class _StopRun(BaseException):
    pass


def run_i2agent(task, model):
    if set(task) != FIELDS or task.get('answer') is not None:
        raise ValueError('hidden target must be absent and input fields must match the contract')
    history = [task[k] for k in ('title', 'description', 'asin', 'reviewText')]
    if any(not isinstance(v, list) or len(v) < 2 or not all(isinstance(x, str) for x in v) for v in history) or len({len(v) for v in history}) != 1:
        raise ValueError('at least two aligned historical items are required')
    candidates = task['pure_ranked_list']
    if not isinstance(candidates, list) or not candidates or any(type(x) is not int for x in candidates) or len(set(candidates)) != len(candidates):
        raise ValueError('candidate indices must be nonempty unique integers')
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('author source hash changed')
    tree = ast.parse(raw, filename=str(SOURCE))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'i2Agent')
    calls, final_ranking = [], []

    def create(**request):
        if len(calls) >= 5:
            raise _StopRun(ValueError('unexpected extra model request'))
        calls.append(copy.deepcopy(request))
        try:
            response = model(copy.deepcopy(request))
            schema = request['response_format']['json_schema']['schema']
            if not isinstance(response, dict) or any(k not in response for k in schema['required']):
                raise ValueError('model response missing required fields')
            for field in schema['required']:
                expected = schema['properties'][field]['type']
                if expected == 'string' and not isinstance(response[field], str):
                    raise ValueError('model response has invalid field type')
                if expected == 'array' and not isinstance(response[field], list):
                    raise ValueError('model response has invalid field type')
            if 'rerank_list' in response:
                ranking = response['rerank_list']
                if len(ranking) != len(candidates) or any(type(x) is not int for x in ranking) or set(ranking) != set(candidates):
                    raise ValueError('invalid ranking')
                final_ranking.extend(ranking)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(response, ensure_ascii=False)))])
        except Exception as error:
            raise _StopRun(error)

    # Original code uses the hidden answer to decide whether to retry; validate the whole permutation instead.
    def scoring(_answer, ranking, _topk):
        if ranking != final_ranking:
            raise _StopRun(ValueError('invalid ranking'))
        return 0, 0, 0

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    namespace = {'json':json, 're':re, 'os':SimpleNamespace(environ={}),
                 'OpenAI':lambda **_:client, 'cal_ndcg_hr_single':scoring,
                 'time':SimpleNamespace(sleep=lambda _: (_ for _ in ()).throw(_StopRun(RuntimeError('unexpected retry'))))}
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(SOURCE), 'exec'), namespace)
    logger = SimpleNamespace(info=lambda _:None, error=lambda _:None)
    try:
        result = namespace['i2Agent'](copy.deepcopy(task), logger).run()
    except _StopRun as error:
        raise error.args[0]
    if len(calls) != 5 or not final_ranking or result.get('MRR') == -1:
        raise RuntimeError('author workflow did not complete')
    return {'ordered_indices':final_ranking, 'model_calls':len(calls), 'source_sha256':SOURCE_SHA256}
