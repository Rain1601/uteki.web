# ADR: Agent Skill 评测框架

- **状态**: Proposed
- **日期**: 2026-04-17
- **相关**: Skill 化改造（`backend/uteki/skills/`）、现有 `domains/evaluation/`

## 背景

Company Agent 目前以 7-gate 硬编码 pipeline 运行（`domains/company/skills.py`）。迁移到 skill 化架构（`backend/uteki/skills/{domain}/{skill}/SKILL.md`）后，每个 skill 成为可独立迭代的单元，需要配套的分层评测体系来保证：

1. Prompt 改动不悄悄降级
2. 跨模型（Claude / GPT / DeepSeek）切换时质量可量化对比
3. 线上报告的结论有可追溯的证据链，不是幻觉

现有 `EvaluationService.run_consistency_test` 只测端到端一致性，粒度太粗，无法定位是哪一个 skill 退化。

## 决策

采用 **4 主维度 + 5 辅助维度** 的分层评测体系，落在三层：Tool → Skill → Pipeline。

### 四个主维度

#### 1. 一致性（Consistency）

**定义**：固定输入下输出稳定。

**关键认知**：`temperature=0` 不等于完全确定性。原因：
- GPU 浮点 reduction 顺序不保证
- API 侧 batching/采样抖动
- 模型版本静默更新
- Tool 返回值本身变化（`web_search` 每日结果不同）

**测试前提——必须 mock 的外部变量**：

```python
async def run_consistency_test(skill, input_data, n=10):
    with mock_tools(fixed_responses), mock_time("2024-04-17"), pinned_model_version():
        results = await asyncio.gather(*[run_skill(skill, input_data) for _ in range(n)])
    return compute_consistency_metrics(results)
```

**指标**：

| 层级 | 指标 | 目标 |
|---|---|---|
| Token 级 | Normalized Levenshtein | 参考值 |
| 数值字段 | CV = stdev / mean | < 0.10 |
| 分类字段 | Mode 占比 | ≥ 0.80 |
| 分类字段 | Cohen's kappa | ≥ 0.60 |
| 工具调用 | 调用序列 Levenshtein | < 3 |
| 结论 | Action 一致率 | ≥ 0.80 |

**特殊监控**：
- **Cross-session drift**：每周同一输入跑一次，时序图上检测 API 侧模型版本变更
- 变异突增即告警（说明上游模型在静默升级）

#### 2. 可信度（Credibility）

**定义**：报告中每个数字、每条引用都能追溯到真实来源。

**追溯链**：

```
报告结论 → 证据引用 → 数据源真实性
                         ├─ 财务数据输入（权威）
                         ├─ Tool 调用结果（web_search / compare_peers）
                         └─ 第三方交叉验证（FMP / Yahoo Finance）
```

**核心实现**：

```python
async def trace_numbers(report, raw_financials, tool_results):
    numbers = extract_numbers_with_context(report)  # 正则 + LLM 辅助抽取
    hallucinations = []
    for num, context in numbers:
        sources = [raw_financials, *tool_results]
        if not any(value_matches(num, src, tolerance=0.02) for src in sources):
            hallucinations.append({"number": num, "context": context})
    return hallucinations
```

**四类检查**：

1. **数字溯源率**：报告中每个数字必须能匹配输入数据或工具结果。目标幻觉率 < 2%
2. **URL 可达性**：报告引用 URL 全部返回 HTTP < 400
3. **第三方 fact-check**：关键数字（营收、利润、PE）用独立源对比，误差 > 5% 即标记
4. **时效性**：报告中出现的季度/年份必须在输入覆盖范围内

**负向测试（anti-hallucination）**：

喂极度贫瘠输入（只有公司名，无财务数据），期望模型：
- 所有 `score` 标注 `data_confidence: "low"`
- 不给出具体数字和高置信度
- 明确标注"数据缺失"

#### 3. 逻辑性（Logic）

**定义**：推理过程自洽、证据支撑结论、无内部矛盾。

**四类逻辑缺陷及检测方法**：

| 缺陷类型 | 示例 | 检测方法 |
|---|---|---|
| 内部矛盾 | Gate 3 "护城河宽" + "份额快速流失" | LLM Judge + 关键词对抗 |
| 证据-结论不匹配 | `moat_width=wide` 但 `moat_evidence=[]` | 硬规则（Pydantic validator） |
| 跨 skill 矛盾 | Gate 2 "compounder" + Gate 5 "resilience 3/10" | Reflection Checker（已有） |
| 推理跳跃 | 结论无上下文支撑 | LLM Judge 专项 |

**硬规则示例**：

```python
class MoatAssessmentReport(BaseModel):
    moat_width: Literal["wide", "narrow", "none"]
    moat_evidence: list[str]
    moat_types: list[MoatType]

    @model_validator(mode="after")
    def validate_evidence_strength_alignment(self):
        if self.moat_width == "wide":
            assert len(self.moat_evidence) >= 3, "wide moat requires ≥3 evidence"
            assert any(t.strength == "strong" for t in self.moat_types)
        return self
```

