"""
Admin domain API routes - FastAPI路由

All endpoints require authentication (router-level dependency). Resources that
hold user secrets (api_keys, llm_providers, exchange_configs) are additionally
filtered by the authenticated user's id to prevent cross-user leakage.
"""

from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.encoders import jsonable_encoder
from typing import List

from uteki.common.cache import get_cache_service
from uteki.common.database import db_manager
from uteki.domains.admin import schemas
from uteki.domains.admin.service import (
    get_api_key_service,
    get_user_service,
    get_system_config_service,
    get_audit_log_service,
    get_llm_provider_service,
    get_exchange_config_service,
    get_data_source_config_service,
    get_encryption_service,
)
from uteki.domains.auth.deps import get_current_user

_TTL = 86400


def _today() -> str:
    return date.today().isoformat()


# All admin endpoints require authentication.
router = APIRouter(dependencies=[Depends(get_current_user)])


def _maybe_reset_snb_client(provider: str) -> None:
    """Reset SNB client singleton when SNB credentials change."""
    if provider == "snb":
        try:
            from uteki.domains.snb.services.snb_client import reset_snb_client
            reset_snb_client()
        except Exception:
            pass


# Module-level service instances (no longer need session injection)
api_key_svc = get_api_key_service()
user_svc = get_user_service()
config_svc = get_system_config_service()
audit_svc = get_audit_log_service()
llm_svc = get_llm_provider_service()
exchange_svc = get_exchange_config_service()
datasource_svc = get_data_source_config_service()


# ============================================================================
# API Key Routes
# ============================================================================


@router.post(
    "/api-keys",
    response_model=schemas.APIKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建API密钥",
)
async def create_api_key(
    data: schemas.APIKeyCreate,
    user: dict = Depends(get_current_user),
):
    """
    创建新的API密钥配置

    - **provider**: 服务提供商 (okx, binance, fmp, openai, anthropic, dashscope)
    - **api_key**: API密钥（会被加密存储）
    - **api_secret**: API密钥Secret（可选，会被加密存储）
    - **environment**: 环境 (production, sandbox, testnet)
    """
    user_id = user["user_id"]
    api_key = await api_key_svc.create_api_key(data, user_id=user_id)
    _maybe_reset_snb_client(data.provider)

    await audit_svc.log_action(
        action="api_key.create",
        resource_type="api_key",
        resource_id=api_key["id"],
        status="success",
        user_id=user_id,
        details={"provider": data.provider, "environment": data.environment},
    )
    await get_cache_service().delete_pattern(f"uteki:admin:api_keys:{user_id}:")

    return schemas.APIKeyResponse(
        id=api_key["id"],
        provider=api_key["provider"],
        display_name=api_key["display_name"],
        environment=api_key["environment"],
        description=api_key.get("description"),
        is_active=api_key["is_active"],
        has_secret=api_key.get("api_secret") is not None,
        created_at=api_key["created_at"],
        updated_at=api_key["updated_at"],
    )


@router.get(
    "/api-keys", response_model=schemas.PaginatedAPIKeysResponse, summary="列出所有API密钥"
)
async def list_api_keys(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    user: dict = Depends(get_current_user),
):
    """列出当前用户的API密钥配置（不包含敏感信息）"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        items, total = await api_key_svc.list_api_keys(user_id, skip, limit)
        return jsonable_encoder(schemas.PaginatedAPIKeysResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:api_keys:{user_id}:list:{_today()}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


@router.get("/api-keys/{api_key_id}", response_model=schemas.APIKeyResponse, summary="获取API密钥")
async def get_api_key(
    api_key_id: str,
    user: dict = Depends(get_current_user),
):
    """获取指定API密钥（不包含敏感信息）"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        api_key = await api_key_svc.get_api_key(api_key_id, user_id=user_id, decrypt=False)
        if not api_key:
            raise HTTPException(status_code=404, detail="API key not found")
        return jsonable_encoder(schemas.APIKeyResponse(
            id=api_key["id"],
            provider=api_key["provider"],
            display_name=api_key["display_name"],
            environment=api_key["environment"],
            description=api_key.get("description"),
            is_active=api_key["is_active"],
            has_secret=api_key.get("api_secret") is not None,
            created_at=api_key["created_at"],
            updated_at=api_key["updated_at"],
        ))

    return await cache.get_or_set(
        f"uteki:admin:api_keys:{user_id}:get:{_today()}:{api_key_id}", _fetch, ttl=_TTL,
    )


