"""
Company Investment Analysis — 4-Skill Pipeline
Buffett (Moat) → Fisher (15 Points) → Munger (Risk) → Verdict

Philosophy: First judge the BUSINESS, then judge the PRICE.
"""
from __future__ import annotations
import asyncio
import logging
import time
from typing import Any

from uteki.domains.agent.llm_adapter import (
    LLMAdapterFactory, LLMProvider, LLMConfig, LLMMessage,
)
from uteki.common.config import settings
from .schemas import (
    MoatAssessmentOutput,
    FisherFifteenOutput,
    MungerRiskOutput,
    VerdictOutput,
)
from .output_parser import parse_skill_output
from .financials import format_company_data_for_prompt

logger = logging.getLogger(__name__)

SKILL_TIMEOUT = 120   # seconds per skill

# ── JSON output rules (appended to every system prompt) ───────────────────

_JSON_RULES = """

【严格输出规则】
1. 你的回复必须且仅包含一个合法的 JSON 对象
2. 禁止使用 markdown、代码块（```）或反引号
3. 禁止在 JSON 前后添加任何解释文字
4. 使用下方示例中 EXACT 的字段名（大小写敏感）
5. 所有字符串值使用中文
6. 直接以 { 开始你的回复，以 } 结束"""

# ── Skill System Prompts ───────────────────────────────────────────────────

_SKILL1_SYSTEM = """你是沃伦·巴菲特，专注于分析企业的内在商业品质和竞争壁垒。
你不关心股价波动，你只关心一个问题：这是不是一门好生意？

分析框架：
1. 商业模式：这家公司靠什么赚钱？它的经济引擎是什么？
2. 护城河类型与宽度：
   - BRAND（品牌定价权）：消费者愿意为品牌付溢价
   - NETWORK（网络效应）：用户越多，价值越大
   - SWITCHING（切换成本）：客户迁移的代价极高
   - COST（成本优势）：规模/专利/地理带来的结构性成本领先
   - SCALE（有效规模）：细分市场的规模壁垒
3. 护城河趋势：是在加强、稳定还是在被侵蚀？
4. 所有者收益：真正可供股东支配的自由现金流
5. 再投资空间：公司能否将留存收益以高回报率继续投入？
6. 管理层：是否诚实、能干、以股东利益为导向？
7. 资本配置：回购/并购/分红是否理性？

输出 JSON：
- business_model: 一句话描述公司如何赚钱
- moat_types: 护城河类型列表
- moat_width: "wide" | "narrow" | "none"
- moat_trend: "strengthening" | "stable" | "eroding"
- moat_durability_years: 护城河预计可持续年数
- owner_earnings_per_share: 每股所有者收益（FCF代理）
- reinvestment_runway: 再投资空间描述
- management_quality: "excellent" | "good" | "mediocre" | "poor"
- capital_allocation: 资本配置质量描述
- key_strengths: 核心优势列表
- key_weaknesses: 核心弱点列表
- summary: 一句话总结这门生意的质量""" + _JSON_RULES + """

示例输出格式：
{"business_model":"通过硬件+软件+服务生态系统销售高溢价消费电子产品并变现用户基础","moat_types":["BRAND","SWITCHING","NETWORK"],"moat_width":"wide","moat_trend":"stable","moat_durability_years":15,"owner_earnings_per_share":7.2,"reinvestment_runway":"服务业务和AI领域仍有大量高ROIC投资机会","management_quality":"excellent","capital_allocation":"大规模回购有效提升每股价值，并购克制理性","key_strengths":["全球最强消费电子品牌","生态系统锁定效应极强"],"key_weaknesses":["对iPhone依赖度高","监管风险上升"],"summary":"顶级护城河企业，生态系统壁垒深厚，但需关注硬件成熟和监管压力"}
"""

