#!/usr/bin/env node
/**
 * server.js — 老攸元宇宙本地服务（零第三方依赖，仅 Node 内置模块）
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
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import https from "node:https";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCommunity } from "./server/community.mjs";
import { createModeration } from "./server/moderate.mjs";
import { createRealtime } from "./server/realtime.mjs";
import { createSql } from "./server/sql.mjs";
import { blockColors, renderCover } from "./server/covers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "0"; }
  catch { return "0"; }
})();
// 启动器靠这个标识判断"端口上跑的是不是我们自己的上一个实例"。
// 换品牌时一起改了：旧实例带的是老标识，会被当成别人的进程而不去杀——这是 fail-closed，宁可换个端口也不误杀。
const OUR_APP = "laoyou-metaverse";
const UPDATE_REPO = process.env.LAOYOU_UPDATE_REPO || "deepseekv5/dao3";
const UPDATE_DISABLED = process.env.LAOYOU_NO_UPDATE === "1";
const UPDATE_TOKEN = crypto.randomBytes(18).toString("hex");
let updateCache = null, updateBusy = false;
const semver = (v) => String(v || "0").replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
function newerVersion(a, b) {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
async function latestRelease() {
  if (updateCache && Date.now() - updateCache.at < 10 * 60 * 1000) return updateCache.data;
  try {
    const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "laoyou-metaverse-updater" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(r.status === 403 ? "GitHub 接口限流，请稍后再试" : "GitHub 返回 " + r.status);
    const data = await r.json();
    const asset = (data.assets || []).find((a) => /^DAO3-portable-v.*\.zip$/i.test(a.name));
    const out = {
      latestVersion: String(data.tag_name || "").replace(/^v/i, ""),
      notes: String(data.body || ""),
      publishedAt: data.published_at || "",
      url: data.html_url || "",
      asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null,
    };
    updateCache = { at: Date.now(), data: out };
    return out;
  } catch (apiErr) {
    // api.github.com 被代理/限流时，用 release 页面重定向兜底；资产名是固定规则。
    const h = await fetch(`https://github.com/${UPDATE_REPO}/releases/latest`, {
      method: "HEAD", redirect: "manual", headers: { "User-Agent": "laoyou-metaverse-updater" },
      signal: AbortSignal.timeout(20000),
    });
    const loc = h.headers.get("location") || "";
    const version = (loc.match(/\/tag\/v?([^/?#]+)/) || [])[1];
    if (!version) throw apiErr;
    const out = {
      latestVersion: version,
      notes: "本次更新说明请查看 GitHub Release。",
      publishedAt: "", url: `https://github.com/${UPDATE_REPO}/releases/tag/v${version}`,
      asset: { name: `DAO3-portable-v${version}.zip`, size: 0, url: `https://github.com/${UPDATE_REPO}/releases/download/v${version}/DAO3-portable-v${version}.zip` },
    };
    updateCache = { at: Date.now(), data: out };
    return out;
  }
}
function updateCheckPayload(rel) {
  const available = !!(rel.asset && newerVersion(rel.latestVersion, PKG_VERSION));
  return {
    enabled: !UPDATE_DISABLED, currentVersion: PKG_VERSION, latestVersion: rel.latestVersion,
    updateAvailable: available, notes: rel.notes, publishedAt: rel.publishedAt, url: rel.url,
    asset: available ? rel.asset : null, token: UPDATE_TOKEN,
  };
}
async function applyUpdate(rel, res) {
  if (UPDATE_DISABLED) return json(res, 403, { error: "自动更新已禁用" });
  if (updateBusy) return json(res, 409, { error: "已有更新正在进行" });
  if (!rel.asset || !newerVersion(rel.latestVersion, PKG_VERSION)) return json(res, 400, { error: "已经是最新版本" });
  updateBusy = true;
  try {
    const dl = await fetch(rel.asset.url, { headers: { "User-Agent": "laoyou-metaverse-updater" }, signal: AbortSignal.timeout(180000) });
    if (!dl.ok) throw new Error("下载失败 " + dl.status);
    const bytes = Buffer.from(await dl.arrayBuffer());
    if (bytes.length > 320 * 1024 * 1024) throw new Error("更新包过大");
    const { readZipEntries } = await import(new URL("./public/js/zip.js", import.meta.url));
    const zip = await readZipEntries(new Blob([bytes]));
    const names = zip.entries.map((e) => e.name.replace(/\\/g, "/"));
    const roots = new Set(names.map((n) => n.split("/")[0]));
    const prefix = roots.size === 1 && names.every((n) => n.includes("/")) ? [...roots][0] + "/" : "";
    const stage = path.join(__dirname, ".update", "staged-" + rel.latestVersion);
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const allowed = new Set(["public", "server", "scripts", "docs", "data", "package.json", "server.js", "start.mjs", "update-runner.mjs", "run.sh", "run-win.ps1", "启动-Windows.bat", "启动-macOS.command", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "VERSION"]);
    let written = 0;
    for (const entry of zip.entries) {
      let relPath = entry.name.replace(/\\/g, "/");
      if (prefix && relPath.startsWith(prefix)) relPath = relPath.slice(prefix.length);
      if (!relPath || relPath.includes("\0") || relPath.split("/").some((s) => s === ".." || s === "")) continue;
      const top = relPath.split("/")[0];
      if (!allowed.has(top)) continue;
      if (/^server\/data(?:\/|$)/.test(relPath) || /^public\/assets(?:\/|$)/.test(relPath) || /^public\/data\/assets(?:\/|$)/.test(relPath)) continue;
      const target = path.resolve(stage, relPath);
      if (!target.startsWith(path.resolve(stage) + path.sep)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(await zip.extract(entry)));
      if (/\.(sh|command)$/.test(target)) { try { fs.chmodSync(target, 0o755); } catch {} }
      written++;
    }
    if (!written) throw new Error("更新包里没有可安装文件");
    const stagedPkg = JSON.parse(fs.readFileSync(path.join(stage, "package.json"), "utf8"));
    if (String(stagedPkg.version) !== String(rel.latestVersion)) throw new Error("更新包版本号不一致");
    if (!fs.existsSync(path.join(stage, "server.js")) || !fs.existsSync(path.join(stage, "public/editor.html"))) throw new Error("更新包缺少核心文件");
    const runner = path.join(__dirname, "update-runner.mjs");
    const child = spawn(process.execPath, [runner, __dirname, stage, rel.latestVersion, String(PORT), String(HOST), String(process.pid)], {
      cwd: __dirname, detached: true, stdio: "ignore", windowsHide: true,
      env: { ...process.env },
    });
    child.unref();
    json(res, 200, { ok: true, version: rel.latestVersion, files: written, restarting: true });
    setTimeout(() => process.exit(0), 350);
  } catch (err) {
    updateBusy = false;
    json(res, 500, { error: String(err && err.message || err) });
  }
}
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC = path.join(__dirname, "public");
const DOCS = path.join(__dirname, "docs");
// ── 可写数据目录 ────────────────────────────────────────────────────────────
// 不能假设「安装目录可写」。从 .dmg 挂载运行、装进 Program Files、放在只读网络盘上
// 都是正常的用户行为，此时 mkdir 直接抛 ENOENT/EROFS，整个服务起不来。
// 所以先试安装目录，不行就退到用户目录，并把实际位置打印出来（否则用户找不到自己存的图）。
function writableDir(candidates) {
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, ".write-test");
      fs.writeFileSync(probe, "");
      fs.unlinkSync(probe);
      return dir;
    } catch { /* 换下一个候选 */ }
  }
  return null;
}
const HOME_DATA = path.join(os.homedir(), ".dao3-editor");
// 显式给目录时用给的（回归测试要跑在一个干净的临时库里，
// 不然大数据量的测试账号会永远留在开发用的库中）；没给才自动挑可写位置。
const DATA_ROOT = process.env.DATA_DIR || writableDir([path.join(__dirname, "server", "data"), HOME_DATA]) || HOME_DATA;
if (process.env.DATA_DIR) { try { fs.mkdirSync(process.env.DATA_DIR, { recursive: true }); } catch { /* 交给后面的 writableDir 使用者报错 */ } }
const WORLDS = path.join(DATA_ROOT, "worlds");
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

