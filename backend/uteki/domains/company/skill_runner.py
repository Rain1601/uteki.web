"""
Company Investment Analysis — 7-Gate Decision Tree Pipeline (ReAct Architecture)

Architecture:
- Gates 1-6: ReAct loop (Think → Act → Observe → Conclude) with tool budget
- Gate 7:    读取全部 6 份分析报告 → 投资裁决 + 全量结构化 JSON
- Orchestrator: manages gate flow, reflection checkpoints, context accumulation

Supports:
- Dynamic tool use with budget constraints
- <conclude> tag for agent-driven termination
- Cross-gate reflection at checkpoints (Gate 3, Gate 5)
- on_progress callback for SSE streaming
- Backward-compatible output format
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Callable, Optional

from uteki.domains.agent.llm_adapter import (
    LLMAdapterFactory, LLMProvider, LLMConfig, LLMMessage,
)
from uteki.domains.agent.core.budget import ToolBudget
from uteki.domains.agent.core.tool_parser import ToolCallParser, ParsedToolCall
from uteki.domains.agent.core.context import (
    GateResult, PipelineContext, ToolAction, Reflection,
)
from uteki.common.config import settings
from .skills import (
    COMPANY_SKILL_PIPELINE, CompanySkill,
    REFLECTION_CHECKPOINTS, GATE_TOOLS,
)
from .schemas import (
    CompanyFullReport, PositionHoldingOutput,
    BusinessAnalysisOutput, FisherQAOutput, MoatAssessmentOutput,
    ManagementAssessmentOutput, ReverseTestOutput, ValuationOutput,
)
from .output_parser import parse_skill_output
from .financials import format_company_data_for_prompt

# Per-gate schema mapping for instant structuring
_GATE_SCHEMAS: dict[str, type] = {
    "business_analysis": BusinessAnalysisOutput,
    "fisher_qa": FisherQAOutput,
    "moat_assessment": MoatAssessmentOutput,
    "management_assessment": ManagementAssessmentOutput,
    "reverse_test": ReverseTestOutput,
    "valuation": ValuationOutput,
}

_STRUCTURIZE_PROMPT = """你是一个数据结构化专家。从以下分析文本中提取关键信息，输出一个 JSON 对象。

分析文本：
{raw_text}

要求输出的 JSON schema（所有字段都需要填写，缺失数据用默认值）：
{schema_hint}

