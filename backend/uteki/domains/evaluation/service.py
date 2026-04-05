"""
Evaluation service — consistency test for Company Agent pipeline.

Runs the same analysis N times and measures output stability.
"""
from __future__ import annotations

import logging
import statistics
import time
from collections import Counter
from typing import Any, Callable, Dict, List, Optional

from uteki.domains.company.financials import fetch_company_data
from uteki.domains.company.skill_runner import CompanySkillRunner
from uteki.domains.evaluation.repository import EvaluationRepository

logger = logging.getLogger(__name__)

# Gate score extraction paths (skill_name → list of (field, type))
_GATE_SCORE_KEYS: Dict[str, List[tuple]] = {
    "business_analysis": [
        ("sustainability_score", float),
        ("business_quality", str),
    ],
    "fisher_qa": [
        ("total_score", float),
        ("growth_verdict", str),
    ],
    "moat_assessment": [
        ("moat_width", str),
        ("moat_trend", str),
        ("moat_durability_years", float),
    ],
    "management_assessment": [
        ("management_score", float),
        ("integrity_score", float),
        ("capital_allocation_score", float),
    ],
    "reverse_test": [
        ("resilience_score", float),
    ],
    "valuation": [
        ("buy_confidence", float),
        ("price_assessment", str),
        ("safety_margin", str),
    ],
}


