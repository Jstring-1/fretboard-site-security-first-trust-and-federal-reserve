"""Fretboard.site — FastAPI app.

Serves the static HTML/CSS/JS that makes up the site, plus public read
APIs for the chord-extracted song catalogue and admin write APIs gated
behind a static `X-Admin-Key` header (used by the local importer
pipeline).

Authentication via Clerk was removed — the live UI is fully anonymous,
all per-user state lives in shareable URLs / localStorage. Admin-only
endpoints now exclusively use the static-key path.

Deployed on Railway via Railpack auto-detect (sees main.py at root,
runs `uvicorn main:app`). Local dev:
  uvicorn server.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import db
from server.music import derive_degrees


class SongImportItem(BaseModel):
    book: str
    pdf_page: int
    title: str
    key: Optional[str] = None
    time_signature: Optional[str] = None
    confidence: Optional[str] = None
    chords: list = []
    degrees: list = []
    sections: Optional[list] = None
    notes: Optional[str] = None


class SongImportPayload(BaseModel):
    """Body shape for POST /api/songs/import — one batch of song rows.
    The local importer chunks the full _all.json into batches and POSTs
    them serially so individual failures stay small + recoverable."""
    songs: list[SongImportItem]


class SongEditPayload(BaseModel):
    """Body shape for PUT /api/songs/{id} — an admin's inline edit.
    Every field is optional; only the ones included in the JSON body
    get written. Lets the frontend send a tight payload (just the
    field that changed) without forcing a round-trip read first."""
    chords:         Optional[list] = None
    key:            Optional[str]  = None
    time_signature: Optional[str]  = None
    confidence:     Optional[str]  = None
    notes:          Optional[str]  = None


class TabImportItem(BaseModel):
    """One row in the bulk-tab-import payload. Mirrors what
    _books/_tab_extract.py emits per song after consolidation —
    measures is the full JSONB blob of bar-by-bar note events."""
    book:           str
    pdf_page:       int
    title:          str
    tuning:         Optional[str]  = None
    strings:        Optional[int]  = None
    key:            Optional[str]  = None
    time_signature: Optional[str]  = None
    measures:       list           = []
    notes:          Optional[str]  = None
    confidence:     Optional[str]  = None


class TabImportPayload(BaseModel):
    tabs: list[TabImportItem]


def require_admin_key(request: Request) -> None:
    """Static-key guard for admin-only server-to-server endpoints.

    The chord-data importer runs on the operator's laptop. A dedicated
    `ADMIN_API_KEY` env var is the gate: random string set on Railway
    and matched by the local script's env. Returns 503 if the server
    doesn't have one configured (no key means no admin pipe), 401 if
    the client's header is wrong."""
    expected = os.environ.get("ADMIN_API_KEY", "")
    if not expected:
        raise HTTPException(status_code=503, detail="admin import not configured")
    given = request.headers.get("x-admin-key", "")
    if not given or given != expected:
        raise HTTPException(status_code=401, detail="invalid admin key")


async def resolve_admin(request: Request) -> dict:
    """Admin gate for write endpoints. Static `X-Admin-Key` header is
    now the only path (Clerk JWT auth was retired)."""
    require_admin_key(request)
    return {"user_id": "admin-key", "via": "static"}