规则：
1. 直接输出 JSON，不要加任何解释
2. 所有字符串值使用中文
3. 从原文中提取数据，不要编造
4. 以 {{ 开始，以 }} 结束"""

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────

GATE_TIMEOUT = 180          # seconds per gate (ReAct loop budget)
GATE_TIMEOUT_GATE7 = 300    # Gate 7 reads all 6 reports + generates JSON
REFLECTION_TIMEOUT = 60     # seconds per reflection checkpoint
TOOL_TIMEOUT = 15           # seconds per tool execution

# ReAct budget defaults per gate
DEFAULT_BUDGET = ToolBudget(max_searches=6, max_rounds=5, max_tool_calls=10, timeout_seconds=GATE_TIMEOUT)
GATE7_BUDGET = ToolBudget(max_searches=0, max_rounds=1, max_tool_calls=0, timeout_seconds=GATE_TIMEOUT_GATE7)

_STREAM_CHUNK_SIZE = 80     # chars before emitting gate_text SSE event

# ── Provider Map ──────────────────────────────────────────────────────────

_PROVIDER_MAP = {
    "anthropic": LLMProvider.ANTHROPIC,
    "openai":    LLMProvider.OPENAI,
    "deepseek":  LLMProvider.DEEPSEEK,
    "google":    LLMProvider.GOOGLE,
    "qwen":      LLMProvider.QWEN,
    "minimax":   LLMProvider.MINIMAX,
    "doubao":    LLMProvider.DOUBAO,
}


# ── Tool Executor ─────────────────────────────────────────────────────────

class CompanyToolExecutor:
    """Executes tools available to the company analysis pipeline."""

    def __init__(self, company_data: dict | None = None):
        self._web_search = None
        self._company_data = company_data or {}

    def _get_web_search(self):
        if self._web_search is None:
            from uteki.domains.agent.research.web_search import get_web_search_service
            self._web_search = get_web_search_service()
        return self._web_search

    async def execute(self, tool_name: str, args: dict) -> str:
        if tool_name == "web_search":
            return await self._exec_web_search(args)
        if tool_name == "compare_peers":
            return await self._exec_compare_peers(args)
        return f"Error: unknown tool '{tool_name}'"

    async def _exec_web_search(self, args: dict) -> str:
        query = args.get("query", "")
        if not query:
            return "Error: empty search query"
        try:
            svc = self._get_web_search()
            if not svc.available:
                return "Error: web search service not configured (missing API keys)"
            results = await asyncio.wait_for(
                svc.search(query, max_results=5),
                timeout=TOOL_TIMEOUT,
            )
            if not results:
                return f"No results found for: {query}"
            lines = []
            for r in results:
                lines.append(f"- {r['title']}: {r['snippet']} ({r['url']})")
            return "\n".join(lines)
        except asyncio.TimeoutError:
            return f"Error: search timeout for: {query}"
        except Exception as e:
            logger.warning(f"[company_tools] web_search failed: {e}")
            return f"Error: search failed: {e}"

    async def _exec_compare_peers(self, args: dict) -> str:
        """Compare the target company with industry peers on key metrics."""
        metrics = args.get("metrics", ["roe", "gross_margin", "revenue_growth"])
        # LLMs sometimes pass metrics as a JSON string instead of a list
        if isinstance(metrics, str):
            try:
                metrics = json.loads(metrics)
            except (json.JSONDecodeError, ValueError):
                metrics = [m.strip().strip("'\"") for m in metrics.strip("[]").split(",") if m.strip()]
        if not metrics:
            return "Error: no metrics specified"

        profile = self._company_data.get("profile", {})
        symbol = profile.get("symbol", "")
        industry = profile.get("industry", "Unknown")

        # Gather target company data
        profitability = self._company_data.get("profitability", {})
        growth = self._company_data.get("growth", {})
        balance = self._company_data.get("balance", {})
        derived = self._company_data.get("derived", {})
        price_data = self._company_data.get("price_data", {})

        metric_map = {
            "roe": ("ROE", profitability.get("roe")),
            "roa": ("ROA", profitability.get("roa")),
            "gross_margin": ("毛利率", profitability.get("gross_margin")),
            "operating_margin": ("营业利润率", profitability.get("operating_margin")),
            "net_margin": ("净利率", profitability.get("profit_margin")),
            "revenue_growth": ("营收增速", growth.get("revenue_growth_yoy")),
            "debt_to_equity": ("资产负债率", balance.get("debt_equity")),
            "current_ratio": ("流动比率", balance.get("current_ratio")),
            "fcf_margin": ("FCF利润率", None),
            "pe_ratio": ("PE", None),
        }

        # Calculate FCF margin
        fcf = derived.get("free_cashflow")
        # Try to get revenue from income history
        income_history = self._company_data.get("income_history", [])
        latest_revenue = None
        if income_history:
            latest = income_history[-1] if isinstance(income_history, list) else None
            if latest and isinstance(latest, dict):
                latest_revenue = latest.get("revenue")
        if fcf and latest_revenue and latest_revenue > 0:
            metric_map["fcf_margin"] = ("FCF利润率", fcf / latest_revenue)

        # Build target company metrics
        lines = [f"## {symbol} ({industry}) 关键指标"]
        target_values = {}
        for m in metrics:
            label, val = metric_map.get(m, (m, None))
            target_values[m] = val
            if val is not None:
                if m in ("roe", "roa", "gross_margin", "operating_margin", "net_margin",
                         "revenue_growth", "fcf_margin"):
                    lines.append(f"- {label}: {val:.1%}")
                else:
                    lines.append(f"- {label}: {val:.2f}")
            else:
                lines.append(f"- {label}: [数据缺失]")

        # Try to fetch peer data via yfinance
        try:
            import yfinance as yf
            ticker = yf.Ticker(symbol)
            # Some tickers don't have industry peers — search by industry instead
            peers = []
            # Try getting recommendations/peers if available
            try:
                # yfinance may or may not have peer info depending on version
                raw_peers = getattr(ticker, 'recommendations', None)
                if hasattr(ticker, 'get_recommendations'):
                    pass  # Not all versions support this
            except Exception:
                pass

            # Fallback: use sector/industry to find 3-5 comparable companies
            # We'll use web search as the primary peer discovery method
            svc = self._get_web_search()
            if svc.available:
                search_results = await asyncio.wait_for(
                    svc.search(f"{symbol} competitors peer companies {industry}", max_results=3),
                    timeout=TOOL_TIMEOUT,
                )
                if search_results:
                    lines.append(f"\n## 行业竞争对手参考")
                    for r in search_results:
                        lines.append(f"- {r['title']}: {r['snippet']}")

        except Exception as e:
            logger.warning(f"[compare_peers] peer lookup failed: {e}")
            lines.append(f"\n(同行对比数据获取失败: {e})")

        return "\n".join(lines)


# ── Gate Executor (ReAct Loop) ────────────────────────────────────────────

class GateExecutor:
    """Executes a single gate using the ReAct pattern.

    Think → Act → Observe → (repeat or Conclude)
    """

    def __init__(
        self,
        model_config: dict,
        tool_executor: CompanyToolExecutor,
        tool_parser: ToolCallParser,
    ):
        self.model_config = model_config
        self.tool_executor = tool_executor
        self.tool_parser = tool_parser
        self._adapter = None

    def _get_adapter(self, max_tokens: int = 8192, json_mode: bool = False):
        provider_name = self.model_config["provider"]
        provider = _PROVIDER_MAP.get(provider_name)
        if not provider:
            raise ValueError(f"Unsupported provider: {provider_name}")

        base_url = self.model_config.get("base_url")
        if provider_name == "google" and not base_url:
            base_url = getattr(settings, "google_api_base_url", None)

        # json_mode: supported by OpenAI-compatible providers (not Anthropic)
        use_json_mode = json_mode and provider_name != "anthropic"

        return LLMAdapterFactory.create_adapter(
            provider=provider,
            api_key=self.model_config["api_key"],
            model=self.model_config["model"],
            config=LLMConfig(
                temperature=0, max_tokens=max_tokens, json_mode=use_json_mode
            ),
            base_url=base_url,
        )

    async def execute(
        self,
        skill: CompanySkill,
        context: PipelineContext,
        budget: ToolBudget,
        on_progress: Optional[Callable[[dict], Any]] = None,
    ) -> GateResult:
        """Execute a gate with ReAct loop."""
        budget.start()
        start_time = time.time()

        if skill.gate_number == 7:
            return await self._execute_gate7(skill, context, budget, on_progress)

        return await self._execute_react(skill, context, budget, on_progress, start_time)

    async def _execute_react(
        self,
        skill: CompanySkill,
        context: PipelineContext,
        budget: ToolBudget,
        on_progress: Optional[Callable],
        start_time: float,
    ) -> GateResult:
        """ReAct loop for gates 1-6."""
        adapter = self._get_adapter()
        user_msg = self._build_user_message(skill, context)
        messages = [
            LLMMessage(role="system", content=skill.system_prompt),
            LLMMessage(role="user", content=user_msg),
        ]
        actions: list[ToolAction] = []
        tool_warnings: list[str] = []
        # Accumulate all non-tool-call text across rounds for richer output
        all_analysis_text: list[str] = []

        while budget.can_continue_round():
            budget.record_round()
            raw = ""
            _pending_text = ""

            async def _collect():
                nonlocal raw, _pending_text
                async for chunk in adapter.chat(messages, stream=True):
                    raw += chunk
                    _pending_text += chunk
                    if on_progress and len(_pending_text) >= _STREAM_CHUNK_SIZE:
                        on_progress({
                            "type": "gate_text",
                            "gate": skill.gate_number,
                            "skill": skill.skill_name,
                            "text": _pending_text,
                        })
                        _pending_text = ""
                if on_progress and _pending_text:
                    on_progress({
                        "type": "gate_text",
                        "gate": skill.gate_number,
                        "skill": skill.skill_name,
                        "text": _pending_text,
                    })
                    _pending_text = ""

            remaining = budget.timeout_seconds - budget.elapsed_seconds
            if remaining <= 0:
                break
            await asyncio.wait_for(_collect(), timeout=max(remaining, 5))

            # Check for conclusion
            conclusion = self.tool_parser.parse_conclusion(raw)
            if conclusion:
                latency = int((time.time() - start_time) * 1000)
                eff = round(sum(1 for a in actions if a.result_length > 100) / len(actions), 2) if actions else None
                return GateResult(
                    gate_number=skill.gate_number,
                    skill_name=skill.skill_name,
                    display_name=skill.display_name,
                    raw=conclusion.text,
                    core_conclusion=conclusion.core_conclusion,
                    key_findings=conclusion.key_findings or [],
                    confidence=conclusion.confidence,
                    actions=actions,
                    rounds=budget.rounds_used,
                    latency_ms=latency,
                    parse_status="text",
                    tool_efficiency_score=eff,
                    tool_warnings=tool_warnings,
                )

            # Check for tool call
            tool_call = self.tool_parser.parse_tool_call(raw)
            if not tool_call:
                # No tool call and no conclude tag — treat as implicit conclusion
                # Use the last round's full text as the primary output
                all_analysis_text.append(raw)
                break

            # Strip tool_call XML from text before accumulating analysis content
            analysis_before_tool = re.sub(
                r'<tool_call>.*?</tool_call>', '', raw, flags=re.DOTALL
            ).strip()
            if analysis_before_tool:
                all_analysis_text.append(analysis_before_tool)

            # Validate tool is allowed for this gate
            if tool_call.name not in GATE_TOOLS.get(skill.gate_number, []):
                logger.warning(
                    f"[gate_executor] gate {skill.gate_number} tried disallowed tool: {tool_call.name}"
                )
                break

            # Check budget
            if tool_call.name == "web_search" and not budget.can_search():
                logger.info(f"[gate_executor] search budget exhausted for gate {skill.gate_number}")
                messages.append(LLMMessage(role="assistant", content=raw))
                messages.append(LLMMessage(
                    role="user",
                    content="工具调用预算已用完，请基于已有信息直接得出结论。请用 <conclude> 标签包裹你的最终分析。",
                ))
                continue

            # Execute tool
            logger.info(
                f"[gate_executor] gate={skill.gate_number} round={budget.rounds_used} "
                f"{tool_call.name}({tool_call.arguments})"
            )
            if on_progress:
                on_progress({
                    "type": "tool_call",
                    "gate": skill.gate_number,
                    "skill": skill.skill_name,
                    "tool_name": tool_call.name,
                    "tool_args": tool_call.arguments,
                    "round": budget.rounds_used,
                })

            tool_result = await self.tool_executor.execute(tool_call.name, tool_call.arguments)
            tool_failed = tool_result.startswith("Error:") or tool_result.startswith("No results")

            if tool_failed and on_progress:
                on_progress({
                    "type": "tool_warning",
                    "gate": skill.gate_number,
                    "skill": skill.skill_name,
                    "tool_name": tool_call.name,
                    "warning": tool_result[:200],
                    "round": budget.rounds_used,
                })
            if tool_failed:
                tool_warnings.append(
                    f"Gate {skill.gate_number} {tool_call.name}: {tool_result[:100]}"
                )

            if tool_call.name == "web_search":
                budget.record_search()
            else:
                budget.record_tool_call()

            actions.append(ToolAction(
                tool_name=tool_call.name,
                tool_args=tool_call.arguments,
                result=tool_result[:500],
                round_num=budget.rounds_used,
                search_query=tool_call.arguments.get("query", ""),
                result_length=len(tool_result),
            ))

            # Append conversation turn and continue
            messages.append(LLMMessage(role="assistant", content=raw))
            messages.append(LLMMessage(
                role="user",
                content=(
                    f"工具 {tool_call.name} 的执行结果:\n{tool_result}\n\n"
                    f"请基于此结果继续分析。如果信息充分，请用 <conclude> 标签包裹最终分析。"
                    f"如果还需要更多信息，继续调用工具。"
                ),
            ))

        # Budget exhausted or implicit conclusion — extract what we can
        full_raw = "\n\n".join(all_analysis_text) if all_analysis_text else ""

        if not full_raw or len(full_raw) < 200:
            # Output too short — force one more call asking for a proper conclusion
            messages.append(LLMMessage(
                role="user",
                content="请基于已有数据和搜索结果，直接输出完整的最终分析结论。请用 <conclude> 标签包裹。",
            ))
            raw = ""
            _pending_text = ""

            async def _force():
                nonlocal raw, _pending_text
                async for chunk in adapter.chat(messages, stream=True):
                    raw += chunk
                    _pending_text += chunk
                    if on_progress and len(_pending_text) >= _STREAM_CHUNK_SIZE:
                        on_progress({
                            "type": "gate_text",
                            "gate": skill.gate_number,
                            "skill": skill.skill_name,
                            "text": _pending_text,
                        })
                        _pending_text = ""
                if on_progress and _pending_text:
                    on_progress({
                        "type": "gate_text",
                        "gate": skill.gate_number,
                        "skill": skill.skill_name,
                        "text": _pending_text,
                    })

            remaining = budget.timeout_seconds - budget.elapsed_seconds
            try:
                await asyncio.wait_for(_force(), timeout=max(remaining, 10))
            except asyncio.TimeoutError:
                pass

            conclusion = self.tool_parser.parse_conclusion(raw)
            if conclusion:
                full_raw = conclusion.text
            elif raw:
                # Append forced conclusion to accumulated text
                full_raw = (full_raw + "\n\n" + raw).strip() if full_raw else raw

        latency = int((time.time() - start_time) * 1000)
        # Extract core conclusion from raw if not from conclude tag
        core_conclusion = self._extract_core_conclusion(full_raw)
        key_findings = self._extract_key_findings(full_raw)
        confidence = self._extract_confidence(full_raw)
        eff = round(sum(1 for a in actions if a.result_length > 100) / len(actions), 2) if actions else None

        return GateResult(
            gate_number=skill.gate_number,
            skill_name=skill.skill_name,
            display_name=skill.display_name,
            raw=full_raw,
            core_conclusion=core_conclusion,
            key_findings=key_findings,
            confidence=confidence,
            actions=actions,
            rounds=budget.rounds_used,
            latency_ms=latency,
            parse_status="text",
            tool_efficiency_score=eff,
            tool_warnings=tool_warnings,
        )

    async def _execute_gate7(
        self,
        skill: CompanySkill,
        context: PipelineContext,
        budget: ToolBudget,
        on_progress: Optional[Callable],
    ) -> GateResult:
        """Gate 7: synthesis — no ReAct, just structured JSON output."""
        start_time = time.time()

        # Gate 7 max_tokens: model-specific limits
        model_name = self.model_config.get("model", "")
        gate7_tokens = 8192  # safe default for most providers
        if "claude" in model_name:
            gate7_tokens = 16384
        elif "gpt-4" in model_name or "gpt-5" in model_name:
            gate7_tokens = 16384
        adapter = self._get_adapter(max_tokens=gate7_tokens, json_mode=True)

        cross_gate_context = context.get_context_for_gate(7)
        user_msg = self._build_gate7_user_message(skill, context, cross_gate_context)

        messages = [
            LLMMessage(role="system", content=skill.system_prompt),
            LLMMessage(role="user", content=user_msg),
        ]

        raw = ""
        _pending_text = ""

        async def _collect():
            nonlocal raw, _pending_text
            async for chunk in adapter.chat(messages, stream=True):
                raw += chunk
                _pending_text += chunk
                if on_progress and len(_pending_text) >= _STREAM_CHUNK_SIZE:
                    on_progress({
                        "type": "gate_text",
                        "gate": 7,
                        "skill": skill.skill_name,
                        "text": _pending_text,
                    })
                    _pending_text = ""
            if on_progress and _pending_text:
                on_progress({
                    "type": "gate_text",
                    "gate": 7,
                    "skill": skill.skill_name,
                    "text": _pending_text,
                })

        await asyncio.wait_for(_collect(), timeout=budget.timeout_seconds)

        parsed, parse_status = parse_skill_output(raw, CompanyFullReport)

        # JSON repair fallback: if primary parse failed, try fast model to fix JSON
        if parse_status == "raw_only" and raw.strip():
            logger.warning("[gate7] primary parse failed, attempting JSON repair")
            try:
                repaired_raw = await self._repair_json(raw)
                if repaired_raw:
                    parsed, parse_status = parse_skill_output(repaired_raw, CompanyFullReport)
                    if parse_status != "raw_only":
                        raw = repaired_raw
                        logger.info("[gate7] JSON repair succeeded")
            except Exception as e:
                logger.warning(f"[gate7] JSON repair failed: {e}")

        latency = int((time.time() - start_time) * 1000)

        return GateResult(
            gate_number=7,
            skill_name=skill.skill_name,
            display_name=skill.display_name,
            raw=raw,
            core_conclusion=None,
            rounds=1,
            latency_ms=latency,
            parse_status=parse_status,
        )

    def _build_user_message(self, skill: CompanySkill, context: PipelineContext) -> str:
        """Build user message for gates 1-6."""
        parts = [
            f"请对以下公司进行【{skill.display_name}】分析。\n",
            "以下是这家公司的财务数据和业务信息：\n",
            "【重要提示】标记为 [数据缺失] 的部分表示无法获取，请基于已有数据分析，"
            "明确标注哪些结论缺乏数据支持。不要对缺失数据进行猜测或编造。\n",
            context.company_data_text,
        ]

        cross_gate = context.get_context_for_gate(skill.gate_number)
        if cross_gate:
            parts.append(f"\n\n══ 前序分析结论（请在此基础上深化而非重复）══")
            parts.append(cross_gate)

        return "\n".join(parts)

    def _build_gate7_user_message(
        self, skill: CompanySkill, context: PipelineContext, cross_gate_context: str,
    ) -> str:
        """Build user message for Gate 7."""
        parts = [
            f"请对以下公司进行【{skill.display_name}】。\n",
            "以下是这家公司的财务数据和业务信息：\n",
            "【重要提示】标记为 [数据缺失] 的部分表示无法获取，请基于已有数据分析，"
            "明确标注哪些结论缺乏数据支持。不要对缺失数据进行猜测或编造。\n",
            context.company_data_text,
            "\n\n",
            cross_gate_context,
        ]
        return "\n".join(parts)

    # ── Extraction helpers ────────────────────────────────────────────────

    _CORE_CONCLUSION_RE = re.compile(
        r'【核心结论】[*\s]*\n?(.*?)(?:\n\n|\n【|\Z)', re.DOTALL
    )
    _KEY_FINDINGS_RE = re.compile(
        r'【关键发现】[*\s]*\n?(.*?)(?:\n\n|\n【|\Z)', re.DOTALL
    )
    _CONFIDENCE_RE = re.compile(
        r'【置信度】[*\s]*\n?\s*([\d.]+)', re.DOTALL
    )

    async def _repair_json(self, broken_json: str) -> Optional[str]:
        """Use a fast/cheap model to repair malformed JSON from Gate 7.

        Reuses the same api_key/base_url already resolved for this pipeline run
        (which is user-scoped via _resolve_model upstream).
        """
        try:
            from openai import AsyncOpenAI
            aihub_key = self.model_config.get("api_key")
            aihub_url = self.model_config.get("base_url") or "https://aihubmix.com/v1"
            if not aihub_key:
                return None

            # Truncate if extremely long, keep enough for repair
            text = broken_json[:12000]
            prompt = (
                "以下是一段损坏的 JSON 输出（可能包含多余文字、截断、或格式错误）。\n"
                "请修复它，输出一个合法的 JSON 对象。只输出 JSON，不要加任何解释。\n\n"
                f"{text}"
            )

            client = AsyncOpenAI(api_key=aihub_key, base_url=aihub_url)
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model="gpt-4.1-nano",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=8000,
                    temperature=0,
                    response_format={"type": "json_object"},
                ),
                timeout=30,
            )
            return resp.choices[0].message.content
        except Exception as e:
            logger.warning(f"[gate7] _repair_json error: {e}")
            return None

    def _extract_core_conclusion(self, raw: str) -> Optional[str]:
        m = self._CORE_CONCLUSION_RE.search(raw)
        return m.group(1).strip() if m else None

    def _extract_key_findings(self, raw: str) -> list[str]:
        m = self._KEY_FINDINGS_RE.search(raw)
        if not m:
            return []
        return [
            line.lstrip("- ").strip()
            for line in m.group(1).strip().split("\n")
            if line.strip() and line.strip() != "-"
        ]

    def _extract_confidence(self, raw: str) -> Optional[float]:
        m = self._CONFIDENCE_RE.search(raw)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
        return None


# ── Pipeline Orchestrator ─────────────────────────────────────────────────

class PipelineOrchestrator:
    """Manages the 7-gate pipeline execution with reflection checkpoints.

    Responsibilities:
    1. Execute gates sequentially via GateExecutor
    2. Manage cross-gate context (PipelineContext)
    3. Trigger reflection at checkpoints (after Gate 3, after Gate 5)
    4. Build backward-compatible output format
    """

    def __init__(
        self,
        gate_executor: GateExecutor,
        context: PipelineContext,
        on_progress: Optional[Callable[[dict], Any]] = None,
        model_config: dict | None = None,
        prompt_overrides: Optional[dict[int, str]] = None,
    ):
        self.gate_executor = gate_executor
        self.context = context
        self.on_progress = on_progress
        self.model_config = model_config or {}
        self.prompt_overrides = prompt_overrides or {}

    def _emit(self, event: dict):
        if self.on_progress:
            try:
                self.on_progress(event)
            except Exception as e:
                logger.warning(f"[orchestrator] progress emit error: {e}")

    async def _get_gate_cache_key(self, skill: CompanySkill) -> Optional[str]:
        """Build a cache key for a gate result. None if caching disabled."""
        symbol = self.context.symbol
        if not symbol:
            return None  # no symbol → skip caching to avoid cross-contamination
        import hashlib
        prompt_hash = hashlib.md5(
            skill.system_prompt[:200].encode()
        ).hexdigest()[:8]
        model = self.model_config.get("model", "unknown")
        return f"company:gate:{symbol}:{model}:{skill.gate_number}:{prompt_hash}"

    async def run(self) -> dict:
        """Execute the full 7-gate pipeline."""
        results: dict[str, Any] = {}
        all_tool_calls: list[dict] = []
        total_start = time.time()

        # Gate cache service (optional, non-blocking)
        try:
            from uteki.common.cache import get_cache_service
            cache = get_cache_service()
        except Exception:
            cache = None

        for skill in COMPANY_SKILL_PIPELINE:
            # Apply prompt override if provided (for A/B testing)
            if skill.gate_number in self.prompt_overrides:
                from dataclasses import replace
                skill = replace(
                    skill,
                    system_prompt=self.prompt_overrides[skill.gate_number],
                )

            logger.info(
                f"[orchestrator] gate={skill.gate_number} skill={skill.skill_name} "
                f"model={self.model_config.get('model', '?')}"
            )

            # Emit gate_start
            self._emit({
                "type": "gate_start",
                "gate": skill.gate_number,
                "skill": skill.skill_name,
                "display_name": skill.display_name,
                "has_tools": bool(skill.tools),
            })

            # Build budget for this gate
            if skill.gate_number == 7:
                budget = ToolBudget(
                    max_searches=0, max_rounds=1, max_tool_calls=0,
                    timeout_seconds=GATE_TIMEOUT_GATE7,
                )
            else:
                budget = ToolBudget(
                    max_searches=6, max_rounds=5, max_tool_calls=10,
                    timeout_seconds=GATE_TIMEOUT,
                )

            # Check gate cache (gates 1-6 only, skip Gate 7 which synthesizes)
            cached_result = None
            cache_key = None
            if cache and skill.gate_number < 7:
                try:
                    cache_key = await self._get_gate_cache_key(skill)
                    cached_result = await cache.get(cache_key)
                except Exception:
                    pass

            if cached_result:
                logger.info(f"[orchestrator] gate={skill.gate_number} CACHE HIT")
                gate_result = GateResult(
                    gate_number=skill.gate_number,
                    skill_name=skill.skill_name,
                    display_name=skill.display_name,
                    raw=cached_result.get("raw", ""),
                    core_conclusion=cached_result.get("core_conclusion"),
                    parse_status="cached",
                    latency_ms=0,
                )
            else:
                pass  # fall through to execute

            # Execute gate (if not cached)
            if not cached_result:
                try:
                    gate_result = await self.gate_executor.execute(
                        skill, self.context, budget, self.on_progress,
                    )
                    # Cache successful gate results (gates 1-6, 24h TTL)
                    if cache and cache_key and skill.gate_number < 7 and not gate_result.error:
                        try:
                            await cache.set(cache_key, {
                                "raw": gate_result.raw,
                                "core_conclusion": gate_result.core_conclusion,
                            }, ttl=86400)
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    timeout = GATE_TIMEOUT_GATE7 if skill.gate_number == 7 else GATE_TIMEOUT
                    logger.error(f"[orchestrator] TIMEOUT: {skill.skill_name} after {timeout}s")
                    gate_result = GateResult(
                        gate_number=skill.gate_number,
                        skill_name=skill.skill_name,
                        display_name=skill.display_name,
                        raw="",
                        parse_status="timeout",
                        error=f"timeout after {timeout}s",
                    )
                except Exception as e:
                    logger.error(f"[orchestrator] ERROR: {skill.skill_name}: {e}", exc_info=True)
                    gate_result = GateResult(
                        gate_number=skill.gate_number,
                        skill_name=skill.skill_name,
                        display_name=skill.display_name,
                        raw="",
                        parse_status="error",
                        error=str(e),
                    )

            # Add to context
            self.context.add_gate_result(gate_result)

            # ── Per-gate structuring ──
            parsed = None
            parse_status = gate_result.parse_status
            if skill.gate_number == 7 and gate_result.raw:
                parsed, parse_status = parse_skill_output(gate_result.raw, CompanyFullReport)
            elif skill.skill_name in _GATE_SCHEMAS and gate_result.raw and not gate_result.error:
                # Fire-and-forget async structuring (non-blocking)
                _skill_name = skill.skill_name
                _gate_num = skill.gate_number
                _raw = gate_result.raw

                async def _async_structurize(sn=_skill_name, gn=_gate_num, raw=_raw):
                    try:
                        p, ps = await self._structurize_gate(sn, raw)
                        if p:
                            pd = p.model_dump()
                            results[sn]["parsed"] = pd
                            results[sn]["parse_status"] = ps
                            self._emit({
                                "type": "gate_structured",
                                "gate": gn,
                                "skill": sn,
                                "parsed": pd,
                                "parse_status": ps,
                            })
                    except Exception as e:
                        logger.warning(f"[orchestrator] async structurize {sn} failed: {e}")

                asyncio.create_task(_async_structurize())

            parsed_dict = parsed.model_dump() if parsed else {}
            skill_result: dict[str, Any] = {
                "gate": skill.gate_number,
                "display_name": skill.display_name,
                "parsed": parsed_dict,
                "raw": gate_result.raw,
                "parse_status": parse_status,
                "latency_ms": gate_result.latency_ms,
            }
            if gate_result.error:
                skill_result["error"] = gate_result.error

            # Include ReAct metadata
            if gate_result.actions:
                tool_records = []
                for a in gate_result.actions:
                    record = {
                        "skill": skill.skill_name,
                        "round": a.round_num,
                        "tool_name": a.tool_name,
                        "tool_args": a.tool_args,
                        "tool_result": a.result,
                    }
                    tool_records.append(record)
                    all_tool_calls.append(record)
                skill_result["tool_calls"] = tool_records

            if gate_result.rounds > 0:
                skill_result["react_rounds"] = gate_result.rounds
            if gate_result.confidence is not None:
                skill_result["confidence"] = gate_result.confidence
            if gate_result.key_findings:
                skill_result["key_findings"] = gate_result.key_findings

            results[skill.skill_name] = skill_result

            # Emit gate_complete
            gate_event: dict[str, Any] = {
                "type": "gate_complete",
                "gate": skill.gate_number,
                "skill": skill.skill_name,
                "display_name": skill.display_name,
                "parse_status": parse_status,
                "latency_ms": gate_result.latency_ms,
                "parsed": parsed_dict,
                "raw": gate_result.raw,
            }
            if gate_result.error:
                gate_event["error"] = gate_result.error
            if gate_result.tool_warnings:
                gate_event["tool_warnings"] = gate_result.tool_warnings
            self._emit(gate_event)

            logger.info(
                f"[orchestrator] gate={skill.gate_number} {skill.skill_name} done "
                f"status={parse_status} rounds={gate_result.rounds} "
                f"tools={len(gate_result.actions)} latency={gate_result.latency_ms}ms"
            )

            # ── Reflection checkpoint ─────────────────────────────────────
            if skill.gate_number in REFLECTION_CHECKPOINTS:
                await self._run_reflection(skill.gate_number)

        total_latency_ms = int((time.time() - total_start) * 1000)

        # ── Post-pipeline: populate gate results from Gate 7 ──────────────
        return self._build_output(results, all_tool_calls, total_latency_ms)

    async def _structurize_gate(self, skill_name: str, raw_text: str):
        """Use a fast/cheap model to extract structured JSON from a gate's raw text."""
        schema_class = _GATE_SCHEMAS.get(skill_name)
        if not schema_class:
            return None, "text"

        # Build schema hint from Pydantic model fields
        schema_fields = {}
        for name, field_info in schema_class.model_fields.items():
            schema_fields[name] = str(field_info.annotation).replace("typing.", "")
        schema_hint = json.dumps(schema_fields, indent=2, ensure_ascii=False)

        prompt = _STRUCTURIZE_PROMPT.format(
            raw_text=raw_text[:3000],  # truncate to save tokens
            schema_hint=schema_hint,
        )

        try:
            from openai import AsyncOpenAI
            # Reuse the resolved (user-scoped) aggregator key from this run.
            aihub_key = self.model_config.get("api_key")
            aihub_url = self.model_config.get("base_url") or "https://aihubmix.com/v1"

            if not aihub_key:
                return None, "text"

            client = AsyncOpenAI(api_key=aihub_key, base_url=aihub_url)
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model="gpt-4.1-nano",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=2000,
                    temperature=0,
                ),
                timeout=30,
            )

            result_text = resp.choices[0].message.content or ""
            parsed, status = parse_skill_output(result_text, schema_class)
            if parsed:
                logger.info(f"[orchestrator] structurize {skill_name}: {status}")
                return parsed, status
        except asyncio.TimeoutError:
            logger.warning(f"[orchestrator] structurize {skill_name} timeout")
        except Exception as e:
            logger.warning(f"[orchestrator] structurize {skill_name} error: {e}")

        return None, "text"

    async def _run_reflection(self, after_gate: int):
        """Run a reflection checkpoint."""
        prompt_template = REFLECTION_CHECKPOINTS.get(after_gate)
        if not prompt_template:
            return

        self._emit({
            "type": "reflection_start",
            "after_gate": after_gate,
        })

        # Build gate conclusions for the prompt
        conclusions_parts = []
        for gn in sorted(self.context.gate_results):
            if gn > after_gate:
                break
            r = self.context.gate_results[gn]
            conclusions_parts.append(f"Gate {gn} ({r.display_name}):")
            conclusions_parts.append(f"  核心结论: {r.summary}")
            if r.key_findings:
                conclusions_parts.append(f"  关键发现: {'; '.join(r.key_findings[:5])}")
            if r.confidence is not None:
                conclusions_parts.append(f"  置信度: {r.confidence}/10")
            conclusions_parts.append("")

        prompt = prompt_template.format(gate_conclusions="\n".join(conclusions_parts))

        try:
            adapter = self.gate_executor._get_adapter(max_tokens=2048)
            messages = [
                LLMMessage(role="system", content="你是一名投资分析审计员。请以JSON格式输出。"),
                LLMMessage(role="user", content=prompt),
            ]

            raw = ""
            async for chunk in adapter.chat(messages, stream=False):
                raw += chunk

            # Parse reflection JSON
            reflection = self._parse_reflection(after_gate, raw)
            self.context.add_reflection(reflection)

            self._emit({
                "type": "reflection_complete",
                "after_gate": after_gate,
                "contradictions": reflection.contradictions,
                "downstream_hints": reflection.downstream_hints,
                "has_contradiction": reflection.has_contradiction,
            })

            if reflection.has_contradiction:
                logger.warning(
                    f"[orchestrator] reflection after gate {after_gate} found contradictions: "
                    f"{reflection.contradictions}"
                )

        except Exception as e:
            logger.warning(f"[orchestrator] reflection after gate {after_gate} failed: {e}")
            self._emit({
                "type": "reflection_complete",
                "after_gate": after_gate,
                "contradictions": [],
                "downstream_hints": [],
                "has_contradiction": False,
                "error": str(e),
            })

    def _parse_reflection(self, after_gate: int, raw: str) -> Reflection:
        """Parse reflection JSON output."""
        try:
            # Try to extract JSON from the response
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                data = json.loads(json_match.group(0))
                return Reflection(
                    after_gate=after_gate,
                    contradictions=data.get("contradictions", []),
                    downstream_hints=data.get("downstream_hints", []),
                    needs_revisit=data.get("needs_revisit"),
                    raw=raw,
                )
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"[orchestrator] reflection parse failed: {e}")

        return Reflection(after_gate=after_gate, raw=raw)

    def _build_output(
        self,
        results: dict[str, Any],
        all_tool_calls: list[dict],
        total_latency_ms: int,
    ) -> dict:
        """Build backward-compatible pipeline output."""
        gate7_result = results.get("final_verdict", {})
        gate7_parsed = gate7_result.get("parsed", {})

        # Map Gate 7's structured sections back to each gate's result
        gate_skill_names = [
            "business_analysis", "fisher_qa", "moat_assessment",
            "management_assessment", "reverse_test", "valuation",
        ]
        for skill_name in gate_skill_names:
            gate_data = gate7_parsed.get(skill_name)
            if gate_data and isinstance(gate_data, dict) and skill_name in results:
                results[skill_name]["parsed"] = gate_data
                results[skill_name]["parse_status"] = "structured"

        # Extract verdict
        verdict_dict = gate7_parsed.get("position_holding", {})
        verdict = PositionHoldingOutput(**verdict_dict) if verdict_dict else PositionHoldingOutput()

        if verdict_dict:
            results["final_verdict"]["parsed"] = gate7_parsed

        # Build trace
        trace = []
        for skill in COMPANY_SKILL_PIPELINE:
            r = results.get(skill.skill_name, {})
            entry = {
                "gate": skill.gate_number,
                "skill": skill.skill_name,
                "display_name": skill.display_name,
                "status": r.get("parse_status", "unknown"),
                "latency_ms": r.get("latency_ms", 0),
            }
            if r.get("error"):
                entry["error"] = r["error"]
            if r.get("react_rounds"):
                entry["react_rounds"] = r["react_rounds"]
            if r.get("confidence") is not None:
                entry["confidence"] = r["confidence"]
            trace.append(entry)

        return {
            "skills": results,
            "verdict": verdict.model_dump(),
            "total_latency_ms": total_latency_ms,
            "trace": trace,
            "tool_calls": all_tool_calls or None,
        }


