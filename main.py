"""Repo-root shim so Railway's Railpack auto-detect spots the FastAPI
app and starts it with `uvicorn main:app` automatically.

The actual app definition lives in server/main.py. We re-export `app`
here purely so the build system finds it without needing a custom
start command. Don't add logic in this file — keep server/main.py as
the single source of truth.
"""
from server.main import app  # noqa: F401
