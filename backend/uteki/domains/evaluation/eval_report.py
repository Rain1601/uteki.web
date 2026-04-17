"""
Evaluation domain — Pydantic schemas for the 4-dimension + 5-supplementary eval framework.

See docs/ADR-evaluation-framework.md for the full design rationale.

Usage:
    report = EvalReport(
        skill_name="company.fisher_qa",
        model="claude-sonnet-4",
        skill_version="abc1234",
        consistency=ConsistencyReport(...),
        credibility=CredibilityReport(...),
        logic=LogicReport(...),
        effectiveness=EffectivenessReport(...),
        cost=CostReport(...),
        latency=LatencyReport(...),
    )
    report.overall_status  # → "pass" | "warn" | "fail"
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


# ═══════════════════════════════════════════════════════════════════
# Dimension 1: Consistency
# ═══════════════════════════════════════════════════════════════════


class NumericFieldStability(BaseModel):
    """数值字段跨多次运行的稳定性。"""

    field_path: str = Field(..., description="如 'fisher_qa.total_score'")
    mean: float
    stdev: float
    cv: float = Field(..., description="Coefficient of variation = stdev / mean")
    min_value: float
    max_value: float

    @property
    def passes(self) -> bool:
        return self.cv < 0.10


class CategoricalFieldStability(BaseModel):
    """分类字段跨多次运行的稳定性。"""

    field_path: str = Field(..., description="如 'position_holding.action'")
    mode_value: str
    mode_rate: float = Field(..., ge=0, le=1, description="众数占比")
    cohen_kappa: Optional[float] = Field(None, description="跨 run 一致性 (多 run 两两对比)")
    distribution: dict[str, int] = Field(default_factory=dict)

    @property
    def passes(self) -> bool:
        return self.mode_rate >= 0.80


class ConsistencyReport(BaseModel):
    """
    维度 1: 一致性 — 固定输入下输出稳定。

    前提: 运行时必须 mock_tools + mock_time + pinned_model_version。
    """

    num_runs: int = Field(..., ge=2, description="跑了几次取平均")
    temperature: float = Field(0.0, description="通常 0.0")
    tools_mocked: bool = Field(..., description="是否 mock 了工具返回")
    model_version_pinned: bool = Field(..., description="是否固定了模型版本")

    numeric_fields: list[NumericFieldStability] = Field(default_factory=list)
    categorical_fields: list[CategoricalFieldStability] = Field(default_factory=list)

    tool_call_sequence_levenshtein: Optional[float] = Field(
        None, description="工具调用序列的平均 Levenshtein 距离"
    )
    action_agreement_rate: Optional[float] = Field(
        None, ge=0, le=1, description="最终 action 字段跨 run 一致率"
    )

    cross_session_drift_detected: bool = Field(
        False, description="本次与历史基线是否漂移 (API 侧模型升级告警)"
    )

    @property
    def passes(self) -> bool:
        if not self.tools_mocked or not self.model_version_pinned:
            return False
        numeric_ok = all(f.passes for f in self.numeric_fields)
        categorical_ok = all(f.passes for f in self.categorical_fields)
        action_ok = self.action_agreement_rate is None or self.action_agreement_rate >= 0.80
        return numeric_ok and categorical_ok and action_ok and not self.cross_session_drift_detected


# ═══════════════════════════════════════════════════════════════════
# Dimension 2: Credibility
# ═══════════════════════════════════════════════════════════════════


class NumberTrace(BaseModel):
    """报告中某个数字的溯源结果。"""

    number: str = Field(..., description="原始字面量, e.g. '75.8B'")
    context: str = Field(..., description="周围文本片段")
    source: Literal["financials_input", "tool_result", "third_party", "unverified"]
    source_detail: Optional[str] = Field(None, description="具体来源标识")


class URLValidation(BaseModel):
    url: str
    status_code: Optional[int] = None
    reachable: bool


class CredibilityReport(BaseModel):
    """
    维度 2: 可信度 — 报告中数字、引用都有真实来源。
    """

    total_numbers: int = Field(..., ge=0)
    traced_numbers: int = Field(..., ge=0, description="成功溯源的数字数")
    hallucinated: list[NumberTrace] = Field(
        default_factory=list, description="未找到真实来源的数字列表"
    )

    total_urls: int = Field(0, ge=0)
    unreachable_urls: list[URLValidation] = Field(default_factory=list)

    third_party_mismatches: list[dict] = Field(
        default_factory=list,
        description="关键数字与第三方 (FMP/Yahoo) 差异 >5% 的条目",
    )

    temporal_violations: list[str] = Field(
        default_factory=list,
        description="报告中超出输入数据时间范围的日期/季度引用",
    )

    anti_hallucination_passed: Optional[bool] = Field(
        None,
        description="负向测试: 贫瘠输入是否仍保持 data_confidence='low'",
    )

    @property
    def hallucination_rate(self) -> float:
        if self.total_numbers == 0:
            return 0.0
        return len(self.hallucinated) / self.total_numbers

    @property
    def url_reachability_rate(self) -> float:
        if self.total_urls == 0:
            return 1.0
        return 1.0 - len(self.unreachable_urls) / self.total_urls

    @property
    def passes(self) -> bool:
        return (
            self.hallucination_rate < 0.02
            and self.url_reachability_rate >= 0.95
            and len(self.temporal_violations) == 0
            and (self.anti_hallucination_passed is not False)
        )


# ═══════════════════════════════════════════════════════════════════
# Dimension 3: Logic
# ═══════════════════════════════════════════════════════════════════


class LogicDefect(BaseModel):
    type: Literal[
        "internal_contradiction",
        "evidence_mismatch",
        "cross_skill_contradiction",
        "reasoning_jump",
    ]
    severity: Literal["low", "medium", "high"]
    description: str
    location: Optional[str] = Field(None, description="如 'moat_assessment.moat_width'")
    evidence: Optional[str] = None


class LogicReport(BaseModel):
    """
    维度 3: 逻辑性 — 推理自洽, 证据支撑结论, 无内部矛盾。
    """

    hard_rule_violations: list[LogicDefect] = Field(
        default_factory=list, description="Pydantic validator 或代码规则捕获"
    )
    llm_judge_defects: list[LogicDefect] = Field(
        default_factory=list, description="LLM judge 发现的软性逻辑问题"
    )
    cross_skill_contradictions: list[LogicDefect] = Field(
        default_factory=list, description="Reflection Checker 跨 gate 发现的矛盾"
    )

    adversarial_test_passed: Optional[bool] = Field(
        None, description="对抗性输入 (如收入高增但CF负) 是否识别到对应红旗"
    )

    judge_model: Optional[str] = Field(None, description="LLM judge 使用的模型")
    judge_overall_score: Optional[float] = Field(
        None, ge=0, le=10, description="LLM judge 综合逻辑分"
    )

    @property
    def total_defects(self) -> int:
        return (
            len(self.hard_rule_violations)
            + len(self.llm_judge_defects)
            + len(self.cross_skill_contradictions)
        )

    @property
    def high_severity_count(self) -> int:
        all_defects = (
            self.hard_rule_violations + self.llm_judge_defects + self.cross_skill_contradictions
        )
        return sum(1 for d in all_defects if d.severity == "high")

    @property
    def passes(self) -> bool:
        return (
            self.high_severity_count == 0
            and self.total_defects <= 1
            and (self.adversarial_test_passed is not False)
            and (self.judge_overall_score is None or self.judge_overall_score >= 7.0)
        )


# ═══════════════════════════════════════════════════════════════════
# Dimension 4: Effectiveness
# ═══════════════════════════════════════════════════════════════════


class ExpertAlignment(BaseModel):
    """对齐第三方专家评级（Morningstar / Gurufocus 等）。"""

    source: str
    companies_compared: int
    agreement_rate: float = Field(..., ge=0, le=1)


class TrapDetection(BaseModel):
    """雷股识别能力。"""

    total_traps: int
    detected: int = Field(..., description="action != BUY 的数量")
    false_positives: int = Field(0, description="把非雷股也标 AVOID 的数量")

    @property
    def recall(self) -> float:
        return self.detected / self.total_traps if self.total_traps else 0.0

    @property
    def precision(self) -> float:
        total_flagged = self.detected + self.false_positives
        return self.detected / total_flagged if total_flagged else 0.0


class ForwardTestResult(BaseModel):
    """前瞻性回测结果 (仅使用 model cutoff 之后的数据)。"""

    start_date: datetime
    end_date: datetime
    num_buy_decisions: int
    portfolio_return: float
    benchmark_return: float
    alpha: float = Field(..., description="portfolio_return - benchmark_return")
    sharpe_ratio: Optional[float] = None
    max_drawdown: Optional[float] = None

    @model_validator(mode="after")
    def check_cutoff(self):
        # Forward test 必须在模型 cutoff 之后
        # 实际 cutoff 从 settings 读取, 这里仅做占位校验
        return self


class EffectivenessReport(BaseModel):
    """
    维度 4: 效果 — 推荐是否真能赚钱/避雷。
    """

    expert_alignment: Optional[ExpertAlignment] = None
    trap_detection: Optional[TrapDetection] = None
    forward_test: Optional[ForwardTestResult] = None

    @property
    def passes(self) -> bool:
        checks = []
        if self.expert_alignment:
            checks.append(self.expert_alignment.agreement_rate >= 0.60)
        if self.trap_detection:
            checks.append(self.trap_detection.recall >= 0.80)
            checks.append(self.trap_detection.precision >= 0.90)
        if self.forward_test:
            checks.append(self.forward_test.alpha > 0)
        return all(checks) if checks else False


# ═══════════════════════════════════════════════════════════════════
# Supplementary Dimensions
# ═══════════════════════════════════════════════════════════════════


class CostReport(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    tool_calls: int = 0
    usd_cost: float = 0.0
    target_max_usd: float = 0.15

    @property
    def passes(self) -> bool:
        return self.usd_cost <= self.target_max_usd


class LatencyReport(BaseModel):
    p50_ms: float
    p95_ms: float
    max_ms: float
    target_p95_ms: float = 30_000  # 30s per skill

    @property
    def passes(self) -> bool:
        return self.p95_ms <= self.target_p95_ms


class CoverageBucket(BaseModel):
    label: str = Field(..., description="如 'large_cap_us', 'small_cap_cn', 'loss_making'")
    attempted: int
    completed: int

    @property
    def completion_rate(self) -> float:
        return self.completed / self.attempted if self.attempted else 0.0


class CoverageReport(BaseModel):
    buckets: list[CoverageBucket] = Field(default_factory=list)
    target_completion_rate: float = 0.90

    @property
    def passes(self) -> bool:
        return all(b.completion_rate >= self.target_completion_rate for b in self.buckets)


class SafetyReport(BaseModel):
    prompt_injection_attempts: int = 0
    prompt_injection_successes: int = 0
    sanitization_failures: list[str] = Field(default_factory=list)

    @property
    def passes(self) -> bool:
        return self.prompt_injection_successes == 0 and not self.sanitization_failures


class ExplainabilityReport(BaseModel):
    flesch_readability_score: Optional[float] = None
    user_thumbs_up_rate: Optional[float] = Field(None, ge=0, le=1)
    avg_report_length_chars: Optional[int] = None

    @property
    def passes(self) -> bool:
        # 软指标, 不一票否决; 只在明显差时 warn
        if self.user_thumbs_up_rate is not None and self.user_thumbs_up_rate < 0.5:
            return False
        return True


# ═══════════════════════════════════════════════════════════════════
# Top-level EvalReport
# ═══════════════════════════════════════════════════════════════════


class EvalReport(BaseModel):
    """
    Skill 完整评测报告。

    每个 skill 在每次评测触发 (PR / nightly / weekly) 后产出一份,
    落库到 `eval_reports` 表供 dashboard 查询和趋势分析。
    """

    # — 元信息 ——————————————————————————————————————————————
    skill_name: str = Field(..., description="如 'company.fisher_qa'")
    skill_version: str = Field(..., description="Git SHA 或 SKILL.md hash")
    model: str = Field(..., description="如 'claude-sonnet-4-20250514'")
    model_version_pinned_at: Optional[datetime] = None

    dataset_name: str = Field(..., description="如 'golden_v1', 'trap_set_v2'")
    dataset_size: int = Field(..., ge=1)

    triggered_by: Literal["pr", "nightly", "weekly", "manual"]
    started_at: datetime
    finished_at: datetime

    # — 四主维度 ————————————————————————————————————————————
    consistency: Optional[ConsistencyReport] = None
    credibility: Optional[CredibilityReport] = None
    logic: Optional[LogicReport] = None
    effectiveness: Optional[EffectivenessReport] = None

    # — 五辅助维度 ———————————————————————————————————————————
    cost: Optional[CostReport] = None
    latency: Optional[LatencyReport] = None
    coverage: Optional[CoverageReport] = None
    safety: Optional[SafetyReport] = None
    explainability: Optional[ExplainabilityReport] = None

    # — 汇总 ——————————————————————————————————————————————
    notes: Optional[str] = Field(None, description="人工批注")

    @property
    def dimension_results(self) -> dict[str, Optional[bool]]:
        """每个维度的 pass/fail, None = 本次未评测。"""
        return {
            "consistency": self.consistency.passes if self.consistency else None,
            "credibility": self.credibility.passes if self.credibility else None,
            "logic": self.logic.passes if self.logic else None,
            "effectiveness": self.effectiveness.passes if self.effectiveness else None,
            "cost": self.cost.passes if self.cost else None,
            "latency": self.latency.passes if self.latency else None,
            "coverage": self.coverage.passes if self.coverage else None,
            "safety": self.safety.passes if self.safety else None,
            "explainability": self.explainability.passes if self.explainability else None,
        }

    @property
    def overall_status(self) -> Literal["pass", "warn", "fail"]:
        """
        pass: 所有已评测维度都过
        warn: 辅助维度有失败, 但四主维度都过
        fail: 任何主维度失败, 或 safety 失败
        """
        results = self.dimension_results

        # Safety 和主维度一票否决
        if results["safety"] is False:
            return "fail"
        core = ["consistency", "credibility", "logic", "effectiveness"]
        if any(results[k] is False for k in core):
            return "fail"

        # 辅助维度降为 warn
        aux = ["cost", "latency", "coverage", "explainability"]
        if any(results[k] is False for k in aux):
            return "warn"

        return "pass"


class EvalDiff(BaseModel):
    """
    两次评测的对比 (baseline vs candidate), 用于 PR comment。
    """

    baseline: EvalReport
    candidate: EvalReport

    @property
    def cost_delta_usd(self) -> float:
        b = self.baseline.cost.usd_cost if self.baseline.cost else 0.0
        c = self.candidate.cost.usd_cost if self.candidate.cost else 0.0
        return c - b

    @property
    def latency_delta_ms(self) -> float:
        b = self.baseline.latency.p95_ms if self.baseline.latency else 0.0
        c = self.candidate.latency.p95_ms if self.candidate.latency else 0.0
        return c - b

    @property
    def regressions(self) -> list[str]:
        """列出 baseline 通过但 candidate 失败的维度。"""
        regressed = []
        b_results = self.baseline.dimension_results
        c_results = self.candidate.dimension_results
        for dim in b_results:
            if b_results[dim] is True and c_results[dim] is False:
                regressed.append(dim)
        return regressed
