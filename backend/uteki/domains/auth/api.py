"""
Auth API - OAuth login endpoints and mobile auth endpoints.
"""
from fastapi import APIRouter, Depends, Response, Request, HTTPException, Query, Body
from fastapi.responses import RedirectResponse
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator
import logging
import os

from passlib.context import CryptContext

from uteki.common.config import settings
from uteki.domains.admin.service import UserService
from .service import AuthService
from .deps import get_current_user_optional, get_current_user, AUTH_COOKIE_NAME
from .jwt import create_mobile_token_pair, create_mobile_access_token
from .refresh_service import rotate_refresh_token, revoke_refresh_token

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
auth_service = AuthService()
user_service = UserService()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_frontend_url() -> str:
    """获取前端URL，用于登录后重定向"""
    return os.getenv("FRONTEND_URL", "http://localhost:5173")


# =============================================================================
# GitHub OAuth (web)
# =============================================================================

@router.get("/github/login")
async def github_login(
    redirect_url: Optional[str] = Query(None, description="登录成功后重定向的URL")
):
    """发起 GitHub OAuth 登录"""
    if not settings.github_client_id:
        raise HTTPException(status_code=500, detail="GitHub OAuth not configured")

    state = redirect_url or get_frontend_url()
    login_url = auth_service.get_github_login_url(state=state)
    return RedirectResponse(url=login_url)


@router.get("/github/callback")
async def github_callback(
    code: str = Query(...),
    state: Optional[str] = Query(None),
):
    """GitHub OAuth 回调处理"""
    frontend_url = state or get_frontend_url()

    try:
        user_info = await auth_service.exchange_github_code(code)
        if not user_info:
            logger.error("GitHub OAuth: Failed to get user info")
            return RedirectResponse(url=f"{frontend_url}/login?error=github_auth_failed")

        logger.info(f"GitHub OAuth: Got user info for {user_info.get('email')}")

        user = await user_service.get_or_create_oauth_user(
            oauth_provider=user_info["provider"],
            oauth_id=user_info["provider_id"],
            email=user_info.get("email"),
            username=user_info.get("name"),
            avatar_url=user_info.get("avatar"),
        )

        logger.info(f"GitHub OAuth: User created/found with id {user['id']}")

        token = auth_service.create_user_token(str(user["id"]), user_info)

        redirect_url = f"{frontend_url}#token={token}"
        response = RedirectResponse(url=redirect_url)
        response.set_cookie(
            key=AUTH_COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.environment == "production",
            max_age=60 * 60 * 24 * 7,
        )
        return response

    except Exception as e:
        logger.error(f"GitHub OAuth callback error: {str(e)}", exc_info=True)
        return RedirectResponse(
            url=f"{frontend_url}/login?error=github_callback_error&detail={str(e)[:100]}"
        )


# =============================================================================
# Google OAuth (web redirect)
# =============================================================================

@router.get("/google/login")
async def google_login(
    redirect_url: Optional[str] = Query(None, description="登录成功后重定向的URL")
):
    """发起 Google OAuth 登录"""
    if not settings.google_client_id:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")

    state = redirect_url or get_frontend_url()
    login_url = auth_service.get_google_login_url(state=state)
    return RedirectResponse(url=login_url)


@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    state: Optional[str] = Query(None),
):
    """Google OAuth 回调处理"""
    frontend_url = state or get_frontend_url()

    try:
        user_info = await auth_service.exchange_google_code(code)
        if not user_info:
            logger.error("Google OAuth: Failed to get user info")
            return RedirectResponse(url=f"{frontend_url}/login?error=google_auth_failed")

        logger.info(f"Google OAuth: Got user info for {user_info.get('email')}")

        user = await user_service.get_or_create_oauth_user(
            oauth_provider=user_info["provider"],
            oauth_id=user_info["provider_id"],
            email=user_info.get("email"),
            username=user_info.get("name"),
            avatar_url=user_info.get("avatar"),
        )

        logger.info(f"Google OAuth: User created/found with id {user['id']}")

        token = auth_service.create_user_token(str(user["id"]), user_info)

        redirect_url = f"{frontend_url}#token={token}"
        response = RedirectResponse(url=redirect_url)
        response.set_cookie(
            key=AUTH_COOKIE_NAME,
            value=token,
            httponly=True,
            samesite="lax",
            secure=settings.environment == "production",
            max_age=60 * 60 * 24 * 7,
        )
        return response

    except Exception as e:
        logger.error(f"Google OAuth callback error: {str(e)}", exc_info=True)
        return RedirectResponse(
            url=f"{frontend_url}/login?error=google_callback_error&detail={str(e)[:100]}"
        )


# =============================================================================
# Mobile Social Auth (POST — Flutter native SDK)
# =============================================================================

class MobileAppleLoginRequest(BaseModel):
    identity_token: str


class MobileGoogleLoginRequest(BaseModel):
    id_token: str


class MobileTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@router.post("/mobile/apple", response_model=MobileTokenResponse)
async def mobile_apple_login(body: MobileAppleLoginRequest):
    """
    Mobile Apple Sign-In.
    Accepts identity_token from Flutter sign_in_with_apple SDK.
    """
    from .apple import verify_apple_identity_token
    import httpx as _httpx

    try:
        apple_info = await verify_apple_identity_token(body.identity_token)
    except _httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Apple JWKS service unavailable")
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    user = await auth_service.find_or_merge_user(
        provider="apple",
        provider_subject=apple_info["sub"],
        email=apple_info.get("email"),
    )

    access_token, refresh_token = await create_mobile_token_pair(
        user_id=user["id"],
        user_info={"email": user.get("email"), "provider": "apple"},
    )
    return MobileTokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/mobile/google", response_model=MobileTokenResponse)
