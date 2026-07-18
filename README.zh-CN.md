# Carrick AI GameBench

Carrick AI GameBench（CAGB）是一套面向 Coding Agent 的可复现网页游戏开发评测。

- **Build**：根据冻结需求从零构建游戏。
- **Reproduce**：复刻有明确许可证的现有游戏玩法、手感和视觉。

可信机器榜只使用公开、确定性的浏览器测试；人类试玩结果通过盲化两两比较
单独发布，不与机器分混合。

## 快速开始

需要 Node.js 22.12+、pnpm 10、Docker 及 Chromium 运行依赖。

```bash
pnpm install
pnpm build
pnpm cagb doctor
pnpm cagb list
pnpm cagb validate-task --all
```

仓库内包含 8 个带版本任务：6 个 Build 和 2 个 Reproduce。

运行任意本地 Agent 命令：

```bash
pnpm cagb run \
  --task build.2048.v1 \
  --agent-command './my-agent --prompt-file "$CAGB_PROMPT_PATH"' \
  --agent-id my-agent
```

本地默认只运行一次；加入 `--official` 后使用三个全新工作区运行，并生成待审计
证据包。此时 `run.json` 仍是 `verified: false`；只有独立执行者确认网络策略、
校验证据摘要，并在发布的 evaluator 镜像中复跑后，才能进入正式榜单。

构建固定评测环境：

```bash
pnpm docker:build
```

详细说明参见 [方法学](docs/methodology.md)、[架构](docs/architecture.md)、
[任务编写指南](docs/task-authoring.md)和[版本规则](docs/versioning.md)。

## 扩展游戏

每个游戏版本都是
`benchmark/tasks/<build|reproduce>/<game-slug>/vN/` 下的独立任务包，
自带中英文提示、状态 Schema、测试用例，以及必要的合法参考材料。新增游戏或
版本通常不需要修改评测器。

每次 Benchmark 发布都会在
`benchmark/releases/<benchmark-version>.json` 中冻结任务 ID、语义化版本和
内容哈希。`pnpm cagb release-lock` 用于核对当前发布，只有在明确提升
Benchmark 版本后才应使用 `--write` 生成新清单。

## v1 的明确边界

- 所有测试公开。Official 身份依靠证据、审计和复跑，而不是隐藏测试。
- 通用 shell adapter 在执行者宿主机运行，只记录网络策略，不自行提供网络防火墙。
  Reproduce 正式运行必须由受控 Harness 仅放行声明的模型 API 域名。
- 机器分仅使用确定性检查；人类偏好通过独立的盲化试玩结果表达。

## 许可证

代码采用 Apache-2.0；自有任务、文档、媒体和结果数据采用 CC BY 4.0；
第三方内容继续使用其上游许可证。
