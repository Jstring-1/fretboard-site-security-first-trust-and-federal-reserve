# Fretboard.site — agent context (formerly SlantFinder.pro)

Read this on every new session before touching code. Captures the
durable structure + decisions so fresh chats don't have to reverse-
engineer the project from the codebase or pester the user with
already-answered questions.

User preferences (apply universally):

- Terse responses. No fluff, no "I'd be happy to" preambles.
- **Ask before push.** Never run `git push` without explicit go-ahead.
- **No emojis** unless the user asks for them. Same for output strings,
  CSS, and commit messages — keep things plain.
- **Don't expand scope.** If they ask for X, do X; don't bundle Y.
- **No unsolicited docs.** Don't write README files / inline doc-style
  comments unless asked. WHY-comments explaining non-obvious choices
  in code are encouraged; restating WHAT the code does is not.
- **Comment style:** explain rationale + tradeoffs. The code already
  shows what it does.

User: kjnostudio (kylejester@gmail.com). Admin gating is IP-based —
their home IP `66.234.206.36` is on the allowlist (see `ADMIN_IPS` env
below). Clerk auth was removed; nothing in the live UI requires sign-in.


## What this is

A web-based fretted-instrument tool: interactive fretboard, chord +
scale builders (with diatonic chord chart, common progressions, modes
panel, inversions), piano keyboard view, key-signature reference (with
circle of fifths, intervals, cadences), endless music-theory quiz,
chord identifier with optional in-key filter, in-page tab editor, and
a 176-tuning database. Plus an admin-only chord-progression /
tablature catalogue extracted via Claude Vision from a private
fake-book PDF library.

Live at https://fretboard.site / https://www.fretboard.site. The legacy
`slantfinder.pro` domain redirects (301) to fretboard.site via a
Namecheap URL Redirect Record.


## Deploy

- **Railway** project hosts: Fretboard service + Postgres service.
- Build: **Railpack** auto-detect. Sees `main.py` at repo root, runs
  `uvicorn main:app`. `main.py` is a 1-line shim re-exporting
  `server.main:app`. Old `nixpacks.toml` is gone.
- DNS: apex `fretboard.site` and `www.fretboard.site` both
  resolve to Railway via Namecheap (CNAME on `www`, ALIAS on `@`).
  No Cloudflare. The retired `slantfinder.pro` is set to a 301 URL
  Redirect on Namecheap pointing to `https://fretboard.site/`.
- The Tab editor's data + chord-extracted catalogues live in
  Postgres (Railway-internal `postgres.railway.internal:5432`).
- Local repo: `C:\Users\KJ-NoJesteringStudio\GitHub\SlantFinder.pro`.
  Static dev served by any local HTTP server (e.g. `python -m http.server`).


## Required env vars on Railway service

| name | source | purpose |
| --- | --- | --- |
| `DATABASE_URL` | Postgres reference | connection string |
| `ADMIN_API_KEY` | manual, random | static-key gate for laptop scripts (importer, demo edit) |
| `ADMIN_IPS` | manual | comma-separated client IPs that see admin-gated UI sections (Tab, Sheet Music). Defaults to operator IP if unset. |

**Never commit these values.** All read from env on the server; client
just calls `/api/admin-ip` to ask whether its IP is on the allowlist.


## Repo layout

