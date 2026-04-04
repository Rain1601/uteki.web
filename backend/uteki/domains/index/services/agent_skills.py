"""Agent Skill Pipeline — 结构化多步决策系统

每个 Agent 通过 4-step skill pipeline 执行决策：
1. AnalyzeMarket   — 技术面 + 估值分析
2. AnalyzeMacro    — 宏观经济 + 情绪分析
3. RecallMemory    — 记忆回顾 + 经验提取
4. MakeDecision    — 综合分析 → 最终决策
"""

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

TOOL_TIMEOUT = 10  # seconds per tool execution
MAX_TOOL_ROUNDS = 3  # max tool-use cycles per skill
SKILL_TIMEOUT = 60  # seconds per skill LLM call


# ============================================================
# AgentSkill Dataclass
# ============================================================


@dataclass
class AgentSkill:
    """单个 Skill 定义"""

    skill_name: str
    system_prompt_template: str
    tools: List[str] = field(default_factory=list)
    output_schema: Dict[str, Any] = field(default_factory=dict)


# ============================================================
# 4 Core Skills
# ============================================================

SKILL_ANALYZE_MARKET = AgentSkill(
    skill_name="analyze_market",
    system_prompt_template=(
        "你是一名专业的指数 ETF 投资分析师，正在进行技术面与估值分析。\n\n"
        "基础市场数据已在用户消息中提供。如果你需要验证某个关键数据点、获取最新市场动态，"
        "或发现数据可能过时，可以使用 web_search 工具搜索最新信息。\n\n"
        "分析维度：\n"
        "1. 价格趋势：当前价格 vs MA50/MA200，判断趋势方向\n"
        "2. RSI 信号：超买(>70)、超卖(<30)、中性区间\n"
        "3. 估值水平：PE 所处历史分位、CAPE 估值、盈利收益率 vs 无风险利率\n"
        "4. 股息率吸引力\n\n"
        "【输出规则】你的最终输出必须是且仅是一个 JSON 对象（不含 markdown 标记），直接以 { 开始、以 } 结束：\n"
        "{\n"
        '  "market_regime": "bullish" / "bearish" / "neutral" / "transitioning",\n'
        '  "trend_signals": {"SYMBOL": {"trend": "...", "strength": "..."}},\n'
        '  "valuation_assessment": {"SYMBOL": {"level": "cheap/fair/expensive", "note": "..."}},\n'
        '  "key_observations": ["..."],\n'
        '  "summary": "一句话总结"\n'
        "}"
    ),
    tools=["get_symbol_detail", "web_search"],
    output_schema={
        "type": "object",
        "properties": {
            "market_regime": {"type": "string"},
            "trend_signals": {"type": "object"},
            "valuation_assessment": {"type": "object"},
            "key_observations": {"type": "array"},
        },
    },
)

SKILL_ANALYZE_MACRO = AgentSkill(
    skill_name="analyze_macro",
    system_prompt_template=(
        "你是一名专业的宏观经济分析师，正在分析宏观环境对指数 ETF 投资的影响。\n\n"
        "基础宏观数据已在用户消息中提供。如果数据可能过时（特别是近期利率决议、CPI数据、就业报告等），"
        "请使用 web_search 搜索最新信息以确保分析准确。\n\n"
        "结合前一步的技术面分析进行分析：\n"
        "1. 利率环境：联邦基金利率水平与方向，对股票估值的影响\n"
        "2. 通胀态势：CPI/PCE 趋势，对实际回报的影响\n"
        "3. 经济增长：GDP、就业、PMI 信号\n"
        "4. 市场情绪：恐贪指数、投资者仓位、Put/Call Ratio\n"
        "5. 美元与波动率：DXY 对国际 ETF 的影响，VIX 隐含风险\n\n"
        "你的输出必须是且仅是一个 JSON 对象（不含 markdown 标记、不含解释文字），直接以 { 开始、以 } 结束：\n"
        "{\n"
        '  "macro_regime": "expansion" / "peak" / "contraction" / "trough",\n'
        '  "rate_impact": "利率对股市影响评估",\n'
        '  "inflation_risk": "low" / "moderate" / "high",\n'
        '  "sentiment_signal": "extreme_fear" / "fear" / "neutral" / "greed" / "extreme_greed",\n'
        '  "macro_tailwinds": ["有利因素"],\n'
        '  "macro_headwinds": ["不利因素"],\n'
        '  "summary": "一句话总结"\n'
        "}"
    ),
    tools=["get_recent_news", "web_search"],
    output_schema={
        "type": "object",
        "properties": {
            "macro_regime": {"type": "string"},
            "rate_impact": {"type": "string"},
            "inflation_risk": {"type": "string"},
            "sentiment_signal": {"type": "string"},
            "macro_tailwinds": {"type": "array"},
            "macro_headwinds": {"type": "array"},
        },
    },
)