_SKILL2_SYSTEM = """你是菲利普·费雪，遵循《怎样选择成长股》中的15要点框架逐一评估这家公司。
你关心的不是便宜不便宜，而是这家公司能否持续成长10年以上。

逐一评估以下15个要点（每项0-1分）：
G1  未来几年是否仍有足够大的市场空间来实现可观的营收增长？
G2  管理层是否有决心继续开发新产品或新工艺，使总营收增长潜力不会在短期内耗尽？
G3  与公司规模相比，研发投入的效果如何？
G4  公司是否拥有高于平均水平的销售组织？
G5  公司的利润率是否足够高、值得投资？
G6  公司正在做什么来维持或改善利润率？
G7  公司的劳资关系和员工关系如何？
G8  公司的高管关系如何？团队是否真正协作？
G9  公司的管理层梯队是否有深度？
G10 公司的成本分析和会计控制做得好不好？
G11 是否有行业特有的竞争优势方面值得关注？
G12 公司对短期和长期盈利的展望如何？
G13 未来的成长是否需要大量融资从而稀释现有股东？
G14 管理层是否在一切顺利时才侃侃而谈，出了问题就三缄其口？
G15 管理层的诚信是否毫无疑问？

输出 JSON：
- scores: 每个要点的评分对象，如 {"G1": 0.8, "G2": 0.9, ...}
- fisher_total: 总分（0-15）
- growth_verdict: "compounder" | "cyclical" | "declining" | "turnaround"
- revenue_cagr_3yr: 近3年营收复合增长率（小数）
- tam_assessment: 总可寻址市场评估
- management_candor_score: 管理层坦诚度（0-10）
- green_flags: 积极信号列表（标注对应G编号）
- red_flags: 警示信号列表（标注对应G编号）
- summary: 一句话总结""" + _JSON_RULES + """

示例输出格式：
{"scores":{"G1":0.9,"G2":0.9,"G3":0.7,"G4":0.9,"G5":1.0,"G6":0.8,"G7":0.7,"G8":0.9,"G9":0.8,"G10":0.8,"G11":1.0,"G12":0.8,"G13":0.9,"G14":0.8,"G15":1.0},"fisher_total":12.9,"growth_verdict":"compounder","revenue_cagr_3yr":0.09,"tam_assessment":"服务市场持续扩张，TAM仍有显著空间","management_candor_score":8,"green_flags":["G1:服务业务TAM持续扩张","G5:净利率27%远超同行","G15:管理层诚信无疑"],"red_flags":["G3:研发投入巨大但近期无颠覆性新品","G6:利润率已处高位提升空间有限"],"summary":"高质量复利机器，15要点评分优秀，管理层值得长期信任"}
"""

_SKILL3_SYSTEM = """你是查理·芒格，运用多元心智模型和反转思维来审计这笔投资。
你的任务不是证明这家公司好，而是拼命寻找它不好的理由。如果你找不到致命缺陷，它可能确实值得持有。

分析框架：
1. 反转思维（Inversion）：什么会摧毁这家公司？
   - 技术颠覆、监管打压、竞争侵蚀、管理腐败、宏观冲击
2. Lollapalooza效应：多种正向/负向力量叠加时的超级效果
3. 红旗检查清单（触发即高度警惕）：
   - 收入质量差（应收增速 > 营收增速）
   - 利润虚高（经营CF持续低于净利润）
   - 频繁更改会计准则
   - 管理层大额减持
   - 依赖单一客户/市场 > 30%
   - 高杠杆遇利率上行
   - 市场份额被持续蚕食
4. 二阶思维：如果市场上所有人都看好这家公司会发生什么？
5. 能力圈：普通投资者能理解这门生意吗？

输出 JSON：
- critical_risks: 关键风险列表 [{type, probability, impact, timeline}]
  - probability/impact: "low" | "medium" | "high"
  - timeline: 风险显现的时间跨度
- lollapalooza_positive: 正向叠加效应
- lollapalooza_negative: 负向叠加效应
- checklist_red_flags: 触发的红旗（未触发则空列表）
- fatal_scenario: 最致命的单一失败情景
- resilience_score: 抗压韧性（0-10）
- summary: 一句话总结""" + _JSON_RULES + """

示例输出格式：
{"critical_risks":[{"type":"全球反垄断监管","probability":"medium","impact":"high","timeline":"2-5年"},{"type":"AI平台颠覆","probability":"low","impact":"high","timeline":"5-10年"}],"lollapalooza_positive":["品牌×网络效应×切换成本三重叠加"],"lollapalooza_negative":["高估值×监管打压×增长放缓多重挤压"],"checklist_red_flags":["高杠杆+利率上行"],"fatal_scenario":"若反垄断裁决强制开放生态系统，服务业务将受重创","resilience_score":8.0,"summary":"护城河深厚但监管风险是最大隐患，整体韧性强"}
"""