@router.patch("/api-keys/{api_key_id}", response_model=schemas.APIKeyResponse, summary="更新API密钥")
async def update_api_key(
    api_key_id: str,
    data: schemas.APIKeyUpdate,
    user: dict = Depends(get_current_user),
):
    """更新API密钥配置"""
    user_id = user["user_id"]
    api_key = await api_key_svc.update_api_key(api_key_id, user_id=user_id, data=data)
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    _maybe_reset_snb_client(api_key["provider"])

    await audit_svc.log_action(
        action="api_key.update",
        resource_type="api_key",
        resource_id=api_key_id,
        status="success",
        user_id=user_id,
    )
    await get_cache_service().delete_pattern(f"uteki:admin:api_keys:{user_id}:")

    return schemas.APIKeyResponse(
        id=api_key["id"],
        provider=api_key["provider"],
        display_name=api_key["display_name"],
        environment=api_key["environment"],
        description=api_key.get("description"),
        is_active=api_key["is_active"],
        has_secret=api_key.get("api_secret") is not None,
        created_at=api_key["created_at"],
        updated_at=api_key["updated_at"],
    )


@router.delete("/api-keys/{api_key_id}", response_model=schemas.MessageResponse, summary="删除API密钥")
async def delete_api_key(
    api_key_id: str,
    user: dict = Depends(get_current_user),
):
    """删除API密钥"""
    user_id = user["user_id"]
    # Get provider before deletion so we can reset relevant singletons
    existing = await api_key_svc.get_api_key(api_key_id, user_id=user_id, decrypt=False)
    success = await api_key_svc.delete_api_key(api_key_id, user_id=user_id)
    if not success:
        raise HTTPException(status_code=404, detail="API key not found")
    if existing:
        _maybe_reset_snb_client(existing["provider"])

    await audit_svc.log_action(
        action="api_key.delete",
        resource_type="api_key",
        resource_id=api_key_id,
        status="success",
        user_id=user_id,
    )
    await get_cache_service().delete_pattern(f"uteki:admin:api_keys:{user_id}:")

    return schemas.MessageResponse(message="API key deleted successfully")


# ============================================================================
# User Routes
# ============================================================================


