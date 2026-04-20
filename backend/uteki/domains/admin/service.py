"""
Admin domain service - 业务逻辑层
"""

import logging
from typing import List, Optional, Tuple
from cryptography.fernet import Fernet
import os

logger = logging.getLogger(__name__)

from uteki.domains.admin.repository import (
    APIKeyRepository,
    UserRepository,
    SystemConfigRepository,
    AuditLogRepository,
    LLMProviderRepository,
    ExchangeConfigRepository,
    DataSourceConfigRepository,
)
from uteki.domains.admin import schemas


class EncryptionService:
    """加密服务 - 用于敏感数据加密"""

    def __init__(self):
        from uteki.common.config import settings
        key = settings.encryption_key
        if not key:
            logger.warning("ENCRYPTION_KEY 未设置，生成临时密钥。加密数据将在重启后失效！")
            key = Fernet.generate_key()
        elif isinstance(key, str):
            key = key.encode()

        self.fernet = Fernet(key)

    def encrypt(self, plain_text: str) -> str:
        return self.fernet.encrypt(plain_text.encode()).decode()

    def decrypt(self, encrypted_text: str) -> str:
        return self.fernet.decrypt(encrypted_text.encode()).decode()

    @staticmethod
    def mask_api_key(api_key: str, visible_chars: int = 4) -> str:
        if len(api_key) <= visible_chars:
            return "*" * len(api_key)
        return api_key[:visible_chars] + "*" * (len(api_key) - visible_chars)


class APIKeyService:
    """API密钥服务 — 所有方法强制按 user_id 隔离。"""

    def __init__(self, encryption_service: EncryptionService):
        self.encryption = encryption_service

    async def create_api_key(self, data: schemas.APIKeyCreate, user_id: str) -> dict:
        encrypted_key = self.encryption.encrypt(data.api_key)
        encrypted_secret = (
            self.encryption.encrypt(data.api_secret) if data.api_secret else None
        )

        api_key_data = {
            "user_id": user_id,
            "provider": data.provider,
            "display_name": data.display_name,
            "api_key": encrypted_key,
            "api_secret": encrypted_secret,
            "extra_config": data.extra_config,
            "environment": data.environment,
            "is_active": data.is_active,
            "description": data.description,
        }

        return await APIKeyRepository.create(api_key_data)

    async def get_api_key(
        self, api_key_id: str, user_id: str, decrypt: bool = False
    ) -> Optional[dict]:
        api_key = await APIKeyRepository.get_by_id(api_key_id, user_id)
        if api_key and decrypt:
            api_key["api_key"] = self.encryption.decrypt(api_key["api_key"])
            if api_key.get("api_secret"):
                api_key["api_secret"] = self.encryption.decrypt(api_key["api_secret"])
        return api_key

    async def get_api_key_by_provider(
        self, provider: str, user_id: str, environment: str = "production"
    ) -> Optional[dict]:
        api_key = await APIKeyRepository.get_by_provider(provider, user_id, environment)
        if api_key:
            api_key["api_key"] = self.encryption.decrypt(api_key["api_key"])
            if api_key.get("api_secret"):
                api_key["api_secret"] = self.encryption.decrypt(api_key["api_secret"])
        return api_key

    async def list_api_keys(
        self, user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[schemas.APIKeyDetailResponse], int]:
        items, total = await APIKeyRepository.list_all(user_id, skip, limit)

        response_items = []
        for item in items:
            # Decrypt to get masked version
            try:
                decrypted_key = self.encryption.decrypt(item["api_key"])
                masked = self.encryption.mask_api_key(decrypted_key)
            except Exception:
                masked = "****"
            response_items.append(
                schemas.APIKeyDetailResponse(
                    id=item["id"],
                    provider=item["provider"],
                    display_name=item["display_name"],
                    environment=item["environment"],
                    description=item.get("description"),
                    is_active=item["is_active"],
                    has_secret=item.get("api_secret") is not None,
                    api_key_masked=masked,
                    extra_config=item.get("extra_config"),
                    created_at=item["created_at"],
                    updated_at=item["updated_at"],
                )
            )

        return response_items, total

    async def update_api_key(
        self, api_key_id: str, user_id: str, data: schemas.APIKeyUpdate
    ) -> Optional[dict]:
        update_data = data.dict(exclude_unset=True)

        if "api_key" in update_data:
            update_data["api_key"] = self.encryption.encrypt(update_data["api_key"])
        if "api_secret" in update_data and update_data["api_secret"]:
            update_data["api_secret"] = self.encryption.encrypt(update_data["api_secret"])

        return await APIKeyRepository.update(api_key_id, user_id, **update_data)

    async def delete_api_key(self, api_key_id: str, user_id: str) -> bool:
        return await APIKeyRepository.delete(api_key_id, user_id)


