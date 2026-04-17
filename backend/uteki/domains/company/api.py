"""
Company Agent API — 7-gate decision tree pipeline.

POST   /api/company/analyze         — synchronous (full result)
POST   /api/company/analyze/stream  — SSE streaming (progressive)
GET    /api/company/analyses         — list analyses (paginated)
GET    /api/company/analyses/{id}    — get analysis detail
DELETE /api/company/analyses/{id}    — delete analysis
DELETE /api/company/cache/{symbol}   — invalidate cache
"""
from __future__ import annotations
import asyncio
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import StreamingResponse

from uteki.domains.auth.deps import get_current_user, get_current_user_sse
from uteki.common.config import settings
from .schemas import (
    CompanyAnalyzeRequest, PositionHoldingOutput,
    PromptVersionCreate, ABTestRequest, CompareRequest, ShareResponse,
)
from .financials import fetch_company_data, invalidate_company_cache
from .skill_runner import CompanySkillRunner
from .repository import CompanyAnalysisRepository, CompanyPromptRepository
from uteki.common.pubsub import task_publish, task_publish_done

logger = logging.getLogger(__name__)
router = APIRouter()

_DEFAULT_MODEL = "deepseek-chat"

# Legacy fallback models (used when AIHubMix is not configured)
_FALLBACK_MODELS = [
    {"provider": "anthropic", "model": "claude-sonnet-4-20250514", "api_key_attr": "anthropic_api_key"},
    {"provider": "openai",    "model": "gpt-4.1",                  "api_key_attr": "openai_api_key"},
    {"provider": "deepseek",  "model": "deepseek-chat",            "api_key_attr": "deepseek_api_key"},
    {"provider": "google",    "model": "gemini-2.5-pro-thinking",  "api_key_attr": "google_api_key", "base_url_attr": "google_api_base_url"},
    {"provider": "qwen",      "model": "qwen-plus",                "api_key_attr": "dashscope_api_key"},
]


async def _resolve_model(
    provider_override: Optional[str],
    model_override: Optional[str],
    user_id: str,
) -> Optional[dict]:
    """Resolve model config for a specific user.

    Priority:
    1. User's stored aggregator key (AIHubMix / OpenRouter, DB, encrypted)
    2. env AIHUBMIX_API_KEY (legacy single-tenant fallback)
    3. User's provider-specific keys in Admin DB (legacy direct)
    4. .env fallback (legacy direct provider keys)
    """
    from uteki.domains.admin.aggregator_service import resolve_unified_provider

    # 1+2. User's aggregator key (DB), falling back to env AIHUBMIX_API_KEY
    resolved = await resolve_unified_provider(user_id=user_id)
    if resolved:
        _agg_provider, unified_key, unified_url = resolved

        # If model explicitly specified by caller, use it directly
        if model_override:
            cfg = {
                "provider": "openai",
                "model": model_override,
                "api_key": unified_key,
                "base_url": unified_url,
            }
            logger.info(f"[company] unified {_agg_provider}: {cfg['model']}")
            return cfg

        # Otherwise, pick first enabled model from user's admin registry
        try:
            from uteki.domains.admin.service import LLMProviderService
            svc = LLMProviderService()
            models = await svc.get_active_models_for_runtime(user_id=user_id)
            for m in models:
                if provider_override and m["provider"] != provider_override:
                    continue
                cfg = {
                    "provider": "openai",
                    "model": m["model"],
                    "api_key": unified_key,
                    "base_url": unified_url,
                }
                logger.info(f"[company] unified {_agg_provider} + admin registry: {cfg['model']}")
                return cfg
        except Exception as e:
            logger.warning(f"[company] admin model list load failed: {e}")

        # Admin registry empty — use default model
        cfg = {
            "provider": "openai",
            "model": _DEFAULT_MODEL,
            "api_key": unified_key,
            "base_url": unified_url,
        }
        logger.info(f"[company] unified {_agg_provider} default: {cfg['model']}")
        return cfg

    # 3. Legacy: Admin DB with direct provider keys (user-scoped)
    try:
        from uteki.domains.admin.service import LLMProviderService
        svc = LLMProviderService()
        models = await svc.get_active_models_for_runtime(user_id=user_id)
        for m in models:
            if provider_override and m["provider"] != provider_override:
                continue
            cfg = {
                "provider": m["provider"],
                "model": model_override or m["model"],
                "api_key": m["api_key"],
                "base_url": m.get("base_url") or None,
            }
            logger.info(f"[company] legacy admin direct: {cfg['provider']}/{cfg['model']}")
            return cfg
    except Exception as e:
        logger.warning(f"[company] admin model load failed: {e}")

    # 4. Legacy: .env direct provider keys (last resort)
    for m in _FALLBACK_MODELS:
        if provider_override and m["provider"] != provider_override:
            continue
        api_key = getattr(settings, m["api_key_attr"], None)
        if api_key:
            base_url = getattr(settings, m.get("base_url_attr", ""), None) if m.get("base_url_attr") else None
            cfg = {
                "provider": m["provider"],
                "model": model_override or m["model"],
                "api_key": api_key,
                "base_url": base_url,
            }
            logger.info(f"[company] legacy env direct: {cfg['provider']}/{cfg['model']}")
            return cfg

    return None


