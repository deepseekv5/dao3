# 便携包与发布

## 一条命令生成

```bash
npm run package                       # → ../DAO3-便携包/  （约 4.5MB）
npm run package -- /path/to/out       # 指定输出目录
```

打包逻辑在 `scripts/build-portable.mjs`，是**白名单**而不是"排除一堆东西"。
原因见下。

## 为什么必须白名单：三类素材，只有两类能分发

| 类别 | 内容 | 能否随包分发 |
|---|---|---|
| ① 本仓库代码 | `server.js` `start.mjs` `public/js` `public/css` `scripts` `test` `docs` | ✅ Apache-2.0 |
| ② Apache-2.0 上游 | `block-id.json` `block-spec.json`（© 2026 神岛实验室）+ 由上游纹理**派生**的 `block-atlas.png` / `thumbnails/` | ✅ 保留 LICENSE 并声明派生关系 |
| ③ 在线游戏内容 | 40 个官方音效 mp3、由 `.vb` 转换的赛道模型、官方地图数据块、本地存档 | ❌ 无任何再分发授权 |

② 的完整上游仓库有 219MB，**不镜像**：只带构建真正需要的两个 JSON（268KB）。
③ 一律不进包，仓库只带 `official-project/cids.json` 这份 824 字节的哈希清单。

`THIRD_PARTY_NOTICES.md` 把这张表写死在仓库里，`NOTICE` 要求再分发时必须一并保留。

## ③ 怎么拿回来

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

发布前建议跑一遍：

```bash
npm test                       # 77 条断言
node scripts/build-portable.mjs
# 确认包里没有任何素材泄漏：
find ../DAO3-便携包 -type f \( -name '*.mp3' -o -name '*.glb' -o -name '*.gltf' -o -name '*.gz' -o -name '*.raw' \)
# 应为空
grep -rl "ghp_\|DAO3_TOKEN=" ../DAO3-便携包    # 应为空
```