SKILL_RECALL_MEMORY = AgentSkill(
    skill_name="recall_memory",
    system_prompt_template=(
        "你正在回顾你的决策历史和记忆，以辅助当前的投资决策。\n\n"
        "记忆数据已在用户消息中提供。请分析这些内容，提取与当前市场环境相关的经验教训：\n"
        "1. 近期决策回顾：之前做了什么决策？结果如何？\n"
        "2. 经验教训：有哪些已记录的投资经验？\n"
        "3. 投票获胜方案：之前哪些方案赢得了投票？为什么？\n"
        "4. 模式识别：当前市场条件是否与历史某个时刻相似？\n\n"
        "你的输出必须是且仅是一个 JSON 对象（不含 markdown 标记、不含解释文字），直接以 { 开始、以 } 结束：\n"
        "{\n"
        '  "relevant_lessons": ["经验1", "经验2"],\n'
        '  "past_similar_conditions": [{"condition": "...", "decision": "...", "outcome": "..."}],\n'
        '  "memory_informed_bias": "more_cautious" / "more_aggressive" / "neutral",\n'
        '  "reasoning": "为什么这些记忆影响了你的判断"\n'
        "}"
    ),
    tools=["read_memory"],
    output_schema={
        "type": "object",
        "properties": {
            "relevant_lessons": {"type": "array"},
            "past_similar_conditions": {"type": "array"},
            "memory_informed_bias": {"type": "string"},
            "reasoning": {"type": "string"},
        },
    },
)

SKILL_MAKE_DECISION = AgentSkill(
    skill_name="make_decision",
    system_prompt_template=(
        "你是一名专业的指数 ETF 投资顾问，需要基于完整的分析做出最终投资决策。\n\n"
        "前序分析结果已在用户消息中提供。如果在综合分析时发现关键信息缺失，"
        "可以使用 web_search 进行最后验证（例如确认最新的市场事件）。\n\n"
        "你已经完成了以下分析步骤：\n"
        "1. 技术面与估值分析\n"
        "2. 宏观经济与情绪分析\n"
        "3. 历史记忆与经验回顾\n\n"
        "现在请综合所有分析，做出最终决策。决策原则参照 Warren Buffett / Charlie Munger 的价值投资理念：\n"
        "- 在别人恐惧时贪婪，在别人贪婪时恐惧\n"
        "- 关注安全边际和长期价值\n"
        "- 不要试图择时，但可以在极端估值时调整仓位\n"
        "- 分散风险，但不要过度分散\n\n"
        "约束条件会在用户消息中提供，请严格遵守。\n\n"
        "【关键】你的输出必须是且仅是一个 JSON 对象。\n"
        "不要包含任何 markdown 标记（如 ```json）、解释文字、前言或后缀。\n"
        "直接以 { 开始，以 } 结束。所有 key 使用中文：\n"
        "{\n"
        '  "操作": "买入" / "卖出" / "持有" / "调仓" / "跳过",\n'
        '  "分配": [{"标的": "VOO", "金额": 600, "比例": 60, "理由": "..."}],\n'
        '  "信心度": 0.0-1.0,\n'
        '  "决策理由": "简要决策理由",\n'
        '  "思考过程": "完整思考过程",\n'
        '  "风险评估": "风险评估",\n'
        '  "失效条件": "什么情况下此建议无效"\n'
        "}"
    ),
    tools=["calculate_position_size", "web_search"],
    output_schema={
        "type": "object",
        "required": ["操作", "信心度", "决策理由"],
        "properties": {
            "操作": {"type": "string", "enum": ["买入", "卖出", "持有", "调仓", "跳过"]},
            "分配": {"type": "array"},
            "信心度": {"type": "number"},
            "决策理由": {"type": "string"},
            "思考过程": {"type": "string"},
            "风险评估": {"type": "string"},
            "失效条件": {"type": "string"},
        },
    },
)