```
/                    repo root
  index.html         main page (no auth scripts)
  main.py            Railpack entry shim; imports server.main:app
  requirements.txt   FastAPI, uvicorn, psycopg
  robots.txt         sitemap.xml
  CLAUDE.md          this file

  css/
    styles.css       site theme + section tints + sticky header + sm_*
    tab.css          Tab editor + chord-box panel + capture mode

  js/
    data.js          tunings, chord/scale grid definitions, allnotes, degrees
    chord_lookup.js  pitch-class mask → chord-name lookup
    sortable.js      tunings table sorter
    app.js           main controller. parseState / applyState / renderers,
                     theory tools (diatonic / progressions / modes / key-extras /
                     inversions), chord-ID strip, quiz, audio synth.
    chord_boxes.js   click-to-fill chord-diagram SVG widget (in Tab section)
    tab.js           Tab editor + chord-box state + capture mini-fretboard
    features.js      feature flags ('admin' / 'public' / 'hidden').
                     'admin' resolves via /api/admin-ip on load.
    sheetmusic.js    Sheet Music section: search, viewer, key cycle, edit

  server/
    __init__.py
    main.py          FastAPI app + all endpoints + lifespan hook +
                     /api/admin-ip (XFF-aware IP allowlist check)
    db.py            psycopg async pool + migration runner
    music.py         Nashville-degree math (mirrors js/sheetmusic.js)

  migrations/
    001_init.sql     user_settings (JSONB blob)
    002_songs.sql    songs (chord progressions catalogue)
    003_tabs.sql     tabs  (tablature catalogue)

  scripts/
    stamp_build.py   build-stamp injector (git pre-commit hook)
    git-hooks/       hook bodies (pre-commit etc.)

  _books/            GITIGNORED. Local-only admin tooling + raw data.
    *.pdf                       fake-book sources
    _tabs/*.pdf                 tablature sources
    _index/_chords/<book>/p*.json  per-page chord JSONs
    _index/_chords/_all.json    consolidated catalogue
    _index/_tabs/<book>/p*.json per-page tab JSONs
    _index/_tabs/_all.json      consolidated tabs catalogue
    _chord_extract.py           Claude Vision chord extractor
    _consolidate_chords.py      merge per-page → _all.json
    _publish_chords.py          POST batched _all.json → /api/songs/import
    _tab_extract.py             Claude Vision tab extractor
    _consolidate_tabs.py        merge per-page → _all.json
    _publish_tabs.py            POST batched _all.json → /api/tabs/import
    _local_helper.py            HTTP server :9998 — upload/scan/publish
    _serve_pdfs.py              read-only PDF server :9999 (proposed; not wired)
    _demo.html                  local-only fake-book browser + admin UI

  _legacy/           GITIGNORED. Old PHP source kept for reference only.
```


## Frontend state model

URL is the source of truth for almost everything. Bookmark = save.
**Linked-only** — the unlinked / per-section override mode was retired
(too brittle; users rarely needed independent sections).

Global params:

| param | meaning |
| --- | --- |
| `k=A`        | key |
| `x=AC#EG`    | chord/scale notes (URL form) |
| `hl=1b35`    | highlighted degrees (separator-free; `b?[1-7]` tokens) |
| `pk=ACsE`    | picked notes for chord identifier (`[A-G][sb]?` tokens) |
| `s1=A&...`   | per-string tuning notes (or `s=A.C#.E.G` packed) |
| `y=y` `z=y`  | low/high direction, custom-tuning toggle |
| `c=2,3`      | collapsed section IDs |
| `f=`/`fc=`   | tunings list filter text / string-count filter |
| `cmp=1`      | compact-grid toggle |
| `id=0`       | per-section chord-ID enable (default on) |
| `ext=2`/`all`| chord-ID "could be (+N)" extras cap |
| `ik=1`       | chord-ID "in key" filter (only chords whose notes fit current major scale) |

**URL conciseness:** `hl` and `pk` values are emitted without commas
(`?hl=1b35` / `?pk=ACsE`). The tokenizers in `_tokenizeHl` /
`_tokenizePk` accept all three historical forms — separator-free,
comma-separated, and repeated-key (`?hl=1&hl=b3&hl=5`) — so old
bookmarks keep working.

How this works in code:

- `parseState(searchOverride?)` reads URL → builds `x` with helpers
  (`x._hl_set` mask, etc.). `x._unlinked` is forced false now.
- The link interceptor at `bindLinkInterceptor` is the central
  same-origin click choke-point — every internal `<a>` click flows
  through `navigateTo(url.search)` which `pushState` + `applyState()`.
- Whole-row click delegates (`bindGridRowClicks`, the tunings click
  handler) translate clicks on any cell of a chord/scale/tuning row
  into a click on that row's primary anchor.


## Backend (FastAPI)

`server/main.py` mounts:

- `GET /api/health`     — liveness + DB ping
- `GET /api/admin-ip`   — returns `{admin: bool, ip: str}` based on the
                          caller's IP (X-Forwarded-For aware) vs.
                          `ADMIN_IPS` env. Drives frontend feature
                          flag visibility.