_SKILL4_SYSTEM = """你是一名综合分析师，整合巴菲特（商业质量）、费雪（成长质量）、芒格（风险审计）三大框架给出最终裁决。

你需要回答两个问题——按顺序：

问题一：这是一家值得长期持有的好公司吗？
- 综合前三个分析的结论
- 护城河是否足够宽且在加强？
- 费雪评分是否 > 10？
- 芒格是否找到了致命缺陷？
- 这门生意你能理解吗？10年后它大概率还在赚钱吗？

问题二：当前价格是否合适？（只有问题一答案为"是"时才有意义）
注意：不要做任何折现率计算或DCF估值。你无法精确预测未来现金流增长率。
而是用常识和生意人视角思考：
- 假如你是一个富商，有人以当前市值的价格把这整家公司卖给你，你愿意买吗？
- 这个价格是市场在恐慌甩卖、理性定价、还是狂热追捧？
- 和同等质量的其他好公司相比，这个价格贵不贵？
- 如果你买入后股市关闭5年无法卖出，你是否安心？

裁决标准：
- quality_verdict: 公司质量评级
  - EXCELLENT: 护城河宽+费雪>12+无致命风险
  - GOOD: 护城河宽/窄+费雪>10+风险可控
  - MEDIOCRE: 护城河窄/无+费雪<10
  - POOR: 无护城河或有致命缺陷
- action:
  - BUY: 好公司 + 价格合理或便宜
  - WATCH: 好公司但价格偏贵，等待机会
  - AVOID: 公司质量不达标，或风险过大

输出 JSON：
- quality_verdict: "EXCELLENT" | "GOOD" | "MEDIOCRE" | "POOR"
- long_term_hold: true/false（你愿意持有10年以上吗？）
- conviction: 信心度（0.0-1.0）
- price_assessment: "cheap" | "fair" | "expensive" | "bubble"
- reasoning: 价格评估的推理过程（用常识，不要算折现率，2-3句话）
- action: "BUY" | "WATCH" | "AVOID"
- hold_horizon: 建议持有时间
- sell_triggers: 什么情况下应该卖出（列表）
- philosophy_scores: 三大框架评分 {"buffett": 0-10, "fisher": 0-10, "munger": 0-10}
- one_sentence: 一句话投资结论""" + _JSON_RULES + """

示例输出格式：
{"quality_verdict":"EXCELLENT","long_term_hold":true,"conviction":0.75,"price_assessment":"expensive","reasoning":"这是一门顶级生意，但当前市场对它的追捧已经非常充分，几乎没有给任何坏消息留出缓冲。如果股市关闭5年，你会安心持有，但以这个价格买入的回报可能只是平庸","action":"WATCH","hold_horizon":"10年以上","sell_triggers":["护城河被实质性侵蚀","管理层诚信出现问题","出现更好的资本配置机会"],"philosophy_scores":{"buffett":9,"fisher":9,"munger":8},"one_sentence":"顶级好公司但市场定价已充分反映其优秀，耐心等待市场恐慌时的机会"}
"""

# ── Provider Map ───────────────────────────────────────────────────────────

_PROVIDER_MAP = {
    "anthropic": LLMProvider.ANTHROPIC,
    "openai":    LLMProvider.OPENAI,
    "deepseek":  LLMProvider.DEEPSEEK,
    "google":    LLMProvider.GOOGLE,
    "qwen":      LLMProvider.QWEN,
    "minimax":   LLMProvider.MINIMAX,
    "doubao":    LLMProvider.DOUBAO,
}

SKILL_PIPELINE = [
    ("moat_assessment",  _SKILL1_SYSTEM, MoatAssessmentOutput),
    ("fisher_fifteen",   _SKILL2_SYSTEM, FisherFifteenOutput),
    ("munger_risk",      _SKILL3_SYSTEM, MungerRiskOutput),
    ("verdict",          _SKILL4_SYSTEM, VerdictOutput),
]