async def mobile_google_login(body: MobileGoogleLoginRequest):
    """
    Mobile Google Sign-In.
    Accepts id_token from Flutter google_sign_in SDK.
    """
    try:
        google_info = await auth_service.verify_google_id_token(body.id_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    user = await auth_service.find_or_merge_user(
        provider="google",
        provider_subject=google_info["sub"],
        email=google_info.get("email"),
        username=google_info.get("name"),
        avatar_url=google_info.get("picture"),
    )

    access_token, refresh_token = await create_mobile_token_pair(
        user_id=user["id"],
        user_info={
            "email": user.get("email"),
            "name": user.get("username"),
            "provider": "google",
        },
    )
    return MobileTokenResponse(access_token=access_token, refresh_token=refresh_token)


# =============================================================================
# Email Auth (mobile + web)
# =============================================================================

class EmailRegisterRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class EmailLoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/email/register", response_model=MobileTokenResponse, status_code=201)
async def email_register(body: EmailRegisterRequest):
    """
    Email + password registration.
    Returns 409 if email already exists (under any provider).
    """
    from uteki.domains.admin.repository import UserRepository
    from .repository import UserAuthProviderRepository
    from uuid import uuid4

    existing = await UserRepository.get_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="邮箱已注册")

    hashed = pwd_ctx.hash(body.password)

    user_data = {
        "id": str(uuid4()),
        "email": body.email,
        "username": body.email.split("@")[0][:50],
        "hashed_password": hashed,
        "oauth_provider": "email",
        "oauth_id": body.email,
    }
    user = await UserRepository.create(user_data)

    await UserAuthProviderRepository.bind_provider(
        user_id=user["id"],
        provider="email",
        provider_subject=body.email,
    )

    access_token, refresh_token = await create_mobile_token_pair(
        user_id=user["id"],
        user_info={"email": body.email, "provider": "email"},
    )
    return MobileTokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/email/login", response_model=MobileTokenResponse)
async def email_login(body: EmailLoginRequest):
    """
    Email + password login.
    Returns generic 401 for wrong email OR wrong password (do not reveal which).
    """
    from uteki.domains.admin.repository import UserRepository

    _GENERIC_ERROR = "邮箱或密码错误"

    user = await UserRepository.get_by_email(body.email)
    if not user:
        raise HTTPException(status_code=401, detail=_GENERIC_ERROR)

    hashed = user.get("hashed_password")
    if not hashed:
        raise HTTPException(
            status_code=401,
            detail="该账号通过第三方登录注册，请使用对应登录方式",
        )

    if not pwd_ctx.verify(body.password, hashed):
        raise HTTPException(status_code=401, detail=_GENERIC_ERROR)

    access_token, refresh_token = await create_mobile_token_pair(
        user_id=user["id"],
        user_info={"email": body.email, "provider": "email"},
    )
    return MobileTokenResponse(access_token=access_token, refresh_token=refresh_token)


# =============================================================================
# Refresh Token
# =============================================================================

class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=MobileTokenResponse)
async def refresh_token_endpoint(body: RefreshRequest):
    """
    Exchange a refresh token for a new access token + refresh token pair.
    Implements rotation: old token is immediately revoked.
    """
    try:
        user_id, new_raw_refresh = await rotate_refresh_token(body.refresh_token)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh token error: {e}", exc_info=True)
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    from uteki.domains.admin.repository import UserRepository
    user = await UserRepository.get_by_id(user_id)
    email = user.get("email") if user else None

    access_token = create_mobile_access_token(
        data={"sub": user_id, "email": email, "provider": "refresh"}
    )
    return MobileTokenResponse(access_token=access_token, refresh_token=new_raw_refresh)


# =============================================================================
# Session Management
# =============================================================================

class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


@router.get("/me")
async def get_current_user_info(
    user: Optional[dict] = Depends(get_current_user_optional)
):
    """获取当前登录用户信息"""
    if user is None:
        return {"authenticated": False, "user": None}
    return {"authenticated": True, "user": user}


@router.post("/logout")
async def logout(
    response: Response, body: Optional[LogoutRequest] = Body(default=None)
):
    """用户登出 — clears web cookie and optionally revokes refresh token."""
    response.delete_cookie(key=AUTH_COOKIE_NAME)
    if body and body.refresh_token:
        await revoke_refresh_token(body.refresh_token)
    return {"message": "Logged out successfully"}


# =============================================================================
# Dev Login
# =============================================================================

@router.get("/dev/login")
async def dev_login(
    redirect_url: Optional[str] = Query(None),
):
    """开发环境快速登录（仅 development 模式可用）"""
    if settings.environment not in ("development", "local_development"):
        raise HTTPException(status_code=404, detail="Not Found")

    frontend_url = redirect_url or get_frontend_url()

    user_info = {
        "provider": "dev",
        "provider_id": "dev-local-001",
        "email": "dev@uteki.local",
        "name": "Dev User",
        "avatar": None,
    }

    user = await user_service.get_or_create_oauth_user(
        oauth_provider=user_info["provider"],
        oauth_id=user_info["provider_id"],
        email=user_info["email"],
        username=user_info["name"],
        avatar_url=user_info["avatar"],
    )

    token = auth_service.create_user_token(str(user["id"]), user_info)

    response = RedirectResponse(url=f"{frontend_url}#token={token}")
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 7,
    )
    return response
