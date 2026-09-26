/**
 * mcp-arenapro.mjs — 让本地编辑器说官方 ArenaPro 的 MCP 契约。
 *
 * 官方契约（vendor/box3-product-document/arenapro/zh/mcp/index.md）：
 *   SSE 传输，地址 http://localhost:25315/ap-mcp，工具名如 file_mapTool / map_showMap。
 * 这里把**路径与工具名照官方保持一致**，只换端口与实现。这样已经按官方文档
 * 配好 `.vscode/mcp.json` 的 AI 客户端，把 URL 改成本地服务就接上了，
 * 不需要学第二套命令名。
 *
 * 零第三方依赖：MCP 的 SSE 传输就是 "text/event-stream + JSON-RPC 2.0"，手写够用。
 *
 * 一条硬规矩：**做不到的工具直接说不支持，不假装成功。**
 * userCenterTool_*（账号登录 / Token）依赖神岛线上账号体系，本地复刻没有账号系统，
 * 所以它们出现在 tools/list 里但一律返回明确的"不支持 + 为什么 + 替代路径"。
 * 一个会返回假 token 的登录工具，比没有这个工具危险得多。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PROTOCOL_FALLBACK = "2024-11-05";

/* ------------------------------ SSE 会话 ------------------------------ */
const sessions = new Map();   // sid -> { res, protocolVersion }

/**
 * endpoint 帧的 data 按 MCP 规格是**纯文本 URL**，不是 JSON。
 * 这里曾经把它 JSON.stringify 了一层，客户端拿到的就是
 * `"/ap-mcp/messages?sid=…"`（带引号），拼进 fetch 直接是非法 URL——
 * 也就是说任何真实 MCP 客户端都连不上，而自己写的测试客户端只要跟着错就查不出来。
 */
function sseRaw(res, event, data) {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}
function push(sid, payload) {
  const s = sessions.get(sid);
  if (!s || !res_writable(s.res)) return false;
  s.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}
const res_writable = (res) => res && res.writableEnded !== true && res.destroyed !== true;

