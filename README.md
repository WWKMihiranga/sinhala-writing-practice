# අකුරු ලියමු – Sinhala Writing Practice

A small web app where children practise writing Sinhala letters. They see a letter,
write it on a drawing pad (finger, pen or mouse), and the
[`emnist-letters-sinhala-resnet18-v2`](https://huggingface.co/sanjeevan7/emnist-letters-sinhala-resnet18-v2)
model checks it and awards 1–3 stars. Works on phones, tablets and laptops.

- **58 letters** in three sets: vowels (ස්වර), consonants (ව්‍යංජන), and ක with its signs (පිලි)
- **Stars & progress** per child (⭐ 2+ = learned), daily streak, several children on one device
- **Guide letter** on the pad that can be switched off once they're confident
- **Private by design:** the model runs *in the browser*. Drawings never leave the device,
  there are no accounts, no analytics and no third-party requests. Progress is saved in the
  browser (localStorage).

It is a plain static site (`docs/`), so it can be hosted for free. See **[DEPLOY.md](DEPLOY.md)**.

## Run it locally

```bash
python3 -m http.server 8000 --directory docs
```

Open http://localhost:8000 (a server is needed; opening `index.html` directly won't load the model).
To try it on a phone on the same Wi-Fi, open `http://<your-computer-ip>:8000`.

## How it works

```
child draws on <canvas> → recognizer.js (ONNX Runtime Web, on the device) → stars
```

| Path | Purpose |
|---|---|
| `docs/index.html`, `style.css`, `app.js` | The whole UI (no build step) |
| `docs/recognizer.js` | Prepares the drawing and runs the model in the browser |
| `docs/model/sinhala_resnet18_int8.onnx` | The model, converted and compressed (11.5 MB) |
| `docs/vendor/` | ONNX Runtime Web (self-hosted, so no CDN) |
| `docs/letters.json` | The 58 letters and their model class numbers (generated) |
| `app/recognizer.py` | Python reference version of the recognizer, used by the tools |
| `tools/build_letters.py` | Rebuilds and validates `letters.json` |
| `tools/export_onnx.py` | PyTorch → quantised ONNX, and checks accuracy didn't drop |
| `main.py` | Original download/load smoke test |

**Scoring.** The model chooses among 454 classes, but the app only teaches 58, so the
drawing is ranked among those 58. The target letter is 1st → ⭐⭐⭐, 2nd → ⭐⭐,
3rd → ⭐, otherwise "try again" (with a hint about which letter it looked like).
Adjust `STARS_BY_RANK` in `docs/app.js` to make it stricter or more forgiving.

### Things the model card doesn't tell you (and how they were resolved)

1. **Class → letter mapping is not published.** The output index turns out to be the
   Kaggle dataset's folder names (`1`…`454`) sorted **as strings** (`"1","10","100",…`), so
   folder `"2"` is class `111`. Letter labels come from the dataset author's notebook.
   Verified against the real model: 88–100% per letter (≈97% overall) on the
   dataset's own images.
2. **Ink polarity.** The model expects white ink on black (the app inverts the canvas).
3. **Size and position matter a lot.** The model was trained on fixed-frame images, and
   simply cropping and centring a drawing lost accuracy. The recognizer therefore
   scores the canvas as drawn plus the ink re-fitted at four sizes and averages them.
   On randomly shifted/rescaled dataset drawings: ~91% top-1, ~97% top-3.
4. **Labels are imperfect.** 29 of the dataset's 454 labels are corrupted font codes and a
   few letters are unreliable, so `tools/build_letters.py` drops any letter the model can't
   place in its top 3 at least 80% of the time (currently only ඹ). Some vowels (ඌ, ඍ, ඓ, ඖ…)
   aren't in the labelled dataset at all.
5. **Small model.** 8-bit quantisation shrinks the download from 45 MB to 11.5 MB and speeds
   up inference ~3×, with no measurable accuracy loss (91.5% vs 91.2% top-1).

The in-browser JavaScript pipeline was checked against the Python one on 232 drawings:
same top choice 99.6% of the time.

### Rebuilding the model files

Only needed if you change the letter set or the model. Needs Python + the dataset folder:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python tools/build_letters.py --dataset "<path>/Dataset454" --labels "<path>/training/labels.py"
python tools/export_onnx.py   --dataset "<path>/Dataset454" --labels "<path>/training/labels.py"
```

(Edit `GROUPS` in `tools/build_letters.py` to change which letters are taught. The
first run downloads the original weights into `models/`.)

## Known limits

- Validated on synthetic drawings made from the dataset, not on real children's
  handwriting. Watch a few real sessions and tune `STARS_BY_RANK` if it feels too easy or too hard.
- Visually similar pairs (e.g. ජ/ඡ, ස/ඝ) can be confused.
- First visit downloads ~26 MB (model + runtime), then it is cached by the browser.
- Progress is per browser/device. Clearing site data clears the stars.
- Needs a reasonably modern browser (WebAssembly SIMD: Chrome/Edge 91+, Firefox 89+, Safari 16.4+).

## Credits

Model: `sanjeevan7/emnist-letters-sinhala-resnet18-v2`. Dataset: *Sinhala Letter and
Modifications* by Sathira L. Amal (Kaggle), licensed CC BY 4.0. Inference: ONNX Runtime Web (MIT).