**对抗性输入**：

构造故意矛盾的数据，看模型能否识别：

```yaml
# fixtures/companies/adversarial_growth_but_no_cashflow.yaml
revenue_growth: 0.45            # 营收高增
operating_cash_flow: -200000000 # 经营现金流持续为负
net_income: 180000000           # 但利润为正 → 利润虚高信号
expected:
  gate5_red_flags_triggered:
    - "经营CF持续低于净利润"
    - "收入质量差"
```

**指标**：
- Reflection 矛盾数 / run
- Pydantic validator 失败率
- LLM Judge 逻辑分（0-10）
- 对抗性测试通过率

#### 4. 效果（Effectiveness）

**定义**：推荐是否真能赚钱 / 避雷。

**三类评估，难度递增**：

**A. 专家标注对齐**（短周期，易做）

与 Morningstar / Gurufocus / 雪球牛人评级对比：
- 指标：**专家一致率**，目标 ≥ 60%
- 注意：一致率过高反而是过拟合，代表 agent 只会复述大众共识

**B. 雷股识别（precision / recall）**

维护已暴雷公司清单（瑞幸、恒大、乐视、康美、獐子岛），用**暴雷前**的数据喂给 agent：

```python
TRAP_CASES = [
    ("LUCKIN", "2019-Q4"),      # 造假前
    ("EVERGRANDE", "2020-H1"),  # 违约前
    ("LK", "2019"),             # 乐视
]
for symbol, vintage in TRAP_CASES:
    data = load_pit_data(symbol, vintage)
    verdict = await run_pipeline(data)
    assert verdict["action"] != "BUY"
    assert len(triggered_red_flags(verdict)) >= 3
```

- 目标：雷股 recall ≥ 80%，误杀 precision ≥ 90%

**C. 前瞻性回测**（终极，但风险大）

**最大坑 — 数据泄漏**：
模型训练数据截止 T，用 < T 的数据"回测"毫无意义——模型已经知道后续结果。

**正解**：只用 model cutoff 之后的数据做**前瞻性测试**（forward test）：

```python
class ForwardTest:
    def __init__(self, start_date):
        assert start_date > MODEL_TRAINING_CUTOFF
        self.portfolio = []

    async def run_weekly(self):
        candidates = fetch_sp500_point_in_time(self.current_date)
        for company in candidates:
            verdict = await run_pipeline(company.data_at(self.current_date))
            if verdict["action"] == "BUY":
                self.portfolio.append((company, self.current_date, verdict))

    def compute_alpha(self, end_date):
        returns = [compute_return(d, end_date) for d in self.portfolio]
        spy_return = spy.return_from_to(self.start_date, end_date)
        return mean(returns) - spy_return
```

- 其他坑：survivorship bias（用 PIT 成分股）、look-ahead bias（用事前披露数据）
- 样本量：至少 3 年才有统计意义

### 五个辅助维度

| 维度 | 关键指标 | 目标阈值 |
|---|---|---|
| **成本** | 单次 skill run 美元成本 | < $0.15 |
| **延迟** | p95 端到端耗时 | < 120s |
| **覆盖率** | 各 bucket（行业/市值/国家）完成率 | ≥ 90% |
| **安全性** | Prompt injection 攻击成功率 | 0 |
| **可解释性** | Flesch 可读性 + 用户 👍 率 | 人读友好 |

**安全性特别说明**：`web_search` 返回的网页可能包含对抗性 prompt injection（有人写文章试图操纵 AI 对某公司的评价）。工具层必须做 sanitize：

```python
@register_tool("web_search")
async def web_search(query):
    results = await ddg.search(query)
    for r in results:
        r.content = strip_instruction_like_content(r.content)
    return results
```

## 评测分层架构

```
                ┌──────────────────────────┐
                │  Pipeline 端到端（周跑）   │ 10-50 公司, 贵
                └──────────────────────────┘
              ┌──────────────────────────────┐
              │    Skill 单元（日跑）          │ 每 skill 20-50 case
              └──────────────────────────────┘
           ┌────────────────────────────────────┐
           │      Tool 单元（PR 必跑）            │ mock + 定期 live
           └────────────────────────────────────┘
        ┌──────────────────────────────────────────┐
        │    静态校验（PR 必跑, 零成本）             │
        └──────────────────────────────────────────┘
```

## 数据集设计

| 数据集 | 规模 | 用途 | 获取方式 |
|---|---|---|---|
| **Golden set** | 20-50 公司 | 准确性评测 | 专家手写期望 |
| **Consistency set** | 5-10 代表公司 | 稳定性评测 | 反复跑取方差 |
| **Trap set** | 10-20 雷股 | 健壮性 | 暴雷前 PIT 数据 |
| **Historical set** | 50-100 公司 × 多年 | 前瞻性回测 | 时间切片快照 |
| **Adversarial set** | 10-20 边界 case | 鲁棒性 | IPO / 亏损 / 周期底 / 数据缺失 |

