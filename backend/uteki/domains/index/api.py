"""指数投资智能体 — FastAPI 路由"""

import asyncio
import json
import logging
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import Optional, List

from uteki.common.cache import get_cache_service
from uteki.common.database import SupabaseRepository, db_manager
from uteki.domains.auth.deps import get_current_user
from uteki.domains.index.schemas import (
    WatchlistAddRequest, BacktestRequest, BacktestCompareRequest,
    LLMBacktestRequest,
    PromptUpdateRequest, MemoryWriteRequest, ToolTestRequest,
    ArenaRunRequest, DecisionAdoptRequest, DecisionApproveRequest,
    DecisionSkipRequest, DecisionRejectRequest,
    ScheduleCreateRequest, ScheduleUpdateRequest,
    AgentChatRequest, AgentConfigUpdateRequest,
    ModelConfigUpdateRequest,
    IndexResponse,
)
from uteki.domains.index.services.data_service import DataService, get_data_service
from uteki.domains.index.services.backtest_service import BacktestService, get_backtest_service
from uteki.domains.index.services.prompt_service import PromptService, get_prompt_service
from uteki.domains.index.services.memory_service import MemoryService, get_memory_service
from uteki.domains.index.services.decision_service import DecisionService, get_decision_service
from uteki.domains.index.services.arena_service import ArenaService, get_arena_service
from uteki.domains.index.services.score_service import ScoreService, get_score_service
from uteki.domains.index.services.evaluation_service import EvaluationService, get_evaluation_service
from uteki.domains.index.services.scheduler_service import SchedulerService, get_scheduler_service
from uteki.domains.index.services.harness_builder import HarnessBuilder

logger = logging.getLogger(__name__)

router = APIRouter()

_TTL = 86400
_SHORT_TTL = 300


def _today() -> str:
    return date.today().isoformat()


def _get_user_id(user: dict) -> str:
    return user["user_id"]


async def _invalidate_decision_caches() -> None:
    """Invalidate leaderboard, evaluation, and decision caches after decision actions."""
    cache = get_cache_service()
    await cache.delete_pattern("uteki:index:leaderboard:")
    await cache.delete_pattern("uteki:index:eval:")
    await cache.delete_pattern("uteki:index:decisions:")


# ══════════════════════════════════════════
# Watchlist & Quotes
# ══════════════════════════════════════════