# ── Public Interface (backward-compatible) ────────────────────────────────

class CompanySkillRunner:
    """Public API — drop-in replacement for the previous CompanySkillRunner.

    Usage:
        runner = CompanySkillRunner(model_config, company_data, on_progress=emit)
        result = await runner.run_pipeline()

        # With prompt overrides (for A/B testing):
        runner = CompanySkillRunner(model_config, company_data,
                                   prompt_overrides={1: "new gate 1 prompt"})
    """

    def __init__(
        self,
        model_config: dict,
        company_data: dict,
        on_progress: Optional[Callable[[dict], Any]] = None,
        prompt_overrides: Optional[dict[int, str]] = None,
    ):
        self.model_config = model_config
        self.company_data = company_data
        self.on_progress = on_progress
        self.prompt_overrides = prompt_overrides

    async def run_pipeline(self) -> dict:
        data_text = format_company_data_for_prompt(self.company_data)
        symbol = self.company_data.get("profile", {}).get("symbol", "")
        context = PipelineContext(company_data_text=data_text, symbol=symbol)

        tool_executor = CompanyToolExecutor(company_data=self.company_data)
        tool_parser = ToolCallParser()
        gate_executor = GateExecutor(self.model_config, tool_executor, tool_parser)

        orchestrator = PipelineOrchestrator(
            gate_executor=gate_executor,
            context=context,
            on_progress=self.on_progress,
            model_config=self.model_config,
            prompt_overrides=self.prompt_overrides,
        )

        return await orchestrator.run()