ROOT = Path(__file__).resolve().parent.parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run migrations on startup, close the pool on shutdown.

    Tolerant of a missing DATABASE_URL — if the operator hasn't wired
    the DB reference yet, the static site still serves and /api/health
    just reports `db: skipped`. Lets us deploy and verify the build
    pipeline before the DB is configured."""
    if os.environ.get("DATABASE_URL"):
        try:
            applied = await db.run_migrations()
            if applied:
                print(f"[db] migrations applied: {applied}", flush=True)
            else:
                print("[db] schema up to date", flush=True)
        except Exception as e:
            print(f"[db] startup error: {e}", flush=True)
            traceback.print_exc()
    else:
        print("[db] DATABASE_URL not set — running without DB", flush=True)
    yield
    await db.close_pool()


app = FastAPI(
    title="Fretboard.site",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

# CORS for local-dev / admin tooling. The locally-served _books/_demo.html
# (running at http://localhost) needs to call /api/songs/* on the live
# host. We only allow localhost origins explicitly — the live site is
# same-origin so it doesn't need CORS at all. The admin pipe sends
# `X-Admin-Key`; user-facing reads are public.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:80",
        "http://localhost:8000",
        "http://localhost:8888",
        "http://127.0.0.1",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8888",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)


# Legacy-domain redirect. The old slantfinder.pro brand still has DNS
# pointing here (configured as a Railway custom domain alongside
# fretboard.site); we 301 every request to the canonical fretboard.site
# host, preserving path + query. Done in the app rather than at the DNS
# layer because Namecheap's URL Redirect Records don't serve a valid
# TLS cert, breaking https://slantfinder.pro entirely. Railway provisions
# a Let's Encrypt cert per custom domain, so handling the redirect here
# fixes HTTPS too.
_REDIRECT_HOSTS = {"slantfinder.pro", "www.slantfinder.pro"}


@app.middleware("http")
async def redirect_legacy_domain(request: Request, call_next):
    host = (request.headers.get("host") or "").split(":", 1)[0].lower()
    if host in _REDIRECT_HOSTS:
        target = "https://fretboard.site" + request.url.path
        if request.url.query:
            target += "?" + request.url.query
        return RedirectResponse(url=target, status_code=301)
    return await call_next(request)


# Admin IP allowlist for visibility-gating WIP frontend sections (Tab,
# Sheet Music). Override at deploy-time with ADMIN_IPS=ip1,ip2,...; the
# default below is the operator's home IP. Public reads only — nothing
# server-side gates on this; it just lets the frontend show/hide WIP UI.
_DEFAULT_ADMIN_IPS = "66.234.206.36"
_ADMIN_IPS = {ip.strip() for ip in os.environ.get("ADMIN_IPS", _DEFAULT_ADMIN_IPS).split(",") if ip.strip()}


def _client_ip(request: Request) -> str:
    """Best-effort caller IP. Trusts X-Forwarded-For (Railway proxies all
    traffic through their edge), falling back to the direct socket peer.
    First entry of XFF is the original client; subsequent entries are
    proxies in the chain."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else ""


# ---- API routes (registered first so they take priority over statics) ----
@app.get("/api/admin-ip")
async def admin_ip(request: Request):
    """Tell the frontend whether the caller's IP is on the admin allowlist.
    Used by features.js to gate WIP sections (Tab, Sheet Music) without
    needing a real auth system. Not a security boundary — the data those
    sections expose is already public via the /api/songs and /api/tabs
    endpoints; this just hides incomplete UI from random visitors."""
    ip = _client_ip(request)
    return {"admin": ip in _ADMIN_IPS, "ip": ip}


# ---- Chord-diagram proxy + persistent cache (Uberchord) ----------------
# The Uberchord API doesn't return CORS headers, so a direct browser
# fetch from fretboard.site is blocked. Proxy through here AND store
# every fetched (chord-name → shapes) pair in Postgres so we never hit
# upstream more than once per chord. Once the prefetch endpoint has
# walked every (root × chord-type) combo, this server can serve every
# popover request from local DB indefinitely.
#
# In-memory cache is a small hot-path layer in front of Postgres so a
# burst of hovers on the same chord doesn't round-trip the DB.
_CHORD_CACHE: dict[str, list] = {}

# Chord types in our Chord Builder grid (data.js GRID), mapped to the
# Uberchord URL form. Empty string = bare major triad (e.g. "C").
# Sharps use 's' suffix in the API ("Csmaj7"), flats use 'b' ("Bb7").
# Keep this in sync with js/data.js when grid types change.
_CHORD_TYPES: list[str] = [
    "",        # Maj
    "m",       # Min
    "aug",
    "dim",
    "sus2",
    "sus4",
    "6",       # Maj6
    "m6",
    "7",       # dom7
    "m7",
    "aug7",
    "7b5",
    "dim7",
    "m7b5",
    "maj7",
    "mmaj7",   # min-Maj7
    "add9",
    "m9",
    "6add9",
    "9",       # 9th
    "7b9",
    "maj9",
    "7s9",     # 7♯9
    "11",
    "m11",
    "7s11",    # 7♯11
    "13",
    "m13",
]
_CHORD_ROOTS: list[str] = [
    "C", "Cs", "D", "Ds", "E", "F",
    "Fs", "G", "Gs", "A", "As", "B",
]


