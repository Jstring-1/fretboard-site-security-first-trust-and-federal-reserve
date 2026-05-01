"""SlantFinder.pro — FastAPI app.

Serves the static HTML/CSS/JS that makes up the site, plus future API
routes for personalisation (Clerk-backed auth + Postgres-backed user
settings).

Stage 1 (this commit): drop-in replacement for `python3 -m http.server`.
Same static surface as before (index.html, /css, /js, /img, robots.txt,
sitemap.xml) plus a single `/api/health` liveness endpoint that returns
`{status: "ok"}`. No DB, no auth — those land in the next stages.

Deployed on Railway via nixpacks. Local dev:
  uvicorn server.main:app --reload --port 8000
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Repo root — server/ lives one level deep
ROOT = Path(__file__).resolve().parent.parent

app = FastAPI(
    title="SlantFinder.pro",
    docs_url=None,    # don't expose /docs publicly
    redoc_url=None,   # ditto /redoc
    openapi_url=None,
)


# ---- API routes (registered first so they take priority over statics) ----
@app.get("/api/health")
async def health():
    """Liveness probe. Used after Railway redeploys to confirm the process
    came up cleanly. Has zero deps so it succeeds even if the DB is down
    or auth is misconfigured."""
    return {"status": "ok"}


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
