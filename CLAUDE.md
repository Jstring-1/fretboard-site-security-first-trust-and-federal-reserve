# SlantFinder.pro — agent context

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

User: kjnostudio (kylejester@gmail.com). Clerk user_id
`user_3D6pP9Gad4nTmmp5tJGq858ar77` — they're the admin.


## What this is

A web-based fretted-instrument tool: interactive fretboard, chord +
scale builders, piano keyboard view, key-signature reference, in-page
tab editor, chord identifier, 176-tuning database. Plus an
admin-gated chord-progression / tablature catalogue extracted via
Claude Vision from a private fake-book PDF library.

Live at https://slantfinder.pro / https://www.slantfinder.pro.


## Deploy

- **Railway** project hosts: SlantFinder service + Postgres service.
- Build: **Railpack** auto-detect. Sees `main.py` at repo root, runs
  `uvicorn main:app`. `main.py` is a 1-line shim re-exporting
  `server.main:app`. Old `nixpacks.toml` is gone.
- DNS: apex `slantfinder.pro` and `www.slantfinder.pro` both
  resolve to Railway via Namecheap (CNAME on `www`, ALIAS on `@`).
  No Cloudflare, no URL Redirect.
- The Tab editor's data + chord-extracted catalogues live in
  Postgres (Railway-internal `postgres.railway.internal:5432`).
- Local repo: `C:\Users\KJ-NoJesteringStudio\GitHub\SlantFinder.pro`.
  Static dev served by any local HTTP server (e.g. `python -m http.server`).


## Required env vars on Railway service

| name | source | purpose |
| --- | --- | --- |
| `DATABASE_URL` | Postgres reference | connection string |
| `CLERK_PUBLISHABLE_KEY` | manual | `pk_test_...`, used only to derive Clerk Frontend API domain server-side |
| `ADMIN_API_KEY` | manual, random | static-key gate for laptop scripts (importer, demo edit) |
| `ADMIN_USER_IDS` | manual | comma-separated Clerk user_ids granted admin powers |

