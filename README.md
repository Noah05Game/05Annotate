# 05Annotate

A premium party **drawing & guessing** game (Drawful-style) for the web.
One device is the **Main Screen** (your TV/laptop). Everyone else joins from
their **phone** by scanning a QR code. No app, no accounts, no database — all
realtime sync is peer-to-peer over **PeerJS**.

> Built as a 100% static site, so it deploys straight to **GitHub Pages**.

---

## How it plays (Classic mode)

1. **Main Screen** opens a room → shows a QR code + 6-character code.
2. Players open `join.html`, enter the code, pick a name and **draw their own avatar**.
3. First player in becomes **host** (👑) and gets a control panel on their phone.
4. Each round:
   - **Draw** — everyone gets a different secret prompt and draws it against a timer.
   - **Guess** — one drawing at a time is revealed cinematically; everyone else types a guess.
   - **Rate** — players give the drawing 1–5 stars (optional).
   - **Reveal** — the real prompt, best guesses and funniest wrong guesses appear.
5. **Leaderboard** with animated podium + confetti. Host picks **Next round** or **End game**.

*Fill in the Blank* mode is shown as **Coming soon** and is intentionally not implemented.

---

## Scoring

| Event | Points |
|------|--------|
| Exact / very-close guess | **+500** |
| Near-miss (key noun caught) | **+250** |
| Drawing rating | **+100 × average stars** (rounded) |

Guess matching is fuzzy: it normalises text, handles plurals/synonyms, ignores
filler words and tolerates minor typos (Levenshtein), so "a big red apple" still
matches "apple".

---

## Project structure

**Everything lives in one flat folder — no subdirectories.** GitHub Pages (and
any "drop the files in" import) serves it as-is.

```
index.html         Homepage (Join / Main Screen)
main.html          Main Screen (room authority + stage display)
join.html          Player phone client

base.css           Design system (tokens, glass, buttons, motion)
home.css  main.css  join.css

util.js  store.js  audio.js  confetti.js     shared helpers
prompts.js  matching.js                       game data + fuzzy matching
avatar.js  drawpad.js                         canvas tools
net.js                                         PeerJS transport (star topology)
home.js  main.js  join.js                      page logic

icon.svg  manifest.webmanifest                 PWA
icon-192.png  icon-512.png                     PWA icons
CNAME  .nojekyll                               GitHub Pages config
```

The Main Screen is `main.html`; players land on `join.html?room=CODE` (the QR
encodes that link). All references between files are plain filenames, so nothing
breaks no matter where the folder is served from.

The Main Screen is the **authority**: it runs the whole game loop, validates
host commands and tells each phone only what that phone needs to see (players
never receive other players' prompts or admin controls).

---

## Run locally

It's just static files, so any static server works:

```bash
# from the project root
python3 -m http.server 8080
# then open http://localhost:8080/
```

Open `main.html` on one device/tab and `join.html` on another to test.
(PeerJS needs two real peers, so use two tabs/devices.)

---

## Deploy to GitHub Pages

1. Put **all these files at the root of your repo** (e.g. `05annotate`). Because
   the folder is flat, dumping the contents straight in is exactly what you want —
   there are no subfolders to preserve and nothing to flatten or break.
2. **Settings → Pages →** Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. The included **`CNAME`** sets the custom domain to `Annotate.the05company.com`.
   Add this DNS record at your domain host:
   ```
   CNAME   annotate   <your-username>.github.io
   ```
4. **`.nojekyll`** is included so GitHub serves all files as-is (no Jekyll processing).

All references are plain relative filenames, so the site also works unchanged
from a project sub-path like `https://user.github.io/05annotate/`.

---

## Networking notes

- By default this uses the **free public PeerJS cloud** broker for signalling.
  It's great for parties but rate-limited and not guaranteed — for heavy use,
  self-host a PeerServer and set it before `net.js` loads:

  ```html
  <script>
    window.PEER_CONFIG = { host: 'peer.yourdomain.com', port: 443, path: '/', secure: true };
  </script>
  ```

- Room ids are namespaced (`o5annotate-v1-<CODE>`) to avoid global collisions;
  if a code is already taken the Main Screen silently regenerates one.
- Phones keep a small session token, so a dropped player **reconnects into the
  same slot with their score intact**. Host role migrates automatically if the
  host leaves.

---

## Extras included

Sound effects (synthesised, no audio files) + optional music · confetti ·
idle/ambient animations · achievement badges & statistics (stored locally) ·
round history · best-score tracking · dark/light themes · reduced-motion mode ·
performance mode (drops blur/particles) · local custom prompt packs ·
a secret easter egg on the homepage.

---

## Tech

Vanilla HTML/CSS/JS — no build step, no framework. Libraries loaded from CDN at
runtime: [PeerJS](https://peerjs.com/) for P2P and
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) for the
join QR.

Made for **The05Company**.