@router.get("/watchlist", summary="获取观察池")
async def get_watchlist(
    data_service: DataService = Depends(get_data_service),
):
    cache = get_cache_service()

    async def _fetch():
        items = data_service.get_watchlist()
        return {"success": True, "data": items}

    return await cache.get_or_set(
        f"uteki:index:watchlist:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


@router.post("/watchlist", summary="添加标的到观察池")
async def add_to_watchlist(
    request: WatchlistAddRequest,
    data_service: DataService = Depends(get_data_service),
):
    item = await data_service.add_to_watchlist(
        request.symbol, name=request.name, etf_type=request.etf_type
    )
    cache = get_cache_service()
    await cache.delete_pattern("uteki:index:watchlist:")
    await cache.delete_pattern("uteki:index:history:")
    return {"success": True, "data": item}


@router.delete("/watchlist/{symbol}", summary="从观察池移除")
async def remove_from_watchlist(
    symbol: str,
    data_service: DataService = Depends(get_data_service),
):
    removed = await data_service.remove_from_watchlist(symbol)
    if not removed:
        raise HTTPException(404, f"Symbol {symbol} not found in watchlist")
    cache = get_cache_service()
    await cache.delete_pattern("uteki:index:watchlist:")
    await cache.delete_pattern("uteki:index:history:")
    return {"success": True, "message": f"{symbol} removed from watchlist"}


@router.put("/watchlist/{symbol}/notes", summary="更新标的备注")
async def update_watchlist_notes(
    symbol: str,
    request: dict,
):
    repo = SupabaseRepository("watchlist")
    rows = repo.select_data(eq={"symbol": symbol.upper(), "is_active": True}, limit=1)
    if not rows:
        raise HTTPException(404, f"Symbol {symbol} not found in watchlist")
    item = rows[0]
    repo.update(
        data={"notes": request.get("notes", "")},
        eq={"id": item["id"]},
    )
    item["notes"] = request.get("notes", "")
    await get_cache_service().delete_pattern("uteki:index:watchlist:")
    return {"success": True, "data": item}


@router.get("/quotes/{symbol}", summary="获取实时报价")
async def get_quote(
    symbol: str,
    data_service: DataService = Depends(get_data_service),
):
    quote = await data_service.get_quote(symbol)
    return {"success": True, "data": quote}


@router.get("/history/{symbol}", summary="获取历史日线数据")
async def get_history(
    symbol: str,
    start: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    data_service: DataService = Depends(get_data_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = data_service.get_history(symbol, start=start, end=end)
        return {"success": True, "data": data, "count": len(data)}

    return await cache.get_or_set(
        f"uteki:index:history:{_today()}:{symbol}:{start}:{end}", _fetch, ttl=_SHORT_TTL,
    )


@router.post("/data/refresh", summary="手动刷新所有观察池数据")
async def refresh_data(
    data_service: DataService = Depends(get_data_service),
):
    results = await data_service.update_all_watchlist()
    await get_cache_service().delete_pattern("uteki:index:history:")
    return {"success": True, "data": results}


@router.post("/data/sync", summary="检查并自动同步缺失数据")
async def sync_data(
    data_service: DataService = Depends(get_data_service),
):
    """
    检查所有观察池标的的数据新鲜度，自动补齐缺失数据。
    适合进入 Watchlist 页面时自动调用。
    返回每个 symbol 的同步状态。
    """
    from datetime import date as date_type, timedelta
    from uteki.domains.index.services.market_calendar import is_trading_day

    watchlist_rows = SupabaseRepository("watchlist").select_data(eq={"is_active": True})

    if not watchlist_rows:
        return {"success": True, "data": {"synced": [], "already_fresh": [], "failed": []}}

    today = date_type.today()
    synced = []
    already_fresh = []
    failed = []

    price_repo = SupabaseRepository("index_prices")

    for w in watchlist_rows:
        symbol = w["symbol"]
        try:
            # Check last available date
            last_rows = price_repo.select_data(
                eq={"symbol": symbol}, order="date.desc", limit=1
            )

            if not last_rows:
                # No data at all — do initial load
                count = await data_service.initial_history_load(symbol)
                synced.append({"symbol": symbol, "action": "initial_load", "records": count})
                continue

            last_date_str = str(last_rows[0]["date"])[:10]
            last_date = date_type.fromisoformat(last_date_str)

            # Count missing trading days (excluding weekends and US market holidays)
            days_behind = 0
            check = last_date + timedelta(days=1)
            while check < today:
                if is_trading_day(check):
                    days_behind += 1
                check += timedelta(days=1)

            if days_behind > 0:
                backfill = await data_service.smart_backfill(symbol)
                synced.append({"symbol": symbol, **backfill})
            else:
                already_fresh.append(symbol)
        except Exception as e:
            logger.error(f"Sync failed for {symbol}: {e}")
            failed.append({"symbol": symbol, "error": str(e)})

    return {
        "success": True,
        "data": {
            "synced": synced,
            "already_fresh": already_fresh,
            "failed": failed,
        },
    }


@router.post("/data/validate", summary="验证数据连续性")
async def validate_data(
    symbol: Optional[str] = Query(None, description="Symbol to validate, or all if omitted"),
    data_service: DataService = Depends(get_data_service),
):
    """检测缺失的交易日（排除周末），返回 missing_dates 数组"""
    if symbol:
        result = data_service.validate_data_continuity(symbol)
        return {"success": True, "data": result}
    else:
        results = data_service.validate_all_watchlist()
        return {"success": True, "data": results}


# ══════════════════════════════════════════
# Backtest
# ══════════════════════════════════════════

@router.post("/backtest", summary="单指数回测")
async def run_backtest(
    request: BacktestRequest,
    backtest_service: BacktestService = Depends(get_backtest_service),
):
    result = await backtest_service.run(
        request.symbol, request.start, request.end,
        request.initial_capital, request.monthly_dca,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return {"success": True, "data": result}


@router.post("/backtest/compare", summary="多指数对比回测")
async def compare_backtest(
    request: BacktestCompareRequest,
    backtest_service: BacktestService = Depends(get_backtest_service),
):
    results = await backtest_service.compare(
        request.symbols, request.start, request.end,
        request.initial_capital, request.monthly_dca,
    )
    return {"success": True, "data": results}


@router.post("/backtest/replay/{harness_id}", summary="决策重放")
async def replay_decision(
    harness_id: str,
    backtest_service: BacktestService = Depends(get_backtest_service),
):
    result = await backtest_service.replay_decision(harness_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return {"success": True, "data": result}


# ── LLM Backtest ──

@router.post("/backtest/llm/stream", summary="SSE 流式 LLM 回测")
async def run_llm_backtest_stream(
    request: LLMBacktestRequest,
    user: dict = Depends(get_current_user),
):
    from uteki.domains.index.services.llm_backtest_service import get_llm_backtest_service
    svc = get_llm_backtest_service()
    user_id = _get_user_id(user)

    queue: asyncio.Queue = asyncio.Queue()

    def emit_progress(event: dict):
        queue.put_nowait(event)

    async def run_task():
        try:
            result = await svc.run_backtest(
                year=request.year,
                initial_capital=request.initial_capital,
                monthly_contribution=request.monthly_contribution,
                model_keys=request.model_keys,
                user_id=user_id,
                on_progress=emit_progress,
            )
            queue.put_nowait({"type": "result", "data": result})
        except Exception as e:
            logger.error(f"LLM backtest error: {e}")
            queue.put_nowait({"type": "error", "message": str(e)})
        finally:
            queue.put_nowait(None)

    async def event_generator():
        task = asyncio.create_task(run_task())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/backtest/llm/runs", summary="获取 LLM 回测历史列表")
async def get_llm_backtest_runs(
    limit: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    from uteki.domains.index.services.llm_backtest_service import get_llm_backtest_service
    svc = get_llm_backtest_service()
    runs = svc.get_runs(_get_user_id(user), limit=limit)
    return {"success": True, "data": runs}


@router.get("/backtest/llm/runs/{run_id}", summary="获取 LLM 回测详情")
async def get_llm_backtest_detail(
    run_id: str,
    user: dict = Depends(get_current_user),
):
    from uteki.domains.index.services.llm_backtest_service import get_llm_backtest_service
    svc = get_llm_backtest_service()
    detail = svc.get_run_detail(run_id)
    if not detail:
        raise HTTPException(404, "Backtest run not found")
    return {"success": True, "data": detail}


# ══════════════════════════════════════════
# Prompt (system / user)
# ══════════════════════════════════════════

@router.get("/prompt/current", summary="获取当前 Prompt")
async def get_current_prompt(
    prompt_type: str = Query("system", description="system / user"),
    prompt_service: PromptService = Depends(get_prompt_service),
):
    cache = get_cache_service()

    async def _fetch():
        prompt = await prompt_service.get_current(prompt_type=prompt_type)
        return {"success": True, "data": prompt}

    return await cache.get_or_set(
        f"uteki:index:prompt:current:{_today()}:{prompt_type}", _fetch, ttl=_SHORT_TTL,
    )


@router.put("/prompt", summary="更新 Prompt（创建新版本）")
async def update_prompt(
    request: PromptUpdateRequest,
    prompt_type: str = Query("system", description="system / user"),
    prompt_service: PromptService = Depends(get_prompt_service),
):
    version = await prompt_service.update_prompt(
        request.content, request.description, prompt_type=prompt_type
    )
    await get_cache_service().delete_pattern("uteki:index:prompt:")
    return {"success": True, "data": version}


@router.get("/prompt/history", summary="获取 Prompt 版本历史")
async def get_prompt_history(
    prompt_type: str = Query("system", description="system / user"),
    prompt_service: PromptService = Depends(get_prompt_service),
):
    cache = get_cache_service()

    async def _fetch():
        history = await prompt_service.get_history(prompt_type=prompt_type)
        return {"success": True, "data": history}

    return await cache.get_or_set(
        f"uteki:index:prompt:history:{_today()}:{prompt_type}", _fetch, ttl=_SHORT_TTL,
    )


@router.put("/prompt/{version_id}/activate", summary="切换当前 Prompt 版本")
async def activate_prompt_version(
    version_id: str,
    prompt_service: PromptService = Depends(get_prompt_service),
):
    try:
        version = await prompt_service.activate_version(version_id)
        await get_cache_service().delete_pattern("uteki:index:prompt:")
        return {"success": True, "data": version}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/prompt/{version_id}", summary="删除 Prompt 版本")
async def delete_prompt_version(
    version_id: str,
    prompt_service: PromptService = Depends(get_prompt_service),
):
    try:
        await prompt_service.delete_version(version_id)
        await get_cache_service().delete_pattern("uteki:index:prompt:")
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/prompt/preview", summary="预览 User Prompt 模板渲染结果")
async def preview_user_prompt(
    data_service: DataService = Depends(get_data_service),
    memory_service: MemoryService = Depends(get_memory_service),
    prompt_service: PromptService = Depends(get_prompt_service),
    user: dict = Depends(get_current_user),
):
    builder = HarnessBuilder(data_service, memory_service, prompt_service)
    preview_data = await builder.build_preview_data(user_id=_get_user_id(user))
    rendered = await prompt_service.render_user_prompt(preview_data)
    variables = prompt_service._build_template_variables(preview_data)
    return {"success": True, "data": {"rendered": rendered, "variables": variables}}


# ══════════════════════════════════════════
# Memory
# ══════════════════════════════════════════

@router.get("/memory", summary="获取 Agent 记忆（分页）")
async def get_memory(
    category: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    cache = get_cache_service()
    uid = _get_user_id(user)

    async def _fetch():
        memories = await memory_service.read(
            uid, category=category, limit=limit, offset=offset,
        )
        return {"success": True, "data": memories}

    return await cache.get_or_set(
        f"uteki:index:memory:{uid}:{_today()}:{category}:{limit}:{offset}",
        _fetch, ttl=_SHORT_TTL,
    )


@router.post("/memory", summary="写入 Agent 记忆")
async def write_memory(
    request: MemoryWriteRequest,
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    uid = _get_user_id(user)
    memory = await memory_service.write(
        uid, request.category, request.content,
        metadata=request.metadata
    )
    await get_cache_service().delete_pattern(f"uteki:index:memory:{uid}:")
    return {"success": True, "data": memory}


@router.delete("/memory/{memory_id}", summary="删除 Agent 记忆")
async def delete_memory(
    memory_id: str,
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    uid = _get_user_id(user)
    deleted = await memory_service.delete(memory_id, uid)
    if not deleted:
        raise HTTPException(404, "Memory not found")
    await get_cache_service().delete_pattern(f"uteki:index:memory:{uid}:")
    return {"success": True, "message": "Memory deleted"}


# ══════════════════════════════════════════
# Tools
# ══════════════════════════════════════════

@router.get("/tools", summary="获取所有工具定义")
async def get_tool_definitions():
    cache = get_cache_service()

    async def _fetch():
        from uteki.domains.index.services.agent_skills import TOOL_DEFINITIONS
        return {"success": True, "data": TOOL_DEFINITIONS}

    return await cache.get_or_set(
        f"uteki:index:tools:{_today()}", _fetch, ttl=_TTL,
    )


@router.post("/tools/{tool_name}/test", summary="测试运行工具")
async def test_tool(
    tool_name: str,
    request: ToolTestRequest,
    user: dict = Depends(get_current_user),
):
    from uteki.domains.index.services.agent_skills import TOOL_DEFINITIONS, ToolExecutor
    if tool_name not in TOOL_DEFINITIONS:
        raise HTTPException(404, f"Tool '{tool_name}' not found")

    executor = ToolExecutor(
        harness_data={},
        agent_key="shared",
        user_id=_get_user_id(user),
    )
    result = await executor.execute(tool_name, request.arguments)
    return {"success": True, "data": json.loads(result)}


# ══════════════════════════════════════════
# Account & Agent Config
# ══════════════════════════════════════════

@router.get("/index-account", summary="获取 Index 账户数据（按 watchlist 过滤持仓）")
async def get_index_account(
    data_service: DataService = Depends(get_data_service),
    memory_service: MemoryService = Depends(get_memory_service),
    prompt_service: PromptService = Depends(get_prompt_service),
    user: dict = Depends(get_current_user),
):
    """返回按 watchlist 过滤的 index 账户视图：现金、index 持仓、非 index 持仓市值"""
    builder = HarnessBuilder(data_service, memory_service, prompt_service)
    watchlist = data_service.get_watchlist()
    watchlist_symbols = [item["symbol"] for item in watchlist]
    account_info = await builder._get_index_account_info(watchlist_symbols)
    return {"success": True, "data": account_info}


@router.get("/account/summary", summary="获取账户概览（总资产/现金/持仓市值）")
async def get_account_summary(
    user: dict = Depends(get_current_user),
):
    """从 SNB 获取实时账户数据"""
    try:
        from uteki.domains.snb.api import _require_client
        client = await _require_client()
        balance = await client.get_balance()
        positions = await client.get_positions()

        bal_data = balance.get("data", {}) if balance.get("success") else {}
        total = bal_data.get("total_value", 0) or 0
        cash = bal_data.get("cash", 0) or 0
        positions_value = total - cash

        return {"success": True, "data": {
            "total": total,
            "cash": cash,
            "positions_value": positions_value,
        }}
    except Exception as e:
        logger.warning(f"Failed to get account summary: {e}")
        return {"success": True, "data": {
            "total": 0, "cash": 0, "positions_value": 0,
            "error": str(e),
        }}


@router.get("/agent-config", summary="获取 Agent 配置")
async def get_agent_config(
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    """从 Memory 读取 agent_config 配置"""
    cache = get_cache_service()
    uid = _get_user_id(user)

    async def _fetch():
        try:
            memories = await memory_service.read(
                uid, category="agent_config", limit=1, agent_key="system"
            )
        except Exception as e:
            logger.warning(f"Failed to read agent config: {e}")
            return {"success": True, "data": {}}
        if memories:
            try:
                config = json.loads(memories[0].get("content", "{}"))
            except (json.JSONDecodeError, TypeError):
                config = {}
        else:
            config = {}
        return {"success": True, "data": config}

    return await cache.get_or_set(
        f"uteki:index:agent_config:{uid}:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


@router.put("/agent-config", summary="保存 Agent 配置")
async def save_agent_config(
    request: AgentConfigUpdateRequest,
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    """保存 agent_config 到 Memory（覆盖式）"""
    user_id = _get_user_id(user)
    config_json = json.dumps(request.config)

    # 查找已有的 agent_config 记录
    repo = SupabaseRepository("agent_memory")
    rows = repo.select_data(
        eq={"user_id": user_id, "category": "agent_config", "agent_key": "system"},
        limit=1,
    )

    if rows:
        repo.update(
            data={"content": config_json},
            eq={"id": rows[0]["id"]},
        )
    else:
        from datetime import datetime, timezone
        from uuid import uuid4
        repo.insert({
            "id": str(uuid4()),
            "user_id": user_id,
            "category": "agent_config",
            "content": config_json,
            "agent_key": "system",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    await get_cache_service().delete_pattern(f"uteki:index:agent_config:{user_id}:")
    return {"success": True, "data": request.config}


# ══════════════════════════════════════════
# Model Config
# ══════════════════════════════════════════

@router.get("/model-config", summary="获取 Arena 模型配置")
async def get_model_config(
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    """返回 Arena 生效的模型列表 + per-model web search 设置。

    模型来源优先级: admin.llm_providers → agent_memory (legacy) → hardcoded
    Web search 设置单独存在 agent_memory (category=web_search_config)。
    """
    cache = get_cache_service()
    uid = _get_user_id(user)

    async def _fetch():
        # ── 1. Load effective model list (same logic as Arena) ──
        models: list[dict] = []

        # Priority 1: Admin LLM Providers (scoped to current user)
        try:
            from uteki.domains.admin.service import get_llm_provider_service, get_encryption_service
            llm_svc = get_llm_provider_service()
            enc = get_encryption_service()
            admin_models = await llm_svc.get_active_models_for_runtime(
                user_id=uid, encryption_service=enc,
            )
            if admin_models:
                models = [
                    {
                        "provider": m["provider"],
                        "model": m["model"],
                        "api_key": _mask_key(m.get("api_key", "")),
                        "base_url": m.get("base_url"),
                        "temperature": m.get("temperature", 0),
                        "max_tokens": m.get("max_tokens", 4096),
                        "enabled": True,
                    }
                    for m in admin_models
                ]
        except Exception as e:
            logger.warning(f"Failed to load admin models for config UI: {e}")

        # Priority 2: Legacy agent_memory
        if not models:
            try:
                memories = await memory_service.read(
                    uid, category="model_config", limit=1, agent_key="system"
                )
                if memories:
                    models = json.loads(memories[0].get("content", "[]"))
            except Exception as e:
                logger.warning(f"Failed to read model config: {e}")

        if not models:
            return {
                "success": True,
                "data": [],
                "hint": "尚未配置任何 LLM 模型。请前往 Admin > Models 添加至少一个模型的 API Key。",
            }

        # ── 2. Load web search settings overlay ──
        ws_config: dict = {}
        try:
            ws_memories = await memory_service.read(
                uid, category="web_search_config", limit=1, agent_key="system"
            )
            if ws_memories:
                ws_config = json.loads(ws_memories[0].get("content", "{}"))
        except Exception:
            pass

        # ── 3. Merge: models + web_search overlay ──
        for m in models:
            key = f"{m['provider']}:{m['model']}"
            ws = ws_config.get(key, {})
            m["web_search_enabled"] = ws.get("web_search_enabled", False)
            m["web_search_provider"] = ws.get("web_search_provider", "google")

        return {"success": True, "data": models}

    return await cache.get_or_set(
        f"uteki:index:model_config:{uid}:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


def _mask_key(key: str) -> str:
    """Mask API key for display: show first 4 + last 4 chars."""
    if not key or len(key) <= 12:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


@router.put("/model-config", summary="保存 Arena 模型配置")
async def save_model_config(
    request: ModelConfigUpdateRequest,
    memory_service: MemoryService = Depends(get_memory_service),
    user: dict = Depends(get_current_user),
):
    """保存 model_config 到 Memory（覆盖式）。

    同时提取 web_search 设置存到 web_search_config（供 Arena 运行时读取）。
    """
    user_id = _get_user_id(user)
    models_json = json.dumps([m.model_dump() for m in request.models])

    repo = SupabaseRepository("agent_memory")

    # ── Save full model config (legacy path) ──
    rows = repo.select_data(
        eq={"user_id": user_id, "category": "model_config", "agent_key": "system"},
        limit=1,
    )

    if rows:
        repo.update(
            data={"content": models_json},
            eq={"id": rows[0]["id"]},
        )
    else:
        from datetime import datetime, timezone
        from uuid import uuid4
        repo.insert({
            "id": str(uuid4()),
            "user_id": user_id,
            "category": "model_config",
            "content": models_json,
            "agent_key": "system",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    # ── Save web_search overlay (keyed by provider:model) ──
    ws_config = {}
    for m in request.models:
        key = f"{m.provider}:{m.model}"
        ws_config[key] = {
            "web_search_enabled": m.web_search_enabled,
            "web_search_provider": m.web_search_provider or "google",
        }
    ws_json = json.dumps(ws_config)

    ws_rows = repo.select_data(
        eq={"user_id": user_id, "category": "web_search_config", "agent_key": "system"},
        limit=1,
    )
    if ws_rows:
        repo.update(data={"content": ws_json}, eq={"id": ws_rows[0]["id"]})
    else:
        from datetime import datetime, timezone
        from uuid import uuid4
        repo.insert({
            "id": str(uuid4()),
            "user_id": user_id,
            "category": "web_search_config",
            "content": ws_json,
            "agent_key": "system",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    await get_cache_service().delete_pattern(f"uteki:index:model_config:{user_id}:")
    return {"success": True, "data": [m.model_dump() for m in request.models]}


# ══════════════════════════════════════════
# Arena
# ══════════════════════════════════════════

@router.post("/arena/run", summary="手动触发 Arena 分析")
async def run_arena(
    request: ArenaRunRequest,
    data_service: DataService = Depends(get_data_service),
    memory_service: MemoryService = Depends(get_memory_service),
    prompt_service: PromptService = Depends(get_prompt_service),
    arena_service: ArenaService = Depends(get_arena_service),
    score_service: ScoreService = Depends(get_score_service),
    user: dict = Depends(get_current_user),
):
    # 1. 构建 Harness
    builder = HarnessBuilder(data_service, memory_service, prompt_service)
    harness = await builder.build(
        harness_type=request.harness_type,
        user_id=_get_user_id(user),
        budget=request.budget,
        constraints=request.constraints,
    )

    # 2. 运行 Arena (3-phase pipeline: 决策 → 投票 → 计分)
    arena_result = await arena_service.run(harness["id"])

    # 3. Invalidate arena + decision caches
    cache = get_cache_service()
    await cache.delete_pattern("uteki:index:arena:")
    await cache.delete_pattern("uteki:index:decisions:")

    # 4. 获取 prompt 版本号
    prompt_ver = await prompt_service.get_by_id(harness["prompt_version_id"])
    prompt_version_str = prompt_ver["version"] if prompt_ver else None

    return {
        "success": True,
        "data": {
            "harness_id": harness["id"],
            "harness_type": harness["harness_type"],
            "prompt_version_id": harness["prompt_version_id"],
            "prompt_version": prompt_version_str,
            "models": arena_result.get("model_ios", []),
            "votes": arena_result.get("votes", []),
            "final_decision": arena_result.get("final_decision"),
            "pipeline_phases": arena_result.get("pipeline_phases", {}),
        },
    }


@router.post("/arena/run/stream", summary="SSE 流式 Arena 分析")
async def run_arena_stream(
    request: ArenaRunRequest,
    data_service: DataService = Depends(get_data_service),
    memory_service: MemoryService = Depends(get_memory_service),
    prompt_service: PromptService = Depends(get_prompt_service),
    arena_service: ArenaService = Depends(get_arena_service),
    user: dict = Depends(get_current_user),
):
    # 1. 构建 Harness
    builder = HarnessBuilder(data_service, memory_service, prompt_service)
    harness = await builder.build(
        harness_type=request.harness_type,
        user_id=_get_user_id(user),
        budget=request.budget,
        constraints=request.constraints,
    )

    prompt_ver = await prompt_service.get_by_id(harness["prompt_version_id"])
    prompt_version_str = prompt_ver["version"] if prompt_ver else None

    queue: asyncio.Queue = asyncio.Queue()

    def emit_progress(event: dict):
        queue.put_nowait(event)

    async def run_arena_task():
        try:
            model_filter = [m.model_dump() for m in request.models] if request.models else None
            result = await arena_service.run(
                harness["id"], on_progress=emit_progress,
                model_filter=model_filter,
            )
            # Invalidate arena + decision caches
            c = get_cache_service()
            await c.delete_pattern("uteki:index:arena:")
            await c.delete_pattern("uteki:index:decisions:")

            final = result.get("final_decision", {})
            queue.put_nowait({
                "type": "result",
                "data": {
                    "harness_id": harness["id"],
                    "harness_type": harness["harness_type"],
                    "prompt_version_id": harness["prompt_version_id"],
                    "prompt_version": prompt_version_str,
                    "models": result.get("model_ios", []),
                    "votes": result.get("votes", []),
                    "final_decision": final,
                    "pipeline_phases": result.get("pipeline_phases", {}),
                },
            })

            # Notify user of arena completion
            try:
                from uteki.domains.notification.service import get_notification_service
                nsvc = get_notification_service()
                await nsvc.notify_arena_complete(
                    user_id=_get_user_id(user),
                    harness_id=harness["id"],
                    winner_model=f"{final.get('winner_model_provider', '')}/{final.get('winner_model_name', '')}",
                    winner_action=final.get("winner_action", "N/A"),
                )
            except Exception:
                logger.warning("Failed to create arena notification", exc_info=True)

        except Exception as e:
            logger.error(f"Arena stream error: {e}")
            queue.put_nowait({"type": "error", "message": str(e)})
        finally:
            queue.put_nowait(None)  # sentinel

    async def event_generator():
        task = asyncio.create_task(run_arena_task())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/arena/timeline", summary="获取 Arena 时间线图表数据")
async def get_arena_timeline(
    limit: int = Query(50, ge=1, le=200),
    arena_service: ArenaService = Depends(get_arena_service),
):
    cache = get_cache_service()

    async def _fetch():
        try:
            timeline = await arena_service.get_arena_timeline(limit=limit)
        except Exception as e:
            logger.warning(f"Failed to get arena timeline: {e}")
            return {"success": True, "data": []}
        return {"success": True, "data": timeline}

    return await cache.get_or_set(
        f"uteki:index:arena:timeline:{_today()}:{limit}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/arena/backtest", summary="运行单 Agent 独立回测")
async def run_agent_backtest(
    agent_key: str = Query(..., description="Agent key, e.g. anthropic:claude-sonnet-4-20250514"),
    start_date: str = Query(..., description="Start date, e.g. 2025-01-01"),
    end_date: str = Query(..., description="End date, e.g. 2025-12-31"),
    frequency: str = Query("monthly", description="weekly / biweekly / monthly"),
):
    from datetime import date as date_type
    from uteki.domains.index.services.agent_backtest_service import get_agent_backtest_service
    backtest_service = get_agent_backtest_service()
    result = await backtest_service.run_backtest(
        agent_key=agent_key,
        start_date=date_type.fromisoformat(start_date),
        end_date=date_type.fromisoformat(end_date),
        frequency=frequency,
    )
    return {"success": True, "data": result}


@router.get("/arena/history", summary="获取 Arena 运行历史")
async def get_arena_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    arena_service: ArenaService = Depends(get_arena_service),
):
    cache = get_cache_service()

    async def _fetch():
        history = await arena_service.get_arena_history(limit=limit, offset=offset)
        return {"success": True, "data": history}

    return await cache.get_or_set(
        f"uteki:index:arena:history:{_today()}:{limit}:{offset}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/arena/{harness_id}", summary="获取 Arena 结果")
async def get_arena_results(
    harness_id: str,
    arena_service: ArenaService = Depends(get_arena_service),
):
    cache = get_cache_service()

    async def _fetch():
        return {"success": True, "data": arena_service.get_arena_results(harness_id)}

    return await cache.get_or_set(
        f"uteki:index:arena:result:{_today()}:{harness_id}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/arena/{harness_id}/votes", summary="获取 Arena 投票详情")
async def get_arena_votes(
    harness_id: str,
    arena_service: ArenaService = Depends(get_arena_service),
):
    cache = get_cache_service()

    async def _fetch():
        return {"success": True, "data": arena_service.get_votes_for_harness(harness_id)}

    return await cache.get_or_set(
        f"uteki:index:arena:votes:{_today()}:{harness_id}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/arena/{harness_id}/model/{model_io_id}", summary="获取模型完整 I/O")
async def get_model_io_detail(
    harness_id: str,
    model_io_id: str,
    arena_service: ArenaService = Depends(get_arena_service),
):
    cache = get_cache_service()

    async def _fetch():
        detail = arena_service.get_model_io_detail(model_io_id)
        if not detail:
            raise HTTPException(404, "Model I/O not found")
        return {"success": True, "data": detail}

    return await cache.get_or_set(
        f"uteki:index:arena:model_io:{_today()}:{model_io_id}", _fetch, ttl=_SHORT_TTL,
    )


# ══════════════════════════════════════════
# Decisions
# ══════════════════════════════════════════

@router.get("/decisions", summary="获取决策时间线")
async def get_decisions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_action: Optional[str] = Query(None),
    harness_type: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    decision_service: DecisionService = Depends(get_decision_service),
):
    cache = get_cache_service()

    async def _fetch():
        timeline = await decision_service.get_timeline(
            limit=limit, offset=offset,
            user_action=user_action, harness_type=harness_type,
            start_date=start_date, end_date=end_date,
        )
        return {"success": True, "data": timeline}

    return await cache.get_or_set(
        f"uteki:index:decisions:list:{_today()}:{limit}:{offset}:{user_action}:{harness_type}:{start_date}:{end_date}",
        _fetch, ttl=_SHORT_TTL,
    )


@router.get("/decisions/{decision_id}", summary="获取决策详情")
async def get_decision_detail(
    decision_id: str,
    decision_service: DecisionService = Depends(get_decision_service),
):
    cache = get_cache_service()

    async def _fetch():
        detail = await decision_service.get_by_id(decision_id)
        if not detail:
            raise HTTPException(404, "Decision not found")
        return {"success": True, "data": detail}

    return await cache.get_or_set(
        f"uteki:index:decisions:get:{_today()}:{decision_id}", _fetch, ttl=_SHORT_TTL,
    )


@router.post("/decisions/{harness_id}/approve", summary="批准决策（需 TOTP）")
async def approve_decision(
    harness_id: str,
    request: DecisionApproveRequest,
    decision_service: DecisionService = Depends(get_decision_service),
    score_service: ScoreService = Depends(get_score_service),
    user: dict = Depends(get_current_user),
):
    # TOTP 验证 — 通过数据库中用户密钥验证
    from uteki.domains.snb.services.totp_service import get_totp_service
    totp_service = get_totp_service()
    user_id = _get_user_id(user)

    async with db_manager.get_postgres_session() as session:
        valid = await totp_service.verify_totp(session, user_id, request.totp_code)
    if not valid:
        raise HTTPException(403, "TOTP验证码无效或已过期")

    # 执行实际下单 (SNB place_order)
    execution_results = []
    allocations = request.allocations or []

    if allocations:
        # 检查持仓限制（最多 3 个 ETF）
        try:
            from uteki.domains.snb.api import _require_client
            client = await _require_client()
            positions = await client.get_positions()
            current_symbols = {p.get("symbol") for p in (positions or [])}
            new_symbols = {a.get("etf", a.get("symbol", "")) for a in allocations}
            combined = current_symbols | new_symbols
            if len(combined) > 3:
                raise HTTPException(400, f"Position limit exceeded: max 3 ETFs, would have {len(combined)}")

            # 执行每个 allocation 的下单
            for alloc in allocations:
                etf = alloc.get("etf", alloc.get("symbol", ""))
                amount = alloc.get("amount", 0)
                if not etf or amount <= 0:
                    continue

                try:
                    order_result = await client.place_order(
                        symbol=etf, side="BUY", quantity=int(amount),
                        order_type="MKT",
                    )
                    execution_results.append({
                        "symbol": etf,
                        "amount": amount,
                        "status": "submitted",
                        "order": order_result,
                    })
                except Exception as order_err:
                    execution_results.append({
                        "symbol": etf,
                        "amount": amount,
                        "status": "error",
                        "error": str(order_err),
                    })
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"SNB order execution skipped: {e}")
            execution_results.append({"status": "skipped", "reason": str(e)})

    log = await decision_service.create_log(
        harness_id=harness_id,
        user_action="approved",
        executed_allocations=allocations,
        execution_results=execution_results,
        user_notes=request.notes,
    )
    await _invalidate_decision_caches()
    return {"success": True, "data": log}


@router.post("/decisions/{harness_id}/skip", summary="跳过决策")
async def skip_decision(
    harness_id: str,
    request: DecisionSkipRequest,
    decision_service: DecisionService = Depends(get_decision_service),
):
    log = await decision_service.create_log(
        harness_id=harness_id,
        user_action="skipped",
        user_notes=request.notes,
    )
    await _invalidate_decision_caches()
    return {"success": True, "data": log}


@router.post("/decisions/{harness_id}/reject", summary="拒绝决策")
async def reject_decision(
    harness_id: str,
    request: DecisionRejectRequest,
    decision_service: DecisionService = Depends(get_decision_service),
):
    log = await decision_service.create_log(
        harness_id=harness_id,
        user_action="rejected",
        user_notes=request.notes,
    )
    await _invalidate_decision_caches()
    return {"success": True, "data": log}


@router.get("/decisions/{decision_id}/counterfactuals", summary="获取反事实数据")
async def get_counterfactuals(
    decision_id: str,
    decision_service: DecisionService = Depends(get_decision_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = await decision_service.get_counterfactuals(decision_id)
        return {"success": True, "data": data}

    return await cache.get_or_set(
        f"uteki:index:decisions:counterfactuals:{_today()}:{decision_id}",
        _fetch, ttl=_SHORT_TTL,
    )


# ══════════════════════════════════════════
# Leaderboard
# ══════════════════════════════════════════

@router.get("/leaderboard", summary="获取模型排行榜")
async def get_leaderboard(
    prompt_version_id: Optional[str] = Query(None),
    score_service: ScoreService = Depends(get_score_service),
):
    cache = get_cache_service()

    async def _fetch():
        lb = await score_service.get_leaderboard(prompt_version_id=prompt_version_id)
        return {"success": True, "data": lb}

    return await cache.get_or_set(
        f"uteki:index:leaderboard:{_today()}:{prompt_version_id}", _fetch, ttl=_SHORT_TTL,
    )


# ══════════════════════════════════════════
# Evaluation
# ══════════════════════════════════════════

@router.get("/evaluation/overview", summary="Evaluation 概览 KPI")
async def get_evaluation_overview(
    eval_service: EvaluationService = Depends(get_evaluation_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = await eval_service.get_overview()
        return {"success": True, "data": data}

    return await cache.get_or_set(
        f"uteki:index:eval:overview:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/evaluation/voting-matrix", summary="投票热力图矩阵")
async def get_evaluation_voting_matrix(
    limit: int = Query(20, ge=1, le=100),
    eval_service: EvaluationService = Depends(get_evaluation_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = await eval_service.get_voting_matrix(limit=limit)
        return {"success": True, "data": data}

    return await cache.get_or_set(
        f"uteki:index:eval:voting_matrix:{_today()}:{limit}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/evaluation/performance-trend", summary="模型性能趋势")
async def get_evaluation_performance_trend(
    days: int = Query(30, ge=1, le=365),
    eval_service: EvaluationService = Depends(get_evaluation_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = await eval_service.get_performance_trend(days=days)
        return {"success": True, "data": data}

    return await cache.get_or_set(
        f"uteki:index:eval:perf_trend:{_today()}:{days}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/evaluation/cost-analysis", summary="模型成本分析")
async def get_evaluation_cost_analysis(
    eval_service: EvaluationService = Depends(get_evaluation_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = await eval_service.get_cost_analysis()
        return {"success": True, "data": data}

    return await cache.get_or_set(
        f"uteki:index:eval:cost_analysis:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


@router.get("/evaluation/counterfactual-summary", summary="反事实对比概览")
async def get_evaluation_counterfactual_summary(
    eval_service: EvaluationService = Depends(get_evaluation_service),
):
    cache = get_cache_service()

    async def _fetch():
        data = await eval_service.get_counterfactual_summary()
        return {"success": True, "data": data}

    return await cache.get_or_set(
        f"uteki:index:eval:counterfactual:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


# ══════════════════════════════════════════
# Schedules
# ══════════════════════════════════════════

@router.get("/schedules", summary="获取调度任务列表")
async def get_schedules(
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
):
    cache = get_cache_service()

    async def _fetch():
        tasks = await scheduler_service.list_tasks()
        return {"success": True, "data": tasks}

    return await cache.get_or_set(
        f"uteki:index:schedules:{_today()}", _fetch, ttl=_SHORT_TTL,
    )


@router.post("/schedules", summary="创建调度任务")
async def create_schedule(
    request: ScheduleCreateRequest,
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
):
    task = await scheduler_service.create_task(
        request.name, request.cron_expression, request.task_type,
        config=request.config,
    )
    await get_cache_service().delete_pattern("uteki:index:schedules:")
    return {"success": True, "data": task}


@router.put("/schedules/{task_id}", summary="更新调度任务")
async def update_schedule(
    task_id: str,
    request: ScheduleUpdateRequest,
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
):
    task = await scheduler_service.update_task(
        task_id,
        cron_expression=request.cron_expression,
        is_enabled=request.is_enabled,
        config=request.config,
    )
    if not task:
        raise HTTPException(404, "Schedule task not found")
    await get_cache_service().delete_pattern("uteki:index:schedules:")
    return {"success": True, "data": task}


@router.delete("/schedules/{task_id}", summary="删除调度任务")
async def delete_schedule(
    task_id: str,
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
):
    deleted = await scheduler_service.delete_task(task_id)
    if not deleted:
        raise HTTPException(404, "Schedule task not found")
    await get_cache_service().delete_pattern("uteki:index:schedules:")
    return {"success": True, "message": "Schedule task deleted"}


@router.post("/schedules/{task_id}/trigger", summary="手动触发调度任务")
async def trigger_schedule(
    task_id: str,
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
    data_service: DataService = Depends(get_data_service),
    memory_service: MemoryService = Depends(get_memory_service),
    prompt_service: PromptService = Depends(get_prompt_service),
    arena_service: ArenaService = Depends(get_arena_service),
    score_service: ScoreService = Depends(get_score_service),
    user: dict = Depends(get_current_user),
):
    task_data = await scheduler_service.get_task(task_id)
    if not task_data:
        raise HTTPException(404, "Schedule task not found")

    config = task_data.get("config", {}) or {}

    if task_data["task_type"] == "arena_analysis":
        # 构建 Harness → 运行 Arena
        builder = HarnessBuilder(data_service, memory_service, prompt_service)
        harness = await builder.build(
            harness_type=config.get("harness_type", "monthly_dca"),
            user_id=_get_user_id(user),
            budget=config.get("budget"),
        )
        arena_result = await arena_service.run(harness["id"])

        # Invalidate arena + decision caches
        c = get_cache_service()
        await c.delete_pattern("uteki:index:arena:")
        await c.delete_pattern("uteki:index:decisions:")

        await scheduler_service.update_run_status(task_id, "pending_user_action")
        return {
            "success": True,
            "data": {
                "harness_id": harness["id"],
                "models": arena_result.get("model_ios", []),
                "votes": arena_result.get("votes", []),
                "final_decision": arena_result.get("final_decision"),
                "pipeline_phases": arena_result.get("pipeline_phases", {}),
            },
        }

    elif task_data["task_type"] == "reflection":
        from uteki.domains.index.services.reflection_service import ReflectionService
        reflection_svc = ReflectionService(
            get_decision_service(), get_memory_service()
        )
        result = await reflection_svc.generate_reflection(
            _get_user_id(user),
            lookback_days=config.get("lookback_days", 30),
        )
        status = "success" if result.get("status") == "completed" else "skipped"
        await scheduler_service.update_run_status(task_id, status)
        return {"success": True, "data": result}

    elif task_data["task_type"] == "counterfactual":
        decision_svc = get_decision_service()
        results = {}
        for days in [7, 30, 90]:
            r = await decision_svc.run_counterfactual_batch(tracking_days=days)
            results[f"{days}d"] = r
        await scheduler_service.update_run_status(task_id, "success")
        return {"success": True, "data": results}

    elif task_data["task_type"] == "price_update":
        # 使用健壮更新：带重试、智能回填、异常检测
        results = await data_service.robust_update_all(
            validate=config.get("validate_after_update", True),
            backfill=config.get("enable_backfill", True),
        )

        # 判断任务状态
        has_failures = len(results["failed"]) > 0
        has_anomalies = len(results["anomalies"]) > 0

        if has_failures:
            status = "partial_failure"
            logger.warning(f"Price update partial failure: {results['failed']}")
        elif has_anomalies:
            status = "success_with_warnings"
            logger.warning(f"Price update completed with {len(results['anomalies'])} anomalies")
        else:
            status = "success"

        await scheduler_service.update_run_status(task_id, status)

        return {
            "success": not has_failures,
            "data": {
                "status": status,
                "success_count": len(results["success"]),
                "failed": results["failed"],
                "backfilled": results["backfilled"],
                "anomalies": results["anomalies"],
                "total_records": results["total_records"],
            },
        }

    raise HTTPException(400, f"Unknown task type: {task_data['task_type']}")


# ══════════════════════════════════════════
# Agent Chat
# ══════════════════════════════════════════

@router.post("/agent/chat", summary="Agent 对话")
async def agent_chat(
    request: AgentChatRequest,
    data_service: DataService = Depends(get_data_service),
    backtest_service: BacktestService = Depends(get_backtest_service),
    prompt_service: PromptService = Depends(get_prompt_service),
    memory_service: MemoryService = Depends(get_memory_service),
    decision_service: DecisionService = Depends(get_decision_service),
    user: dict = Depends(get_current_user),
):
    from uteki.domains.index.services.agent_service import AgentService
    agent = AgentService(prompt_service, memory_service, data_service, backtest_service, decision_service)
    result = await agent.chat(_get_user_id(user), request.message)
    return {"success": True, "data": result}


@router.post("/decisions/{harness_id}/adopt", summary="采纳模型建议")
async def adopt_model(
    harness_id: str,
    request: DecisionAdoptRequest,
    arena_service: ArenaService = Depends(get_arena_service),
    score_service: ScoreService = Depends(get_score_service),
):
    from uteki.domains.index.services.agent_service import AgentService

    # 获取模型 I/O 详情
    mio = arena_service.get_model_io_detail(request.model_io_id)
    if not mio:
        raise HTTPException(404, "Model I/O not found")

    # 获取 Harness via SupabaseRepository
    harness_repo = SupabaseRepository("decision_harness")
    harness_row = harness_repo.select_one(eq={"id": harness_id})
    if not harness_row:
        raise HTTPException(404, "Harness not found")

    # 生成决策卡片
    agent = AgentService(None, None, None, None, None)
    card = agent.generate_decision_card(mio, harness_row)

    # 更新评分
    await score_service.update_on_adoption(
        mio["model_provider"], mio["model_name"],
        harness_row.get("prompt_version_id"),
    )
    await _invalidate_decision_caches()

    return {"success": True, "data": card}
