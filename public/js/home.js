// home.js — 工作台：本地世界总览（指标 / 起点 / 可排序筛选的项目表 / 导入导出）
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
const dur = (sec) => (sec >= 3600 ? (sec / 3600).toFixed(1) + "h" : sec >= 60 ? Math.round(sec / 60) + "m" : sec + "s");
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
  const tiles = [
    { v: s.worlds, k: "本地世界", note: s.newest ? timeAgo(s.newest) : "空" },
    { v: fmt(s.voxels), k: "体素总量", note: s.worlds + " 张图" },
    { v: fmt(s.entities), k: "实体", note: (s.zones || 0) + " 区域" },
    { v: fmt(s.scripts), k: "脚本文件", note: (s.ui || 0) + " 界面" },
    { v: s.blocks, k: "方块种类", note: "官方图集" },
    { v: s.voxaModels, k: "VOXA 模型", note: fmt(s.voxaVoxels) + " 体素" },
    { v: kb(s.saveBytes), k: "存档体积", note: "gzip" },
    { v: (s.apiMembers || 0), k: "API 成员", note: "契约覆盖" },
    { v: dur(s.uptime), k: "服务运行", note: "node " + String(s.node || "").split(".")[0] },
  ];
  $("metrics").innerHTML = tiles.map((t) => `<div class="mt"><b>${esc(t.v)}</b><div class="mtr"><em>${esc(t.k)}</em><i>${esc(t.note)}</i></div></div>`).join("");
}

/* ---------------- 起点 ---------------- */
const STARTS = [
  { key: "template", hot: true, badge: "官方兼容", ico: "◉", name: "赛车模板", desc: "256×128×256 完整赛道：199 个官方实体、报名/检查点/加速道具与可直接跑的竞速脚本。", action: forkTemplate },
  { key: "flat", ico: "▭", name: "超平坦", desc: "100×32×100 平坦基座，厚 5 格，适合从零搭建建筑或玩法。", action: () => goNew("超平坦世界", "flat") },
  { key: "demo", ico: "⛰", name: "起伏地形", desc: "带草坡与一间小木屋的示例岛，用来试笔刷和选区变换。", action: () => goNew("起伏地形岛", "demo") },
  { key: "empty", ico: "◻", name: "空白世界", desc: "完全空的体素容器，尺寸自定义，适合小场景与机制验证。", action: () => goNew("空白世界", "empty") },
  { key: "import", ico: "↓", name: "导入地图", desc: "官方 .zip 项目包、Unity 侧 .gz 地图、.vox 体素模型。", action: () => $("htFile").click() },
];

function renderStarts() {
  const grid = $("startGrid");
  grid.innerHTML = "";
  for (const s of STARTS) {
    const b = document.createElement("button");
    b.className = "wb-start" + (s.hot ? " hot" : "");
    b.innerHTML = `<div class="ico">${s.ico}</div><div><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p></div><span class="go">→</span>`
      + (s.badge ? `<span class="wb-badge">${esc(s.badge)}</span>` : "");
    b.onclick = () => s.action();
    grid.appendChild(b);
  }
}

function goNew(name, mode) {
  const q = new URLSearchParams({ new: "1", name, mode, X: 100, Y: 32, Z: 100, T: 5 });
  location.href = "/edit/" + newId() + "?" + q.toString();
}

// 复制模板：服务端 fork（避免在浏览器里搬 1.5M 体素），原模板保持不动
async function forkTemplate() {
  tip("正在复制「赛车模板」…", 0);
  try {
    const id = newId();
    const r = await fetch("/api/world/" + TEMPLATE_ID + "/fork?to=" + id + "&name=" + encodeURIComponent("赛车模板 · 副本"), { method: "POST" });
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

/* ---------------- 导入 ---------------- */
function importFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  tip("正在解析 " + file.name + " …", 0);
  (async () => {
    const io = await import("/js/io.js");
    const atlas = (await import("/js/atlas.js")).atlas;
    let res;
    if (ext === "zip") res = await io.importProjectZip(file);
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
    let assetRoot = "";
    if (ext === "zip" && res.meshes && Object.keys(res.meshes).length) {
      assetRoot = await saveZipAssets(id, file);
      if (assetRoot) meta.assetRoot = assetRoot;
    }
    const payload = res.world.toPayload(meta);
    const r = await fetch("/api/world/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "保存失败");
    tip("已保存，正在打开编辑器…", 0);
    setTimeout(() => (location.href = "/edit/" + id), 400);
  })().catch((e) => tip("导入失败：" + (e && e.message || e), 4200));
}

// zip 内的模型资产落到 /assets/worlds/<id>/ 下，编辑器按 assetRoot 懒加载
async function saveZipAssets(id, file) {
  try {
    const { readZipEntries } = await import("/js/zip.js");
    const buf = new Uint8Array(await file.arrayBuffer());
    const z = await readZipEntries(buf);
    const ents = z.entries.filter((e) => /(^|\/)(models?|mesh|picture|image|ui)\/.*\.(glb|gltf|png|jpg|jpeg|webp)$/i.test(e.name));
    if (!ents.length) return "";
    for (const e of ents) {
      const data = await z.extract(e);
      // 模型按文件名取用（编辑器用 assetRoot + name）；图片保留 picture/ 目录，才能和 resources.ls 给的路径对上
      const rel = /\.(glb|gltf)$/i.test(e.name) ? e.name.split("/").pop() : e.name.replace(/^.*?(?=picture\/|image\/|ui\/)/, "");
      await fetch("/api/world/" + id + "/asset?path=" + encodeURIComponent(rel), { method: "POST", body: data });
    }
    return "/assets/worlds/" + id + "/";
  } catch { return ""; }
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

/* ── 官方赛车模板的授权确认 ──────────────────────────────────────────────
   模板随包分发，但服务端不会自动装：必须用户在这里明确确认后才落地。
   未确认前用的是程序化示例地形，功能验证照样跑。 */
async function consentState() {
  try { return await fetch("/api/consent").then((r) => r.json()); } catch { return null; }
}
function showTplModal() { $("tplModal").classList.add("show"); }
async function answerConsent(granted) {
  const btn = granted ? $("tplAccept") : $("tplDecline");
  btn.disabled = true;
  try {
    const r = await fetch("/api/consent", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ racingTemplate: granted }),
    }).then((x) => x.json());
    $("tplModal").classList.remove("show");
    if (r.installed) tip("已装「赛车模板」：199 个实体 / 152 万格");
    else if (r.occupied) tip("你已改过示例世界，模板没有覆盖它（左侧「模板授权」可强制重装）");
    else if (granted && !r.ok) tip("模板安装失败：" + (r.error || "未知原因"));
    else tip("保持示例地形；随时可在左侧「模板授权」改主意");
    refresh();
  } finally { btn.disabled = false; }
}
$("tplAccept").onclick = () => answerConsent(true);
$("tplDecline").onclick = () => answerConsent(false);
$("wbTpl").onclick = async () => {
  const s = await consentState();
  if (!s || !s.available) return tip("本包里没有 racing-template.json.gz，无从安装");
  showTplModal();
};
(async () => {
  const s = await consentState();
  if (!s) return;
  // 只有"从没表过态"且模板确实在包里才打扰一次；已选过的不再弹
  if (s.racingTemplate === "unset" && s.available) showTplModal();
})();
