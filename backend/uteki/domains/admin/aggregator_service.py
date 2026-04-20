"""
Aggregator service — verify/balance for unified LLM aggregators (AIHubMix, OpenRouter).

These aggregators expose an OpenAI-compatible API that routes to many providers
with a single API key. This module:

1. Validates an API key by calling the aggregator's auth/models endpoint.
2. Fetches credit balance (if the aggregator supports it).
3. Stores/retrieves the per-user key via the existing APIKeyRepository
   (provider = "aihubmix" | "openrouter").

All storage is user-scoped — `user_id` is required on every operation.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Optional

import httpx

from uteki.domains.admin.repository import APIKeyRepository
from uteki.domains.admin.service import EncryptionService

logger = logging.getLogger(__name__)

AggregatorProvider = Literal["aihubmix", "openrouter"]

SUPPORTED_AGGREGATORS: tuple[AggregatorProvider, ...] = ("aihubmix", "openrouter")


# ─── Aggregator-specific endpoints ──────────────────────────────────────────

_AGGREGATOR_CONFIG: dict[str, dict] = {
    "aihubmix": {
        "base_url": "https://aihubmix.com/v1",
        "display_name": "AIHubMix",
        # AIHubMix uses OpenAI-compatible endpoints. /v1/models 200 → key valid.
        "verify_path": "/models",
        "balance_path": None,  # Public API does not expose balance; must check dashboard.
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "display_name": "OpenRouter",
        # Single endpoint returns both validity and credits.
        "verify_path": "/auth/key",
        "balance_path": "/auth/key",
    },
}


@dataclass
class Balance:
    credits: Optional[float]  # remaining credits; None if unknown
    limit: Optional[float]    # total credit limit
    usage: Optional[float]    # credits used
    currency: str = "USD"
    label: Optional[str] = None


@dataclass
class VerifyResult:
    valid: bool
    balance: Optional[Balance] = None
    error: Optional[str] = None


def get_aggregator_meta(provider: AggregatorProvider) -> dict:
    if provider not in _AGGREGATOR_CONFIG:
        raise ValueError(f"Unsupported aggregator: {provider}")
    return _AGGREGATOR_CONFIG[provider]


async def verify_and_balance(
    provider: AggregatorProvider, api_key: str, timeout_s: float = 8.0,
) -> VerifyResult:
    """Validate the key and, if supported, return remaining balance.

    Never raises — always returns a VerifyResult with {valid, balance?, error?}.
    """
    if not api_key or not api_key.strip():
        return VerifyResult(valid=False, error="API key is empty")

    meta = get_aggregator_meta(provider)
    url = meta["base_url"] + meta["verify_path"]
    headers = {"Authorization": f"Bearer {api_key.strip()}"}

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return VerifyResult(valid=False, error="Request timed out")
    except httpx.HTTPError as e:
        return VerifyResult(valid=False, error=f"Network error: {e}")

    if resp.status_code == 401 or resp.status_code == 403:
        return VerifyResult(valid=False, error="Invalid or unauthorized API key")
    if resp.status_code >= 400:
        return VerifyResult(
            valid=False,
            error=f"Aggregator returned HTTP {resp.status_code}: {resp.text[:200]}",
        )

    balance: Optional[Balance] = None

    # OpenRouter: extract balance from /auth/key response.
    if provider == "openrouter":
        try:
            data = resp.json().get("data", {})
            limit = data.get("limit")
            usage = data.get("usage")
            credits = None
            if isinstance(limit, (int, float)) and isinstance(usage, (int, float)):
                credits = max(0.0, float(limit) - float(usage))
            balance = Balance(
                credits=credits,
                limit=float(limit) if isinstance(limit, (int, float)) else None,
                usage=float(usage) if isinstance(usage, (int, float)) else None,
                label=data.get("label"),
            )
        except Exception as e:
            logger.warning(f"OpenRouter balance parse failed: {e}")

    # AIHubMix: no public balance endpoint — valid key, balance unknown.
    # (Contributors: check with AIHubMix if/when they expose a balance API.)

    return VerifyResult(valid=True, balance=balance)


# ─── Stored-key helpers (user-scoped via APIKeyRepository) ──────────────────


async def save_aggregator_key(
    provider: AggregatorProvider,
    api_key: str,
    user_id: str,
    encryption: EncryptionService,
) -> dict:
    """Upsert the user's aggregator key. Returns the stored row (masked)."""
    meta = get_aggregator_meta(provider)
    encrypted = encryption.encrypt(api_key.strip())

    existing = await APIKeyRepository.get_by_provider(
        provider, user_id=user_id, environment="production",
    )
    if existing:
        updated = await APIKeyRepository.update(
            existing["id"], user_id=user_id, api_key=encrypted, is_active=True,
        )
        return updated or existing

    data = {
        "user_id": user_id,
        "provider": provider,
        "display_name": meta["display_name"],
        "api_key": encrypted,
        "environment": "production",
        "is_active": True,
        "extra_config": {"base_url": meta["base_url"]},
    }
    return await APIKeyRepository.create(data)


