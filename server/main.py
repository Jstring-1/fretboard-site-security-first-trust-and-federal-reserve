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

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import auth as auth_module
from server import db
from server.auth import current_user


class SettingsPayload(BaseModel):
    """Body shape for PUT /api/settings — a single freeform JSON object
    we store as the user's `data` JSONB column. Top-level keys are
    feature areas (e.g. "tab", "song_keys"); the schema inside each is
    owned by the corresponding frontend module."""
    data: dict

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