async def _chord_shapes_from_db(name: str) -> Optional[list]:
    """Look up a chord's shapes in the persistent cache. Returns the
    JSON list if present (which may be empty — that's a cached miss),
    or None if we've never asked for this chord before."""
    if not os.environ.get("DATABASE_URL"):
        return None
    try:
        pool = db.get_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT shapes FROM chord_shapes WHERE name = %s",
                    (name,),
                )
                row = await cur.fetchone()
                return row[0] if row else None
    except Exception as e:
        print(f"chord_shapes DB read failed for {name}: {e}", flush=True)
        return None


async def _chord_shapes_to_db(name: str, shapes: list) -> None:
    """Persist (name, shapes) into the chord_shapes table. Idempotent
    via ON CONFLICT — repeat calls just refresh fetched_at."""
    if not os.environ.get("DATABASE_URL"):
        return
    try:
        pool = db.get_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "INSERT INTO chord_shapes (name, shapes) "
                    "VALUES (%s, %s::jsonb) "
                    "ON CONFLICT (name) DO UPDATE SET "
                    "  shapes     = EXCLUDED.shapes, "
                    "  fetched_at = NOW()",
                    (name, json.dumps(shapes)),
                )
            await conn.commit()
    except Exception as e:
        print(f"chord_shapes DB write failed for {name}: {e}", flush=True)


_LAST_FETCH_ERROR: dict = {"name": "", "kind": "", "detail": ""}


async def _fetch_uberchord(name: str, client: httpx.AsyncClient) -> Optional[list]:
    """Hit Uberchord upstream for one chord name. Returns the shapes
    list (possibly empty) on a successful exchange, or None on a
    transport-level failure (caller decides whether to cache or retry).
    Stashes the most recent failure into _LAST_FETCH_ERROR so the
    status endpoint can surface it without reading Railway logs."""
    try:
        r = await client.get(f"https://api.uberchord.com/v1/chords/{name}")
    except Exception as e:
        _LAST_FETCH_ERROR.update(
            name=name, kind="exception",
            detail=f"{type(e).__name__}: {e}"[:300],
        )
        print(f"uberchord fetch failed for {name}: {e}", flush=True)
        return None
    if r.status_code == 404:
        return []
    if r.status_code != 200:
        body = (r.text or "")[:200]
        _LAST_FETCH_ERROR.update(
            name=name, kind=f"http {r.status_code}", detail=body,
        )
        return None
    try:
        data = r.json()
    except Exception as e:
        _LAST_FETCH_ERROR.update(
            name=name, kind="parse",
            detail=f"{type(e).__name__}: {e}"[:300],
        )
        return []
    return data if isinstance(data, list) else []


# Snapshot of background prefetch progress so the user can poll status.
_prefetch_state: dict = {
    "running":  False,
    "fetched":  0,
    "skipped":  0,
    "failed":   0,
    "total":    0,
    "current":  "",
    "error":    "",
    "started":  0.0,
    "finished": 0.0,
}


async def _prefetch_worker() -> None:
    """Background task body for /api/chord-shapes/prefetch. Updates
    _prefetch_state as it goes so a status poll can show progress."""
    _prefetch_state.update(
        running=True, fetched=0, skipped=0, failed=0,
        current="", error="", started=time.time(), finished=0.0,
    )
    _prefetch_state["total"] = len(_CHORD_ROOTS) * len(_CHORD_TYPES)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            for root in _CHORD_ROOTS:
                for typ in _CHORD_TYPES:
                    name = root + typ
                    _prefetch_state["current"] = name
                    existing = await _chord_shapes_from_db(name)
                    if existing is not None:
                        _prefetch_state["skipped"] += 1
                        continue
                    await asyncio.sleep(0.4)
                    shapes = await _fetch_uberchord(name, client)
                    if shapes is None:
                        _prefetch_state["failed"] += 1
                        print(f"prefetch fetch failed: {name}", flush=True)
                        continue
                    await _chord_shapes_to_db(name, shapes)
                    _CHORD_CACHE[name] = shapes
                    _prefetch_state["fetched"] += 1
    except Exception as e:
        _prefetch_state["error"] = str(e)[:400]
        print(f"prefetch worker exception: {e}", flush=True)
        traceback.print_exc()
    finally:
        _prefetch_state["running"] = False
        _prefetch_state["current"] = ""
        _prefetch_state["finished"] = time.time()


