"use strict";

/* ------------------------------------------------------------------
   Akuru Liyamu – Sinhala writing practice
   Everything runs in the browser: the model checks drawings on the device
   (see recognizer.js) and progress lives in localStorage, one profile per child.
------------------------------------------------------------------- */

const GROUPS = {
  vowels:     { si: "ස්වර",     en: "Vowels",         sample: "අ ආ ඉ", sub: "The vowel letters" },
  consonants: { si: "ව්‍යංජන", en: "Consonants",     sample: "ක ම ර", sub: "The consonant letters" },
  signs:      { si: "පිලි",     en: "Letter signs",   sample: "කා කි කු", sub: "Ka with its signs" },
};
const AVATARS = ["🐘", "🦚", "🐆", "🦋", "🐬", "🦊", "🐼", "🦁"];
const STORE_KEY = "akuru-liyamu-v1";
const DONE_STARS = 2; // 2+ stars counts as "learned"
// rank of the target among the app's letters -> stars
// 3 = the model's first choice, 2 = second choice, 1 = third choice, 0 = try again
const STARS_BY_RANK = [3, 2, 1];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ---------------- storage ---------------- */
let store = { current: null, profiles: {} };
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.profiles) store = s;
  } catch (_) { /* private mode / blocked storage: run without saving */ }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* ignore */ }
}
const profile = () => store.profiles[store.current];
const starsFor = (ch) => (profile().stars[ch] || 0);
const totalStars = () => Object.values(profile().stars).reduce((a, b) => a + b, 0);

