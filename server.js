#!/usr/bin/env node
/**
 * server.js — DAO3 编辑器复刻本地服务（零第三方依赖，仅 Node 内置模块）
 *
 * 提供：
 *   1. 静态资源服务（public/，含构建期合成的 block 图集与缩略图）
 *   2. 世界持久化 REST API，数据格式与 box3lab/Box3Blocks-unityPackage
 *      的 .gz 导出完全一致：gzip(JSON(VoxelPayload))
 *        { formatVersion, shape:[X,Y,Z], dir:[1,1,1],
 *          indices:[...], data:[blockId...], rot:[...],
 *          lightIndices?, lightFlags?, lightIntensity?, lightRange?,
 *          lightColorRgb?, lightOffsetXyz? }
 *      外加编辑器元数据（天空/光照/地形设置等）存于 meta 字段。
 *   3. /edit/:id 路由回退到编辑器 HTML
 *
 * 世界文件存放于 server/data/worlds/<id>.json.gz
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC = path.join(__dirname, "public");
const DOCS = path.join(__dirname, "docs");
const WORLDS = path.join(__dirname, "server", "data", "worlds");
fs.mkdirSync(WORLDS, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".wasm": "application/wasm", ".gz": "application/gzip", ".map": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".vox": "application/octet-stream",
};
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, headers);
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), {
  "Content-Type": MIME[".json"], "Cache-Control": "no-store",
});

const safeId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const worldPath = (id) => path.join(WORLDS, `${id}.json.gz`);

// VOXA 模型文档（部件/骨骼/动画），按名字存 gzip JSON
const MODELS = path.join(__dirname, "server", "data", "models");
fs.mkdirSync(MODELS, { recursive: true });
const safeModelName = (n) => typeof n === "string" && n.length > 0 && n.length <= 80 && !/[\\/\0]/.test(n) && !n.includes("..");
const modelPath = (n) => path.join(MODELS, `${Buffer.from(String(n), "utf8").toString("hex").slice(0, 80)}.json.gz`);
function readModel(name) {
  const p = modelPath(name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8")); } catch { return null; }
}
function writeModel(name, doc) {
  const buf = zlib.gzipSync(Buffer.from(JSON.stringify(doc), "utf8"));
  fs.writeFileSync(modelPath(name), buf);
  return buf.length;
}
function listModels() {
  const out = [];
  for (const f of fs.readdirSync(MODELS)) {
    if (!f.endsWith(".json.gz")) continue;
    try {
      const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(MODELS, f))).toString("utf8"));
      const voxels = (doc.parts || []).reduce((s, p) => s + (p.voxels || []).length, 0);
      out.push({ name: doc.name || Buffer.from(f.replace(".json.gz", ""), "hex").toString("utf8"), parts: (doc.parts || []).length, bones: (doc.bones || []).length, anims: (doc.anims || []).length, voxels, mtime: fs.statSync(path.join(MODELS, f)).mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function readWorld(id) {
  const p = worldPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(p));
    return JSON.parse(raw.toString("utf8"));
  } catch (e) {
    console.error("readWorld error", e);
    return null;
  }
}
function writeWorld(id, payload) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  fs.writeFileSync(worldPath(id), gz);
  return gz.length;
}
const worldMetaCache = new Map(); // id -> { mtimeMs, name, blockCount }
function worldMeta(id, st) {
  const hit = worldMetaCache.get(id);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  const w = readWorld(id);
  const meta = (w && w.meta) || {};
  const rec = {
    mtimeMs: st.mtimeMs,
    name: meta.name || id,
    blockCount: w && Array.isArray(w.data) ? w.data.length : 0,
    entities: Array.isArray(meta.entities) ? meta.entities.length : 0,
    scripts: Array.isArray(meta.scripts) ? meta.scripts.length : 0,
    zones: Array.isArray(meta.zones) ? meta.zones.length : 0,
    products: Array.isArray(meta.products) ? meta.products.length : 0,
    ui: Array.isArray(meta.ui) ? meta.ui.length : (meta.uiTree ? 1 : 0),
    shape: Array.isArray(w && w.shape) ? w.shape.join("×") : null,
    shapeArr: Array.isArray(w && w.shape) ? w.shape : null,
    created: meta.created || null,
  };
  worldMetaCache.set(id, rec);
  return rec;
}
function listWorlds() {
  if (!fs.existsSync(WORLDS)) return [];
  return fs.readdirSync(WORLDS).filter((f) => f.endsWith(".json.gz")).map((f) => {
    const id = f.replace(/\.json\.gz$/, "");
    const st = fs.statSync(path.join(WORLDS, f));
    const m = worldMeta(id, st);
    return {
      id, size: st.size, mtime: st.mtimeMs, created: m.created || null,
      blockCount: m.blockCount, name: m.name,
      entities: m.entities || 0, scripts: m.scripts || 0, zones: m.zones || 0,
      products: m.products || 0, ui: m.ui || 0,
      shape: m.shape || null, shapeArr: m.shapeArr || null,
      cover: fs.existsSync(path.join(PUBLIC, "assets", "worlds", id, "cover.png")) ? 1 : 0,
    };
  }).sort((a, b) => b.mtime - a.mtime);
}

/* 工作台用的聚合指标：世界/体素/实体/脚本/区域/商品/模型/磁盘占用 */
let _statsCache = null, _statsAt = 0;
function dirBytes(p) {
  let t = 0;
  try {
    for (const f of fs.readdirSync(p)) {
      const fp = path.join(p, f);
      let st; try { st = fs.lstatSync(fp); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      t += st.isDirectory() ? dirBytes(fp) : st.size;
    }
  } catch {}
  return t;
}
function blockCount() {
  try {
    const p = path.join(PUBLIC, "data", "block-atlas.json");
    const st = fs.statSync(p);
    if (_atlasCache && _atlasCache.m === st.mtimeMs) return _atlasCache.n;
    const n = JSON.parse(fs.readFileSync(p, "utf8")).blocks.length;
    _atlasCache = { m: st.mtimeMs, n };
    return n;
  } catch { return 0; }
}
let _atlasCache = null;
let _apiCache = null;
function apiMemberCount() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", "api-members.json"), "utf8"));
    return Object.values(j).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
  } catch { return 0; }
}
function apiStats() {
  const now = Date.now();
  if (_statsCache && now - _statsAt < 4000) return _statsCache;
  if (_apiCache == null) _apiCache = apiMemberCount();
  const list = listWorlds();
  const sum = (k) => list.reduce((a, w) => a + (w[k] || 0), 0);
  const models = listModels();
  _statsCache = {
    worlds: list.length,
    voxels: sum("blockCount"),
    entities: sum("entities"),
    scripts: sum("scripts"),
    zones: sum("zones"),
    products: sum("products"),
    ui: sum("ui"),
    saveBytes: sum("size"),
    diskWorlds: dirBytes(WORLDS),
    diskAssets: dirBytes(path.join(PUBLIC, "assets")),
    blocks: blockCount(),
    voxaModels: models.length,
    voxaVoxels: models.reduce((a, m) => a + (m.voxels || 0), 0),
    newest: list.length ? list[0].mtime : 0,
    oldest: list.length ? list[list.length - 1].mtime : 0,
    uptime: Math.round(process.uptime()),
    node: process.versions.node,
    port: PORT,
    apiMembers: _apiCache,
  };
  _statsAt = now;
  return _statsCache;
}