# Ordered pipeline
SKILL_PIPELINE = [
    SKILL_ANALYZE_MARKET,
    SKILL_ANALYZE_MACRO,
    SKILL_RECALL_MEMORY,
    SKILL_MAKE_DECISION,
]


# ============================================================
# Tool Definitions (JSON Schema for LLM tool-use)
# ============================================================

TOOL_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "get_symbol_detail": {
        "name": "get_symbol_detail",
        "description": "获取特定 ETF 的详细行情数据，包括价格、技术指标、52周高低点等",
        "parameters": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "ETF 代码，如 SPY, QQQ, VTI",
                },
            },
            "required": ["symbol"],
        },
    },
    "get_recent_news": {
        "name": "get_recent_news",
        "description": "获取与特定标的或市场相关的近期新闻摘要",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索查询，如 ETF 代码或市场关键词",
                },
            },
            "required": ["query"],
        },
    },
    "read_memory": {
        "name": "read_memory",
        "description": "读取特定类别的 Agent 记忆，包括历史决策、经验、反思等",
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "记忆类别: decision / reflection / experience / observation / arena_learning / arena_vote_reasoning",
                },
            },
            "required": ["category"],
        },
    },
    "calculate_position_size": {
        "name": "calculate_position_size",
        "description": "根据账户状态和风控限制，计算建议的仓位大小",
        "parameters": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "ETF 代码",
                },
                "action": {
                    "type": "string",
                    "enum": ["BUY", "SELL"],
                    "description": "交易方向",
                },
                "confidence": {
                    "type": "number",
                    "description": "决策信心度 0-1",
                },
            },
            "required": ["symbol", "action"],
        },
    },
    "web_search": {
        "name": "web_search",
        "description": "搜索互联网获取最新的市场新闻、宏观经济数据、公司公告等实时信息",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词，如 'US CPI data March 2026' 或 'Fed interest rate decision'",
                },
            },
            "required": ["query"],
        },
    },
}


# ============================================================
# Tool Executor
# ============================================================