@app.get("/api/chord-shapes-status")
async def chord_shapes_status():
    """Public diagnostic: in-flight prefetch progress + the row count
    in the persistent chord_shapes table. Useful while waiting for the
    background prefetch to finish."""
    out = dict(_prefetch_state)
    out["last_fetch_error"] = dict(_LAST_FETCH_ERROR)
    if os.environ.get("DATABASE_URL"):
        try:
            pool = db.get_pool()
            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT COUNT(*) FROM chord_shapes")
                    row = await cur.fetchone()
                    out["db_count"] = int(row[0]) if row else 0
                    await cur.execute(
                        "SELECT name, jsonb_array_length(shapes) AS n "
                        "FROM chord_shapes "
                        "ORDER BY fetched_at DESC LIMIT 5"
                    )
                    out["db_recent"] = [
                        {"name": r[0], "n_shapes": int(r[1])}
                        for r in await cur.fetchall()
                    ]
        except Exception as e:
            out["db_error"] = str(e)[:400]
    return out


@app.post("/api/chord-shapes/prefetch")
async def prefetch_chord_shapes(request: Request):
    """Kick off a background prefetch that walks every (root ×
    chord-type) combo, fetching from Uberchord with a polite delay
    and persisting to Postgres. Returns immediately so the HTTP
    request doesn't time out at the proxy (~3 minutes total work).

    Idempotent: already-cached combos are skipped, so re-running
    only picks up types added since last run. Poll /api/chord-shapes-
    status to track progress.

    Admin-gated by the static `X-Admin-Key` header."""
    require_admin_key(request)
    if _prefetch_state["running"]:
        return {"status": "already running", "state": dict(_prefetch_state)}
    asyncio.create_task(_prefetch_worker())
    return {
        "status": "started",
        "total":  len(_CHORD_ROOTS) * len(_CHORD_TYPES),
        "poll":   "/api/chord-shapes-status",
    }


@app.get("/api/chord-shapes/{name}")
async def chord_shapes(name: str):
    """Resolve chord voicings: in-memory → Postgres → Uberchord upstream.
    Whatever lands gets persisted to Postgres so we never re-fetch the
    same chord twice. Used by the admin-gated chord-diagram hover
    popover on chord-ID chips. Standard 6-string E-Standard tuning."""
    cleaned = (name or "").strip()
    if not cleaned or len(cleaned) > 32:
        raise HTTPException(status_code=400, detail="bad chord name")
    # 1. Hot in-memory cache.
    if cleaned in _CHORD_CACHE:
        return {"name": cleaned, "shapes": _CHORD_CACHE[cleaned], "src": "mem"}
    # 2. Persistent Postgres cache.
    db_shapes = await _chord_shapes_from_db(cleaned)
    if db_shapes is not None:
        _CHORD_CACHE[cleaned] = db_shapes
        return {"name": cleaned, "shapes": db_shapes, "src": "db"}
    # 3. Upstream (Uberchord) — populates both caches on the way out.
    async with httpx.AsyncClient(timeout=5.0) as client:
        fetched = await _fetch_uberchord(cleaned, client)
    if fetched is None:
        # Transport failure — return empty without caching, so a retry
        # can succeed once the upstream recovers.
        return {"name": cleaned, "shapes": [], "src": "upstream-error"}
    _CHORD_CACHE[cleaned] = fetched
    await _chord_shapes_to_db(cleaned, fetched)
    return {"name": cleaned, "shapes": fetched, "src": "upstream"}


@app.get("/api/health")
async def health():
    """Liveness + DB probe. Used after Railway redeploys to confirm
    the process and DB connection came up cleanly."""
    db_status: str = "skipped"
    if os.environ.get("DATABASE_URL"):
        try:
            pool = db.get_pool()
            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT 1")
                    await cur.fetchone()
            db_status = "ok"
        except Exception as e:
            db_status = f"error: {type(e).__name__}: {e}"
    return {"status": "ok", "db": db_status}