/** 递归列出一个目录下的文件（相对路径 + 字节数）。目录不存在就是空表。 */
function listAssetFiles(root, rel = "", out = []) {
  let items;
  try { items = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const r = rel ? rel + "/" + it.name : it.name;
    if (it.isDirectory()) listAssetFiles(root, r, out);
    else { try { out.push({ path: r, bytes: fs.statSync(path.join(root, r)).size }); } catch {} }
  }
  return out;
}

// VOXA 模型文档（部件/骨骼/动画），按名字存 gzip JSON
const MODELS = path.join(DATA_ROOT, "models");
fs.mkdirSync(MODELS, { recursive: true });
// 世界贴图/模型等上传件。安装目录只读时同样退到 DATA_ROOT，
// 但读取时两处都要找（老包里的 public/assets/worlds 可能已有内容）。
const ASSETS = path.join(DATA_ROOT, "assets");
const ASSETS_IN_TREE = path.join(PUBLIC, "assets", "worlds");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  const out = [0];
  for (const ch of s) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error("bad base58");
    let carry = val;
    for (let i = 0; i < out.length; i++) { const n = out[i] * 58 + carry; out[i] = n & 0xff; carry = n >> 8; }
    while (carry) { out.push(carry & 0xff); carry >>= 8; }
  }
  return Buffer.from(out.reverse());
}
function verifyCid(cid, body) {
  try {
    const raw = b58decode(cid);
    if (raw.length !== 34 || raw[0] !== 0x12 || raw[1] !== 0x20) return false;
    return crypto.createHash("sha256").update(body).digest().equals(raw.subarray(2));
  } catch { return false; }
}
function httpsBuffer(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, headers: { "User-Agent": "laoyou-metaverse-official" }, timeout: 10000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        resolve(httpsBuffer(new URL(r.headers.location, url).href, redirects - 1));
        return;
      }
      if (r.statusCode !== 200) { r.resume(); reject(new Error("HTTP " + r.statusCode)); return; }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve(Buffer.concat(chunks)));
      r.on("error", reject);
    });
    // 关掉 TLS 校验只是网关证书兼容；这里必须有硬超时，否则网关不响应时
    // 启动流程的实体补齐会一直挂起（实测卡在"解码体素 100%"）。
    const hard = setTimeout(() => req.destroy(new Error("网关超时")), 12000);
    req.on("close", () => clearTimeout(hard));
    req.on("timeout", () => req.destroy(new Error("网关超时")));
    req.on("error", (err) => { clearTimeout(hard); reject(err); });
  });
}
async function officialBlock(cid) {
  if (!/^Qm[1-9A-HJ-NP-Za-km-z]{30,50}$/.test(cid)) throw new Error("不是合法的 Qm CID");
  const cache = path.join(DATA_ROOT, "official-cache", "blocks", cid);
  if (fs.existsSync(cache)) {
    const body = fs.readFileSync(cache);
    if (verifyCid(cid, body)) return body;
  }
  let last = null;
  for (const base of ["https://static.box3.codemao.cn/block/", "https://static.dao3.fun/block/"]) {
    try {
      const body = await httpsBuffer(base + encodeURIComponent(cid));
      if (!verifyCid(cid, body)) throw new Error("CID 校验失败");
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.writeFileSync(cache, body);
      return body;
    } catch (err) { last = err; }
  }
  throw last || new Error("取不到官方内容");
}
fs.mkdirSync(ASSETS, { recursive: true });
const worldAssetDir = (id) => (fs.existsSync(path.join(ASSETS, id)) || !fs.existsSync(path.join(ASSETS_IN_TREE, id)))
  ? path.join(ASSETS, id) : path.join(ASSETS_IN_TREE, id);
