"""Run the pinned RecAgent workflow on one label-free MIND impression."""
from functools import cache
from hashlib import sha256
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
AGENTRECBENCH = HERE.parents[2] / "experiments/agentic-waterfall/agentrecbench"
sys.path.insert(0, str(AGENTRECBENCH / "scripts"))

from recagent_all_candidates import load_recagent_all_candidates

HISTORY_TOKENS = 32768
OUTPUT_TOKENS = 8192
AUTHOR_SHA256 = "6c8834d6c1548f2f834ba5c51aabd4af5cffa793c1cad94e808b0c50cc2dfcd1"
TOKENIZER_CACHE_FILE = "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"
TOKENIZER_SHA256 = "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"


@cache
def components():
    cache_dir = Path(os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(HERE / "cache")))
    tokenizer = cache_dir / TOKENIZER_CACHE_FILE
    if not tokenizer.is_file() or sha256(tokenizer.read_bytes()).hexdigest() != TOKENIZER_SHA256:
        raise ValueError("RecAgent requires the pinned local cl100k_base cache")
    official = load_recagent_all_candidates(mind_history_tokens=HISTORY_TOKENS)
    author = next(row for row in official.source_records if row["path"] == "example/RecAgent_baseline.py")
    if author["sha256"] != AUTHOR_SHA256:
        raise ValueError("RecAgent upstream source hash changed")
    official.print = lambda *args, **kwargs: None
    return official


def card(item):
    article_id, title, abstract = item["id"], item["title"], item.get("abstract")
    if not isinstance(article_id, str) or not article_id or not isinstance(title, str) or not title:
        raise ValueError("invalid MIND article ID or title")
    if abstract is not None and not isinstance(abstract, str):
        raise ValueError("invalid MIND article abstract")
    return {"item_id": article_id, "title": title, "description": abstract or ""}


def rank_mind(sample, model):
    observation = sample["observation"]
    decision, user = observation["decision_id"], observation["user_id"]
    if not isinstance(decision, str) or not decision.startswith("mind:") or not isinstance(user, str) or not user:
        raise ValueError("invalid MIND impression identity")
    if observation["dialogue"] != []:
        raise ValueError("MIND impression must have empty dialogue")
    history = []
    for event in observation["behavior_events"]:
        if event["type"] != "click" or event["item_id"] != event["item"]["id"]:
            raise ValueError("invalid MIND click history")
        history.append(card(event["item"]))
    cards = [card(item) for item in observation["environment"]["candidate_pool"]]
    items = {item["item_id"]: {"candidate_index": index, **item} for index, item in enumerate(cards, 1)}
    if not cards or len(items) != len(cards):
        raise ValueError("empty or duplicate MIND candidate pool")
    candidates = list(items)

    class MindTool:
        def get_user(self, user_id):
            if user_id != user:
                raise ValueError("MIND user mismatch")
            return user_id

        def get_item(self, item_id):
            return items[item_id]

        def get_reviews(self, user_id):
            self.get_user(user_id)
            return history

    official = components()
    tokenizer = official.tiktoken.get_encoding("cl100k_base")
    history_tokens = len(tokenizer.encode(str(history)))
    prompt_tokens = None

    def call(messages, temperature, max_tokens):
        nonlocal prompt_tokens
        prompt_tokens = sum(len(tokenizer.encode(message["content"])) for message in messages)
        return model({"messages": messages, "temperature": temperature, "max_tokens": OUTPUT_TOKENS})

    agent = official.RecAgentAllCandidates(call)
    agent.set_interaction_tool(MindTool())
    agent.insert_task(official.RecommendationTask(user, "news", candidates, [-1, -1]))
    indices = agent.workflow()
    count = len(candidates)
    expected = set(range(1, count + 1))
    if (
        not isinstance(indices, list) or any(type(index) is not int for index in indices)
        or set(indices[:count]) != expected or not set(indices[count:]) <= expected
    ):
        raise ValueError("invalid RecAgent full candidate index permutation")
    # A complete prefix already fixes every relative position. Only trailing repeats can be dropped.
    ranking = [candidates[index - 1] for index in indices[:count]]
    return {
        "status": "submitted",
        "decision_id": decision,
        "ordered_item_ids": ranking,
        "candidates": count,
        "trailing_repeats_removed": len(indices) - count,
        "history_clicks": len(history),
        "history_tokens": history_tokens,
        "history_truncated": history_tokens > HISTORY_TOKENS,
        "prompt_tokens_local": prompt_tokens,
    }


def serve(sample):
    def emit(event):
        print(json.dumps(event, ensure_ascii=False), flush=True)

    def model(request):
        emit({"type": "model_request", "request": request})
        response = json.loads(sys.stdin.readline())
        if response["type"] != "model_response":
            raise RuntimeError(response.get("error", "model transport failed"))
        return response["content"]

    try:
        result = rank_mind(sample, model)
    except (KeyError, TypeError, ValueError, RuntimeError) as exc:
        result = {
            "status": "failed",
            "decision_id": sample["observation"]["decision_id"],
            "error": str(exc),
        }
    emit({"type": "result", **result})


if __name__ == "__main__":
    if sys.argv[1:] == ["--stream"]:
        for line in sys.stdin:
            serve(json.loads(line))
    else:
        serve(json.loads(sys.stdin.readline()))
