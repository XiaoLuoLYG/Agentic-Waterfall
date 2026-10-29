"""Official RecAgent with its candidate-metadata append indentation corrected."""
import ast

from official_components import UPSTREAM, load_components


def load_recagent_all_candidates():
    official = load_components(baseline=True)
    path = UPSTREAM / 'example/RecAgent_baseline.py'
    source = path.read_text()
    original = '                item_list.append(filtered_item)'
    corrected = '                    item_list.append(filtered_item)'
    if source.count(original) != 1:
        raise ValueError('Unexpected upstream candidate append; refuse to patch')
    tree = ast.parse(source.replace(original, corrected, 1), filename=str(path))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'MyRecommendationAgent')
    cls.name = 'RecAgentAllCandidates'
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(path), 'exec'), official.__dict__)
    return official
