"""
Evaluation API — endpoints for agent quality testing.

POST /api/evaluation/consistency-test       — SSE streaming consistency test
GET  /api/evaluation/runs                   — list evaluation runs
GET  /api/evaluation/runs/{id}              — get run detail
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import StreamingResponse

from uteki.common.config import settings
from uteki.domains.auth.deps import get_current_user
from uteki.domains.evaluation.schemas import ConsistencyTestRequest, JudgeRequest
from uteki.domains.evaluation.repository import EvaluationRepository, GateScoreRepository
from uteki.domains.evaluation.service import run_consistency_test, judge_analysis

logger = logging.getLogger(__name__)
router = APIRouter()


async def _resolve_model(
    model_override: Optional[str] = None, user_id: Optional[str] = None,
) -> Optional[dict]:
    """Resolve model config — DB-first (user-scoped aggregator) then env fallback."""
    from uteki.domains.admin.aggregator_service import resolve_unified_provider

    resolved = await resolve_unified_provider(user_id=user_id)
    if resolved:
        _agg, api_key, base_url = resolved
        return {
            "provider": "openai",
            "model": model_override or "deepseek-chat",
            "api_key": api_key,
            "base_url": base_url,
        }

    # Final fallback: provider-specific env keys (legacy)
    for attr, model_name in [
        ("deepseek_api_key", "deepseek-chat"),
        ("openai_api_key", "gpt-4.1"),
        ("anthropic_api_key", "claude-sonnet-4-20250514"),
    ]:
        key = getattr(settings, attr, None)
        if key:
            return {
                "provider": attr.replace("_api_key", ""),
                "model": model_override or model_name,
                "api_key": key,
            }
    return None


@router.post("/consistency-test")
async def consistency_test_stream(
    req: ConsistencyTestRequest,
    user: dict = Depends(get_current_user),
):
    """Run N analyses of the same symbol and measure output consistency. SSE streaming."""
    model_config = await _resolve_model(req.model, user_id=user["user_id"])
    if not model_config:
        raise HTTPException(status_code=503, detail="No LLM model configured.")

    queue: asyncio.Queue = asyncio.Queue()

    def emit_progress(event: dict):
        queue.put_nowait(event)

    async def run_task():
        try:
            await run_consistency_test(
                symbol=req.symbol,
                num_runs=req.num_runs,
                model_config=model_config,
                on_progress=emit_progress,
            )
        except Exception as e:
            logger.error(f"[eval] consistency test error: {e}", exc_info=True)
            queue.put_nowait({"type": "error", "message": str(e)})
        finally:
            queue.put_nowait(None)  # sentinel

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
                logger.info("[eval] SSE disconnected, task continues in background")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/runs")
async def list_runs(
    test_type: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List evaluation runs."""
    runs, total = await EvaluationRepository.list_runs(
        test_type=test_type, symbol=symbol, skip=skip, limit=limit,
    )
    return {"runs": runs, "total": total}


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    """Get evaluation run detail."""
    row = await EvaluationRepository.get_by_id(run_id)
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation run not found")
    return row


@router.post("/judge/{analysis_id}")
async def judge_gate_quality(analysis_id: str, req: JudgeRequest = JudgeRequest()):
    """LLM-as-Judge: evaluate gate output quality for a completed analysis.

    Judges G1/G3/G5/G7 on: accuracy, depth, consistency.
    Scores each 1-10, with deduction reasoning (anti position-bias).
    """
    try:
        result = await judge_analysis(
            analysis_id=analysis_id,
            judge_model=req.judge_model or "deepseek-chat",
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[eval] judge failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/judge/{analysis_id}/scores")
async def get_judge_scores(analysis_id: str):
    """Get saved judge scores for an analysis."""
    scores = await GateScoreRepository.get_by_analysis(analysis_id)
    return {"analysis_id": analysis_id, "scores": scores}


@router.get("/company/dashboard")
async def company_quality_dashboard(
    symbol: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
):
    """Aggregate gate quality scores across analyses for dashboard visualization.

    Returns per-gate average scores and recent evaluations.
    """
    scores = await GateScoreRepository.get_dashboard_data(symbol=symbol, limit=limit)
    return scores
