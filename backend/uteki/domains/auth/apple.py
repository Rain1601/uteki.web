"""
Apple Sign-In — JWKS-based identity token verification.

Apple identity_token is a JWT signed with Apple's private key.
We verify it by fetching Apple's public JWKS and validating the signature.
"""
import logging
import time
from typing import Any, Dict, Optional

import httpx
from jose import JWTError, jwk, jwt

from uteki.common.config import settings

logger = logging.getLogger(__name__)

APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
JWKS_CACHE_TTL = 3600  # 1 hour


class AppleJWKSClient:
    """Caches Apple's JWKS and verifies identity tokens."""

    def __init__(self) -> None:
        self._jwks: Optional[Dict[str, Any]] = None
        self._cached_at: float = 0.0

    def _is_cache_valid(self) -> bool:
        return (
            self._jwks is not None
            and (time.monotonic() - self._cached_at) < JWKS_CACHE_TTL
        )

    async def _fetch_jwks(self) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(APPLE_JWKS_URL)
            resp.raise_for_status()
            return resp.json()

    async def get_jwks(self, force_refresh: bool = False) -> Dict[str, Any]:
        if not force_refresh and self._is_cache_valid():
            return self._jwks  # type: ignore[return-value]
        self._jwks = await self._fetch_jwks()
        self._cached_at = time.monotonic()
        return self._jwks

    def _find_key(self, jwks: Dict[str, Any], kid: str) -> Optional[Any]:
        for key_data in jwks.get("keys", []):
            if key_data.get("kid") == kid:
                return jwk.construct(key_data)
        return None

    async def verify(self, identity_token: str) -> Dict[str, Any]:
        """
        Verify an Apple identity_token JWT.

        Returns payload dict with at minimum: { sub, email (may be absent on repeat login) }

        Raises:
            httpx.HTTPError: if JWKS endpoint is unreachable (caller should return 503)
            ValueError: if token is invalid, expired, or has wrong iss/aud
        """
        # Decode header to get kid without verifying signature yet
        try:
            header = jwt.get_unverified_header(identity_token)
        except JWTError as e:
            raise ValueError(f"Cannot decode Apple token header: {e}") from e

        kid = header.get("kid")

        # Fetch JWKS (from cache or network)
        jwks = await self.get_jwks()

        key = self._find_key(jwks, kid)
        if key is None:
            # kid not in cache — refresh once
            jwks = await self.get_jwks(force_refresh=True)
            key = self._find_key(jwks, kid)

        if key is None:
            raise ValueError(f"Apple public key not found for kid={kid}")

        # Verify audience: should be the app's bundle ID
        audience = settings.apple_client_id
        options: Dict[str, Any] = {}
        if not audience:
            # No client ID configured — skip aud check (dev mode only)
            options["verify_aud"] = False
            logger.warning("APPLE_CLIENT_ID not set — skipping aud verification")

        try:
            payload = jwt.decode(
                identity_token,
                key,
                algorithms=["RS256"],
                audience=audience,
                issuer=APPLE_ISSUER,
                options=options,
            )
        except JWTError as e:
            raise ValueError(f"Apple token verification failed: {e}") from e

        return payload


# Module-level singleton (shared JWKS cache across requests)
_apple_client: Optional[AppleJWKSClient] = None


def get_apple_client() -> AppleJWKSClient:
    global _apple_client
    if _apple_client is None:
        _apple_client = AppleJWKSClient()
    return _apple_client


async def verify_apple_identity_token(identity_token: str) -> Dict[str, Any]:
    """
    Verify an Apple identity_token and return { sub, email }.

    Raises httpx.HTTPError on JWKS network failure (caller → 503).
    Raises ValueError on invalid token (caller → 401).
    """
    client = get_apple_client()
    payload = await client.verify(identity_token)
    return {
        "sub": payload["sub"],
        "email": payload.get("email"),  # Only present on first authorization
    }
