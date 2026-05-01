"""Postgres pool + migrations runner.

We use psycopg3 (async) with psycopg_pool for connection pooling. The
DB URL comes from `DATABASE_URL` (Railway-injected reference to the
Postgres service in the same project).

Migrations live in /migrations/*.sql at the repo root. On startup, this
module ensures the bookkeeping `_migrations` table exists, then applies
any unapplied .sql files in lexical filename order, each in its own
transaction. Idempotent — safe to call on every startup. Filename
convention: NNN_<description>.sql (e.g. 001_init.sql, 002_add_thing.sql).

Environment-tolerant: if DATABASE_URL is missing, run_migrations()
raises and main.py downgrades to "DB-less mode" so the static site
still serves while the operator wires up the DB.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

DATABASE_URL = os.environ.get("DATABASE_URL", "")
ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "migrations"

_pool: Optional[AsyncConnectionPool] = None


async def _check_connection(conn: AsyncConnection) -> None:
    """Ping the connection before the pool lends it out. Railway's Postgres
    (or its routing proxy) closes idle TCP connections aggressively — once
    that happens, the pool's still-cached entry is dead and any query on
    it fails with `SSL SYSCALL error: EOF detected`. Running a cheap
    `SELECT 1` here catches the stale conn so the pool recycles it before
    user code ever sees it."""
    await conn.execute("SELECT 1")


async def init_pool() -> AsyncConnectionPool:
    """Create + open the pool (idempotent). Raises if DATABASE_URL is unset."""
    global _pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL not set in environment")
    if _pool is None:
        _pool = AsyncConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=5,
            open=False,                     # explicit open below so init errors surface
            check=_check_connection,        # ping before lend (stale-conn defence)
            max_idle=300.0,                 # recycle idle conns after 5 min
        )
        await _pool.open()
    return _pool


async def close_pool() -> None:
    """Close the pool on shutdown so Railway's process-stop is clean."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool:
    """Accessor for routes that need a connection. Caller must use
    `async with pool.connection() as conn:` to acquire/release."""
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call init_pool() first")
    return _pool


async def run_migrations() -> list[str]:
    """Apply any unapplied .sql files in /migrations. Returns the list
    of filenames newly applied this run (empty if everything was already
    up to date). Each migration runs in its own transaction so a failure
    doesn't half-apply state."""
    pool = await init_pool()
    applied: list[str] = []

    # Bootstrap the bookkeeping table outside any user-migration tx so a
    # fresh DB always starts with somewhere to record applied work.
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "CREATE TABLE IF NOT EXISTS _migrations ("
                "  name TEXT PRIMARY KEY,"
                "  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                ")"
            )
        await conn.commit()

        async with conn.cursor() as cur:
            await cur.execute("SELECT name FROM _migrations")
            done = {row[0] for row in await cur.fetchall()}

    files = sorted(p for p in MIGRATIONS_DIR.glob("*.sql"))
    for f in files:
        if f.name in done:
            continue
        sql = f.read_text(encoding="utf-8")
        async with pool.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cur:
                    await cur.execute(sql)
                    await cur.execute(
                        "INSERT INTO _migrations (name) VALUES (%s)",
                        (f.name,),
                    )
        applied.append(f.name)

    return applied
