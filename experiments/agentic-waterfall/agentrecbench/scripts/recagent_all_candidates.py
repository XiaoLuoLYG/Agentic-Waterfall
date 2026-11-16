"""Official RecAgent with its candidate-metadata append indentation corrected."""
import ast

from official_components import UPSTREAM, load_components


def load_recagent_all_candidates(*, mind_history_tokens=None):
    official = load_components(baseline=True)
    path = UPSTREAM / 'example/RecAgent_baseline.py'
    source = path.read_text()
    original = '                item_list.append(filtered_item)'
    corrected = '                    item_list.append(filtered_item)'
    if source.count(original) != 1:
        raise ValueError('Unexpected upstream candidate append; refuse to patch')
    source = source.replace(original, corrected, 1)
    if mind_history_tokens is not None:
        history_limit = """                input_tokens = num_tokens_from_string(history_review)
                if input_tokens > 12000:
                    encoding = tiktoken.get_encoding("cl100k_base")
                    history_review = encoding.decode(encoding.encode(history_review)[:12000])"""
        changes = {
            history_limit: history_limit.replace("12000", str(mind_history_tokens)),
            "Your historical item review text and stars are as follows:":
                "Here are the news articles you clicked before the current impression:",
            "keys_to_extract = ['item_id',": "keys_to_extract = ['candidate_index', 'item_id',",
            "following 20 items: {self.task['candidate_list']}":
                "following {len(self.task['candidate_list'])} items",
            "above 20 candidate items": "above {len(self.task['candidate_list'])} candidate items",
            ("Your final output should be ONLY a ranked item list of {self.task['candidate_list']} "
             "with the following format, DO NOT introduce any other item ids!"):
                ("Return only a JSON array of candidate_index integers, from most to least relevant. "
                 "Include each integer from 1 to {len(self.task['candidate_list'])} exactly once. "
                 "Check that the array contains {len(self.task['candidate_list'])} integers."),
            "The correct output format:": "Format example for a separate three-candidate task:",
            "['item id1', 'item id2', 'item id3', ...]": "[3, 1, 2]",
        }
        for original, replacement in changes.items():
            if source.count(original) != 1:
                raise ValueError('Unexpected upstream RecAgent MIND adapter boundary')
            source = source.replace(original, replacement, 1)
    tree = ast.parse(source, filename=str(path))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'MyRecommendationAgent')
    cls.name = 'RecAgentAllCandidates'
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(path), 'exec'), official.__dict__)
    return official