**Never commit these values.** `pk_test_...` is in the frontend HTML
(safe — it's public by design); everything else stays in Railway env.


## Repo layout

```
/                    repo root
  index.html         main page; Clerk script tag here
  main.py            Railpack entry shim; imports server.main:app
  requirements.txt   FastAPI, uvicorn, psycopg, pyjwt, httpx
  robots.txt         sitemap.xml
  CLAUDE.md          this file

  css/
    styles.css       site theme + section tints + apply-all toggle + sm_*
    tab.css          Tab editor + chord-box panel + capture mode

  js/
    data.js          tunings, chord/scale grid definitions, allnotes, degrees
    chord_lookup.js  pitch-class mask → chord-name lookup
    sortable.js      tunings table sorter
    app.js           main controller. parseState / applyState / renderers
    chord_boxes.js   click-to-fill chord-diagram SVG widget (in Tab section)
    tab.js           Tab editor + chord-box state + capture mini-fretboard
    settings_sync.js Postgres-backed cloud sync of tab/chord-box state
    features.js      feature flags ('admin' / 'public' / 'hidden')
    sheetmusic.js    Sheet Music section: search, viewer, key cycle, edit
    auth.js          Clerk widget; admin allow-list; Apply: all toggle paint

  server/
    __init__.py
    main.py          FastAPI app + all endpoints + lifespan hook
    db.py            psycopg async pool + migration runner
    auth.py          Clerk JWT verifier (RS256 against JWKS); admin guards
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

Global params (linked-mode):

| param | meaning |
| --- | --- |
| `k=A`        | key |
| `x=AC#EG`    | chord/scale notes (URL form) |
| `hl=1,3,5,7` | highlighted degrees |
| `pk=...`     | picked notes for chord identifier |
| `s1=A&...`   | per-string tuning notes (or `s=A.C#.E.G` packed) |
| `y=y` `z=y`  | low/high direction, custom-tuning toggle |
| `pkc=...`    | chord-builder pinned key |

**Linked / Unlinked toggle (fretboard summary "Apply: all" chip):**

- Default: linked (no `u=` in URL). Every section reads global state.
- Click → unlinked: URL gets `?u=1`. Each section can hold its own
  state via section-namespaced params:
    - `s2_k`, `s3_k`, `s4_k`, ...     section-specific keys
    - `s2_hl`, `s3_hl`, ...            comma-joined per-section highlights
    - `s2_x`, `s3_x`, ...              per-section chord notes
    - `s2_pk`, `s3_pk`, ...            per-section picked notes
- Click → linked again: snaps global state to the **fretboard's**
  effective view (its overrides become the new globals). Other
  sections' overrides drop. No reset.

How this works in code:

- `parseState(searchOverride?)` reads URL → builds `x` with helpers
  (`x._hl_set` mask, etc.) plus `x._unlinked` and `x._sectionOverrides`.
- `virtualSearchForSection(sectionId, baseSearch)` strips all `s<n>_*`
  + `u`, then folds that section's overrides on top — feed the result
  back to `parseState` for a fully-derived per-section state.
- `stateForSection(sectionId, x)` is the dispatch wrapper that
  applyState calls per section.
- `mergeSectionOverrideUrl(sectionId, linkSearch)` projects link
  click params (`?k=A&hl=1&hl=3`) onto the current URL as
  `s<num>_*` overrides. Used by the link interceptor + key-picker
  change handler in unlinked mode.
- The link interceptor at `bindLinkInterceptor` is the central
  same-origin click choke-point.


## Backend (FastAPI)

`server/main.py` mounts:

- `GET /api/health`  — liveness + DB ping + auth-config diagnostic
- `GET /api/me`      — Clerk user_id from JWT, 401 otherwise
- `GET /api/settings` / `PUT /api/settings`  — per-user JSONB blob
- `GET /api/songs/search` `?q&book&only_chords&confidence&limit`
- `GET /api/songs/{id}` — full chord data; **degrees re-derived
  on read** by `server.music.derive_degrees(chords, key)` so wrong-
  key Vision output gets corrected without re-running extraction.
- `GET /api/songs/books` — distinct books + counts (filter dropdown)
- `POST /api/songs/import` — admin-key gated bulk upsert
- `PUT /api/songs/{id}` — admin edit (Clerk OR static key via `resolve_admin`)
- `GET /api/tabs/search` / `GET /api/tabs/{id}` / `GET /api/tabs/books`
- `POST /api/tabs/import` — admin-key gated bulk upsert

Lifespan hook (`server.db.run_migrations`) runs `migrations/*.sql`
in lexical order on startup. `_migrations` table tracks applied work.

CORS allows localhost dev origins so locally-served `_demo.html`
can reach the live API. Live origins are same-origin.

Auth dependencies in `server/auth.py`:

- `current_user` — verifies any signed-in user (Clerk JWT against JWKS)
- `current_admin_user` — must be in `ADMIN_USER_IDS`
- `resolve_admin` — accepts EITHER Clerk admin OR `X-Admin-Key`
  header (used by the laptop-side scripts + demo edit)


## Tab editor (in-page)

`js/tab.js` owns a localStorage-backed editor (`sfp_tab_v1`).
`window.SF_Tab.serialise()` / `applyState()` are the public hooks
for `js/settings_sync.js` to round-trip tab state to Postgres
when a Clerk user is signed in. Anonymous users fall back to
localStorage seamlessly.

Tab section is admin-gated via `feature_tab` class + the
`features.js` flag table (`tab: 'admin'`). Flip to `'public'`
when ready to ship.


## Sheet Music section (admin-only)

`js/sheetmusic.js` mounts inside `#sheetmusic_root`. Search +
results sidebar + chord-progression viewer.

The viewer renders the chord chart as bars (4 + gap + 4 per line)
with a per-song key cycle (◀ / ▶ / M-m / ↺) and a bar-mode select
('auto' / 'as_extracted' / '1 chord / bar'). Confidence + book
filters live in the header.

Admins see an inline **edit** button on every song. Clicking
reveals a chord-text textarea + key/time/confidence inputs. Save
PUTs to `/api/songs/{id}` with the user's Clerk JWT.

Section is gated `feature_sheetmusic`. Same flag-flip pattern.


## Sheet Music data pipeline (local laptop work)

```
PowerShell (admin's machine):
  python _chord_extract.py --all-books --mode all
      ↓ (per-page Vision JSONs at _index/_chords/<book>/pNNN.json)
  python _consolidate_chords.py
      ↓ (one big _index/_chords/_all.json)
  python _publish_chords.py
      ↓ (POST batches to https://slantfinder.pro/api/songs/import
         with X-Admin-Key header)
  Postgres `songs` table
      ↓
  /api/songs/search  /api/songs/{id}
      ↓
  Sheet Music section on slantfinder.pro
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

**Section IDs (don't change these — many things grep them):**

- `section_2`  Fretboard
- `section_3`  Chord Builder
- `section_4`  Keyboard
- `section_5`  Tunings List (nested in section_2)
- `section_6`  Scale Builder
- `section_7`  Learn (quiz)
- `section_8`  Tab editor (admin)
- `section_9`  Key Signatures
- `section_10` Sheet Music (admin)


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

- Tab viewer frontend section (data + API exist; UI not built).
- Local PDF server (`_books/_serve_pdfs.py`) wired into Sheet Music
  for in-browser PDF preview while admin-only. Skeleton was drafted;
  not committed; user said "wait on pdfs."
- Quality-of-life cleanup for chord-extracted data: glyph-fix pass
  (`Jbm` → `Bbm`), title-only-page hallucination flagging, grouping
  duplicates across editions for canonical-version display.
- Promote feature flags from `admin` → `public` when their UX is
  dialed in (currently: tab, sheetmusic).
