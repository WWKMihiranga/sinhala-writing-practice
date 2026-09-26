"use strict";

/* ------------------------------------------------------------------
   In-browser letter recognizer (ONNX Runtime Web).
   A JavaScript port of app/recognizer.py: same preprocessing, same
   resampling filters, so accuracy measured in Python carries over.
   Drawings never leave the device.
------------------------------------------------------------------- */
const Recognizer = (() => {
  const MODEL_URL = "model/sinhala_resnet18_int8.onnx";
  const FRAME = 80;                    // training images are 80x80, white ink on black
  const INPUT = 224;                   // the model's input size
  const FIT_SIZES = [36, 44, 52, 60];  // longest-side sizes tried besides the canvas as drawn
  const INK_THRESHOLD = 40;
  const MIN_INK_PIXELS = 40;
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  /* ---- resampling: same maths as Pillow's resize() ---- */
  const lanczos = (x) => {
    if (x === 0) return 1;
    if (x <= -3 || x >= 3) return 0;
    const px = Math.PI * x;
    return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
  };
  const bilinear = (x) => (x > -1 && x < 1 ? 1 - Math.abs(x) : 0);
  const FILTERS = { lanczos: [lanczos, 3], bilinear: [bilinear, 1] };

  function coefficients(inSize, outSize, [kernel, support]) {
    const scale = inSize / outSize;
    const filterScale = Math.max(scale, 1);
    const radius = support * filterScale;
    const out = [];
    for (let i = 0; i < outSize; i++) {
      const center = (i + 0.5) * scale;
      const start = Math.max(0, Math.trunc(center - radius + 0.5));
      const end = Math.min(inSize, Math.trunc(center + radius + 0.5));
      const w = new Float64Array(end - start);
      let sum = 0;
      for (let j = 0; j < w.length; j++) {
        w[j] = kernel((j + start - center + 0.5) / filterScale);
        sum += w[j];
      }
      for (let j = 0; j < w.length; j++) w[j] /= sum;
      out.push({ start, w });
    }
    return out;
  }
  const to8bit = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  /** Resize a grayscale image (Uint8ClampedArray, w*h) to tw x th. */
  function resize(src, w, h, tw, th, filter) {
    const f = FILTERS[filter];
    const cx = coefficients(w, tw, f);
    const cy = coefficients(h, th, f);
    const tmp = new Uint8ClampedArray(tw * h);       // horizontal pass (rounded to 8 bit like Pillow)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < tw; x++) {
        const { start, w: ws } = cx[x];
        let acc = 0;
        for (let k = 0; k < ws.length; k++) acc += src[y * w + start + k] * ws[k];
        tmp[y * tw + x] = to8bit(acc);
      }
    }
    const out = new Uint8ClampedArray(tw * th);      // vertical pass
    for (let y = 0; y < th; y++) {
      const { start, w: ws } = cy[y];
      for (let x = 0; x < tw; x++) {
        let acc = 0;
        for (let k = 0; k < ws.length; k++) acc += tmp[(start + k) * tw + x] * ws[k];
        out[y * tw + x] = to8bit(acc);
      }
    }
    return out;
  }

  /* ---- drawing -> views ---- */

  /** RGBA canvas pixels (dark ink on transparent/white) -> bright-ink grayscale. */
  function inkFrom({ data, width, height }) {
    const ink = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
      const a = data[p + 3] / 255;                       // composite on white, then to gray
      const r = data[p] * a + 255 * (1 - a);
      const g = data[p + 1] * a + 255 * (1 - a);
      const b = data[p + 2] * a + 255 * (1 - a);
      ink[i] = 255 - Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return ink;
  }

  /** The canvas as drawn (made square), shrunk to 80x80. */
  function asDrawn(ink, w, h) {
    const side = Math.max(w, h);
    let square = ink;
    if (w !== h) {
      square = new Uint8ClampedArray(side * side);
      const ox = (side - w) >> 1, oy = (side - h) >> 1;
      for (let y = 0; y < h; y++) square.set(ink.subarray(y * w, y * w + w), (y + oy) * side + ox);
    }
    return resize(square, side, side, FRAME, FRAME, "lanczos");
  }

  /** Crop to the ink and centre it at `size` px on its longest side. */
  function fit(ink, w, box, size) {
    const cw = box.x1 - box.x0 + 1, ch = box.y1 - box.y0 + 1;
    const crop = new Uint8ClampedArray(cw * ch);
    for (let y = 0; y < ch; y++) {
      const from = (box.y0 + y) * w + box.x0;
      crop.set(ink.subarray(from, from + cw), y * cw);
    }
    const k = size / Math.max(cw, ch);
    const nw = Math.max(1, Math.round(cw * k)), nh = Math.max(1, Math.round(ch * k));
    const glyph = resize(crop, cw, ch, nw, nh, "lanczos");
    const frame = new Uint8ClampedArray(FRAME * FRAME);
    const ox = (FRAME - nw) >> 1, oy = (FRAME - nh) >> 1;
    for (let y = 0; y < nh; y++) frame.set(glyph.subarray(y * nw, y * nw + nw), (y + oy) * FRAME + ox);
    return frame;
  }

  /** ImageData -> list of 80x80 views, or null if the canvas is (nearly) blank. */
  function variants(imageData) {
    const { width: w, height: h } = imageData;
    const ink = inkFrom(imageData);
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (ink[y * w + x] > INK_THRESHOLD) {
          count++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (count < MIN_INK_PIXELS) return null;
    const box = { x0, y0, x1, y1 };
    return [asDrawn(ink, w, h), ...FIT_SIZES.map((s) => fit(ink, w, box, s))];
  }

  /** 80x80 views -> model input tensor data [n, 3, 224, 224]. */
  function toTensor(views) {
    const plane = INPUT * INPUT;
    const data = new Float32Array(views.length * 3 * plane);
    views.forEach((view, n) => {
      const big = resize(view, FRAME, FRAME, INPUT, INPUT, "bilinear");
      for (let c = 0; c < 3; c++) {
        const base = (n * 3 + c) * plane;
        for (let i = 0; i < plane; i++) data[base + i] = (big[i] / 255 - MEAN[c]) / STD[c];
      }
    });
    return data;
  }

  /* ---- model ---- */
  let session = null;
  let loading = null;

  /** Start (once) downloading and preparing the model. Resolves when ready. */
  function load() {
    if (!loading) {
      loading = (async () => {
        // absolute URL: also right when the site is served from a sub-path (https://name.github.io/repo/)
        ort.env.wasm.wasmPaths = new URL("vendor/", document.baseURI).href;
        ort.env.wasm.numThreads = 1; // multi-threading needs special server headers GitHub Pages can't send
        const res = await fetch(MODEL_URL);
        if (!res.ok) throw new Error("model download failed: " + res.status);
        session = await ort.InferenceSession.create(await res.arrayBuffer(), { executionProviders: ["wasm"] });
      })();
      loading.catch(() => { loading = null; }); // allow a retry after a failure
    }
    return loading;
  }

  /**
   * Rank the app's letters for a drawing.
   * @param {ImageData} imageData  the drawing canvas
   * @param {number[]} letterIndices  model class index of each letter the app teaches
   * @returns {Promise<{pos:number, prob:number}[] | null>} best first; pos indexes letterIndices. null if blank.
   */
  async function rank(imageData, letterIndices) {
    const views = variants(imageData);
    if (!views) return null;
    await load();
    const n = views.length;
    const input = new ort.Tensor("float32", toTensor(views), [n, 3, INPUT, INPUT]);
    const logits = (await session.run({ input })).logits;
    const classes = logits.dims[1];
    const probs = new Float64Array(letterIndices.length);
    for (let v = 0; v < n; v++) {                       // softmax per view, then average
      const row = logits.data.subarray(v * classes, (v + 1) * classes);
      let max = -Infinity;
      for (const x of row) if (x > max) max = x;
      let sum = 0;
      for (const x of row) sum += Math.exp(x - max);
      letterIndices.forEach((idx, i) => { probs[i] += Math.exp(row[idx] - max) / sum / n; });
    }
    const total = probs.reduce((a, b) => a + b, 0);
    return Array.from(probs, (p, pos) => ({ pos, prob: p / total })).sort((a, b) => b.prob - a.prob);
  }

  return { load, rank, variants, toTensor };
})();