class ToolExecutor:
    """工具执行器 — 连接 skill pipeline 和实际数据源"""

    def __init__(
        self,
        harness_data: Dict[str, Any],
        agent_key: str = "shared",
        user_id: str = "default",
    ):
        self.harness_data = harness_data
        self.agent_key = agent_key
        self.user_id = user_id

    async def execute(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """执行工具并返回结果字符串"""
        executor_map: Dict[str, Any] = {
            "get_symbol_detail": self._get_symbol_detail,
            "get_recent_news": self._get_recent_news,
            "read_memory": self._read_memory,
            "calculate_position_size": self._calculate_position_size,
            "web_search": self._web_search,
        }
        executor = executor_map.get(tool_name)
        if not executor:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        try:
            result = await asyncio.wait_for(
                executor(arguments),
                timeout=TOOL_TIMEOUT,
            )
            return json.dumps(result, ensure_ascii=False, default=str)
        except asyncio.TimeoutError:
            return json.dumps({"error": f"Tool {tool_name} timed out after {TOOL_TIMEOUT}s"})
        except Exception as e:
            logger.error(f"Tool {tool_name} execution error: {e}")
            return json.dumps({"error": str(e)})

    async def _get_symbol_detail(self, args: Dict[str, Any]) -> Dict[str, Any]:
        from uteki.domains.index.services.data_service import get_data_service

        symbol = args.get("symbol", "")
        ds = get_data_service()
        quote = await ds.get_quote(symbol)
        indicators = ds.get_indicators(symbol)
        return {"symbol": symbol, "quote": quote, "indicators": indicators}

    async def _get_recent_news(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = args.get("query", "")
        snapshot = self.harness_data.get("market_snapshot", {})
        sentiment = snapshot.get("sentiment", {})
        events = sentiment.get("news_key_events", [])
        return {
            "query": query,
            "news_events": events,
            "note": "News data limited to harness snapshot.",
        }

    async def _read_memory(self, args: Dict[str, Any]) -> Dict[str, Any]:
        from uteki.domains.index.services.memory_service import get_memory_service

        category = args.get("category")
        ms = get_memory_service()

        # Fetch shared + agent-private memories
        shared = await ms.read(
            user_id=self.user_id,
            category=category,
            limit=5,
            agent_key="shared",
        )
        private = await ms.read(
            user_id=self.user_id,
            category=category,
            limit=5,
            agent_key=self.agent_key,
        ) if self.agent_key != "shared" else []

        return {
            "category": category,
            "agent_key": self.agent_key,
            "shared_memories": shared,
            "private_memories": private,
        }

    async def _calculate_position_size(self, args: Dict[str, Any]) -> Dict[str, Any]:
        symbol = args.get("symbol", "")
        action = args.get("action", "BUY")
        confidence = args.get("confidence", 0.5)

        account = self.harness_data.get("account_state", {})
        task = self.harness_data.get("task", {})
        constraints = task.get("constraints", {})

        cash = account.get("cash", 0)
        total = account.get("total", 0) or cash
        budget = task.get("budget", cash)
        max_pct = constraints.get("max_single_position_pct", 40) / 100.0

        if action == "BUY":
            max_amount = min(budget, total * max_pct)
            suggested = max_amount * confidence
        else:
            positions = account.get("positions", [])
            pos = next((p for p in positions if p.get("symbol") == symbol), None)
            suggested = pos.get("market_value", 0) * confidence if pos else 0

        return {
            "symbol": symbol,
            "action": action,
            "suggested_amount": round(suggested, 2),
            "max_allowed": round(total * max_pct, 2),
            "confidence_applied": confidence,
        }

    async def _web_search(self, args: Dict[str, Any]) -> Dict[str, Any]:
        from uteki.domains.agent.research.web_search import get_web_search_service

        query = args.get("query", "")
        svc = get_web_search_service()
        if not svc.available:
            return {"error": "Web search not configured (missing Google API keys)", "query": query}

        results = await svc.search(query, max_results=5)
        return {"query": query, "results": results, "count": len(results)}


# ============================================================
# AgentSkillRunner
# ============================================================


class AgentSkillRunner:
    """Agent Skill Pipeline 执行器

    按顺序执行 4-step skill pipeline，每个 skill 为一次 LLM 调用。
    中间结果累积传递给下一个 skill。

    如果 pipeline 失败，返回 status="pipeline_failed"，
    调用方可降级为 single-shot 模式。
    """

    def __init__(
        self,
        model_config: Dict[str, Any],
        harness_data: Dict[str, Any],
        agent_key: str,
        user_id: str = "default",
    ):
        self.model_config = model_config
        self.harness_data = harness_data
        self.agent_key = agent_key
        self.user_id = user_id
        self.web_search_enabled = model_config.get("web_search_enabled", False)
        self.web_search_provider = model_config.get("web_search_provider", "google")
        self.tool_executor = ToolExecutor(
            harness_data=harness_data,
            agent_key=agent_key,
            user_id=user_id,
        )

    async def run_pipeline(
        self,
        system_prompt: str,
        user_prompt: str,
        on_progress: Optional[callable] = None,
    ) -> Dict[str, Any]:
        """执行完整 skill pipeline

        Args:
            system_prompt: 原始 system prompt（用于 fallback context）
            user_prompt: 序列化后的 harness 数据

        Returns:
            Dict with: output_raw, output_structured, pipeline_steps,
                        tool_calls, latency_ms, status
        """
        from uteki.domains.agent.llm_adapter import (
            LLMAdapterFactory, LLMConfig, LLMMessage, LLMTool,
        )

        provider_name = self.model_config["provider"]
        model_name = self.model_config["model"]

        # Determine if this provider supports thinking mode
        _thinking_providers = {"anthropic", "deepseek", "openai"}
        _supports_thinking = provider_name in _thinking_providers
        # DeepSeek thinking requires the reasoner model
        _is_deepseek_reasoner = provider_name == "deepseek" and "reasoner" in model_name
        # OpenAI thinking is implicit for o-series models
        _is_openai_reasoning = provider_name == "openai" and any(
            model_name.startswith(p) for p in ("o1", "o3", "o4")
        )
        # Only Anthropic needs explicit thinking config; others use model name
        _use_thinking_config = provider_name == "anthropic"

        # Default adapter (no thinking) — used for analysis skills
        adapter = LLMAdapterFactory.create_unified(
            model=model_name,
            config=LLMConfig(temperature=0, max_tokens=4096),
        )

        # Thinking adapter — used for make_decision skill (Anthropic extended thinking)
        thinking_adapter = None
        if _use_thinking_config:
            thinking_adapter = LLMAdapterFactory.create_unified(
                model=model_name,
                config=LLMConfig(
                    temperature=1,  # Required by Anthropic for extended thinking
                    max_tokens=16000,  # Room for thinking + output
                    thinking=True,
                    thinking_budget=10000,
                ),
            )

        pipeline_start = time.time()
        accumulated_context: List[Dict[str, Any]] = []
        all_tool_calls: List[Dict[str, Any]] = []
        has_fatal_failure = False

        agent_key = f"{provider_name}:{model_name}"
        for step_idx, skill in enumerate(SKILL_PIPELINE):
            skill_start = time.time()
            if on_progress:
                on_progress({
                    "type": "skill_start",
                    "model": agent_key,
                    "skill": skill.skill_name,
                    "step": step_idx + 1,
                    "total": len(SKILL_PIPELINE),
                })
            try:
                skill_user_msg = self._build_skill_user_message(
                    skill, user_prompt, accumulated_context
                )

                sys_prompt = skill.system_prompt_template

                messages = [
                    LLMMessage(role="system", content=sys_prompt),
                    LLMMessage(role="user", content=skill_user_msg),
                ]

                # Provide tools defined in the skill (always available)
                skill_tools = None
                if skill.tools:
                    skill_tools = []
                    for tool_name in skill.tools:
                        tool_def = TOOL_DEFINITIONS.get(tool_name)
                        if tool_def:
                            skill_tools.append(LLMTool(
                                name=tool_def["name"],
                                description=tool_def["description"],
                                parameters=tool_def["parameters"],
                            ))

                # Use thinking adapter for make_decision if available
                active_adapter = adapter
                if skill.skill_name == "make_decision" and thinking_adapter:
                    active_adapter = thinking_adapter

                skill_output, skill_tool_calls = await self._execute_skill_with_tools(
                    active_adapter, messages, skill_tools, skill.skill_name, LLMMessage
                )

                skill_latency = int((time.time() - skill_start) * 1000)

                accumulated_context.append({
                    "skill": skill.skill_name,
                    "output": skill_output,
                    "latency_ms": skill_latency,
                })
                if skill_tool_calls:
                    all_tool_calls.extend(skill_tool_calls)

                if on_progress:
                    on_progress({
                        "type": "skill_complete",
                        "model": agent_key,
                        "skill": skill.skill_name,
                        "latency_ms": skill_latency,
                    })

                logger.info(
                    f"Skill {skill.skill_name} done: "
                    f"{provider_name}/{model_name} {skill_latency}ms"
                )

            except Exception as e:
                skill_latency = int((time.time() - skill_start) * 1000)
                logger.error(
                    f"Skill {skill.skill_name} failed: "
                    f"{provider_name}/{model_name}: {e}"
                )
                accumulated_context.append({
                    "skill": skill.skill_name,
                    "output": None,
                    "error": str(e),
                    "latency_ms": skill_latency,
                })
                if on_progress:
                    on_progress({
                        "type": "skill_complete",
                        "model": agent_key,
                        "skill": skill.skill_name,
                        "latency_ms": skill_latency,
                        "error": str(e),
                    })
                # If the final decision skill fails, mark as fatal
                if skill.skill_name == "make_decision":
                    has_fatal_failure = True

        total_latency = int((time.time() - pipeline_start) * 1000)

        # Final output is the last skill's output (make_decision)
        final_skill = accumulated_context[-1] if accumulated_context else {}
        final_output = final_skill.get("output", "")

        if has_fatal_failure or not final_output:
            return {
                "output_raw": final_output or "",
                "pipeline_steps": accumulated_context,
                "tool_calls": all_tool_calls or None,
                "latency_ms": total_latency,
                "status": "pipeline_failed",
            }

        return {
            "output_raw": final_output,
            "pipeline_steps": accumulated_context,
            "tool_calls": all_tool_calls or None,
            "latency_ms": total_latency,
            "status": "pipeline_success",
        }

    async def _execute_skill_with_tools(
        self,
        adapter,
        messages: list,
        tools: Optional[list],
        skill_name: str,
        LLMMessageClass,
    ) -> tuple:
        """执行单个 skill，支持 tool-use 循环

        Returns:
            (output_text, tool_calls_list)
        """
        tool_calls_record: List[Dict[str, Any]] = []

        for round_num in range(MAX_TOOL_ROUNDS + 1):
            async def _collect():
                text = ""
                async for chunk in adapter.chat(messages, stream=False, tools=tools):
                    text += chunk
                return text

            output = await asyncio.wait_for(_collect(), timeout=SKILL_TIMEOUT)

            # Check for tool calls in the output
            tool_call = self._parse_tool_call(output)
            if not tool_call or round_num >= MAX_TOOL_ROUNDS:
                return output, tool_calls_record

            # Execute tool
            tool_name = tool_call["name"]
            tool_args = tool_call.get("arguments", {})
            logger.info(f"Skill {skill_name} round {round_num + 1}: {tool_name}({tool_args})")

            tool_result = await self.tool_executor.execute(tool_name, tool_args)

            tool_calls_record.append({
                "skill": skill_name,
                "round": round_num + 1,
                "tool_name": tool_name,
                "tool_args": tool_args,
                "tool_result": tool_result[:500],
            })

            # Append tool result to messages and continue
            messages.append(LLMMessageClass(role="assistant", content=output))
            messages.append(LLMMessageClass(
                role="user",
                content=(
                    f"工具 {tool_name} 的执行结果:\n{tool_result}\n\n"
                    f"请基于此结果继续分析。如果信息已充分，请直接输出最终 JSON 结果。"
                    f"记住：最终输出必须是纯 JSON 对象，以 {{ 开始、以 }} 结束，不含 markdown 标记。"
                ),
            ))

        return output, tool_calls_record

    @staticmethod
    def _parse_tool_call(text: str) -> Optional[Dict[str, Any]]:
        """从模型输出中解析 tool call

        支持格式:
        1. <tool_call>{"name": "...", "arguments": {...}}</tool_call>
        2. ```tool_call\\n{...}\\n```
        3. {"tool_call": {"name": "...", "arguments": {...}}}
        """
        # Pattern 1: XML-style
        m = re.search(r'<tool_call>\s*(\{.*?\})\s*</tool_call>', text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass

        # Pattern 2: Code block
        m = re.search(r'```tool_call\s*\n(\{.*?\})\s*\n```', text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass

        # Pattern 3: JSON with tool_call key
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict) and "tool_call" in parsed:
                return parsed["tool_call"]
        except (json.JSONDecodeError, ValueError):
            pass

        return None

    def _build_skill_user_message(
        self,
        skill: AgentSkill,
        harness_prompt: str,
        accumulated: List[Dict[str, Any]],
    ) -> str:
        """构建 skill 的用户消息，包含 harness 数据 + 累积分析结果"""
        parts: List[str] = []

        if skill.skill_name == "analyze_market":
            parts.append(harness_prompt)

        elif skill.skill_name == "analyze_macro":
            parts.append(harness_prompt)
            if accumulated:
                parts.append("\n=== 前序分析结果 ===")
                for ctx in accumulated:
                    if ctx.get("output"):
                        parts.append(f"\n[{ctx['skill']}]:\n{ctx['output']}")

        elif skill.skill_name == "recall_memory":
            parts.append("请基于以下记忆和前序分析进行回顾：\n")
            memory = self.harness_data.get("memory_summary", {})
            if memory:
                parts.append(
                    f"记忆摘要: {json.dumps(memory, ensure_ascii=False, default=str)[:2000]}"
                )
            if accumulated:
                parts.append("\n=== 前序分析结果 ===")
                for ctx in accumulated:
                    if ctx.get("output"):
                        parts.append(f"\n[{ctx['skill']}]:\n{ctx['output']}")

        elif skill.skill_name == "make_decision":
            parts.append(harness_prompt)
            parts.append("\n=== 完整分析汇总 ===")
            for ctx in accumulated:
                if ctx.get("output"):
                    parts.append(f"\n[{ctx['skill']}]:\n{ctx['output']}")
                elif ctx.get("error"):
                    parts.append(f"\n[{ctx['skill']}]: 分析失败 - {ctx['error']}")

        return "\n".join(parts)