async def _fetch_and_validate(symbol: str) -> dict:
    """Fetch company data and validate it."""
    company_data = await fetch_company_data(symbol)
    if "error" in company_data:
        raise HTTPException(
            status_code=400,
            detail=f"无法获取 {symbol} 的财务数据：{company_data['error']}",
        )
    price_data = company_data.get("price_data", {})
    if not price_data.get("current_price"):
        raise HTTPException(
            status_code=400,
            detail=f"股票代码 {symbol} 未找到，请检查代码是否正确（如 AAPL、TSLA、700.HK）。",
        )
    return company_data


def _build_response(req, company_data, model_config, result):
    """Build the final API response dict."""
    profile = company_data.get("profile", {})
    cache_meta = company_data.get("_cache_meta", {})
    return {
        "symbol": req.symbol,
        "company_name": profile.get("name", req.symbol),
        "sector": profile.get("sector", ""),
        "industry": profile.get("industry", ""),
        "current_price": company_data.get("price_data", {}).get("current_price", 0),
        "skills": result["skills"],
        "verdict": result["verdict"],
        "trace": result.get("trace", []),
        "tool_calls": result.get("tool_calls"),
        "model_used": f"{model_config['provider']}/{model_config['model']}",
        "total_latency_ms": result["total_latency_ms"],
        "data_freshness": {
            "cached": cache_meta.get("cached", False),
            "fetched_at": cache_meta.get("fetched_at", ""),
            "cache_ttl_hours": cache_meta.get("cache_ttl_hours", 168),
        },
    }


async def _save_analysis(user_id: str, response_data: dict, model_config: dict, error_msg: Optional[str] = None) -> Optional[str]:
    """Persist analysis result to DB. Returns analysis_id or None on failure."""
    try:
        verdict = response_data.get("verdict", {}) if response_data else {}
        row = await CompanyAnalysisRepository.create({
            "user_id": user_id,
            "symbol": response_data.get("symbol", "") if response_data else "",
            "company_name": response_data.get("company_name", "") if response_data else "",
            "provider": model_config["provider"],
            "model": model_config["model"],
            "status": "error" if error_msg else "completed",
            "full_report": response_data or {},
            "verdict_action": verdict.get("action", "WATCH"),
            "verdict_conviction": float(verdict.get("conviction", 0.5)),
            "verdict_quality": verdict.get("quality_verdict", "GOOD"),
            "total_latency_ms": response_data.get("total_latency_ms", 0) if response_data else 0,
            "error_message": error_msg,
        })
        return row.get("id")
    except Exception as e:
        logger.error(f"[company] failed to save analysis: {e}", exc_info=True)
        return None


async def _create_running_analysis(user_id: str, symbol: str, company_name: str, model_config: dict) -> Optional[str]:
    """Create a 'running' analysis record in DB at pipeline start. Returns analysis_id or None."""
    try:
        row = await CompanyAnalysisRepository.create({
            "user_id": user_id,
            "symbol": symbol,
            "company_name": company_name,
            "provider": model_config["provider"],
            "model": model_config["model"],
            "status": "running",
            "full_report": {},
        })
        return row.get("id")
    except Exception as e:
        logger.error(f"[company] failed to create running analysis: {e}")
        return None


