# Carrick AI GameBench — 存量报告（归档）

- 归档日期：2026-10-23
- 状态：**停止维护，不再演进**；代码、数据、站点全部保留，instrument 冻结在 0.7.0
- 代码最后提交：`bb4a0f4`（2026-09-28，0.7.0 发布准备）
- 最后一次实测：2026-09-01（0.6.0 campaign）

这篇不是论文，是这个项目留下什么的清单和结论：它原本想做什么、实际跑出了什么、为什么停、停在哪里、还剩什么能用。

---

## 1. 结论

停止维护。两条理由，都是硬理由：

**一、同类能力已经有公开基准，而且比这里大一个数量级。**

Build 侧（AI 做游戏）已有 GameCraft-Bench（140 个 Godot 任务、15 个游戏族）和 GameXpert-Bench（97 个生成任务 + 100 个修复任务 + 17 条优化链）；Play 侧（AI 玩游戏）已有 VideoGameBench、CUA-bench、lmgame-Bench、Orak、ARC-AGI-3、OmniGameArena。这里的四任务 Build 和两游戏 Play，在这两个方向上都不提供增量。

**二、收益不高，而且 instrument 已经撞到天花板。**

0.5.0/0.6.0 的前沿 coding agent 在四任务上拿到 96.25–98.75 分，满分附近没有区分空间；剩下的区分度只出现在中低端模型。个人项目在模型每两个月换代一次的节奏下，既追不上重测频率，也不可能积累引用。投入产出不成立。

**留下的东西不清零：** 6 个 git tag、10 份 release lock、57 组 run、12 条已发布记录、两个在线只读站点，全部按原样保留。归档的含义是"不再动"，不是"删掉"。

---

## 2. 它原本是什么

两套互不合并的 instrument，没有总分。

| 套件 | 评测对象 | 排名指标 | 实测 |
| --- | --- | --- | --- |
| **Build** | 每任务一次 coding-agent 开发调用、冻结交付源码 | 四项 100 分契约等权平均 | 有（0.3–0.6） |
| **Play / 2048** | 10 局 × ≤200 次截图/原生输入决策 | 游戏原始分均值 | **从未实测** |
| **Play / Minesweeper** | 10 局 10×10/10 雷 × ≤128 次决策 | 胜率 | **从未实测** |

Build 的四个任务：2048（离散规则 + 键盘）、Minesweeper（种子化隐藏状态 + 指针）、2D Parking（连续运动/碰撞/几何）、六人 Texas Hold'em（下注状态、牌型、all-in、边池、筹码守恒）。

冻结协议（这是项目里最扎实的部分）：每次只允许一次 Agent 调用 → 源码打成归档并锁 hash → 在 canonical seed `104729` 上评测一次 → 结果按 release lock 校验算术可复现。历史记录永远按它自己的 lock 校验，不重算、不改标签。

**版本史：**

| 版本 | 日期 | 关键变化 |
| --- | --- | --- |
| 0.1.0 | 2026-07-18 | 首版 |
| 0.3.0 | 2026-07-26 | 八任务多轨（含 reproduce 轨），发布 5 条正式结果 |
| 0.4.0 | 2026-08-13 | 收敛为候选执行配置（8 任务） |
| 0.5.0 | — | dsh 变体对照 |
| 0.6.0 | 2026-08-30 | 砍成四任务 + 一次调用 + 冻结源码 + 单种子，成为当前站点主榜 |
| 0.6.1 | 2026-09-05 | 质量与审计补丁，不改任何分数 |
| 0.7.0 | 2026-09-28 | 加独立 Build/Play 两套、收敛发布事务；**无付费实测** |

git tag 只打了 6 个（v0.1.0/v0.1.1/v0.3.0/v0.4.0/v0.6.1/v0.7.0），其余版本只有 release lock（`benchmark/releases/*.json` 共 10 份）。

---

## 3. 存量清单

### 3.1 数据

| 位置 | 内容 | 数量 |
| --- | --- | --- |
| `runs/` | series 目录（原始证据：prompt、源码归档、agent.log、score.json、tests.json、MANIFEST） | **57 组**，其中 44 组有分数、13 组空/中止 |
| `runs/rejected-*` | 主动隔离的 5 组 | contaminated / parallel-boundary / preflight / provider-auth / reference-sandbox |
| `results/publications/` | 0.3.0 正式发布快照（不可变，按 hash 命名） | 5 条 |
| `results/lite/0.6.0/` | 0.6.0 正式发布快照（站点数据源） | 7 条 |
| `results/index.json` | 0.3.0 公开索引 | 5 条 |
| `benchmark/campaigns/0.6.0/` | 预注册 campaign 计划 | 4 份 |
| `benchmark/releases/` | ReleaseLock（版本冻结凭据） | 10 份 |

### 3.2 代码与站点

