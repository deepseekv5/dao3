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
   - `public/data/api-members.json` — 全部成员（71 个游戏类型 / 751 个成员，两端都算）
   - `public/data/api-methods.json` — 其中可调用的方法
2. `public/js/api-probe.js` 在**真实运行时**上逐个探面（含动态挂载的通道），
   并检查"名字对但类型错"的情况（把属性当函数暴露也是不兼容）：
   报告里的 `badKind` 必须是 0。

```bash
npm run build:api-ref     # 重新抽清单 + 生成 API 参考
npm run test:api          # 真实运行时对账（CDP，不需要 playwright）
# 合计 107 个游戏类型 / 81 个有成员级声明，805 个官方成员，静态比对到 805（覆盖 100.0%）
# 核心四类：GameWorld 111/111 · GameEntity 95/95 · GamePlayer 114/114 · GameVoxels 9/9
```

第 2 步必须**真的跑得起来**。这条是补出来的：`api-audit.mjs` 的输出一直写着
"以 api-probe.js 的运行时对账为准"，而那个探针只被 `test/e2e.mjs` 调用，
e2e 依赖 `playwright-core`——本机没装，它整批 `SKIP` 然后 exit 0。
于是"最可信的那条结论"从来没跑过，报出来的百分比全部来自静态 grep。
现在它有自己的入口 `npm run test:api`（走仓库自带的 `test/cdp.mjs`），
除了探面还钉住三件容易悄悄退化的事：`onTick` 挂上去要真被调用（只验 `typeof`
的话一个什么都不干的假监听器也能全绿）、`http.fetch` 交出去的必须是真
`Response`（`statusText` / `bodyUsed` / `formData` 得在）、以及 SQL 层的清理语义。

静态比对还有一个只咬短名字的坑：`r` / `g` / `b` / `a` 用整词正则永远命中
（`spectator:` 里就含 `r:`）。而官方 `GameRGBColor` 的分量恰恰叫 `r/g/b`，
我们内部却用 `red/green/blue`——审计报"已实现"，脚本里 `color.r` 是 `undefined`，
颜色直接变黑且不报错。所以 1–2 个字符的成员只认"成员位置"：属性访问、访问器声明、
对象字面量的键。

同类还有一个坑，这次是**分母**错：`declare type GameHttpHandler = (\n  request: …,\n  response: …)`
里那些两空格缩进的参数会被"看到顶格 `}` 才停"的扫描当成类成员收进来，
于是凭空多出 `GameHttpRequest.response` 这样的"官方成员"，再报成"本地缺失"。
现在按括号深度收成员，并且只有 `onX` 与 `nextX` **两边都声明了**才算一个事件通道
（`GameGUI.onMessage` 官方就没有 `nextMessage`，`world.nextPage` 是翻页方法不是事件）。

### db.sql：官方标了 @deprecated，但仍然给

`declare const db: GameDatabase` 的注释是"旧代编辑器使用的数据库接口，已弃用，
请改用 GameDataStorage"，文档站也没有 GameDatabase 这一页。但以前 `db` 被我们
直接做成键值存储的别名，脚本按 d.ts 写 `db.sql("select …")` 拿到的是 `undefined`——
"官方建议别用"和"我们给了个 undefined"是两件事。

现在 `db.sql` 是真能跑的：语句与参数分开送到本地服务，由 Node 自带的
`node:sqlite` 执行（每个世界一个 `server/data/worlds/<id>.sqlite`），
返回值 `GameQueryResult` 既能 `await` 直接拿整批 rows，也能 `for await` 逐行取，
两种用法共用同一次执行（各跑一遍的话 insert 会被执行两次）。
键值那套 `db.get/set/…` 原样留着，存量脚本不因此失效。

三条边界说清楚：

- **要本地服务在跑。** 编辑器与便携包都自带；直接双击 `public/editor.html` 打开时
  没有 SQL 引擎，这时 `db.sql` 抛的是"需要本地服务在跑"，不是静默返回空数组。
- **Node 要 22.5+**（`node:sqlite` 从这版起才有）。不满足时只有这一条接口不可用，
  服务照常起。
- **库不随地图走。** 项目包导出与社区发布快照带的是世界存档与脚本，不含 `.sqlite`；
  删世界会把它的库一起删掉，免得同 id 重建时继承上一张图的表。
  新写玩法请优先用 `storage.getDataStorage(name)`——那才是官方推荐的那条路。

逐成员的签名、官方中文说明与单位，以及本地到位还是缺口，见 [API 参考](api-reference.md)（生成物）。

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