async def get_aggregator_key(
    provider: AggregatorProvider,
    user_id: str,
    encryption: EncryptionService,
) -> Optional[str]:
    """Return the decrypted API key for the user, or None if not configured."""
    row = await APIKeyRepository.get_by_provider(
        provider, user_id=user_id, environment="production",
    )
    if not row or not row.get("is_active", True):
        return None
    try:
        return encryption.decrypt(row["api_key"])
    except Exception as e:
        logger.warning(f"decrypt {provider} key for user={user_id} failed: {e}")
        return None


async def list_aggregators(
    user_id: str, encryption: EncryptionService,
) -> list[dict]:
    """List this user's configured aggregators (masked, no balance fetch)."""
    results = []
    for provider in SUPPORTED_AGGREGATORS:
        row = await APIKeyRepository.get_by_provider(
            provider, user_id=user_id, environment="production",
        )
        meta = get_aggregator_meta(provider)
        if row:
            try:
                decrypted = encryption.decrypt(row["api_key"])
                masked = encryption.mask_api_key(decrypted)
            except Exception:
                masked = "****"
            results.append({
                "provider": provider,
                "display_name": meta["display_name"],
                "configured": True,
                "api_key_masked": masked,
                "is_active": row.get("is_active", True),
                "base_url": meta["base_url"],
                "supports_balance": meta["balance_path"] is not None,
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
            })
        else:
            results.append({
                "provider": provider,
                "display_name": meta["display_name"],
                "configured": False,
                "api_key_masked": None,
                "is_active": False,
                "base_url": meta["base_url"],
                "supports_balance": meta["balance_path"] is not None,
                "created_at": None,
                "updated_at": None,
            })
    return results


async def delete_aggregator_key(provider: AggregatorProvider, user_id: str) -> bool:
    row = await APIKeyRepository.get_by_provider(
        provider, user_id=user_id, environment="production",
    )
    if not row:
        return False
    return await APIKeyRepository.delete(row["id"], user_id=user_id)


# ─── Runtime resolution (used by llm_adapter and domain entry points) ──────


async def resolve_unified_provider(
    user_id: Optional[str],
    preferred: Optional[AggregatorProvider] = None,
) -> Optional[tuple[AggregatorProvider, str, str]]:
    """Resolve which aggregator key the caller should use at runtime.

    Priority:
      1. The passed user's stored aggregator key (preferred one first, then any).
      2. Any active aggregator key in DB (dev/single-tenant scheduler fallback —
         env keys go stale, whereas DB is whatever the user last saved via UI).
      3. settings.aihubmix_api_key from env (legacy fallback).

    Returns (provider, api_key, base_url) or None if nothing configured.
    """
    from uteki.common.config import settings

    enc = EncryptionService()
    order = ([preferred] if preferred else []) + [
        p for p in SUPPORTED_AGGREGATORS if p != preferred
    ]

    if user_id:
        for provider in order:
            if provider is None:
                continue
            api_key = await get_aggregator_key(provider, user_id=user_id, encryption=enc)
            if api_key:
                meta = get_aggregator_meta(provider)
                return provider, api_key, meta["base_url"]

    # Dev/scheduler fallback: scan DB for any active aggregator key.
    # Used by background jobs (news translation, analysis) that lack a request-
    # scoped user context. In a multi-tenant deployment, callers should always
    # pass an explicit user_id; this step just keeps single-user setups working.
    try:
        from uteki.common.database import SupabaseRepository
        for provider in order:
            if provider is None:
                continue
            row = SupabaseRepository("api_keys").select_one(
                eq={"provider": provider, "is_active": True, "environment": "production"},
            )
            if not row:
                continue
            try:
                api_key = enc.decrypt(row["api_key"])
            except Exception:
                continue
            meta = get_aggregator_meta(provider)
            return provider, api_key, meta["base_url"]
    except Exception as e:
        logger.warning(f"DB aggregator key fallback failed: {e}")

    # Final env fallback — useful before any user has saved a key.
    env_key = getattr(settings, "aihubmix_api_key", None)
    if env_key:
        env_url = (
            getattr(settings, "aihubmix_base_url", None) or "https://aihubmix.com/v1"
        )
        return "aihubmix", env_key, env_url

    return None