async def _update_analysis(analysis_id: str, data: dict):
    """Update an existing analysis record."""
    try:
        await CompanyAnalysisRepository.update(analysis_id, data)
    except Exception as e:
        logger.error(f"[company] failed to update analysis {analysis_id}: {e}")


@router.post("/analyze")
async def analyze_company(
    req: CompanyAnalyzeRequest,
    user: dict = Depends(get_current_user),
):
    """Run 7-gate company analysis pipeline (synchronous)."""
    model_config = await _resolve_model(req.provider, req.model, user_id=user["user_id"])
    if not model_config:
        raise HTTPException(
            status_code=503,
            detail="未找到可用的 LLM 配置。请在 Admin > Models 中添加 API Key。",
        )

    company_data = await _fetch_and_validate(req.symbol)

    logger.info(
        f"[company] starting pipeline: symbol={req.symbol} "
        f"model={model_config['provider']}/{model_config['model']}"
    )
    runner = CompanySkillRunner(model_config, company_data)
    result = await runner.run_pipeline()

    response = _build_response(req, company_data, model_config, result)

    # Persist to DB
    analysis_id = await _save_analysis(user.get("user_id", "default"), response, model_config)
    if analysis_id:
        response["analysis_id"] = analysis_id

    return response


@router.post("/analyze/stream")
async def analyze_company_stream(
    req: CompanyAnalyzeRequest,
    user: dict = Depends(get_current_user),
):
    """Run 7-gate company analysis pipeline with SSE streaming."""
    model_config = await _resolve_model(req.provider, req.model, user_id=user["user_id"])
    if not model_config:
        raise HTTPException(
            status_code=503,
            detail="未找到可用的 LLM 配置。请在 Admin > Models 中添加 API Key。",
        )

    company_data = await _fetch_and_validate(req.symbol)
    user_id = user.get("user_id", "default")

    queue: asyncio.Queue = asyncio.Queue()

    def emit_progress(event: dict):
        queue.put_nowait(event)

    async def run_pipeline_task():
        analysis_id = None
        try:
            # Emit data_loaded event
            profile = company_data.get("profile", {})
            company_name = profile.get("name", req.symbol)
            cache_meta = company_data.get("_cache_meta", {})

            # Create running record in DB immediately
            analysis_id = await _create_running_analysis(
                user_id, req.symbol, company_name, model_config
            )

            data_loaded_event = {
                "type": "data_loaded",
                "symbol": req.symbol,
                "company_name": company_name,
                "sector": profile.get("sector", ""),
                "industry": profile.get("industry", ""),
                "current_price": company_data.get("price_data", {}).get("current_price", 0),
                "data_freshness": {
                    "cached": cache_meta.get("cached", False),
                    "fetched_at": cache_meta.get("fetched_at", ""),
                },
                "analysis_id": analysis_id,
            }
            queue.put_nowait(data_loaded_event)

            # Wrap on_progress to update DB on gate_complete + publish to Redis
            accumulated_skills: dict = {}

            def tracking_emit(event: dict):
                emit_progress(event)

                # Publish ALL events to Redis for reconnectable streaming
                if analysis_id:
                    asyncio.create_task(task_publish(analysis_id, event))

                if event.get("type") == "gate_complete" and analysis_id and event.get("skill"):
                    gate_num = event.get("gate", 0)
                    gate_data = {
                        "gate": gate_num,
                        "skill": event.get("skill"),
                        "display_name": event.get("display_name"),
                        "parsed": event.get("parsed", {}),
                        "raw": event.get("raw", ""),
                        "parse_status": event.get("parse_status"),
                        "latency_ms": event.get("latency_ms"),
                        "error": event.get("error"),
                    }
                    accumulated_skills[event["skill"]] = gate_data

                    # Persist gate result + update current_gate counter
                    asyncio.create_task(
                        CompanyAnalysisRepository.update_gate(analysis_id, gate_num, gate_data)
                    )
                    # Also update full_report for backward compat
                    skills_snapshot = {k: dict(v) for k, v in accumulated_skills.items()}
                    asyncio.create_task(_update_analysis(analysis_id, {
                        "full_report": {"skills": skills_snapshot},
                    }))

            runner = CompanySkillRunner(model_config, company_data, on_progress=tracking_emit)
            result = await runner.run_pipeline()

            response_data = _build_response(req, company_data, model_config, result)

            # Final update: completed
            if analysis_id:
                response_data["analysis_id"] = analysis_id
                verdict = response_data.get("verdict", {})
                await _update_analysis(analysis_id, {
                    "status": "completed",
                    "full_report": response_data,
                    "verdict_action": verdict.get("action", "WATCH"),
                    "verdict_conviction": float(verdict.get("conviction", 0.5)),
                    "verdict_quality": verdict.get("quality_verdict", "GOOD"),
                    "total_latency_ms": response_data.get("total_latency_ms", 0),
                })

            queue.put_nowait({
                "type": "result",
                "data": response_data,
            })

            # Notify user of analysis completion
            try:
                from uteki.domains.notification.service import get_notification_service
                nsvc = get_notification_service()
                await nsvc.notify_company_complete(
                    user_id=user_id,
                    analysis_id=analysis_id or "",
                    symbol=req.symbol,
                    verdict_action=verdict.get("action", "WATCH"),
                    conviction=float(verdict.get("conviction", 0.5)),
                )
            except Exception:
                logger.warning("Failed to create company notification", exc_info=True)

        except Exception as e:
            logger.error(f"[company] stream error: {e}", exc_info=True)
            if analysis_id:
                await _update_analysis(analysis_id, {
                    "status": "error",
                    "error_message": str(e),
                })
            else:
                # No running record was created, save error as new record
                await _save_analysis(
                    user_id,
                    {"symbol": req.symbol, "company_name": req.symbol},
                    model_config,
                    error_msg=str(e),
                )
            queue.put_nowait({"type": "error", "message": str(e)})

            # Notify user of analysis error
            try:
                from uteki.domains.notification.service import get_notification_service
                nsvc = get_notification_service()
                await nsvc.notify_company_error(
                    user_id=user_id, symbol=req.symbol, error_message=str(e),
                )
            except Exception:
                logger.warning("Failed to create error notification", exc_info=True)
        finally:
            # Signal Redis subscribers that this task is done
            if analysis_id:
                await task_publish_done(analysis_id)
            queue.put_nowait(None)  # sentinel

    async def event_generator():
        task = asyncio.create_task(run_pipeline_task())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        finally:
            # Do NOT cancel the task — let the pipeline continue running
            # so that intermediate gate results keep saving to DB.
            # The frontend will poll GET /analyses/{id} to pick up progress.
            if not task.done():
                logger.info("[company] SSE disconnected, pipeline continues in background")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Task reconnection endpoints
