# 官方 API 兼容层

依据两份官方公开的类型声明：

```
vendor/ArenaPro-CLI/server/types/GameAPI.d.ts     GameWorld 111 个成员 · GameEntity · GamePlayer · GameVoxels
vendor/ArenaPro-CLI/client/types/ClientAPI.d.ts   UiNode 树 · InputSystem · ClientScreen · ClientWorld · Audio
```

## 怎么保证"没漏"而不是"看着不少"

静态扫一遍 d.ts 是**会骗人**的：`api-audit.mjs` 一开始报了约 64 个"缺失成员"，
全是 `on*/next*` 事件通道——它们由 `attachChannels` 在运行时动态挂上去，静态读对象读不到。

所以分两步：

1. `scripts/api-audit.mjs` 从 d.ts 抽出成员清单，产出两份：
   - `public/data/api-members.json` — 全部成员（329 个）
   - `public/data/api-methods.json` — 其中可调用的方法
2. `public/js/api-probe.js` 在**真实运行时**上逐个探面（含动态挂载的通道），
   并检查"名字对但类型错"的情况（把属性当函数暴露也是不兼容）：
   报告里的 `badKind` 必须是 0。

```bash
npm run audit:api
# 覆盖率 329/329 · badKind 0
```

## 沙箱按端裁剪

两端注入的全局**不是一套**。名单逐条对照各自 d.ts 顶部的 `declare` 列表：

| 只给服务端 | 只给客户端 |
|---|---|
| `voxels` `resources` `storage` `db` `rtc` `analytics` `gui` | `ui` `input` `screen` `media` `navigator` |
| `GameVector3` `GameBounds3` `GameRGBColor` … 全部 `Game*` | `Vec2` `Vec3` `Coord2` `Audio` `EventEmitter` |
| `getEntityBounds` `randomPick` | `UiBox` `UiText` `UiImage` … `Ui*` |
| | `call` `callAsync` `screenWidth` `screenHeight` |
| | `ImageDisplayMode` `UITextFontFamily` `PointerEventBehavior` |

`world` / `http` / `remoteChannel` / `sleep` / `console` / 计时器 / JS 内建是共用面。
实现方式是构造完整对象后**按白名单删**，而不是"忘了给"——漏给和错给都能被
`test/runtime_parity.mjs` 的沙箱断言抓到。

## 逐字段对账时踩过的坑（都是"看起来实现了"的假接口）

| 主题 | 官方语义 | 曾经的错误实现 |
|---|---|---|
| `sunPhase` | 0..1，`0=06:00 / 0.25=12:00 / 0.5=18:00 / 0.75=午夜` | 当成 0..24 的小时数，正午永远是黄昏 |
| 客户端 `Vec3` 颜色 | r/g/b **0–255** | 按 0–1 处理，UI 颜色全黑 |
| `transparent` 方块 | 只是渲染标记，玻璃/冰/空气墙**都挡人** | 当成"无碰撞"，456 格玻璃可穿 |
| `movementBounds` | 越界**夹回**并清掉朝外速度 | 直接扔回出生点 |
| `say()` | 只出气泡，不进聊天频道 | 同时写进 Chat |
| `searchBox` | 要求**完全包含** | 用相交判定，多召回 |
| `richText` | 只放行 `<font size color>` 与 `<stroke …>` | 原样注入 HTML（顺带是 XSS 面） |
| `UiScale.scale` | 必须 ≥ 0，负值要 warn 并拒绝 | 静默接受，整棵子树翻转 |
| `EventEmitter.remove` | 只摘**第一个**匹配项 | 全摘 |
| `ignoreEntities` | 布尔 | 当数组遍历，抛 TypeError |
| `rendering3d=false` | 冻结最后一帧 | 隐藏画布（黑屏） |
| `getEntityBounds` | 中心 ± 半径，中心 = `position + anchorOffset` | 忽略 anchorOffset |
| `entity.type`（scriptAssets） | 数字 `1`=服务端 / `7`=客户端 | 写成 `"server"/"client"` |
| `world.projectName` | 只读 string | 当成可写并拿它拼路径 |
| 重新生成地形 | 出生点、实体、场景模型、区域、商品随旧地形一起作废 | 只换体素数组，`player.initialPosition` 把玩家又拽回旧坐标，100×100 新图出生在 128,128 的虚空里 |

其中 `entity.type` 和 `projectName` 两条是**审计脚本报的**，但对照 d.ts 与官方
模板数据后判定审计结论本身错了，于是回退了"修复"。这类地方不能信工具，只能信原文。

## 事件通道

`on*` 返回 token（`cancel/resume/active` 三个方法），`next*` 是一次性 Promise。
`world` 与 `entity/player` 两级都有通道，接触类事件要**两边都 fire**。

`onVoxelSeparate` 需要"曾经接触"的追踪集合才能触发：只维护当前接触数组的话，
那条通道就是死的。所以现在每个实体带 `_voxelSeen`，每 tick 结束比对。
