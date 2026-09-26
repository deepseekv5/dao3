# AI 接入（Skill / MCP）

**这一层已经不在本仓库里了。**

`dao3-editor` Skill 与 ArenaPro 兼容的 MCP 服务现在住在独立仓库
**[deepseekv5/dao3-editor-skill](https://github.com/deepseekv5/dao3-editor-skill)**。

## 为什么拆出去

被驱动的东西不该和被驱动的接口焊在一起。

原先 MCP 是 `server.js` 里的一个路由，靠注入进程内函数（`readWorld` / `writeWorld` /
`listWorlds`）干活，Skill 则躺在编辑器的 `.qoder/skills/` 下。结果是：想把接入层给别人用，
得先把整个编辑器——含官方素材、地图存档、Three.js——一起给出去。

拆开之后依赖方向是单向的：**接入层依赖编辑器的 HTTP 接口，编辑器不知道接入层存在。**
编辑器换版本、换目录，甚至换成官方桌面版，接入层都不用改。

## 本仓库为它提供什么

接入层只依赖这三样公开接口，没有别的：

| 接口 | 用途 |
|---|---|
| `GET/PUT /api/world/:id`、`GET /api/worlds` | 读写整份地图 payload |
| `GET/POST/DELETE /api/world/:id/asset` | 地图资产目录 |
| `GET /data/api-spec.json` | 100 类 / 1044 成员的官方 API 规范（含中文说明与单位） |
| `GET /data/block-atlas.json` | 383 个方块表 |

`api-spec.json` 由 `npm run build:api-ref` 从各篇 d.ts 的 `declare` 列表与官方中文注释合成。
它同时喂三个地方：本文档站、应用内 AI 的规范注入、以及外部接入层的知识库检索——
**同源，所以"AI 以为有的接口"和"实际实现的接口"不会各说一套。**

## 快速接上

```bash
# 1. 起编辑器
node start.mjs --no-open --port=5180 --host=127.0.0.1
# 2. 另一个终端，起接入层（默认端口 25315，与官方 ArenaPro 插件一致）
node <dao3-editor-skill>/mcp/server.mjs
```

IDE 侧配 `.vscode/mcp.json`：

```json
{ "servers": { "ArenaPro-MCP": { "type": "sse", "url": "http://localhost:25315/ap-mcp" } } }
```

工具清单与"哪些做不到、为什么"在接入层仓库的 README 里，这里不复制——
复制一份就会有两份各自漂移的说法。

## 写脚本的人该看的

不管有没有接入层，这几条规范都成立，而且都在本仓库文档里：

- [物理与单位制](physics.html) — 为什么位移是「格 / tick」，`TICK_MS=64` → 15.625 tick/秒
- [官方 API 兼容层](api-compat.html) — 两端全局怎么裁剪、15 条"看着实现了"的假接口
- [API 参考](api-reference.html) — 逐成员签名、单位、实现状态
- [标准地图格式](map-format.html) — payload 索引算法、实体 22 键取值域
