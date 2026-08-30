# 复刻任务：Radius Raid

根据 Radius Raid 参考包复刻限定范围内的玩法、手感和霓虹视觉。上游项目为
MIT，并已在 `THIRD_PARTY.yml` 固定提交；本次运行中不得搜索或复制其源码。

## 要求范围

- 800×600 Canvas 游戏，包含参考标题/开始界面。
- WASD/方向键移动，鼠标瞄准射击，P/Escape 暂停。
- 带惯性的移动保持在边界内；连续射击冷却为 100 ms。
- 实现直线、斜线和直接追踪三种敌人行为。
- 实现一个护盾道具、子弹/敌人/玩家碰撞、三点生命、分数、命中反馈、
  粒子、失败、重开和暂停。
- 复刻黑色太空、青/品红/绿色辉光、几何实体、纤细字体、分数/生命 HUD
  和密集但清晰的粒子反馈。
- 明确不要求完整上游中的其余十种敌人、四种道具、音频和本地统计。

参考材料位于 `$CAGB_REFERENCE_DIR/reference/index.html`。活动 Canvas 必须使用
`canvas[data-game-canvas]`，尺寸严格为 800×600。

桥接动作：`start`、带 `{up,down,left,right}` 的 `move`、带 `{x,y}` 的
`aim`、`fire`、`hold-fire`、`release-fire`、`pause`、`resume`、`restart`。
Snapshot 符合 `state.schema.json`。不得发起运行时网络请求。

## 测评契约

完整的公开场景契约位于 `$CAGB_PUBLIC_TESTS_PATH`，计分任务清单位于
`$CAGB_TASK_MANIFEST_PATH`。实现前请读取这两个文件。每次 bridge reset
都必须应用输入 seed，并在每个 snapshot 顶层以整数 `seed` 字段返回。
官方运行 seed 也可通过 `$CAGB_SEED` 获取。