| 位置 | 内容 |
| --- | --- |
| `packages/core`、`packages/evaluator` | 执行器与评测合同机（100 分制、类别、hard gate、浏览器用例） |
| `apps/site` | Astro 静态榜，读 `results/lite/**` 渲染 |
| `apps/reviewer` | 结果复核界面 |
| `benchmark/tasks`、`starters`、`play`、`calibration` | 任务契约、起始模板、Play 参考游戏、标定 |
| `tools/agents/pi-gamebench.sh` | 无工具隔离的 Pi player/adapter |
| `docs/` | 方法学、Play 方法学、发布协议、运行指南、ADR、发布说明 |

### 3.3 线上（只读，静态 file_server）

| 域名 | 根目录 | 内容 |
| --- | --- | --- |
| `gamebench.ai.carrick7.com` | `/srv/gamebench/current/site` | Build 榜、历史记录、方法学 |
| `play.gamebench.ai.carrick7.com` | `/srv/gamebench/storage` | Play 引擎、不可变对象、不计分练习 |

两站都由 Caddy 直接 file_server 提供，无进程、无数据库、无写入路径；停止维护不影响它们继续访问。

---

## 4. 已测结果

### 4.1 0.6.0（当前主榜，四任务，Pi 0.84.3，已发布 7 条）

| 模型 | 2048 | Minesweeper | Parking 2D | Hold'em | 均值 |
| --- | --- | --- | --- | --- | --- |
| gpt-5.6-sol (medium) | 100 | 100 | 90 | 95 | **96.25** |
| gpt-5.6-terra (medium) | 90 | 100 | 70 | 85 | **86.25** |
| gpt-5.6-luna (medium) | 90 | 100 | 75 | 30 | **73.75** |
| gemini-3.7-flash (thinking off) | 90 | 100 | 90 | 0 | **70.00** |
| glm-5.3-flash (off) | 100 | 0 | 100 | 0 | **50.00** |
| glm-5.3 (off) | 100 | 100 | 0 | 0 | **50.00** |
| deepseek-v4-flash-vision-exp (medium) | 100 | 0 | 75 | 0 | **43.75** |

两个观察，归档后仍成立：

1. **2048 和 Minesweeper 已经没有区分度**：七条记录里 2048 全是 90–100，扫雷五条满分。
2. **真正的分水岭是 Texas Hold'em**：只有 gpt-5.6 系列能拿到 30–95，其余全 0。四任务的"等权平均"实际上被这一个任务主导，这也说明四任务的面太窄。

### 4.2 0.3.0（历史榜，八任务，含 reproduce 轨，已发布 5 条）

| 模型（agent） | 2048 | 扫雷 | Parking | 横版射击 | Tetris | 塔防 | 复现·ohsteem | 复现·radius-raid | 均值 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-5.6-terra (codex) | 100 | 100 | 100 | 100 | 90 | 100 | 80 | 90 | **95.00** |
| deepseek-v4-pro (pi-agent) | 100 | 100 | 90 | 100 | 100 | 100 | 70 | 90 | **93.75** |
| qwen3.7-max (opencode-go) | 100 | 100 | 90 | 0 | 100 | 100 | 80 | 80 | **81.25** |
| glm-5.2 (opencode-go) | 100 | 0 | 100 | 100 | 100 | 100 | 0 | 0 | **62.50** |
| kimi-k3 (kimi-code-cli) | 100 | 100 | 85 | 0 | 0 | 0 | — | — | **47.50**（6 任务） |

八任务版的区分度明显好于四任务版——这是砍复杂度时付掉的代价，记在这里。

### 4.3 未发布的内部记录

| 版本 | 配置 | 任务数 | 均值 | 备注 |
| --- | --- | --- | --- | --- |
| 0.4.0 | gpt-5.6-sol（pi-agent 0.84.1, xhigh） | 8 | 96.25 | 候选执行配置 |
| 0.4.0 | gpt-5.6-terra（同上） | 8 | 93.75 | |
| 0.4.0 | deepseek-v4-flash（同上） | 8 | 83.19 | |
| 0.4.0 | deepseek-v4-pro（同上） | 8 | 75.00 | |
| 0.5.0 | gpt-5.6-sol / dsh | 8 | 98.75 | dsh 变体 |
| 0.5.0 | deepseek-v4-vision / dsh | 8 | 98.75 | |
| 0.5.0 | gpt-5.6-luna / dsh | 8 | 91.88 | |
| 0.5.0 | gpt-5.6-terra / dsh | 8 | 83.12 | |

0.5.0/0.6.0 的 96–99 分就是天花板证据：再往上没有测量空间。

---

## 5. 与业界的对照（为什么停）

### Build 侧（AI 做游戏）

