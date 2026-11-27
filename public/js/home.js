// home.js — 工作台：本地世界总览（指标 / 起点 / 可排序筛选的项目表 / 导入导出 / 发布）
import { mountAuth } from "/js/auth.js";
const $ = (id) => document.getElementById(id);
const TEMPLATE_ID = "216d665d3ca92bd1b9a2";

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? (b / 1024).toFixed(0) + " KB" : (b || 0) + " B");
const timeAgo = (t) => {
  if (!t) return "—";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + " 秒前";
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
  return new Date(t).toLocaleDateString();
};
const newId = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tip = (msg, ms = 3000) => {
  const t = $("importTip"); t.hidden = false; t.textContent = msg;
  clearTimeout(tip._h); if (ms) tip._h = setTimeout(() => (t.hidden = true), ms);
};

let WORLD = [];
let view = localStorage.getItem("dao3_wb_view") || "table";
let filter = "all";
let sortKey = "mtime";
let query = "";

/* ---------------- 指标 ---------------- */
async function loadStats() {
  let s;
  try { s = await (await fetch("/api/stats")).json(); }
  catch { return $("metrics").innerHTML = '<div class="mt"><b>—</b><em>服务未启动</em></div>'; }
  // 指标条只放"我自己的东西"。方块种类 383、API 成员 809 这类是产品说明书上的数字，
  // 摆在每天打开的工作台顶上，既不是我的进度也不是我的资产，只会把这块地方
  // 变成一块自夸的记分牌。
  const tiles = [
    { v: s.worlds, k: "本地世界", note: s.newest ? timeAgo(s.newest) : "空" },
    { v: fmt(s.voxels), k: "体素总量", note: s.worlds + " 张图" },
    { v: fmt(s.entities), k: "实体", note: (s.zones || 0) + " 区域" },
    { v: fmt(s.scripts), k: "脚本文件", note: (s.ui || 0) + " 界面" },
    { v: s.voxaModels, k: "VOXA 模型", note: fmt(s.voxaVoxels) + " 体素" },
    { v: kb(s.saveBytes), k: "存档体积", note: "gzip" },
  ];
  // 社区那一格单独取：社区服务没起来时，工作台其余指标不该跟着变灰
  try {
    const c = await (await fetch("/api/community/stats")).json();
    if (c && typeof c.users === "number") tiles.push({ v: c.pubs, k: "社区发布", note: c.users + " 个账号 · " + c.plays + " 次游玩" });
  } catch { /* 没有社区就不显示这一格 */ }
  $("metrics").innerHTML = tiles.map((t) => `<div class="mt"><b>${esc(t.v)}</b><div class="mtr"><em>${esc(t.k)}</em><i>${esc(t.note)}</i></div></div>`).join("");
}

/* ---------------- 起点 ---------------- */
// 官方模板那一格的名字与数字由 applyTemplateCard() 从 /api/consent 现读填进来：
// 写死"199 个实体"这类话，模板一改就和实际内容对不上，而卡上的说明越像真话，错了越误导人。
let TPL_ON = false; // 有没有真的装进本机：没装就不能摆一个点了只会失败的「复制」
const STARTS = [
  { key: "template", hot: true, badge: "官方兼容", ico: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3.5 20.5 8 12 12.5 3.5 8z\"/><path d=\"M3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5\"/></svg>", name: "官方模板", meta: "随包官方地图",
    action: () => (TPL_ON ? forkTemplate() : $("wbTpl").click()) },
  { key: "flat", ico: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 5 21 10.5 12 16 3 10.5z\"/></svg>", name: "超平坦", meta: "100 \u00d7 32 \u00d7 100", action: () => goNew("超平坦世界", "flat") },
  { key: "demo", ico: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 18.5l5.5-8 4 5.5 2.5-3 6 5.5z\"/><circle cx=\"8\" cy=\"6.5\" r=\"1.7\"/></svg>", name: "起伏地形", meta: "48 \u00d7 32 \u00d7 48 \u00b7 含示例小屋", action: () => goNew("起伏地形岛", "demo") },
  { key: "empty", ico: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2.5\"/></svg>", name: "空白世界", meta: "尺寸自定", action: () => goNew("空白世界", "empty") },
  { key: "import", ico: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4v10M8 10.5l4 4 4-4M4.5 19.5h15\"/></svg>", name: "导入地图", meta: ".zip \u00b7 .boxproject \u00b7 .gz \u00b7 .vox", action: () => $("htFile").click() },
];

