"""
Refresh Token Service — issuance, rotation, and revocation.
"""
import hashlib
import logging
import os
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import HTTPException, status

from uteki.domains.auth.repository import RefreshTokenRepository

logger = logging.getLogger(__name__)

REFRESH_TOKEN_EXPIRE_DAYS = 30


def generate_refresh_token() -> Tuple[str, str]:
    """
    Generate a cryptographically random refresh token.

    Returns:
        (raw_token, sha256_hash) — store only the hash, send raw to client.
    """
    raw = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, token_hash


async def store_refresh_token(user_id: str, token_hash: str, expires_at: datetime) -> dict:
    """Persist a refresh token hash to the database."""
    return await RefreshTokenRepository.create(user_id, token_hash, expires_at)


async def issue_refresh_token(user_id: str) -> Tuple[str, datetime]:
    """
    Issue and store a new refresh token for a user.

    Returns:
        (raw_token, expires_at)
    """
    raw, token_hash = generate_refresh_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    await store_refresh_token(user_id, token_hash, expires_at)
    return raw, expires_at


async def rotate_refresh_token(raw_token: str) -> Tuple[str, str]:
    """
    Exchange an existing refresh token for a new access + refresh token pair.

    Implements rotation: the presented token is immediately revoked.
    Replay attack protection: if the token is already revoked, revoke ALL
    tokens for that user (token theft detection).

    Args:
        raw_token: The raw refresh token string from the client.

    Returns:
        (new_access_token_payload_user_id, new_raw_refresh_token)

    Raises:
        HTTPException 401 on invalid/expired/revoked token.
    """
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    record = await RefreshTokenRepository.get_by_hash(token_hash)

    if record is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    # Replay attack: token already revoked → nuke all tokens for this user
    if record.get("revoked"):
        logger.warning(
            f"Replay attack detected: refresh token for user {record['user_id']} already revoked"
        )
        await RefreshTokenRepository.revoke_all_for_user(record["user_id"])
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token already used. All sessions revoked for security.",
        )

    # Check expiry
    expires_at_raw = record.get("expires_at")
    if expires_at_raw:
        if isinstance(expires_at_raw, str):
            expires_at = datetime.fromisoformat(expires_at_raw.replace("Z", "+00:00"))
        else:
            expires_at = expires_at_raw
        if not expires_at.tzinfo:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired"
            )

    user_id: str = record["user_id"]

    # Revoke old token and issue new one
    await RefreshTokenRepository.revoke(token_hash)
    new_raw, _ = await issue_refresh_token(user_id)

    return user_id, new_raw


async def revoke_refresh_token(raw_token: str) -> None:
    """Revoke a single refresh token (for logout). Idempotent."""
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    await RefreshTokenRepository.revoke(token_hash)


async def cleanup_expired_tokens() -> None:
    """Delete expired and revoked refresh tokens from the database."""
    await RefreshTokenRepository.cleanup_expired()
    logger.info("Refresh token cleanup complete")
