"""Run the official AutoFigure SVG pipeline with OpenAI or Gemini."""
import argparse
from dataclasses import asdict
import json
import os
from pathlib import Path
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--provider", choices=("openai", "gemini"), default="openai")
parser.add_argument("--model", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
key_name = "OPENAI_API_KEY" if args.provider == "openai" else "GOOGLE_API_KEY"
key = os.environ.get(key_name)
if not key:
    parser.error(f"{key_name} is required; no generation was attempted.")

from autofigure import AutoFigureAgent, Config
from autofigure import generator

generator.CONFIG.update(SVG_WIDTH=1440, SVG_HEIGHT=660)

# Upstream names its generic OpenAI-compatible transport 'openrouter'.
config = Config(generation_api_key=key,
                generation_provider="openrouter" if args.provider == "openai" else "gemini",
                generation_base_url="https://api.openai.com/v1" if args.provider == "openai" else None,
                generation_model=args.model, output_dir=str(args.output),
                max_iterations=3, quality_threshold=9.0)
result = AutoFigureAgent(config).generate(
    description=Path(__file__).with_name("evaluation.md").read_text(),
    max_iterations=3, output_format="svg", topic="paper", enable_enhancement=False)
args.output.mkdir(parents=True, exist_ok=True)
record = json.dumps(asdict(result), ensure_ascii=False, indent=2).replace(key, "[REDACTED]")
(args.output / "pipeline-result.json").write_text(record)
if not result.success or not result.svg_path:
    raise RuntimeError("AutoFigure generation failed; inspect the private run log.")
root = ET.parse(result.svg_path).getroot()
if root.tag.rsplit("}", 1)[-1] != "svg":
    raise ValueError("AutoFigure output is not an SVG document.")
if not result.preview_path or not Path(result.preview_path).is_file():
    raise RuntimeError("AutoFigure did not produce a rendered preview.")
print("Official AutoFigure output saved; scientific and layout review still required.")
