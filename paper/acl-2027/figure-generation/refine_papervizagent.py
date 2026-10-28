"""Use PaperVizAgent's Planner and Visualizer to simplify its completed proposal."""
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys

root = Path(__file__).parent
repo = Path.home() / ".local/share/research-figure-tools/PaperVizAgent"
if not os.environ.get("OPENAI_API_KEY"):
    raise SystemExit("OPENAI_API_KEY is required")
os.environ["OPENAI_BASE_URL"] = "https://api.openai.com/v1"
sys.path.insert(0, str(repo))
from PIL import Image
from utils.config import ExpConfig
from agents.planner_agent import PlannerAgent
from agents.visualizer_agent import VisualizerAgent

previous = json.loads((root / "outputs/papervizagent-architecture/pipeline-result.json").read_text())
brief = (root / "architecture-compact.md").read_text()
out = root / "outputs/papervizagent-architecture-compact"
out.mkdir(parents=True, exist_ok=True)
(out / "input-brief.md").write_text(brief)
cfg = ExpConfig(dataset_name="Demo", task_name="diagram", exp_mode="dev_planner",
                model_name="gpt-6.1-sol", image_model_name="gpt-image-2.5-sunburst", work_dir=repo)

async def main():
    data = {"content": brief, "visual_intent": brief,
            "top10_references": previous["top10_references"],
            "additional_info": {"openai_size": "2560x1280"}}
    data = await PlannerAgent(exp_config=cfg).process(data)
    (out / "planner-result.json").write_text(json.dumps(data, indent=2))
    data = await VisualizerAgent(exp_config=cfg).process(data)
    (out / "pipeline-result.json").write_text(json.dumps(data, indent=2))
    with Image.open(io.BytesIO(base64.b64decode(data["target_diagram_desc0_base64_jpg"]))) as figure:
        figure.load()
        assert figure.size == (2560, 1280)
        figure.save(out / "waterfall-architecture.png")

asyncio.run(main())
print("PaperVizAgent compact proposal generated; scientific review remains.")
