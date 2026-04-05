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


# ═══════════════════════════════════════════════════════════════════════════
# LLM-as-Judge — Gate Quality Scorer
# ═══════════════════════════════════════════════════════════════════════════

# Gates to judge (most critical for quality assessment)
JUDGE_GATES = {
    1: "business_analysis",
    3: "moat_assessment",
    5: "reverse_test",
    7: "final_verdict",
}

_JUDGE_SYSTEM_PROMPT = """你是一名投资分析质量审计员。你的任务是评估一段投资分析报告的质量。

你将收到：
1. 待评分的分析报告（某个分析维度的输出）
2. 该公司的实际财务数据（yfinance 基准数据）
3. 分析师原始任务要求（system prompt）

【重要】你必须先逐条列出问题和扣分理由，然后再给出分数。不要先给分数再找理由。

【评分维度】（每项 1-10 分）

A. 事实准确性 (accuracy)
- 10分：所有引用的数据与实际数据完全一致
- 7-9分：大部分数据准确，有少量四舍五入差异
- 4-6分：有明显的数据错误或编造
- 1-3分：大量数据与实际不符或完全编造

B. 分析深度 (depth)
- 10分：完全覆盖任务要求的所有分析维度，有独到见解
- 7-9分：覆盖了大部分维度，分析有一定深度
- 4-6分：分析较浅，遗漏了部分重要维度
- 1-3分：严重不足，只是泛泛而谈

C. 内部一致性 (consistency)
- 10分：结论与数据完全自洽，逻辑严密
- 7-9分：基本自洽，有轻微不一致
- 4-6分：存在明显的逻辑矛盾
- 1-3分：结论与数据严重矛盾

【输出格式】
输出一个 JSON 对象，以 { 开始、以 } 结束，不含 markdown 标记：
{
  "deductions": [
    {"dimension": "A/B/C", "issue": "具体问题描述", "severity": "minor/major/critical"}
  ],
  "scores": {
    "accuracy": N,
    "depth": N,
    "consistency": N
  },
  "overall": N,
  "summary": "一句话总评"
}"""

_JUDGE_USER_TEMPLATE = """请评估以下投资分析报告的质量。

═══ 分析报告（Gate {gate_number}: {gate_name}）═══
{report_text}

═══ 实际财务数据（yfinance 基准）═══
{financial_data}

═══ 分析师原始任务要求 ═══
{task_prompt}"""