const worldAssetExists = (id, rel = "") =>
  fs.existsSync(path.join(ASSETS, id, rel)) || fs.existsSync(path.join(ASSETS_IN_TREE, id, rel));
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
      out.push({ name: doc.name || Buffer.from(f.replace(".json.gz", ""), "hex").toString("utf8"), type: doc.type || "free", parts: (doc.parts || []).length, bones: (doc.bones || []).length, anims: (doc.anims || []).length, voxels, mtime: fs.statSync(path.join(MODELS, f)).mtimeMs });
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
  const path = worldPath(id);
  fs.writeFileSync(path, gz);
  fs.rmSync(path.replace(/\.json\.gz$/, ".bin.gz"), { force: true });
  return gz.length;
}
function worldBinaryPath(id) { return worldPath(id).replace(/\.json\.gz$/, ".bin.gz"); }
function readWorldBinary(id) {
  const cached = worldBinaryPath(id);
  if (fs.existsSync(cached)) return fs.readFileSync(cached);
  const payload = readWorld(id);
  if (!payload) return null;
  const meta = Buffer.from(JSON.stringify(payload.meta || {}), "utf8");
  const shape = payload.shape || [64, 64, 64];
  const count = (payload.data || []).length;
  const header = 4 + meta.length + 12 + 4;
  const out = Buffer.allocUnsafe(header + count * 7);
  let p = 0;
  out.writeUInt32LE(meta.length, p); p += 4;
  meta.copy(out, p); p += meta.length;
  for (let i = 0; i < 3; i++) { out.writeUInt32LE(shape[i] | 0, p); p += 4; }
  out.writeUInt32LE(count, p); p += 4;
  const indices = payload.indices || [], data = payload.data || [], rot = payload.rot || [];
  for (let i = 0; i < count; i++) {
    out.writeUInt32LE(indices[i] | 0, p); p += 4;
    out.writeUInt16LE(data[i] | 0, p); p += 2;
    out.writeUInt8(rot[i] || 0, p); p += 1;
  }
  const gz = zlib.gzipSync(out, { level: 6 });
  fs.writeFileSync(cached, gz);
  return gz;
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
      cover: worldAssetExists(id, "cover.png") ? 1 : 0,
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
   其 id 与线上编辑器链接一致，方便对照。

   官方赛车模板（256×128×256 / 152 万格 / 199 实体）随包分发在
   official-project/racing-template.json.gz，但**不会自动装**：它是 box3lab 的地图数据，
   必须用户在应用内明确确认"我有权获取并使用它"之后才落地（见 /api/consent）。
   没确认前跑的是下面这份程序化 demo 地形，功能一样可验证。 */
const TEMPLATE_PAYLOAD = path.join(__dirname, "official-project", "racing-template.json.gz");
const CONSENT_FILE = path.join(DATA_ROOT, "consent.json");
const SEED_ID = "216d665d3ca92bd1b9a2";

/* 官方赛道模型与音效：随包分发在 official-project/racing-assets/ 下，
   但和地图数据一样**默认不放行**——必须用户在应用内确认过授权，服务端才让这两个前缀通过。
   闸门做在服务端而不是只藏个按钮：素材本体在仓库里，前端只要拿到 URL 就能取，
   唯一的真约束是这个请求必须由服务端点头。 */
const ASSET_BUNDLE = path.join(__dirname, "official-project", "racing-assets");
const GATED_ASSETS = [
  { prefix: "/assets/racing/models/", dir: path.join(ASSET_BUNDLE, "models"), kind: "模型" },
  { prefix: "/data/assets/audio/", dir: path.join(ASSET_BUNDLE, "audio"), kind: "音效" },
];
function bundleStat() {
  const out = {};
  for (const g of GATED_ASSETS) {
    try {
      const files = fs.readdirSync(g.dir).filter((f) => fs.statSync(path.join(g.dir, f)).isFile());
      out[g.kind] = { count: files.length, bytes: files.reduce((s, f) => s + fs.statSync(path.join(g.dir, f)).size, 0) };
    } catch { out[g.kind] = { count: 0, bytes: 0 }; }
  }
  return out;
}
/** 授权确认框要写清"这张模板到底给你什么"。数字必须从包里真读出来：
    写死一份就会和包脱节，那个框就变成一份"看着对"的假文案。 */
let _tplStatCache = null;
function templateStat() {
  if (_tplStatCache) return _tplStatCache;
  if (!fs.existsSync(TEMPLATE_PAYLOAD)) return null;
  try {
    const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(TEMPLATE_PAYLOAD)).toString("utf8"));
    const meta = j.meta || {};
    // 模板存的是**摊平**的一份世界：shape/indices/data/rot 在顶层，不再套一层 world
    _tplStatCache = {
      name: meta.name || "赛车模板",
      shape: j.shape || null,
      blocks: (j.indices && j.indices.length) || 0,
      entities: (meta.entities || []).length,
      scripts: (meta.scripts || []).length,
    };
    return _tplStatCache;
  } catch { return null; }
}
/** 命中受闸门保护的素材前缀则返回 {file, group}，否则 null。
 *  文件名必须落在 bundle 目录内：decodeURIComponent 之后可以带 ../，不挡就是任意文件读。 */