function addProfile(name) {
  const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const used = Object.keys(store.profiles).length;
  store.profiles[id] = { name: name.trim(), emoji: AVATARS[used % AVATARS.length], stars: {}, days: [] };
  store.current = id;
  saveStore();
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function markToday() {
  const k = dayKey(new Date());
  const days = profile().days;
  if (!days.includes(k)) { days.push(k); profile().days = days.slice(-60); }
}
function streak() {
  const days = new Set(profile().days);
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1); // today not practised yet: streak still alive
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------------- views ---------------- */
let letters = [];          // [{char, group, idx}]  idx = the model's class number for the letter
let group = null;          // current group id
let current = null;        // letter currently being practised
const views = ["welcome", "home", "letters", "practice"];
function show(name) {
  views.forEach((v) => { $("view-" + v).hidden = v !== name; });
  window.scrollTo(0, 0);
}
const lettersOf = (g) => letters.filter((l) => l.group === g);
const starsHTML = (n, total = 3) => {
  const box = el("span", "stars");
  for (let i = 0; i < total; i++) box.appendChild(el("span", i < n ? "on" : "", i < n ? "★" : "☆"));
  return box;
};

function renderTopbar() {
  const p = profile();
  $("profile-emoji").textContent = p ? p.emoji : "🐘";
  $("profile-name").textContent = p ? p.name : "";
  $("total-stars").textContent = "⭐ " + (p ? totalStars() : 0);
  $("btn-profile").hidden = !p;
  $("total-stars").hidden = !p;
}

function renderHome() {
  renderTopbar();
  $("hello-title").textContent = `Hello, ${profile().name}! ${profile().emoji}`;
  const s = streak();
  $("hello-sub").textContent = s > 1 ? `🔥 ${s} days in a row! Pick a set and start writing.` : "Pick a set of letters and start writing.";

  const box = $("group-cards");
  box.replaceChildren();
  for (const [id, g] of Object.entries(GROUPS)) {
    const list = lettersOf(id);
    if (!list.length) continue;
    const done = list.filter((l) => starsFor(l.char) >= DONE_STARS).length;
    const card = el("button", "group-card");
    card.dataset.group = id;
    card.appendChild(el("div", "gc-sample", g.sample));
    const title = el("div", "gc-title");
    title.append(el("span", "", g.si), ` · ${g.en}`);
    card.appendChild(title);
    card.appendChild(el("div", "gc-sub", `${done} of ${list.length} letters learned`));
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = `${(done / list.length) * 100}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
    card.addEventListener("click", () => openGroup(id));
    box.appendChild(card);
  }
  show("home");
}

function openGroup(id) {
  group = id;
  const g = GROUPS[id];
  $("letters-title").textContent = "";
  $("letters-title").append(el("span", "letter", g.si), ` · ${g.en}`);
  const box = $("tiles");
  box.replaceChildren();
  for (const l of lettersOf(id)) {
    const n = starsFor(l.char);
    const tile = el("button", "tile" + (n >= 3 ? " gold" : n >= DONE_STARS ? " done" : ""));
    tile.setAttribute("aria-label", `${l.char}, ${n} of 3 stars`);
    tile.append(el("span", "letter", l.char), starsHTML(n));
    tile.addEventListener("click", () => openPractice(l));
    box.appendChild(tile);
  }
  renderTopbar();
  show("letters");
}

/* ---------------- drawing pad ---------------- */
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const INK = "#2b2350";
const LINE_WIDTH = 14; // canvas is 320px; the model sees it at 80px, so ~3.5px strokes like its training data
let strokes = [];
let activePointer = null;

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = ctx.fillStyle = INK;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0].x, s[0].y, LINE_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length - 1; i++) {
      const mx = (s[i].x + s[i + 1].x) / 2, my = (s[i].y + s[i + 1].y) / 2;
      ctx.quadraticCurveTo(s[i].x, s[i].y, mx, my);
    }
    const last = s[s.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}
function pointOf(e) {
  const r = canvas.getBoundingClientRect();
  const k = canvas.width / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
}
canvas.addEventListener("pointerdown", (e) => {
  if (activePointer !== null) return; // ignore a second finger / palm
  activePointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  strokes.push([pointOf(e)]);
  redraw();
  e.preventDefault();
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== activePointer) return;
  const s = strokes[strokes.length - 1];
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) s.push(pointOf(ev));
  redraw();
});
const endStroke = (e) => { if (e.pointerId === activePointer) activePointer = null; };
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function clearPad() { strokes = []; activePointer = null; redraw(); }
$("btn-clear").addEventListener("click", clearPad);
$("btn-undo").addEventListener("click", () => { strokes.pop(); redraw(); });

let guideOn = true;
function setGuide(on) {
  guideOn = on;
  $("pad").classList.toggle("no-guide", !on);
  const b = $("btn-guide");
  b.textContent = on ? "👀 Guide: on" : "👀 Guide: off";
  b.setAttribute("aria-pressed", String(on));
  try { localStorage.setItem(STORE_KEY + "-guide", on ? "1" : "0"); } catch (_) { /* ignore */ }
}
$("btn-guide").addEventListener("click", () => setGuide(!guideOn));

/* ---------------- practice ---------------- */
function renderTargetStars() {
  const box = $("target-stars");
  box.replaceChildren(starsHTML(starsFor(current.char)));
}
function openPractice(letter) {
  current = letter;
  group = letter.group;
  const list = lettersOf(group);
  const i = list.findIndex((l) => l.char === letter.char);
  $("target-letter").textContent = letter.char;
  $("guide").textContent = letter.char;
  $("practice-count").textContent = `${i + 1} / ${list.length}`;
  $("btn-prev").disabled = i === 0;
  $("btn-next-nav").disabled = i === list.length - 1;
  renderTargetStars();
  clearPad();
  show("practice");
}
function step(delta) {
  const list = lettersOf(group);
  const i = list.findIndex((l) => l.char === current.char) + delta;
  if (i >= 0 && i < list.length) openPractice(list[i]);
}
$("btn-prev").addEventListener("click", () => step(-1));
$("btn-next-nav").addEventListener("click", () => step(1));

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

const RESULTS = {
  3: { emoji: "🌟", si: "නියමයි!",              msg: "Perfect! You wrote it beautifully!" },
  2: { emoji: "🎉", si: "හොඳයි!",               msg: "Great job! You've learned this letter." },
  1: { emoji: "🙂", si: "ආයෙත් උත්සාහ කරමු!",   msg: "Almost there! Try once more." },
  0: { emoji: "💪", si: "ආයෙත් උත්සාහ කරමු!",   msg: "Not quite yet. Look at the guide and try again." },
};

let checking = false;
let modelReady = false;
const CHECK_LABEL = "Check my letter ✅";

function setCheckButton(text, disabled) {
  const btn = $("btn-check");
  btn.textContent = text;
  btn.disabled = disabled;
}
// start downloading the model straight away so it is ready by the time a child has drawn something
function warmUp() {
  setCheckButton("Getting ready… ⏳", true);
  return Recognizer.load().then(
    () => { modelReady = true; setCheckButton(CHECK_LABEL, false); },
    () => { setCheckButton("Try again 🔄", false); toast("Couldn't load the letter checker. Check your internet and tap the button to retry."); },
  );
}

async function checkLetter() {
  if (checking) return;
  if (!modelReady) { warmUp(); return; }
  if (!strokes.length) { toast("Draw the letter first ✏️"); return; }
  checking = true;
  setCheckButton("Checking… 🤔", true);
  try {
    await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0))); // let the button repaint first
    const ranking = await Recognizer.rank(ctx.getImageData(0, 0, canvas.width, canvas.height), letters.map((l) => l.idx));
    if (!ranking) { toast("Draw the letter a bit bigger ✏️"); return; }
    const target = letters.findIndex((l) => l.char === current.char);
    const rank = ranking.findIndex((r) => r.pos === target);
    showResult({ stars: STARS_BY_RANK[rank] || 0, guess: letters[ranking[0].pos].char });
  } catch (_) {
    toast("Oops! Something went wrong. Please try again.");
  } finally {
    checking = false;
    setCheckButton(CHECK_LABEL, false);
  }
}
$("btn-check").addEventListener("click", checkLetter);

function showResult({ stars, guess }) {
  const r = RESULTS[stars];
  if (stars > starsFor(current.char)) profile().stars[current.char] = stars;
  markToday();
  saveStore();
  renderTargetStars();
  renderTopbar();

  $("result-emoji").textContent = r.emoji;
  $("result-title").textContent = r.si;
  $("result-msg").textContent = r.msg;
  const box = $("result-stars");
  box.replaceChildren(...[0, 1, 2].map((i) => el("span", i < stars ? "on" : "", i < stars ? "★" : "☆")));
  const hint = $("result-hint");
  hint.replaceChildren();
  if (stars < DONE_STARS && guess && guess !== current.char) {
    hint.append("It looked a bit like ", el("span", "letter", guess));
  }
  const list = lettersOf(group);
  const isLast = list[list.length - 1].char === current.char;
  $("btn-next").textContent = isLast ? "All letters 🏠" : "Next letter ➜";
  $("btn-next").className = "btn " + (stars >= DONE_STARS ? "btn-primary" : "btn-tool");
  $("btn-again").className = "btn " + (stars >= DONE_STARS ? "btn-tool" : "btn-primary");
  $("overlay").hidden = false;
  if (stars >= DONE_STARS) confetti();
  (stars >= DONE_STARS ? $("btn-next") : $("btn-again")).focus();
}
function closeResult() { $("overlay").hidden = true; $("confetti").replaceChildren(); }
$("btn-again").addEventListener("click", () => { closeResult(); clearPad(); });
$("btn-next").addEventListener("click", () => {
  closeResult();
  const list = lettersOf(group);
  const i = list.findIndex((l) => l.char === current.char);
  if (i < list.length - 1) openPractice(list[i + 1]);
  else openGroup(group);
});
function confetti() {
  const box = $("confetti");
  const bits = ["⭐", "🎉", "✨", "🌈", "🎈"];
  for (let i = 0; i < 24; i++) {
    const b = el("i", "", bits[i % bits.length]);
    b.style.left = Math.random() * 100 + "%";
    b.style.animationDuration = 2 + Math.random() * 2 + "s";
    b.style.animationDelay = Math.random() * 0.6 + "s";
    box.appendChild(b);
  }
}

/* ---------------- profiles ---------------- */
const dialog = $("profile-dialog");
function renderProfiles() {
  const list = $("profile-list");
  list.replaceChildren();
  for (const [id, p] of Object.entries(store.profiles)) {
    const row = el("button", "profile-row" + (id === store.current ? " current" : ""));
    row.type = "button";
    row.append(el("span", "e", p.emoji), p.name, el("span", "s", `⭐ ${Object.values(p.stars).reduce((a, b) => a + b, 0)}`));
    row.addEventListener("click", () => {
      store.current = id;
      saveStore();
      dialog.close();
      renderHome();
    });
    list.appendChild(row);
  }
}
$("btn-profile").addEventListener("click", () => { renderProfiles(); dialog.showModal(); });
$("btn-close-profile").addEventListener("click", () => dialog.close());
$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("add-name").value.trim();
  if (!name) return;
  addProfile(name);
  $("add-name").value = "";
  dialog.close();
  renderHome();
});
$("btn-reset").addEventListener("click", () => {
  if (!confirm(`Reset all stars for ${profile().name}?`)) return;
  profile().stars = {};
  profile().days = [];
  saveStore();
  dialog.close();
  renderHome();
});
$("welcome-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("welcome-name").value.trim();
  if (!name) return;
  addProfile(name);
  renderHome();
});

$("btn-home").addEventListener("click", () => { if (profile()) renderHome(); });
$("btn-back-home").addEventListener("click", renderHome);
$("btn-back-letters").addEventListener("click", () => openGroup(group));

/* ---------------- start ---------------- */
async function init() {
  loadStore();
  try { setGuide(localStorage.getItem(STORE_KEY + "-guide") !== "0"); } catch (_) { setGuide(true); }
  try {
    const r = await fetch("letters.json");
    if (!r.ok) throw new Error(String(r.status));
    letters = await r.json();
  } catch (_) {
    $("app").replaceChildren(el("p", "card welcome", "Could not load the letters. Please refresh the page."));
    return;
  }
  warmUp();
  if (profile()) renderHome();
  else { renderTopbar(); show("welcome"); $("welcome-name").focus(); }
}
init();
