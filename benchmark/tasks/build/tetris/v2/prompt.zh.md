# 构建任务：俄罗斯方块

实现完整的浏览器版俄罗斯方块。

## 必须实现

- 10×20 棋盘及 I、O、T、S、Z、J、L 七种方块。
- 自动下落、左右移动、旋转、软降、硬降、锁定、完整行消除、计分、
  等级/速度递增、下一块预览、暂停/继续、重开和失败状态。
- 旋转后不得越界或穿过已锁定格；O 方块保持稳定。
- 硬降立即锁定；暂停后模拟时间完全停止。

## 公开自动化契约

桥接动作：`move-left`、`move-right`、`rotate`、`soft-drop`、`hard-drop`、
`pause`、`resume`、`restart`。Snapshot 符合 `state.schema.json`。

Fixture：`all-pieces` 在 `piecesSeen` 中报告七种方块；`wall-rotation`
将 I 放在左墙；`single-line` 距离消一行只差一次硬降；`hard-drop`
在空棋盘 y=0 放置 T；`score-level` 距离累计 10 行只差一次消行。
方向键、空格、P/Escape 和 R 必须与桥接动作共用状态转换。

不得发起运行时网络请求或编写评测器专用分支。

## 测评契约

完整的公开场景契约位于 `$CAGB_PUBLIC_TESTS_PATH`，计分任务清单位于
`$CAGB_TASK_MANIFEST_PATH`。实现前请读取这两个文件。每次 bridge reset
都必须应用输入 seed，并在每个 snapshot 顶层以整数 `seed` 字段返回。
官方运行 seed 也可通过 `$CAGB_SEED` 获取。