# ---- Songs (chord-extracted catalogue) -----------------------------------
# Both endpoints below are public reads — chord progressions aren't
# sensitive, and gating on auth would force us to flip both UI + API
# when we eventually open the Sheet Music section to all users. The
# admin-only visibility gate is on the frontend section, not the data.

@app.get("/api/songs/books")
async def list_books():
    """Return every distinct book name in the catalogue with row counts.
    Frontend uses this to populate the book-filter dropdown."""
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT book, "
                "       COUNT(*)::int AS total, "
                "       SUM(CASE WHEN has_chords THEN 1 ELSE 0 END)::int AS chord_count "
                "FROM songs "
                "GROUP BY book "
                "ORDER BY book"
            )
            cols = [d.name for d in cur.description]
            rows = await cur.fetchall()
    return {"books": [dict(zip(cols, r)) for r in rows]}


@app.get("/api/songs/search")
async def search_songs(
    q: str = "",
    only_chords: bool = False,
    confidence: str = "high",
    book: str = "",
    limit: int = 200,
):
    """Search the chord-extracted song catalogue.

    - `q`            : substring match against title (case-insensitive)
    - `only_chords`  : true → restrict to rows with chord data (skip
                       TOC-only / title-only entries)
    - `confidence`   : 'high'  (default) — only confidence='high' rows
                       'med'   — high OR medium
                       'all'   — every row, including 'low' and unset
    - `limit`        : 1..500, default 200

    Returns a `results` array of light row records. Per-song chord/
    degree arrays come from /api/songs/{id} so this payload stays
    small even on broad queries.
    """
    limit = max(1, min(500, int(limit) if limit else 200))
    where: list[str] = []
    params: list = []
    if q:
        where.append("title_upper LIKE %s")
        params.append(f"%{q.upper()}%")
    if only_chords:
        where.append("has_chords = true")
    if book:
        where.append("book = %s")
        params.append(book)
    confidence = (confidence or "high").lower()
    if confidence == "high":
        where.append("confidence = 'high'")
    elif confidence == "med":
        where.append("confidence IN ('high', 'medium')")
    # 'all' (or anything else) → no confidence filter
    sql = (
        "SELECT id, book, pdf_page, title, song_key AS key, "
        "       time_signature, confidence, has_chords "
        "FROM songs"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    # Rank: shorter titles surface first (better matches for short
    # queries), then alphabetical for stable order.
    sql += " ORDER BY length(title), title_upper, book LIMIT %s"
    params.append(limit)

    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            cols = [d.name for d in cur.description]
            rows = await cur.fetchall()
    return {"results": [dict(zip(cols, r)) for r in rows]}


@app.post("/api/songs/import")
async def import_songs(
    payload: SongImportPayload,
    request: Request,
):
    """Bulk-upsert chord-extracted songs. Admin-only via X-Admin-Key
    header — see require_admin_key. Designed to be called many times
    in a row by `_books/_publish_chords.py`, each request carrying a
    chunk (typically 500 rows) so an individual failure doesn't blow
    away the whole publish.

    Idempotent — (book, pdf_page, title) is the natural key, so
    re-publishing the same JSON just refreshes whatever changed."""
    require_admin_key(request)

    rows: list[tuple] = []
    for s in payload.songs:
        # Defensive: the Vision extractor occasionally produces bad
        # rows. Skip silently — the importer will still report a
        # smaller "upserted" count than "received".
        if not s.title or not s.book or s.pdf_page is None:
            continue
        rows.append((
            s.book, int(s.pdf_page), s.title,
            s.key, s.time_signature, s.confidence,
            s.chords or [], s.degrees or [],
            json.dumps(s.sections or []),
            s.notes,
        ))

    if rows:
        sql = (
            "INSERT INTO songs ("
            "  book, pdf_page, title, song_key, time_signature, confidence,"
            "  chords, degrees, sections, notes"
            ") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s) "
            "ON CONFLICT (book, pdf_page, title) DO UPDATE SET "
            "  song_key       = EXCLUDED.song_key,"
            "  time_signature = EXCLUDED.time_signature,"
            "  confidence     = EXCLUDED.confidence,"
            "  chords         = EXCLUDED.chords,"
            "  degrees        = EXCLUDED.degrees,"
            "  sections       = EXCLUDED.sections,"
            "  notes          = EXCLUDED.notes"
        )
        pool = db.get_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(sql, rows)
            await conn.commit()
    return {"received": len(payload.songs), "upserted": len(rows)}


@app.get("/api/songs/{song_id}")
async def get_song(song_id: int):
    """Full chord-data record for one song. Frontend uses this to render
    the chord-progression chart panel.

    The `degrees` array is RE-DERIVED on every read from `chords` and
    `song_key` — Claude's original output goes out as `claude_degrees`
    for debug/comparison. Reason: the Vision pass got keys wrong on a
    non-trivial fraction of songs (especially minor-key tunes labelled
    as their relative major), and that error propagates through every
    degree. Computing fresh here makes the catalogue self-consistent
    and lets us iterate on the rules without re-running extraction."""
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, book, pdf_page, title, song_key AS key, "
                "       time_signature, confidence, chords, degrees, "
                "       sections, notes "
                "FROM songs WHERE id = %s",
                (song_id,),
            )
            cols = [d.name for d in cur.description]
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="song not found")
    out = dict(zip(cols, row))
    claude_degrees = list(out.get("degrees") or [])
    out["claude_degrees"] = claude_degrees
    out["degrees"] = derive_degrees(
        out.get("chords") or [],
        claude_degrees,
        out.get("key"),
    )
    return out


