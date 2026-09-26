# AI 接入（dao3-editor Skill）

这套东西让 AI 直接动手用这个编辑器，而不是只能"写一段代码给人贴进去"。

有两条接入路径，底下是同一份数据：

| 路径 | 适合谁 | 入口 |
|---|---|---|
| **HTTP + CLI** | 终端里干活、批量改数据、写脚本化流程 | `.qoder/skills/dao3-editor/scripts/dao3.mjs` |
| **ArenaPro MCP** | IDE 里的 Agent 已经按官方 ArenaPro 文档配好 MCP | `GET /ap-mcp`（SSE） |

工具名刻意对齐官方 `apc` 与 ArenaPro MCP 的动词，**没有另发明一套**。
名字对不上时，AI 会开始猜，猜出来的接口在运行时只会给你一个 `undefined is not a function`。

---

## 一分钟接上 MCP

已经按官方文档配过 ArenaPro MCP 的客户端，只改 URL：

```json
{
  "servers": {
    "ArenaPro-MCP": { "type": "sse", "url": "http://localhost:5180/ap-mcp" }
  }
}
```

官方默认端口是 25315，这里只换端口——路径 `/ap-mcp`、SSE 传输、工具名全部照旧。

看本机到底支持哪些：

```bash
curl -s http://127.0.0.1:5180/api/mcp/tools
```

---

## 支持什么、不支持什么

**支持 11 个工具**：

| 工具 | 作用 |
|---|---|
| `file_mapTool` | 列出本地全部地图 |
| `file_createProject` | 建一张新图（自带地面，避免出生即掉落） |
| `map_showMap` | 回该图的创作端地址与结构摘要 |
| `map_playData` | 该图的结构统计与规则 |
| `map_resource` | 列出该图已落盘的资产 |
| `file_upLoad` | 把脚本写进指定端（server / client） |
| `file_buildNUpload` | 读 ArenaPro 工程的 `dist/server`、`dist/client` 合并写入 |
| `file_checkDts` | 拿本地 API 规范核对脚本引用的成员是否真实存在 |
| `chatjpt_onlyKnowledgeBase` | 检索本地 API 知识库（不联网、不调模型） |
| `component_showComponentStats` | 界面节点 / 区域 / 商品 / 脚本 / 实体分布 |
| `file_outputName` | 往该图资产目录写文件 |

**明确不支持 13 个**，但它们**仍然出现在 `tools/list` 里**：

`userCenterTool_userTokenAndUA` `userCenterTool_userInfo` `userCenterTool_accountsLogin`
`userCenterTool_accountsLogout` `file_npm_package_get` `file_npm_package_path`
`file_openArena` `file_reHMR` `file_stopHMR` `file_debugger` `file_openOutputLog`
`file_dao3config_open` `file_nodeJs_setting`

两个决定值得说明：

1. **账号类工具绝不假装成功。** 本地复刻没有账号体系，调用它们返回 `isError` 并写清原因。
   一个会吐出假 token 的登录工具，比没有这个工具危险得多。回归里专门有一条断言：
   拒绝文本中不得出现像 JWT 的串。
2. **做不到的也要留在清单里。** 客户端按官方清单调用时若拿到 `unknown tool`，
   Agent 会认为契约对不上而开始猜。给一个明确的"不支持 + 为什么 + 替代路径"更好。

`file_reHMR` / `file_stopHMR` 不支持是好消息：本应用**没有构建步骤**，改完刷新即可。

---

## CLI 能做的事

```bash
node scripts/dao3.mjs health                      # 服务与统计
node scripts/dao3.mjs blocks --grep 草             # 查方块 id（写体素前必查）
node scripts/dao3.mjs scaffold demo --shape 64,64,64 --floor 0
node scripts/dao3.mjs fill demo --box 4,1,4,12,6,12 --id 30
node scripts/dao3.mjs probe demo --at 8,8          # 读一根柱子，确认真的落下去了
node scripts/dao3.mjs script demo --name index.js --file ./s.js --client ./c.js
node scripts/dao3.mjs api say                      # 查官方 API
node scripts/dao3.mjs api --class GamePlayer
```

