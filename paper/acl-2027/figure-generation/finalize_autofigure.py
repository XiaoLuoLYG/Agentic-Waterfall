"""Complete the actual AutoFigure output using its official Improvement Agent."""
import json
import os
from pathlib import Path
from PIL import Image
from autofigure import Config
from autofigure import generator as g

root = Path(__file__).parent
source = root / "outputs/autofigure-evaluation"
target = root / "outputs/autofigure-evaluation-final"
key = os.environ.get("OPENAI_API_KEY")
if not key:
    raise SystemExit("OPENAI_API_KEY is required")
cfg = Config(generation_api_key=key, generation_provider="openrouter",
             generation_base_url="https://api.openai.com/v1", generation_model="gpt-6.1-sol",
             output_dir=str(target))
g.update_config_from_sdk(cfg)
g.CONFIG.update(SVG_WIDTH=1440, SVG_HEIGHT=660)
guidance = (root / "evaluation-finalization.md").read_text()
critique = json.loads((source / "iteration_0_evaluation.json").read_text())["evaluation_data"]
references = [Image.open(p) for p in cfg.get_references()]
with Image.open(source / "figure_final.png") as previous:
    code = g.improve_code(
        code=(source / "figure_final.svg").read_text(), code_image=previous,
        paper_content=(source / "input-brief.md").read_text(), reference_figures=references,
        iteration=3, previous_critique=critique, human_guidance=guidance,
        topic="paper", output_format="svg")
for reference in references:
    reference.close()
if not code:
    raise RuntimeError("AutoFigure Improvement Agent did not return code")
target.mkdir(parents=True, exist_ok=True)
(target / "editorial-guidance.md").write_text(guidance)
(target / "waterfall-evaluation.svg").write_text(code)
ok, _ = g.svg_to_png(code, str(target / "waterfall-evaluation.png"), attempt_repair=False)
if not ok:
    raise RuntimeError("Final AutoFigure SVG could not be rendered")
assert "[icon]" not in code.lower(), "Illustration placeholder remains"
(target / "provenance.json").write_text(json.dumps({
    "tool": "AutoFigure", "entry_point": "autofigure.generator.improve_code",
    "text_model": "gpt-6.1-sol", "source_svg": str(source / "figure_final.svg"),
    "guidance_author": "assistant editorial review", "reviewed_for_paper": False,
}, indent=2))
print("AutoFigure production refinement rendered; visual review remains.")