function gatedAsset(pathname) {
  for (const g of GATED_ASSETS) {
    if (!pathname.startsWith(g.prefix)) continue;
    const rel = decodeURIComponent(pathname.slice(g.prefix.length));
    if (!rel || rel.includes("\0") || rel.includes("..")) return { blocked: "bad name" };
    const abs = path.resolve(g.dir, rel);
    if (!abs.startsWith(path.resolve(g.dir) + path.sep)) return { blocked: "escapes bundle" };
    return { file: abs, group: g };
  }
  return null;
}

function readConsent() {
  try { return JSON.parse(fs.readFileSync(CONSENT_FILE, "utf8")); } catch { return { racingTemplate: "unset" }; }
}
function writeConsent(obj) {
  try { fs.writeFileSync(CONSENT_FILE, JSON.stringify(obj, null, 1)); } catch { /* 只读目录：记住失败即可，不影响启动 */ }
  return obj;
}
/** 把随包分发的官方模板装成种子世界。
 *  目标位已被程序化 demo 占着（同一个 id，因为要和线上编辑器链接对齐），
 *  所以只在「那份 demo 没被用户改过」时才覆盖——改过的图绝不能被模板冲掉。 */
function installRacingTemplate() {
  if (!fs.existsSync(TEMPLATE_PAYLOAD)) return { ok: false, error: "包内没有 racing-template.json.gz" };
  const dst = worldPath(SEED_ID);
  if (fs.existsSync(dst)) {
    if (!isUntouchedProceduralDemo(dst)) return { ok: true, already: true, occupied: true };
    try { fs.unlinkSync(dst); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  try {
    fs.copyFileSync(TEMPLATE_PAYLOAD, dst);
    worldMetaCache.delete(SEED_ID);
    return { ok: true, installed: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
/** 只读一次 gz 的 meta 判断是不是没动过的 demo；读不动就当改过，宁可不覆盖 */
function isUntouchedProceduralDemo(file) {
  try {
    const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
    return j.meta && j.meta.seedKind === "procedural";
  } catch { return false; }
}

function ensureSeed() {
  const seedId = SEED_ID;
  if (fs.existsSync(worldPath(seedId))) return;
  // 已确认过就装官方模板，不再造程序化 demo
  if (readConsent().racingTemplate === "granted" && installRacingTemplate().ok) {
    console.log(`seeded official racing template '${seedId}' (consented)`);
    return;
  }
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
    meta: { name: "老攸示例世界", terrain: {}, sky: {}, created: Date.now(), seedKind: "procedural" },
  };
  writeWorld(seedId, payload);
  console.log(`seeded demo world '${seedId}' with ${indices.length} blocks`);
}
ensureSeed();

/* 还没封面的图，开服务时顺手画一张。
   以前封面只有"人开着编辑器、编辑器截到视图"这一条来路，于是新建的图、导入的图、
   脚本批量生成的图在列表里全是一个按 id 派生渐变的占位块。服务启动跑一遍，
   "所有地图都有封面"就跟有没有人打开过编辑器无关了。跑在后台，不挡启动。 */
const _coverSweep = setTimeout(() => {
  try {
    const colors = blockColors(path.join(PUBLIC, "data", "block-atlas.json"), path.join(PUBLIC, "data", "block-atlas.png"));
    let made = 0;
    for (const f of fs.readdirSync(WORLDS)) {
      if (!f.endsWith(".json.gz")) continue;
      const id = f.replace(/\.json\.gz$/, "");
      const cover = path.join(ASSETS, id, "cover.png");
      if (fs.existsSync(cover)) continue;
      try {
        const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(WORLDS, f))).toString());
        const png = renderCover({ indices: snap.indices, data: snap.data, shape: snap.shape, colors });
        if (!png) continue;
        fs.mkdirSync(path.dirname(cover), { recursive: true });
        fs.writeFileSync(cover, png);
        made++;
      } catch { /* 单张画不出来不影响服务 */ }
    }
    if (made) console.log(`为 ${made} 张地图生成了封面`);
  } catch (e) { console.log("封面生成跳过：" + (e.message || e)); }
}, 1200);
if (_coverSweep.unref) _coverSweep.unref();   // 不给进程吊着一根定时器

/* --------------------------------- router -------------------------------- */
/* ---------------- AI 代理 ----------------
 * 浏览器里直连第三方接口要赌对方开了 CORS，而且密钥会出现在页面的网络面板里发给
 * 任意域名。这里把它收口成一个只对本机开放的转发：密钥由前端随请求体送来，
 * 只用于拼这一次上游请求，不落盘、不进日志、出错时先抹掉再回显。
 */
const AI_MAX_BODY = 4 * 1024 * 1024;      // 提示词 + 代码上下文
const AI_MAX_MS = 180000;
const isLoopback = (ip) => /^(127\.|::1$|::ffff:127\.|localhost$)/.test(String(ip || ""));
function normalizeAiBase(u) {
  let x = String(u || "").trim();
  if (!x) return null;
  if (!/^https?:\/\//i.test(x)) x = "https://" + x;
  let p;
  try { p = new URL(x); } catch { return null; }
  if (p.protocol !== "http:" && p.protocol !== "https:") return null;
  // 用户名/密码写在 URL 里会被 fetch 直接带进 Authorization，绕过我们统一的鉴权头，
  // 也会出现在任何一句错误文本里——一律拒绝，让用户把 key 填在密钥框。
  if (p.username || p.password) return null;
  return p.href.replace(/\/+$/, "");
}
const scrub = (text, key) => {
  let s = String(text == null ? "" : text);
  if (key) s = s.split(key).join("••••");
  return s.replace(/sk-[A-Za-z0-9_\-]{12,}/g, "sk-••••").slice(0, 600);
};

// ── 社区层 ────────────────────────────────────────────────────────────────
// 账号、关注、好友、地图发布与评论。数据落在 DATA_ROOT/community/ 下，
// 和世界存档同一个可写策略（安装目录只读时退到用户目录）。
const moderation = createModeration({ file: path.join(DATA_ROOT, "community", "mute-words.json") });
// realtime 要在 community 之后才建（它反过来要拿 community 挂聊天频道），
// 而 community 的 presence 回调引用它。先声明成 null：对 const 用 typeof 会踩
// 暂时性死区直接抛 ReferenceError，那比返回 0 糟得多。
let realtime = null;
const community = createCommunity({
  dataRoot: DATA_ROOT, worldsDir: WORLDS, assetRoots: [ASSETS, ASSETS_IN_TREE], moderation,
  // 缺封面的图要用方块自己的颜色画小地图，而不是退化成一段按 id 派生的渐变
  atlas: { json: path.join(PUBLIC, "data", "block-atlas.json"), png: path.join(PUBLIC, "data", "block-atlas.png") },
  // 「正在玩」读的是实时房间人数，不是累计游玩数。
  presence: (pubId) => (realtime ? realtime.room("pub:" + pubId).length : 0),
});

// 联机通道：升级请求由它自己判会话 cookie，路径不是 /ws/play/<pub> 的原样放回去。
// 编辑协作房间要求世界存档真的存在，否则第二个人进来是空世界——两个人的"同一张图"
// 就成了两张图。存档目录只有这里知道，所以以回调形式注入。
realtime = createRealtime({ community, worldExists: (id) => /^[A-Za-z0-9_-]{4,32}$/.test(id)
  && fs.existsSync(path.join(WORLDS, id + ".json.gz")) });

// 官方 GameDatabase.sql 的执行端：每个世界一个 .sqlite，落在世界存档旁边。
const sql = createSql(WORLDS);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // ---- API ----
  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/official-block/") && req.method === "GET") {
      const cid = decodeURIComponent(pathname.slice("/api/official-block/".length));
      officialBlock(cid)
        .then((body) => send(res, 200, body, { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=86400" }))
        .catch((err) => json(res, 502, { error: String(err && err.message || err) }));
      return;
    }
    if (pathname === "/api/version" && req.method === "GET") return json(res, 200, { version: PKG_VERSION, app: OUR_APP });
    if (pathname === "/api/update/check" && req.method === "GET") {
      if (UPDATE_DISABLED) return json(res, 200, { enabled: false, currentVersion: PKG_VERSION });
      latestRelease()
        .then((rel) => json(res, 200, updateCheckPayload(rel)))
        .catch((err) => json(res, 502, { enabled: true, currentVersion: PKG_VERSION, error: String(err && err.message || err) }));
      return;
    }
    if (pathname === "/api/update/apply" && req.method === "POST") {
      if (req.headers["x-laoyou-update-token"] !== UPDATE_TOKEN) return json(res, 403, { error: "更新令牌无效" });
      latestRelease()
        .then((rel) => applyUpdate(rel, res))
        .catch((err) => { if (!res.writableEnded) json(res, 502, { error: String(err && err.message || err) }); });
      return;
    }
    // 社区层自己收尾（它是异步的：读 body 要等），所以先于其它 api 分支拦下来
    if (pathname.startsWith("/api/community/")) {
      community.handle(req, res, url).catch((e) => {
        console.error("community:", (e && e.stack) || e);
        if (!res.writableEnded) json(res, 500, { error: "社区接口出错：" + String((e && e.message) || e) });
      });
      return;
    }
    const parts = pathname.split("/").filter(Boolean); // ['api', ...]
    if (req.method === "GET" && parts[1] === "worlds") return json(res, 200, { worlds: listWorlds() });
    if (req.method === "GET" && parts[1] === "stats") return json(res, 200, apiStats());
    // 身份指纹：启动器靠它判断端口上跑的是不是「我们自己的」上一个实例，
    // 是才可以杀；不认识的一律不动，避免误杀用户别的开发服务。
    if (req.method === "GET" && parts[1] === "whoami") {
      return json(res, 200, { app: OUR_APP, version: PKG_VERSION, root: __dirname });
    }
    // 官方素材的授权确认状态。地图、模型、音效都随包分发，但只有用户在应用内
    // 明确同意后才落地/放行。两项分开记：新素材需要重新表态，不能沿用旧决定。
    if (parts[1] === "consent") {
      if (req.method === "GET") {
        const c = readConsent();
        const dst = worldPath(SEED_ID);
        // 库里那张到底是不是官方模板：只看来源标记。
        // 以前比的是文件字节数，可作者只要在编辑器里动一次图，存档大小就变了，
        // 于是"未装入本机"贴在一张明明躺在列表里的图上——那是撒谎，不是保守。
        const isTemplate = fs.existsSync(dst) && !isUntouchedProceduralDemo(dst);
        const bundle = bundleStat();
        return json(res, 200, {
          racingTemplate: c.racingTemplate || "unset",
          racingAssets: c.racingAssets || "unset",
          available: fs.existsSync(TEMPLATE_PAYLOAD),
          assetsAvailable: bundle.模型.count > 0 && bundle.音效.count > 0,
          template: templateStat(),
          bundle,
          installed: isTemplate,
        });
      }
      if (req.method === "POST" || req.method === "PUT") {
        let body = "";
        req.on("data", (ch) => { body += ch; if (body.length > 4096) req.destroy(); });
        req.on("end", () => {
          let reqBody = {};
          try { reqBody = JSON.parse(body || "{}") || {}; } catch { /* 视作拒绝 */ }
          // 只认显式给出的键：不带 racingAssets 的老前端不会顺手把素材也授了
          const patch = {};
          if ("racingTemplate" in reqBody) patch.racingTemplate = reqBody.racingTemplate ? "granted" : "declined";
          if ("racingAssets" in reqBody) patch.racingAssets = reqBody.racingAssets ? "granted" : "declined";
          const next = writeConsent(Object.assign({}, readConsent(), patch));
          const install = patch.racingTemplate === "granted" ? installRacingTemplate() : { ok: true, skipped: true };
          if (!install.ok) return json(res, 400, { error: install.error, racingTemplate: next.racingTemplate });
          // occupied 必须透出去：前端靠它区分"已装好"和"你有自己的图，我没动"
          json(res, 200, {
            ok: true,
            racingTemplate: next.racingTemplate, racingAssets: next.racingAssets || "unset",
            installed: !!install.installed, already: !!install.already, occupied: !!install.occupied,
          });
        });
        return;
      }
    }
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
      const srcCover = path.join(worldAssetDir(parts[2]), "cover.png");
      if (fs.existsSync(srcCover)) {
        try {
          const dir = worldAssetDir(dst);
          fs.mkdirSync(dir, { recursive: true });
          fs.copyFileSync(srcCover, path.join(dir, "cover.png"));
        } catch { /* 只读安装目录：没有封面不影响复制成功 */ }
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
    // 官方 db.sql 的落点：脚本发语句与参数，这里 prepare + bind 后执行。
    // 一次一条语句（node:sqlite 遇到多条自己会抛），返回 rows / changes / lastInsertRowid。
    if (parts[1] === "db" && safeId(parts[2]) && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 512 * 1024) req.destroy(); });
      req.on("end", async () => {
        let p = {};
        try { p = JSON.parse(body || "{}") || {}; } catch { return json(res, 400, { error: "请求体不是合法 JSON" }); }
        try {
          json(res, 200, await sql.run(parts[2], p.sql, p.params));
        } catch (e) { json(res, 400, { error: String((e && e.message) || e) }); }
      });
      return;
    }
    // 必须限定段数：这一支管的是 /api/world/:id 本身。少了 parts.length === 3，
    // 它会把 /api/world/:id/asset 的 POST 一起吞进来，然后拿二进制去 JSON.parse——
    // 于是下面那个资产接口从来没被命中过（返回的是 400 "not valid JSON"），
    // 导入与上传的网格全都只留在内存里，一存盘重开就没了。
    if (parts[1] === "world" && parts.length === 3 && safeId(parts[2])) {
      const id = parts[2];
      if (req.method === "GET") {
        const p = worldPath(id);
        const ae = String(req.headers["accept-encoding"] || "");
        if (url.searchParams.get("format") === "binary" && fs.existsSync(p)) {
          try {
            const bin = readWorldBinary(id);
            res.writeHead(200, {
              "Content-Type": "application/octet-stream",
              "Content-Encoding": "gzip",
              "Content-Length": bin.length,
              "X-World-Format": "binary-v1",
              "Cache-Control": "no-store"
            });
            return res.end(bin);
          } catch (err) {
            console.error("world binary cache failed", id, err);
          }
        }
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
        req.on("data", (c) => { len += c.length; if (len > 256 * 1024 * 1024) { req.destroy(); return; } chunks.push(c); });
        req.on("end", () => {
          try {
            let raw = Buffer.concat(chunks, len);
            if (/gzip/i.test(String(req.headers["content-encoding"] || ""))) raw = zlib.gunzipSync(raw);
            const payload = JSON.parse(raw.toString("utf8"));
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
        for (const d of [path.join(ASSETS, id), path.join(ASSETS_IN_TREE, id)])
          if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
        // db.sql 的库也要一起走：留着它，将来用同一个 id 重建图会继承上一张的表。
        sql.drop(id);
        worldMetaCache.delete(id);
        return json(res, 200, { ok: true });
      }
    }
    // 删一个世界资产（代码包面板的「删除」）。限定只能删该世界自己目录下的文件，
    // 且解析结果必须仍在该目录内——路径穿越在这里是致命的。
    if (parts[1] === "world" && safeId(parts[2]) && parts[3] === "asset" && req.method === "DELETE") {
      const id = parts[2];
      const rel = (url.searchParams.get("path") || "").replace(/^\/+/, "");
      if (!rel || rel.includes("..") || rel.length > 200) return json(res, 400, { error: "bad path" });
      let gone = false;
      for (const base of [ASSETS, ASSETS_IN_TREE]) {
        const dir = path.join(base, id), f = path.join(dir, rel);
        if (f.startsWith(dir + path.sep) && fs.existsSync(f)) { fs.unlinkSync(f); gone = true; }
      }
      return json(res, gone ? 200 : 404, { ok: gone, path: rel });
    }
    // 世界资产清单与写入：GET / POST /api/world/:id/asset?path=models/a.gltf
    if (parts[1] === "world" && safeId(parts[2]) && parts[3] === "asset" && req.method === "GET") {
      // 「代码包」面板要列文件。没有这个接口就只能显示 meta 里的名字，
      // 于是名字与真实落盘的文件是两回事——用户上传了却在看不到、也删不掉。
      const id = parts[2];
      const files = [];
      for (const base of [ASSETS, ASSETS_IN_TREE]) {
        for (const f of listAssetFiles(path.join(base, id))) {
          if (!files.some((x) => x.path === f.path)) files.push(f);
        }
      }
      return json(res, 200, { files });
    }
    if (parts[1] === "world" && safeId(parts[2]) && parts[3] === "asset" && req.method === "POST") {
      const id = parts[2];
      const rel = (url.searchParams.get("path") || "").replace(/^\/+/, "");
      if (!rel || /\.\./.test(rel) || rel.length > 200) return json(res, 400, { error: "bad path" });
      const chunks = [];
      let total = 0;
      req.on("data", (c) => { chunks.push(c); total += c.length; if (total > 80 * 1024 * 1024) req.destroy(); });
      req.on("end", () => {
        try {
          const dir = path.join(ASSETS, id, path.dirname(rel));
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(ASSETS, id, rel), Buffer.concat(chunks));
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
    if (parts[1] === "ai" && parts[2] === "models" && req.method === "POST") {
      // 和 /api/ai/chat 同一条边界：只对本机、密钥不落地、错误文本先擦再回显。
      if (!isLoopback(req.socket && req.socket.remoteAddress)) {
        return json(res, 403, { error: "AI 代理只对本机开放" });
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
      req.on("end", async () => {
        let cfg = null, key = "";
        try { cfg = JSON.parse(body); } catch (e) { return json(res, 400, { error: "bad json" }); }
        const base = normalizeAiBase(cfg.baseUrl);
        key = String(cfg.key || "").trim();
        if (!base) return json(res, 400, { error: "接口地址不合法（只支持 http/https，且不要把密钥写在地址里）" });
        if (!key) return json(res, 400, { error: "缺少密钥" });
        try {
          const up = new URL(base);
          if (up.host.toLowerCase() === String(req.headers.host || "").toLowerCase()) {
            return json(res, 400, { error: "接口地址不能指向本服务" });
          }
        } catch { return json(res, 400, { error: "接口地址不合法" }); }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
          const r = await fetch(base + "/models", { headers: { authorization: "Bearer " + key }, signal: ctrl.signal });
          const txt = await r.text();
          let data = null;
          try { data = JSON.parse(txt); } catch { data = null; }
          if (!r.ok) {
            // 很多兼容网关压根没实现 /models。这不是用户的配置错了，界面要能分清
            // "这个服务不提供列表"和"地址或密钥错了"，否则人人都会以为是自己填坏了。
            if (r.status === 404 || r.status === 405) {
              return json(res, 200, { ok: true, models: [], note: "这个服务没有 /models 端点（" + r.status + "），模型名手输即可" });
            }
            const detail = data && data.error && (data.error.message || data.error) || txt.slice(0, 300);
            return json(res, 502, { ok: false, status: r.status, error: scrub("上游 " + r.status + "：" + detail, key) });
          }
          const raw = (data && (data.data || data.models)) || [];
          const models = (Array.isArray(raw) ? raw : [])
            .map((m) => (typeof m === "string" ? m : m && (m.id || m.name)))
            .filter((s) => typeof s === "string" && s).slice(0, 2000);
          return json(res, 200, { ok: true, models });
        } catch (e) {
          const aborted = e && (e.name === "AbortError");
          return json(res, 502, { ok: false, error: scrub(aborted ? "上游超时（20 秒）" : "请求失败：" + (e.message || e), key) });
        } finally {
          clearTimeout(timer);
        }
      });
      return;
    }
    if (parts[1] === "ai" && parts[2] === "chat" && req.method === "POST") {
      // 这个端点会把请求转发到调用者指定的地址。绑到 0.0.0.0 起服务时，
      // 不挡掉外来来源就等于给全网开了一个免费代理，所以只认回环。
      if (!isLoopback(req.socket && req.socket.remoteAddress)) {
        return json(res, 403, { error: "AI 代理只对本机开放" });
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > AI_MAX_BODY) req.destroy(); });
      req.on("end", async () => {
        let cfg = null, key = "";
        try {
          cfg = JSON.parse(body);
        } catch (e) { return json(res, 400, { error: "bad json: " + String(e.message || e).slice(0, 120) }); }
        const base = normalizeAiBase(cfg.baseUrl);
        key = String(cfg.key || "").trim();
        const model = String(cfg.model || "").trim();
        const msgs = Array.isArray(cfg.messages) ? cfg.messages.slice(0, 40) : null;
        if (!base) return json(res, 400, { error: "接口地址不合法（只支持 http/https，且不要把密钥写在地址里）" });
        if (!model) return json(res, 400, { error: "缺少模型名" });
        if (!key) return json(res, 400, { error: "缺少密钥" });
        if (!msgs || !msgs.length) return json(res, 400, { error: "缺少 messages" });
        // 防止把自己打进死循环：上游指向**本服务的同一个 host:port** 时才拒。
        // 原来只比主机名，于是 127.0.0.1 上跑的 LM Studio / Ollama 全被误杀。
        try {
          const up = new URL(base);
          const upAuthority = up.host.toLowerCase();
          const selfAuthority = String(req.headers.host || "").toLowerCase();
          if (upAuthority === selfAuthority) return json(res, 400, { error: "接口地址不能指向本服务" });
        } catch { return json(res, 400, { error: "接口地址不合法" }); }
        const clean = msgs.filter((m) => m && typeof m.content === "string")
          .map((m) => ({ role: /^(system|user|assistant|tool)$/.test(String(m.role)) ? m.role : "user", content: String(m.content).slice(0, 200000) }));
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), AI_MAX_MS);
        try {
          const r = await fetch(base + "/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + key },
            body: JSON.stringify({
              model, messages: clean,
              temperature: Number.isFinite(+cfg.temperature) ? Math.max(0, Math.min(2, +cfg.temperature)) : 0.4,
              max_tokens: Math.max(1, Math.min(32000, +cfg.maxTokens || 2048)),
              ...(cfg.json ? { response_format: { type: "json_object" } } : {}),
            }),
            signal: ctrl.signal,
          });
          const txt = await r.text();
          let data = null;
          try { data = JSON.parse(txt); } catch { data = null; }
          if (!r.ok) {
            const detail = data && data.error && (data.error.message || data.error) || txt.slice(0, 300);
            return json(res, 502, { ok: false, status: r.status, error: scrub("上游 " + r.status + "：" + detail, key) });
          }
          const choice = data && data.choices && data.choices[0];
          const out = (choice && choice.message && choice.message.content)
            ?? (choice && choice.text) ?? "";
          return json(res, 200, { ok: true, text: String(out || ""), usage: data && data.usage, model: data && data.model });
        } catch (e) {
          const aborted = e && (e.name === "AbortError");
          return json(res, 502, { ok: false, error: scrub(aborted ? "上游超时（" + (AI_MAX_MS / 1000) + " 秒）" : "请求失败：" + (e.message || e), key) });
        } finally {
          clearTimeout(timer);
        }
      });
      return;
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
  if (pathname === "/manual" || pathname === "/manual/") {
    pathname = "/manual.html";
  }
  // 社区四个区共用一个壳：/community 广场、/p/<id> 详情、/u/<name> 主页、/friends 关系
  if (pathname === "/admin" || pathname === "/admin/") {
    pathname = "/admin.html";
  }
  if (pathname === "/me" || pathname === "/me/"
    || pathname === "/community" || pathname === "/community/"
    || pathname === "/friends" || pathname === "/friends/"
    || /^\/p\/[a-f0-9]{12,24}$/.test(pathname)
    || (pathname.startsWith("/u/") && pathname.length > 3 && !pathname.slice(3).includes("/"))) {
    pathname = "/community.html";
  }

  // ---- static ----
  // 官方素材包：未确认授权前一律 403，并说明为什么（404 会让人以为包坏了）
  const gated = gatedAsset(pathname);
  if (gated) {
    if (gated.blocked) return send(res, 400, "bad asset name");
    if (readConsent().racingAssets !== "granted") {
      return json(res, 403, {
        error: "official-assets-not-consented",
        need: "racingAssets",
        hint: "这些官方模型与音效随包分发，但只有在应用内确认授权后服务端才放行。打开工作台首页的确认框，或左侧「官方素材授权」。",
      });
    }
    if (!fs.existsSync(gated.file) || !fs.statSync(gated.file).isFile()) return send(res, 404, "not found");
    const e = path.extname(gated.file).toLowerCase();
    fs.readFile(gated.file, (err, buf) => {
      if (err) return send(res, 500, "read error");
      send(res, 200, buf, { "Content-Type": MIME[e] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
    });
    return;
  }
  // 世界资产可能被写到用户目录（安装目录只读时），但前端 URL 一直是 /assets/worlds/<id>/…，
  // 所以这个前缀要能在 DATA_ROOT/assets 与仓库内 public/assets 两处都解析。
  if (pathname.startsWith("/assets/worlds/")) {
    const rel = decodeURIComponent(pathname.slice("/assets/worlds/".length));
    if (!rel.includes("..")) {
      for (const base of [ASSETS, ASSETS_IN_TREE]) {
        const f = path.join(base, rel);
        if (!f.startsWith(base)) continue;
        if (fs.existsSync(f) && fs.statSync(f).isFile()) {
          const e = path.extname(f).toLowerCase();
          const h = { "Content-Type": MIME[e] || "application/octet-stream", "Cache-Control": "public, max-age=3600" };
          fs.readFile(f, (err, buf) => { if (err) return send(res, 500, "read error"); send(res, 200, buf, h); });
          return;
        }
      }
      return send(res, 404, "not found");
    }
  }
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

// 探测与真正 listen 之间端口仍可能被抢走（另一个进程刚好起在这个空档）。
// 没有这个 handler 的话 Node 会把 EADDRINUSE 当未处理错误抛出来，
// 用户看到的是一坨堆栈而不是一句"端口被占了，换个端口"。
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error(`✗ 端口 ${PORT} 已被占用。改用其他端口：node start.mjs --port=5200`);
    process.exit(1);
  }
  console.error("服务启动失败：" + (e && e.message ? e.message : e));
  process.exit(1);
});

server.on("upgrade", (req, socket, head) => realtime.handleUpgrade(req, socket, head));

server.listen(PORT, HOST, () => {
  console.log(`老攸元宇宙 本地服务已启动:`);
  console.log(`  编辑器:  http://127.0.0.1:${PORT}/edit/216d665d3ca92bd1b9a2`);
  console.log(`  世界列表: http://127.0.0.1:${PORT}/api/worlds`);
  console.log(`  静态目录: ${PUBLIC}`);
  // 从 .dmg / 只读位置运行时这里会指向用户目录，必须打印出来，否则用户找不到自己存的图
  console.log(`  数据目录: ${DATA_ROOT}`);
  if (DATA_ROOT !== path.join(__dirname, "server", "data")) {
    console.log(`  ⚠ 当前所在位置不可写（多因直接从磁盘镜像或只读卷运行），地图已改存到上面这个目录。`);
    console.log(`    想把地图保存在包内，请把整个文件夹复制到本地磁盘（如桌面）后再启动。`);
  }
});
