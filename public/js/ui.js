// ui.js — 构建并接线官方同款 UI：顶部菜单、左上浮动方块库、中央浮动工具条、右侧导览+属性。
import { mirror, rotate90, flip } from "./ops.js";
import * as io from "./io.js";
import { moveSelectedModel, refreshModelList } from "./features.js";

// 内联 SVG 图标集（不用 emoji，保证任意平台呈现一致）
const I = window.__icons = {
  all: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6.5" y="6.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  nature: '<svg viewBox="0 0 24 24"><path d="M12 3c3.2 3.6 5 6.6 5 9.5a5 5 0 0 1-10 0c0-2.9 1.8-5.9 5-9.5z" fill="currentColor" opacity=".85"/><path d="M12 13v8M7 21h10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  structure: '<svg viewBox="0 0 24 24"><path d="M4 20V10l8-6 8 6v10h-6v-6h-4v6H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.5v3M12 22.5v-1.6M2.5 14H5M19 14h2.5M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  color: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 12h17" stroke="currentColor" stroke-width="1.6" opacity=".55"/></svg>',
  element: '<svg viewBox="0 0 24 24"><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9L12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10.2l7.2-1v-1.5L12 8.7 4.8 7.7v1.5L12 10.2zm0 3.6l7.2-1v-1.5L12 12.3l-7.2-1v1.5l7.2 1zm0 3.6l7.2-1v-1.5L12 15.9l-7.2-1v1.5l7.2 1z" fill="currentColor"/></svg>',
  letter: '<svg viewBox="0 0 24 24"><text x="5" y="18" font-size="15" font-weight="700" fill="currentColor" font-family="Arial">A</text></svg>',
  number: '<svg viewBox="0 0 24 24"><text x="3.5" y="18" font-size="15" font-weight="700" fill="currentColor" font-family="Arial">1·2</text></svg>',
  symbol: '<svg viewBox="0 0 24 24"><text x="3" y="18" font-size="16" font-weight="700" fill="currentColor" font-family="Arial">+−</text></svg>',
  food: '<svg viewBox="0 0 24 24"><path d="M7 3v6a2.5 2.5 0 0 1-5 0V3M4.5 9v12M16 3c0 3 1.6 4.5 2 5.5V21M12 3v18M15 21H9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  recent: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.2 15.2L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  collab: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 19c.8-3.2 2.8-4.8 5.5-4.8s4.7 1.6 5.5 4.8M16.5 5.6a3.2 3.2 0 0 1 0 5.8M18.6 14.4c1 .8 1.7 2 1.9 3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  feedback: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5l1 2.2 2.4-.5 1 2.1 2.3.8-.3 2.4 1.8 1.6-1.8 1.6.3 2.4-2.3.8-1 2.1-2.4-.5-1 2.2-1-2.2-2.4.5-1-2.1-2.3-.8.3-2.4L3.8 12l1.8-1.6-.3-2.4 2.3-.8 1-2.1 2.4.5 1-2.2z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 10.5V20h5.5v-5.5h5V20H20v-9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M2.8 11L12 3.5 21.2 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5l12 7.5-12 7.5v-15z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" fill="currentColor"/></svg>',
  cube: '<svg viewBox="0 0 24 24"><path d="M12 3.5l7.2 4.2v8.6L12 20.5l-7.2-4.2V7.7L12 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  break: '<svg viewBox="0 0 24 24"><path d="M6 18L18 6M9.5 6.5l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  paint: '<svg viewBox="0 0 24 24"><path d="M15.5 3.5l5 5-9.8 9.8-5.7 1.2 1.2-5.7 9.3-10.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><path d="M12 4.5L6.5 15H17.5L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 4.5v10.5" stroke="currentColor" stroke-width="1.4"/></svg>',
  pick: '<svg viewBox="0 0 24 24"><path d="M13 4l7 16-4.6-4.6L10.4 20 12 6.5 13 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  line: '<svg viewBox="0 0 24 24"><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="1 2.4"/></svg>',
  box: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  boxBreak: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/><path d="M5 19L19 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  extrude: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  select: '<svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2.4"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-2.6 2.6L12 8l2.6-2.4L12 3zm0 18l-2.6-2.6L12 16l2.6 2.4L12 21zM3 12l2.6-2.6L8 12l-2.4 2.6L3 12zm18 0l-2.6-2.6L16 12l2.4 2.6L21 12z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  ortho: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.6" opacity=".4"/></svg>',
  edges: '<svg viewBox="0 0 24 24"><path d="M12 4.5l6.5 3.8v7.4L12 19.5l-6.5-3.8V8.3L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h16M5 4v16M12 4v16M19 4v16" stroke="currentColor" stroke-width="1.2" opacity=".8"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11.5L12 4l8 7.5V20h-6v-6h-4v6H4v-8.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  fp: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10.5" cy="10.5" r="1" fill="currentColor"/><path d="M4 4l5 2.6M20 4l-5 2.6M4 20l5-2.6M20 20l-5-2.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path d="M6 4v10M12 4v10M18 4v10M3 14h18M6 20h5M15 20h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  manual: '<svg viewBox="0 0 24 24"><path d="M12 5.2C10.3 3.9 8 3.5 4.5 3.9v14.2c3.5-.4 5.8 0 7.5 1.3 1.7-1.3 4-1.7 7.5-1.3V3.9C16 3.5 13.7 3.9 12 5.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 5.2v14.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4V20.5H6v-17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.5V8h4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  fx: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" opacity=".8"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h4l5 4v-13l-5 4H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  spin: '<svg viewBox="0 0 24 24"><path d="M19.5 8.5a8 8 0 1 0 .5 6.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19.5 3v5.5H14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  caret: '<svg viewBox="0 0 12 12" class="caret-svg"><path d="M2.5 4.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  treeArrow: '<svg viewBox="0 0 10 10" class="tw-svg"><path d="M2.5 1.5v7l5.5-3.5-5.5-3.5z" fill="currentColor"/></svg>',
  treeArrowOpen: '<svg viewBox="0 0 10 10" class="tw-svg"><path d="M1.5 2.5h7l-3.5 5.5-3.5-5.5z" fill="currentColor"/></svg>',
  cubeDot: '<svg viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" transform="rotate(20 7 7)"/></svg>',
};
// 静态按钮直接由 data-ico 填充
document.querySelectorAll("[data-ico]").forEach((b) => {
  const s = I[b.dataset.ico]; if (s) { b.innerHTML = s; b.classList.add("has-ico"); }
});

// 实体名可被用户改名，插入 innerHTML 前必须转义
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 分类图标栏（对应图集 category）
const RAIL = [
  ["all", "all", "全部"], ["nature", "nature", "自然"], ["structure", "structure", "结构"],
  ["light", "light", "光源"], ["color", "color", "颜色"], ["element", "element", "元素"],
  ["letter", "letter", "字母"], ["number", "number", "数字"], ["symbol", "symbol", "符号"],
  ["food", "food", "食物"], ["recent", "recent", "最近"],
];
// 分类中文名取自官方 blockworld-ui.zh-CN.json 的 categories
const CAT_ZH = { nature: "自然", structure: "结构", light: "光源", color: "颜色", element: "元素", letter: "字母", number: "数字", symbol: "符号", food: "食物", misc: "杂项", building: "建筑", glass: "玻璃", other: "杂项" };

