"""SlantFinder.pro — FastAPI app.

Serves the static HTML/CSS/JS that makes up the site, plus API routes
for personalisation (Clerk-backed auth + Postgres-backed user settings).

Stage 2 (this commit): connect to Postgres on startup, run any pending
migrations, expose `/api/health` that reports DB status. Auth + settings
endpoints land in stages 3-4.

Deployed on Railway via Railpack auto-detect (sees main.py at root,
runs `uvicorn main:app`). Local dev:
  uvicorn server.main:app --reload --port 8000
"""
from __future__ import annotations

import json
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import auth as auth_module
from server import db
from server.auth import current_admin_user, current_user
from server.music import derive_degrees


class SettingsPayload(BaseModel):
    """Body shape for PUT /api/settings — a single freeform JSON object
    we store as the user's `data` JSONB column. Top-level keys are
    feature areas (e.g. "tab", "song_keys"); the schema inside each is
    owned by the corresponding frontend module."""
    data: dict


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


def require_admin_key(request: Request) -> None:
    """Static-key guard for admin-only server-to-server endpoints.

    The chord-data importer runs on the operator's laptop — it has
    a JSON file but no Clerk session. Forcing it through the user-
    auth pipeline would mean copying short-lived JWTs around. A
    dedicated `ADMIN_API_KEY` env var is the right tool: random
    string set on Railway and matched by the local script's env.
    Returns 503 if the server doesn't have one configured (no key
    means no admin pipe), 401 if the client's header is wrong."""
    expected = os.environ.get("ADMIN_API_KEY", "")
    if not expected:
        raise HTTPException(status_code=503, detail="admin import not configured")
    given = request.headers.get("x-admin-key", "")
    if not given or given != expected:
        raise HTTPException(status_code=401, detail="invalid admin key")


async def resolve_admin(request: Request) -> dict:
    """Allow EITHER static admin key OR Clerk admin user. Used on
    endpoints reachable from both the laptop scripts (X-Admin-Key) and
    the live signed-in admin (Clerk JWT). The static-key path wins
    when both are present so the demo / importer don't accidentally
    fall through to a possibly-missing Clerk session."""
    if request.headers.get("x-admin-key"):
        require_admin_key(request)
        return {"user_id": "admin-key", "via": "static"}
    user = await current_admin_user(request)
    return {**user, "via": "clerk"}

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
    title="SlantFinder.pro",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

# CORS for local-dev / admin tooling. The MAMP-served _books/_demo.html
# (running at http://localhost) needs to call /api/songs/* on the live
# host. We only allow localhost origins explicitly — the live site is
# same-origin so it doesn't need CORS at all. allow_credentials=True
# is required for Authorization headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:80",
        "http://localhost:8000",
        "http://localhost:8888",   # MAMP default
        "http://127.0.0.1",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8888",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key"],
)


# ---- API routes (registered first so they take priority over statics) ----
@app.get("/api/health")
async def health():
    """Liveness + DB + auth-config probe. Used after Railway redeploys
    to confirm process, DB, and Clerk JWT verification config all came
    up cleanly."""
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
    # Auth-config diagnostic. We don't echo the publishable key itself —
    # only whether it's present and what we decoded out of it. Helps
    # diagnose "auth not configured" 503s on /api/me without redeploys.
    pk_env = os.environ.get("CLERK_PUBLISHABLE_KEY", "")
    auth_status = {
        "pk_env_set": bool(pk_env),
        "pk_len": len(pk_env),
        "frontend_api": auth_module.FRONTEND_API or None,
        "issuer": auth_module.ISSUER or None,
    }
    return {"status": "ok", "db": db_status, "auth": auth_status}


@app.get("/api/me")
async def me(user: dict = Depends(current_user)):
    """Returns the verified Clerk user_id for the bearer token in the
    Authorization header, or 401 if no/invalid token. Frontend uses
    this as a smoke test that auth is wired correctly end-to-end."""
    return {"user_id": user["user_id"]}


@app.get("/api/settings")
async def get_settings(user: dict = Depends(current_user)):
    """Read the signed-in user's settings blob. Auto-creates an empty
    row on first hit so the frontend never has to special-case the
    'returning user vs. new user' distinction — it always gets back
    `{data: object}`, possibly an empty `{}` for new accounts."""
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO user_settings (clerk_user_id) VALUES (%s) "
                "ON CONFLICT (clerk_user_id) DO NOTHING",
                (user["user_id"],),
            )
            await cur.execute(
                "SELECT data FROM user_settings WHERE clerk_user_id = %s",
                (user["user_id"],),
            )
            row = await cur.fetchone()
        await conn.commit()
    data = (row[0] if row else {}) or {}
    return {"data": data}


@app.put("/api/settings")
async def put_settings(
    payload: SettingsPayload,
    user: dict = Depends(current_user),
):
    """Replace the signed-in user's settings blob wholesale. The frontend
    is the source of truth for the shape — we just store and return it.
    Future endpoints can offer JSONB-path PATCH semantics if/when bandwidth
    becomes a concern; for now whole-blob is simplest and fine."""
    if not isinstance(payload.data, dict):
        raise HTTPException(status_code=400, detail="data must be an object")
    pool = db.get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO user_settings (clerk_user_id, data) "
                "VALUES (%s, %s::jsonb) "
                "ON CONFLICT (clerk_user_id) DO UPDATE "
                "  SET data = EXCLUDED.data",
                (user["user_id"], json.dumps(payload.data)),
            )
        await conn.commit()
    return {"ok": True}


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

    Gated by current_admin_user (Clerk JWT + ADMIN_USER_IDS allow-list).
    Returns the freshly-read row so the client can re-render without
    a separate GET."""
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