# ---------------------------------------------------------------------------


@router.get("/tasks/running")
async def list_running_tasks(user: dict = Depends(get_current_user)):
    """List all running analyses for the current user (for page-load reconnection)."""
    user_id = user.get("user_id", "default")
    running = await CompanyAnalysisRepository.list_running(user_id)
    return {"tasks": running}


@router.get("/tasks/{analysis_id}/stream")
async def reconnect_task_stream(
    analysis_id: str,
    user: dict = Depends(get_current_user_sse),
):
    """
    Reconnectable SSE endpoint for a running (or completed) analysis.

    Phase 1: Replay completed gate results from DB (with replay=true flag).
    Phase 2: If task is still running, subscribe to Redis Pub/Sub for live events.
    Phase 3: If task is already done, emit final status and close.
    """
    from uteki.common.pubsub import task_subscribe

    task_info = await CompanyAnalysisRepository.get_gate_results(analysis_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator():
        status = task_info.get("status", "running")
        gate_results = task_info.get("gate_results") or {}

        # Phase 1: Replay completed gates
        for gate_num_str in sorted(gate_results.keys(), key=lambda x: int(x)):
            gate_data = gate_results[gate_num_str]
            replay_event = {
                "type": "gate_complete",
                "replay": True,
                **gate_data,
            }
            yield f"data: {json.dumps(replay_event, ensure_ascii=False, default=str)}\n\n"

        # Phase 2: If still running, subscribe to live events
        if status == "running":
            try:
                async for event in task_subscribe(analysis_id):
                    yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            except asyncio.CancelledError:
                pass
            # Re-read status after Redis subscription ends (task may have completed)
            refreshed = await CompanyAnalysisRepository.get_gate_results(analysis_id)
            if refreshed:
                status = refreshed.get("status", status)

        # Phase 3: Emit final status
        if status in ("completed", "error"):
            full = await CompanyAnalysisRepository.get_by_id(analysis_id)
            if full:
                yield f"data: {json.dumps({'type': 'task_status', 'status': status, 'data': full}, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Analysis CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/analyses")