def _extract_gate_scores(skills: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Extract key scores from each gate's parsed output."""
    scores = {}
    for skill_name, keys in _GATE_SCORE_KEYS.items():
        gate_data = skills.get(skill_name, {})
        parsed = gate_data.get("parsed", {})
        if not parsed:
            continue
        gate_scores = {}
        for field, _ in keys:
            val = parsed.get(field)
            if val is not None:
                gate_scores[field] = val
        if gate_scores:
            scores[skill_name] = gate_scores
    return scores


def _compute_consistency_metrics(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute consistency metrics across N runs."""
    if not runs:
        return {}

    # Action consistency
    actions = [r["action"] for r in runs if r.get("action")]
    action_counter = Counter(actions)
    action_mode = action_counter.most_common(1)[0][0] if action_counter else "UNKNOWN"
    action_agreement = action_counter[action_mode] / len(actions) if actions else 0

    # Conviction stats
    convictions = [r["conviction"] for r in runs if r.get("conviction") is not None]
    conv_mean = statistics.mean(convictions) if convictions else 0
    conv_std = statistics.stdev(convictions) if len(convictions) >= 2 else 0
    conv_range = [min(convictions), max(convictions)] if convictions else [0, 0]

    # Quality consistency
    qualities = [r["quality_verdict"] for r in runs if r.get("quality_verdict")]
    quality_counter = Counter(qualities)
    quality_mode = quality_counter.most_common(1)[0][0] if quality_counter else "UNKNOWN"
    quality_agreement = quality_counter[quality_mode] / len(qualities) if qualities else 0

    # Gate score variance (only for numeric fields)
    gate_variance: Dict[str, Any] = {}
    all_gate_scores = [r.get("gate_scores", {}) for r in runs]

    # Collect all numeric fields across all runs
    numeric_fields: Dict[str, List[float]] = {}
    for gs in all_gate_scores:
        for skill_name, fields in gs.items():
            for field, val in fields.items():
                if isinstance(val, (int, float)):
                    key = f"{skill_name}.{field}"
                    numeric_fields.setdefault(key, []).append(float(val))

    for key, values in numeric_fields.items():
        if len(values) >= 2:
            gate_variance[key] = {
                "mean": round(statistics.mean(values), 2),
                "std": round(statistics.stdev(values), 2),
                "min": round(min(values), 2),
                "max": round(max(values), 2),
            }

    # Categorical field consistency
    categorical_fields: Dict[str, List[str]] = {}
    for gs in all_gate_scores:
        for skill_name, fields in gs.items():
            for field, val in fields.items():
                if isinstance(val, str):
                    key = f"{skill_name}.{field}"
                    categorical_fields.setdefault(key, []).append(val)

    categorical_agreement: Dict[str, Any] = {}
    for key, values in categorical_fields.items():
        counter = Counter(values)
        mode = counter.most_common(1)[0][0]
        categorical_agreement[key] = {
            "mode": mode,
            "agreement": round(counter[mode] / len(values), 2),
            "distribution": dict(counter),
        }

    return {
        "action_mode": action_mode,
        "action_distribution": dict(action_counter),
        "action_agreement_rate": round(action_agreement, 3),
        "conviction_mean": round(conv_mean, 3),
        "conviction_std": round(conv_std, 3),
        "conviction_range": [round(v, 3) for v in conv_range],
        "quality_mode": quality_mode,
        "quality_agreement_rate": round(quality_agreement, 3),
        "gate_score_variance": gate_variance,
        "categorical_agreement": categorical_agreement,
        "num_successful_runs": len(runs),
    }


async def run_consistency_test(
    symbol: str,
    num_runs: int,
    model_config: Dict[str, Any],
    on_progress: Optional[Callable[[dict], Any]] = None,
) -> Dict[str, Any]:
    """Run N analyses of the same symbol and compute consistency metrics.

    Args:
        symbol: Stock symbol (e.g. "AAPL")
        num_runs: Number of pipeline executions
        model_config: {provider, model, api_key, base_url}
        on_progress: SSE event callback

    Returns:
        {evaluation_id, runs_data, metrics, total_latency_ms}
    """

    def emit(event: dict):
        if on_progress:
            try:
                on_progress(event)
            except Exception as e:
                logger.warning(f"[eval] progress emit error: {e}")

    total_start = time.time()

    # Emit test start
    emit({
        "type": "test_start",
        "symbol": symbol,
        "num_runs": num_runs,
        "model": model_config.get("model", ""),
    })

    # Create evaluation record
    eval_record = await EvaluationRepository.create({
        "test_type": "consistency",
        "symbol": symbol.upper(),
        "num_runs": num_runs,
        "model": model_config.get("model", ""),
        "status": "running",
        "runs_data": [],
        "metrics": {},
    })
    eval_id = eval_record["id"]

    # Fetch company data once (shared across runs)
    company_data = await fetch_company_data(symbol)
    if "error" in company_data:
        await EvaluationRepository.update(eval_id, {
            "status": "error",
            "error_message": f"Failed to fetch data for {symbol}: {company_data['error']}",
        })
        emit({"type": "error", "message": f"Data fetch failed: {company_data['error']}"})
        return eval_record

    runs_data: List[Dict[str, Any]] = []

    for i in range(num_runs):
        run_start = time.time()
        emit({"type": "run_start", "run_index": i, "total": num_runs})

        try:
            # Progress callback for gate-level events
            def gate_progress(event, run_idx=i):
                if event.get("type") == "gate_complete":
                    emit({
                        "type": "run_gate_complete",
                        "run_index": run_idx,
                        "gate": event.get("gate"),
                        "skill": event.get("skill"),
                        "status": event.get("parse_status", "unknown"),
                    })

            runner = CompanySkillRunner(model_config, company_data, on_progress=gate_progress)
            result = await runner.run_pipeline()

            run_latency = int((time.time() - run_start) * 1000)

            # Extract verdict
            verdict = result.get("verdict", {})
            action = verdict.get("action", "UNKNOWN")
            conviction = verdict.get("conviction", 0)
            quality = verdict.get("quality_verdict", "UNKNOWN")

            # Extract gate scores
            gate_scores = _extract_gate_scores(result.get("skills", {}))

            run_record = {
                "run_index": i,
                "action": action,
                "conviction": conviction,
                "quality_verdict": quality,
                "gate_scores": gate_scores,
                "latency_ms": run_latency,
                "status": "success",
            }
            runs_data.append(run_record)

            emit({
                "type": "run_complete",
                "run_index": i,
                "action": action,
                "conviction": conviction,
                "quality": quality,
                "latency_ms": run_latency,
            })

        except Exception as e:
            run_latency = int((time.time() - run_start) * 1000)
            logger.error(f"[eval] run {i} failed: {e}", exc_info=True)
            runs_data.append({
                "run_index": i,
                "status": "error",
                "error": str(e),
                "latency_ms": run_latency,
            })
            emit({
                "type": "run_complete",
                "run_index": i,
                "action": "ERROR",
                "conviction": 0,
                "quality": "ERROR",
                "latency_ms": run_latency,
            })

        # Incremental DB update
        await EvaluationRepository.update(eval_id, {"runs_data": runs_data})

    # Compute metrics
    emit({"type": "computing_metrics"})
    successful_runs = [r for r in runs_data if r.get("status") == "success"]
    metrics = _compute_consistency_metrics(successful_runs)

    total_latency = int((time.time() - total_start) * 1000)

    # Final update
    final_data = {
        "status": "completed",
        "runs_data": runs_data,
        "metrics": metrics,
        "total_latency_ms": total_latency,
    }
    await EvaluationRepository.update(eval_id, final_data)

    result = {
        "evaluation_id": eval_id,
        "test_type": "consistency",
        "symbol": symbol.upper(),
        "model": model_config.get("model", ""),
        "num_runs": num_runs,
        "runs_data": runs_data,
        "metrics": metrics,
        "total_latency_ms": total_latency,
    }

    emit({"type": "result", "data": result})
    return result
