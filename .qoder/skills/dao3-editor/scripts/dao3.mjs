#!/usr/bin/env node
// dao3.mjs — 驱动本地 dao3 编辑器复刻的零依赖 CLI。
//
// 只打 HTTP，不 import 项目里的任何模块：那会把 THREE 和浏览器 API 一起拖进来。
// 输出刻意做成"一行一条、可 grep、不会被截断到看不懂"的形状，因为读它的是模型。
//
//   node dao3.mjs <命令> [参数] [--flag 值]
//
// 环境变量 DAO3_BASE 覆盖服务地址（默认 http://127.0.0.1:5180）。

const BASE = (process.env.DAO3_BASE || "http://127.0.0.1:5180").replace(/\/+$/, "");

/* ------------------------------ 参数解析 ------------------------------ */
const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
    // 同名 flag 出现多次要累积成数组，不能覆盖。
    // 这条是被实测抓出来的：`meta --set name=… --set gameRules=…` 原先只剩最后一条，
    // 命令回了一句 OK，但 name 根本没写进去——比报错更糟。
    if (k in flags) flags[k] = [].concat(flags[k], v);
    else flags[k] = v;
  } else pos.push(a);
}
const cmd = pos[0];
const arg = (i) => pos[i + 1];
const die = (msg) => { console.log("ERROR  " + msg); process.exit(1); };

