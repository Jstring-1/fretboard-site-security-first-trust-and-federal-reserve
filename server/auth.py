"""Clerk JWT verification.

Verifies tokens issued by Clerk's frontend SDK against Clerk's JWKS
public keys. No Clerk SDK or secret key required — Clerk's JWKS is
public and we just check signatures locally. The Frontend API domain
(where the JWKS lives) is base64-decoded from CLERK_PUBLISHABLE_KEY.

Usage in routes:
    from fastapi import Depends
    from server.auth import current_user, optional_user

    @app.get("/api/me")
    async def me(user = Depends(current_user)):
        return user                # 401 if no/invalid token

    @app.get("/api/something")
    async def thing(user = Depends(optional_user)):
        if user: ...               # signed-in path
        else:    ...               # anonymous path

The user dict is `{user_id, claims}` — `user_id` is Clerk's `sub`. We
intentionally don't pull email server-side because Clerk's default
session token doesn't include it; the frontend already has the email
from the Clerk user object and can pass it for display purposes.
"""
from __future__ import annotations

import base64
import os
import time
from typing import Any, Optional

import httpx
import jwt
from fastapi import HTTPException, Request

CLERK_PUBLISHABLE_KEY = os.environ.get("CLERK_PUBLISHABLE_KEY", "")


def _decode_frontend_api_domain() -> str:
    """The publishable key is `pk_test_<b64>` (or `pk_live_<b64>`) where
    the base64 payload decodes to '<domain>$'. Strip the prefix, decode,
    drop the trailing '$'. Returns '' if the key is missing/malformed —
    auth then fails closed (verify_token raises 503)."""
    pk = CLERK_PUBLISHABLE_KEY
    if not pk:
        return ""
    for prefix in ("pk_test_", "pk_live_"):
        if pk.startswith(prefix):
            b64 = pk[len(prefix):]
            try:
                pad = "=" * (-len(b64) % 4)
                decoded = base64.b64decode(b64 + pad).decode("utf-8", errors="replace")
                return decoded.rstrip("$")
            except Exception:
                return ""
    return ""


FRONTEND_API = _decode_frontend_api_domain()
ISSUER = f"https://{FRONTEND_API}" if FRONTEND_API else ""
JWKS_URL = f"{ISSUER}/.well-known/jwks.json" if ISSUER else ""

_JWKS_TTL = 3600.0   # 1 hour
_jwks_cache: dict[str, Any] = {"keys": [], "fetched_at": 0.0}


async def _get_jwks(force: bool = False) -> list[dict]:
    """Fetch + cache Clerk's JWKS. force=True bypasses cache (used after
    a verification failure to handle key rotation cleanly)."""
    now = time.time()
    if (not force
            and _jwks_cache["keys"]
            and (now - _jwks_cache["fetched_at"]) < _JWKS_TTL):
        return _jwks_cache["keys"]
    if not JWKS_URL:
        raise HTTPException(status_code=503, detail="auth not configured")
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(JWKS_URL)
        r.raise_for_status()
        data = r.json()
    _jwks_cache["keys"] = data.get("keys", [])
    _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


async def verify_token(token: str) -> dict:
    """Verify a Clerk JWT signature + standard claims. Returns the
    decoded claims, or raises an HTTPException."""
    if not ISSUER:
        raise HTTPException(status_code=503, detail="auth not configured")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {e}")
    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="token missing kid")

    # Locate the signing key. If we don't have a match in cache, refetch
    # once — handles Clerk's key rotation without forcing a cold restart.
    key_dict = None
    for force in (False, True):
        keys = await _get_jwks(force=force)
        key_dict = next((k for k in keys if k.get("kid") == kid), None)
        if key_dict:
            break
    if not key_dict:
        raise HTTPException(status_code=401, detail="signing key not found")

    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_dict)
    try:
        claims = jwt.decode(
            token,
            key=public_key,
            algorithms=["RS256"],
            issuer=ISSUER,
            options={"verify_aud": False},  # Clerk default tokens have no aud
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {e}")
    return claims


def _extract_bearer(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    return token or None


async def current_user(request: Request) -> dict:
    """Hard-required auth dep. Raises 401 on any failure."""
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="missing bearer token")
    claims = await verify_token(token)
    return {"user_id": claims.get("sub", ""), "claims": claims}


async def optional_user(request: Request) -> Optional[dict]:
    """Soft auth dep. Returns the user dict if a valid token is present,
    None otherwise. Used for endpoints that serve both anonymous and
    signed-in users with different behaviour."""
    token = _extract_bearer(request)
    if not token:
        return None
    try:
        claims = await verify_token(token)
    except HTTPException:
        return None
    return {"user_id": claims.get("sub", ""), "claims": claims}