- `GET /api/songs/search` `?q&book&only_chords&confidence&limit`
- `GET /api/songs/{id}` — full chord data; **degrees re-derived
  on read** by `server.music.derive_degrees(chords, key)` so wrong-
  key Vision output gets corrected without re-running extraction.
- `GET /api/songs/books` — distinct books + counts (filter dropdown)
- `POST /api/songs/import` — admin-key gated bulk upsert
- `PUT /api/songs/{id}` — admin edit (X-Admin-Key only)
- `DELETE /api/songs/{id}` — admin delete (X-Admin-Key only)
- `GET /api/tabs/search` / `GET /api/tabs/{id}` / `GET /api/tabs/books`
- `POST /api/tabs/import` — admin-key gated bulk upsert

Lifespan hook (`server.db.run_migrations`) runs `migrations/*.sql`
in lexical order on startup. `_migrations` table tracks applied work.

CORS allows localhost dev origins so locally-served `_demo.html`
can reach the live API. Live origins are same-origin.

Admin path: `resolve_admin` accepts the static `X-Admin-Key` header
only. Clerk JWT auth was retired along with `server/auth.py`,
`/api/me`, and `/api/settings` — there's no per-user state on the
server anymore, all user state lives in shareable URLs / localStorage.


## Tab editor (in-page)

`js/tab.js` owns a localStorage-backed editor (`sfp_tab_v1`). No
cloud sync any more (the Clerk-backed `settings_sync.js` was deleted
when auth was retired).

Tab section is admin-gated via `feature_tab` class + the
`features.js` flag table (`tab: 'admin'`). The 'admin' resolution
runs through `/api/admin-ip` — visible only to allowlisted IPs.
Flip to `'public'` in `FLAGS` when ready to ship.


## Sheet Music section (admin-only)

`js/sheetmusic.js` mounts inside `#sheetmusic_root`. Search +
results sidebar + chord-progression viewer.

The viewer renders the chord chart as bars (4 + gap + 4 per line)
with a per-song key cycle (◀ / ▶ / M-m / ↺) and a bar-mode select
('auto' / 'as_extracted' / '1 chord / bar'). Confidence + book
filters live in the header.

Inline **edit** is currently disabled (the early-return in
`sheetmusic.js` blocks the save path). When re-enabled, edits will
PUT to `/api/songs/{id}` with the static `X-Admin-Key` header. The
local admin laptop has the key in env; nothing in the browser does.

Section is gated `feature_sheetmusic`. Same flag-flip pattern as Tab.


## Sheet Music data pipeline (local laptop work)

```
PowerShell (admin's machine):
  python _chord_extract.py --all-books --mode all
      ↓ (per-page Vision JSONs at _index/_chords/<book>/pNNN.json)
  python _consolidate_chords.py
      ↓ (one big _index/_chords/_all.json)
  python _publish_chords.py
      ↓ (POST batches to https://fretboard.site/api/songs/import
         with X-Admin-Key header)
  Postgres `songs` table
      ↓
  /api/songs/search  /api/songs/{id}
      ↓
  Sheet Music section on fretboard.site
```

Cached pages skip on re-run, so the importer is idempotent and the
extractor doesn't re-charge for already-done work. Anthropic API key:
`ANTHROPIC_API_KEY` set at User-scope in PowerShell.


## Tablature pipeline (parallel)

Tab books live in `_books/_tabs/`. Same shape as chords:

```
python _tab_extract.py --all-books     → _index/_tabs/<book>/pNNN.json
python _consolidate_tabs.py            → _index/_tabs/_all.json
python _publish_tabs.py                → POST /api/tabs/import
```

Schema in `migrations/003_tabs.sql`. Each row holds a JSONB `measures`
array of `{chord, events:[{string,fret,beat,mod}]}`. Frontend tab
viewer is not yet built — backend is ready.


## Local admin helper (`_books/_local_helper.py`)

HTTP server on `127.0.0.1:9998` that the local `_demo.html` calls.
Endpoints:

