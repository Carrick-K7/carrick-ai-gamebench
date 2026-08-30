# Carrick AI GameBench

Carrick AI GameBench 0.6 是一套轻量的 Coding Agent 网页游戏机器评测，以公开、可检查的交付契约为核心。

正式评测只有四个 Build 任务：

- 2048：离散规则和键盘输入；
- 扫雷：带 seed 的隐藏状态和鼠标输入；
- 2D 停车：连续运动、碰撞和几何判定；
- 六人德州扑克：下注状态、牌型、all-in、边池和筹码守恒。

每个任务只调用一次 Agent。交付源码会立即封存，再解包到新目录中，以唯一 canonical seed `104729` 评测一次。Build 总分是四项分数的等权平均。0.6 不再包含 Reproduce、Core、verifier、Docker 或三 seed 重复评测。

## 快速开始

需要 Node.js 22.12+、pnpm 10.33.0、Chromium 运行依赖、`tar` 和 `zstd`。

```bash
pnpm install
pnpm build
pnpm cagb doctor
pnpm cagb check
```

`doctor` 会在正式调用模型前，真实执行临时目录安装、离线重装、构建、预览服务、Chromium 启动和 Bridge smoke test。

执行一个预注册 Official Campaign cell：

```bash
pnpm cagb bench \
  --campaign pi-system-baseline-2026-08-30 \
  --cell gpt-5.6-sol
```

Official 身份、Pi 调用、模型、provider、输出路径和预分配 series ID 只能来自已提交的 Campaign Plan。Official 运行要求 Git 工作树干净；自由 Agent 命令仅允许配合 `--local` 用于开发 runner 或 adapter。

检查结果：

```bash
pnpm cagb check --run runs/0.6.0/<series-id>
```

所有 Campaign cell 完成后，统一校验并批量发布：

```bash
pnpm cagb campaign check
pnpm cagb campaign publish --id pi-system-baseline-2026-08-30
```

## 工作流程为什么必要

1. **Release lock**：确保所有模型面对相同 prompt、测试、分值、seed 和任务 hash。
2. **真实 preflight**：在消耗模型算力前发现宿主机问题。
3. **全新 workspace**：不同任务和模型之间不会继承隐藏文件或状态。
4. **一次 Agent 调用**：控制机会和算力，失败后不重复开发。
5. **封存源码**：评测对象不能在交付后被静默修复。
6. **新目录评测**：确认源码可以独立安装、构建和运行。
7. **公开浏览器 cases**：通过真实输入和 Schema 状态检查客观计分。
8. **完整性检查**：不重复评测，只重查文件 hash、计分算术、release 身份和覆盖率。
9. **可选 Git 发布**：让正式结果进入可 review、不可静默覆盖的历史记录。

基础设施错误不会被记成模型 0 分。Evaluator 可以对同一个冻结 `source_hash` 重试阅卷，但不能再次调用 Agent。真正的契约失败正常扣分，也可能得到 0 分。

0.6 的 Official 只表示“由项目维护方使用 canonical runner 运行并提交”，不声称已经由独立第三方复现。

## 任务包

每个 active task 位于 `benchmark/tasks/build/<game>/vN/`，自带中英文 prompt、严格状态 Schema、公开浏览器 cases 和 100 分 manifest。`benchmark/releases/0.6.0.json` 冻结完整四任务目录。

详细说明参见[方法学](docs/methodology.md)、[架构](docs/architecture.md)、[Campaign 与运行目录架构](docs/campaign-architecture.md)、[任务编写](docs/task-authoring.md)、[结果发布](docs/results-and-publication.md)和[版本规则](docs/versioning.md)。

## 边界

- 机器契约分数具有权威性；可选人类反馈永不改变排名。
- 测试完全公开；本 Benchmark 衡量契约交付，不衡量创意或趣味。
- CLI 与模型供应商无关，不内置 provider SDK。
- 公开网站是静态站点，没有数据库或公开提交服务。
- 生成的 workspace 和 provider credential 永不提交。

## 许可证

代码采用 Apache-2.0；自有任务、文档、媒体和结果数据采用 CC BY 4.0。