/* ------------------------------ 知识库 ------------------------------ */
// 官方 chatjpt_onlyKnowledgeBase 查的是神岛 API 文档；我们这边有一份等价的
// public/data/api-spec.json。它的真实形状是：
//   { generated, types, members, merged,
//     classes: { World: { side:"server", kind:"interface", d:"说明",
//                         m: { say: { s:"say(text)", d:"说明" }, ... } } } }
// 注意成员表叫 m、说明叫 d、签名是 s —— 按 "classes 是数组、成员叫 members" 去读
// 会得到空结果，工具就变成一个永远说"没找到"的摆设。
let _spec = null;
function loadSpec(root) {
  if (_spec) return _spec;
  try { _spec = JSON.parse(fs.readFileSync(path.join(root, "public/data/api-spec.json"), "utf8")); }
  catch { _spec = { classes: {} }; }
  return _spec;
}
let _atlas = 0;
function atlasCount(root) {
  if (_atlas) return _atlas;
  try { _atlas = JSON.parse(fs.readFileSync(path.join(root, "public/data/block-atlas.json"), "utf8")).blocks.length; }
  catch { _atlas = 0; }
  return _atlas;
}
function eachMember(spec, fn) {
  for (const [cname, cls] of Object.entries(spec.classes || {})) {
    fn(cname, cls, null);
    for (const [mname, m] of Object.entries((cls && cls.m) || {})) fn(cname, cls, { name: mname, ...m });
  }
}
function searchSpec(spec, query, limit = 10) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/[\s.()、,，]+/).filter(Boolean);
  const hits = [];
  eachMember(spec, (cname, cls, m) => {
    const label = m ? `${cname}.${m.name}` : cname;
    const hay = `${label} ${(m ? m.d : cls.d) || ""} ${(m ? m.s : "") || ""} ${cls.side || ""}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!t || !hay.includes(t)) continue;
      score += t.length > 3 ? 3 : 2;
      if (label.toLowerCase() === t) score += 8;              // 正好点名一个成员，最该排前面
      else if (label.toLowerCase().startsWith(t)) score += 3;
    }
    if (score) hits.push({ label, score, sig: m ? m.s : (cls.kind || ""), d: (m ? m.d : cls.d) || "", side: cls.side || "" });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
    .map((h) => `${h.label}${h.sig ? "  " + h.sig : ""}${h.side ? `  [${h.side}]` : ""}${h.d ? "  — " + h.d : ""}`);
}

/* ------------------------------ 工具表 ------------------------------ */
/**
 * 每个工具：desc（给 AI 看的说明）、needs（必填参数）、run(ctx,args)。
 * run 返回字符串或 {text, isError}。
 */
const TOOLS = {
  file_mapTool: {
    desc: "地图选择：列出本地全部地图（id、名称、尺寸、体素数、实体数、脚本数）。",
    needs: [],
    run: (ctx) => {
      const ws = ctx.listWorlds();
      if (!ws.length) return "本地还没有任何地图。用 file_createProject 建一张。";
      return `共 ${ws.length} 张地图：\n` + ws.map((w) =>
        `${w.id}  ${w.name || "(未命名)"}  ${w.shape}  ${w.blockCount}格  实体${w.entities}  脚本${w.scripts}`).join("\n");
    },
  },
  map_showMap: {
    desc: "显示地图创作端：返回该地图在本地编辑器里的打开地址与结构摘要。",
    needs: ["mapId"],
    run: (ctx, a) => {
      const w = ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const m = w.meta || {};
      return [`创作端地址：${ctx.baseUrl}/edit/${a.mapId}`,
        `名称：${m.name || "(未命名)"}  尺寸：${(w.shape || []).join("×")}  体素：${(w.data || []).length}`,
        `实体：${(m.entities || []).length}  脚本：${(m.scripts || []).length}  区域：${(m.zones || []).length}  界面节点：${(m.ui || []).length}`].join("\n");
    },
  },
  map_playData: {
    desc: "查看游玩数据：本地没有线上统计，返回的是这张图的结构统计与运行时可查的规模。",
    needs: ["mapId"],
    run: (ctx, a) => {
      const w = ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const m = w.meta || {};
      const gr = m.gameRules || {};
      return [`地图 ${a.mapId}（${m.name || "未命名"}）`,
        `体素 ${(w.data || []).length} / 尺寸 ${(w.shape || []).join("×")}`,
        `实体 ${(m.entities || []).length}、脚本 ${(m.scripts || []).length}、区域 ${(m.zones || []).length}、商品 ${(m.products || []).length}`,
        `规则 tpm=${gr.tpm ?? 15.625}（官方 64ms/tick）`,
        `说明：这是本地复刻，没有官方服务器的在线游玩/留存统计可查。`].join("\n");
    },
  },
  map_resource: {
    desc: "同步地图资源：列出该地图已落盘的资产（模型、图片、音频）及其路径。",
    needs: ["mapId"],
    run: (ctx, a) => {
      const dir = path.join(ctx.assetsRoot, String(a.mapId).replace(/[^\w.-]/g, ""));
      if (!fs.existsSync(dir)) return `地图 ${a.mapId} 还没有落盘资产。`;
      const out = [];
      const walk = (d, rel) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + "/");
          else out.push(`${rel}${e.name}  ${fs.statSync(path.join(d, e.name)).size}B`);
        }
      };
      walk(dir, "");
      return out.length ? `资产 ${out.length} 个：\n` + out.join("\n") : "资产目录是空的。";
    },
  },
  file_createProject: {
    desc: "创建项目：在本地新建一张地图（带一层地面，避免出生即掉落）。参数 shape 形如 64,64,64。",
    needs: ["name"],
    run: (ctx, a) => {
      const id = a.mapId || crypto.randomBytes(7).toString("hex");
      if (!ctx.safeId(id)) return { text: `mapId 不合法：${id}`, isError: true };
      const shape = String(a.shape || "64,64,64").split(",").map(Number);
      if (shape.length !== 3 || shape.some((n) => !(n > 0 && n <= 512))) return { text: `shape 要三个 1..512 的数字，收到 ${a.shape}`, isError: true };
      const indices = [], data = [], rot = [];
      const floor = a.floor === undefined ? 0 : Number(a.floor);
      if (floor >= 0) {
        for (let x = 0; x < shape[0]; x++) for (let z = 0; z < shape[2]; z++) {
          indices.push(x + floor * shape[0] + z * shape[0] * shape[1]); data.push(1); rot.push(0);
        }
      }
      ctx.writeWorld(id, { formatVersion: "unity", shape, dir: [1, 1, 1], indices, data, rot, meta: { name: a.name, created: Date.now() } });
      return `已创建地图 ${id}（${a.name}，${shape.join("×")}，地面 ${indices.length} 格）\n创作端：${ctx.baseUrl}/edit/${id}`;
    },
  },
  file_upLoad: {
    desc: "上传 JS 文件：把一段脚本写进地图的指定端（server / client）。等价于官方 apc upload 的本地版。",
    needs: ["mapId", "end", "code"],
    run: (ctx, a) => {
      const w = ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const end = String(a.end || "").toLowerCase();
      if (end !== "server" && end !== "client") return { text: `end 只能是 server 或 client，收到 ${a.end}`, isError: true };
      w.meta = w.meta || {};
      if (!Array.isArray(w.meta.scripts)) w.meta.scripts = [];
      const name = a.name || "index.js";
      let s = w.meta.scripts.find((x) => x.name === name);
      if (!s) { s = { name, server: "", client: "" }; w.meta.scripts.push(s); }
      s[end] = String(a.code);
      ctx.writeWorld(a.mapId, w);
      return `已写入 ${a.mapId} 的 ${end} 端脚本「${name}」（${s[end].length} 字符）。地图现有 ${w.meta.scripts.length} 个脚本。`;
    },
  },
  file_buildNUpload: {
    desc: "构建和上传：从本地 ArenaPro 工程目录读 dist/server 与 dist/client 的 js，写进地图两端。",
    needs: ["mapId", "dir"],
    run: (ctx, a) => {
      const w = ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const root = path.resolve(String(a.dir));
      const lines = [];
      w.meta = w.meta || {};
      if (!Array.isArray(w.meta.scripts)) w.meta.scripts = [];
      for (const [sub, end] of [["server", "server"], ["client", "client"]]) {
        const d = path.join(root, "dist", sub);
        if (!fs.existsSync(d)) { lines.push(`${end}: 没有 ${d}，跳过`); continue; }
        const files = fs.readdirSync(d).filter((f) => /\.(js|cjs|mjs)$/i.test(f));
        if (!files.length) { lines.push(`${end}: ${d} 里没有 js 文件`); continue; }
        const code = files.map((f) => `// ==== ${f} ====\n${fs.readFileSync(path.join(d, f), "utf8")}`).join("\n");
        let s = w.meta.scripts.find((x) => x.name === "index.js");
        if (!s) { s = { name: "index.js", server: "", client: "" }; w.meta.scripts.push(s); }
        s[end] = code;
        lines.push(`${end}: 合并 ${files.length} 个文件，${code.length} 字符`);
      }
      ctx.writeWorld(a.mapId, w);
      return `构建上传完成 ${a.mapId}\n` + lines.join("\n");
    },
  },
  file_checkDts: {
    desc: "检查 Dts 文件：拿本地 API 规范核对脚本里引用的 world/player/game 成员是否真实存在。",
    needs: ["code"],
    run: (ctx, a) => {
      const spec = ctx.spec();
      const known = new Set();
      eachMember(spec, (cname, cls, m) => { if (m) known.add(m.name); known.add(cname); });
      if (known.size < 50) return { text: "读不到本地 API 规范（public/data/api-spec.json），无法核对。跑 npm run build:api-ref 生成。", isError: true };
      // 先去掉注释与字符串，否则注释里的示例、日志文案里的 "world.say" 都会被当成引用
      const code = String(a.code).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
        .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, '""');
      const used = new Map();
      for (const m of code.matchAll(/\b(world|player|game|entity)\.([A-Za-z_$][\w$]*)/g)) {
        if (!used.has(m[2])) used.set(m[2], m[1]);
      }
      const unknown = [...used.entries()].filter(([name]) => !known.has(name));
      const lines = [`规范里有 ${known.size} 个名字；脚本引用了 ${used.size} 个成员。`];
      if (unknown.length) {
        lines.push(`查不到的 ${unknown.length} 个：`);
        for (const [name, obj] of unknown.slice(0, 20)) lines.push(`  ${obj}.${name}  ← 规范里没有这个成员`);
        lines.push("注意：其中可能有你自己挂在对象上的自定义字段，那不算错；拼错的官方接口才是。");
      } else lines.push("全部能在规范里找到。");
      return lines.join("\n");
    },
  },
  chatjpt_onlyKnowledgeBase: {
    desc: "仅查询知识库：在本地 API 规范（含官方中文说明与单位）里检索，不联网、不调模型。",
    needs: ["query"],
    run: (ctx, a) => {
      const hits = searchSpec(ctx.spec(), a.query);
      return hits.length ? hits.join("\n") : `知识库里没找到「${a.query}」。试试类名（World / Player / Entity）或成员名（say / raycast）。`;
    },
  },
  component_showComponentStats: {
    desc: "显示组件统计：这张地图的界面节点、区域、商品、脚本与实体分布。",
    needs: ["mapId"],
    run: (ctx, a) => {
      const w = ctx.readWorld(a.mapId);
      if (!w) return { text: `找不到地图 ${a.mapId}`, isError: true };
      const m = w.meta || {};
      const byType = {};
      for (const n of (m.ui || [])) byType[n.type || n.kind || "?"] = (byType[n.type || n.kind || "?"] || 0) + 1;
      return [`界面节点 ${(m.ui || []).length}${Object.keys(byType).length ? "：" + Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(" ") : ""}`,
        `区域 ${(m.zones || []).length}、商品 ${(m.products || []).length}、脚本 ${(m.scripts || []).length}、实体 ${(m.entities || []).length}`,
        `方块种类 ${ctx.blockCount()}`].join("\n");
    },
  },
  file_outputName: {
    desc: "输出和更新文件：把内容写到该地图资产目录下的指定相对路径（供脚本 resources.ls 读取）。",
    needs: ["mapId", "path", "content"],
    run: (ctx, a) => {
      const raw = String(a.path).replace(/^[/\\]+/, "");
      // 带 .. 的路径直接拒，不做"清洗后照写"。
      // 之前是把 .. 换成 _ 然后回一句已写：调用方要求写 ../../escape.txt，
      // 实际落到 __escape.txt 却被告知成功——静默改写比报错更难查。
      if (raw.split(/[/\\]/).some((seg) => seg === "..")) return { text: `拒绝：path 里不允许有 .. 段（只能写在该地图资产目录内）`, isError: true };
      if (!raw) return { text: "path 不能为空", isError: true };
      const dir = path.join(ctx.assetsRoot, String(a.mapId).replace(/[^\w.-]/g, ""));
      const abs = path.resolve(dir, raw);
      // 第二道闸：软链、绝对路径、编码绕过都可能让解析结果跳出目录
      if (abs !== dir && !abs.startsWith(dir + path.sep)) return { text: `拒绝：解析结果跳出该地图资产目录`, isError: true };
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, typeof a.content === "string" ? a.content : JSON.stringify(a.content, null, 2));
      return `已写 ${raw}（${fs.statSync(abs).size}B）→ ${ctx.baseUrl}/assets/${a.mapId}/${raw}`;
    },
  },
};

