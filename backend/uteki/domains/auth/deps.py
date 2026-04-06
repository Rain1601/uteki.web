"""
Auth Dependencies - 依赖注入函数
"""
from fastapi import Depends, HTTPException, Request, status
from typing import Optional
import logging

from .jwt import verify_token

logger = logging.getLogger(__name__)

# Cookie name for JWT token
AUTH_COOKIE_NAME = "auth_token"


async def get_current_user_optional(request: Request) -> Optional[dict]:
    """
    获取当前用户（可选，未登录返回None）
    优先从 Authorization header 读取，其次从 Cookie 中读取 JWT token
    """
    token = None

    # 1. 先尝试从 Authorization header 获取 (Bearer token)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]  # Remove "Bearer " prefix

    # 2. 如果没有 header，尝试从 Cookie 获取
    if not token:
        token = request.cookies.get(AUTH_COOKIE_NAME)

    if not token:
        return None

    payload = verify_token(token)
    if payload is None:
        return None

    # 返回用户信息
    return {
        "user_id": payload.get("sub"),
        "email": payload.get("email"),
        "name": payload.get("name"),
        "avatar": payload.get("avatar"),
        "provider": payload.get("provider"),
    }


async def get_current_user(
    user: Optional[dict] = Depends(get_current_user_optional)
) -> dict:
    """获取当前用户（必须登录，未登录返回401）"""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_current_user_sse(request: Request) -> dict:
    """
    SSE-compatible auth: supports query param ?token=xxx in addition to
    Authorization header and Cookie. Needed because EventSource API
    cannot send custom headers.
    """
    # Try normal auth first (header + cookie)
    user = await get_current_user_optional(request)
    if user:
        return user

    # Fallback: check query param
    token = request.query_params.get("token")
    if token:
        payload = verify_token(token)
        if payload:
            return {
                "user_id": payload.get("sub"),
                "email": payload.get("email"),
                "name": payload.get("name"),
                "avatar": payload.get("avatar"),
                "provider": payload.get("provider"),
            }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )
