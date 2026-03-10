"""
Auth domain repositories — Supabase REST API data access layer.
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from uteki.common.database import SupabaseRepository, db_manager
from uteki.domains.user.models import UserAuthProvider
from uteki.domains.auth.models import RefreshToken

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_id(data: dict) -> dict:
    if "id" not in data:
        data["id"] = str(uuid4())
    data.setdefault("created_at", _now_iso())
    data.setdefault("updated_at", _now_iso())
    return data


async def _backup_row(table: str, model_class, row: dict) -> None:
    try:
        async with db_manager.get_postgres_session() as session:
            safe = {k: v for k, v in row.items() if hasattr(model_class, k)}
            await session.merge(model_class(**safe))
    except Exception as e:
        logger.warning(f"Local backup failed for {table}: {e}")


# ---------------------------------------------------------------------------
# UserAuthProviderRepository
# ---------------------------------------------------------------------------

class UserAuthProviderRepository:
    TABLE = "user_auth_providers"

    @staticmethod
    async def get_by_provider(provider: str, provider_subject: str) -> Optional[dict]:
        """Find a provider binding by provider name + subject ID."""
        return SupabaseRepository(UserAuthProviderRepository.TABLE).select_one(
            eq={"provider": provider, "provider_subject": provider_subject}
        )

    @staticmethod
    async def bind_provider(user_id: str, provider: str, provider_subject: str) -> dict:
        """Create a provider binding for a user."""
        data = {
            "user_id": user_id,
            "provider": provider,
            "provider_subject": provider_subject,
        }
        _ensure_id(data)
        result = SupabaseRepository(UserAuthProviderRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_row(UserAuthProviderRepository.TABLE, UserAuthProvider, row)
        return row

    @staticmethod
    async def get_providers_for_user(user_id: str) -> list:
        """Return all provider bindings for a user."""
        return SupabaseRepository(UserAuthProviderRepository.TABLE).select_data(
            eq={"user_id": user_id}
        )


# ---------------------------------------------------------------------------
# RefreshTokenRepository
# ---------------------------------------------------------------------------

class RefreshTokenRepository:
    TABLE = "refresh_tokens"

    @staticmethod
    async def create(user_id: str, token_hash: str, expires_at: datetime) -> dict:
        data = {
            "id": str(uuid4()),
            "user_id": user_id,
            "token_hash": token_hash,
            "expires_at": expires_at.isoformat(),
            "revoked": False,
            "created_at": _now_iso(),
        }
        result = SupabaseRepository(RefreshTokenRepository.TABLE).insert(data)
        row = result.data[0] if result.data else data
        await _backup_row(RefreshTokenRepository.TABLE, RefreshToken, row)
        return row

    @staticmethod
    async def get_by_hash(token_hash: str) -> Optional[dict]:
        return SupabaseRepository(RefreshTokenRepository.TABLE).select_one(
            eq={"token_hash": token_hash}
        )

    @staticmethod
    async def revoke(token_hash: str) -> None:
        SupabaseRepository(RefreshTokenRepository.TABLE).update(
            data={"revoked": True}, eq={"token_hash": token_hash}
        )

    @staticmethod
    async def revoke_all_for_user(user_id: str) -> None:
        """Revoke ALL tokens for a user (replay attack response)."""
        SupabaseRepository(RefreshTokenRepository.TABLE).update(
            data={"revoked": True}, eq={"user_id": user_id}
        )

    @staticmethod
    async def cleanup_expired() -> None:
        """Delete expired or revoked tokens."""
        now = _now_iso()
        try:
            SupabaseRepository(RefreshTokenRepository.TABLE).delete(
                eq={"revoked": True}
            )
            SupabaseRepository(RefreshTokenRepository.TABLE).delete(
                lte={"expires_at": now}
            )
        except Exception as e:
            logger.warning(f"Refresh token cleanup failed: {e}")
