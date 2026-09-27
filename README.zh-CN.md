# Carrick AI GameBench

GameBench 分成两套独立评测：**Build 测 AI 做游戏，Play 测 AI 玩游戏**。**0.7.0** 新增 Play 评测，并收敛执行、校验和发布流程（[发布说明](docs/releases/0.7.0.md)）；没有新增实测模型成绩或部署。历史 0.6 评分、hash、结果和网址保持不变（[0.6.1 发布说明](docs/releases/0.6.1.md)）。

| 套件 | 评测对象 | 排名指标 |
| --- | --- | --- |
| Build | 每项任务一次 Agent 开发、冻结交付源码 | 四项百分制契约分数等权平均 |
| Play / 2048 | 10 局，每局 200 次截图/原生输入决策 | 游戏原始分的均值 |
| Play / 扫雷 | 10 局 10×10/10 雷棋盘，每局 128 次决策 | 胜率 |

**不计算 Build/Play 总分，也不计算跨游戏 Play 总分。** Play 使用维护方自有固定游戏，不使用 AI 的 Build 交付物。`/play` 提供独立榜单和明确不计分的人类练习入口。操作方式见 [Play 运行指南](docs/play-operations.md)。

## Build：保留原评分口径

完整 Build 评测包含四个任务：

- 2048：离散规则和键盘输入；
- 扫雷：带 seed 的隐藏状态和鼠标输入；
- 2D 停车：连续运动、碰撞和几何判定；
- 六人德州扑克：下注状态、牌型、all-in、边池和筹码守恒。

每个任务只调用一次 Agent。交付源码会立即封存，再解包到新目录中，以唯一 canonical seed `104729` 评测一次。Build 总分是四项分数的等权平均。0.6 不再包含 Reproduce、Core、verifier、Docker 或三 seed 重复评测。

## 快速开始

需要 Node.js 22.12+、pnpm 10.33.0、Chromium 运行依赖、`tar` 和 `zstd`。

```bash
pnpm install --frozen-lockfile
pnpm --filter @carrick/gamebench exec playwright install --with-deps chromium
pnpm build
pnpm cagb doctor
pnpm cagb check
```

`doctor --suite build` 真实执行安装、离线重装、构建和浏览器预检。`doctor --suite play` 检查两套参考游戏与外置无工具 Pi 适配器，不调用模型推理。Play 需另行安装 Pi 0.84.3 并配置支持图像的模型；Core/Evaluator 不内置供应商 SDK。

在完成审核、校准并提交 `benchmark/campaigns/0.7.0/` 下的新 Campaign v2 后，才能执行预注册 Official Build cell（以下示例不是授权付费执行）：

```bash
pnpm cagb bench \
  --campaign your-campaign-id \
  --cell your-cell-id
```

0.7.0 当前没有实测 Campaign 或新模型成绩。原有计划与结果保留历史身份，不改名，也不复用已经执行的 cell。

Official 身份、Pi 调用、模型、provider、输出路径和预分配 series ID 只能来自已提交的 Campaign Plan。Official 运行要求 Git 工作树干净；自由 Agent 命令仅允许配合 `--local` 用于开发 runner 或 adapter。

检查结果：

```bash
pnpm cagb check --run runs/0.7.0/<series-id>
```

所有 Campaign cell 完成后，统一校验并批量发布：

```bash
pnpm cagb campaign check
pnpm cagb campaign publish --id your-campaign-id
```

## 工作流程为什么必要

1. **Release lock**：确保所有模型面对相同 prompt、测试、分值、seed 和任务 hash。
2. **真实 preflight**：在消耗模型算力前发现宿主机问题。
3. **全新 workspace/上下文**：避免意外继承；不等于操作系统沙箱或宿主机真实性证明。
4. **一次 Agent 调用**：统一尝试次数和时限，失败后不重复开发；不代表 token、推理算力或费用相等。
5. **封存源码**：评测对象不能在交付后被静默修复。
6. **新目录评测**：确认源码可以独立安装、构建和运行。
7. **公开浏览器 cases**：通过真实输入和 Schema 状态检查客观计分。
8. **完整性检查**：不重复评测，只重查文件 hash、计分算术、release 身份和覆盖率。
9. **可选 Git 发布**：让正式结果进入可 review、不可静默覆盖的历史记录。

基础设施错误不会被记成模型 0 分。Evaluator 可以对同一个冻结 `source_hash` 重试阅卷，但不能再次调用 Agent。真正的契约失败正常扣分，也可能得到 0 分。

0.6 的 Official 只表示“由项目维护方使用 canonical runner 运行并提交”，不声称已经由独立第三方复现。

## 任务包

每个 active task 位于 `benchmark/tasks/build/<game>/vN/`，自带中英文 prompt、严格状态 Schema、公开浏览器 cases 和 100 分 manifest。`benchmark/releases/0.7.0.json` 中的 Build 部分沿用 0.6.0/0.6.1 的四任务 hash 和单 seed 口径。Play 自有游戏位于 `benchmark/play/<game>/v1/`，由独立的游戏 hash 和视觉协议冻结。

详细说明参见[方法学](docs/methodology.md)、[0.6 设计审查](docs/benchmark-design-review.md)、[架构](docs/architecture.md)、[Campaign 与运行目录架构](docs/campaign-architecture.md)、[任务编写](docs/task-authoring.md)、[结果发布](docs/results-and-publication.md)和[版本规则](docs/versioning.md)。

## 边界

- 机器契约分数具有权威性；可选人类反馈永不改变排名。
- 测试完全公开；本 Benchmark 衡量契约交付，不衡量创意或趣味。
- CLI 与模型供应商无关，不内置 provider SDK。
- 公开网站是静态站点，没有数据库或公开提交服务。
- 生成的 workspace 和 provider credential 永不提交。

## 许可证

代码采用 Apache-2.0；自有任务、文档、媒体和结果数据采用 CC BY 4.0。