- `GET  /health`                 — sanity ping
- `POST /upload`                 — base64 JSON. `kind: 'chord' | 'tab'`
                                   routes to `_books/` vs `_books/_tabs/`.
                                   Images get auto-wrapped to single-page PDF.
- `POST /scan`                   — runs `_chord_extract.py --all-books`
- `POST /scan-tabs`              — runs `_tab_extract.py --all-books`
- `POST /publish`                — chains consolidate + publish (chords)
- `POST /publish-tabs`           — chains consolidate + publish (tabs)
- `GET  /status`                 — current task running flag + log tail

Inherits ANTHROPIC_API_KEY + ADMIN_API_KEY from the launching shell's
env. Bound to loopback only.

`_demo.html` (local only, gitignored) has an Admin tools panel with
a kind picker + drop zone + scan/publish buttons. Also lets the admin
inline-edit chord rows directly to the live API.


## Conventions

**Git commits:**

- Subject: `Area: short imperative summary`
- Body: WHY first, WHAT second. Reference file/feature names.
- Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Pre-commit hook stamps `<div id="build_num">YYYYMMDD.HHMM</div>` in
  `index.html`. Don't fight it.

**Comment style** (in code):

- Explain rationale + tradeoffs. Why this approach over alternatives.
- Don't restate what the code visibly does.
- Multi-line block comments above non-obvious functions are good.

**File creation rule:** never write a new doc file unless asked.
Edits over creates.

**Section IDs (don't change these — many things grep them).** Numeric
IDs are stable; the visible page order is independent.

- `section_2`  Fretboard
- `section_3`  Chord Builder
- `section_4`  Keyboard
- `section_5`  Tunings List (nested in section_2)
- `section_6`  Scale Builder
- `section_7`  Quiz (learn)
- `section_8`  Tab editor (IP-gated admin)
- `section_9`  Key Signatures
- `section_10` Sheet Music (IP-gated admin)
- `section_11` Progressions (nested in section_3)

Current visible order on the page: Fretboard → Tunings List → Keyboard
→ Chord Builder → Progressions → Scale Builder → Key Signatures →
Quiz → Tab → Sheet Music. Tab + Sheet Music sit at the end so the
main user-facing tools cluster at the top.

**Theory tools (rendered into placeholder divs inside their parent sections):**

- `#diatonic_root`     — 7 diatonic chords for current key (Chord Builder)
- `#inversions_root`   — current chord's inversions (Chord Builder)
- `#progressions_root` — common progressions in current key (Chord Builder)
- `#modes_root`        — 7 modes derived from current key (Scale Builder)
- `#key_extras_root`   — intervals + cadences cheat sheet (Key Signatures)
  with a relative-major / circle-of-fifths / "in <key>" panel mounted
  alongside the key signatures table (`renderKeySignatures`).


## Things to never do

- **Never commit** `_books/` — it's gitignored for copyright + size.
- **Never paste secret values** in code or commit messages. Variables
  read from env; document the env var name only.
- **Never rotate Postgres** off `postgres.railway.internal` for
  production — only for local-dev TCP-proxy use.
- **Never run `git push` without confirmation** from the user.
- **Never amend commits** unless the user explicitly says so. Add a
  new commit instead.


## Open follow-ups (if you pick one of these, ask first)

- Per-position chord-ID picks: clicking a single fret currently lights
  up every octave of that pitch class. User wants only the clicked
  position to mark, while still feeding the chord identifier the
  pitch-class mask. Larger refactor — touches click handlers, pk URL
  shape, fretboard / keyboard rendering, and the ←/→ shift logic.
- Tab viewer frontend section (data + API exist; UI not built).
- Local PDF server (`_books/_serve_pdfs.py`) wired into Sheet Music
  for in-browser PDF preview while admin-only. Skeleton was drafted;
  not committed; user said "wait on pdfs."
- Quality-of-life cleanup for chord-extracted data: glyph-fix pass
  (`Jbm` → `Bbm`), title-only-page hallucination flagging, grouping
  duplicates across editions for canonical-version display.
- Promote feature flags from `admin` → `public` when their UX is
  dialed in (currently: tab, sheetmusic).
- Re-enable Sheet Music inline edit if a non-admin-only edit path is
  desired (the save handler is currently a no-op early return).
