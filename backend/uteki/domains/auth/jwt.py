"""
JWT Token Utilities — JWT generation and verification.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from jose import JWTError, jwt
import logging

from uteki.common.config import settings

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7              # Web cookie sessions
MOBILE_ACCESS_TOKEN_EXPIRE_MINUTES = 15  # Mobile sessions (short-lived)


def create_access_token(
    data: Dict[str, Any], expires_delta: Optional[timedelta] = None
) -> str:
    """Create a JWT access token (default 7-day expiry for web sessions)."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta if expires_delta else timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=ALGORITHM)


def create_mobile_access_token(data: Dict[str, Any]) -> str:
    """Create a short-lived JWT access token for mobile sessions (15 min)."""
    return create_access_token(
        data, expires_delta=timedelta(minutes=MOBILE_ACCESS_TOKEN_EXPIRE_MINUTES)
    )


def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify a JWT token and return its payload, or None on failure."""
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        return None


async def create_mobile_token_pair(
    user_id: str, user_info: Dict[str, Any]
) -> Tuple[str, str]:
    """
    Create a short-lived access token + refresh token for mobile auth.

    Returns:
        (access_token, raw_refresh_token)
    """
    from uteki.domains.auth.refresh_service import issue_refresh_token

    access_token = create_mobile_access_token(
        data={
            "sub": user_id,
            "email": user_info.get("email"),
            "name": user_info.get("name"),
            "avatar": user_info.get("avatar"),
            "provider": user_info.get("provider"),
        }
    )
    raw_refresh, _ = await issue_refresh_token(user_id)
    return access_token, raw_refresh