| 基准 | 规模 | 结论 |
| --- | --- | --- |
| **GameCraft-Bench**（CUHK-SZ/SJTU/NUS/腾讯混元，2026-06） | 140 个 Godot 任务、15 族；引擎内端到端；最强 agent 41.46% | 引擎级、规模大 35 倍，覆盖"完整交付"这一诉求 |
| **GameXpert-Bench**（腾讯/中科院自动化所/清华/HKUST/CUHK-SZ，2026-08） | 97 生成任务（11 类）+ 100 修复任务（每项注入 19–27 bug）+ 17 优化链 | GameGen 轨与本项目"一次交付"同构，且分三阶段 |
| **GameDevBench**（2026-02） | Godot + 引擎测试框架做确定性验证 | 覆盖多模态游戏开发 |
| **Vals AI Poker Agent** | 17 个模型 | 直接覆盖本项目的 Hold'em 任务 |
| godot-model-bench / aaabench | 7 轮挑战 / 长程 harness | 同类小规模实现 |

本项目的差异点只有"免费 web 小游戏、不需要引擎、成本低"。这不是护城河，只是更轻；而更轻的代价就是代表性不足。

### Play 侧（AI 玩游戏）

| 基准 | 覆盖 | 结论 |
| --- | --- | --- |
| **VideoGameBench**（Princeton，ICLR 2026） | 23 款 1990s 商业游戏（10 测试集），纯像素+键盘，实时与 Lite 两档；最强 Gemini 2.5 Pro 0.48% | 比 2048/扫雷难得多，且有保密留出集 |
| **CUA-bench**（Vals AI，2026-10 更新） | 6 款商业游戏，仅键鼠，半数留出 | 同一条 CUA 路线 |
| **lmgame-Bench / GamingAgent**（ICLR 2026） | 经典游戏 + 开源 agent + 公开榜 | 活跃维护 |
| **Orak** | 12 款流行游戏，全品类 | 有论文 |
| **ARC-AGI-3** | 交互推理环境，目标自发发现与世界模型 | 人类榜 + SDK |
| **OmniGameArena**（2026） | UE5 统一 VLM 游戏 agent 榜，含改进曲线 | 引擎级 |

0.7.0 花力气做的 Play instrument，正好落在这条已经拥挤的路上，而且到归档为止零实测。

---

## 6. 冻结规则（归档后什么可以做、什么不可以）

**不可以：**
- 运行新的付费模型 campaign；`cagb bench` 只作为本地复现校验工具使用。
- 修改 instrument：任务契约、种子、评分点、release lock 一律不动。
- 重命名、重算、迁移、重标任何历史结果与发布（它们各自绑定自己的 lock）。
- 站点新增页面或换数据源；不做"更新一版排行榜"。

**可以：**
- 用 `pnpm cagb check --run runs/<ver>/<series-id>` 校验任何历史记录的完整性。
- 本地重建站点、重跑引擎级 Play 回放（无模型调用）。
- 修安全漏洞、许可证问题、依赖失效导致构建失败——这类修复不改变测量语义。

---

## 7. 还能复用什么

如果以后要做别的评测项目，这几块可以直接抬走：

1. **评测合同机**（`packages/evaluator`）：百分制 + 类别分解 + hard gate + 确定性测试向量，天然适配任何"产出物可被判分"的评测。
2. **冻结协议**：release lock + 源码归档 hash + canonical seed + 单次调用，这套东西比分数本身值钱——它解决的是"半年后还能不能证明这个分数是真的"。
3. **无工具隔离 adapter**（`tools/agents/pi-gamebench.sh`）：把任意 coding agent 塞进"只有工作区和 prompt"的沙盒。
4. **静态榜站点**（`apps/site`）：读结果快照渲染榜单，无后端、无数据库，可长期只读托管。

---

## 8. 什么情况下会重启

只有这三条成立才值得重启，否则维持归档：

1. **要的是私有回归沙盒，不是公开榜**：给自家 agent 做"改完不会退化"的验收任务集，任务自定、不进公开榜。
2. **出现业界基准明确不覆盖的能力**：例如中文界面操作、特定本地模型、特定交互形式，且必须自己测。
3. **目标从"当权威基准"改成"复现别人的基准"**：那不需要维护 instrument，只需要跑别人的。

---

## 附录：关键路径

```
runs/<version>/<series-id>/                    原始证据（不可变）
  .series.json  result.json  tasks/<task-id>/{prompt.md,agent.log,score.json,tests.json}
results/publications/<sha256>.json             0.3.0 发布快照
results/lite/0.6.0/<series-id>.json            0.6.0 发布快照（站点数据源）
benchmark/releases/<version>.json              ReleaseLock
benchmark/campaigns/0.6.0/*.json               预注册 campaign
apps/site/                                     Astro 静态榜
/srv/gamebench/current/site                    线上 Build 站根目录
/srv/gamebench/storage                         线上 Play 站根目录
```