零依赖，只打 HTTP，不 import 项目里的任何模块（那会把 Three.js 和浏览器 API 一起拖进来）。

---

## 官方 API 全量规范随 skill 一起给

AI 最容易犯的错不是写错语法，是**编一个看起来合理的接口名**。所以 skill 带了三份东西：

| 文件 | 内容 | 为什么是它 |
|---|---|---|
| `references/api.md` | 100 个类的索引 + 端归属 + 成员数 | 目录，用来知道"有什么、叫什么"，不整篇读 |
| `references/scripting.md` | 两端全局划分、单位制、四元数序、颜色量纲等硬规范 | 全是踩过才知道的东西 |
| `dao3.mjs api` | 按 1044 个成员精确检索，回签名 + 官方中文说明 | 1.7 万词的文档不该进上下文，按需查 |

数据源是 `public/data/api-spec.json`，由 d.ts 的 `declare` 列表与官方中文注释合成。
它同时喂三个地方：文档站、应用内 AI 的规范注入、以及这个查询命令——
所以"AI 以为有的接口"和"实际实现的接口"不会各说一套。

查不到时的正确反应写死在输出里：**"这通常意味着官方没有这个接口——不要凭印象编一个出来。"**

---

## 三条会咬人的规范

**单位是「格 / tick」，不是「格 / 秒」。** `TICK_MS = 64` → 15.625 tick/秒（不是 20 TPS）。
`walkSpeed 0.22` 约等于 3.4 格/秒。当成格/秒，人物慢 15 倍。

**四元数是 `xyzw`。** 实测官方 432 个实体朝向：276 个是 `[0,0,0,1]`，**0 个**是 `[1,0,0,0]`；
`[0, 0.707, 0, 0.707]` 是绕 Y 轴 90° 偏航。按 `wxyz` 读会把偏航当成绕 Z，立着的物体被放倒。

**两端全局不是一套。** 服务端独占 `voxels` `resources` `storage` `db` `gui` 与全部 `Game*`；
客户端独占 `ui` `input` `screen` 与全部 `Ui*`。把 `storage` 写进客户端脚本不会立刻报错——
它是 `undefined`，第一次调用才炸。

---

## 边界

- **不联网。** 本应用承诺纯本地。按 CID 取回官方内容必须是用户明确点击才发生。
- **没有账号系统**，官方登录 / Token / 线上游玩统计拿不到。
- **项目包 .zip 导出在浏览器侧**（依赖 Three.js），CLI 里没有等价命令。
- **写体素是全量覆盖**，没有补丁接口。两个进程同时改同一张图会互相覆盖。
- **浏览器开着那张图时，自动存档可能盖掉 CLI 的改动。** 先关标签页，或改完立刻 `probe` 复查。

---

## 怎么验的

`test/mcp-arenapro.mjs` 里**自己实现了一个最小 MCP 客户端**：开 SSE、按 JSON-RPC 走
`initialize → tools/list → tools/call`。它不 import 被测模块——自己测自己等于自己给自己打分。

25 条断言，包括：官方 24 个工具名全部在册、账号工具返回 `isError` 且不含 JWT 样串、
真建一张图再写脚本再删掉、`checkDts` 不被注释里的假引用骗到、
路径穿越被**明确拒绝**而不是清洗后照写还报成功。

最后一条是修出来的真 bug：原先 `../../escape.txt` 会被静默改写成 `__escape.txt`
并回一句"已写"——调用方要求写 A 却拿到 B 且被告知成功。现在直接拒绝并说明原因。

---

## 相关文档

- [API 参考](api-reference.html) — 逐成员签名与实现状态
- [官方 API 兼容层](api-compat.html) — 对账方法与 15 条"看着实现了"的假接口
- [物理与单位制](physics.html) — 为什么是格/tick
- [AI 能力](ai.html) — 应用内的 AI 写代码 / 建模 / 全自动 Agent
