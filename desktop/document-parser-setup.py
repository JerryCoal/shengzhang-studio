"""Explicit network-enabled model setup, separate from offline document parsing."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import truststore

# Respect the operating system certificate store (including managed networks).
# Certificate validation remains enabled.
truststore.inject_into_ssl()

parser = argparse.ArgumentParser()
parser.add_argument("--models", type=Path, required=True)
args = parser.parse_args()
from docling.utils.model_downloader import download_models

download_models(output_dir=args.models, with_layout=True, with_tableformer=True,
                with_code_formula=False, with_picture_classifier=False,
                with_rapidocr=True, rapidocr_models=["onnxruntime:ch"], progress=True)
files = [{"path": str(file.relative_to(args.models)).replace("\\", "/"), "size": file.stat().st_size}
         for file in sorted(args.models.rglob("*")) if file.is_file() and not any(part.startswith(".") for part in file.relative_to(args.models).parts) and file.name != "shengzhang-ready.json"]
if not files:
    raise RuntimeError("Model download produced no files")
(args.models / "shengzhang-ready.json").write_text(json.dumps({"version": importlib.metadata.version("docling-slim"), "files": files}, indent=2), encoding="utf-8")
print("Local Docling models are ready.")
