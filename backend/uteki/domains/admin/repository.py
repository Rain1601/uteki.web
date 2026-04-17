"""
Admin domain repository - Supabase REST API 数据访问层
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import uuid4

from uteki.common.database import SupabaseRepository, db_manager

logger = logging.getLogger(__name__)

# ORM models — only imported for SQLite backup
from uteki.domains.admin.models import (
    APIKey,
    User,
    SystemConfig,
    AuditLog,
    LLMProvider,
    ExchangeConfig,
    DataSourceConfig,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_id(data: dict) -> dict:
    """Ensure dict has id + timestamps for a new row."""
    if "id" not in data:
        data["id"] = str(uuid4())
    data.setdefault("created_at", _now_iso())
    data.setdefault("updated_at", _now_iso())
    return data


async def _backup_rows(table: str, model_class, rows: list):
    """Best-effort SQLite backup (failure only warns)."""
    try:
        async with db_manager.get_postgres_session() as session:
            for row in rows:
                safe = {k: v for k, v in row.items() if hasattr(model_class, k)}
                await session.merge(model_class(**safe))
    except Exception as e:
        logger.warning(f"SQLite backup failed for {table}: {e}")


# ---------------------------------------------------------------------------
# APIKeyRepository
# ---------------------------------------------------------------------------

class APIKeyRepository:
    TABLE = "api_keys"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(APIKeyRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(APIKeyRepository.TABLE, APIKey, [row])
        return row

    @staticmethod
    async def get_by_id(api_key_id: str, user_id: str) -> Optional[dict]:
        return SupabaseRepository(APIKeyRepository.TABLE).select_one(
            eq={"id": api_key_id, "user_id": user_id}
        )

    @staticmethod
    async def get_by_provider(
        provider: str, user_id: str, environment: str = "production"
    ) -> Optional[dict]:
        return SupabaseRepository(APIKeyRepository.TABLE).select_one(
            eq={
                "provider": provider,
                "user_id": user_id,
                "environment": environment,
                "is_active": True,
            }
        )

    @staticmethod
    async def list_all(
        user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(APIKeyRepository.TABLE).select(
            "*", count="exact", eq={"user_id": user_id}, offset=skip, limit=limit
        )
        return result.data, result.count or 0

    @staticmethod
    async def update(api_key_id: str, user_id: str, **kwargs) -> Optional[dict]:
        kwargs["updated_at"] = _now_iso()
        result = SupabaseRepository(APIKeyRepository.TABLE).update(
            data=kwargs, eq={"id": api_key_id, "user_id": user_id}
        )
        if result.data:
            await _backup_rows(APIKeyRepository.TABLE, APIKey, result.data)
            return result.data[0]
        return None

    @staticmethod
    async def delete(api_key_id: str, user_id: str) -> bool:
        result = SupabaseRepository(APIKeyRepository.TABLE).delete(
            eq={"id": api_key_id, "user_id": user_id}
        )
        return bool(result.data)


# ---------------------------------------------------------------------------
# UserRepository
# ---------------------------------------------------------------------------

class UserRepository:
    TABLE = "users"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(UserRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(UserRepository.TABLE, User, [row])
        return row

    @staticmethod
    async def get_by_id(user_id: str) -> Optional[dict]:
        return SupabaseRepository(UserRepository.TABLE).select_one(
            eq={"id": user_id}
        )

    @staticmethod
    async def get_by_email(email: str) -> Optional[dict]:
        return SupabaseRepository(UserRepository.TABLE).select_one(
            eq={"email": email}
        )

    @staticmethod
    async def get_by_oauth(
        oauth_provider: str, oauth_id: str
    ) -> Optional[dict]:
        return SupabaseRepository(UserRepository.TABLE).select_one(
            eq={"oauth_provider": oauth_provider, "oauth_id": oauth_id}
        )

    @staticmethod
    async def list_all(
        skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(UserRepository.TABLE).select(
            "*", count="exact", offset=skip, limit=limit
        )
        return result.data, result.count or 0

    @staticmethod
    async def update(user_id: str, **kwargs) -> Optional[dict]:
        kwargs["updated_at"] = _now_iso()
        result = SupabaseRepository(UserRepository.TABLE).update(
            data=kwargs, eq={"id": user_id}
        )
        if result.data:
            await _backup_rows(UserRepository.TABLE, User, result.data)
            return result.data[0]
        return None


# ---------------------------------------------------------------------------
# SystemConfigRepository
# ---------------------------------------------------------------------------

class SystemConfigRepository:
    TABLE = "system_config"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(SystemConfigRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(SystemConfigRepository.TABLE, SystemConfig, [row])
        return row

    @staticmethod
    async def get_by_key(config_key: str) -> Optional[dict]:
        return SupabaseRepository(SystemConfigRepository.TABLE).select_one(
            eq={"config_key": config_key}
        )

    @staticmethod
    async def list_all() -> List[dict]:
        return SupabaseRepository(SystemConfigRepository.TABLE).select_data()

    @staticmethod
    async def update(config_key: str, **kwargs) -> Optional[dict]:
        kwargs["updated_at"] = _now_iso()
        result = SupabaseRepository(SystemConfigRepository.TABLE).update(
            data=kwargs, eq={"config_key": config_key}
        )
        if result.data:
            await _backup_rows(SystemConfigRepository.TABLE, SystemConfig, result.data)
            return result.data[0]
        return None

    @staticmethod
    async def delete(config_key: str) -> bool:
        result = SupabaseRepository(SystemConfigRepository.TABLE).delete(
            eq={"config_key": config_key}
        )
        return bool(result.data)


# ---------------------------------------------------------------------------
# AuditLogRepository
# ---------------------------------------------------------------------------

class AuditLogRepository:
    TABLE = "audit_logs"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(AuditLogRepository.TABLE).insert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(AuditLogRepository.TABLE, AuditLog, [row])
        return row

    @staticmethod
    async def list_by_user(
        user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(AuditLogRepository.TABLE).select(
            "*", count="exact",
            eq={"user_id": user_id},
            order="created_at.desc",
            offset=skip, limit=limit,
        )
        return result.data, result.count or 0

    @staticmethod
    async def list_all(
        skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(AuditLogRepository.TABLE).select(
            "*", count="exact",
            order="created_at.desc",
            offset=skip, limit=limit,
        )
        return result.data, result.count or 0


# ---------------------------------------------------------------------------
# LLMProviderRepository
# ---------------------------------------------------------------------------

class LLMProviderRepository:
    TABLE = "llm_providers"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(LLMProviderRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(LLMProviderRepository.TABLE, LLMProvider, [row])
        return row

    @staticmethod
    async def get_by_id(provider_id: str, user_id: str) -> Optional[dict]:
        return SupabaseRepository(LLMProviderRepository.TABLE).select_one(
            eq={"id": provider_id, "user_id": user_id}
        )

    @staticmethod
    async def get_default_provider(user_id: str) -> Optional[dict]:
        return SupabaseRepository(LLMProviderRepository.TABLE).select_one(
            eq={"is_default": True, "is_active": True, "user_id": user_id},
            order="priority.asc",
        )

    @staticmethod
    async def list_active_providers(user_id: str) -> List[dict]:
        return SupabaseRepository(LLMProviderRepository.TABLE).select_data(
            eq={"is_active": True, "user_id": user_id},
            order="priority.asc",
        )

    @staticmethod
    async def list_all(
        user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(LLMProviderRepository.TABLE).select(
            "*", count="exact",
            eq={"user_id": user_id},
            order="priority.asc",
            offset=skip, limit=limit,
        )
        return result.data, result.count or 0

    @staticmethod
    async def update(provider_id: str, user_id: str, **kwargs) -> Optional[dict]:
        kwargs["updated_at"] = _now_iso()
        result = SupabaseRepository(LLMProviderRepository.TABLE).update(
            data=kwargs, eq={"id": provider_id, "user_id": user_id}
        )
        if result.data:
            await _backup_rows(LLMProviderRepository.TABLE, LLMProvider, result.data)
            return result.data[0]
        return None

    @staticmethod
    async def delete(provider_id: str, user_id: str) -> bool:
        result = SupabaseRepository(LLMProviderRepository.TABLE).delete(
            eq={"id": provider_id, "user_id": user_id}
        )
        return bool(result.data)


# ---------------------------------------------------------------------------
# ExchangeConfigRepository
# ---------------------------------------------------------------------------

class ExchangeConfigRepository:
    TABLE = "exchange_configs"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(ExchangeConfigRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(ExchangeConfigRepository.TABLE, ExchangeConfig, [row])
        return row

    @staticmethod
    async def get_by_id(config_id: str, user_id: str) -> Optional[dict]:
        return SupabaseRepository(ExchangeConfigRepository.TABLE).select_one(
            eq={"id": config_id, "user_id": user_id}
        )

    @staticmethod
    async def get_by_exchange(exchange: str, user_id: str) -> Optional[dict]:
        return SupabaseRepository(ExchangeConfigRepository.TABLE).select_one(
            eq={"exchange": exchange, "user_id": user_id, "is_active": True}
        )

    @staticmethod
    async def list_active_exchanges(user_id: str) -> List[dict]:
        return SupabaseRepository(ExchangeConfigRepository.TABLE).select_data(
            eq={"is_active": True, "user_id": user_id}
        )

    @staticmethod
    async def list_all(
        user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(ExchangeConfigRepository.TABLE).select(
            "*", count="exact", eq={"user_id": user_id}, offset=skip, limit=limit
        )
        return result.data, result.count or 0

    @staticmethod
    async def update(config_id: str, user_id: str, **kwargs) -> Optional[dict]:
        kwargs["updated_at"] = _now_iso()
        result = SupabaseRepository(ExchangeConfigRepository.TABLE).update(
            data=kwargs, eq={"id": config_id, "user_id": user_id}
        )
        if result.data:
            await _backup_rows(ExchangeConfigRepository.TABLE, ExchangeConfig, result.data)
            return result.data[0]
        return None

    @staticmethod
    async def delete(config_id: str, user_id: str) -> bool:
        result = SupabaseRepository(ExchangeConfigRepository.TABLE).delete(
            eq={"id": config_id, "user_id": user_id}
        )
        return bool(result.data)


# ---------------------------------------------------------------------------
# DataSourceConfigRepository
# ---------------------------------------------------------------------------

class DataSourceConfigRepository:
    TABLE = "data_source_configs"

    @staticmethod
    async def create(data: dict) -> dict:
        _ensure_id(data)
        result = SupabaseRepository(DataSourceConfigRepository.TABLE).upsert(data)
        row = result.data[0] if result.data else data
        await _backup_rows(DataSourceConfigRepository.TABLE, DataSourceConfig, [row])
        return row

    @staticmethod
    async def get_by_id(config_id: str) -> Optional[dict]:
        return SupabaseRepository(DataSourceConfigRepository.TABLE).select_one(
            eq={"id": config_id}
        )

    @staticmethod
    async def get_by_source_type(source_type: str) -> Optional[dict]:
        return SupabaseRepository(DataSourceConfigRepository.TABLE).select_one(
            eq={"source_type": source_type, "is_active": True},
            order="priority.asc",
        )

    @staticmethod
    async def list_active_sources() -> List[dict]:
        return SupabaseRepository(DataSourceConfigRepository.TABLE).select_data(
            eq={"is_active": True},
            order="priority.asc",
        )

    @staticmethod
    async def list_by_data_type(data_type: str) -> List[dict]:
        # JSON array contains — fetch all active and filter client-side
        # (data_source_configs is a small table)
        all_active = SupabaseRepository(DataSourceConfigRepository.TABLE).select_data(
            eq={"is_active": True},
            order="priority.asc",
        )
        return [ds for ds in all_active if data_type in (ds.get("data_types") or [])]

    @staticmethod
    async def list_all(
        skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        result = SupabaseRepository(DataSourceConfigRepository.TABLE).select(
            "*", count="exact",
            order="priority.asc",
            offset=skip, limit=limit,
        )
        return result.data, result.count or 0

    @staticmethod
    async def update(config_id: str, **kwargs) -> Optional[dict]:
        kwargs["updated_at"] = _now_iso()
        result = SupabaseRepository(DataSourceConfigRepository.TABLE).update(
            data=kwargs, eq={"id": config_id}
        )
        if result.data:
            await _backup_rows(DataSourceConfigRepository.TABLE, DataSourceConfig, result.data)
            return result.data[0]
        return None

    @staticmethod
    async def delete(config_id: str) -> bool:
        result = SupabaseRepository(DataSourceConfigRepository.TABLE).delete(
            eq={"id": config_id}
        )
        return bool(result.data)
