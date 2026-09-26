"""Export the PyTorch model to a small ONNX file that runs in the browser.

Steps: PyTorch -> ONNX (fp32, temporary) -> 8-bit quantised ONNX in docs/model/.
Quantising cuts the download from 45 MB to ~11 MB and makes inference ~3x faster.
Then checks the result against the PyTorch model with the app's own scoring, on
shifted/rescaled dataset drawings (see build_letters.py), so you can see it
didn't lose accuracy.

Usage (from the Handwritings folder):
    python tools/export_onnx.py --dataset "../Sinhala Letters/Dataset454" \
        --labels "../Sinhala Letters/training/labels.py"
"""
import argparse
import json
import random
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import recognizer as rec  # noqa: E402
from build_letters import as_drawing, load_raw_classes  # noqa: E402

OUT = ROOT / "docs" / "model" / "sinhala_resnet18_int8.onnx"
LETTERS = ROOT / "docs" / "letters.json"


class Calibration(CalibrationDataReader):
    """Feeds the quantiser ~200 example views so it can pick good value ranges."""

    def __init__(self, dataset: Path):
        rng = random.Random(5)
        files = sorted((dataset / "train").glob("*/*.jpg"))
        random.Random(1).shuffle(files)
        samples = []
        for p in files[:400]:
            views = rec.variants(as_drawing(Image.open(p).convert("L"), rng))
            if views:
                samples.append(rec._transform(rng.choice(views)).numpy()[None])
        self._it = iter(samples[:200])

    def get_next(self):
        x = next(self._it, None)
        return None if x is None else {"input": x}


class OnnxAsTorch:
    """Lets rec.rank() run on an ONNX session so both models are scored identically."""

    def __init__(self, path):
        self.sess = ort.InferenceSession(str(path))

    def __call__(self, x):
        return torch.from_numpy(self.sess.run(None, {"input": x.numpy()})[0])


def score(model, dataset: Path, raw_classes: list[str]) -> tuple[float, float]:
    letters = json.loads(LETTERS.read_text(encoding="utf-8"))
    indices = [l["idx"] for l in letters]
    rec._model, rng, top1, top3, n = model, random.Random(0), 0, 0, 0
    for pos, l in enumerate(letters):
        folder = str(raw_classes.index(l["char"]) + 1)
        for p in sorted((dataset / "test" / folder).glob("*.jpg"))[:12]:
            ranking = rec.rank(as_drawing(Image.open(p).convert("L"), rng), indices)
            if ranking is None:
                continue
            order = [i for i, _ in ranking]
            n += 1
            top1 += order[0] == pos
            top3 += pos in order[:3]
    return top1 / n, top3 / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, type=Path)
    ap.add_argument("--labels", required=True, type=Path)
    args = ap.parse_args()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    torch_model = rec._model
    with tempfile.TemporaryDirectory() as tmp:
        fp32 = Path(tmp) / "fp32.onnx"
        torch.onnx.export(
            torch_model, torch.zeros(1, 3, 224, 224), str(fp32),
            input_names=["input"], output_names=["logits"],
            dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=17, dynamo=False,
        )
        quantize_static(
            str(fp32), str(OUT), Calibration(args.dataset), quant_format=QuantFormat.QDQ,
            per_channel=True, weight_type=QuantType.QInt8, activation_type=QuantType.QUInt8,
        )
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")

    raw_classes = load_raw_classes(args.labels)
    for name, model in (("PyTorch fp32", torch_model), ("ONNX int8", OnnxAsTorch(OUT))):
        t1, t3 = score(model, args.dataset, raw_classes)
        print(f"{name:13} top1={t1:.3f} top3={t3:.3f}")


if __name__ == "__main__":
    main()
