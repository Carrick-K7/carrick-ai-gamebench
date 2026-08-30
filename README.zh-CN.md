# Carrick AI GameBench

Carrick AI GameBench（CAGB）是一套面向 Coding Agent 的可复现网页游戏开发
评测，以公开、可机器验证的交付契约为核心。

- **Build** 衡量从冻结规格到可运行游戏的交付能力，是 v0.5 主榜。
- **Reproduce** 衡量对合法参考游戏的机制、时序、交互和视觉还原能力，独立报告，
  不影响 Build 排名。

可信分数只来自确定性浏览器评测。人工试玩是可选、非计分的定性附注。Build 分
不代表创意或“好玩程度”；未来 Creative benchmark 将使用独立身份、方法、发布
账本和榜单。

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
  --task build.2048.v2 \
  --agent-command './my-agent --prompt-file "$CAGB_PROMPT_PATH"' \
  --agent-id my-agent
```

在 v0.5 协议中，每个 task 只调用一次 Agent，并生成一份不可变的 submission
源码快照。开发停止并冻结快照后，评测器把同一份源码分别解包到三个全新、隔离的
环境中，以 `104729`、`130363`、`155921` 三个 seed 评测。seed 是同一交付物
的评测条件，不是三次开发，也不会挑选最佳 seed。

`--official` 请求完整固定 seed 评测，并生成待审计的 `official-candidate` 系列。
这不等于自行认证为 Official；正式发布仍需完整的对应榜单覆盖、清洁源码复现和
独立验证。

使用 `--series <ulid>` 可将多个 task 加入同一批评测。v0.5 将 submission 身份
与每次物理 seed 评测的 `run_id` 分开；本地数据仍保存在
`runs/<benchmark>/<series>/`。

将已评分系列发布到 Experimental：

```bash
pnpm cagb publish \
  --series runs/0.5.0/<series-id> \
  --tier experimental \
  --board build \
  --objects .gamebench \
  --base-url https://play.gamebench.ai.carrick7.com

pnpm cagb verify-publication --objects .gamebench
pnpm --filter @carrick/gamebench-site build
```

构建固定评测环境：

```bash
pnpm docker:build
```

## Benchmark 展示面

- Build：2048、扫雷、2D 停车、俄罗斯方块、横版射击和塔防。完整 Build 覆盖
  产生主榜分数。
- Reproduce：OhSteem 和 Radius Raid。Reproduce 拥有独立覆盖率和分数，与
  Build 分开显示。

详细说明参见 [方法学](docs/methodology.md)、[架构](docs/architecture.md)、
[任务编写指南](docs/task-authoring.md)、[版本规则](docs/versioning.md)、
[结果发布](docs/results-and-publication.md)、[结果提交规则](docs/result-submissions.md)、
[公开网站设计](docs/public-site.md)、[仓库边界 ADR](docs/adr/0001-repository-boundaries.md)
和[部署](docs/deployment.md)。

## 扩展游戏

每个游戏版本都是
`benchmark/tasks/<build|reproduce>/<game-slug>/vN/` 下的独立任务包，
自带中英文提示、状态 Schema、测试用例，以及必要的合法参考材料。

Agent 会收到公开用例、计分清单和状态契约。冻结后的 submission 必须支持任意
bridge reset seed。正式 seed 只在源码快照密封后使用；每个全新评测环境都针对
完全相同的源码字节执行同一份公开契约。

每次 Benchmark 发布都会在
`benchmark/releases/<benchmark-version>.json` 中冻结任务 ID、语义版本、
内容哈希、协议版本、榜单策略和评测 seed。`pnpm cagb release-lock` 用于核对
当前发布；只有明确提升 Benchmark 版本后才应使用 `--write`。

## 明确边界

- 所有测试公开。Official 身份依靠可复现证据和审计，而不是隐藏测试、LLM judge
  或 VLM judge。
- 机器契约评测具有权威性。人工偏好只能作为可选定性附注，永不改变排名。
- Build 是 v0.5 主榜；Reproduce 独立展示，不能提高、降低或阻断 Build 分数。
- 每个 task 一次 Agent invocation、一个 submission；三个 seed 分数全部来自对
  同一冻结源码快照的全新环境评测。
- 通用 shell adapter 在执行者宿主机运行，只记录网络策略，不自行提供网络防火墙。
- 公开网站完全静态。Git 保存审核后的结果元数据，大型源码、试玩包和证据使用
  内容寻址对象目录；没有数据库和公开提交 API。
- 公开页面展示所有纳入聚合的 seed 评测，绝不挑选最高分条件。
- 创意、新颖性、审美和趣味不属于本 benchmark 的可信分数。未来 Creative
  benchmark 会独立发布，而不是加入为 GameBench 的第三条 track。

## 历史兼容

v0.1-v0.4 保持不可变，并保留原有语义：这些版本的 Official candidate 对每个
任务执行三次全新的 Agent 开发，历史 aggregate schema 也可能发布将 Build 与
Reproduce 合并的 Core 分。旧版本 reader、release lock、结果页和不可变
publication ID 继续有效；v0.5 不会追溯重释或重新排名。

## 许可证

代码采用 Apache-2.0；自有任务、文档、媒体和结果数据采用 CC BY 4.0；第三方
内容继续使用其上游许可证。
