# 网页体验版

不装 Node、不下载包，打开链接就能跑官方赛车模板：
**<https://deepseekv5.github.io/dao3play/>**。

它和介绍站是同一个渲染器、同一份 `game.js`——不是"演示视频"，也不是阉割版预览，
而是同一套运行时换了个不带服务端的装配层。

## 一条命令构建

```bash
npm run build:play        # → play/（18 个文件，约 4.6 MB）
npm run test:play         # 真浏览器回归：桌面 + 手机，31 条断言
```

`play/` 是**产物**，已进 `.gitignore`：源码在 `play-src/` 与 `scripts/build-play.mjs`。
它单独发布到 `deepseekv5/dao3play`，Pages 的构建源就是仓库根，
所以线上路径正好落在主页域名下的 `/dao3play/`。

## 装配层只有 290 行

`GameRuntime` 真正取用的编辑器字段就五个：`state`（含 `meta` / `models` / `entities` / `scripts`）、
`atlas`、`world`、`renderer`、`toast`，外加可选的 `applyTerrain`。
所以 `play-src/js/play.js` 走的是和 `public/js/main.js` 完全相同的一条链：

```
atlas.load("./data") → new VoxelRenderer(canvas, atlas) → 材质接上图集
  → 下载 ./world.json.gz → DecompressionStream("gzip") → JSON.parse
  → VoxelWorld.fromPayload → renderer.setWorld → applyTerrain → renderer.start
  → new GameRuntime(editor) → game.start({ scripts, assets, player })
```

编辑器的工具、UI、历史、存档、服务端 IO 一行都没带进来。

## 拷哪些文件不靠列清单

`scripts/build-play.mjs` 从四个入口出发**沿 `import` / `import()` 递归求闭包**，
只拷贝真正被引用的模块：

```
运行时（import 闭包，共 8 个模块）
   js/atlas.js  js/clientui.js  js/game.js  js/gapi.js
   js/renderer.js  js/world.js
   vendor/three/three.module.js  vendor/three/OrbitControls.js
```

`io.js`（打 `/api/`）、`ui.js`、`features.js`、`main.js`、整个 `voxa/` 因此**自然落选**——
不需要维护一份"哪些文件属于体验版"的清单，也就不会出现清单和代码不同步的那种静默损坏。
代价是闭包解析器只认相对说明符，bare 说明符交给 `importmap`。

## 三条硬约束，构建时自检

体验版没有服务端，Pages 又把站点挂在主页域名的**子路径**下，所以：

| 约束 | 破坏后果 | 谁在守 |
|---|---|---|
| 不得出现 `/api/` | 全部 404，世界打不开 | `build-play.mjs` 的 `audit()` |
| 不得出现根绝对路径（`/js/` `/css/` `/data/` `/vendor/` `/assets/` `/img/`） | 本地能跑、上线全 404 | 同上，含 `css/editor.css` 里 1 处 `url(/img/…)` 会被就地改写 |
| 不得带未授权素材 | 公开镜像比本地分发严重得多 | `npm run check:dist` 第 4 个面 |

`check:dist` 现在扫**四处**：git 树、npm tarball、便携包目录、`play/`。
第四处的尺度比前三处更严——公开托管没有"发给朋友"这层缓冲，所以
`play/` 里只允许 `world.json.gz` 一个例外，连第二份 `.gz` 都不许有，
音频与模型目录整块禁掉，运行时必需的 17 个文件逐个断言在场。

## 缺失素材：宁可空着，不要橙色方块

官方音效与赛道模型（199 个 `.gltf`）著作权归 box3lab，未随任何产物分发。
运行时的既有行为是：`_setMesh` 找不到资产就挂一个 `0xfc8308` 橙色线框占位盒，
并在控制台打「未找到资产 mesh/xxx.vb」。在编辑器里这是有用的告警；
但在一百多万人打开的公开页面上，199 个橙色方块只会被读成"这个页面坏了"。

所以 `play.js` 按 `meta.meshNames` 给每个名字登记一个**空的 `THREE.Group`**：
资产查找命中，占位分支走不到，实体退回"只有碰撞与逻辑"，体素赛道照常渲染，
脚本行为一字不变。回归里对应两条断言：控制台必须出现
`index.js 运行成功` 与 `clientIndex.js 运行成功`，且**不得**出现 `占位|未找到资产`。

赛车脚本本身恰好依赖这个性质——它把 5 个检查点实体 `destroy()` 掉，只留 `bounds` 用，
所以没有模型完全不影响判圈与计时。

## 手机端是真能玩的

`game.js` 的 `_bindTouch` 认领的就是 `#joyBase` / `#joyKnob` / 七个 `#t*` 按钮，
体验版把这套 DOM 原样带上，于是触屏层直接复用。输入形态按能力判定
（`matchMedia("(hover: none)")` ∪ `ontouchstart` ∪ `maxTouchPoints`），不看 UA。

`test/play.mjs` 用 390×844、`hasTouch`、`deviceScaleFactor 3` 的上下文实测：

- 摇杆 120×120 落在可视区内，七个按钮全部在界内；
- 派发真 `TouchEvent` 推摇杆，角色在 1.8 秒内移动 7.66 格；
- 首屏与游玩画面的 `scrollWidth - innerWidth` 都是 0（无横向溢出）。

## 实测数字

| 项 | 值 |
|---|---|
| 产物 | 18 个文件 / 4.64 MB |
| 地图载荷 | `world.json.gz` 2,780 KB → 解压 19 MB → 1,523,592 格 / 199 实体 |
| 本地首屏到可进入 | 2.0~2.2 秒 |
| 回归 | 31 条断言，桌面 + 手机各一轮 |
| 网络面 | 17 个请求，零 4xx、零 `/api/`、零未捕获异常 |
| 移动速度 | 按住 Shift+W 走 6.86 格 / 19 tick（≈7.2 格/秒，官方 20 TPS 口径） |

`test/play.mjs` 里那个静态服务器会把 `/dao3play/` 前缀剥掉再落盘——
这是刻意的：产物必须在**它真实的部署形态**下被测，
否则"本地全绿、上线白屏"这类问题根本测不出来。