/** 把随包官方模板的真实情况写进那张卡：名字、尺寸、方块数全部来自 /api/consent。 */
function applyTemplateCard(s) {
  const t = STARTS[0], c = s && s.template;
  if (c && c.name) t.name = c.name;
  TPL_ON = !!(c && s.installed && s.available);
  t.meta = !c ? "本包里没有官方模板" : !TPL_ON ? "未装入本机"
    : `${c.shape.join("\u00d7")} \u00b7 ${fmt(c.blocks)} 方块 \u00b7 ${c.entities} 实体`;
}

function renderStarts() {
  const grid = $("startGrid");
  grid.innerHTML = "";
  for (const s of STARTS) {
    const b = document.createElement("button");
    b.className = "wb-start" + (s.hot ? " hot" : "");
    // 徽标跟着标题走，不钉在卡片角落：钉在右下角时它和标题隔了一整行，
    // 看上去像这张卡的注脚，而不是这张图的身份。
    b.innerHTML = `<div class="ico">${s.ico}</div><div><h3>${esc(s.name)}`
      + (s.badge ? ` <span class="wb-badge">${esc(s.badge)}</span>` : "")
      + `</h3><small class="m">${esc(s.meta)}</small></div><span class="go">\u2192</span>`;
    b.onclick = () => (s.action ? s.action() : null);
    grid.appendChild(b);
  }
}

function goNew(name, mode) {
  const q = new URLSearchParams({ new: "1", name, mode, X: 100, Y: 32, Z: 100, T: 5 });
  location.href = "/edit/" + newId() + "?" + q.toString();
}