const DEFAULT_WORLD = {
  formatVersion: "unity",
  shape: [64, 64, 64],
  dir: [1, 1, 1],
  indices: [], data: [], rot: [],
  meta: { name: "新建世界", terrain: {}, sky: {}, created: Date.now() },
};

/* 首次启动：若没有任何世界，则创建一个带 demo 地形的示例地图，
   其 id 与线上编辑器链接一致，方便对照。 */
function ensureSeed() {
  const seedId = "216d665d3ca92bd1b9a2";
  if (fs.existsSync(worldPath(seedId))) return;
  const X = 48, Y = 32, Z = 48;
  const indices = [], data = [], rot = [];
  const idOf = (n) => n; // block-id 数值
  const put = (x, y, z, id) => {
    if (x < 0 || y < 0 || z < 0 || x >= X || y >= Y || z >= Z) return;
    indices.push(x + y * X + z * X * Y);
    data.push(id);
    rot.push(0);
  };
  // ids: grass=127 dirt=125 stone=129 sand=135 water=170 glass=170? use real ids from block-id
  // 载入真实 id 表
  // 上游 Apache-2.0 的两张小表随仓库分发在 data/upstream/，本地 vendor/ 克隆只是备选
  const idTable = ["data/upstream/block-id.json", "vendor/Box3Blocks-unityPackage/Editor/SourceAssets/block-id.json"]
    .map((p) => path.join(__dirname, p)).find((p) => fs.existsSync(p));
  const ids = JSON.parse(fs.readFileSync(idTable, "utf8"));
  const byName = {}; for (const [num, name] of Object.entries(ids)) byName[name] = Number(num);
  const GRASS = byName.grass, DIRT = byName.dirt, STONE = byName.stone, SAND = byName.sand,
    ACACIA = byName.acacia, LEAF = byName.green_leaf, BRICK = byName.red_brick || byName.brick_red,
    PLANK = byName.plank_01, GLASS = byName.glass, WATER = byName.water, LANTERN = byName.lantern_01;
  const h = (x, z) => Math.round(8 + 5 * Math.sin(x / 7) * Math.cos(z / 8) + 3 * Math.sin((x + z) / 5));
  for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++) {
    const top = Math.max(2, Math.min(Y - 8, h(x, z)));
    for (let y = 0; y <= top; y++) {
      let id = STONE;
      if (y === top) id = top < 6 ? SAND : GRASS;
      else if (y > top - 3) id = DIRT;
      put(x, y, z, id);
    }
  }
  // 一间小木屋
  const bx = 20, bz = 18, by = h(bx, bz) + 1;
  for (let dx = 0; dx < 7; dx++) for (let dz = 0; dz < 7; dz++) {
    const edge = dx === 0 || dz === 0 || dx === 6 || dz === 6;
    for (let dy = 0; dy < 4; dy++) {
      if (edge) {
        const isWindow = dy === 2 && ((dx === 0 && dz === 3) || (dx === 6 && dz === 3) || (dz === 0 && dx === 3));
        put(bx + dx, by + dy, bz + dz, isWindow ? GLASS : PLANK);
      } else if (dy === 0) put(bx + dx, by, bz + dz, PLANK);
    }
  }
  for (let dx = -1; dx <= 7; dx++) for (let dz = -1; dz <= 7; dz++) put(bx + dx, by + 4, bz + dz, BRICK || PLANK);
  put(bx + 3, by + 1, bz, LANTERN); // 灯
  // 一棵树
  const tx = 34, tz = 30, ty = h(tx, tz) + 1;
  for (let dy = 0; dy < 5; dy++) put(tx, ty + dy, tz, ACACIA);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 4; dy <= 6; dy++) {
    if (Math.abs(dx) + Math.abs(dz) + (dy - 4) < 4 && !(dx === 0 && dz === 0 && dy < 5)) put(tx + dx, ty + dy, tz + dz, LEAF);
  }
  const payload = {
    formatVersion: "unity", shape: [X, Y, Z], dir: [1, 1, 1],
    indices, data, rot,
    meta: { name: "神岛示例世界", terrain: {}, sky: {}, created: Date.now() },
  };
  writeWorld(seedId, payload);
  console.log(`seeded demo world '${seedId}' with ${indices.length} blocks`);
}
ensureSeed();

