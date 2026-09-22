# 便携包与发布

## 一条命令生成

```bash
npm run package                       # → ../DAO3-便携包/  （约 4.5MB）
npm run package -- /path/to/out       # 指定输出目录
```

打包逻辑在 `scripts/build-portable.mjs`，是**白名单**而不是"排除一堆东西"。
原因见下。

## 为什么必须白名单：素材分三种处置

| 类别 | 内容 | 分发处置 |
|---|---|---|
| ① 本仓库代码 | `server.js` `start.mjs` `public/js` `public/css` `scripts` `test` `docs` | ✅ Apache-2.0 |
| ② Apache-2.0 上游 | `block-id.json` `block-spec.json`（© 2026 神岛实验室）+ 由上游纹理**派生**的 `block-atlas.png` / `thumbnails/` | ✅ 保留 LICENSE 并声明派生关系 |
| ③ 在线游戏内容 | 本地存档、世界上传件 | ❌ 不进包，属运行时产物 |
| ④ 官方赛车模板地图数据 | `official-project/racing-template.json.gz`（2.8MB，152 万格 / 199 实体） | ⚠️ **随包分发，但默认不落地** |
| ⑤ 官方赛道模型与音效 | `official-project/racing-assets/`（20 个 `.gltf` + 40 个 `.mp3`，3.7MB） | ⚠️ **随包分发，但默认不放行** |

② 的完整上游仓库有 219MB，**不镜像**：只带构建真正需要的两个 JSON（268KB）。

④ 与 ⑤ 是仓库所有者做的决定，不是许可上的漏洞：模板与素材的著作权仍归 box3lab，
不在任何开源许可之下，所以服务端**不会自动安装、也不会自动发文件**。
首次打开工作台会弹一次确认，列明三项内容与各自体积（数字从包里现读），
要求使用者声明"我有权获取并在本地使用，仅用于学习与兼容性研究"：

- 地图：确认后才 `copyFileSync` 成种子世界；
- 模型与音效：确认前 `/assets/racing/models/*` 与 `/data/assets/audio/*` 一律 `403`，
  确认后才按原样发出。闸门在**服务端**而不是只藏个按钮——素材在仓库里，
  前端只要拿到 URL 就能取，唯一的真约束是这个请求必须由服务端点头。

决定记在 `server/data/consent.json`，之后可在工作台「官方素材授权」改；
清掉这条记录，素材会立刻退回 403（回归里有断言）。
**已经由用户改过的世界不会被模板覆盖**——只有带着
`meta.seedKind === "procedural"` 标记、从未被改动的程序化 demo 才会被替换。

`check-distribution.mjs` 对这两条是**双向**断言的：`.gz` / `.mp3` / `.gltf` 默认算越界，
唯有登记过的那一个文件与那一个目录被放行；同时它们又出现在"必需文件"清单里，
哪天打包漏掉模板或素材，同样会红。

> 未授权时编辑器读不到模型，曾经会把地图**毁掉**：`collectEntities` 按 `!d.mesh`
> 保留未放置的实体，于是 194 个带 mesh 的实体既进不了场景模型又被过滤掉，
> 一次自动保存就清零。现在改成"没被任何已放置模型代表就原样留回来"，
> `test/e2e.mjs` 用假的 `assetRoot` 真跑一次 404 来钉住它。

`THIRD_PARTY_NOTICES.md` 把这张表写死在仓库里，`NOTICE` 要求再分发时必须一并保留。

## ② 上游仓库怎么拿回来

```bash
npm run fetch:official
```

`scripts/fetch-official-project.mjs` 按 CID 逐个下载，并用
`sha256 → base58btc` **重算 CID 校验**，保证拿到的就是清单指向的那份内容：

```js
const cidOf = (bytes) => base58(Buffer.concat([Buffer.from([0x12, 0x20]), sha256(bytes)]));
```

校验实现已用官方 40 个音频 40/40 对账。可用 `DAO3_GATEWAY=` 指向自己的镜像。
**这一步需要使用者自有的访问权限**，脚本不内置任何凭据。

## 没有 ③ 时的降级行为

刻意做成"功能完整、素材缺失"，而不是"跑不起来"：

- 缺赛道模型 → 实体显示占位盒，控制台提示
  `未找到资产 mesh/xxx.vb，已用占位显示（需先导入项目包或上传模型）`
- 缺音效 → 玩家面板对应槽位显示 `xxx（缺文件）`，而不是静默变成"无"
- 缺官方地图 → 首次启动 `ensureSeed()` 用 Apache 的 block-id 表**程序化生成**
  一张示例岛（地形 + 木屋 + 树），不依赖任何外部素材

## 包内结构

