"""Build docs/letters.json: the letters children practise, mapped to model classes.

Each letter is looked up in the Dataset454 author's folder->character list and
converted to the model's output index. Then every letter is scored the way the
app will use it: dataset images are turned into "drawings" (dark ink on white,
randomly shifted and rescaled like a child's would be) and ranked with the app's
own recognizer. Letters the model can't recognise reliably are dropped, so a
child is never told "try again" because of a bad label.

Usage (from the Handwritings folder):
    python tools/build_letters.py --dataset "../Sinhala Letters/Dataset454" \
        --labels "../Sinhala Letters/training/labels.py"
"""
import argparse
import importlib.util
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import recognizer as rec  # noqa: E402

GROUPS = {
    "vowels": "අ ආ ඇ ඈ ඉ ඊ උ එ ඒ ඔ ඕ",
    "consonants": (
        "ක ඛ ග ඝ ච ඡ ජ ඣ ඤ ට ඨ ඩ ඪ ණ ත ථ ද ධ න ප ඵ බ භ ම ය ර ල ව ශ ෂ ස හ ළ ෆ ඟ ඳ ඬ ඹ ඥ"
    ),
    "signs": "කා කැ කෑ කි කී කු කූ කෝ ක්",
}
MIN_TOP3 = 0.8  # a letter must be in the model's top 3 at least this often


def load_raw_classes(labels_py: Path) -> list[str]:
    spec = importlib.util.spec_from_file_location("labels", labels_py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return [c.strip() for c in mod._RAW_CLASSES]


def as_drawing(im: Image.Image, rng: random.Random) -> Image.Image:
    """Dataset image (white ink on black) -> dark ink on white, shifted/rescaled."""
    s = rng.uniform(0.75, 1.3)
    dx, dy = rng.randint(-8, 8), rng.randint(-8, 8)
    moved = im.transform(
        im.size, Image.AFFINE, (1 / s, 0, 40 - 40 / s - dx / s, 0, 1 / s, 40 - 40 / s - dy / s),
        resample=Image.BILINEAR,
    )
    return ImageOps.invert(moved)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, type=Path)
    ap.add_argument("--labels", required=True, type=Path)
    args = ap.parse_args()

    raw_classes = load_raw_classes(args.labels)
    candidates, dropped = [], []
    for group, chars in GROUPS.items():
        for ch in chars.split():
            if ch not in raw_classes:
                dropped.append((ch, "not in label list"))
                continue
            folder = str(raw_classes.index(ch) + 1)
            candidates.append({"char": ch, "group": group, "folder": folder,
                               "idx": rec.FOLDER_TO_INDEX[folder]})
    indices = [c["idx"] for c in candidates]

    rng = random.Random(0)
    letters = []
    for pos, c in enumerate(candidates):
        files = [p for split in ("test", "valid") for p in sorted((args.dataset / split / c["folder"]).glob("*.jpg"))]
        top1 = top3 = n = 0
        for p in files:
            ranking = rec.rank(as_drawing(Image.open(p).convert("L"), rng), indices)
            if ranking is None:  # blank image in the dataset
                continue
            order = [i for i, _ in ranking]
            n += 1
            top1 += order[0] == pos
            top3 += pos in order[:3]
        top1, top3 = top1 / n, top3 / n
        print(f"{c['group']:10} {c['char']:4} folder={c['folder']:>3} idx={c['idx']:>3} top1={top1:.2f} top3={top3:.2f}")
        if top3 < MIN_TOP3:
            dropped.append((c["char"], f"top3 {top3:.2f}"))
            continue
        letters.append({"char": c["char"], "group": c["group"], "idx": c["idx"]})

    out = ROOT / "docs" / "letters.json"
    out.write_text(json.dumps(letters, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\nWrote {len(letters)} letters to {out}")
    for ch, why in dropped:
        print(f"DROPPED {ch}: {why}")


if __name__ == "__main__":
    main()
