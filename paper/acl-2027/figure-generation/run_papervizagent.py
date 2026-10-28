"""Run the official PaperVizAgent pipeline with the selected model provider."""
import argparse
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model", required=True)
parser.add_argument("--image-model", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
required_keys = {"OPENAI_API_KEY" if model.startswith("gpt-") else "GOOGLE_API_KEY"
                 for model in (args.model, args.image_model)}
missing = [name for name in sorted(required_keys) if not os.environ.get(name)]
if missing:
    parser.error(f"{', '.join(missing)} required; no generation was attempted.")
os.environ["OPENAI_BASE_URL"] = "https://api.openai.com/v1"

repo = Path.home() / ".local/share/research-figure-tools/PaperVizAgent"
sys.path.insert(0, str(repo))
from PIL import Image
from utils.config import ExpConfig
from utils.paperviz_processor import PaperVizProcessor
from agents.vanilla_agent import VanillaAgent
from agents.planner_agent import PlannerAgent
from agents.visualizer_agent import VisualizerAgent
from agents.stylist_agent import StylistAgent
from agents.critic_agent import CriticAgent
from agents.retriever_agent import RetrieverAgent
from agents.polish_agent import PolishAgent

cfg = ExpConfig(dataset_name="Demo", task_name="diagram", split_name="waterfall",
                exp_mode="demo_full", retrieval_setting="auto", max_critic_rounds=2,
                model_name=args.model, image_model_name=args.image_model, work_dir=repo)
processor = PaperVizProcessor(
    exp_config=cfg, vanilla_agent=VanillaAgent(exp_config=cfg),
    planner_agent=PlannerAgent(exp_config=cfg), visualizer_agent=VisualizerAgent(exp_config=cfg),
    stylist_agent=StylistAgent(exp_config=cfg), critic_agent=CriticAgent(exp_config=cfg),
    retriever_agent=RetrieverAgent(exp_config=cfg), polish_agent=PolishAgent(exp_config=cfg))
brief = Path(__file__).with_name("architecture.md").read_text()
result = asyncio.run(processor.process_single_query({
    "filename": "waterfall-architecture", "candidate_id": 0,
    "caption": "Proposed Waterfall controller with scoped state and candidate-aware actions.",
    "visual_intent": brief, "content": brief,
    "additional_info": {"rounded_ratio": "16:9", "image_size": "2K", "openai_size": "2560x1280"}, "max_critic_rounds": 2,
}, do_eval=False))
args.output.mkdir(parents=True, exist_ok=True)
(args.output / "pipeline-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
encoded = result[result["eval_image_field"]]
with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as figure:
    figure.load()
    if min(figure.size) < 400:
        raise ValueError(f"Unexpectedly small pipeline image: {figure.size}")
    figure.save(args.output / "waterfall-architecture.png")
print("Official PaperVizAgent output saved; scientific and layout review still required.")