@app.put("/api/songs/{song_id}")
async def edit_song(
    song_id: int,
    payload: SongEditPayload,
    actor: dict = Depends(resolve_admin),
):
    """Apply an admin's inline edit. Any field set on the payload gets
    persisted; omitted fields stay as-is. When `chords` is sent we also
    blank out the stored `degrees` array — the GET endpoint re-derives
    degrees on every read from chords + key, so stale Claude-produced
    degree values would just confuse later reads / debug.

    Gated by `resolve_admin` (static `X-Admin-Key` header). Returns the
    freshly-read row so the client can re-render without a separate GET."""
    sets: list[str] = []
    params: list = []
    if payload.chords is not None:
        sets.append("chords = %s")
        params.append(payload.chords)
        # Reset Claude's degrees so the on-read derivation has a clean
        # slate. The chord-quality suffix won't carry through, which is
        # the right call when the chord text is being rewritten.
        sets.append("degrees = %s")
        params.append([])
    if payload.key is not None:
        sets.append("song_key = %s"); params.append(payload.key or None)
    if payload.time_signature is not None:
        sets.append("time_signature = %s"); params.append(payload.time_signature or None)
    if payload.confidence is not None:
        conf = (payload.confidence or "").lower()
        if conf and conf not in ("high", "medium", "low"):
            raise HTTPException(status_code=400,
                detail="confidence must be high|medium|low")
        sets.append("confidence = %s"); params.append(conf or None)
    if payload.notes is not None:
        sets.append("notes = %s"); params.append(payload.notes or None)

    if not sets:
        raise HTTPException(status_code=400, detail="no fields to update")

    params.append(song_id)
    sql = f"UPDATE songs SET {', '.join(sets)} WHERE id = %s"
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="song not found")
        await conn.commit()
    # Return the fresh row so the client can re-render without an
    # extra GET round-trip — degrees come back re-derived.
    return await get_song(song_id)


@app.delete("/api/songs/{song_id}")
async def delete_song(
    song_id: int,
    actor: dict = Depends(resolve_admin),
):
    """Hard-delete a song row. Used by the local demo's dedup workflow
    when the same standard appears in multiple books / pages and the
    admin is keeping only the best version. Idempotent at the API
    level: a missing row returns 404 so the caller knows the row never
    existed (helps surface stale local caches).

    Gated by `resolve_admin` (static `X-Admin-Key` header)."""
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM songs WHERE id = %s", (song_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="song not found")
        await conn.commit()
    return {"deleted": song_id}


# ---- Tabs (tablature catalogue) -----------------------------------------