/**
 * 官方有但本地**做不到**的：账号体系。
 * 它们仍然出现在 tools/list 里（客户端按官方清单调用时不该拿到 "unknown tool"，
 * 那会让 AI 以为契约对不上而开始猜），但调用一律回明确的"不支持 + 原因 + 替代"。
 */
const UNSUPPORTED = {
  userCenterTool_userTokenAndUA: "本地复刻没有账号系统，不存在 Token / UserAgent。要连官方账号请用官方 ArenaPro 插件。",
  userCenterTool_userInfo: "本地复刻没有账号系统，查不到用户信息。",
  userCenterTool_accountsLogin: "本地复刻不做登录：没有可登录的账号体系，也不会代你向神岛发起授权。",
  userCenterTool_accountsLogout: "本地复刻没有会话可登出。",
  file_npm_package_get: "不查 npm registry（本应用承诺纯本地不联网）。包清单见 docs/dependencies.md。",
  file_npm_package_path: "同上。",
  file_openArena: "这是 IDE 动作，本地服务无法替你打开资源管理器。",
  file_reHMR: "本服务无构建步骤、无 HMR：改完 public/ 下的文件直接刷新浏览器即可。",
  file_stopHMR: "同上，没有 HMR 可停。",
  file_debugger: "调试器是 IDE 能力，本地服务不接管。",
  file_openOutputLog: "日志在启动它的终端里；接口统计可用 GET /api/stats。",
  file_dao3config_open: "本地工程没有 dao3.config.ts；地图配置在 world 的 meta 字段里。",
  file_nodeJs_setting: "本地服务只用 Node 内置模块，没有第三方依赖要配。",
};

