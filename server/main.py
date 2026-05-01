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

import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server import db

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
    """Liveness + DB probe. Used after Railway redeploys to confirm both
    the process and the DB connection came up cleanly."""
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