async def judge_analysis(
    analysis_id: str,
    judge_model: str = "deepseek-chat",
) -> Dict[str, Any]:
    """Judge the quality of a completed company analysis.

    Evaluates G1/G3/G5/G7 using an independent LLM judge.

    Returns:
        {analysis_id, symbol, scores: [{gate, skill, accuracy, depth, consistency, overall, deductions}], summary}
    """
    import asyncio
    import json
    import re

    from uteki.domains.company.repository import CompanyAnalysisRepository
    from uteki.domains.company.financials import format_company_data_for_prompt
    from uteki.domains.company.skills import COMPANY_SKILL_PIPELINE
    from uteki.domains.agent.llm_adapter import LLMAdapterFactory, LLMConfig, LLMMessage
    from uteki.domains.evaluation.repository import GateScoreRepository

    # 1. Load the analysis
    analysis = await CompanyAnalysisRepository.get_by_id(analysis_id)
    if not analysis:
        raise ValueError(f"Analysis {analysis_id} not found")
    if analysis.get("status") != "completed":
        raise ValueError(f"Analysis {analysis_id} is not completed (status={analysis.get('status')})")

    full_report = analysis.get("full_report", {})
    skills = full_report.get("skills", {})
    symbol = analysis.get("symbol", "")

    # 2. Fetch fresh financial data as ground truth
    company_data = await fetch_company_data(symbol)
    financial_text = format_company_data_for_prompt(company_data)[:4000]  # truncate for judge context

    # 3. Build skill prompt lookup
    skill_prompts = {}
    for skill in COMPANY_SKILL_PIPELINE:
        skill_prompts[skill.skill_name] = skill.system_prompt[:1000]  # truncate

    # 4. Create judge adapter
    adapter = LLMAdapterFactory.create_unified(
        model=judge_model,
        config=LLMConfig(temperature=0, max_tokens=2000),
    )

    # 5. Judge each gate
    gate_scores = []

    for gate_num, skill_name in JUDGE_GATES.items():
        gate_data = skills.get(skill_name, {})
        raw_text = gate_data.get("raw", "")

        if not raw_text:
            logger.warning(f"[judge] gate {gate_num} ({skill_name}) has no raw output, skipping")
            continue

        # Build gate name
        gate_name = gate_data.get("display_name", skill_name)

        # Build judge prompt
        user_msg = _JUDGE_USER_TEMPLATE.format(
            gate_number=gate_num,
            gate_name=gate_name,
            report_text=raw_text[:3000],
            financial_data=financial_text,
            task_prompt=skill_prompts.get(skill_name, "(not available)")
        )

        try:
            messages = [
                LLMMessage(role="system", content=_JUDGE_SYSTEM_PROMPT),
                LLMMessage(role="user", content=user_msg),
            ]

            result_text = ""
            async for chunk in adapter.chat(messages, stream=False):
                result_text += chunk

            # Parse JSON from judge output
            json_match = re.search(r'\{[\s\S]*\}', result_text)
            if json_match:
                judge_result = json.loads(json_match.group(0))
            else:
                logger.warning(f"[judge] gate {gate_num} failed to parse JSON, raw: {result_text[:200]}")
                judge_result = {
                    "deductions": [],
                    "scores": {"accuracy": 5, "depth": 5, "consistency": 5},
                    "overall": 5,
                    "summary": "Judge output parsing failed",
                }

            scores = judge_result.get("scores", {})
            accuracy = float(scores.get("accuracy", 5))
            depth = float(scores.get("depth", 5))
            consistency = float(scores.get("consistency", 5))
            overall = float(judge_result.get("overall", (accuracy + depth + consistency) / 3))
            deductions = judge_result.get("deductions", [])
            summary = judge_result.get("summary", "")

            # Save to DB
            score_record = await GateScoreRepository.create({
                "analysis_id": analysis_id,
                "gate_number": gate_num,
                "skill_name": skill_name,
                "judge_model": judge_model,
                "accuracy_score": accuracy,
                "depth_score": depth,
                "consistency_score": consistency,
                "overall_score": overall,
                "deductions": deductions,
                "judge_reasoning": result_text,
            })

            gate_scores.append({
                "gate": gate_num,
                "skill": skill_name,
                "gate_name": gate_name,
                "accuracy": accuracy,
                "depth": depth,
                "consistency": consistency,
                "overall": overall,
                "deductions": deductions,
                "summary": summary,
            })

            logger.info(f"[judge] gate {gate_num} ({skill_name}): accuracy={accuracy} depth={depth} consistency={consistency} overall={overall}")

        except Exception as e:
            logger.error(f"[judge] gate {gate_num} ({skill_name}) failed: {e}", exc_info=True)
            gate_scores.append({
                "gate": gate_num,
                "skill": skill_name,
                "gate_name": gate_name,
                "error": str(e),
            })

    # 6. Compute aggregate
    scored_gates = [g for g in gate_scores if "overall" in g]
    avg_accuracy = statistics.mean([g["accuracy"] for g in scored_gates]) if scored_gates else 0
    avg_depth = statistics.mean([g["depth"] for g in scored_gates]) if scored_gates else 0
    avg_consistency = statistics.mean([g["consistency"] for g in scored_gates]) if scored_gates else 0
    avg_overall = statistics.mean([g["overall"] for g in scored_gates]) if scored_gates else 0

    return {
        "analysis_id": analysis_id,
        "symbol": symbol,
        "judge_model": judge_model,
        "gates_judged": len(scored_gates),
        "scores": gate_scores,
        "aggregate": {
            "accuracy": round(avg_accuracy, 1),
            "depth": round(avg_depth, 1),
            "consistency": round(avg_consistency, 1),
            "overall": round(avg_overall, 1),
        },
    }