// 复制模板：服务端 fork（避免在浏览器里搬 1.5M 体素），原模板保持不动
async function forkTemplate() {
  const nm = STARTS[0].name;
  tip("正在复制「" + nm + "」…", 0);
  try {
    const id = newId();
    const r = await fetch("/api/world/" + TEMPLATE_ID + "/fork?to=" + id + "&name=" + encodeURIComponent(nm + " · 副本"), { method: "POST" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "复制失败");
    tip("已复制，正在打开编辑器…", 0);
    setTimeout(() => (location.href = "/edit/" + id), 260);
  } catch (e) {
    tip("复制失败：" + (e && e.message || e), 4200);
  }
}

/* ---------------- 项目列表 ---------------- */
const coverSrc = (w) => "/assets/worlds/" + encodeURIComponent(w.id) + "/cover.png";
const thumb = (w, big) => {
  const g = esc(String(w.name || w.id).slice(0, big ? 1 : 1).toUpperCase());
  if (!w.cover) return `<div class="wb-thumb">${big ? "" : g}</div>`;
  return `<div class="wb-thumb"><img src="${coverSrc(w)}" alt="" loading="lazy" onerror="this.remove()"/></div>`;
};
const match = (w) => {
  if (filter === "entity" && !(w.entities > 0)) return false;
  if (filter === "script" && !(w.scripts > 0)) return false;
  if (filter === "zone" && !(w.zones > 0)) return false;
  if (filter === "big" && !(w.blockCount > 1e5)) return false;
  if (query) {
    const hay = (w.name + " " + w.id + " " + (w.shape || "")).toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
};
const sorters = {
  mtime: (a, b) => (b.mtime || 0) - (a.mtime || 0),
  created: (a, b) => (b.created || b.mtime || 0) - (a.created || a.mtime || 0),
  name: (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), "zh"),
  blockCount: (a, b) => (b.blockCount || 0) - (a.blockCount || 0),
  size: (a, b) => (b.size || 0) - (a.size || 0),
  entities: (a, b) => (b.entities || 0) - (a.entities || 0),
};

const COLS = [
  { t: "项目", w: "30%" }, { t: "尺寸", w: "9%", c: "num opt" }, { t: "体素", w: "8%", c: "num" },
  { t: "实体", w: "7%", c: "num" }, { t: "脚本", w: "6%", c: "num opt" }, { t: "区域", w: "6%", c: "num opt" },
  { t: "存档", w: "8%", c: "num opt" }, { t: "修改", w: "9%", c: "opt" }, { t: "操作", w: "17%", c: "", r: 1 },
];

function row(w) {
  const name = w.name || w.id;
  const n = (v, unit) => (v ? `<span title="${v}">${fmt(v)}${unit || ""}</span>` : '<span class="zero">0</span>');
  return `<tr data-id="${esc(w.id)}">
    <td><div class="wb-name">${thumb(w)}<div class="wb-nm">
      <b class="lnk" data-act="edit" title="打开编辑器">${esc(name)}</b>
      <span>${esc(w.id)}${w.created ? " · 建于 " + timeAgo(w.created) : ""}</span>
    </div></div></td>
    <td class="num opt dim">${esc(w.shape || "—")}</td>
    <td class="num">${n(w.blockCount)}</td>
    <td class="num">${n(w.entities)}</td>
    <td class="num opt">${n(w.scripts)}</td>
    <td class="num opt">${n(w.zones)}</td>
    <td class="num opt dim">${kb(w.size)}</td>
    <td class="opt dim">${timeAgo(w.mtime)}</td>
    <td><div class="wb-acts">
      <button class="p" data-act="edit">编辑</button>
      <button data-act="run">运行</button>
      <button class="ib" data-act="pub" title="发布到社区">◎</button>
      <button class="ib" data-act="dup" title="复制为新世界">⧉</button>
      <button class="ib" data-act="ren" title="重命名">✎</button>
      <button class="ib" data-act="exp" title="导出官方 .zip 项目包">↓</button>
      <button class="ib del" data-act="del" title="删除">✕</button>
    </div></td>
  </tr>`;
}

function card(w) {
  const name = w.name || w.id;
  return `<div class="wb-card" data-id="${esc(w.id)}">
    <div class="shot">${w.cover ? `<img src="${coverSrc(w)}" alt="" loading="lazy" onerror="this.remove()"/>` : ""}
      <span class="glyph">${esc(String(name).slice(0, 1).toUpperCase())}</span>
      <button class="open" data-act="edit">编辑</button></div>
    <div class="cbody"><b>${esc(name)}</b>
      <div class="cmeta"><span>${esc(w.shape || "—")}</span><span>${fmt(w.blockCount)} 体素</span><span>${w.entities || 0} 实体</span></div>
      <div class="cfoot">
        <button class="p wb-btn" style="height:24px" data-act="run">运行</button>
        <button class="wb-btn" style="height:24px" data-act="pub">发布</button>
        <button class="wb-btn" style="height:24px" data-act="dup">复制</button>
        <button class="wb-btn" style="height:24px" data-act="exp">导出</button>
        <button class="wb-btn" style="height:24px" data-act="del">删除</button>
      </div>
    </div></div>`;
}

function renderWorlds() {
  const host = $("worldGrid");
  const list = WORLD.filter(match).sort(sorters[sortKey] || sorters.mtime);
  if (!WORLD.length) {
    host.className = "wb-table";
    host.innerHTML = '<div class="wb-empty"><b>还没有本地世界</b>从上面的起点开始，或导入一份官方 .zip 项目包</div>';
    return;
  }
  if (!list.length) {
    host.className = "wb-table";
    host.innerHTML = `<div class="wb-empty"><b>没有匹配的项目</b>${esc(query ? `关键词「${query}」` : "当前筛选条件")}下没有世界 · <button class="lnk" id="clearF">清除筛选</button></div>`;
    const c = $("clearF"); if (c) c.onclick = () => { query = ""; $("q").value = ""; filter = "all"; syncFilters(); renderWorlds(); };
    return;
  }
  if (view === "grid") {
    host.className = "wb-cards";
    host.innerHTML = list.map(card).join("");
  } else {
    host.className = "";
    host.innerHTML = `<table class="wb-t"><colgroup>${COLS.map((c) => `<col${c.w ? ` style="width:${c.w}"` : ""}/>`).join("")}</colgroup>
      <thead><tr>${COLS.map((c) => `<th class="${c.c || ""}"${c.r ? ' style="text-align:right"' : ""}>${esc(c.t)}</th>`).join("")}</tr></thead>
      <tbody>${list.map(row).join("")}</tbody></table>`;
  }
}

function syncFilters() {
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
  document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
}

async function loadWorlds() {
  try { WORLD = (await (await fetch("/api/worlds")).json()).worlds || []; }
  catch { $("worldGrid").innerHTML = '<div class="wb-empty"><b>无法连接本地服务</b>请先运行 <code>./run.sh</code>，再刷新本页</div>'; return; }
  renderWorlds();
}

/* ---------------- 行操作 ---------------- */
async function act(action, id) {
  const w = WORLD.find((x) => x.id === id) || {};
  if (action === "edit") return (location.href = "/edit/" + id);
  if (action === "run") return (location.href = "/edit/" + id + "?play=1");
  if (action === "exp") return (location.href = "/edit/" + id + "?export=1");
  if (action === "pub") {
    // 发布要登录、要填标题简介；这些都在 pubs.js 里，工作台不重复实现一份
    const { openPublishDialog } = await import("/js/pubs.js");
    return openPublishDialog({ id, name: w.name || id, shape: w.shapeArr });
  }
  if (action === "ren") {
    const name = prompt("新的项目名称", w.name || id);
    if (name == null || !name.trim()) return;
    const r = await fetch("/api/world/" + id + "/meta", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), displayName: name.trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return tip("改名失败：" + (j.error || r.status), 3600);
    tip("已重命名为「" + name.trim() + "」");
    return refresh();
  }
  if (action === "dup") {
    tip("正在复制…", 0);
    const nid = newId();
    const r = await fetch("/api/world/" + id + "/fork?to=" + nid + "&name=" + encodeURIComponent((w.name || id) + " · 副本"), { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return tip("复制失败：" + (j.error || r.status), 3600);
    tip("已复制，正在打开…", 0);
    return setTimeout(() => (location.href = "/edit/" + nid), 260);
  }
  if (action === "del") {
    if (!confirm(`确定删除世界「${w.name || id}」？其体素、实体与截图都会一并删除，不可恢复。`)) return;
    await fetch("/api/world/" + id, { method: "DELETE" });
    tip("已删除");
    return refresh();
  }
}

async function refresh() { await Promise.all([loadWorlds(), loadStats()]); }
mountAuth();

/* ---------------- 导入 ---------------- */
function importFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  tip("正在解析 " + file.name + " …", 0);
  (async () => {
    const io = await import("/js/io.js");
    // atlas.js 只导出 BlockAtlas 这个类，没有名为 atlas 的单例——
    // 之前直接取 .atlas 拿到 undefined，于是 .vox 导入必然报
    // "Cannot read properties of undefined (reading 'list')"。
    const { BlockAtlas } = await import("/js/atlas.js");
    const atlas = new BlockAtlas();
    await atlas.load("/data");
    let res;
    if (ext === "zip") res = await io.completeMissingFromBlock(await io.importProjectZip(file));
    else if (ext === "boxproject") res = await io.importBoxProject(file);
    else if (ext === "vox") res = { world: await io.importVox(file, atlas), name: file.name.replace(/\.vox$/i, ""), scripts: [], entities: [], meshNames: [], meshes: {}, warnings: [] };
    else res = { world: await io.importGz(file, atlas), name: file.name.replace(/\.(gz|json)$/i, ""), scripts: [], entities: [], meshNames: [], meshes: {}, warnings: [] };
    if (!res || !res.world) throw new Error("未能解析文件");
    tip(`解析完成（${res.world.shape.join("×")}，约 ${fmt(res.world.size())} 方块），正在保存…`, 0);
    const id = newId();
    const meta = { name: res.name || file.name, terrain: {}, created: Date.now() };
    if (res.scripts && res.scripts.length) meta.scripts = res.scripts;
    if (res.entities && res.entities.length) meta.entities = res.entities;
    if (res.groups && res.groups.length) meta.groups = res.groups;
    if (res.meshNames && res.meshNames.length) meta.meshNames = res.meshNames;
    if (res.pictureNames && res.pictureNames.length) meta.pictureNames = res.pictureNames;
    if (res.projectCfg && res.projectCfg.player) meta.player = Object.assign({}, res.projectCfg.player, { _units: "official" });
    if (res.projectCfg && res.projectCfg.physics) meta.worldSettings = Object.assign({}, res.projectCfg.physics, { airFriction: res.projectCfg.physics.velocityDamping ?? 0.01 });
    if (ext === "zip" || ext === "boxproject") {
      const roots = await saveZipAssets(id, res);
      if (roots.assetRoot) meta.assetRoot = roots.assetRoot;
      if (roots.pictureRoot) meta.pictureRoot = roots.pictureRoot;
      if (roots.audioRoot) meta.audioRoot = roots.audioRoot;
    }
    if (res.projectCfg && res.projectCfg.uiWidgets) meta.ui = res.projectCfg.uiWidgets;
    if (res.projectCfg && res.projectCfg.uiTree) meta.uiTree = res.projectCfg.uiTree;
    if (res.projectCfg && res.projectCfg.zones) meta.zones = res.projectCfg.zones;
    if (res.projectCfg && res.projectCfg.ambientSound) meta.ambientSound = res.projectCfg.ambientSound;
    if (res.projectCfg && res.projectCfg.displayName) { meta.displayName = res.projectCfg.displayName; meta.name = res.projectCfg.displayName; }
    if (res.mapId) meta.mapId = res.mapId;
    if (res.branchKey) meta.branchKey = res.branchKey;
    if (res.officialVersionControl) meta.officialVersionControl = res.officialVersionControl;
    const payload = res.world.toPayload(meta);
    const j = await io.apiSaveWorld(id, payload);
    if (!j.ok) throw new Error(j.error || "保存失败");
    tip("已保存，正在打开编辑器…", 0);
    setTimeout(() => (location.href = "/edit/" + id), 400);
  })().catch((e) => tip("导入失败：" + (e && e.message || e), 4200));
}

// 导入器已经把需要的模型与 UI 图片取出来；这里只负责落到这张图的资产目录。
async function saveZipAssets(id, res) {
  const files = [
    ...(res.meshFiles || []).map((f) => ({ rel: "models/" + f.name + f.ext, bytes: f.bytes })),
    ...(res.voxMeshes || []).filter((v) => v.bytes).map((v) => ({ rel: "models/" + v.name + ".vox", bytes: v.bytes })),
    ...(res.vbMeshes || []).filter((v) => v.bytes).map((v) => ({ rel: "models/" + v.name + ".vb", bytes: v.bytes })),
    ...(res.pictureFiles || []).map((f) => ({ rel: f.rel, bytes: f.bytes })),
    ...(res.audioFiles || []).map((f) => ({ rel: f.rel, bytes: f.bytes })),
  ];
  let mesh = 0, pics = 0, auds = 0;
  for (const f of files) {
    try {
      const r = await fetch("/api/world/" + id + "/asset?path=" + encodeURIComponent(f.rel), { method: "POST", body: f.bytes });
      if (r.ok) { if (f.rel.startsWith("models/")) mesh++; else if (f.rel.startsWith("audio/")) auds++; else pics++; }
    } catch { }
  }
  for (const f of res.meshAssetEntries || []) {
    try {
      const bytes = await res.extractEntry(f.entry);
      const r = await fetch("/api/world/" + id + "/asset?path=" + encodeURIComponent("models/" + f.name + f.ext), { method: "POST", body: bytes });
      if (r.ok) mesh++;
    } catch { }
  }
  return { assetRoot: mesh ? `/assets/worlds/${id}/models/` : "", pictureRoot: pics ? `/assets/worlds/${id}/` : "", audioRoot: auds ? `/assets/worlds/${id}/` : "" };
}

/* ---------------- 新建弹窗 ---------------- */
function openNew() { $("newModal").classList.add("show"); $("newName").select(); }
function closeNew() { $("newModal").classList.remove("show"); }
function submitNew() {
  const name = ($("newName").value || "我的新世界").trim();
  const mode = $("newMode").value;
  if (mode === "template") return forkTemplate();
  const clamp = (v, a, b, d) => Math.max(a, Math.min(b, Number(v) || d));
  const X = clamp($("newX").value, 8, 256, 100), Y = clamp($("newY").value, 8, 128, 32),
    Z = clamp($("newZ").value, 8, 256, 100), T = clamp($("newT").value, 1, 64, 5);
  location.href = "/edit/" + newId() + "?" + new URLSearchParams({ new: "1", name, mode, X, Y, Z, T }).toString();
}

/* ---------------- 绑定 ---------------- */
renderStarts();
$("btnNew").onclick = openNew;
$("newCancel").onclick = closeNew;
$("newOk").onclick = submitNew;
$("btnImport").onclick = () => $("htFile").click();
$("htFile").onchange = () => { const f = $("htFile").files[0]; if (f) importFile(f); $("htFile").value = ""; };
$("btnReload").onclick = () => { refresh(); tip("已刷新"); };
$("wbAbout").onclick = () => window.__showDisclaimer && window.__showDisclaimer();
$("q").oninput = (e) => { query = e.target.value.trim().toLowerCase(); renderWorlds(); };
$("sort").onchange = (e) => { sortKey = e.target.value; renderWorlds(); };
$("filters").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; filter = b.dataset.f; syncFilters(); renderWorlds(); };
$("viewSeg").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  view = b.dataset.view; localStorage.setItem("dao3_wb_view", view); syncFilters(); renderWorlds();
};
$("worldGrid").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const host = e.target.closest("[data-id]"); if (!host) return;
  e.preventDefault();
  act(b.dataset.act, host.dataset.id);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeNew();
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === "/" && !typing) { e.preventDefault(); $("q").focus(); return; }
  if (typing) return;
  if (e.key === "n") { e.preventDefault(); openNew(); }
  if (e.key === "r") refresh();
});
syncFilters();
refresh();