class CompanySkillRunner:
    def __init__(self, model_config: dict, company_data: dict):
        self.model_config = model_config
        self.company_data = company_data
        self._adapter = None
        self._data_context = format_company_data_for_prompt(company_data)

    def _get_adapter(self):
        if self._adapter is None:
            provider_name = self.model_config["provider"]
            provider = _PROVIDER_MAP.get(provider_name)
            if not provider:
                raise ValueError(f"Unsupported provider: {provider_name}")

            base_url = self.model_config.get("base_url")
            if provider_name == "google" and not base_url:
                base_url = getattr(settings, "google_api_base_url", None)

            self._adapter = LLMAdapterFactory.create_adapter(
                provider=provider,
                api_key=self.model_config["api_key"],
                model=self.model_config["model"],
                config=LLMConfig(temperature=0, max_tokens=4096),
                base_url=base_url,
            )
        return self._adapter

    def _build_user_message(self, accumulated: list[dict]) -> str:
        """Data context + previous skill summaries injected into user message."""
        parts = [
            "以下是这家公司的财务数据和业务信息：\n",
            "【重要提示】以下数据标记为 [数据缺失] 的部分表示无法获取，请基于已有数据分析，明确标注哪些结论缺乏数据支持。不要对缺失数据进行猜测或编造。\n",
            self._data_context,
        ]
        if accumulated:
            parts.append("\n\n以下是前序分析结论（请在此基础上深化而非重复）：")
            for prev in accumulated:
                parts.append(f"\n【{prev['skill']}】{prev['summary']}")
        return "\n".join(parts)

    async def _run_skill(
        self,
        system_prompt: str,
        accumulated: list[dict],
    ) -> str:
        adapter = self._get_adapter()
        user_message = self._build_user_message(accumulated)
        is_anthropic = self.model_config.get("provider") == "anthropic"

        messages = [
            LLMMessage(role="system", content=system_prompt),
            LLMMessage(role="user", content=user_message),
        ]

        # Anthropic prefill trick: force JSON output by pre-filling "{"
        if is_anthropic:
            messages.append(LLMMessage(role="assistant", content="{"))

        raw = ""

        async def _collect():
            nonlocal raw
            async for chunk in adapter.chat(messages, stream=False):
                raw += chunk

        await asyncio.wait_for(_collect(), timeout=SKILL_TIMEOUT)

        # Restore the prefilled "{" since it's not in the streamed output
        if is_anthropic:
            raw = "{" + raw

        return raw

    async def run_pipeline(self) -> dict:
        accumulated: list[dict] = []
        results: dict[str, Any] = {}
        total_start = time.time()

        for skill_name, system_prompt, output_schema in SKILL_PIPELINE:
            skill_start = time.time()
            logger.info(f"[company_pipeline] skill={skill_name} model={self.model_config['model']}")

            try:
                raw = await self._run_skill(system_prompt, accumulated)
                parsed, parse_status = parse_skill_output(raw, output_schema)
            except asyncio.TimeoutError:
                logger.error(f"[company_pipeline] TIMEOUT: {skill_name}")
                raw, parsed, parse_status, error_detail = "", None, "timeout", "timeout after 120s"
            except Exception as e:
                logger.error(f"[company_pipeline] ERROR: {skill_name}: {e}", exc_info=True)
                raw, parsed, parse_status, error_detail = "", None, "error", str(e)
            else:
                error_detail = None

            latency_ms = int((time.time() - skill_start) * 1000)
            parsed_dict = parsed.model_dump() if parsed else {}

            skill_result: dict[str, Any] = {
                "parsed": parsed_dict,
                "raw": raw,
                "parse_status": parse_status,
                "latency_ms": latency_ms,
            }
            if error_detail:
                skill_result["error"] = error_detail
            results[skill_name] = skill_result

            # Pass summary to next skill
            summary = parsed_dict.get("summary") or (raw[:400] if raw else "(no output)")
            accumulated.append({"skill": skill_name, "summary": summary, "parsed": parsed_dict})

            logger.info(
                f"[company_pipeline] {skill_name} done "
                f"status={parse_status} latency={latency_ms}ms"
            )

        total_latency_ms = int((time.time() - total_start) * 1000)

        verdict_dict = results.get("verdict", {}).get("parsed", {})
        verdict = VerdictOutput(**verdict_dict) if verdict_dict else VerdictOutput()

        # Build trace
        trace = []
        for skill_name, _, _ in SKILL_PIPELINE:
            r = results.get(skill_name, {})
            entry = {
                "skill": skill_name,
                "status": r.get("parse_status", "unknown"),
                "latency_ms": r.get("latency_ms", 0),
            }
            if r.get("error"):
                entry["error"] = r["error"]
            trace.append(entry)

        return {
            "skills": results,
            "verdict": verdict.model_dump(),
            "total_latency_ms": total_latency_ms,
            "trace": trace,
        }
