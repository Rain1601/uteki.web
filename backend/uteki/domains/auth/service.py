"""
Auth Service - OAuth和JWT处理逻辑
"""
from typing import Optional, Dict, Any
from urllib.parse import urlencode
import httpx
import logging

from uteki.common.config import settings
from .jwt import create_access_token
from .repository import UserAuthProviderRepository
from uteki.domains.admin.repository import UserRepository

logger = logging.getLogger(__name__)


class AuthService:
    """认证服务"""

    # GitHub OAuth URLs
    GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
    GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
    GITHUB_USER_URL = "https://api.github.com/user"

    # Google OAuth URLs
    GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
    GOOGLE_USER_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

    def __init__(self):
        self.github_client_id = settings.github_client_id
        self.github_client_secret = settings.github_client_secret
        self.google_client_id = settings.google_client_id
        self.google_client_secret = settings.google_client_secret
        self.redirect_base = settings.oauth_redirect_base

    def get_github_login_url(self, state: Optional[str] = None) -> str:
        """生成 GitHub OAuth 授权 URL"""
        params = {
            "client_id": self.github_client_id,
            "redirect_uri": f"{self.redirect_base}/api/auth/github/callback",
            "scope": "read:user user:email",
        }
        if state:
            params["state"] = state
        return f"{self.GITHUB_AUTHORIZE_URL}?{urlencode(params)}"

    def get_google_login_url(self, state: Optional[str] = None) -> str:
        """生成 Google OAuth 授权 URL"""
        params = {
            "client_id": self.google_client_id,
            "redirect_uri": f"{self.redirect_base}/api/auth/google/callback",
            "response_type": "code",
            "scope": "openid email profile",
            "access_type": "offline",
        }
        if state:
            params["state"] = state
        return f"{self.GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_github_code(self, code: str) -> Optional[Dict[str, Any]]:
        """用 GitHub 授权码换取 access token 和用户信息"""
        async with httpx.AsyncClient() as client:
            # 获取 access token
            token_response = await client.post(
                self.GITHUB_TOKEN_URL,
                data={
                    "client_id": self.github_client_id,
                    "client_secret": self.github_client_secret,
                    "code": code,
                    "redirect_uri": f"{self.redirect_base}/api/auth/github/callback",
                },
                headers={"Accept": "application/json"},
            )

            if token_response.status_code != 200:
                logger.error(f"GitHub token exchange failed: {token_response.text}")
                return None

            token_data = token_response.json()
            access_token = token_data.get("access_token")
            if not access_token:
                logger.error(f"No access token in response: {token_data}")
                return None

            # 获取用户信息
            user_response = await client.get(
                self.GITHUB_USER_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )

            if user_response.status_code != 200:
                logger.error(f"GitHub user info failed: {user_response.text}")
                return None

            user_data = user_response.json()

            # 获取用户邮箱（可能需要单独请求）
            email = user_data.get("email")
            if not email:
                emails_response = await client.get(
                    "https://api.github.com/user/emails",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Accept": "application/json",
                    },
                )
                if emails_response.status_code == 200:
                    emails = emails_response.json()
                    primary_email = next(
                        (e["email"] for e in emails if e.get("primary")), None
                    )
                    email = primary_email or (emails[0]["email"] if emails else None)

            return {
                "provider": "github",
                "provider_id": str(user_data["id"]),
                "email": email,
                "name": user_data.get("name") or user_data.get("login"),
                "avatar": user_data.get("avatar_url"),
            }

    async def exchange_google_code(self, code: str) -> Optional[Dict[str, Any]]:
        """用 Google 授权码换取 access token 和用户信息"""
        async with httpx.AsyncClient() as client:
            # 获取 access token
            token_response = await client.post(
                self.GOOGLE_TOKEN_URL,
                data={
                    "client_id": self.google_client_id,
                    "client_secret": self.google_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": f"{self.redirect_base}/api/auth/google/callback",
                },
            )

            if token_response.status_code != 200:
                logger.error(f"Google token exchange failed: {token_response.text}")
                return None

            token_data = token_response.json()
            access_token = token_data.get("access_token")
            if not access_token:
                logger.error(f"No access token in response: {token_data}")
                return None

            # 获取用户信息
            user_response = await client.get(
                self.GOOGLE_USER_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

            if user_response.status_code != 200:
                logger.error(f"Google user info failed: {user_response.text}")
                return None

            user_data = user_response.json()

            return {
                "provider": "google",
                "provider_id": user_data["id"],
                "email": user_data.get("email"),
                "name": user_data.get("name"),
                "avatar": user_data.get("picture"),
            }

    def create_user_token(self, user_id: str, user_info: Dict[str, Any]) -> str:
        """为用户创建 JWT token"""
        return create_access_token(
            data={
                "sub": user_id,
                "email": user_info.get("email"),
                "name": user_info.get("name"),
                "avatar": user_info.get("avatar"),
                "provider": user_info.get("provider"),
            }
        )

    async def find_or_merge_user(
        self,
        provider: str,
        provider_subject: str,
        email: Optional[str],
        username: Optional[str] = None,
        avatar_url: Optional[str] = None,
    ) -> dict:
        """
        Find or create a user for a social login, with same-email account merging.

        Lookup order:
        1. user_auth_providers(provider, subject) → fast path (returning user)
        2. users(email) → found → bind new provider → merge
        3. Neither → create new user + bind provider
        """
        # 1. Look up by provider binding
        binding = await UserAuthProviderRepository.get_by_provider(provider, provider_subject)
        if binding:
            user = await UserRepository.get_by_id(binding["user_id"])
            if user:
                return user

        # 2. Look up by email (merge path)
        user = await UserRepository.get_by_email(email) if email else None

        # 3. Create new user if not found
        if not user:
            from uuid import uuid4
            user_data: Dict[str, Any] = {
                "id": str(uuid4()),
                "email": email or f"{provider}_{provider_subject}@no-email.local",
                "username": username or provider_subject[:50],
                "oauth_provider": provider,
                "oauth_id": provider_subject,
                "avatar_url": avatar_url,
            }
            user = await UserRepository.create(user_data)

        # Bind this provider to the user (merge or new)
        await UserAuthProviderRepository.bind_provider(
            user_id=user["id"],
            provider=provider,
            provider_subject=provider_subject,
        )

        return user

    async def verify_google_id_token(self, id_token: str) -> Dict[str, Any]:
        """
        Verify a Google id_token using google-auth library.

        Returns: { sub, email, name, picture }
        Raises ValueError on invalid token.
        """
        import asyncio
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        audience = settings.google_client_id

        def _verify() -> dict:
            request = google_requests.Request()
            return google_id_token.verify_oauth2_token(id_token, request, audience=audience)

        try:
            payload = await asyncio.get_event_loop().run_in_executor(None, _verify)
            return {
                "sub": payload["sub"],
                "email": payload.get("email"),
                "name": payload.get("name"),
                "picture": payload.get("picture"),
            }
        except Exception as e:
            raise ValueError(f"Google token verification failed: {e}") from e