@router.post("/users", response_model=schemas.UserResponse, status_code=status.HTTP_201_CREATED, summary="创建用户")
async def create_user(data: schemas.UserCreate):
    """创建新用户"""
    existing = await user_svc.get_user_by_email(data.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = await user_svc.create_user(data)
    await get_cache_service().delete_pattern("uteki:admin:users:")
    return user


@router.get("/users", response_model=schemas.PaginatedUsersResponse, summary="列出所有用户")
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """列出所有用户"""
    cache = get_cache_service()

    async def _fetch():
        items, total = await user_svc.list_users(skip, limit)
        return jsonable_encoder(schemas.PaginatedUsersResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:users:list:{_today()}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


@router.get("/users/{user_id}", response_model=schemas.UserResponse, summary="获取用户")
async def get_user(user_id: str):
    """获取指定用户"""
    cache = get_cache_service()

    async def _fetch():
        user = await user_svc.get_user(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return jsonable_encoder(user)

    return await cache.get_or_set(
        f"uteki:admin:users:get:{_today()}:{user_id}", _fetch, ttl=_TTL,
    )


@router.patch("/users/{user_id}", response_model=schemas.UserResponse, summary="更新用户")
async def update_user(user_id: str, data: schemas.UserUpdate):
    """更新用户信息"""
    user = await user_svc.update_user(user_id, data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await get_cache_service().delete_pattern("uteki:admin:users:")
    return user


# ============================================================================
# System Config Routes
# ============================================================================


@router.post("/config", response_model=schemas.SystemConfigResponse, summary="设置系统配置")
async def set_config(data: schemas.SystemConfigCreate):
    """设置系统配置（创建或更新）"""
    config = await config_svc.set_config(data)
    await get_cache_service().delete_pattern("uteki:admin:configs:")
    return config


@router.get("/config", response_model=List[schemas.SystemConfigResponse], summary="列出所有配置")
async def list_configs():
    """列出所有系统配置"""
    cache = get_cache_service()

    async def _fetch():
        configs = await config_svc.list_all_configs()
        return jsonable_encoder(configs)

    return await cache.get_or_set(f"uteki:admin:configs:list:{_today()}", _fetch, ttl=_TTL)


@router.get("/config/{config_key}", response_model=schemas.SystemConfigResponse, summary="获取配置")
async def get_config(config_key: str):
    """获取指定配置"""
    cache = get_cache_service()

    async def _fetch():
        config = await config_svc.get_config(config_key)
        if not config:
            raise HTTPException(status_code=404, detail="Config not found")
        return jsonable_encoder(config)

    return await cache.get_or_set(
        f"uteki:admin:configs:get:{_today()}:{config_key}", _fetch, ttl=_TTL,
    )


@router.delete("/config/{config_key}", response_model=schemas.MessageResponse, summary="删除配置")
async def delete_config(config_key: str):
    """删除配置"""
    success = await config_svc.delete_config(config_key)
    if not success:
        raise HTTPException(status_code=404, detail="Config not found")
    await get_cache_service().delete_pattern("uteki:admin:configs:")
    return schemas.MessageResponse(message="Config deleted successfully")


# ============================================================================
# Audit Log Routes
# ============================================================================


@router.get("/audit-logs", response_model=schemas.PaginatedAuditLogsResponse, summary="列出审计日志")
async def list_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """列出所有审计日志"""
    cache = get_cache_service()

    async def _fetch():
        items, total = await audit_svc.list_all_logs(skip, limit)
        return jsonable_encoder(schemas.PaginatedAuditLogsResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:audit_logs:list:{_today()}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


@router.get("/audit-logs/user/{user_id}", response_model=schemas.PaginatedAuditLogsResponse, summary="列出用户审计日志")
async def list_user_audit_logs(
    user_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """列出指定用户的审计日志"""
    cache = get_cache_service()

    async def _fetch():
        items, total = await audit_svc.list_user_logs(user_id, skip, limit)
        return jsonable_encoder(schemas.PaginatedAuditLogsResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:audit_logs:user:{_today()}:{user_id}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


# ============================================================================
# LLM Provider Routes
# ============================================================================


@router.post(
    "/llm-providers",
    response_model=schemas.LLMProviderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建LLM提供商配置",
)
async def create_llm_provider(
    data: schemas.LLMProviderCreate,
    user: dict = Depends(get_current_user),
):
    """
    创建LLM提供商配置

    - **provider**: 提供商 (openai, anthropic, dashscope, deepseek)
    - **model**: 模型名称 (gpt-4, claude-3-5-sonnet-20241022, qwen-max)
    - **api_key_id**: 关联的API密钥ID
    """
    user_id = user["user_id"]
    provider = await llm_svc.create_provider(data, user_id=user_id)

    await audit_svc.log_action(
        action="llm_provider.create",
        resource_type="llm_provider",
        resource_id=provider["id"],
        status="success",
        user_id=user_id,
        details={"provider": data.provider, "model": data.model},
    )
    await get_cache_service().delete_pattern(f"uteki:admin:llm_providers:{user_id}:")

    return provider


@router.get(
    "/llm-providers",
    response_model=schemas.PaginatedLLMProvidersResponse,
    summary="列出所有LLM提供商",
)
async def list_llm_providers(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    user: dict = Depends(get_current_user),
):
    """列出当前用户的LLM提供商配置"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        items, total = await llm_svc.list_providers(user_id, skip, limit)
        return jsonable_encoder(schemas.PaginatedLLMProvidersResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:llm_providers:{user_id}:list:{_today()}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


@router.get(
    "/llm-providers/active",
    response_model=List[schemas.LLMProviderResponse],
    summary="列出激活的LLM提供商",
)
async def list_active_llm_providers(user: dict = Depends(get_current_user)):
    """列出当前用户激活的LLM提供商（按优先级排序）"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        providers = await llm_svc.list_active_providers(user_id)
        return jsonable_encoder(providers)

    return await cache.get_or_set(
        f"uteki:admin:llm_providers:{user_id}:active:{_today()}", _fetch, ttl=_TTL,
    )


@router.get(
    "/llm-providers/default",
    response_model=schemas.LLMProviderResponse,
    summary="获取默认LLM提供商",
)
async def get_default_llm_provider(user: dict = Depends(get_current_user)):
    """获取当前用户的默认LLM提供商"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        provider = await llm_svc.get_default_provider(user_id)
        if not provider:
            raise HTTPException(status_code=404, detail="No default LLM provider configured")
        return jsonable_encoder(provider)

    return await cache.get_or_set(
        f"uteki:admin:llm_providers:{user_id}:default:{_today()}", _fetch, ttl=_TTL,
    )


@router.post(
    "/llm-providers/create-with-key",
    response_model=schemas.LLMProviderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建LLM提供商（自动管理API Key）",
)
async def create_llm_provider_with_key(
    data: schemas.LLMProviderCreateWithKey,
    user: dict = Depends(get_current_user),
):
    """
    两步创建：自动查找或新建 API Key，然后创建 LLM Provider。
    前端使用此端点简化配置流程。
    """
    user_id = user["user_id"]
    enc = get_encryption_service()
    config = {}
    if data.base_url:
        config["base_url"] = data.base_url
    if data.temperature is not None:
        config["temperature"] = data.temperature
    if data.max_tokens is not None:
        config["max_tokens"] = data.max_tokens

    provider = await llm_svc.create_provider_with_key(
        provider=data.provider,
        model=data.model,
        api_key=data.api_key,
        display_name=data.display_name,
        user_id=user_id,
        config=config,
        is_default=data.is_default,
        is_active=data.is_active,
        priority=data.priority,
        encryption_service=enc,
    )

    await audit_svc.log_action(
        action="llm_provider.create_with_key",
        resource_type="llm_provider",
        resource_id=provider["id"],
        status="success",
        user_id=user_id,
        details={"provider": data.provider, "model": data.model},
    )
    await get_cache_service().delete_pattern(f"uteki:admin:llm_providers:{user_id}:")
    await get_cache_service().delete_pattern(f"uteki:admin:api_keys:{user_id}:")

    return provider


@router.get(
    "/llm-providers/runtime",
    summary="获取运行时模型列表（内部使用）",
)
async def get_runtime_models(user: dict = Depends(get_current_user)):
    """返回当前用户 active 的 LLM Provider + 解密的 API Key，供 Arena/Agent 运行时使用"""
    enc = get_encryption_service()
    models = await llm_svc.get_active_models_for_runtime(
        user_id=user["user_id"], encryption_service=enc,
    )
    return {"models": models, "count": len(models)}


@router.get(
    "/llm-providers/{provider_id}",
    response_model=schemas.LLMProviderResponse,
    summary="获取LLM提供商",
)
async def get_llm_provider(
    provider_id: str,
    user: dict = Depends(get_current_user),
):
    """获取指定LLM提供商"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        provider = await llm_svc.get_provider(provider_id, user_id=user_id)
        if not provider:
            raise HTTPException(status_code=404, detail="LLM provider not found")
        return jsonable_encoder(provider)

    return await cache.get_or_set(
        f"uteki:admin:llm_providers:{user_id}:get:{_today()}:{provider_id}", _fetch, ttl=_TTL,
    )


@router.patch(
    "/llm-providers/{provider_id}",
    response_model=schemas.LLMProviderResponse,
    summary="更新LLM提供商",
)
async def update_llm_provider(
    provider_id: str,
    data: schemas.LLMProviderUpdate,
    user: dict = Depends(get_current_user),
):
    """更新LLM提供商配置。如果提供了 api_key，会更新关联的 API Key 记录。"""
    user_id = user["user_id"]
    # If api_key is provided, update the associated API key record
    if data.api_key:
        existing = await llm_svc.get_provider(provider_id, user_id=user_id)
        if existing and existing.get("api_key_id"):
            enc = get_encryption_service()
            encrypted = enc.encrypt(data.api_key)
            from uteki.domains.admin.repository import APIKeyRepository
            await APIKeyRepository.update(existing["api_key_id"], user_id, api_key=encrypted)

    # Remove api_key from the update data (it's not a field on llm_providers table)
    update_dict = data.dict(exclude_unset=True)
    update_dict.pop("api_key", None)

    if update_dict:
        from uteki.domains.admin import schemas as s
        provider = await llm_svc.update_provider(
            provider_id, user_id=user_id, data=s.LLMProviderUpdate(**update_dict),
        )
    else:
        provider = await llm_svc.get_provider(provider_id, user_id=user_id)

    if not provider:
        raise HTTPException(status_code=404, detail="LLM provider not found")

    await audit_svc.log_action(
        action="llm_provider.update",
        resource_type="llm_provider",
        resource_id=provider_id,
        status="success",
        user_id=user_id,
    )
    await get_cache_service().delete_pattern(f"uteki:admin:llm_providers:{user_id}:")

    return provider


@router.delete(
    "/llm-providers/{provider_id}",
    response_model=schemas.MessageResponse,
    summary="删除LLM提供商",
)
async def delete_llm_provider(
    provider_id: str,
    user: dict = Depends(get_current_user),
):
    """删除LLM提供商"""
    user_id = user["user_id"]
    success = await llm_svc.delete_provider(provider_id, user_id=user_id)
    if not success:
        raise HTTPException(status_code=404, detail="LLM provider not found")

    await audit_svc.log_action(
        action="llm_provider.delete",
        resource_type="llm_provider",
        resource_id=provider_id,
        status="success",
        user_id=user_id,
    )
    await get_cache_service().delete_pattern(f"uteki:admin:llm_providers:{user_id}:")

    return schemas.MessageResponse(message="LLM provider deleted successfully")


# ============================================================================
# Exchange Config Routes
# ============================================================================


@router.post(
    "/exchanges",
    response_model=schemas.ExchangeConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建交易所配置",
)
async def create_exchange_config(
    data: schemas.ExchangeConfigCreate,
    user: dict = Depends(get_current_user),
):
    """
    创建交易所配置

    - **exchange**: 交易所名称 (okx, binance, xueying)
    - **api_key_id**: 关联的API密钥ID
    - **trading_enabled**: 是否启用交易
    """
    user_id = user["user_id"]
    exchange = await exchange_svc.create_exchange(data, user_id=user_id)

    await audit_svc.log_action(
        action="exchange_config.create",
        resource_type="exchange_config",
        resource_id=exchange["id"],
        status="success",
        user_id=user_id,
        details={"exchange": data.exchange},
    )
    await get_cache_service().delete_pattern(f"uteki:admin:exchanges:{user_id}:")

    return exchange


@router.get(
    "/exchanges",
    response_model=schemas.PaginatedExchangeConfigsResponse,
    summary="列出所有交易所配置",
)
async def list_exchange_configs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    user: dict = Depends(get_current_user),
):
    """列出当前用户的交易所配置"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        items, total = await exchange_svc.list_exchanges(user_id, skip, limit)
        return jsonable_encoder(schemas.PaginatedExchangeConfigsResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:exchanges:{user_id}:list:{_today()}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


@router.get(
    "/exchanges/active",
    response_model=List[schemas.ExchangeConfigResponse],
    summary="列出激活的交易所",
)
async def list_active_exchanges(user: dict = Depends(get_current_user)):
    """列出当前用户激活的交易所配置"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        exchanges = await exchange_svc.list_active_exchanges(user_id)
        return jsonable_encoder(exchanges)

    return await cache.get_or_set(
        f"uteki:admin:exchanges:{user_id}:active:{_today()}", _fetch, ttl=_TTL,
    )


@router.get(
    "/exchanges/{config_id}",
    response_model=schemas.ExchangeConfigResponse,
    summary="获取交易所配置",
)
async def get_exchange_config(
    config_id: str,
    user: dict = Depends(get_current_user),
):
    """获取指定交易所配置"""
    user_id = user["user_id"]
    cache = get_cache_service()

    async def _fetch():
        exchange = await exchange_svc.get_exchange(config_id, user_id=user_id)
        if not exchange:
            raise HTTPException(status_code=404, detail="Exchange config not found")
        return jsonable_encoder(exchange)

    return await cache.get_or_set(
        f"uteki:admin:exchanges:{user_id}:get:{_today()}:{config_id}", _fetch, ttl=_TTL,
    )


@router.patch(
    "/exchanges/{config_id}",
    response_model=schemas.ExchangeConfigResponse,
    summary="更新交易所配置",
)
async def update_exchange_config(
    config_id: str,
    data: schemas.ExchangeConfigUpdate,
    user: dict = Depends(get_current_user),
):
    """更新交易所配置"""
    user_id = user["user_id"]
    exchange = await exchange_svc.update_exchange(config_id, user_id=user_id, data=data)
    if not exchange:
        raise HTTPException(status_code=404, detail="Exchange config not found")

    await audit_svc.log_action(
        action="exchange_config.update",
        resource_type="exchange_config",
        resource_id=config_id,
        status="success",
        user_id=user_id,
    )
    await get_cache_service().delete_pattern(f"uteki:admin:exchanges:{user_id}:")

    return exchange


@router.delete(
    "/exchanges/{config_id}",
    response_model=schemas.MessageResponse,
    summary="删除交易所配置",
)
async def delete_exchange_config(
    config_id: str,
    user: dict = Depends(get_current_user),
):
    """删除交易所配置"""
    user_id = user["user_id"]
    success = await exchange_svc.delete_exchange(config_id, user_id=user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Exchange config not found")

    await audit_svc.log_action(
        action="exchange_config.delete",
        resource_type="exchange_config",
        resource_id=config_id,
        status="success",
        user_id=user_id,
    )
    await get_cache_service().delete_pattern(f"uteki:admin:exchanges:{user_id}:")

    return schemas.MessageResponse(message="Exchange config deleted successfully")


# ============================================================================
# Aggregator Routes — AIHubMix / OpenRouter unified keys
# ============================================================================

from uteki.domains.admin.aggregator_service import (
    SUPPORTED_AGGREGATORS,
    delete_aggregator_key,
    list_aggregators,
    save_aggregator_key,
    verify_and_balance,
)


def _validate_aggregator(provider: str) -> None:
    if provider not in SUPPORTED_AGGREGATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported aggregator: {provider}. Supported: {list(SUPPORTED_AGGREGATORS)}",
        )


@router.post(
    "/aggregators/verify",
    response_model=schemas.AggregatorVerifyResponse,
    summary="验证聚合 Provider 的 API Key（不保存）",
)
async def verify_aggregator(
    data: schemas.AggregatorVerifyRequest,
    user: dict = Depends(get_current_user),
):
    """Validate an aggregator key without persisting it.

    Used before the user clicks 'save' so they get immediate feedback on
    whether the key they typed is valid (and, when supported, their balance).
    """
    _validate_aggregator(data.provider)
    result = await verify_and_balance(data.provider, data.api_key)
    balance = None
    if result.balance:
        balance = schemas.AggregatorBalanceInfo(
            credits=result.balance.credits,
            limit=result.balance.limit,
            usage=result.balance.usage,
            currency=result.balance.currency,
            label=result.balance.label,
        )
    return schemas.AggregatorVerifyResponse(
        valid=result.valid, balance=balance, error=result.error,
    )


@router.get(
    "/aggregators",
    response_model=List[schemas.AggregatorConfigResponse],
    summary="列出当前用户的聚合 Provider 配置",
)
async def list_aggregator_configs(user: dict = Depends(get_current_user)):
    """Return the configured state of each supported aggregator for this user.

    Unconfigured aggregators are included with `configured=false` so the UI
    can render them as empty cards inviting the user to add a key.
    """
    enc = get_encryption_service()
    items = await list_aggregators(user_id=user["user_id"], encryption=enc)
    return items


@router.post(
    "/aggregators",
    response_model=schemas.AggregatorConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="保存聚合 Provider 的 API Key（自动验证后落库）",
)
async def save_aggregator(
    data: schemas.AggregatorSaveRequest,
    user: dict = Depends(get_current_user),
):
    """Verify the key first; on success, encrypt and upsert for this user."""
    _validate_aggregator(data.provider)
    user_id = user["user_id"]

    verify = await verify_and_balance(data.provider, data.api_key)
    if not verify.valid:
        raise HTTPException(
            status_code=400,
            detail=verify.error or "Aggregator rejected the API key",
        )

    enc = get_encryption_service()
    await save_aggregator_key(
        provider=data.provider, api_key=data.api_key, user_id=user_id, encryption=enc,
    )

    await audit_svc.log_action(
        action="aggregator.save",
        resource_type="aggregator",
        resource_id=data.provider,
        status="success",
        user_id=user_id,
        details={"provider": data.provider, "has_balance": verify.balance is not None},
    )
    await get_cache_service().delete_pattern(f"uteki:admin:api_keys:{user_id}:")

    items = await list_aggregators(user_id=user_id, encryption=enc)
    for item in items:
        if item["provider"] == data.provider:
            return item
    raise HTTPException(status_code=500, detail="Aggregator saved but not retrievable")


@router.get(
    "/aggregators/{provider}/balance",
    response_model=schemas.AggregatorVerifyResponse,
    summary="获取已保存聚合 Provider 的余额",
)
async def get_aggregator_balance(
    provider: str,
    user: dict = Depends(get_current_user),
):
    """Fetch balance for the user's stored key (decrypts → calls aggregator)."""
    _validate_aggregator(provider)
    enc = get_encryption_service()
    from uteki.domains.admin.aggregator_service import get_aggregator_key
    api_key = await get_aggregator_key(provider, user_id=user["user_id"], encryption=enc)
    if not api_key:
        raise HTTPException(status_code=404, detail=f"No {provider} key configured")

    result = await verify_and_balance(provider, api_key)
    balance = None
    if result.balance:
        balance = schemas.AggregatorBalanceInfo(
            credits=result.balance.credits,
            limit=result.balance.limit,
            usage=result.balance.usage,
            currency=result.balance.currency,
            label=result.balance.label,
        )
    return schemas.AggregatorVerifyResponse(
        valid=result.valid, balance=balance, error=result.error,
    )


@router.delete(
    "/aggregators/{provider}",
    response_model=schemas.MessageResponse,
    summary="删除聚合 Provider 配置",
)
async def delete_aggregator(
    provider: str,
    user: dict = Depends(get_current_user),
):
    _validate_aggregator(provider)
    user_id = user["user_id"]
    ok = await delete_aggregator_key(provider, user_id=user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No {provider} key configured")

    await audit_svc.log_action(
        action="aggregator.delete",
        resource_type="aggregator",
        resource_id=provider,
        status="success",
        user_id=user_id,
        details={"provider": provider},
    )
    await get_cache_service().delete_pattern(f"uteki:admin:api_keys:{user_id}:")
    return schemas.MessageResponse(message=f"{provider} key removed")


# ============================================================================
# Data Source Config Routes
# ============================================================================


@router.post(
    "/data-sources",
    response_model=schemas.DataSourceConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建数据源配置",
)
async def create_data_source_config(data: schemas.DataSourceConfigCreate):
    """
    创建数据源配置

    - **source_type**: 数据源类型 (fmp, yahoo, coingecko)
    - **data_types**: 支持的数据类型 (["stock", "crypto", "forex"])
    - **api_key_id**: 关联的API密钥ID（可选）
    """
    data_source = await datasource_svc.create_data_source(data)

    await audit_svc.log_action(
        action="data_source_config.create",
        resource_type="data_source_config",
        resource_id=data_source["id"],
        status="success",
        details={"source_type": data.source_type},
    )
    await get_cache_service().delete_pattern("uteki:admin:data_sources:")

    return data_source


@router.get(
    "/data-sources",
    response_model=schemas.PaginatedDataSourceConfigsResponse,
    summary="列出所有数据源配置",
)
async def list_data_source_configs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """列出所有数据源配置"""
    cache = get_cache_service()

    async def _fetch():
        items, total = await datasource_svc.list_data_sources(skip, limit)
        return jsonable_encoder(schemas.PaginatedDataSourceConfigsResponse(
            items=items,
            total=total,
            page=skip // limit + 1,
            page_size=limit,
            total_pages=(total + limit - 1) // limit,
        ))

    return await cache.get_or_set(
        f"uteki:admin:data_sources:list:{_today()}:{skip}:{limit}", _fetch, ttl=_TTL,
    )


@router.get(
    "/data-sources/active",
    response_model=List[schemas.DataSourceConfigResponse],
    summary="列出激活的数据源",
)
async def list_active_data_sources():
    """列出所有激活的数据源配置（按优先级排序）"""
    cache = get_cache_service()

    async def _fetch():
        data_sources = await datasource_svc.list_active_data_sources()
        return jsonable_encoder(data_sources)

    return await cache.get_or_set(
        f"uteki:admin:data_sources:active:{_today()}", _fetch, ttl=_TTL,
    )


@router.get(
    "/data-sources/by-type/{data_type}",
    response_model=List[schemas.DataSourceConfigResponse],
    summary="根据数据类型列出数据源",
)
async def list_data_sources_by_type(data_type: str):
    """根据数据类型列出数据源（如"stock", "crypto"）"""
    cache = get_cache_service()

    async def _fetch():
        data_sources = await datasource_svc.list_by_data_type(data_type)
        return jsonable_encoder(data_sources)

    return await cache.get_or_set(
        f"uteki:admin:data_sources:by_type:{_today()}:{data_type}", _fetch, ttl=_TTL,
    )


@router.get(
    "/data-sources/{config_id}",
    response_model=schemas.DataSourceConfigResponse,
    summary="获取数据源配置",
)
async def get_data_source_config(config_id: str):
    """获取指定数据源配置"""
    cache = get_cache_service()

    async def _fetch():
        data_source = await datasource_svc.get_data_source(config_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source config not found")
        return jsonable_encoder(data_source)

    return await cache.get_or_set(
        f"uteki:admin:data_sources:get:{_today()}:{config_id}", _fetch, ttl=_TTL,
    )


@router.patch(
    "/data-sources/{config_id}",
    response_model=schemas.DataSourceConfigResponse,
    summary="更新数据源配置",
)
async def update_data_source_config(config_id: str, data: schemas.DataSourceConfigUpdate):
    """更新数据源配置"""
    data_source = await datasource_svc.update_data_source(config_id, data)
    if not data_source:
        raise HTTPException(status_code=404, detail="Data source config not found")

    await audit_svc.log_action(
        action="data_source_config.update",
        resource_type="data_source_config",
        resource_id=config_id,
        status="success",
    )
    await get_cache_service().delete_pattern("uteki:admin:data_sources:")

    return data_source


@router.delete(
    "/data-sources/{config_id}",
    response_model=schemas.MessageResponse,
    summary="删除数据源配置",
)
async def delete_data_source_config(config_id: str):
    """删除数据源配置"""
    success = await datasource_svc.delete_data_source(config_id)
    if not success:
        raise HTTPException(status_code=404, detail="Data source config not found")

    await audit_svc.log_action(
        action="data_source_config.delete",
        resource_type="data_source_config",
        resource_id=config_id,
        status="success",
    )
    await get_cache_service().delete_pattern("uteki:admin:data_sources:")

    return schemas.MessageResponse(message="Data source config deleted successfully")


# ============================================================================
# System Health Check Routes
# ============================================================================


@router.get("/system/server-ip", summary="获取服务器公网IP")
async def get_server_ip():
    """获取服务器的公网IP地址"""
    cache = get_cache_service()

    async def _fetch():
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get("https://api.ipify.org?format=json")
                data = response.json()
                return {"ip": data["ip"]}
        except Exception as e:
            return {"ip": None, "error": str(e)}

    return await cache.get_or_set(
        f"uteki:admin:server_ip:{_today()}", _fetch, ttl=_TTL,
    )


@router.get("/system/health", summary="系统健康检查")
async def system_health_check(user: dict = Depends(get_current_user)):
    """
    详细的系统健康检查（对当前用户作用域内的配置进行检查）

    检查项：
    - 数据库连接状态
    - 配置完整性（当前用户的 API密钥、LLM提供商、交易所配置等）
    - 审计日志功能
    """
    user_id = user["user_id"]
    health_info = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "components": {},
        "configurations": {},
        "warnings": []
    }

    # 检查API密钥配置
    try:
        api_keys, total = await api_key_svc.list_api_keys(user_id, 0, 100)
        active_keys = [k for k in api_keys if k.is_active]
        health_info["configurations"]["api_keys"] = {
            "total": total,
            "active": len(active_keys),
            "status": "ok" if active_keys else "warning"
        }
        if not active_keys:
            health_info["warnings"].append("No active API keys configured")
    except Exception as e:
        health_info["configurations"]["api_keys"] = {"status": "error", "error": str(e)}
        health_info["status"] = "degraded"

    # 检查LLM提供商配置
    try:
        llm_providers = await llm_svc.list_active_providers(user_id)
        default_provider = await llm_svc.get_default_provider(user_id)
        health_info["configurations"]["llm_providers"] = {
            "total_active": len(llm_providers),
            "has_default": default_provider is not None,
            "status": "ok" if default_provider else "warning"
        }
        if not default_provider:
            health_info["warnings"].append("No default LLM provider configured")
    except Exception as e:
        health_info["configurations"]["llm_providers"] = {"status": "error", "error": str(e)}
        health_info["status"] = "degraded"

    # 检查交易所配置
    try:
        exchanges = await exchange_svc.list_active_exchanges(user_id)
        health_info["configurations"]["exchanges"] = {
            "total_active": len(exchanges),
            "trading_enabled": sum(1 for e in exchanges if e.get("trading_enabled")),
            "status": "ok" if exchanges else "info"
        }
        if not exchanges:
            health_info["warnings"].append("No exchange configurations (optional)")
    except Exception as e:
        health_info["configurations"]["exchanges"] = {"status": "error", "error": str(e)}

    # 检查数据源配置
    try:
        data_sources = await datasource_svc.list_active_data_sources()
        health_info["configurations"]["data_sources"] = {
            "total_active": len(data_sources),
            "status": "ok" if data_sources else "info"
        }
        if not data_sources:
            health_info["warnings"].append("No data source configurations (optional)")
    except Exception as e:
        health_info["configurations"]["data_sources"] = {"status": "error", "error": str(e)}

    # 检查审计日志功能
    try:
        logs, total = await audit_svc.list_all_logs(0, 1)
        health_info["components"]["audit_log"] = {
            "total_logs": total,
            "status": "ok"
        }
    except Exception as e:
        health_info["components"]["audit_log"] = {"status": "error", "error": str(e)}
        health_info["status"] = "degraded"

    # 数据库连接状态
    health_info["databases"] = {
        "postgresql": {"status": "connected" if db_manager.postgres_available else "disconnected"},
        "supabase": {"status": "connected" if db_manager.supabase_available else "disconnected"},
        "redis": {"status": "connected" if db_manager.redis_available else "disconnected"},
        "clickhouse": {"status": "connected" if db_manager.clickhouse_available else "disabled"},
        "qdrant": {"status": "connected" if db_manager.qdrant_available else "disabled"},
        "minio": {"status": "connected" if db_manager.minio_available else "disabled"}
    }

    return health_info
