"""Loads the Sinhala ResNet18 model and turns a drawn image into predictions.

Model: sanjeevan7/emnist-letters-sinhala-resnet18-v2 (454 classes).
The model card doesn't publish a class -> letter table, but its output index
follows the Dataset454 folder names sorted as *strings* ("1", "10", "100", ...).
`tools/build_letters.py` verifies this against the real model and dataset.
"""
import io
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = ROOT / "models" / "pytorch_model.bin"
REPO_ID = "sanjeevan7/emnist-letters-sinhala-resnet18-v2"
NUM_CLASSES = 454

# Dataset folder names are "1".."454"; the model's output index is the position
# in the string-sorted list, e.g. folder "1" -> 0, folder "2" -> 111.
FOLDER_ORDER = sorted(str(n) for n in range(1, NUM_CLASSES + 1))
FOLDER_TO_INDEX = {folder: i for i, folder in enumerate(FOLDER_ORDER)}

FRAME = 80  # training images are 80x80, white ink on black
FIT_SIZES = (36, 44, 52, 60)  # longest-side sizes tried; training glyphs are ~46px typically

_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.Grayscale(3),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


def _load_model() -> torch.nn.Module:
    if not WEIGHTS.exists():
        from huggingface_hub import hf_hub_download

        hf_hub_download(REPO_ID, "pytorch_model.bin", local_dir=str(WEIGHTS.parent))
    model = models.resnet18()
    model.fc = torch.nn.Linear(model.fc.in_features, NUM_CLASSES)
    model.load_state_dict(torch.load(WEIGHTS, map_location="cpu"))
    return model.eval()


_model = _load_model()
torch.set_num_threads(2)


def _ink_array(image: Image.Image) -> np.ndarray:
    """Drawing (dark ink on light background) -> array where ink is bright."""
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(bg, rgba)
    return 255 - np.asarray(image.convert("L"), dtype=np.uint8)


def _square(ink: np.ndarray) -> Image.Image:
    h, w = ink.shape
    side = max(h, w)
    canvas = Image.new("L", (side, side), 0)
    canvas.paste(Image.fromarray(ink), ((side - w) // 2, (side - h) // 2))
    return canvas


def _fit(ink: np.ndarray, ys, xs, size: int) -> Image.Image:
    """Crop to the ink and centre it at `size` px on its longest side."""
    crop = Image.fromarray(ink[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    k = size / max(crop.size)
    crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
    frame = Image.new("L", (FRAME, FRAME), 0)
    frame.paste(crop, ((FRAME - crop.width) // 2, (FRAME - crop.height) // 2))
    return frame


def variants(image: Image.Image, min_ink_px: int = 40) -> list[Image.Image] | None:
    """Drawing -> several 80x80 white-on-black views of it, or None if blank.

    The model reacts strongly to a letter's size and position in the frame, and
    children draw at all sizes. So we show it the canvas as drawn plus the ink
    re-fitted at a few sizes, and the caller averages the predictions. On
    shifted/rescaled dataset images this scored ~90% top-1 vs ~85% for a single
    crop-and-centre.
    """
    ink = _ink_array(image)
    ys, xs = np.where(ink > 40)
    if len(ys) < min_ink_px:
        return None
    as_drawn = _square(ink).resize((FRAME, FRAME), Image.LANCZOS)
    return [as_drawn] + [_fit(ink, ys, xs, s) for s in FIT_SIZES]


@torch.no_grad()
def rank(image: Image.Image, letter_indices: list[int]) -> list[tuple[int, float]] | None:
    """Rank the app's letters for a drawing: [(position in letter_indices, prob)], best first.

    Probabilities are averaged over the views, then restricted to (and
    renormalised over) the letters children practise. Returns None if blank.
    """
    views = variants(image)
    if views is None:
        return None
    batch = torch.stack([_transform(v) for v in views])
    probs = torch.softmax(_model(batch), dim=1).mean(0)[letter_indices]
    probs = probs / probs.sum()
    order = probs.argsort(descending=True).tolist()
    return [(i, float(probs[i])) for i in order]


def rank_png(data: bytes, letter_indices: list[int]):
    return rank(Image.open(io.BytesIO(data)), letter_indices)