function toolDefs() {
  const out = [];
  for (const [name, t] of Object.entries(TOOLS)) {
    const props = {};
    for (const n of t.needs) props[n] = { type: "string", description: n };
    out.push({ name, description: t.desc, inputSchema: { type: "object", properties: props, required: t.needs } });
  }
  for (const [name, why] of Object.entries(UNSUPPORTED)) {
    out.push({ name, description: `【本地不支持】${why}`, inputSchema: { type: "object", properties: {} } });
  }
  return out;
}

/* ------------------------------ JSON-RPC ------------------------------ */
async function callTool(ctx, name, args) {
  if (UNSUPPORTED[name]) return { content: [{ type: "text", text: `不支持：${UNSUPPORTED[name]}` }], isError: true };
  const t = TOOLS[name];
  if (!t) return { content: [{ type: "text", text: `未知工具 ${name}` }], isError: true };
  const missing = t.needs.filter((k) => args[k] === undefined || args[k] === "");
  if (missing.length) return { content: [{ type: "text", text: `缺少参数：${missing.join(", ")}` }], isError: true };
  try {
    const r = t.run(ctx, args);
    const text = typeof r === "string" ? r : (r && r.text) || "";
    return { content: [{ type: "text", text }], isError: !!(r && r.isError) };
  } catch (e) {
    return { content: [{ type: "text", text: `工具执行失败：${(e && e.message) || e}` }], isError: true };
  }
}