**存储**：
- 小文件（YAML 结构）：`backend/tests/fixtures/companies/`
- 大文件（历史 K 线、财报 JSON）：MinIO bucket `eval-datasets/`，Git LFS 备份

## 目录结构

```
backend/uteki/
├── skills/
│   └── company/
│       └── fisher_qa/
│           ├── SKILL.md
│           ├── schema.py
│           └── evals/              # skill 自带 golden case
│               ├── tsmc_2023.yaml
│               └── luckin_2019.yaml
├── domains/evaluation/
│   ├── eval_report.py              # 四维 + 五辅助 Pydantic schemas (本 ADR 新增)
│   ├── runners/
│   │   ├── consistency_runner.py
│   │   ├── credibility_runner.py
│   │   ├── logic_runner.py
│   │   └── effectiveness_runner.py
│   ├── judges/
│   │   ├── llm_judge.py
│   │   ├── number_tracer.py
│   │   └── url_validator.py
│   └── datasets/
│       └── loader.py
└── tests/
    └── fixtures/
        └── companies/              # 5 样本覆盖 4 象限
            ├── README.md
            ├── _schema.yaml
            ├── tsmc_2023.yaml        # compounder 代表
            ├── apple_2023.yaml       # 成熟蓝筹
            ├── luckin_2019.yaml      # 雷股（Trap set）
            ├── evergrande_2020.yaml  # 困境（Trap set）
            └── sparse_data.yaml      # 对抗样本（数据缺失）
```

## 指标阈值总览

```
fisher_qa skill 健康度:
─────────────────────────
一致性    CV=0.08         目标 <0.10  ✅
可信度    幻觉率=1.2%     目标 <2%    ✅
逻辑性    矛盾数=0.3/run  目标 <1     ✅
效果      雷股 recall=75% 目标 ≥80%   ⚠️
成本      $0.12/run       目标 <$0.15 ✅
延迟      p95=18s         目标 <30s   ✅
```

## CI/CD 集成

```yaml
# .github/workflows/eval.yml
on:
  pull_request:
    paths: ["backend/uteki/skills/**", "backend/uteki/tools/**"]

jobs:
  static-checks:        # <2 min, PR 必跑
    - SKILL.md schema validation
    - Pydantic schema roundtrip
    - Tool name 引用存在性

  tool-mock:            # <5 min, PR 必跑
    - Tool 单测（mock 响应）

  skill-eval:           # ~10 min, 改了 skill 才跑
    if: skill_changed
    - 在变更 skill 上跑 golden set (3-5 case)
    - 对比 main branch baseline
    - PR comment 贴四维对比表

  nightly:              # ~60 min, 每晚
    - 所有 skill 完整 golden set
    - Consistency (n=10)
    - Tool live 测试
    - 成本/延迟回归

  weekly:               # 周一凌晨
    - Trap set 全量跑
    - Forward test 推进一周
    - 跨模型对比（Claude vs GPT vs DeepSeek）
```

## 已知权衡

1. **LLM-as-judge 不稳定**：Judge 本身有偏差。缓解：用 Opus/GPT-4 做 judge + 手动校准 10 case + 多 judge 投票
2. **Golden set 维护成本高**：需要专家持续更新。缓解：优先覆盖 20 个代表公司，每季度补充
3. **前瞻性回测周期长**：至少 3 年才有统计显著性。缓解：先用 trap set 和专家对齐作为代理指标
4. **温度 0 仍有抖动**：不追求字节级一致，而是语义/结构一致

## 非目标

- **不**追求 100% 字节级确定性（物理上不可能）
- **不**替代人类分析师判断（agent 提供候选，人决策）
- **不**做短线择时（本系统只做基本面判断）
- **不**在单 PR 内跑完所有层级（分层触发）

## 下一步

1. 落 Pydantic schemas 到 `domains/evaluation/eval_report.py`
2. 建 5 公司 fixture 骨架（对应 4 象限 + 对抗）
3. 每迁移一个 skill，配套迁移其 golden set 到 `skills/{domain}/{skill}/evals/`
4. 先实现 Consistency Runner（最简单），打通数据流
5. Logic Runner 复用现有 Reflection Checker
6. Credibility Runner 需先实现 `number_tracer` 和 `url_validator`
7. Effectiveness 延后到前三维稳定后

## 参考

- Anthropic *Building Effective Agents*（evaluator-optimizer 模式）
- `domains/company/skills.py` — 当前 7-gate 实现
- `domains/evaluation/service.py` — 已有一致性测试骨架
- `core/tool_parser.py:REFLECTION_PROMPT_GATE3/5` — 已有反思 prompt
