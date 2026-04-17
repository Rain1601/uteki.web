# Company Agent Eval Fixtures

评测 Company Agent 的**黄金数据集**（golden set），覆盖 4 象限：

| 象限 | 文件 | 类型 | 主测维度 |
|---|---|---|---|
| 优质高增长 | `tsmc_2023.yaml` | compounder | Consistency + Effectiveness 正向 |
| 成熟蓝筹 | `apple_2023.yaml` | compounder (slowing) | Logic 估值细腻判断 |
| 财务造假 | `luckin_2019.yaml` | trap | Effectiveness 雷股 recall |
| 高杠杆困境 | `evergrande_2020.yaml` | trap | Logic 结构性风险推理 |
| 数据缺失 | `sparse_data.yaml` | adversarial | Credibility anti-hallucination |

字段定义见 [`_schema.yaml`](./_schema.yaml)。整体设计见 [`docs/ADR-evaluation-framework.md`](../../../../docs/ADR-evaluation-framework.md)。

## 数据填充状态

当前所有 fixture 的财务数据字段标注为 `# TODO` 或为占位真实值，**实际评测前需要**：

1. 从 FMP / SEC Edgar / Wind 拉 point-in-time 真实财报数据
2. `tool_mocks` 的 `response` 字段写入可信信息源
3. `expected` 字段由投资分析师人工标注 review

## 运行评测

```bash
# 未来 Runner 就绪后的调用方式
poetry run python -m uteki.domains.evaluation.runners.consistency_runner \
  --skill company.fisher_qa \
  --fixture tsmc_2023 \
  --model claude-sonnet-4-20250514

poetry run python -m uteki.domains.evaluation.runners.effectiveness_runner \
  --fixture-dir backend/tests/fixtures/companies/ \
  --include-trap-set
```

## 新增 fixture 的标准流程

1. 复制 `_schema.yaml` 为模板
2. 选定 vintage 后从 PIT 数据源拉真实财报
3. 所有 `tool_mocks.response` 必须引用真实公开信息（禁止编造）
4. `expected` 字段由两名 reviewer 交叉确认
5. PR 合并前必须在 PR 描述里附上该 case 的来源说明

## 已知限制

- Forward return 字段（`forward_return_12m` / `forward_return_36m`）仅适用于 historical set，当前 fixtures 的值为事后已知信息，仅用于效果评估时比对
- `sparse_data.yaml` 为合成样本，不对应真实公司
- 数据版权：请勿把付费数据源（Wind / Bloomberg）的原始数据直接入库，用公开 EDGAR / 港交所披露为准
