"""
Company Agent API — analyze any public company with the 5-skill pipeline.

POST /api/company/analyze
"""
from __future__ import annotations
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from uteki.domains.auth.deps import get_current_user
from uteki.common.config import settings
from .schemas import CompanyAnalyzeRequest, VerdictOutput
from .financials import fetch_company_data, invalidate_company_cache
from .skill_runner import CompanySkillRunner

logger = logging.getLogger(__name__)
router = APIRouter()

_DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-4-20250514",
    "openai":    "gpt-4o",
    "deepseek":  "deepseek-chat",
    "google":    "gemini-2.5-pro-thinking",
    "qwen":      "qwen-plus",
    "minimax":   "MiniMax-Text-01",
    "doubao":    "doubao-seed-2-0-pro-260215",
}

# Hardcoded fallback order (mirrors arena_service.ARENA_MODELS)
_FALLBACK_MODELS = [
    {"provider": "anthropic", "model": "claude-sonnet-4-20250514", "api_key_attr": "anthropic_api_key"},
    {"provider": "openai",    "model": "gpt-4o",                   "api_key_attr": "openai_api_key"},
    {"provider": "deepseek",  "model": "deepseek-chat",            "api_key_attr": "deepseek_api_key"},
    {"provider": "google",    "model": "gemini-2.5-pro-thinking",  "api_key_attr": "google_api_key", "base_url_attr": "google_api_base_url"},
    {"provider": "qwen",      "model": "qwen-plus",                "api_key_attr": "dashscope_api_key"},
]


async def _resolve_model(provider_override: Optional[str], model_override: Optional[str]) -> Optional[dict]:
    """
    Load model config:
    1. Admin LLM providers (Supabase — respects is_active toggle)
    2. Fallback to env settings (filtered by admin is_active)
    """
    # Priority 1: Admin active LLM providers (Supabase, decrypted keys)
    disabled_providers: set[str] = set()
    try:
        from uteki.domains.admin.service import LLMProviderService
        svc = LLMProviderService()
        models = await svc.get_active_models_for_runtime()
        for m in models:
            if provider_override and m["provider"] != provider_override:
                continue
            config = {
                "provider": m["provider"],
                "model": model_override or m["model"],
                "api_key": m["api_key"],
                "base_url": m.get("base_url") or None,
            }
            logger.info(f"[company] using admin model: {config['provider']}/{config['model']}")
            return config

        # Collect disabled providers (all providers minus active ones)
        from uteki.domains.admin.repository import LLMProviderRepository
        all_providers, _ = await LLMProviderRepository.list_all()
        active_names = {m["provider"] for m in models}
        disabled_providers = {p["provider"] for p in all_providers} - active_names
    except Exception as e:
        logger.warning(f"[company] admin model load failed: {e}")

    # Priority 2: env settings fallback (skip providers disabled in admin)
    for m in _FALLBACK_MODELS:
        if m["provider"] in disabled_providers:
            continue
        if provider_override and m["provider"] != provider_override:
            continue
        api_key = getattr(settings, m["api_key_attr"], None)
        if api_key:
            base_url = getattr(settings, m.get("base_url_attr", ""), None) if m.get("base_url_attr") else None
            config = {
                "provider": m["provider"],
                "model": model_override or m["model"],
                "api_key": api_key,
                "base_url": base_url,
            }
            logger.info(f"[company] using env model: {config['provider']}/{config['model']}")
            return config

    return None


@router.post("/analyze")
async def analyze_company(
    req: CompanyAnalyzeRequest,
    user: dict = Depends(get_current_user),
):
    """
    Run 5-skill company analysis pipeline.
    Skills: Graham (Quant) → Buffett (Moat) → Fisher (Growth) → Munger (Risk) → Synthesis
    """
    t0 = time.time()

    # 1. Resolve model
    model_config = await _resolve_model(req.provider, req.model)
    if not model_config:
        raise HTTPException(
            status_code=503,
            detail="未找到可用的 LLM 配置。请在 Admin > Models 中添加 API Key。",
        )

    # 2. Fetch financial data
    logger.info(f"[company] fetching data: symbol={req.symbol}")
    company_data = await fetch_company_data(req.symbol)
    if "error" in company_data:
        raise HTTPException(
            status_code=400,
            detail=f"无法获取 {req.symbol} 的财务数据：{company_data['error']}",
        )

    price_data = company_data.get("price_data", {})
    if not price_data.get("current_price"):
        raise HTTPException(
            status_code=400,
            detail=f"股票代码 {req.symbol} 未找到，请检查代码是否正确（如 AAPL、TSLA、700.HK）。",
        )

    # 3. Run pipeline
    logger.info(
        f"[company] starting pipeline: symbol={req.symbol} "
        f"model={model_config['provider']}/{model_config['model']}"
    )
    runner = CompanySkillRunner(model_config, company_data)
    result = await runner.run_pipeline()

    profile = company_data.get("profile", {})
    verdict = VerdictOutput(**result["verdict"])

    # Build data_freshness from cache metadata
    cache_meta = company_data.get("_cache_meta", {})
    data_freshness = {
        "cached": cache_meta.get("cached", False),
        "fetched_at": cache_meta.get("fetched_at", ""),
        "cache_ttl_hours": cache_meta.get("cache_ttl_hours", 168),
    }

    return {
        "symbol": req.symbol,
        "company_name": profile.get("name", req.symbol),
        "sector": profile.get("sector", ""),
        "industry": profile.get("industry", ""),
        "current_price": price_data.get("current_price", 0),
        "skills": result["skills"],
        "verdict": verdict.model_dump(),
        "trace": result.get("trace", []),
        "model_used": f"{model_config['provider']}/{model_config['model']}",
        "total_latency_ms": result["total_latency_ms"],
        "data_freshness": data_freshness,
    }


@router.delete("/cache/{symbol}")
async def invalidate_cache(
    symbol: str,
    user: dict = Depends(get_current_user),
):
    """Invalidate cached company data for a symbol."""
    await invalidate_company_cache(symbol)
    return {"status": "ok", "symbol": symbol.upper(), "message": f"Cache invalidated for {symbol.upper()}"}
