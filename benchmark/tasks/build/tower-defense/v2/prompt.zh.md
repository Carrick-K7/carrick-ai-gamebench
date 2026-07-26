# 构建任务：塔防小游戏

实现完整而紧凑的塔防游戏。

## 必须实现

- 敌人沿路点路径移动，到终点后扣除生命。
- 玩家在建造位花费金币；金币不足时不得建塔或产生负数金币。
- 实现普通、快速、范围或减速三种存在真实差异的塔。
- 塔只攻击射程内敌人，并正确使用伤害和攻速。
- 实现普通、快速、重型敌人、递增波次、击杀奖励、塔升级、暂停/继续、
  重开及明确胜负。
- 死亡敌人只移除一次、只奖励一次，之后绝不能再到终点扣血。

## 公开自动化契约

桥接动作：带 `{slot,type}` 的 `build-tower`、带 `{slot}` 的
`upgrade-tower`、`start-wave`、`pause`、`resume`、`restart`。
Snapshot 符合 `state.schema.json`。塔类型使用 `data-tower-type`，
建造位使用 `data-build-slot`。

Fixture：`path` 从 progress 0 开始一个普通敌人；`range` 包含一座普通塔
和射程外正在接近的敌人；`economy` 有 100 金币，普通塔 50、范围塔 120；
`wave` 距离第二波一个 tick；`upgrade` 有伤害 10 的普通塔和 100 金币；
`lifecycle` 在射程内放置 1 HP 敌人且金币 100；`load` 放置 100 个敌人。

不得发起运行时网络请求或编写评测器专用分支。

## 测评契约

完整的公开场景契约位于 `$CAGB_PUBLIC_TESTS_PATH`，计分任务清单位于
`$CAGB_TASK_MANIFEST_PATH`。实现前请读取这两个文件。每次 bridge reset
都必须应用输入 seed，并在每个 snapshot 顶层以整数 `seed` 字段返回。
官方运行 seed 也可通过 `$CAGB_SEED` 获取。