@app.post("/api/tabs/import")
async def import_tabs(
    payload: TabImportPayload,
    request: Request,
):
    """Bulk-upsert tablature rows. Admin-only via X-Admin-Key header,
    same shape as /api/songs/import. Idempotent — natural key is
    (book, pdf_page, title)."""
    require_admin_key(request)

    rows: list[tuple] = []
    for t in payload.tabs:
        if not t.title or not t.book or t.pdf_page is None:
            continue
        rows.append((
            t.book, int(t.pdf_page), t.title,
            t.tuning, t.strings, t.key, t.time_signature,
            json.dumps(t.measures or []),
            t.notes, t.confidence,
        ))

    if rows:
        sql = (
            "INSERT INTO tabs ("
            "  book, pdf_page, title, tuning, strings, song_key,"
            "  time_signature, measures, notes, confidence"
            ") VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s) "
            "ON CONFLICT (book, pdf_page, title) DO UPDATE SET "
            "  tuning         = EXCLUDED.tuning,"
            "  strings        = EXCLUDED.strings,"
            "  song_key       = EXCLUDED.song_key,"
            "  time_signature = EXCLUDED.time_signature,"
            "  measures       = EXCLUDED.measures,"
            "  notes          = EXCLUDED.notes,"
            "  confidence     = EXCLUDED.confidence"
        )
        pool = db.get_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(sql, rows)
            await conn.commit()
    return {"received": len(payload.tabs), "upserted": len(rows)}


@app.get("/api/tabs/books")
async def list_tab_books():
    """Distinct book names in the tabs catalogue + row counts."""
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT book, "
                "       COUNT(*)::int AS total, "
                "       SUM(CASE WHEN has_data THEN 1 ELSE 0 END)::int AS data_count "
                "FROM tabs GROUP BY book ORDER BY book"
            )
            cols = [d.name for d in cur.description]
            rows = await cur.fetchall()
    return {"books": [dict(zip(cols, r)) for r in rows]}


@app.get("/api/tabs/search")
async def search_tabs(
    q: str = "",
    only_data: bool = True,
    confidence: str = "high",
    book: str = "",
    limit: int = 200,
):
    """Title-substring search over the tabs catalogue. Same param
    shape as /api/songs/search — only_data filters to rows where
    measures actually landed (skip TOC-only / parse-failed entries),
    confidence is 'high' / 'med' / 'all'."""
    limit = max(1, min(500, int(limit) if limit else 200))
    where: list[str] = []
    params: list = []
    if q:
        where.append("title_upper LIKE %s")
        params.append(f"%{q.upper()}%")
    if only_data:
        where.append("has_data = true")
    if book:
        where.append("book = %s")
        params.append(book)
    confidence = (confidence or "high").lower()
    if confidence == "high":
        where.append("confidence = 'high'")
    elif confidence == "med":
        where.append("confidence IN ('high', 'medium')")

    sql = (
        "SELECT id, book, pdf_page, title, tuning, strings, "
        "       song_key AS key, time_signature, confidence, has_data "
        "FROM tabs"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY length(title), title_upper, book LIMIT %s"
    params.append(limit)

    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            cols = [d.name for d in cur.description]
            rows = await cur.fetchall()
    return {"results": [dict(zip(cols, r)) for r in rows]}


@app.get("/api/tabs/{tab_id}")
async def get_tab(tab_id: int):
    """Full record for one tab — measures array included so the
    client can render the diagram or hand the data to the existing
    Tab editor."""
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id, book, pdf_page, title, tuning, strings, "
                "       song_key AS key, time_signature, confidence, "
                "       measures, notes "
                "FROM tabs WHERE id = %s",
                (tab_id,),
            )
            cols = [d.name for d in cur.description]
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="tab not found")
    return dict(zip(cols, row))


# ---- Static-file routing -------------------------------------------------
# Explicit allow-list. The previous `python3 -m http.server` would happily
# serve `.git/HEAD`, `nixpacks.toml`, `requirements.txt`, etc. — we tighten
# that here by ONLY mounting the directories the site actually needs.
@app.get("/", include_in_schema=False)
async def root_index():
    return FileResponse(ROOT / "index.html")


@app.get("/robots.txt", include_in_schema=False)
async def robots():
    return FileResponse(ROOT / "robots.txt")


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap():
    return FileResponse(ROOT / "sitemap.xml")


# Asset directories. Anything not under one of these (and not an /api
# route or one of the explicit files above) returns 404.
app.mount("/css", StaticFiles(directory=str(ROOT / "css")), name="css")
app.mount("/js",  StaticFiles(directory=str(ROOT / "js")),  name="js")
app.mount("/img", StaticFiles(directory=str(ROOT / "img")), name="img")