class UserService:
    """用户服务"""

    async def create_user(self, data: schemas.UserCreate) -> dict:
        user_data = {
            "email": data.email,
            "username": data.username,
            "oauth_provider": data.oauth_provider,
            "oauth_id": data.oauth_id,
            "avatar_url": data.avatar_url,
        }
        return await UserRepository.create(user_data)

    async def get_user(self, user_id: str) -> Optional[dict]:
        return await UserRepository.get_by_id(user_id)

    async def get_user_by_email(self, email: str) -> Optional[dict]:
        return await UserRepository.get_by_email(email)

    async def get_or_create_oauth_user(
        self,
        oauth_provider: str,
        oauth_id: str,
        email: str,
        username: str,
        avatar_url: Optional[str] = None,
    ) -> dict:
        user = await UserRepository.get_by_oauth(oauth_provider, oauth_id)
        if not user:
            user_data = {
                "email": email,
                "username": username,
                "oauth_provider": oauth_provider,
                "oauth_id": oauth_id,
                "avatar_url": avatar_url,
            }
            user = await UserRepository.create(user_data)
        return user

    async def list_users(
        self, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        return await UserRepository.list_all(skip, limit)

    async def update_user(
        self, user_id: str, data: schemas.UserUpdate
    ) -> Optional[dict]:
        update_data = data.dict(exclude_unset=True)
        return await UserRepository.update(user_id, **update_data)


class SystemConfigService:
    """系统配置服务"""

    async def set_config(self, data: schemas.SystemConfigCreate) -> dict:
        existing = await SystemConfigRepository.get_by_key(data.config_key)
        if existing:
            return await SystemConfigRepository.update(
                data.config_key,
                config_value=data.config_value,
                config_type=data.config_type,
                description=data.description,
                is_sensitive=data.is_sensitive,
            )
        else:
            config_data = {
                "config_key": data.config_key,
                "config_value": data.config_value,
                "config_type": data.config_type,
                "description": data.description,
                "is_sensitive": data.is_sensitive,
            }
            return await SystemConfigRepository.create(config_data)

    async def get_config(self, config_key: str) -> Optional[dict]:
        return await SystemConfigRepository.get_by_key(config_key)

    async def list_all_configs(self) -> List[dict]:
        return await SystemConfigRepository.list_all()

    async def delete_config(self, config_key: str) -> bool:
        return await SystemConfigRepository.delete(config_key)


class AuditLogService:
    """审计日志服务"""

    async def log_action(
        self,
        action: str,
        resource_type: str,
        status: str,
        user_id: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> dict:
        log_data = {
            "user_id": user_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "status": status,
            "error_message": error_message,
        }
        return await AuditLogRepository.create(log_data)

    async def list_user_logs(
        self, user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        return await AuditLogRepository.list_by_user(user_id, skip, limit)

    async def list_all_logs(
        self, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        return await AuditLogRepository.list_all(skip, limit)


# 每位用户首次进入 Admin → Models 时 seed 的默认 catalog。
# 运行时鉴权走聚合器 (AIHubMix / OpenRouter), 所有 row 共享同一个 api_key_id。
# model id 直接对应 AIHubMix `/api/v1/models` 返回的 model_id.
DEFAULT_LLM_CATALOG: list[dict] = [
    {"provider": "anthropic", "model": "claude-opus-4-7",                "display_name": "Claude Opus 4.7",         "priority": 0},
    {"provider": "openai",    "model": "gpt-5.4",                        "display_name": "GPT-5.4",                 "priority": 1},
    {"provider": "deepseek",  "model": "deepseek-v3.2",                  "display_name": "DeepSeek V3.2",           "priority": 2},
    {"provider": "google",    "model": "gemini-3.1-pro-preview-search",  "display_name": "Gemini 3.1 Pro (Search)", "priority": 3},
    {"provider": "qwen",      "model": "qwen3.6-plus",                   "display_name": "Qwen 3.6 Plus",           "priority": 4},
    {"provider": "minimax",   "model": "minimax-m2.7",                   "display_name": "MiniMax M2.7",            "priority": 5},
]

_AGGREGATOR_PROVIDERS = ("aihubmix", "openrouter")


class LLMProviderService:
    """LLM提供商服务 — 所有方法强制按 user_id 隔离。"""

    async def ensure_default_providers(self, user_id: str) -> bool:
        """首次访问时为该用户 seed DEFAULT_LLM_CATALOG。

        前置: 用户已配置至少一个聚合器 key (AIHubMix / OpenRouter)。
        7 条 row 都挂在该 api_key 下 — 真正鉴权走 aggregator_service.resolve_unified_provider。
        返回 True 表示本次发生了 seed。
        """
        _, total = await LLMProviderRepository.list_all(user_id, 0, 1)
        if total > 0:
            return False

        agg_key_id: Optional[str] = None
        for agg in _AGGREGATOR_PROVIDERS:
            row = await APIKeyRepository.get_by_provider(agg, user_id, "production")
            if row:
                agg_key_id = row["id"]
                break
        if not agg_key_id:
            # 聚合器未配置, 不 seed; 前端顶部 InterfaceForLLMs 卡会引导用户先配置
            return False

        for entry in DEFAULT_LLM_CATALOG:
            await LLMProviderRepository.create({
                "user_id": user_id,
                "provider": entry["provider"],
                "model": entry["model"],
                "api_key_id": agg_key_id,
                "display_name": entry["display_name"],
                "config": {},
                "is_default": entry["priority"] == 0,
                "is_active": True,
                "priority": entry["priority"],
                "description": None,
            })
        logger.info(f"Seeded {len(DEFAULT_LLM_CATALOG)} default llm_providers for user {user_id}")
        return True

    async def create_provider(self, data: schemas.LLMProviderCreate, user_id: str) -> dict:
        provider_data = {
            "user_id": user_id,
            "provider": data.provider,
            "model": data.model,
            "api_key_id": data.api_key_id,
            "display_name": data.display_name,
            "config": data.config,
            "is_default": data.is_default,
            "is_active": data.is_active,
            "priority": data.priority,
            "description": data.description,
        }
        return await LLMProviderRepository.create(provider_data)

    async def get_provider(self, provider_id: str, user_id: str) -> Optional[dict]:
        return await LLMProviderRepository.get_by_id(provider_id, user_id)

    async def get_default_provider(self, user_id: str) -> Optional[dict]:
        return await LLMProviderRepository.get_default_provider(user_id)

    async def list_providers(
        self, user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        return await LLMProviderRepository.list_all(user_id, skip, limit)

    async def list_active_providers(self, user_id: str) -> List[dict]:
        return await LLMProviderRepository.list_active_providers(user_id)

    async def update_provider(
        self, provider_id: str, user_id: str, data: schemas.LLMProviderUpdate
    ) -> Optional[dict]:
        update_data = data.dict(exclude_unset=True)
        return await LLMProviderRepository.update(provider_id, user_id, **update_data)

    async def delete_provider(self, provider_id: str, user_id: str) -> bool:
        return await LLMProviderRepository.delete(provider_id, user_id)

    async def create_provider_with_key(
        self,
        provider: str,
        model: str,
        api_key: str,
        display_name: str,
        user_id: str,
        config: Optional[dict] = None,
        is_default: bool = False,
        is_active: bool = True,
        priority: int = 0,
        base_url: Optional[str] = None,
        encryption_service: Optional["EncryptionService"] = None,
    ) -> dict:
        """两步创建：先查找或新建 API Key，再创建 LLM Provider"""
        enc = encryption_service or EncryptionService()

        # Step 1: Find existing active API key for this provider (scoped to user), or create new
        existing_key = await APIKeyRepository.get_by_provider(provider, user_id, "production")
        if existing_key:
            api_key_id = existing_key["id"]
            # Update the API key if a new one is provided
            if api_key:
                encrypted = enc.encrypt(api_key)
                await APIKeyRepository.update(api_key_id, user_id, api_key=encrypted)
        else:
            encrypted = enc.encrypt(api_key)
            key_data = {
                "user_id": user_id,
                "provider": provider,
                "display_name": f"{provider} API Key",
                "api_key": encrypted,
                "environment": "production",
                "is_active": True,
            }
            new_key = await APIKeyRepository.create(key_data)
            api_key_id = new_key["id"]

        # Step 2: Create LLM provider linked to the API key
        provider_config = config or {}
        if base_url:
            provider_config["base_url"] = base_url

        provider_data = {
            "user_id": user_id,
            "provider": provider,
            "model": model,
            "api_key_id": api_key_id,
            "display_name": display_name,
            "config": provider_config,
            "is_default": is_default,
            "is_active": is_active,
            "priority": priority,
        }
        return await LLMProviderRepository.create(provider_data)

    async def get_active_models_for_runtime(
        self,
        user_id: Optional[str] = None,
        encryption_service: Optional["EncryptionService"] = None,
    ) -> list:
        """获取指定用户可用模型列表（解密 API Key）。

        如果 user_id 为 None（例如从无认证上下文的后台调度调用），返回空列表并记录警告。
        调用方应优先透传当前登录用户的 user_id。
        """
        if not user_id:
            logger.warning(
                "get_active_models_for_runtime called without user_id — returning empty. "
                "Callers with a user context should pass user_id explicitly."
            )
            return []
        enc = encryption_service or EncryptionService()
        providers = await LLMProviderRepository.list_active_providers(user_id)
        if not providers:
            return []

        models = []
        for p in providers:
            api_key_id = p.get("api_key_id")
            if not api_key_id:
                continue

            key_row = await APIKeyRepository.get_by_id(api_key_id, user_id)
            if not key_row or not key_row.get("is_active", True):
                continue

            try:
                decrypted_key = enc.decrypt(key_row["api_key"])
            except Exception as e:
                logger.warning(f"Failed to decrypt API key for provider {p['provider']}/{p['model']}: {type(e).__name__}: {e}")
                continue

            config = p.get("config") or {}
            models.append({
                "provider": p["provider"],
                "model": p["model"],
                "api_key": decrypted_key,
                "base_url": config.get("base_url"),
                "temperature": config.get("temperature", 0),
                "max_tokens": config.get("max_tokens", 4096),
                "enabled": True,
            })

        return models


class ExchangeConfigService:
    """交易所配置服务 — 所有方法强制按 user_id 隔离。"""

    async def create_exchange(self, data: schemas.ExchangeConfigCreate, user_id: str) -> dict:
        exchange_data = {
            "user_id": user_id,
            "exchange": data.exchange,
            "api_key_id": data.api_key_id,
            "display_name": data.display_name,
            "trading_enabled": data.trading_enabled,
            "spot_enabled": data.spot_enabled,
            "futures_enabled": data.futures_enabled,
            "max_position_size": float(data.max_position_size),
            "risk_config": data.risk_config,
            "exchange_config": data.exchange_config,
            "is_active": data.is_active,
            "description": data.description,
        }
        return await ExchangeConfigRepository.create(exchange_data)

    async def get_exchange(self, config_id: str, user_id: str) -> Optional[dict]:
        return await ExchangeConfigRepository.get_by_id(config_id, user_id)

    async def get_exchange_by_name(self, exchange: str, user_id: str) -> Optional[dict]:
        return await ExchangeConfigRepository.get_by_exchange(exchange, user_id)

    async def list_exchanges(
        self, user_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        return await ExchangeConfigRepository.list_all(user_id, skip, limit)

    async def list_active_exchanges(self, user_id: str) -> List[dict]:
        return await ExchangeConfigRepository.list_active_exchanges(user_id)

    async def update_exchange(
        self, config_id: str, user_id: str, data: schemas.ExchangeConfigUpdate
    ) -> Optional[dict]:
        update_data = data.dict(exclude_unset=True)
        if "max_position_size" in update_data:
            update_data["max_position_size"] = float(update_data["max_position_size"])
        return await ExchangeConfigRepository.update(config_id, user_id, **update_data)

    async def delete_exchange(self, config_id: str, user_id: str) -> bool:
        return await ExchangeConfigRepository.delete(config_id, user_id)


class DataSourceConfigService:
    """数据源配置服务"""

    async def create_data_source(self, data: schemas.DataSourceConfigCreate) -> dict:
        ds_data = {
            "source_type": data.source_type,
            "api_key_id": data.api_key_id,
            "display_name": data.display_name,
            "data_types": data.data_types,
            "refresh_interval": data.refresh_interval,
            "priority": data.priority,
            "source_config": data.source_config,
            "is_active": data.is_active,
            "description": data.description,
        }
        return await DataSourceConfigRepository.create(ds_data)

    async def get_data_source(self, config_id: str) -> Optional[dict]:
        return await DataSourceConfigRepository.get_by_id(config_id)

    async def get_data_source_by_type(self, source_type: str) -> Optional[dict]:
        return await DataSourceConfigRepository.get_by_source_type(source_type)

    async def list_data_sources(
        self, skip: int = 0, limit: int = 100
    ) -> Tuple[List[dict], int]:
        return await DataSourceConfigRepository.list_all(skip, limit)

    async def list_active_data_sources(self) -> List[dict]:
        return await DataSourceConfigRepository.list_active_sources()

    async def list_by_data_type(self, data_type: str) -> List[dict]:
        return await DataSourceConfigRepository.list_by_data_type(data_type)

    async def update_data_source(
        self, config_id: str, data: schemas.DataSourceConfigUpdate
    ) -> Optional[dict]:
        update_data = data.dict(exclude_unset=True)
        return await DataSourceConfigRepository.update(config_id, **update_data)

    async def delete_data_source(self, config_id: str) -> bool:
        return await DataSourceConfigRepository.delete(config_id)


# ---------------------------------------------------------------------------
# 依赖注入工厂函数
# ---------------------------------------------------------------------------

def get_encryption_service() -> EncryptionService:
    return EncryptionService()


def get_api_key_service() -> APIKeyService:
    return APIKeyService(get_encryption_service())


def get_user_service() -> UserService:
    return UserService()


def get_system_config_service() -> SystemConfigService:
    return SystemConfigService()


def get_audit_log_service() -> AuditLogService:
    return AuditLogService()


def get_llm_provider_service() -> LLMProviderService:
    return LLMProviderService()


def get_exchange_config_service() -> ExchangeConfigService:
    return ExchangeConfigService()


def get_data_source_config_service() -> DataSourceConfigService:
    return DataSourceConfigService()