/* ── 官方素材的授权确认 ──────────────────────────────────────────────
   地图数据、赛道模型、音效都随包分发，但服务端不会自动装、也不会自动放行：
   必须用户在这里明确确认后才落地（见 server.js 的 /api/consent 与 gatedAsset）。
   未确认前用的是程序化示例地形，功能验证照样跑。 */
async function consentState() {
  try { return await fetch("/api/consent").then((r) => r.json()); } catch { return null; }
}
const mb = (n) => (n / 1048576).toFixed(2) + " MB";
/** 把包内实际内容写进确认框。写死数字会和包脱节，那样这个框就变成一份"看着对"的假文案。 */
function fillScope(s) {
  const b = s.bundle || {};
  const t = s.template || {};
  const map = $("tplScopeMap");
  // 数字全部来自服务端现读包，不在这里打字：改一次图就会和文案脱节
  if (map) map.textContent = s.available && t.shape
    ? `「${t.name}」· ${t.shape.join("×")} · ${t.blocks.toLocaleString()} 体素 · ${t.entities} 个实体 · ${t.scripts} 个脚本`
    : "本包里没有 racing-template.json.gz";
  const mo = $("tplScopeModels");
  if (mo) mo.textContent = b.模型 && b.模型.count ? `${b.模型.count} 个 .gltf · ${mb(b.模型.bytes)}` : "本包里没有";
  const au = $("tplScopeAudio");
  if (au) au.textContent = b.音效 && b.音效.count ? `${b.音效.count} 个音频 · ${mb(b.音效.bytes)}` : "本包里没有";
}
function showTplModal(s) {
  fillScope(s || {});
  $("tplModal").classList.add("show");
}
async function answerConsent(granted) {
  const btn = granted ? $("tplAccept") : $("tplDecline");
  btn.disabled = true;
  try {
    // 一次确认覆盖两项：授权依据是同一条"我有权在本地使用官方内容"，
    // 拆成两个框只会让人连点两次同样的同意。
    const r = await fetch("/api/consent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ racingTemplate: granted, racingAssets: granted }),
    }).then((x) => x.json());
    $("tplModal").classList.remove("show");
    if (granted && !r.ok) tip("授权失败：" + (r.error || "未知原因"));
    else if (r.installed) tip("已装「赛车模板」，并放行包内官方模型与音效");
    else if (r.occupied) tip("你已改过示例世界，模板没有覆盖它；官方模型与音效已放行");
    else tip(granted ? "已放行官方模型与音效" : "保持示例地形与无素材状态；随时可在左侧「官方素材授权」改主意");
    refresh();
  } finally { btn.disabled = false; }
}
$("tplAccept").onclick = () => answerConsent(true);
$("tplDecline").onclick = () => answerConsent(false);
$("wbTpl").onclick = async () => {
  const s = await consentState();
  if (!s) return tip("读不到授权状态：本地服务没在跑？");
  if (!s.available && !s.assetsAvailable) return tip("本包里没有 racing-template.json.gz，也没有 racing-assets/，无从安装");
  showTplModal(s);
};
(async () => {
  const s = await consentState();
  if (!s) return;
  // 起点卡上的官方模板：名字与数字都取服务端现读的那份，不在前端打字。
  applyTemplateCard(s);
  renderStarts();
  // 只有"从没表过态"且包内确实有东西才打扰一次；已选过的不再弹。
  // 旧的 racingTemplate 决定不沿用给新素材：新内容要重新确认。
  const pending = (s.racingTemplate === "unset" && s.available) || s.racingAssets !== "granted" && s.racingAssets !== "declined";
  if (pending && (s.available || s.assetsAvailable)) showTplModal(s);
})();
