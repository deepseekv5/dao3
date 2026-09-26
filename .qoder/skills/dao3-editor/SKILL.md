---
name: dao3-editor
description: 通过本地 HTTP API 与 ArenaPro 兼容的 MCP 端点驱动 dao3 编辑器复刻（本地版神奇代码岛）——建图、批量写体素、读写两端脚本、存盘、查官方 API 规范。当用户提到 dao3、神奇代码岛、编辑器复刻、建图/造赛道、给地图写脚本、导入官方项目包、ArenaPro 接入时使用。也负责拦住两类常见错误：把官方"格/tick"单位当成秒、以及凭印象编造不存在的 API。
---

# dao3 编辑器本地驱动

## 这个 skill 是什么

一套面向**本地服务**的地图生产工具。被驱动的应用是 dao3（神奇代码岛）编辑器与运行时的
从零兼容复刻：零构建、零第三方依赖的 Node 服务 + Three.js 前端，数据格式与官方一致。

有两条接入路径，按调用方选：

| 路径 | 适合 | 入口 |
|---|---|---|
| HTTP + CLI | 终端里干活、批量改数据、脚本化 | `scripts/dao3.mjs` |
| ArenaPro MCP | IDE 里的 Agent 已经按官方文档配好 MCP | `GET /ap-mcp`（SSE） |

两条路底下是同一套数据，工具名刻意对齐官方 `apc` / ArenaPro MCP，不要另发明一套动词。

## 开工前先确认服务在跑

```bash
node scripts/dao3.mjs health
```

连不上就起服务（**不要**去抢 5173/5174，那是用户自己的 vite）：

```bash
node start.mjs --no-open --port=5180 --host=127.0.0.1
```

`whoami` 会回 `app: dao3-editor-clone`。端口上要是别的进程，**别动它**。

## 核心工作流

```bash
# 1. 查方块 id（写体素前必做，别猜）
node scripts/dao3.mjs blocks --grep 草
node scripts/dao3.mjs blocks --type stone --limit 20

# 2. 建图（自带一层地面，否则玩家一出生就掉出世界）
node scripts/dao3.mjs scaffold mymap --shape 64,64,64 --floor 0 --name 我的图

# 3. 盖东西
node scripts/dao3.mjs fill mymap --box 4,1,4,12,6,12 --id 30
node scripts/dao3.mjs fill mymap --box 6,7,6,10,9,10 --id 0     # id 0 = 挖空

# 4. 验：读一根柱子，确认真的落下去了
node scripts/dao3.mjs probe mymap --at 8,8 --from 0 --to 10

# 5. 写两端脚本
node scripts/dao3.mjs script mymap --name index.js --file ./server.js --client ./client.js

# 6. 打开看一眼（行为只能在这里确认）
#    http://127.0.0.1:5180/edit/mymap  → 顶栏 ▶ 进运行模式
```

**第 6 步不能省。** 类型检查、测试、`probe` 都只证明数据写进去了，不证明玩法是对的。
这个项目的验收口径一直是"驱动真实浏览器跑一遍"。

## 三条必须知道的坑

### 写体素是全量覆盖，没有补丁接口

服务端只认整份 payload。`fill` 内部做的是"读全量 → 改 → 写回全量"，所以
**两个进程同时改同一张图会互相覆盖**。改之前先 `dump` 一份，改完 `probe` 确认。

### 浏览器开着那张图，会自动存档把你的改动盖掉

编辑器有自动存档。用 CLI 改一张正在浏览器里打开的图，几秒后可能被前端的旧状态
整份写回。要么先关掉/刷新那个标签页，要么改完立刻 `probe` 复查。
这条是真实踩过的：测试残留被自动存档写进默认地图。

### 单位是「格 / tick」，不是「格 / 秒」

`TICK_MS = 64` → **15.625 tick/秒**（不是 20 TPS）。`walkSpeed 0.22` 是 0.22 格每 tick，
约 3.4 格/秒。当成格/秒会让人物慢 15 倍。详见 [references/scripting.md](references/scripting.md)。

## 不要凭印象编 API

官方规范有 **100 个类 / 1044 个成员**。写任何不确定的接口前先查：

```bash
node scripts/dao3.mjs api say
node scripts/dao3.mjs api --class GamePlayer
node scripts/dao3.mjs api --list
```

**查不到就是官方没有。** 这时候正确的做法是明说"没有这个接口"并找替代，
而不是编一个名字看起来合理的——编出来的接口在运行时只会给你一个 `undefined is not a function`。

类清单与端归属见 [references/api.md](references/api.md)。

## ArenaPro MCP 接入

已经按官方 ArenaPro 文档配过 MCP 的客户端，只改 URL 就能接上本地：

```json
{
  "servers": {
    "ArenaPro-MCP": { "type": "sse", "url": "http://localhost:5180/ap-mcp" }
  }
}
```

路径 `/ap-mcp`、传输 SSE、工具名全部沿用官方清单（官方默认端口是 25315，这里只换端口）。
看本机到底支持哪些：

```bash
curl -s http://127.0.0.1:5180/api/mcp/tools
```

**支持 11 个**：`file_mapTool` `map_showMap` `map_playData` `map_resource`
`file_createProject` `file_upLoad` `file_buildNUpload` `file_checkDts`
`chatjpt_onlyKnowledgeBase` `component_showComponentStats` `file_outputName`

**明确不支持 13 个**（仍出现在 `tools/list` 里，但调用会返回 `isError` 并说明原因）：
`userCenterTool_*` 四个（本地没有账号体系，**绝不会返回一个假 token**）、
`file_npm_package_*`（不联网）、`file_reHMR` / `file_stopHMR`（本应用无构建步骤）、
`file_openArena` / `file_debugger` / `file_openOutputLog`（IDE 能力）等。

不支持的工具留在清单里是刻意的：客户端按官方清单调用时若拿到 "unknown tool"，
Agent 会以为契约对不上而开始猜；给一个明确的"不支持 + 为什么"比沉默或假装成功都好。

## 边界（这些做不到，别试）

- **不联网。** 本应用承诺纯本地；按 CID 取回官方内容必须是用户明确点击才发生。
- **没有账号系统**，官方登录 / Token / 线上游玩统计一律拿不到。
- **项目包 .zip 导出在浏览器侧**（依赖 Three.js），CLI 里没有等价命令。
  要导出就在编辑器顶栏操作，或走 `/edit/<id>?export`。
- 删图不可撤销：`delete` 需要 `--yes`，且只删自己新建的图。

## 命令速查

`node scripts/dao3.mjs help` 有全量。常用：

| 命令 | 作用 |
|---|---|
| `health` | 服务与统计 |
| `worlds` / `info <id>` | 列图 / 看一张图的结构 |
| `blocks --grep <词>` | 查方块 id |
| `api <词>` / `api --class <类>` | 查官方 API 规范 |
| `scaffold` / `fill` / `probe` / `meta` / `script` | 建图、盖格子、验证、改元数据、写脚本 |
| `dump <id>` | 导出整份 payload 做对比或备份 |
| `assets <id>` / `asset-put` / `models` | 资产与 VOXA 模型 |
| `delete <id> --yes` | 删图 |

## 参考

- [references/scripting.md](references/scripting.md) — 两端全局划分、单位制、四元数 xyzw、
  颜色量纲、`sunPhase`、`transparent` 等**踩过才知道**的规范
- [references/api.md](references/api.md) — 100 类索引与查询方法
- 仓库内更长的版本：`docs/api-reference.md`、`docs/api-compat.md`、`docs/physics.md`
