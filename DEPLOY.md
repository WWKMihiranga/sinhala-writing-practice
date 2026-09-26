# Hosting for free with GitHub Pages

The app is a static website (everything runs in the browser), so GitHub Pages can host it
for free: no server, no sleeping, no cold starts, no credit card, HTTPS included.

> **Pages is only free for *public* repositories**, and a public repo shows all its files, and
> the author email of every commit, to everyone. Use a **dedicated repo** for this app (not one
> that holds other coursework), and do step 1 before making it public.

## 1. Hide your email address (do this before going public)
Git stores your email in every commit, and in a public repo anyone can read it.

1. GitHub → **Settings → Emails**. Tick **Keep my email addresses private** and
   **Block command line pushes that expose my email**.
2. On that page copy your no-reply address. It looks like `12345678+<your-username>@users.noreply.github.com`.
3. Tell git to use it (run inside the `Handwritings` folder):
   ```bash
   git config user.email "12345678+<your-username>@users.noreply.github.com"
   ```

## 2. Commit and push (with a clean history)
Your first commit still carries the old email, so start the history fresh. This is safe while
the repo is still private and only holds this project:

```bash
cd Handwritings
git checkout --orphan clean         # a new history with no old commits
git add -A
git status --short                  # CHECK: must NOT list .venv/, models/ or *.pyc
git commit -m "Sinhala writing practice app"
git branch -M main                  # the new history replaces the old main
git push -f origin main
git log --format='%an <%ae>'        # CHECK: shows the no-reply address, not your Gmail
```

`Handwritings` sits inside your `Deep Learning` repo. Don't `git add` it from that parent
repo; add a line `Handwritings/` to the parent's `.gitignore` to be safe.

(For zero trace of the old commit, delete the GitHub repo and create a new empty *private*
one with the same name before pushing. GitHub can keep old commits reachable by their hash.)

## 3. Make the repo public, then turn on Pages
1. Repo → **Settings → General → Danger Zone → Change visibility → Make public**.
2. Repo → **Settings → Pages → Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/docs** → **Save**

After 1–2 minutes the page shows the address:
`https://<your-username>.github.io/sinhala-writing-practice/`. Tick **Enforce HTTPS** if offered.

## 4. Test it
Open the address on a phone and on a laptop. The first visit downloads ~26 MB (model and
runtime), so the button says "Getting ready…" for a moment. Write a letter and press Check.
Later visits are quick because the browser caches the files.

## 5. Share it
Send the address to parents. On a phone, *Add to Home Screen* makes it look like an app.

## Updating later
Edit files → `git add . && git commit -m "…" && git push`. Pages redeploys in ~1 minute
(browsers may keep the old files for up to 10 minutes).

## Safety checklist
- **Nothing private in the repo.** The repo is public. Don't commit keys, tokens, `.env`
  files, real names of children, or personal paths, and keep your email private (step 1).
  (This project has none; the `.gitignore` keeps `.venv/` and `models/` out.)
- **Turn on 2-factor authentication** for your GitHub account (Settings → Password and
  authentication). It protects the site, since anyone who controls the repo controls the site.
- **Children's privacy.** Drawings are checked on the child's own device and never uploaded.
  Names and stars are stored only in that browser. Tell parents to use a first name or
  nickname. If you ever add analytics, ads or a login, this stops being true, so update the
  footer and think about children's-privacy rules first.
- **No cost surprises.** Pages on a free account has no billing. GitHub asks for a "soft"
  limit of about 100 GB/month bandwidth (~3,800 first-time visitors at 26 MB each; repeat
  visits use the cache). If you outgrow it, Cloudflare Pages has a free tier with
  unlimited bandwidth and works with this same `docs/` folder (build command: none,
  output directory: `docs`).
- **Pages is for personal/educational sites**, not commercial hosting, per GitHub's terms.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Page is 404 | Wait a couple of minutes; check Settings → Pages shows *main* and */docs* |
| "Couldn't load the letter checker" | Check the internet connection and tap the button to retry. On very old phones/browsers (no WebAssembly SIMD) it can't run: use a current Chrome/Safari |
| Old version still showing | Hard refresh (Ctrl/Cmd+Shift+R) or wait 10 minutes |
| `git push` rejected | Use `git push -f origin main` as in step 2 (only safe because the repo is yours and holds just this app) |