```
DAO3-便携包/
├── 启动-macOS.command      双击（Finder 用终端打开 .command）
├── 启动-Windows.bat        双击；没装 Node 会打印下载地址并 pause
├── run-win.ps1             PowerShell 版
├── run.sh                  macOS / Linux 命令行（额外会停掉本项目旧进程）
├── start.mjs               ← 三端共用的启动逻辑
├── server.js
├── public/                 含已构建好的图集，开箱即用
├── scripts/  test/  docs/
├── LICENSE  NOTICE  THIRD_PARTY_NOTICES.md
├── package.json  .gitignore
├── VERSION                 版本 / 构建时间 / Node 要求
└── BUILD-MANIFEST.json     这次打包到底放了什么、排除了什么
```

## 打成 zip

```bash
npm run package
cd .. && zip -qr DAO3-便携包.zip DAO3-便携包
```

发布时把这个 zip 作为 GitHub Release 的资产挂上，介绍站的下载按钮指向它。

## 自检

`start.mjs` 启动前会检查图集；缺图集且拿不到上游纹理时，
直接打印一条 `git clone` 命令并退出，而不是启动一个白屏服务。

## 便携包之上还有三件交付物

| 产物 | 由谁产出 | 为什么 |
|---|---|---|
| `DAO3-portable-v{{VER}}.zip` | `build-portable.mjs` → `zip-dir.mjs` | 三端通用，解压即用；保留不动 |
| `DAO3-{{VER}}.dmg` | `build-installers.mjs` 用系统 `hdiutil` | macOS 用户习惯挂载磁盘镜像而不是解压 |
| `DAO3-Setup-{{VER}}.exe` | Inno Setup 6，**只在 CI 的 windows-latest 上编译** | Inno Setup 没有 macOS 版；在 mac 上"生成" .exe 只能是假的 |

`build-installers.mjs` 不重新打包内容，只把已经过授权扫描的便携包目录原样搬进 `.dmg`，
并额外写一份 `请先读我.txt` 说明 Gatekeeper 的处理办法（未做开发者签名，首次要右键→打开）。
产出后会**真的挂载一次**并断言 `启动-macOS.command` 存在且带可执行位——
只检查"文件在"是不够的，`.command` 丢了执行位就是双击没反应。

Windows 那侧本仓库只提供 `installer/dao3.iss`（CRLF + UTF-8，Inno Setup 要求），
编译交给 `.github/workflows/release.yml`。runner 上没有 Inno Setup 时工作流**显式失败**，
不静默跳过。

## GitHub Packages

包名是 `@deepseekv5/dao3-editor-clone`。必须带 scope 且 scope 等于 owner，
这是 GitHub Packages 的 npm registry 硬规定，`dao3-editor-clone` 这种裸名会被拒。

```bash
npx @deepseekv5/dao3-editor-clone            # 直接起服务并打开浏览器
npm i -g @deepseekv5/dao3-editor-clone       # 装成全局命令 dao3-editor
```

`package.json` 的 `bin` 指向 `start.mjs`（带 `#!/usr/bin/env node` 且 `chmod +x`）。

## 发布前的分发审计：`npm run check:dist`

以前这段是手写 `find` + `grep`，容易漏，而且**漏的方向很危险**：
`package.json` 的 `files` 里写一句 `"public"`，npm 就会把 `public/assets/` 整个吞进去——
`files` 存在时 npm **不看 `.gitignore`**。这一条真的让 60 个未授权素材进了 tarball 候选。

现在 `scripts/check-distribution.mjs` 一次扫四处，任何一处越界就退出码 1：

```bash
npm run check:dist
# ok   git 跟踪的文件:      498 个文件 | 素材越界 0 | 疑似凭据 0 | 缺必需文件 0
# ok   npm tarball:         492 个文件 | 素材越界 0 | 疑似凭据 0 | 缺必需文件 0
# ok   便携包目录:          501 个文件 | 素材越界 0 | 疑似凭据 0 | 缺必需文件 0
# ok   网页体验版 play/:     18 个文件 | 素材越界 0 | 疑似凭据 0 | 缺必需文件 0
```

第四个面是公开托管，尺度比前三处更严：只允许 `world.json.gz` 一个例外，
第二份 `.gz` 都不许有（音频/模型压缩包也是 `.gz`），`assets/` 与 `audio/` 整块禁掉。
详见 [网页体验版](playground.html)。

规则一律**锚定到产物根**：顶层 `vendor/` 是上游仓库自己的 clone（禁止入库），
而 `public/vendor/three/` 是随包分发的 MIT three.js——两者都叫 vendor，
用子串匹配会误报，用前缀匹配才对。

工作流的 `portable` job 会跑同一个脚本，所以"本地查过"和"发出去的东西"是同一份判据。

发布前建议跑一遍：

```bash
npm test && npm run test:e2e     # 77 + 35 条断言
npm run package                  # 便携包 + zip
npm run installers               # .dmg（macOS 上）+ dao3.iss
npm run check:dist               # 三处分发面一起审
```