export function buildUI({ state, atlas, world, renderer, history, ctx, save, loadWorld, toast, applyTerrain, clearSel, copySel, paste, deleteSel, markDirty, updateStatus, sunDirFromDayNight, enterPlay, stopPlay, setFirstPerson, importProject }) {
  const api = {};
  const $ = (id) => document.getElementById(id);
  const recent = [];

  // ---------- 左上：分类图标栏 + 方块网格 ----------
  const catRail = $("catRail"), lib = $("blockLib"), search = $("blockSearch");
  let activeCat = "nature";
  function renderRail() {
    catRail.innerHTML = "";
    for (const [id, ico, name] of RAIL) {
      const b = document.createElement("button");
      b.innerHTML = I[ico] || ico; b.title = name; b.className = activeCat === id ? "active" : "";
      b.onclick = () => { activeCat = id; renderRail(); renderBlocks(); };
      catRail.appendChild(b);
    }
  }
  function renderBlocks() {
    lib.innerHTML = "";
    const q = (search.value || "").trim().toLowerCase();
    let blocks = activeCat === "recent" ? recent.map((id) => atlas.byId(id)).filter(Boolean)
      : activeCat === "all" ? atlas.list() : atlas.listByCategory(activeCat);
    if (q) blocks = blocks.filter((b) => b.name.includes(q) || (b.zh || "").toLowerCase().includes(q));
    blocks = blocks.slice(0, 300);
    for (const b of blocks) {
      const cell = document.createElement("button");
      cell.className = "block" + (state.currentBlock === b.id ? " active" : "");
      cell.title = `${b.zh || b.name} · ${b.name} (id ${b.id})`;
      const rot = b.rotates ? '<span class="rot">' + I.spin + "</span>" : "";
      cell.innerHTML = `${rot}<img src="/data/thumbnails/${b.name}.png" alt="${b.name}" loading="lazy"/><span class="nm">${b.zh || b.name}</span>`;
      cell.onclick = () => { state.currentBlock = b.id; pushRecent(b.id); renderBlocks(); updateProp(); };
      lib.appendChild(cell);
    }
    applyZoom();
  }
  function pushRecent(id) { const i = recent.indexOf(id); if (i >= 0) recent.splice(i, 1); recent.unshift(id); if (recent.length > 24) recent.pop(); }
  search.oninput = renderBlocks;
  renderRail(); renderBlocks();

  // ---------- 地形/场景 tab 切换 ----------
  document.querySelectorAll(".lc-tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".lc-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const scene = t.dataset.lc === "scene";
      $("globalToolbar").classList.toggle("show", scene);
      $("lcAdd").closest(".lc-add").style.display = scene ? "none" : "flex";
      $("blockSearch").closest(".lc-search").style.display = scene ? "none" : "flex";
      $("blockLib").closest(".lc-body").style.display = scene ? "none" : "flex";
    };
  });

  // ---------- 全局变换（场景 tab）----------
  const gt = $("globalToolbar");
  gt.innerHTML = '<div class="panel-title">全局变换</div>';
  const wrap = document.createElement("div"); wrap.className = "global-toolbar"; gt.appendChild(wrap);
  const gbtn = (label, title, fn) => { const b = document.createElement("button"); b.textContent = label; b.title = title; b.onclick = () => { fn(); toast(title); }; wrap.appendChild(b); };
  for (const ax of ["x", "y", "z"]) gbtn("镜" + ax.toUpperCase(), `沿 ${ax.toUpperCase()} 轴镜像`, () => commitOp(mirror(world, ax, state.selection)));
  for (const ax of ["x", "y", "z"]) gbtn("转" + ax.toUpperCase(), `绕 ${ax.toUpperCase()} 轴旋转90°`, () => commitOp(rotate90(world, ax, 1, state.selection)));
  for (const ax of ["x", "y", "z"]) gbtn("翻" + ax.toUpperCase(), `沿 ${ax.toUpperCase()} 轴翻转`, () => commitOp(flip(world, ax, state.selection)));
  function commitOp(changes) { if (changes && changes.length) history.commit(changes, "op"); }

  // ---------- 中央浮动工具条 ----------
  function renderTools() {
    document.querySelectorAll("#editToolbar .ft[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === state.tool));
  }
  document.querySelectorAll("#editToolbar .ft[data-tool]").forEach((b) => { b.onclick = () => api.setTool(b.dataset.tool); });
  api.setTool = (id) => { state.tool = id; renderTools(); };
  renderTools();

  // ---------- 辅助开关 ----------
  $("undo").onclick = () => history.undo();
  $("redo").onclick = () => history.redo();
  $("ortho").onclick = () => { renderer.setOrtho(!renderer._ortho); api.syncOrtho(); };
  $("edges").onclick = (e) => {
    const on = !renderer.showEdges;
    renderer.setEdges(on);
    e.currentTarget.classList.toggle("active", on);
    toast("方块接缝线：" + (on ? "开" : "关"));
  };
  $("grid").onclick = (e) => { state.terrain.grid = !state.terrain.grid; applyTerrain(); e.currentTarget.classList.toggle("active", state.terrain.grid); };
  $("resetView").onclick = () => { renderer.camera.position.set(60, 55, 70); renderer.controls.target.set(24, 10, 24); renderer.controls.update(); };
  $("fpEdit").onclick = (e) => { const on = !renderer.fpMode; setFirstPerson(on); e.currentTarget.classList.toggle("active", on); };
  // 编辑视角分段：全局轨道 / 角色（可飞行）
  $("modeGlobal").onclick = () => { if (renderer.fpMode) setFirstPerson(false); };
  $("modeRole").onclick = () => { if (!renderer.fpMode) setFirstPerson(true); };
  api.syncEditSeg = () => {
    const role = !!renderer.fpMode;
    $("modeGlobal").classList.toggle("active", !role);
    $("modeRole").classList.toggle("active", role);
    $("fpEdit").classList.toggle("active", role);
  };
  api.syncOrtho = () => $("ortho")?.classList.toggle("active", !!renderer._ortho);
  api.syncFP = () => $("fpEdit")?.classList.toggle("active", !!renderer.fpMode);

  // ---------- 方块库缩放（真的改变缩略图尺寸，并被记住） ----------
  function applyZoom() {
    const z = state.blockZoom || 1;
    lib.style.gridTemplateColumns = `repeat(auto-fill, minmax(${Math.round(30 * z + 14)}px, 1fr))`;
    lib.querySelectorAll(".block img").forEach((i) => {
      i.style.width = Math.round(16 * z * 1.6) + "px";
      i.style.height = Math.round(16 * z * 1.6) + "px";
    });
  }
  $("zoomSlider").oninput = (e) => {
    const z = Number(e.target.value) || 1;
    $("zoomVal").textContent = z + "x";
    state.blockZoom = z;
    applyZoom();
    try { localStorage.setItem("dao3_block_zoom", String(z)); } catch {}
  };
  try {
    const saved = Number(localStorage.getItem("dao3_block_zoom"));
    if (saved >= 1 && saved <= 4) { $("zoomSlider").value = saved; $("zoomVal").textContent = saved + "x"; state.blockZoom = saved; }
  } catch {}

  // ---------- 右侧：导览树 ----------
  const tree = $("hierarchy");
  function renderTree() {
    tree.innerHTML = "";
    renderEntityTree();
    const present = new Map();
    for (const [, c] of world.map) present.set(c.id, (present.get(c.id) || 0) + 1);
    if (!present.size) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "padding:10px;font-size:12px;line-height:1.8;color:var(--font-black-minor)";
      empty.textContent = "暂无内容 · 在左侧方块库选择方块开始搭建";
      tree.appendChild(empty);
      return;
    }
    const cats = new Map();
    for (const [id, n] of present) { const b = atlas.byId(id); if (!b) continue; if (!cats.has(b.category)) cats.set(b.category, []); cats.get(b.category).push({ b, n }); }
    let gi = 0;
    for (const [cat, items] of cats) {
      const grp = document.createElement("div");
      grp.className = "tnode"; grp.innerHTML = `<span class="tw is-closed"></span><span>组-${++gi} · ${catName(cat)}</span>`;
      const kids = document.createElement("div"); kids.style.display = "none";
      items.sort((a, b) => b.n - a.n).slice(0, 8).forEach(({ b, n }) => {
        const it = document.createElement("div");
        it.className = "tnode child"; it.innerHTML = `<span class="cube">${I.cubeDot}</span><span>${b.zh || b.name}</span><span style="margin-left:auto;color:var(--font-black-minor)">${n}</span>`;
        it.onclick = () => { state.currentBlock = b.id; pushRecent(b.id); renderBlocks(); updateProp(); document.querySelectorAll(".tnode").forEach(x=>x.classList.remove("active")); it.classList.add("active"); };
        kids.appendChild(it);
      });
      grp.onclick = (e) => { e.stopPropagation(); kids.style.display = kids.style.display === "none" ? "block" : "none"; grp.querySelector(".tw").classList.toggle("is-closed", kids.style.display === "none"); };
      grp.oncontextmenu = (e) => showCtx(e);
      tree.appendChild(grp); tree.appendChild(kids);
    }
  }
  renderTree();
  // 官方导览：场景实体按 entitiesTree 的组层级展示（组-1 / 组-2 / 根）
  function renderEntityTree() {
    const models = state.models || [];
    if (!models.length) return;
    const groups = (state.meta && state.meta.groups) || [];
    const byId = new Map(models.map((m) => [String(m.id), m]));
    const sec = document.createElement("div");
    sec.className = "tnode sec-head"; sec.innerHTML = `<span class="tw"></span><span>场景 · ${models.length}</span>`;
    const body = document.createElement("div");
    const row = (m, depth) => {
      const it = document.createElement("div");
      it.className = "tnode child"; it.style.paddingLeft = 10 + depth * 12 + "px";
      const tag = m.tags && m.tags.length ? ` ·${escHtml(m.tags.join(","))}` : "";
      it.innerHTML = `<span class="cube">${I.cubeDot}</span><span>${escHtml(m.name || m.meshName || "未命名")}</span><span style="margin-left:auto;color:var(--font-black-minor)">${tag}</span>`;
      it.onclick = (ev) => {
        ev.stopPropagation();
        state.selectedModel = m;
        document.querySelectorAll(".tnode").forEach((x) => x.classList.remove("active"));
        it.classList.add("active");
        const p = m.object ? m.object.position : { x: 0, y: 0, z: 0 };
        renderer.controls.target.set(p.x, p.y, p.z); renderer.controls.update();
        refreshModelList(); renderFxSound();
      };
      body.appendChild(it);
    };
    const kids = (ids, depth) => ids.map((id) => byId.get(String(id))).filter(Boolean).slice(0, 120).forEach((m) => row(m, depth));
    if (groups.length) {
      for (const g of groups) {
        const gn = document.createElement("div");
        gn.className = "tnode"; gn.innerHTML = `<span class="tw is-closed"></span><span>${escHtml(g.name)} · ${g.childrenIds.length}</span>`;
        const gb = document.createElement("div"); gb.style.display = "none";
        g.childrenIds.map((id) => byId.get(String(id))).filter(Boolean).slice(0, 120).forEach((m) => {
          const it = document.createElement("div");
          it.className = "tnode child"; it.style.paddingLeft = "22px";
          it.innerHTML = `<span class="cube">${I.cubeDot}</span><span>${escHtml(m.name)}</span>`;
          it.onclick = (ev) => { ev.stopPropagation(); state.selectedModel = m; renderer.controls.target.set(m.object.position.x, m.object.position.y, m.object.position.z); renderer.controls.update(); refreshModelList(); renderFxSound(); };
          gb.appendChild(it);
        });
        gn.onclick = (ev) => { ev.stopPropagation(); gb.style.display = gb.style.display === "none" ? "block" : "none"; gn.querySelector(".tw").classList.toggle("is-closed", gb.style.display === "none"); };
        body.appendChild(gn); body.appendChild(gb);
      }
      const rootKids = models.filter((m) => !m.parentId || m.parentId === "ROOT_ID");
      if (rootKids.length) { const h = document.createElement("div"); h.className = "tnode child"; h.style.opacity = ".7"; h.textContent = `根节点 · ${rootKids.length}`; body.appendChild(h); kids(rootKids.map((m) => String(m.id)), 1); }
    } else {
      models.slice(0, 120).forEach((m) => row(m, 1));
    }
    sec.onclick = (e) => { e.stopPropagation(); body.style.display = body.style.display === "none" ? "block" : "none"; sec.querySelector(".tw").classList.toggle("is-closed", body.style.display === "none"); };
    body.style.display = "none";
    tree.appendChild(sec); tree.appendChild(body);
  }
  const ctxEl = $("ctxmenu");
  function showCtx(e) { e.preventDefault(); ctxEl.style.left = e.clientX + "px"; ctxEl.style.top = e.clientY + "px"; ctxEl.classList.add("show"); }
  document.addEventListener("click", () => ctxEl.classList.remove("show"));
  ctxEl.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.c;
      if (c === "copy") copySel();
      else if (c === "delete") deleteSel();
      else if (c === "rename") {
        const m = state.selectedModel;
        if (!m) { toast("先选中一个模型再重命名"); return; }
        const n = prompt("模型名称（#id 或 .tag 会成为运行模式实体）", m.name);
        if (n) { m.name = n; api.refreshTree && api.refreshTree(); if (E_renderModelList()) E_renderModelList(); markDirty(); }
      }
    };
  });
  function E_renderModelList() { return window.__editor && window.__editor.renderModelList; }

  // ---------- 右侧：属性 ----------
  const posWrap = $("posSliders");
  const posCols = ["X", "Y", "Z"].map((ax, i) => {
    const col = document.createElement("div"); col.className = "poscol";
    col.innerHTML = `<input class="vslider" type="range" min="0" max="256" step="0.5" value="0"><input class="posnum" value="0"><span class="poslbl">${ax}</span>`;
    posWrap.appendChild(col);
    const slider = col.querySelector(".vslider"), num = col.querySelector(".posnum");
    const sync = () => { if (ctx.mode === "model" && state.selectedModel) { const p = posCols.map((c) => parseFloat(c.slider.value)); moveSelectedModel(p[0], p[1], p[2]); } };
    slider.oninput = () => { num.value = slider.value; sync(); };
    num.onchange = () => { slider.value = num.value; sync(); };
    return { slider, num };
  });
  function updateProp() {
    const b = atlas.byId(state.currentBlock);
    $("propBlock").textContent = b ? `${b.zh || b.name}` : "—";
    $("propBlock").title = b ? b.name : "";
    $("propId").textContent = b ? b.id : "—";
    $("propGlow").textContent = b && (b.emissive[0] + b.emissive[1] + b.emissive[2]) > 0.05 ? "是" : "否";
  }
  updateProp();
  // 每帧用当前拾取体素更新位置滑杆（只读显示）
  renderer.onRender = () => {
    if (ctx.mode === "model" && state.selectedModel) { const p = state.selectedModel.pos; ["X","Y","Z"].forEach((_, i) => { if (posCols[i] && document.activeElement !== posCols[i].slider) { posCols[i].slider.value = p[i]; posCols[i].num.value = p[i]; } }); return; }
    const p = ctx.pick;
    const v = state.selection ? [state.selection.min.x, state.selection.min.y, state.selection.min.z] : p ? [p.x, p.y, p.z] : [0, 0, 0];
    ["X", "Y", "Z"].forEach((_, i) => { if (posCols[i] && document.activeElement !== posCols[i].slider && document.activeElement !== posCols[i].num) { posCols[i].slider.value = v[i]; posCols[i].num.value = v[i]; } });
  };
  api.onSelection = () => { };
  api.onBlockPicked = (id) => { state.currentBlock = id; pushRecent(id); renderBlocks(); updateProp(); toast("取色: " + (atlas.byId(id)?.name || id)); };

  // ---------- 特效 / 音效（官方实体 particle / sound 记录）----------
  const FX_DEFAULT = () => ({
    rate: 0, rateSpread: 0, limit: 0, lifetime: 1, lifetimeSpread: 0, damping: 0,
    noiseAmpl: 0, noiseFreq: 1, size0: 1, size1: 1, size2: 1, size3: 1, size4: 1, sizeSpread: 0,
    velocity: { x: 0, y: 0, z: 0 }, velocitySpread: { x: 0, y: 0, z: 0 }, acceleration: { x: 0, y: 1, z: 0 },
    color0: { r: 1000, g: 1000, b: 1000 }, color1: { r: 0, g: 0, b: 0 }, color2: { r: 0, g: 0, b: 0 },
    color3: { r: 0, g: 0, b: 0 }, color4: { r: 0, g: 0, b: 0 },
  });
  const SND_DEFAULT = () => ({ gain: 1, gainRange: 0, pitch: 1, pitchRange: 0, radius: 32, sample: "" });
  const paneRow = (pane, label, val, cb, type = "number") => {
    const r = document.createElement("label");
    r.className = "trow"; r.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 10px;font-size:11px";
    const lb = document.createElement("span"); lb.textContent = label; lb.style.cssText = "width:78px;color:var(--font-black-minor)";
    const i = document.createElement("input"); i.type = type; i.value = val;
    i.style.cssText = "flex:1;min-width:0";
    i.onchange = () => cb(type === "number" ? (parseFloat(i.value) || 0) : i.value);
    r.appendChild(lb); r.appendChild(i); pane.appendChild(r);
    return i;
  };
  function renderFxSound() {
    const fx = $("fxPane"), snd = $("sndPane");
    if (!fx || !snd) return;
    const m = state.selectedModel;
    const qv = $("quatVal");
    if (qv) {
      const q = m && m.object ? m.object.quaternion.toArray() : [0, 0, 0, 1];
      qv.textContent = q.map((n) => n.toFixed(3)).join(", ");
    }
    fx.innerHTML = ""; snd.innerHTML = "";
    const note = (pane, text) => { const d = document.createElement("div"); d.className = "muted"; d.style.padding = "10px"; d.style.fontSize = "12px"; d.textContent = text; pane.appendChild(d); };
    if (!m) { note(fx, "在导览或模型列表选中实体后编辑其粒子特效"); note(snd, "选中实体后编辑其音效"); return; }
    const p = m.particle || (m.particle = FX_DEFAULT());
    const head = (pane, t) => { const h = document.createElement("div"); h.className = "panel-title"; h.textContent = t; h.style.padding = "6px 10px"; pane.appendChild(h); };
    head(fx, (m.name || "实体") + " · 特效");
    for (const [k, zh] of [["rate", "发射率"], ["rateSpread", "发射率浮动"], ["limit", "数量上限"], ["lifetime", "存活秒"], ["lifetimeSpread", "存活浮动"], ["damping", "阻尼"], ["noiseAmpl", "噪声强度"], ["noiseFreq", "噪声频率"], ["sizeSpread", "尺寸浮动"]]) {
      paneRow(fx, zh, p[k] ?? 0, (v) => { p[k] = v; markDirty(); });
    }
    for (const ax of ["size0", "size1", "size2", "size3", "size4"]) paneRow(fx, "尺寸" + (+ax.slice(4) + 1), p[ax] ?? 1, (v) => { p[ax] = v; markDirty(); });
    for (const [k, zh] of [["velocity", "初速度"], ["velocitySpread", "速度浮动"], ["acceleration", "加速度"]]) {
      const v = p[k] || (p[k] = { x: 0, y: 0, z: 0 });
      for (const ax of ["x", "y", "z"]) paneRow(fx, zh + " " + ax.toUpperCase(), v[ax] ?? 0, (n) => { v[ax] = n; markDirty(); });
    }
    for (let i = 0; i < 5; i++) {
      const c = p["color" + i] || (p["color" + i] = { r: 0, g: 0, b: 0 });
      paneRow(fx, "颜色" + (i + 1) + " R", c.r ?? 0, (v) => { c.r = v; markDirty(); });
      paneRow(fx, "　 颜色" + (i + 1) + " G", c.g ?? 0, (v) => { c.g = v; markDirty(); });
      paneRow(fx, "　 颜色" + (i + 1) + " B", c.b ?? 0, (v) => { c.b = v; markDirty(); });
    }
    const tip = document.createElement("div"); tip.className = "muted"; tip.style.cssText = "padding:6px 10px;font-size:10px;line-height:1.6";
    tip.textContent = "发射率 > 0 时运行模式会持续发射粒子；颜色通道 0–1000 为官方 HDR 口径。";
    fx.appendChild(tip);
    const s = m.sound || (m.sound = { chat: SND_DEFAULT(), die: SND_DEFAULT(), hurt: SND_DEFAULT(), interact: SND_DEFAULT() });
    head(snd, (m.name || "实体") + " · 音效");
    for (const [k, zh] of [["interact", "交互"], ["chat", "聊天"], ["hurt", "受伤"], ["die", "死亡"]]) {
      const slot = s[k] || (s[k] = SND_DEFAULT());
      paneRow(snd, zh + " 音频", slot.sample || "", (v) => { slot.sample = v; markDirty(); }, "text");
      paneRow(snd, "　 音量", slot.gain ?? 1, (v) => { slot.gain = v; markDirty(); });
      paneRow(snd, "　 音调", slot.pitch ?? 1, (v) => { slot.pitch = v; markDirty(); });
      paneRow(snd, "　 半径", slot.radius ?? 32, (v) => { slot.radius = v; markDirty(); });
    }
    const tip2 = document.createElement("div"); tip2.className = "muted"; tip2.style.cssText = "padding:6px 10px;font-size:10px;line-height:1.6";
    tip2.textContent = "路径写 audio/xxx.mp3（resources.ls('audio/') 可列出全部官方音效）。";
    snd.appendChild(tip2);
  }
  renderFxSound();
  api.refreshFxSound = renderFxSound;

  // ---------- 属性 tab 切换 ----------
  document.querySelectorAll(".pp-ico").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".pp-ico").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      document.querySelectorAll(".pp-tab").forEach((t) => t.classList.toggle("hidden", t.dataset.tab !== b.dataset.tab));
    };
  });

  // ---------- 地形/外观（look tab）----------
  const terr = $("terrain");
  const slider = (label, min, max, step, val, on) => {
    const row = document.createElement("label"); row.className = "trow";
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><em>${val}</em>`;
    const inp = row.querySelector("input"), em = row.querySelector("em");
    inp.oninput = () => { em.textContent = inp.value; on(parseFloat(inp.value)); };
    terr.appendChild(row);
  };
  const color = (label, val, on) => {
    const row = document.createElement("label"); row.className = "trow";
    row.innerHTML = `<span>${label}</span><input type="color" value="${val}"><em></em>`;
    row.querySelector("input").oninput = (e) => on(parseInt(e.target.value.slice(1), 16));
    terr.appendChild(row);
  };
  color("天空顶", hex(state.terrain.skyTop), (v) => { state.terrain.skyTop = v; applyTerrain(); });
  color("天空底", hex(state.terrain.skyBottom), (v) => { state.terrain.skyBottom = v; applyTerrain(); });
  slider("日照", 0, 4, 0.05, state.terrain.sunIntensity, (v) => { state.terrain.sunIntensity = v; applyTerrain(); });
  slider("环境光", 0, 1, 0.01, state.terrain.ambient, (v) => { state.terrain.ambient = v; applyTerrain(); });
  slider("半球光", 0, 2, 0.05, state.terrain.hemi, (v) => { state.terrain.hemi = v; applyTerrain(); });
  slider("昼夜", 0, 1, 0.01, state.terrain.dayNight, (v) => { state.terrain.dayNight = v; applyTerrain(); });
  slider("曝光", 0.4, 2, 0.02, state.terrain.exposure ?? 1.12, (v) => { state.terrain.exposure = v; applyTerrain(); });
  slider("雾", 0, 0.02, 0.0002, state.terrain.fogDensity, (v) => { state.terrain.fogDensity = v; applyTerrain(); });
  slider("发光", 0, 1.5, 0.05, state.terrain.glow, (v) => { state.terrain.glow = v; applyTerrain(); });
  const shadowRow = document.createElement("label"); shadowRow.className = "trow";
  shadowRow.innerHTML = `<span>阴影</span><input type="checkbox" ${state.terrain.shadows ? "checked" : ""}><em></em>`;
  shadowRow.querySelector("input").onchange = (e) => { state.terrain.shadows = e.target.checked; applyTerrain(); };
  terr.appendChild(shadowRow);

  // ---------- 天气预设（晴 / 雨 / 雪 / 雷暴；运行模式下由 world.rainDensity 联动）----------
  const wrow = document.createElement("div"); wrow.className = "weather-row";
  wrow.innerHTML = `<span class="wlabel">天气</span>`;
  const wpresets = [["晴", "clear"], ["雨", "rain"], ["雪", "snow"], ["雷暴", "thunder"]];
  for (const [label, key] of wpresets) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      wrow.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const w = { rain: 0, snow: 0, thunder: 0 };
      if (key === "rain") w.rain = 0.75;
      else if (key === "snow") w.snow = 0.7;
      else if (key === "thunder") { w.rain = 0.9; w.thunder = 0.6; }
      state.terrain.weather = key;
      renderer.setWeather(w);
      toast("天气：" + label + "（游戏脚本可用 world.rainDensity / clearWeather 控制）");
    };
    wrow.appendChild(b);
  }
  terr.appendChild(wrow);

  // ---------- 世界设置（world tab）----------
  const worldTab = $("worldTab"); if (worldTab) {
    const wslider = (label, min, max, step, val, on) => {
      const row = document.createElement("label"); row.className = "trow";
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"><em>${val}</em>`;
      const inp = row.querySelector("input"), em = row.querySelector("em");
      inp.oninput = () => { em.textContent = inp.value; on(parseFloat(inp.value)); };
      worldTab.appendChild(row);
      return row;
    };
    const wtoggle = (label, val, on) => {
      const row = document.createElement("label"); row.className = "trow";
      row.innerHTML = `<span>${label}</span><input type="checkbox" ${val?"checked":""}><em></em>`;
      row.querySelector("input").onchange = (e) => on(e.target.checked);
      worldTab.appendChild(row);
      return row;
    };
    const wrow2 = (label) => { const r = document.createElement("div"); r.className = "trow"; r.innerHTML = `<span>${label}</span>`; worldTab.appendChild(r); return r; };
    const wbtn = (label, title, fn) => { const b = document.createElement("button"); b.textContent = label; b.title = title; b.className = "wrowbtn"; b.onclick = fn; return b; };

    worldTab.innerHTML = "";
    const meta = state.meta || {};
    // 基本信息
    const basic = document.createElement("div"); basic.className = "pp-sub"; basic.textContent = "基本信息"; worldTab.appendChild(basic);
    const nameRow = document.createElement("div"); nameRow.className = "frow"; nameRow.innerHTML = `<label>名字</label><input id="worldName2" class="finput" value="${meta.name || "世界"}" spellcheck="false"/>`;
    worldTab.appendChild(nameRow); const nameInput = nameRow.querySelector("input");
    const descRow = document.createElement("div"); descRow.className = "frow"; descRow.innerHTML = `<label>描述</label><input id="worldDesc" class="finput" value="${meta.description || ""}" spellcheck="false"/>`;
    worldTab.appendChild(descRow); const descInput = descRow.querySelector("input");
    const tagRow = document.createElement("div"); tagRow.className = "frow"; tagRow.innerHTML = `<label>标签</label><input id="worldTags" class="finput" value="${(meta.tags || []).join(", ")}" placeholder="用逗号分隔"/>`;
    worldTab.appendChild(tagRow); const tagInput = tagRow.querySelector("input");

    // 出生点
    const spawnTitle = document.createElement("div"); spawnTitle.className = "pp-sub"; spawnTitle.textContent = "出生点"; worldTab.appendChild(spawnTitle);
    const spawnRow = document.createElement("div"); spawnRow.className = "frow"; spawnRow.innerHTML = `<span class="fval" id="spawnText">未设置</span>`;
    worldTab.appendChild(spawnRow);
    const spawnBtns = document.createElement("div"); spawnBtns.className = "wrowbtn-row"; spawnBtns.appendChild(wbtn("设为当前点为出生点", "spawn", () => {
      const setIt = () => { const p = ctx.pick || renderer.camera.position; state.meta.spawnPoint = [p.x || p.ax, p.y || p.ay, p.z || p.az]; updateSpawnText(); markDirty(); toast("出生点已设置"); };
      // 官方 confirmResetSpawnPoint：已有出生点时先确认覆盖
      if (state.meta.spawnPoint) { if (confirm("已存在出生点，确认覆盖？")) setIt(); } else setIt();
    }));
    spawnBtns.appendChild(wbtn("使用世界中心最高点", "center", () => { const w = world; const sx = Math.floor(w.shape[0]/2), sz = Math.floor(w.shape[2]/2); for (let y=w.shape[1]-1;y>=0;y--) if (w.get(sx,y,sz)) { state.meta.spawnPoint = [sx,y+1,sz]; break; } updateSpawnText(); markDirty(); toast("出生点已设为中心最高点"); }));
    spawnBtns.appendChild(wbtn("清除出生点", "clear", () => { if (!state.meta.spawnPoint) { toast("尚未设置出生点"); return; } state.meta.spawnPoint = null; updateSpawnText(); markDirty(); toast("出生点已清除"); }));
    worldTab.appendChild(spawnBtns);

    // 时间（官方 arena 用 sunPhase 表达昼夜；这里同时写 terrain.dayNight 以便运行模式沿用）
    const timeTitle = document.createElement("div"); timeTitle.className = "pp-sub"; timeTitle.textContent = "时间"; worldTab.appendChild(timeTitle);
    const setTimeOfDay = (v, fromSlider) => {
      state.meta.time = v;
      state.terrain.dayNight = v / 24000;
      const a = ((v / 24000) * 1.25 - 0.12) * Math.PI;
      renderer.setTerrain({ sunDir: [Math.cos(a), Math.sin(a), 0.35] });
      if (!fromSlider) {
        const s = timeRow && timeRow.querySelector("input");
        if (s) { s.value = v; timeRow.querySelector("em").textContent = v; }
      }
      markDirty();
    };
    const timeRow = wslider("时间", 0, 24000, 100, meta.time ?? 6000, (v) => setTimeOfDay(v, true));
    const timeBtns = document.createElement("div"); timeBtns.className = "wrowbtn-row";
    [["黎明", 0], ["正午", 6000], ["黄昏", 12000], ["午夜", 18000]].forEach(([lb, v]) => timeBtns.appendChild(wbtn(lb, "preset", () => { setTimeOfDay(v); toast("时间：" + lb); })));
    worldTab.appendChild(timeBtns);

    // 官方 GameWorld 运行参数（world.gravity / airFriction / useOBB / lightMode / sunFrequency / 雾 / 初始天气）
    const wsTitle = document.createElement("div"); wsTitle.className = "pp-sub"; wsTitle.textContent = "世界运行参数（官方 GameWorld）"; worldTab.appendChild(wsTitle);
    const ws = Object.assign({
      gravity: -0.1, airFriction: 0.001, useOBB: false, lightMode: "natural", sunFrequency: 0.0002,
      fogUniformDensity: 0.004, rainDensity: 0, snowDensity: 0, initialWeather: "clear",
    }, state.meta.worldSettings || {});
    state.meta.worldSettings = ws;
    const wnum = (label, min, max, step, key, fmt) => {
      const row = document.createElement("label"); row.className = "trow";
      row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${ws[key]}"><em>${fmt ? fmt(ws[key]) : ws[key]}</em>`;
      const inp = row.querySelector("input"), em = row.querySelector("em");
      inp.oninput = () => { ws[key] = parseFloat(inp.value); em.textContent = fmt ? fmt(ws[key]) : inp.value; markDirty(); };
      worldTab.appendChild(row);
    };
    wnum("重力 gravity", -0.5, 0.2, 0.005, "gravity");
    wnum("空气摩擦 airFriction", 0, 0.02, 0.0005, "airFriction");
    wnum("雾密度 fogUniformDensity", 0, 0.02, 0.0002, "fogUniformDensity");
    wnum("太阳频率 sunFrequency", 0, 0.002, 0.00002, "sunFrequency", (v) => v.toFixed(5));
    const obbRow = document.createElement("label"); obbRow.className = "trow";
    obbRow.innerHTML = `<span>useOBB（旋转碰撞盒）</span><input type="checkbox" ${ws.useOBB ? "checked" : ""}><em></em>`;
    obbRow.querySelector("input").onchange = (e) => { ws.useOBB = e.target.checked; markDirty(); };
    worldTab.appendChild(obbRow);
    const lmRow = document.createElement("div"); lmRow.className = "frow";
    lmRow.innerHTML = `<label>光照</label><select id="wsLightMode" class="finput">
      <option value="natural">natural（自动昼夜）</option><option value="manual">manual（固定）</option></select>`;
    worldTab.appendChild(lmRow);
    lmRow.querySelector("select").value = ws.lightMode;
    lmRow.querySelector("select").onchange = (e) => { ws.lightMode = e.target.value; markDirty(); };
    const weatherTitle = document.createElement("div"); weatherTitle.className = "pp-sub"; weatherTitle.textContent = "初始天气（运行模式生效）"; worldTab.appendChild(weatherTitle);
    const weatherRow = document.createElement("div"); weatherRow.className = "wrowbtn-row";
    [["晴", "clear"], ["雨", "rain"], ["雪", "snow"], ["雷暴", "thunder"]].forEach(([lb, k]) => {
      const b = wbtn(lb, k, () => {
        ws.initialWeather = k;
        weatherRow.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        state.terrain.weather = k;
        const w = { rain: 0, snow: 0, thunder: 0 };
        if (k === "rain") w.rain = 0.75; else if (k === "snow") w.snow = 0.7; else if (k === "thunder") { w.rain = 0.9; w.thunder = 0.6; }
        renderer.setWeather(w);
        markDirty();
        toast("初始天气：" + lb + "（运行游戏时应用）");
      });
      if (ws.initialWeather === k) b.classList.add("active");
      weatherRow.appendChild(b);
    });
    worldTab.appendChild(weatherRow);
    const wsTip = document.createElement("div"); wsTip.className = "muted";
    wsTip.style.cssText = "padding:6px 10px;font-size:11px;line-height:1.7";
    wsTip.textContent = "以上字段与官方 GameWorld 一一对应，运行模式启动时会写入 world.gravity / world.airFriction / world.useOBB / world.lightMode / world.sunFrequency / world.fogUniformDensity，脚本仍可覆盖。";
    worldTab.appendChild(wsTip);

    // ---------- 区域触发器（官方 world.addZone）----------
    const zTitle = document.createElement("div"); zTitle.className = "pp-sub"; zTitle.textContent = "区域触发器"; worldTab.appendChild(zTitle);
    if (!Array.isArray(state.meta.zones)) state.meta.zones = [];
    const zoneList = document.createElement("div"); zoneList.className = "zonelist"; worldTab.appendChild(zoneList);
    const zoneBtns = document.createElement("div"); zoneBtns.className = "wrowbtn-row"; worldTab.appendChild(zoneBtns);
    const clampSel = (sel) => {
      if (sel && sel.min && sel.max) return { min: [sel.min.x, sel.min.y, sel.min.z], max: [sel.max.x + 1, sel.max.y + 1, sel.max.z + 1] };
      return null;
    };
    zoneBtns.appendChild(wbtn("用当前选区新建", "zone-from-sel", () => {
      const b = clampSel(state.selection);
      if (!b) { toast("先用选区工具框一块区域"); return; }
      state.meta.zones.push({ id: "z" + Date.now().toString(36), name: "区域-" + (state.meta.zones.length + 1), selector: "player", bounds: { min: b.min, max: b.max }, force: [0, 0, 0], massScale: 1, enabled: true });
      renderZones(); markDirty(); toast("已新建区域");
    }));
    zoneBtns.appendChild(wbtn("在指针处新建", "zone-at-pick", () => {
      const p = ctx.pick; if (!p) { toast("先把指针移到世界里"); return; }
      state.meta.zones.push({ id: "z" + Date.now().toString(36), name: "区域-" + (state.meta.zones.length + 1), selector: "player", bounds: { min: [p.x, p.y, p.z], max: [p.x + 4, p.y + 4, p.z + 4] }, force: [0, 0, 0], massScale: 1, enabled: true });
      renderZones(); markDirty(); toast("已新建 4×4×4 区域");
    }));
    function zrow(label, val, step, cb) {
      const r = document.createElement("label"); r.className = "zrow";
      const s = document.createElement("span"); s.textContent = label;
      const i = document.createElement("input"); i.type = "number"; i.step = step || "0.05"; i.value = val;
      i.onchange = () => cb(parseFloat(i.value) || 0);
      r.appendChild(s); r.appendChild(i); return r;
    }
    function renderZones() {
      zoneList.innerHTML = "";
      const zs = state.meta.zones;
      if (!zs.length) {
        const e = document.createElement("div"); e.className = "muted"; e.style.cssText = "padding:6px 10px;font-size:11.5px";
        e.textContent = "还没有区域。框一段选区或把指针移到世界里，再点上面的按钮新建。"; zoneList.appendChild(e);
      }
      zs.forEach((z, i) => {
        const box = document.createElement("div"); box.className = "zitem";
        const head = document.createElement("div"); head.className = "zhead";
        const nm = document.createElement("input"); nm.type = "text"; nm.value = z.name || ("区域-" + (i + 1)); nm.className = "zname";
        nm.onchange = () => { z.name = nm.value; markDirty(); };
        const on = document.createElement("input"); on.type = "checkbox"; on.checked = z.enabled !== false;
        on.onchange = () => { z.enabled = on.checked; renderZones(); markDirty(); };
        const loc = document.createElement("button"); loc.textContent = "定位"; loc.title = "镜头移到该区域";
        loc.onclick = () => { const bb = z.bounds || z; renderer.controls.target.set((bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2); renderer.controls.update(); };
        const del = document.createElement("button"); del.textContent = "删除"; del.className = "zdel";
        del.onclick = () => { zs.splice(i, 1); renderZones(); markDirty(); toast("已删除区域"); };
        head.appendChild(on); head.appendChild(nm); head.appendChild(loc); head.appendChild(del);
        box.appendChild(head);
        const sel = document.createElement("label"); sel.className = "zrow";
        const slab = document.createElement("span"); slab.textContent = "选择器";
        const sin = document.createElement("input"); sin.type = "text"; sin.value = z.selector || "player"; sin.title = "官方 selector：player / #名字 / .标签 / entity";
        sin.onchange = () => { z.selector = sin.value.trim() || "player"; markDirty(); };
        sel.appendChild(slab); sel.appendChild(sin); box.appendChild(sel);
        ["min", "max"].forEach((k) => {
          const row = document.createElement("div"); row.className = "ztriple";
          const b = z.bounds || { min: z.min, max: z.max };
          ["X", "Y", "Z"].forEach((ax, ai) => {
            const i2 = document.createElement("input"); i2.type = "number"; i2.step = "1"; i2.value = b[k][ai];
            i2.title = k + " " + ax;
            i2.onchange = () => {
              // 官方形状是 bounds:{min,max}；写入时迁成该形状，旧的扁平 min/max 一并清掉
              const cur = z.bounds || { min: (z.min || [0, 0, 0]).slice(), max: (z.max || [4, 4, 4]).slice() };
              cur[k] = cur[k].slice(); cur[k][ai] = Math.round(parseFloat(i2.value) || 0);
              z.bounds = cur; delete z.min; delete z.max;
              renderZones(); markDirty();
            };
            const lab = document.createElement("em"); lab.textContent = ax;
            row.appendChild(lab); row.appendChild(i2);
          });
          box.appendChild(row);
        });
        const f = z.force || [0, 0, 0];
        ["X", "Y", "Z"].forEach((ax, ai) => box.appendChild(zrow("力 " + ax, f[ai], "0.01", (v) => { z.force[ai] = v; markDirty(); })));
        box.appendChild(zrow("massScale", z.massScale ?? 1, "0.1", (v) => { z.massScale = v; markDirty(); }));
        // 官方区域可覆盖环境（fog* / rain* / snow* / sky*），运行时按前缀透传后生效
        const zkey = (label, key, step, kind) => {
          kind = kind || "num";
          const row = document.createElement("div"); row.className = "zrow";
          const lab = document.createElement("span"); lab.textContent = label; row.appendChild(lab);
          if (kind === "bool") {
            const i2 = document.createElement("input"); i2.type = "checkbox"; i2.checked = z[key] !== false;
            i2.onchange = () => { z[key] = i2.checked; markDirty(); };
            row.appendChild(i2);
          } else if (kind === "mode") {
            const s = document.createElement("select");
            [["natural", "自然"], ["manual", "手动"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if ((z[key] || "natural") === v) o.selected = true; s.appendChild(o); });
            s.onchange = () => { z[key] = s.value; markDirty(); };
            row.appendChild(s);
          } else if (kind === "num" || kind === "text") {
            const i2 = document.createElement("input");
            if (kind === "num") { i2.type = "number"; i2.step = step; i2.value = +z[key] || 0; }
            else { i2.type = "text"; i2.value = z[key] || ""; }
            i2.onchange = () => { z[key] = kind === "num" ? (parseFloat(i2.value) || 0) : i2.value; markDirty(); };
            row.appendChild(i2);
          } else {
            const wrap = document.createElement("div"); wrap.className = "ztriple"; wrap.style.margin = "0";
            const names = kind === "color" ? ["r", "g", "b"] : kind === "colora" ? ["r", "g", "b", "a"] : ["x", "y", "z"];
            const cur = kind === "vec" ? (z[key] || [0, 0, 0]) : Object.assign({ r: 0, g: 0, b: 0, a: 1 }, z[key] || {});
            names.forEach((nm, ni) => {
              const i2 = document.createElement("input"); i2.type = "number"; i2.step = step;
              i2.value = kind === "vec" ? (cur[ni] || 0) : (cur[nm] || 0);
              const em = document.createElement("em"); em.textContent = nm;
              i2.onchange = () => {
                const v = parseFloat(i2.value) || 0;
                if (kind === "vec") { const a = (z[key] || [0, 0, 0]).slice(); a[ni] = v; z[key] = a; }
                else { const o = Object.assign({ r: 0, g: 0, b: 0, a: 1 }, z[key] || {}); o[nm] = v; z[key] = o; }
                markDirty();
              };
              wrap.appendChild(em); wrap.appendChild(i2);
            });
            row.appendChild(wrap);
          }
          return row;
        };
        const group = (title, entries) => {
          const d = document.createElement("details"); d.className = "zgroup";
          const s = document.createElement("summary"); s.textContent = title; d.appendChild(s);
          for (const e of entries) { const r = zkey(e[0], e[1], e[2], e[3]); if (r) d.appendChild(r); }
          box.appendChild(d);
        };
        group("雾覆盖（fog*）", [["启用", "fogEnabled", "", "bool"], ["雾色", "fogColor", "0.05", "color"], ["起始距离", "fogStartDistance", "1"], ["高度偏移", "fogHeightOffset", "1"], ["高度衰减", "fogHeightFalloff", "0.05"], ["密度", "fogDensity", "0.001"], ["最大雾", "fogMax", "0.05"]]);
        group("雨覆盖（rain*）", [["启用", "rainEnabled", "", "bool"], ["密度", "rainDensity", "0.05"], ["速度", "rainSpeed", "0.5"], ["尺寸小", "rainSizeLo", "0.01"], ["尺寸大", "rainSizeHi", "0.01"], ["干扰", "rainInterference", "0.01"], ["颜色", "rainColor", "0.05", "colora"], ["方向", "rainDirection", "0.05", "vec"]]);
        group("雪覆盖（snow*）", [["启用", "snowEnabled", "", "bool"], ["密度", "snowDensity", "0.05"], ["尺寸小", "snowSizeLo", "0.01"], ["尺寸大", "snowSizeHi", "0.01"], ["下落速度", "snowFallSpeed", "0.1"], ["旋转速度", "snowSpinSpeed", "0.1"], ["颜色", "snowColor", "0.05", "colora"], ["纹理", "snowTexture", "", "text"]]);
        group("天光覆盖（sky*）", [["启用", "skyEnabled", "", "bool"], ["模式", "skyMode", "", "mode"], ["太阳相位", "skySunPhase", "0.01"], ["日轮频率", "skySunFrequency", "0.0001"], ["月相", "skyLunarPhase", "0.01"], ["太阳方向", "skySunDirection", "0.05", "vec"], ["日光", "skySunLight", "0.05", "color"], ["天顶光", "skyTopLight", "0.05", "color"], ["天底光", "skyBottomLight", "0.05", "color"], ["左侧光", "skyLeftLight", "0.05", "color"], ["右侧光", "skyRightLight", "0.05", "color"], ["前侧光", "skyFrontLight", "0.05", "color"], ["后侧光", "skyBackLight", "0.05", "color"]]);
        const tip = document.createElement("div"); tip.className = "zhint";
        tip.textContent = "massScale=0 像重力（与质量无关），1 像风（力除以质量）。";
        box.appendChild(tip);
        zoneList.appendChild(box);
      });
      renderer.setZones && renderer.setZones(zs.filter((z) => z.enabled !== false));
    }
    renderZones();
    api.renderZones = renderZones;

    function updateSpawnText() {
      const s = state.meta.spawnPoint; document.getElementById("spawnText").textContent = s ? `X ${s[0]}  Y ${s[1]}  Z ${s[2]}` : "未设置";
    }
    updateSpawnText();
    // 输入同步
    ["worldName2","worldDesc","worldTags"].forEach((id) => { const el = document.getElementById(id); if (el) el.onchange = () => markDirty(); });
    nameInput.onchange = (e) => { state.meta.name = e.target.value; document.getElementById("worldName").value = e.target.value; markDirty(); };
    descInput.onchange = (e) => { state.meta.description = e.target.value; markDirty(); };
    tagInput.onchange = (e) => { state.meta.tags = e.target.value.split(/[,，]/).map((s)=>s.trim()).filter(Boolean); markDirty(); };

    // 游戏规则（官方 gameRules）
    const grTitle = document.createElement("div"); grTitle.className = "pp-sub"; grTitle.textContent = "游戏规则（gameRules）"; worldTab.appendChild(grTitle);
    const gr = () => (state.meta.gameRules = state.meta.gameRules || {});
    const grRow = (label, key, val) => wtoggle(label, val, (v) => { gr()[key] = v; markDirty(); toast(label + "：" + (v ? "开" : "关")); });
    grRow("昼夜更替", "doDaylightCycle", gr().doDaylightCycle !== false);
    grRow("天气轮转", "doWeatherCycle", gr().doWeatherCycle !== false);
    grRow("死亡立即重生", "doImmediateRespawn", gr().doImmediateRespawn !== false);
    const grNote = document.createElement("div");
    grNote.style.cssText = "padding:6px 10px 10px;font-size:11px;line-height:1.7;color:var(--font-black-minor)";
    grNote.textContent = "keepInventory / doMobSpawning 本地没有背包与生物系统，仅作为脚本可读的开关保留；脚本可用 world.setGameRule(name, value) 运行时修改。";
    worldTab.appendChild(grNote);
  }

  // ---------- logo 文件菜单 ----------
  const fileMenu = document.createElement("div");
  fileMenu.className = "worldlist"; fileMenu.style.right = "auto"; fileMenu.style.left = "0"; fileMenu.style.top = "44px";
  [["返回主界面", () => $("btnHome").click()],
   ["新建世界", () => window.__openSizeModal && window.__openSizeModal()], ["保存 (Ctrl+S)", save],
   ["导入项目包 (.zip)", () => pickFile(".zip", async (f) => { await importProject(f); })],
   ["导出项目包 (.zip) 全部内容", () => io.exportProjectZip({ world, state }).then((r) => toast(`已导出 ${r.entries} 个文件 · ${(r.bytes / 1048576).toFixed(1)} MB`))],
   ["导入 .gz 地图", () => pickFile(".gz,.json", async (f) => replace(await io.importGz(f, atlas)))],
   ["导入 .vox", () => pickFile(".vox", async (f) => replace(await io.importVox(f, atlas)))], ["导出 .gz", () => io.exportGz(world, { ...state.meta, terrain: state.terrain })],
   ["导出 .vox", () => io.exportVox(world, atlas)], ["导出 .glb", () => io.exportGlb(renderer, state.meta)],
   ["游玩手册（键位与玩法）", () => window.open("/manual", "_blank", "noopener")],
   ["免责声明", () => (window.__showDisclaimer ? window.__showDisclaimer() : null)]].forEach(([label, fn]) => {
    const b = document.createElement("button"); b.className = "witem"; b.style.textAlign = "left"; b.innerHTML = `<b>${label}</b>`; b.onclick = () => { fileMenu.classList.remove("show"); fn(); };
    fileMenu.appendChild(b);
  });
  $("topbar").querySelector(".tb-left").appendChild(fileMenu);
  $("menuLogo").onclick = (e) => { e.stopPropagation(); fileMenu.classList.toggle("show"); };
  document.addEventListener("click", () => fileMenu.classList.remove("show"));
  function replace(w) { if (window.__replaceWorld) window.__replaceWorld(w); toast("已载入"); }

  // ---------- 返回主界面 ----------
  // 编辑器是 /edit/<id> 深链接，浏览器"后退"会退回工作台列表项之前的状态，
  // 而且未保存的改动会直接丢——所以先补存档再走。
  $("btnHome").onclick = async () => {
    if (window.__game && window.__game.running && stopPlay) stopPlay();
    if (state.dirty) { await save(); }
    location.href = "/";
  };

  // ---------- 游玩手册 ----------
  // 新标签页打开：编辑器里有未保存改动，跳走会打断手上的活
  const bm = $("btnManual");
  if (bm) bm.onclick = () => window.open("/manual", "_blank", "noopener");

  // ---------- 世界库 ----------
  $("btnWorlds").onclick = async (e) => {
    e.stopPropagation();
    const ws = await io.apiListWorlds(); const list = $("worldList"); list.innerHTML = ""; list.classList.toggle("show");
    for (const w of ws) {
      const it = document.createElement("button"); it.className = "witem";
      it.innerHTML = `<b>${w.name}</b><span>${w.blockCount} 体素 · ${new Date(w.mtime).toLocaleDateString()}</span><span class="wdel" title="删除该世界">×</span>`;
      it.onclick = () => { location.href = "/edit/" + w.id; };
      it.querySelector(".wdel").onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm(`确定删除「${w.name}」？此操作不可恢复。`)) return;
        if (await io.apiDeleteWorld(w.id)) { it.remove(); toast("已删除世界"); }
        else toast("删除失败");
      };
      list.appendChild(it);
    }
  };
  // 顶部 ▶ 由 main.js 绑定为「运行游戏」；这里只负责世界名输入与保存状态
  $("worldName").onchange = (e) => { state.meta.name = e.target.value; $("saveState").textContent = "● 未保存"; };
  api.setWorldName = (n) => { $("worldName").value = n; };
  // 「基本」tab 的添加标签 → 真的写入 meta.tags
  const ftag = document.querySelector(".ftag");
  if (ftag) ftag.onclick = () => {
    const v = prompt("世界标签（逗号分隔）", (state.meta.tags || []).join(", "));
    if (v === null) return;
    state.meta.tags = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    ftag.textContent = state.meta.tags.length ? state.meta.tags.join(" / ") : "添加标签";
    markDirty();
  };
  if (state.meta && state.meta.tags && state.meta.tags.length && ftag) ftag.textContent = state.meta.tags.join(" / ");

  /* ---------- 全局按钮接线（消灭无响应按钮） ---------- */
  // 设置 → 定位到右侧「属性 → 世界」
  const st = $("btnSettings");
  if (st) st.onclick = () => {
    document.querySelector('.pp-ico[data-tab="world"]')?.click();
    toast("世界设置：右侧 属性 → 世界（名字/出生点/时间/规则）");
  };
  // 协作 / 反馈（本地单机版如实提示，不再无响应）
  document.querySelectorAll("#topbar .tb-ico").forEach((b) => {
    const t = b.title || "";
    if (t === "协作" || t === "反馈") b.onclick = () => toast(t + "：本地单机版暂未开放");
  });
  // 左上「＋ 添加」→ 聚焦搜索
  const lcAddBtn = $("lcAdd");
  if (lcAddBtn) lcAddBtn.onclick = () => { search.focus(); toast("点击下方方块即可选中建造"); };
  // 右侧导览：模型 / 界面 tab + 搜索过滤
  const hierarchy = $("hierarchy");
  const rpTabs = document.querySelectorAll("#rightPanel .rp-tabs button");
  const treeSearch = $("treeSearch");
  function renderUiTab() {
    hierarchy.innerHTML = "";
    const note = document.createElement("div");
    note.className = "muted"; note.style.cssText = "padding:10px;line-height:1.7;font-size:12px";
    note.innerHTML = "界面编辑器完整复刻规划中。<br>运行模式下可先用脚本控制界面：<br><code>world.say('文本')</code> · <code>player.title({...})</code> · <code>player.dialog({...})</code>";
    hierarchy.appendChild(note);
  }
  if (rpTabs.length >= 2) {
    rpTabs.forEach((t) => {
      t.onclick = () => {
        rpTabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        if (t.dataset.rp === "ui") renderUiTab();
        else { renderTree(); }
      };
    });
  }
  if (treeSearch) treeSearch.oninput = () => {
    // 确保在模型 tab 下搜索
    const q = (treeSearch.value || "").trim().toLowerCase();
    if (rpTabs.length >= 2 && rpTabs[0].dataset.rp === "model" && !rpTabs[0].classList.contains("active")) rpTabs[0].click();
    hierarchy.querySelectorAll(".tnode.child").forEach((it) => {
      it.style.display = !q || it.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };
  api.refreshTree = renderTree;
  return api;
}

function hex(n) { return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6); }
function catName(c) { return CAT_ZH[c] || c; }
function pickFile(accept, cb) { const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept; inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); }; inp.click(); }