function handleRpc(ctx, sid, msg) {
  const send = (payload) => push(sid, payload);
  const id = msg.id;
  switch (msg.method) {
    case "initialize":
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: "dao3-editor-clone (ArenaPro-compatible)", version: ctx.version },
      } });
    case "ping": return send({ jsonrpc: "2.0", id, result: {} });
    case "tools/list": return send({ jsonrpc: "2.0", id, result: { tools: toolDefs() } });
    case "tools/call":
      return callTool(ctx, msg.params.name, msg.params.arguments || {}).then((r) => send({ jsonrpc: "2.0", id, result: r }));
    default:
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
}

/**
 * 挂到 http server 上。返回 (req,res)=>true 表示这条请求归 MCP 管。
 */
export function createArenaProMcp(ctxIn) {
  // spec / blockCount 这两个只依赖仓库根，调用方没给就自己装，省得每处都要传一堆回调
  const ctx = {
    ...ctxIn,
    spec: ctxIn.spec || (() => loadSpec(ctxIn.root)),
    blockCount: ctxIn.blockCount || (() => atlasCount(ctxIn.root)),
  };
  return function route(req, res) {
    const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    // 发现端点：不走 MCP 协议也能看到本机支持/不支持哪些工具，
    // 排查"AI 说接上了但调不动"时这是第一站。
    if (u.pathname === "/api/mcp/tools" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        endpoint: "/ap-mcp", transport: "sse",
        officialContract: "ArenaPro 插件 MCP（官方默认 http://localhost:25315/ap-mcp）",
        supported: Object.keys(TOOLS), unsupported: UNSUPPORTED,
      }, null, 2));
      return true;
    }
    if (u.pathname === "/ap-mcp" && req.method === "GET") {
      const sid = crypto.randomBytes(8).toString("hex");
      res.writeHead(200, {
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive", "X-Accel-Buffering": "no",
      });
      res.write("retry: 3000\n\n");
      sessions.set(sid, { res, protocolVersion: PROTOCOL_FALLBACK });
      sseRaw(res, "endpoint", `/ap-mcp/messages?sid=${sid}`);
      req.on("close", () => sessions.delete(sid));
      return true;
    }
    if (u.pathname === "/ap-mcp/messages" && req.method === "POST") {
      const sid = u.searchParams.get("sid");
      if (!sessions.has(sid)) { res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"error":"unknown or closed session"}'); return true; }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(); });
      req.on("end", () => {
        res.writeHead(202).end();
        let msg; try { msg = JSON.parse(body); } catch { return; }
        if (Array.isArray(msg)) msg.forEach((m) => handleRpc(ctx, sid, m));
        else handleRpc(ctx, sid, msg);
      });
      return true;
    }
    return false;
  };
}

export const MCP_TOOL_NAMES = () => [...Object.keys(TOOLS), ...Object.keys(UNSUPPORTED)];
export const MCP_SUPPORTED = () => Object.keys(TOOLS);
export const MCP_UNSUPPORTED = () => UNSUPPORTED;
