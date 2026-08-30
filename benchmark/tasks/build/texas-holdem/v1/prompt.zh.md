# 开发一个六人无限注德州扑克现金桌

使用提供的 Vite + TypeScript starter，制作一个完整、可玩的浏览器游戏：0 号座位是一名真人玩家，1–5 号座位是五名确定性电脑对手。项目必须自包含。

## 牌桌规则

- 六个固定座位，盲注 1/2，无 ante；普通重置时每个座位有 200 筹码。
- 实现庄家按钮、小盲、大盲，以及每手结束后的顺时针按钮轮转。
- 翻牌前从大盲左侧开始行动；翻牌、转牌和河牌从按钮左侧第一名仍可行动的玩家开始。
- 实现 fold、check、call、bet/raise-to 和 all-in。
- 校验 check/call 的合法性及无限注最小完整加注。短码 all-in 可以提高跟注额，但不能为已经行动过的玩家重新开放加注。
- 实现 preflop、flop、turn、river 和 showdown；选择下一行动者时跳过已弃牌、已 all-in 和离桌座位。
- 按标准牌型和 kicker 从七张牌中选择最佳五张牌，包括 A2345 轮子顺子。
- 根据投入层级构造主池和边池。弃牌玩家的投入进入底池但没有获胜资格；退还无人跟注的超额；平局分池，奇数筹码从按钮左侧开始顺时针分配。
- 所有行动和派彩前后都必须保持总筹码守恒。
- 五个 Bot 必须是确定性的：相同 seed 和行动历史必须产生相同牌堆与决策。每次 `advance` 经过 250ms，处理一个 Bot 决策。

本任务不要求账号、联网、匹配、聊天、抽水、购买、锦标赛或补码系统。

## 必需界面

在 1280×720 中清楚展示六个座位、筹码、公共牌、底池、庄家/盲注标记、当前行动者、合法行动和真人底牌。控件必须提供稳定 selector：

- `[data-action="fold"]`
- `[data-action="check"]`
- `[data-action="call"]`
- `[data-action="all-in"]`
- `[data-action="raise"]`
- `[data-testid="raise-to"]`

真实控件和 Bridge action 必须调用同一个游戏 reducer。

## Bridge 契约

保留版本为 `1` 的 `window.__CARRICK_GAMEBENCH__`，实现：

- `reset({ seed, scenario? })`
- `act({ type: "start-hand" })`
- `act({ type: "player-action", payload: { kind: "fold" | "check" | "call" | "all-in" } })`
- `act({ type: "player-action", payload: { kind: "raise", to: integer } })`，其中 `to` 表示真人在当前下注轮的总投入
- `act({ type: "new-hand" })`
- `act({ type: "restart-table" })`
- `advance(ms)`
- 严格符合 `state.schema.json` 的 `snapshot()`

公开 cases 会使用具名确定性场景。请按照其预期 snapshot 实现场景，同时继续使用同一套正式 reducer 和扑克规则。不得在运行时读取测试文件，也不得针对 evaluator 本身做特殊判断。

非法 Bridge action 应当 reject，而不是静默破坏状态。每次 reset 都必须在顶层 `seed` 报告传入的整数。

## 交付

项目必须能用冻结 lockfile 安装，能通过 `pnpm build` 构建，能通过 `pnpm preview` 启动，并且运行时不依赖网络。
