# 依赖清单

本仓库**运行时零第三方依赖**——这不是口号，是可验证的：`package.json` 的
`dependencies` 与 `devDependencies` 都是空对象，服务端只用 Node 内置模块。
真正跑在页面里的第三方代码只有一份，就是随仓库分发的 three.js。

下面每一项都注明**从哪个文件读出来的**，不是凭印象列的。

## 一、随仓库分发的第三方代码

| 依赖 | 版本 | 授权 | 落位 | 用途 |
|---|---|---|---|---|
| three.js | r160（`three.module.js` 内 `REVISION = '160'`） | MIT（`public/vendor/three/LICENSE`，版权行 `Copyright 2010-2023 Three.js Authors`） | `public/vendor/three/`、`public/vendor/utils/` | WebGL 渲染、glTF 导入导出、轨道相机、几何/纹理工具 |

vendored 的具体文件共 6 个：

```
public/vendor/three/three.module.js        1,272,972 B   核心
public/vendor/three/GLTFLoader.js            108,522 B   官方模型 → glb 载入
public/vendor/three/GLTFExporter.js           77,726 B   场景 → glb 导出
public/vendor/three/OrbitControls.js          29,880 B   编辑器相机
public/vendor/utils/BufferGeometryUtils.js    31,906 B   体素网格合并
public/vendor/utils/TextureUtils.js            2,380 B   图集处理（本仓库自写）
```

`TextureUtils.js` 是本仓库自己写的工具，不是 three.js 上游文件，只是放在同一目录下。
three.js 用 `importmap` 以 `three` 裸模块名引入，不做打包、不改源码，
所以升级就是换这 5 个上游文件。

## 二、Node 内置模块（服务端与构建脚本）

```
node:fs            node:path           node:url
node:zlib          node:http           node:child_process
node:os            node:net            node:crypto
```

要求 **Node ≥ 18**：`node:` 前缀导入、顶层 `await`、`fs.cpSync`、
`Array.prototype.at` 与可选链等语法都要 18 才齐。
`start.mjs` 里的 `net.createServer()` 探端口、`os.networkInterfaces()` 列局域网地址，
都是内置能力，不需要 `portfinder` 之类。

## 三、浏览器 Web API（不是依赖，但决定可用性）

| API | 用在哪 | 不支持时的表现 |
|---|---|---|
| `requestAnimationFrame` | 渲染与 20 TPS tick 循环 | 现代浏览器都有 |
| `CompressionStream("deflate-raw")` | 项目包 `.zip` 导出时压缩条目 | 走 store（不压缩）分支，包能出但更大 |
| `navigator.mediaDevices` | 录音回放 | 录音按钮不可用，其余功能不受影响 |

刻意**没有**用 `SharedArrayBuffer` / `Atomics`，所以不需要给页面加
COOP/COEP 响应头——那会让本地起的服务在多核机器上直接白屏。

## 四、测试期依赖（不随包分发）

| 依赖 | 版本 | 说明 |
|---|---|---|
| `playwright-core` | 1.59.1 | 驱动真浏览器跑 103 条断言。**不是** `dependencies`，装不到就打印 SKIP 并退出 0 |
| Chromium | 系统 Chrome 或 `npx playwright install chromium` | 同上 |

`test/browser.mjs` 会按 `CHROME` → 各平台常见安装路径 → `PLAYWRIGHT_MODULE` →
向上找 `node_modules` → 全局目录的顺序自行解析，找不到就 SKIP。
这样"零依赖"的承诺不会被测试链污染。

## 五、上游参考仓库（本地 clone，不入库）

`vendor/` 整体在 `.gitignore` 里，因为每个子目录都是**别人仓库自己的 clone**
（带 `.git`），作为嵌套仓库既没法正常入库、也不该镜像。

| 仓库 | 授权 | 本项目怎么用 |
|---|---|---|
| `box3lab/Box3Blocks-unityPackage` | Apache-2.0 © 2026 神岛实验室 | 方块 ID 主表 / 渲染规则 / 2000+ 张 16×16 纹理 → 构建期合成图集 |
| `box3lab/ArenaPro-CLI` | Apache-2.0 | `GameAPI.d.ts` / `ClientAPI.d.ts` 是 329 个成员的契约来源 |
| `box3lab/box3-product-document` | Apache-2.0 | 产品与 API 文档，玩法语义对照 |
| `box3lab/engine-openapi-mcp` | **仓库内没有 LICENSE 文件** | 只读参考，不复制任何内容 |
| `box3lab/statistics-mcp` | **仓库内没有 LICENSE 文件** | 只读参考，不复制任何内容 |

后两个没有授权声明，所以按"未授权再分发"处理：不复制代码、不复制数据、不打包，
连构建产物里都不出现。需要重建图集时只从前三个取文件：

```bash
git clone https://github.com/box3lab/Box3Blocks-unityPackage vendor/Box3Blocks-unityPackage
npm run build:atlas
```

`build:atlas` 会优先读 `data/upstream/`（随仓库分发的两张 Apache 小表副本），
纹理仍必须来自本地 `vendor/`——纹理有 200MB+，不在分发范围内。

## 六、明确**不**使用的东西

- 没有 bundler：没有 webpack / vite / rollup / esbuild 配置，浏览器直接加载 ES module。
- 没有 `node_modules`：`npm install` 在本项目里是可选的，只为了装测试用的 playwright-core。
- 没有物理引擎（cannon / ammo / rapier）：碰撞是自己实现的 AABB + 子步推进，
  理由见[物理与单位制](physics.md)。
- 没有数据库：地图就是 `server/data/worlds/<id>.json.gz`，格式与官方 Unity 侧导出一致。
- 没有遥测：服务端不向任何外部主机发请求；取官方素材是显式的 `npm run fetch:official`。

## 相关

- [便携包与发布](packaging.md) — 这些依赖如何被打进免安装包
- [架构与数据流](architecture.md) — three.js 在本项目里被用到哪一层