async def list_analyses(
    symbol: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """List analysis records for the current user."""
    user_id = user.get("user_id", "default")
    analyses, total = await CompanyAnalysisRepository.list_by_user(
        user_id, symbol=symbol, skip=skip, limit=limit,
    )
    return {"analyses": analyses, "total": total}


@router.get("/analyses/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    user: dict = Depends(get_current_user),
):
    """Get full analysis detail including the complete report."""
    row = await CompanyAnalysisRepository.get_by_id(analysis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return row


@router.delete("/analyses/{analysis_id}")
async def delete_analysis(
    analysis_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete an analysis record."""
    ok = await CompanyAnalysisRepository.delete(analysis_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {"status": "ok", "id": analysis_id}


@router.delete("/cache/{symbol}")
async def invalidate_cache(
    symbol: str,
    user: dict = Depends(get_current_user),
):
    """Invalidate cached company data for a symbol."""
    await invalidate_company_cache(symbol)
    return {"status": "ok", "symbol": symbol.upper(), "message": f"Cache invalidated for {symbol.upper()}"}


# ---------------------------------------------------------------------------
# Prompt version management
# ---------------------------------------------------------------------------

SKILL_NAMES = {
    1: "business_analysis", 2: "fisher_qa", 3: "moat_assessment",
    4: "management_assessment", 5: "reverse_test", 6: "valuation",
    7: "position_holding",
}


@router.get("/prompts")
async def list_prompts(
    gate: Optional[int] = Query(None, ge=1, le=7),
    user: dict = Depends(get_current_user),
):
    """List prompt versions, optionally filtered by gate number."""
    return await CompanyPromptRepository.list_by_gate(gate)


@router.post("/prompts")
async def create_prompt(
    req: PromptVersionCreate,
    user: dict = Depends(get_current_user),
):
    """Create a new prompt version for a gate."""
    data = req.model_dump()
    data["skill_name"] = SKILL_NAMES.get(req.gate_number, f"gate_{req.gate_number}")
    return await CompanyPromptRepository.create(data)


@router.put("/prompts/{prompt_id}/activate")
async def activate_prompt(
    prompt_id: str,
    user: dict = Depends(get_current_user),
):
    """Set a prompt version as the active one for its gate."""
    result = await CompanyPromptRepository.activate(prompt_id)
    if not result:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    return result


@router.post("/prompts/ab-test")
async def run_ab_test(
    req: ABTestRequest,
    user: dict = Depends(get_current_user),
):
    """Run A/B test comparing two prompt versions on the same symbol."""
    # Load both prompt versions
    prompt_a = await CompanyPromptRepository.get_by_id(req.version_a_id)
    prompt_b = await CompanyPromptRepository.get_by_id(req.version_b_id)
    if not prompt_a or not prompt_b:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    if prompt_a["gate_number"] != req.gate_number or prompt_b["gate_number"] != req.gate_number:
        raise HTTPException(status_code=400, detail="Both prompts must be for the specified gate")

    # Fetch company data once
    company_data = await fetch_company_data(req.symbol)
    if not company_data:
        raise HTTPException(status_code=400, detail=f"Failed to fetch data for {req.symbol}")

    # Resolve model
    model_config = await _resolve_model(None, req.judge_model, user_id=user["user_id"])
    if not model_config:
        raise HTTPException(status_code=503, detail="No model available")

    async def _run_n(prompt_text: str, n: int) -> list[dict]:
        """Run pipeline n times with a specific prompt override."""
        results = []
        overrides = {req.gate_number: prompt_text}
        for i in range(n):
            try:
                runner = CompanySkillRunner(
                    model_config, company_data, prompt_overrides=overrides,
                )
                result = await runner.run_pipeline()
                verdict = result.get("verdict", {})
                results.append({
                    "run": i,
                    "action": verdict.get("action", "WATCH"),
                    "conviction": verdict.get("conviction", 0.5),
                    "quality": verdict.get("quality_verdict", "GOOD"),
                    "latency_ms": result.get("total_latency_ms", 0),
                    "status": "success",
                })
            except Exception as e:
                results.append({"run": i, "status": "error", "error": str(e)})
        return results

    # Run both versions
    results_a, results_b = await asyncio.gather(
        _run_n(prompt_a["system_prompt"], req.runs_per_version),
        _run_n(prompt_b["system_prompt"], req.runs_per_version),
    )

    def _summarize(runs: list[dict]) -> dict:
        successes = [r for r in runs if r["status"] == "success"]
        if not successes:
            return {"success_rate": 0, "runs": runs}
        convictions = [r["conviction"] for r in successes]
        actions = [r["action"] for r in successes]
        from collections import Counter
        action_counts = Counter(actions)
        return {
            "success_rate": len(successes) / len(runs),
            "action_distribution": dict(action_counts),
            "avg_conviction": sum(convictions) / len(convictions),
            "avg_latency_ms": sum(r["latency_ms"] for r in successes) / len(successes),
            "runs": runs,
        }

    return {
        "symbol": req.symbol,
        "gate_number": req.gate_number,
        "version_a": {"id": req.version_a_id, "version": prompt_a["version"], **_summarize(results_a)},
        "version_b": {"id": req.version_b_id, "version": prompt_b["version"], **_summarize(results_b)},
    }


# ---------------------------------------------------------------------------
# Cross-model comparison
# ---------------------------------------------------------------------------

@router.post("/analyze/compare")
async def compare_models(
    req: CompareRequest,
    user: dict = Depends(get_current_user),
):
    """Run analysis with multiple models and return SSE stream with model-tagged events."""
    company_data = await fetch_company_data(req.symbol)
    if not company_data:
        raise HTTPException(status_code=400, detail=f"Failed to fetch data for {req.symbol}")

    queue: asyncio.Queue = asyncio.Queue()

    # Load active prompt overrides
    active_prompts = await CompanyPromptRepository.get_active_prompts()
    prompt_overrides = active_prompts if active_prompts else None

    current_user_id = user["user_id"]

    async def _run_model(model_name: str):
        model_config = await _resolve_model(None, model_name, user_id=current_user_id)
        if not model_config:
            await queue.put({"type": "error", "model": model_name, "error": "Model not available"})
            return

        def on_progress(event: dict):
            event["model"] = model_name
            queue.put_nowait(event)

        try:
            runner = CompanySkillRunner(
                model_config, company_data,
                on_progress=on_progress,
                prompt_overrides=prompt_overrides,
            )
            result = await runner.run_pipeline()
            await queue.put({"type": "result", "model": model_name, "data": result})
        except Exception as e:
            await queue.put({"type": "error", "model": model_name, "error": str(e)})

    async def _run_all():
        tasks = [asyncio.create_task(_run_model(m)) for m in req.models]
        await asyncio.gather(*tasks, return_exceptions=True)
        await queue.put(None)  # sentinel

    asyncio.create_task(_run_all())

    async def event_generator():
        # Send initial data
        profile = company_data.get("profile", {})
        yield f"data: {json.dumps({'type': 'data_loaded', 'models': req.models, 'symbol': req.symbol, 'company_name': profile.get('longName', req.symbol)}, ensure_ascii=False)}\n\n"

        while True:
            event = await queue.get()
            if event is None:
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                break
            try:
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            except Exception:
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Share
# ---------------------------------------------------------------------------

@router.post("/analyses/{analysis_id}/share")
async def create_share_link(
    analysis_id: str,
    user: dict = Depends(get_current_user),
):
    """Generate a shareable link for an analysis."""
    import hashlib
    import secrets
    from datetime import datetime, timezone, timedelta

    row = await CompanyAnalysisRepository.get_by_id(analysis_id)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Reuse existing token if still valid
    if row.get("share_token") and row.get("share_expires_at"):
        return ShareResponse(
            share_url=f"/shared/{row['share_token']}",
            expires_at=row["share_expires_at"],
        ).model_dump()

    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    await CompanyAnalysisRepository.update(analysis_id, {
        "share_token": token,
        "share_expires_at": expires,
    })

    return ShareResponse(
        share_url=f"/shared/{token}",
        expires_at=expires,
    ).model_dump()


@router.get("/shared/{token}")
async def get_shared_analysis(token: str):
    """Public endpoint — view a shared analysis (no auth required)."""
    row = await CompanyAnalysisRepository.get_by_share_token(token)
    if not row:
        raise HTTPException(status_code=404, detail="Shared analysis not found")

    # Check expiry
    from datetime import datetime, timezone
    expires = row.get("share_expires_at")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(expires)
            if exp_dt < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Share link has expired")
        except ValueError:
            pass

    return row


@router.post("/analyses/{analysis_id}/retry")
async def retry_gate(
    analysis_id: str,
    gate: int = Query(..., ge=1, le=7, description="Gate number to retry"),
    user: dict = Depends(get_current_user),
):
    """Retry a single failed gate for an existing analysis."""
    user_id = user.get("user_id", "default")
    analysis = await CompanyAnalysisRepository.get_by_id(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if analysis.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Not your analysis")

    full_report = analysis.get("full_report") or {}
    symbol = analysis.get("symbol", "")
    provider = analysis.get("provider", "")
    model_name = analysis.get("model", "")

    if not full_report:
        raise HTTPException(status_code=400, detail="No report data to retry against")

    model_config = await _resolve_model(provider, model_name, user_id=user_id)
    company_data = await fetch_company_data(symbol)
    if not company_data:
        raise HTTPException(status_code=400, detail=f"Cannot fetch data for {symbol}")

    from .financials import format_company_data_for_prompt
    from .skill_runner import GateExecutor, CompanyToolExecutor
    from .skills import COMPANY_SKILL_PIPELINE
    from uteki.domains.agent.core.context import PipelineContext, GateResult as CtxGateResult
    from uteki.domains.agent.core.budget import ToolBudget
    from .output_parser import parse_skill_output

    target_skill = next((s for s in COMPANY_SKILL_PIPELINE if s.gate_number == gate), None)
    if not target_skill:
        raise HTTPException(status_code=400, detail=f"Gate {gate} not found")

    # Build context with existing gate results
    company_text = format_company_data_for_prompt(company_data)
    context = PipelineContext(company_data_text=company_text)

    for skill in COMPANY_SKILL_PIPELINE:
        if skill.gate_number >= gate:
            break
        existing = full_report.get(skill.skill_name, {})
        if existing and existing.get("raw"):
            context.add_gate_result(CtxGateResult(
                gate_number=skill.gate_number,
                skill_name=skill.skill_name,
                display_name=skill.display_name,
                raw=existing["raw"],
            ))

    tool_executor = CompanyToolExecutor(company_data=company_data)
    executor = GateExecutor(model_config=model_config, tool_executor=tool_executor)

    budget = ToolBudget(
        max_searches=6 if gate < 7 else 0,
        max_rounds=5 if gate < 7 else 1,
        max_tool_calls=10 if gate < 7 else 0,
        timeout_seconds=300 if gate == 7 else 180,
    )

    gate_result = await executor.execute(target_skill, context, budget)

    # Parse the result
    from .schemas import (
        CompanyFullReport, BusinessAnalysisOutput, FisherQAOutput,
        MoatAssessmentOutput, ManagementAssessmentOutput,
        ReverseTestOutput, ValuationOutput,
    )
    _schemas = {
        "business_analysis": BusinessAnalysisOutput,
        "fisher_qa": FisherQAOutput,
        "moat_assessment": MoatAssessmentOutput,
        "management_assessment": ManagementAssessmentOutput,
        "reverse_test": ReverseTestOutput,
        "valuation": ValuationOutput,
    }

    parsed = None
    if gate == 7 and gate_result.raw:
        parsed, _ = parse_skill_output(gate_result.raw, CompanyFullReport)
    elif target_skill.skill_name in _schemas and gate_result.raw:
        parsed, _ = parse_skill_output(gate_result.raw, _schemas[target_skill.skill_name])

    updated_skill = {
        "gate": gate,
        "display_name": target_skill.display_name,
        "parsed": parsed.model_dump() if parsed else {},
        "raw": gate_result.raw,
        "parse_status": gate_result.parse_status,
        "latency_ms": gate_result.latency_ms,
        "retried": True,
    }
    if gate_result.error:
        updated_skill["error"] = gate_result.error

    full_report[target_skill.skill_name] = updated_skill
    await CompanyAnalysisRepository.update(analysis_id, {"full_report": full_report})

    return {"status": "ok", "gate": gate, "result": updated_skill}