/* --------------------------------- router -------------------------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // ---- API ----
  if (pathname.startsWith("/api/")) {
    const parts = pathname.split("/").filter(Boolean); // ['api', ...]
    if (req.method === "GET" && parts[1] === "worlds") return json(res, 200, { worlds: listWorlds() });
    if (req.method === "GET" && parts[1] === "stats") return json(res, 200, apiStats());
    if (parts[1] === "world" && safeId(parts[2]) && parts[3] === "fork" && req.method === "POST") {
      const src = readWorld(parts[2]);
      if (!src) return json(res, 404, { error: "源世界不存在" });
      const dst = String(url.searchParams.get("to") || "");
      if (!safeId(dst)) return json(res, 400, { error: "bad id" });
      if (fs.existsSync(worldPath(dst))) return json(res, 409, { error: "目标已存在" });
      src.meta = src.meta || {};
      src.meta.name = String(url.searchParams.get("name") || (src.meta.name || parts[2]) + " · 副本");
      src.meta.created = Date.now();
      const size = writeWorld(dst, src);
      worldMetaCache.delete(dst);
      const srcCover = path.join(PUBLIC, "assets", "worlds", parts[2], "cover.png");
      if (fs.existsSync(srcCover)) {
        const dir = path.join(PUBLIC, "assets", "worlds", dst);
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(srcCover, path.join(dir, "cover.png"));
      }
      return json(res, 200, { ok: true, id: dst, bytes: size });
    }
    // 只改元数据（重命名/备注）而不重群体素，供工作台行内改名用
    if (parts[1] === "world" && safeId(parts[2]) && parts[3] === "meta" && (req.method === "PATCH" || req.method === "POST")) {
      const w = readWorld(parts[2]);
      if (!w) return json(res, 404, { error: "not found" });
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
      req.on("end", () => {
        try {
          const patch = JSON.parse(body);
          w.meta = Object.assign({}, w.meta || {});
          for (const k of ["name", "description", "tags", "note"]) {
            if (patch[k] !== undefined) w.meta[k] = patch[k];
          }
          if (patch.displayName !== undefined) w.meta.displayName = patch.displayName;
          const size = writeWorld(parts[2], w);
          worldMetaCache.delete(parts[2]);
          json(res, 200, { ok: true, id: parts[2], bytes: size });
        } catch (e) { json(res, 400, { error: String(e.message || e) }); }
      });
      return;
    }
    if (parts[1] === "world" && safeId(parts[2])) {
      const id = parts[2];
      if (req.method === "GET") {
        const p = worldPath(id);
        const ae = String(req.headers["accept-encoding"] || "");
        if (fs.existsSync(p) && /gzip/i.test(ae)) {
          // 存的就是 gzip(JSON)，原样送出，浏览器自动解压
          res.writeHead(200, { "Content-Type": MIME[".json"], "Content-Encoding": "gzip", "Cache-Control": "no-store" });
          return fs.createReadStream(p).pipe(res);
        }
        const w = readWorld(id);
        return w ? json(res, 200, w) : json(res, 404, { error: "not found" });
      }
      if (req.method === "POST" || req.method === "PUT") {
        const chunks = []; let len = 0;
        req.on("data", (c) => { len += c.length; if (len > 80 * 1024 * 1024) { req.destroy(); return; } chunks.push(c); });
        req.on("end", () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks, len).toString("utf8"));
            if (!Array.isArray(payload.data)) return json(res, 400, { error: "invalid payload" });
            const size = writeWorld(id, payload);
            worldMetaCache.delete(id);
            json(res, 200, { ok: true, id, bytes: size, blockCount: payload.data.length });
          } catch (e) { json(res, 400, { error: String(e.message || e) }); }
        });
        return;
      }
      if (req.method === "DELETE") {
        const p = worldPath(id);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        // 一并删除该世界的资产目录（如导入 zip 提取的模型）
        const assetDir = path.join(PUBLIC, "assets", "worlds", id);
        if (fs.existsSync(assetDir)) fs.rmSync(assetDir, { recursive: true, force: true });
        worldMetaCache.delete(id);
        return json(res, 200, { ok: true });
      }
    }
    // 保存世界资产（zip 导入时提取的 models/*.gltf 等）：POST /api/world/:id/asset?path=models/a.gltf
    if (parts[1] === "world" && safeId(parts[2]) && parts[3] === "asset" && req.method === "POST") {
      const id = parts[2];
      const rel = (url.searchParams.get("path") || "").replace(/^\/+/, "");
      if (!rel || /\.\./.test(rel) || rel.length > 200) return json(res, 400, { error: "bad path" });
      const chunks = [];
      let total = 0;
      req.on("data", (c) => { chunks.push(c); total += c.length; if (total > 80 * 1024 * 1024) req.destroy(); });
      req.on("end", () => {
        try {
          const dir = path.join(PUBLIC, "assets", "worlds", id, path.dirname(rel));
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(PUBLIC, "assets", "worlds", id, rel), Buffer.concat(chunks));
          json(res, 200, { ok: true, path: rel, bytes: total });
        } catch (e) { json(res, 400, { error: String(e.message || e) }); }
      });
      return;
    }
    // ---- VOXA 模型库：GET/POST/DELETE /api/models[/:name] ----
    if (parts[1] === "models") {
      if (req.method === "GET" && parts.length === 2) return json(res, 200, { models: listModels() });
      const name = parts[2] ? decodeURIComponent(parts[2]) : null;
      if (name && !safeModelName(name)) return json(res, 400, { error: "bad model name" });
      if (req.method === "GET") {
        const m = readModel(name);
        return m ? json(res, 200, m) : json(res, 404, { error: "not found" });
      }
      if (req.method === "POST" || req.method === "PUT") {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 40 * 1024 * 1024) req.destroy(); });
        req.on("end", () => {
          try {
            const doc = JSON.parse(body);
            if (!doc || !Array.isArray(doc.parts)) return json(res, 400, { error: "invalid voxa doc" });
            json(res, 200, { ok: true, name, bytes: writeModel(name, doc) });
          } catch (e) { json(res, 400, { error: String(e.message || e) }); }
        });
        return;
      }
      if (req.method === "DELETE") {
        const p = modelPath(name);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 404, { error: "no such api" });
  }

  // ---- editor route fallback ----
  if (pathname.startsWith("/edit")) {
    pathname = "/editor.html";
  }
  if (pathname === "/voxa" || pathname === "/voxa/") {
    pathname = "/voxa.html";
  }
  if (pathname === "/site" || pathname === "/site/" || pathname === "/about") {
    pathname = "/site.html";
  }

  // ---- static ----
  // 介绍站与开发文档在仓库的 docs/ 下（GitHub Pages 的发布目录），本地同源可读
  const fromDocs = pathname === "/docs" || pathname === "/docs/" || pathname.startsWith("/docs/");
  let filePath;
  if (fromDocs) {
    const rest = pathname.replace(/^\/docs\/?/, "");
    filePath = path.join(DOCS, rest === "" ? "/index.html" : rest);
    if (!filePath.startsWith(DOCS)) return send(res, 403, "forbidden");
  } else {
    filePath = path.join(PUBLIC, pathname === "/" ? "/index.html" : pathname);
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, "forbidden");
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
  const ext = path.extname(filePath).toLowerCase();
  if (!fs.existsSync(filePath)) {
    // 资源类请求（带扩展名）缺失时返回 404，避免 HTML 兜底污染 ES module 加载
    if (ext && ext !== ".html") return send(res, 404, "not found");
    const editor = path.join(PUBLIC, "editor.html");
    if (fs.existsSync(editor)) { res.writeHead(200, { "Content-Type": MIME[".html"] }); return res.end(fs.readFileSync(editor)); }
    return send(res, 404, "not found");
  }
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
  if (ext === ".png" || ext === ".jpg" || ext === ".glb") headers["Cache-Control"] = "public, max-age=3600";
  // 代码类资源必须每次回源校验，否则改完 js/css 刷新还在跑旧的启发式缓存副本
  else if (ext === ".js" || ext === ".mjs" || ext === ".css" || ext === ".html") headers["Cache-Control"] = "no-cache";
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 500, "read error");
    send(res, 200, buf, headers);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`DAO3 编辑器复刻 本地服务已启动:`);
  console.log(`  编辑器:  http://${HOST}:${PORT}/edit/216d665d3ca92bd1b9a2`);
  console.log(`  世界列表: http://${HOST}:${PORT}/api/worlds`);
  console.log(`  静态目录: ${PUBLIC}`);
});