async function req(method, path, body, isJson = true) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (isJson) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    else { opt.headers["Content-Type"] = "application/octet-stream"; opt.body = body; }
  }
  let r;
  try { r = await fetch(BASE + path, opt); } catch (e) {
    die(`服务没在 ${BASE} 上跑（${e.message}）。先启动：node start.mjs --no-open --port=5180 --host=127.0.0.1`);
  }
  const text = await r.text();
  if (!r.ok) die(`${method} ${path} → HTTP ${r.status}  ${text.slice(0, 240)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const get = (p) => req("GET", p);
const put = (p, b) => req("PUT", p, b);
const fmt = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + "MB" : n >= 1024 ? (n / 1024).toFixed(1) + "KB" : n + "B");

/** 体素线性下标：必须和 public/js/world.js 的 pack() 完全一致。 */
const pack = (shape, x, y, z) => x + y * shape[0] + z * shape[0] * shape[1];

/* ------------------------------ 世界读写 ------------------------------ */
// 服务端只认整份 payload，没有"补丁"接口。所以任何体素改动都是
// 读全量 → 在内存里改 → 写回全量。世界可能上百万格，改完必须走 saveWorld 一次落盘。
async function loadWorld(id) {
  const w = await get(`/api/world/${encodeURIComponent(id)}`);
  if (!Array.isArray(w.data)) die(`世界 ${id} 的 payload 里没有 data 数组`);
  w.shape = w.shape || [64, 64, 64];
  return w;
}
function saveWorld(id, w, note) {
  return put(`/api/world/${encodeURIComponent(id)}`, w).then((res) => {
    console.log(`OK    已存盘 ${id} · ${res.blockCount} 格 · ${fmt(res.bytes)}${note ? " · " + note : ""}`);
    return res;
  });
}
/** indices/data/rot 三张表按同一顺序重排，删掉的格子要真的消失。 */
function rebuildFromMap(w, map) {
  const idx = [], dat = [], rot = [];
  for (const [i, cell] of map) {
    if (!cell || !cell.id) continue;
    idx.push(i); dat.push(cell.id); rot.push(cell.rot || 0);
  }
  w.indices = idx; w.data = dat; w.rot = rot;
  return w;
}
function worldToMap(w) {
  const map = new Map();
  for (let k = 0; k < w.indices.length; k++) {
    if (!w.data[k]) continue;
    map.set(w.indices[k], { id: w.data[k], rot: w.rot[k] || 0 });
  }
  return map;
}

/* ------------------------------ 命令 ------------------------------ */
const COMMANDS = {
  health() {
    return Promise.all([get("/api/whoami"), get("/api/stats")]).then(([who, s]) => {
      console.log(`app=${who.app} version=${who.version} port=${s.port} node=${s.node}`);
      console.log(`worlds=${s.worlds} voxels=${s.voxels} entities=${s.entities} scripts=${s.scripts} blocks=${s.blocks} save=${fmt(s.saveBytes)}`);
      console.log(`root=${who.root}`);
    });
  },

  async worlds() {
    const { worlds } = await get("/api/worlds");
    console.log(`共 ${worlds.length} 张图（id · 名称 · 尺寸 · 体素 · 实体 · 脚本 · 大小）`);
    for (const w of worlds) {
      console.log(`${w.id}  ${w.name || "(未命名)"}  ${w.shape}  ${w.blockCount}格  实体${w.entities}  脚本${w.scripts}  ${fmt(w.size)}`);
    }
  },

  async info() {
    const id = arg(0) || die("用法: dao3.mjs info <worldId>");
    const w = await loadWorld(id);
    const m = w.meta || {};
    const cats = {};
    for (const k of Object.keys(m)) {
      const v = m[k];
      if (Array.isArray(v)) cats[k] = v.length;
      else if (v && typeof v === "object") cats[k] = Object.keys(v).length + "键";
    }
    console.log(`id=${id}  name=${m.name}  shape=${w.shape}  format=${w.formatVersion}  体素=${w.data.length}`);
    console.log(`meta 里的数组/对象：${Object.entries(cats).map(([k, v]) => k + "=" + v).join("  ")}`);
    if (Array.isArray(m.scripts) && m.scripts.length) {
      console.log("脚本：");
      for (const s of m.scripts) console.log(`  ${s.name}  服务端${(s.server || "").length}字符  客户端${(s.client || "").length}字符`);
    }
  },

  /** 查方块表：写体素前必须知道 id。支持 --grep 按名字/中文找。 */
  async blocks() {
    const j = await get("/data/block-atlas.json");
    const q = String(flags.grep || "").toLowerCase();
    // 不显示 block.color：那是材质 tint（383 个方块里只有 9 种取值，几乎恒为白），
    // 方块的可见颜色在贴图 tile 里。拿 tint 当"颜色"会让人挑错方块。
    let rows = j.blocks.map((b) => ({
      id: b.id, name: b.name, zh: b.zh, cat: b.category, type: b.type,
      glow: (b.emissive || []).some((v) => v > 0.05), fluid: !!b.fluid, trans: !!b.transparent,
    }));
    if (q) rows = rows.filter((r) => `${r.name} ${r.zh} ${r.cat} ${r.type}`.toLowerCase().includes(q));
    const limit = Number(flags.limit) || 40;
    console.log(`匹配 ${rows.length} 个方块，显示前 ${Math.min(limit, rows.length)}（id · name · 中文 · 分类 · 类型 · 标记）`);
    for (const r of rows.slice(0, limit)) {
      const tag = [r.glow && "发光", r.fluid && "流体", r.trans && "透明"].filter(Boolean).join(",") || "-";
      console.log(`${String(r.id).padStart(4)}  ${r.name}  ${r.zh || ""}  ${r.cat}  ${r.type}  ${tag}`);
    }
    if (rows.length > limit) console.log(`…还有 ${rows.length - limit} 个，用 --grep 收窄或 --limit 放大`);
  },

  /** 新建一张空白世界（带一层地面，免得玩家一出生就掉出世界）。 */
  async scaffold() {
    const id = arg(0) || die("用法: dao3.mjs scaffold <worldId> --shape 64,64,64 [--floor 1] [--name 名字]");
    const shape = String(flags.shape || "64,64,64").split(",").map(Number);
    if (shape.length !== 3 || shape.some((n) => !(n > 0 && n <= 512))) die("--shape 要三个 1..512 的数字，如 64,64,64");
    const floor = Number(flags.floor ?? 1);
    const map = new Map();
    if (floor >= 0) for (let x = 0; x < shape[0]; x++) for (let z = 0; z < shape[2]; z++) map.set(pack(shape, x, floor, z), { id: 1, rot: 0 });
    const w = { formatVersion: "unity", shape, dir: [1, 1, 1], indices: [], data: [], rot: [], meta: { name: flags.name || id, created: Date.now() } };
    rebuildFromMap(w, map);
    console.log(`OK    已建 ${id}  ${shape.join("×")}  地面 ${map.size} 格（floor y=${floor}）`);
    await saveWorld(id, w);
  },

  /**
   * 查官方 API 全量规范（100 类 / 1044 成员，带签名与官方中文说明）。
   * 不整篇倒进上下文——那份文档 1.7 万词——按需查：
   *   api --list                 类清单
   *   api --class World          某个类的全部成员
   *   api say                    全文检索
   */
  async api() {
    const s = await get("/data/api-spec.json");
    const cls = s.classes || {};
    const names = Object.keys(cls);
    if (flags.list) {
      console.log(`共 ${names.length} 个类（${s.members ?? "?"} 个成员）。--class <名字> 看成员。\n`);
      for (const n of names) console.log(`${(cls[n].side || "?").padEnd(7)} ${String(cls[n].kind || "").padEnd(10)} ${n}  ${(cls[n].d || "").slice(0, 60)}`);
      return;
    }
    if (flags.class) {
      const want = String(flags.class).toLowerCase();
      // 只做精确匹配。原先匹配不上会退到 includes() 取第一个，
      // 结果 `--class Player` 静默打开了 GamePlayerKeyframe——
      // 拿错类的成员表去写脚本，比直接报错难查得多。
      const hit = names.find((n) => n.toLowerCase() === want) || names.find((n) => n.toLowerCase() === "game" + want);
      if (!hit) {
        const near = names.filter((n) => n.toLowerCase().includes(want.replace(/^game/, "")));
        console.log(`没有叫「${flags.class}」的类。`);
        console.log(near.length ? `候选（用完整类名再查）：${near.slice(0, 12).join(", ")}` : "没有相近的类名。--list 看全部。");
        return;
      }
      const c = cls[hit];
      console.log(`${hit}  [${c.side}]  ${c.kind}  ${c.d || ""}`);
      for (const [mn, m] of Object.entries(c.m || {})) console.log(`  ${mn}  ${m.s || ""}\n      ${(m.d || "").replace(/\n+/g, " ")}`);
      return;
    }
    const q = String(pos[1] || "").toLowerCase();
    if (!q) die("用法: dao3.mjs api <关键词> | --list | --class World");
    const hits = [];
    for (const [cn, c] of Object.entries(cls)) {
      const score = (hay, label, extra) => {
        const h = String(hay).toLowerCase();
        if (!h.includes(q)) return;
        hits.push({ label, sig: extra || "", d: (c.d || "").slice(0, 90), side: c.side, rank: h === q ? 9 : label.toLowerCase().endsWith(q) ? 6 : label.toLowerCase().includes(q) ? 4 : 1 });
      };
      score(cn, cn, c.kind);
      for (const [mn, m] of Object.entries(c.m || {})) score(`${mn} ${m.d || ""}`, `${cn}.${mn}`, m.s);
    }
    hits.sort((a, b) => b.rank - a.rank);
    console.log(`「${pos[1]}」命中 ${hits.length} 条，显示前 20：`);
    for (const h of hits.slice(0, 20)) console.log(`  [${h.side}] ${h.label}  ${h.sig}\n      ${h.d}`);
    if (hits.length > 20) console.log(`…还有 ${hits.length - 20} 条；--class <类名> 看整类，--list 看全部类。`);
    if (!hits.length) console.log(`规范里没找到「${pos[1]}」。这通常意味着**官方没有这个接口**——不要凭印象编一个出来。`);
  },

  /** 往世界写一个长方体区域；--id 0 表示挖空。 */
  async fill() {
    const id = arg(0) || die("用法: dao3.mjs fill <worldId> --box x0,y0,z0,x1,y1,z1 --id <blockId> [--rot 0-3]");
    const b = String(flags.box || "").split(",").map(Number);
    if (b.length !== 6 || b.some((n) => !Number.isFinite(n))) die("--box 要六个数字 x0,y0,z0,x1,y1,z1");
    const blockId = Number(flags.id);
    if (!Number.isInteger(blockId)) die("--id 是方块 id（整数）。先跑 dao3.mjs blocks --grep 草 查 id");
    const rot = Number(flags.rot || 0);
    const w = await loadWorld(id);
    const map = worldToMap(w);
    const [x0, y0, z0, x1, y1, z1] = b;
    let n = 0;
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
          if (x < 0 || y < 0 || z < 0 || x >= w.shape[0] || y >= w.shape[1] || z >= w.shape[2]) continue;
          const i = pack(w.shape, x, y, z);
          if (blockId === 0) map.delete(i); else map.set(i, { id: blockId, rot });
          n++;
        }
    rebuildFromMap(w, map);
    console.log(`OK    ${id} 区域 ${n} 格 → 方块 ${blockId}${blockId === 0 ? "（挖空）" : ""}，现在共 ${map.size} 格`);
    await saveWorld(id, w);
  },

  /** 读某根柱子的体素，用来确认改动真的落下去了。 */
  async probe() {
    const id = arg(0) || die("用法: dao3.mjs probe <worldId> --at x,z [--from 0] [--to 63]");
    const at = String(flags.at || "").split(",").map(Number);
    if (at.length !== 2) die("--at 要两个数字 x,z");
    const w = await loadWorld(id);
    const map = worldToMap(w);
    const from = Number(flags.from || 0), to = Number(flags.to ?? w.shape[1] - 1);
    const hits = [];
    for (let y = from; y <= to; y++) { const c = map.get(pack(w.shape, at[0], y, at[1])); if (c) hits.push(`y${y}=#${c.id}${c.rot ? "r" + c.rot : ""}`); }
    console.log(`${id} 柱(${at.join(",")}) y=${from}..${to} → ${hits.length ? hits.join("  ") : "全空"}`);
  },

  /** 改 meta：--set 路径=JSON值，可多次用逗号分隔。数组/对象都支持。 */
  async meta() {
    const id = arg(0) || die("用法: dao3.mjs meta <worldId> --set 'name=测试图' --set 'gameRules={\"tpm\":15.625}'");
    if (!flags.set) die("给一条 --set 路径=值");
    const w = await loadWorld(id);
    w.meta = w.meta || {};
    const sets = Array.isArray(flags.set) ? flags.set : [flags.set];
    for (const s of sets) {
      const eq = s.indexOf("=");
      if (eq < 1) die(`--set 要写成 路径=值，收到「${s}」`);
      const path = s.slice(0, eq), raw = s.slice(eq + 1);
      let val; try { val = JSON.parse(raw); } catch { val = raw; }   // 裸字符串照收
      const parts = path.split(".");
      let node = w.meta;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (typeof node[k] !== "object" || node[k] === null) node[k] = {};
        node = node[k];
      }
      node[parts[parts.length - 1]] = val;
      console.log(`      meta.${path} ← ${JSON.stringify(val).slice(0, 120)}`);
    }
    await saveWorld(id, w, "只改 meta，体素未动");
  },

  /** 写两端脚本：--file 指向本地 js，--end server|client|both */
  async script() {
    const id = arg(0) || die("用法: dao3.mjs script <worldId> --name index.js --file ./s.js [--client ./c.js] [--end both]");
    const name = flags.name || die("要 --name，例如 index.js");
    const w = await loadWorld(id);
    w.meta = w.meta || {};
    if (!Array.isArray(w.meta.scripts)) w.meta.scripts = [];
    let s = w.meta.scripts.find((x) => x.name === name);
    if (!s) { s = { name, server: "", client: "" }; w.meta.scripts.push(s); }
    const fs = await import("node:fs");
    if (flags.file) { s.server = fs.readFileSync(String(flags.file), "utf8"); console.log(`      服务端 ${s.server.length} 字符`); }
    if (flags.client) { s.client = fs.readFileSync(String(flags.client), "utf8"); console.log(`      客户端 ${s.client.length} 字符`); }
    console.log(`OK    脚本 ${name} 已写入（现在共 ${w.meta.scripts.length} 个）`);
    await saveWorld(id, w);
  },

  async assets() {
    const id = arg(0) || die("用法: dao3.mjs assets <worldId>");
    const r = await get(`/api/world/${encodeURIComponent(id)}/asset`);
    const list = r.assets || r.files || r;
    console.log(Array.isArray(list) ? `共 ${list.length} 个资产：` + list.map((f) => `${f.path || f}(${f.bytes ?? f.size ?? 0}B)`).join("  ") : JSON.stringify(list).slice(0, 400));
  },

  async "asset-put"() {
    const id = arg(0), p = arg(1), f = arg(2);
    if (!id || !p || !f) die("用法: dao3.mjs asset-put <worldId> <相对路径> <本地文件>");
    const fs = await import("node:fs");
    const buf = fs.readFileSync(f);
    const r = await req("POST", `/api/world/${encodeURIComponent(id)}/asset?path=${encodeURIComponent(p)}`, buf, false);
    console.log(`OK    ${r.path} 落盘 ${fmt(r.bytes)}`);
  },

  async models() {
    const { models } = await get("/api/models");
    console.log(`VOXA 模型 ${models.length} 个：`);
    for (const m of models) console.log(`  ${m.name}  部件${m.parts}  骨骼${m.bones}  动画${m.anims}  体素${m.voxels}`);
  },

  async delete() {
    const id = arg(0) || die("用法: dao3.mjs delete <worldId> --yes");
    if (flags.yes !== true) die("删图不可撤销。确认是这张图就加 --yes");
    const { worlds } = await get("/api/worlds");
    const w = worlds.find((x) => x.id === id);
    if (!w) die(`没有这张图：${id}`);
    await req("DELETE", `/api/world/${encodeURIComponent(id)}`);
    console.log(`OK    已删 ${id}（${w.name}，${w.blockCount} 格）`);
  },

  /** 把整份世界 payload 导成 JSON 文件，方便离线改或做对比。 */
  async dump() {
    const id = arg(0) || die("用法: dao3.mjs dump <worldId> [--out 文件]");
    const w = await loadWorld(id);
    const fs = await import("node:fs");
    const out = String(flags.out || `${id}.json`);
    fs.writeFileSync(out, JSON.stringify(w));
    console.log(`OK    ${out}  ${fmt(fs.statSync(out).size)}  shape=${w.shape} 体素=${w.data.length}`);
  },
};

const help = () => {
  console.log(`dao3 编辑器本地 API 驱动 · 服务 ${BASE}

  health                          服务与统计
  worlds                          列出全部地图
  info    <id>                    一张图的结构概览
  blocks  [--grep 草] [--limit n]  查方块 id（写体素前必查）
  scaffold <id> --shape 64,64,64 [--floor 1] [--name 名字]
  fill    <id> --box x0,y0,z0,x1,y1,z1 --id <blockId> [--rot 0-3]
  probe   <id> --at x,z [--from 0] [--to 63]     读一根柱子确认改动
  meta    <id> --set 'name=测试' --set 'gameRules={...}'
  script  <id> --name index.js --file s.js [--client c.js]
  assets  <id> | asset-put <id> <相对路径> <本地文件>
  models                          VOXA 模型库
  dump    <id> [--out 文件]
  delete  <id> --yes

没有"补丁"接口：任何体素改动都是读全量→改→写回全量。`);
};

if (!cmd || cmd === "help") help();
else if (!COMMANDS[cmd]) die(`没有命令「${cmd}」。跑 dao3.mjs help`);
else await COMMANDS[cmd]();
