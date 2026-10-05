// features.js — 地图尺寸、多文件脚本、实体生成、模型库、zip 项目包导入、运行接线。
import * as THREE from "../vendor/three/three.module.js";
import { VoxelWorld } from "./world.js";
import { authorColor } from "./diff.js";
import { generate as genTerrain, PRESETS, presetById } from "./terrain.js";
import * as io from "./io.js";
import { wireScriptAi } from "./ai-script.js";
import { wireScriptIde } from "./script-ide.js";
import { wireComplete } from "./complete.js";
import { wirePalette } from "./palette.js";
import { wirePanels } from "./panels.js";
import { wireConsole, pushConsole, clearConsole } from "./console.js";
import { wireViewGizmo } from "./view-gizmo.js";
import { wireHistoryPanel } from "./history-panel.js";
import { wireScrub } from "./scrub.js";
import { wireGizmo } from "./gizmo.js";
import { openAgent } from "./ai-agent.js";
import { initPack } from "./pack.js";
import { CHECK_GROUPS, TS_ONLY_NOTE } from "./lint.js";
import { vbToVoxList } from "./vb.js";
import { applyDefaultPlayerSounds } from "./gapi.js";

let E; // window.__editor 引用
// 实体标记盒的共享资源（见 addEntityMarker）
let MARKER_GEO = null, MARKER_EDGE = null, MARKER_FILL = null, MARKER_FILL_FAINT = null, MARKER_LINE = null;

export function initFeatures(editor) {
  E = editor;
  wireTopMenu();
  wireSizeModal();
  wireTerrainModal();
  wireScript();
  wireScriptAi(editor);
  wireScriptIde(editor);
  wirePalette(editor);
  wirePanels(editor);
  wireConsole(editor);
  wireViewGizmo(editor);
  wireHistoryPanel(editor);
  wireScrub();
  editor.gizmo = wireGizmo(editor);
  editor.frameSelected = frameSelected;
  wireStatusBar();
  wireAgentBtn(editor);
  wireModels();
  wirePlayer();
  wireUiEditor();
  initPack(E);                      // 代码包 tab
  wireStore();
}

/* ------------------------------ 状态栏 ------------------------------ */
const MODE_ZH = { build: "搭建", model: "模型", script: "脚本", ui: "界面", store: "商城", pack: "代码包" };

/** 底部那条读数带。
 *  刷新走轮询而不是在每个改动点补一次 update()：改动点会随功能一起长，
 *  逐个埋点必然漏掉后来新增的那个，而漏掉的表征恰好就是这条要修的 bug 本身
 *  ——读数停在旧值，看起来像"状态栏坏了"。250ms 读现值，代价是最坏晚半拍。
 *  set() 只在值真的变了才写 DOM，所以这个轮询不会引起重排。 */
function wireStatusBar() {
  const el = (id) => document.getElementById(id);
  const nodes = { tool: el("sbTool"), mode: el("sbMode"), sel: el("sbSel"), world: el("sbWorld"), diag: el("sbDiag"), save: el("sbSave") };
  if (!nodes.tool) return;
  const last = {};
  const set = (k, v) => { if (last[k] !== v) { last[k] = v; nodes[k].textContent = v; } };
  const flag = (k, cls, on) => { if (nodes[k].classList.contains(cls) !== on) nodes[k].classList.toggle(cls, on); };
  nodes.diag.onclick = () => E.ideStep?.(1);
  setInterval(() => {
    if (document.body.classList.contains("playing")) return;   // 运行时整条收起，没必要算
    // 必须限定 [data-tool]：网格/边缘线这些视图开关也是 .ft.active，
    // 不限定的话"当前工具"会在没选中工具时显示成"网格"。
    const ft = document.querySelector("#editToolbar .ft[data-tool].active");
    set("tool", ft ? (ft.title || "").replace(/\s*\([^)]*\)\s*$/, "") : "未选工具");
    set("mode", MODE_ZH[(E.ctx || {}).mode] || "—");
    const s = E.state.selection;
    nodes.sel.hidden = !s;
    if (s) set("sel", `选区 ${s.max.x - s.min.x + 1}×${s.max.y - s.min.y + 1}×${s.max.z - s.min.z + 1}`);
    set("world", (E.state.meta || {}).name || "未命名");
    const d = E.ideDiags ? E.ideDiags() : [];
    const n = (sev) => d.filter((x) => x.sev === sev).length;
    const err = n("error"), warn = n("warn");
    set("diag", d.length ? [err && `${err} 错误`, warn && `${warn} 警告`, n("info") && `${n("info")} 提示`].filter(Boolean).join(" · ") : "无问题");
    flag("diag", "err", !!err); flag("diag", "warn", !err && !!warn);
    if (last.diagTitle !== d.length) {
      last.diagTitle = d.length;
      nodes.diag.title = d.length
        ? d.slice(0, 5).map((x) => `第 ${x.line >= 1 ? x.line : "—"} 行 · ${x.rule}：${x.msg}`).join("\n") + (d.length > 5 ? `\n…共 ${d.length} 条` : "")
        : "脚本没有发现问题";
    }
    // 存盘状态以顶栏那个节点为准：写它的地方有手动保存、自动保存、加载世界三处，
    // 这里再自己判一次 dirty 就会和顶栏对不上。
    const sv = el("saveState");
    if (sv) set("save", sv.textContent || "");
    nodes.save.hidden = !(E.state.dirty || (sv && sv.textContent));
  }, 250);
}

/* ------------------------------ 顶部菜单模式 ------------------------------ */
function wireTopMenu() {
  const tabs = document.querySelectorAll(".mtab");
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => x.classList.remove("active")); t.classList.add("active");
      const m = t.dataset.menu;
      const libCard = document.getElementById("libCard");
      const modelPanel = document.getElementById("modelPanel");
      const scriptScreen = document.getElementById("scriptScreen");
      const uiScreen = document.getElementById("uiScreen");
      const playerPanel = document.getElementById("playerPanel");
      const packScreen = document.getElementById("packScreen");
      // 每个全屏页都得在这里关掉。以前少列了 storeScreen，于是开过商城之后
      // 点「界面」，看到的还是商城那张盖在上面的页——像界面坏了，其实只是没关。
      for (const el of [scriptScreen, uiScreen, playerPanel, packScreen, document.getElementById("storeScreen"), modelPanel]) {
        if (el) el.classList.remove("show");
      }
      libCard.style.display = "block";
      E.ctx.mode = "build";
      if (m === "model") { libCard.style.display = "none"; modelPanel.classList.add("show"); E.ctx.mode = "model"; }
      else if (m === "script") { libCard.style.display = "none"; scriptScreen.classList.add("show"); E.ctx.mode = "script"; if (E.showScriptScreen) E.showScriptScreen(true); }
      else if (m === "ui") { document.getElementById("uiScreen").classList.add("show"); E.ctx.mode = "ui"; document.getElementById("uiPalette")?.classList.add("show"); if (E.renderUiEditor) E.renderUiEditor(); }
      else if (m === "player") {
        // 官方是「一个弹窗 + 左栏三节」，不是一个孤立属性遮罩。
        // 弹窗没接上时（模块加载失败）退回老遮罩，至少玩家改不了属性这种事不会发生。
        if (E.openPlayerModal) E.openPlayerModal().catch(() => playerPanel.classList.add("show"));
        else playerPanel.classList.add("show");
      }
      else if (m === "store") { document.getElementById("storeScreen").classList.add("show"); document.getElementById("libCard").style.display = "none"; E.ctx.mode = "store"; if (E.renderStore) E.renderStore(); }
      // 代码包是纯文件视图，不抢 3D 视口的 mode：开着它也能看见世界
      else if (m === "pack") {
        packScreen?.classList.add("show");
        libCard.style.display = "none";
        if (E.renderPack) E.renderPack();
        const bi = document.getElementById("packIndex");
        if (bi) { bi.hidden = !(E.state.meta.assetsCid && !E.state.meta.assetIndex); bi.onclick = () => E.packLoadIndex && E.packLoadIndex(); }
      }
    };
  });
}

/** 就地重生成地形：只换体素，**不动**实体、脚本、区域、商品与出生点。
 *  与 createWorld 的区别就在这里——新建地图必须连带清掉绑在旧地形上的一切
 *  （见 createWorld 里那段注释），而"换个地貌"是作者想在同一张图上迭代，
 *  清掉反而毁掉他的作品。 */
export function regenerateTerrain(opts = {}) {
  const e = E;
  const p = presetById(opts.preset);
  const [X, Y, Z] = e.world.shape;
  const before = e.world.size();
  // 故意不接进撤销栈：整张图重生成动辄上百万格 diff，塞进 200 深的栈会把内存吃穿，
  // 而 History.commit 还会再应用一遍。改成"生成前确认 + 明确说明不可撤销"。
  const stats = genTerrain(e.world, { atlas: e.atlas, clear: true, ...opts });
  e.state.dirty = true;
  e.renderer.rebuildAll();          // 整张地形换了，逐块 markDirty 不现实
  e.updateStatus && e.updateStatus();
  e.markDirty && e.markDirty();
  e.toast(`已生成${p.name}：${before.toLocaleString()} → ${stats.cells.toLocaleString()} 格，`
    + `海拔 ${stats.min}~${stats.max}，水面 ${stats.wetPct}% 面积（${stats.water.toLocaleString()} 格），`
    + `树 ${stats.trees} 棵（此操作不进撤销栈）`);
  return stats;
}

/* ------------------------------ 地图尺寸选择 ------------------------------ */
let genMode = "flat";
/** 水位滑杆：默认跟随地貌预设的 flood，取消「按地貌」才手动指定水面占比。
 *  「新建世界」与「生成地形」两个入口共用，只是 id 前缀不同（tn / tm）。
 *  返回一个 getter：undefined = 用预设值，不要把 0 当成"没设"——沙丘就是要 0。 */
function wireFloodControl(prefix, presetSel) {
  const auto = document.getElementById(prefix + "FloodAuto");
  const slider = document.getElementById(prefix + "Flood");
  const label = document.getElementById(prefix + "FloodV");
  if (!auto || !slider || !label || !presetSel) return () => undefined;
  const current = () => (auto.checked ? presetById(presetSel.value).flood : Number(slider.value) / 100);
  const sync = () => {
    slider.disabled = auto.checked;
    label.textContent = Math.round(current() * 100) + "%";
  };
  auto.onchange = sync;
  slider.oninput = sync;
  presetSel.addEventListener("change", sync);
  sync();
  return () => (auto.checked ? undefined : Number(slider.value) / 100);
}
function wireTerrainModal() {
  const modal = document.getElementById("terrainModal");
  if (!modal) return;
  const sel = document.getElementById("tmPreset");
  if (sel && !sel.options.length) {
    for (const p of PRESETS) {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name + " — " + p.desc;
      sel.appendChild(o);
    }
    sel.value = "hills";
  }
  const amp = document.getElementById("tmAmp");
  if (amp) amp.oninput = () => { document.getElementById("tmAmpV").textContent = Number(amp.value).toFixed(2); };
  const floodOf = wireFloodControl("tm", sel);
  window.__openTerrainModal = () => modal.classList.add("show");
  document.getElementById("tmCancel").onclick = () => modal.classList.remove("show");
  document.getElementById("tmOk").onclick = () => {
    modal.classList.remove("show");
    regenerateTerrain({
      preset: sel.value,
      seed: Number(document.getElementById("tmSeed").value) || 1,
      amplitude: Number(amp.value),
      flood: floodOf(),
      trees: document.getElementById("tmTrees").checked,
    });
  };
}
function wireSizeModal() {
  const modal = document.getElementById("sizeModal");
  const presets = document.getElementById("sizePresets");
  presets.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      presets.querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      const [x, z] = b.dataset.s.split(",").map(Number);
      document.getElementById("szX").value = x; document.getElementById("szZ").value = z;
    };
  });
  const tnPreset = document.getElementById("tnPreset");
  if (tnPreset && !tnPreset.options.length) {
    for (const p of PRESETS) {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name + " — " + p.desc;
      tnPreset.appendChild(o);
    }
    tnPreset.value = "hills";
  }
  const amp = document.getElementById("tnAmp"), ampV = document.getElementById("tnAmpV");
  if (amp) amp.oninput = () => { ampV.textContent = Number(amp.value).toFixed(2); };
  const tnFloodOf = wireFloodControl("tn", tnPreset);
  document.querySelectorAll("#genMode button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#genMode button").forEach((x) => x.classList.remove("active")); b.classList.add("active");
      genMode = b.dataset.mode;
      document.getElementById("thickWrap").style.display = genMode === "flat" ? "flex" : "none";
      const tw = document.getElementById("terrainWrap");
      if (tw) tw.style.display = genMode === "terrain" ? "flex" : "none";
    };
  });
  window.__openSizeModal = () => modal.classList.add("show");
  document.getElementById("sizeCancel").onclick = () => modal.classList.remove("show");
  document.getElementById("sizeOk").onclick = () => {
    const X = clampI(document.getElementById("szX").value, 8, 256);
    const Z = clampI(document.getElementById("szZ").value, 8, 256);
    const Y = clampI(document.getElementById("szY").value, 8, 128);
    const T = clampI(document.getElementById("szT").value, 1, 64);
    modal.classList.remove("show");
    createWorld(genMode, X, Y, Z, T, null, {
      preset: tnPreset ? tnPreset.value : "hills",
      seed: document.getElementById("tnSeed") ? Number(document.getElementById("tnSeed").value) || 1 : 1,
      amplitude: amp ? Number(amp.value) : 1,
      flood: tnFloodOf(),
    });
  };
}
export function createWorld(mode, X, Y, Z, T, name, genOpts) {
  const e = E, atlas = e.atlas;
  const w = new VoxelWorld([X, Y, Z]);
  E._lastGen = null;   // 上一张图的地形统计不能算到这张头上
  const id = (n) => (atlas.get(n) ? atlas.get(n).id : 0);
  const GRASS = id("grass"), DIRT = id("dirt"), STONE = id("stone");
  if (mode === "flat") {
    for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++) for (let y = 0; y < T; y++) {
      w.set(x, y, z, y === T - 1 ? GRASS : y >= T - 3 ? DIRT : STONE);
    }
  } else if (mode === "demo") {
    const h = (x, z) => Math.round(6 + 5 * Math.sin(x / 7) * Math.cos(z / 8) + 3 * Math.sin((x + z) / 5));
    for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++) {
      const top = Math.max(1, Math.min(Y - 8, h(x, z)));
      for (let y = 0; y <= top; y++) w.set(x, y, z, y === top ? GRASS : y > top - 3 ? DIRT : STONE);
    }
  } else if (mode === "terrain") {
    // 程序化生成：确定性噪声，同 seed 同结果（见 terrain.js）
    E._lastGen = genTerrain(w, { atlas, ...(genOpts || {}) });
  }
  const auto = mode === "flat" ? `超平坦 ${X}×${Z} 厚${T}` : mode === "demo" ? `示例地形 ${X}×${Z}`
    : mode === "terrain" ? `${(presetById((genOpts || {}).preset) || {}).name || "程序化"} ${(genOpts || {}).seed || ""} ${X}×${Z}`
    : `空白 ${X}×${Y}×${Z}`;
  // 换地形 = 换地图。出生点、实体、场景模型、区域、商品都是绑在旧地形坐标上的，
  // 留着会把玩家丢到新边界外（掉虚空），并把旧地图的 199 个检查点撒进新图。
  const m = e.state.meta;
  m.spawnPoint = null;
  m.entities = [];
  m.models = [];
  m.groups = [];
  m.zones = [];
  m.products = [];
  // 脚本同样是**这张图**的。赛车模板的 index.js 里有 entity.player.jumpPower = 0
  // （官方把跳跃键改成了吃加速道具），漏清会让每一张新建地图都不能跳；
  // 它 onTick 还按 checkPoints[0].bounds 取检查点，新图没有那些实体，
  // 于是每 tick 抛一次 TypeError。素材引用（meshNames/assetRoot/ui）指向的也是旧图。
  m.scripts = [];
  m.meshNames = [];
  delete m.assetRoot;
  m.ui = [];
  if (window.__game) window.__game.spawnPoint = null; // enterPlay 用的是 meta||旧值，两边都要清
  // _applyPlayerMeta 在 _createPlayer 之后跑，initialPosition 会把出生点再次拽回旧坐标，
  // 所以只删位置，玩家的速度/镜头/音效等配置保留。
  if (m.player) { delete m.player.initialPosition; delete m.player.initialYaw; }
  e.state.entities = [];
  e.state.models = [];
  e.state.scripts = [];
  // 脚本面板选中的下标是编辑器状态，地图换了它就是悬空引用；
  // 文件列表也要立刻重画，否则屏幕上还挂着上一张图的 index.js
  e.__scriptIdx = null;
  renderScriptFiles();
  e.state.meta = Object.assign({}, e.state.meta, { name: name || auto, terrain: e.state.terrain, created: Date.now() });
  if (window.__replaceWorld) window.__replaceWorld(w);
  const g = E._lastGen;
  e.toast("已生成 " + auto + (g ? `，水面 ${g.wetPct}% 面积，树 ${g.trees} 棵` : ""));
}
function clampI(v, a, b) { return Math.max(a, Math.min(b, Math.round(Number(v) || a))); }
function clampF(v, a, b) { return Math.max(a, Math.min(b, Number(v))); }

/* ------------------------------ 多文件脚本面板 ------------------------------ */
// 示例脚本：沙箱（▶ 运行）演示用 sb；游戏模式（▶ 运行游戏）自动切换为官方 GameAPI。
// 只新增方块、不调用 sb.clear()，避免把已生成的地图清空。
export const DEFAULT_SCRIPT = `// 脚本支持两种运行方式：
//  - 沙箱运行（编辑器 ▶ 按钮）：操作 sb 方块对象，立即看到结果
//  - 游戏运行（顶部 ▶ 运行游戏）：完整官方 GameAPI（world / entity / player / 天气）
if (typeof sb !== "undefined") {
  sb.box([8,1,8],[14,4,14], "stone");
  sb.sphere([12,8,12], 3, "green_leaf");
  sb.log("完成，共 "+sb.count()+" 个体素");
} else {
  world.say("欢迎来到 " + world.projectName + "！按 E 与实体互动，天气可用脚本控制。");
  world.onTick(() => {});
}`;

/** 检查严格度：面板 + 存到 meta.scriptChecks，供 build.check 与 AI 规范注入读取。 */
export function scriptChecks(E) {
  const m = E.state.meta;
  return (m.scriptChecks = m.scriptChecks || { enabled: true, strictNullChecks: true, noUnusedLocals: false, readonlyApi: true });
}
function wireScriptChecks() {
  const e = E, host = document.querySelector("#scriptScreen .ss-files");
  if (!host || document.getElementById("scPanel")) return;
  const cfg = scriptChecks(e);
  const box = document.createElement("div");
  box.id = "scPanel"; box.className = "sc-panel";
  const head = document.createElement("button");
  head.className = "sc-head";
  head.innerHTML = "<span>检查严格度(BETA)</span><i>▾</i>";
  head.onclick = () => box.classList.toggle("is-closed");
  box.appendChild(head);
  for (const g of CHECK_GROUPS) {
    const t = document.createElement("div"); t.className = "sc-sub"; t.textContent = g.title;
    box.appendChild(t);
    for (const it of g.items) {
      const row = document.createElement("label");
      row.className = "sc-row" + (it.tsOnly ? " off" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = it.tsOnly ? false : !!cfg[it.key];
      cb.disabled = !!it.tsOnly;
      // 说明收进悬停：每一项下面都挂一行小字，面板就成了一页说明书。
      // tsOnly 那两项留一个短标记而不是整句"点了也不会生效"——灰掉 + TS 已经说清了。
      const txt = document.createElement("span");
      txt.innerHTML = `<b></b>${it.tsOnly ? '<em class="sc-tag">TS</em>' : ""}`;
      txt.querySelector("b").textContent = it.label;
      row.title = it.tsOnly ? TS_ONLY_NOTE : (it.hint || "");
      row.append(cb, txt);
      cb.onchange = () => { cfg[it.key] = cb.checked; e.markDirty(); e.toast(it.label + "：" + (cb.checked ? "开" : "关")); };
      box.appendChild(row);
    }
  }
  host.appendChild(box);
}

/** 脚本控制台默认收成一条标题，来内容就自己展开。
 *  原来它是一根常驻的 300px 空栏：多数时候里面什么都没有，却把代码区常年挤窄一截。 */
function wireScriptConsole() {
  const box = document.getElementById("scriptConsole"), head = document.getElementById("scriptConsoleHead"), out = document.getElementById("scriptOut");
  if (!box || !head || !out) return;
  box.classList.add("is-closed");
  head.onclick = () => box.classList.toggle("is-closed");
  new MutationObserver(() => { if (out.childElementCount) box.classList.remove("is-closed"); }).observe(out, { childList: true });
}

// ---------- 代码编辑的日常四件套 ----------
// Tab / Shift+Tab / Enter / Ctrl+/ 。
// 每一条都只改 ta.value 然后派发一次 input：高亮、诊断、写回 state.scripts、
// 协作广播全挂在 input 上。在这里再各自走一遍就是第二份实现，必然漂移
// （上一轮那个"改了不重查"就是这么来的）。
const IND = "  ";
const OPEN_RE = /[{([]$/;
const NEAR_CLOSE_RE = /^\s*[)}\]]/;

function applyEdit(ta, value, selStart, selEnd) {
  ta.value = value;
  ta.selectionStart = selStart;
  ta.selectionEnd = selEnd == null ? selStart : selEnd;
  ta.dispatchEvent(new Event("input"));
}

/** 选区覆盖到的整行范围（起点行的行首 → 终点行的行尾） */
function blockRange(ta) {
  const v = ta.value;
  const first = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let last = v.indexOf("\n", ta.selectionEnd);
  if (last < 0) last = v.length;
  // 选区正好停在行首时不该把下一行也算进去（按过 Tab 的人都知道那有多莫名）
  if (last > ta.selectionStart && ta.selectionEnd === firstLineStart(v, last)) last = v.lastIndexOf("\n", last - 2) + 1;
  return { first, last };
}
function firstLineStart(v, idx) { return v.lastIndexOf("\n", idx - 1) + 1; }

function indentBlock(ta, out) {
  const { first, last } = blockRange(ta);
  const lines = ta.value.slice(first, last).split("\n");
  const next = lines.map((l) => {
    if (out) return l.startsWith(IND) ? l.slice(IND.length) : (l.startsWith("\t") ? l.slice(1) : (l.startsWith(" ") ? l.slice(1) : l));
    return l.trim() === "" ? l : IND + l;
  }).join("\n");
  applyEdit(ta, ta.value.slice(0, first) + next + ta.value.slice(last), first, first + next.length);
}

function newlineIndent(ta) {
  const v = ta.value, s = ta.selectionStart;
  if (s !== ta.selectionEnd) return false;           // 有选区时 Enter 就是普通替换，别抢
  const lineStart = firstLineStart(v, s);
  const before = v.slice(lineStart, s);
  const lead = (before.match(/^[ \t]*/) || [""])[0];
  let base = lead;
  if (OPEN_RE.test(before.trimEnd())) base = lead + IND;
  const after = v.slice(s);
  if (NEAR_CLOSE_RE.test(after) && OPEN_RE.test(before.trimEnd())) {
    // 光标正好夹在 {|} 中间：把收尾挪到下一行的原缩进，光标停在中间那一行
    const close = after.match(/^\s*([)}\]])/)[1];
    const rest = after.slice(after.indexOf(close) + close.length);
    applyEdit(ta, v.slice(0, s) + "\n" + base + "\n" + lead + close + rest, s + 1 + base.length);
    return true;
  }
  applyEdit(ta, v.slice(0, s) + "\n" + base + v.slice(s), s + 1 + base.length);
  return true;
}

function toggleComment(ta) {
  const { first, last } = blockRange(ta);
  const lines = ta.value.slice(first, last).split("\n");
  const real = lines.filter((l) => l.trim() !== "");
  const allOn = real.length > 0 && real.every((l) => /^\s*\/\//.test(l));
  const next = lines.map((l) => {
    if (l.trim() === "") return l;
    if (allOn) return l.replace(/^(\s*)\/\/\s?/, "$1");
    return l.replace(/^(\s*)/, "$1// ");
  }).join("\n");
  applyEdit(ta, ta.value.slice(0, first) + next + ta.value.slice(last), first, first + next.length);
}

function wireCodeEditing(ta) {
  ta.addEventListener("keydown", (ev) => {
    if (ev.code === "Tab") {
      ev.preventDefault();
      const multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes("\n");
      if (multi || ev.shiftKey) indentBlock(ta, ev.shiftKey);
      else applyEdit(ta, ta.value.slice(0, ta.selectionStart) + IND + ta.value.slice(ta.selectionEnd), ta.selectionStart + IND.length);
      return;
    }
    // 只处理"光秃秃的回车"：带修饰键的留给别的绑定（Ctrl+Enter 是运行）
    if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      if (newlineIndent(ta)) ev.preventDefault();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "/") { ev.preventDefault(); toggleComment(ta); }
  });
}

function wireScript() {
  const e = E;
  wireScriptChecks();
  wireScriptConsole();
  e.state.scripts = e.state.scripts && e.state.scripts.length ? e.state.scripts : [
    { name: "index.js", code: DEFAULT_SCRIPT },
    { name: "clientIndex.js", code: "" },
  ];
  const screen = document.getElementById("scriptScreen");
  const ta = document.getElementById("scriptCode");
  // 返回搭建界面（或点顶部「搭建」）
  document.getElementById("scriptBack").onclick = () => showScriptScreen(false);
  window.__showScriptScreen = showScriptScreen;
  function showScriptScreen(on) {
    screen.classList.toggle("show", !!on);
    document.getElementById("libCard").style.display = on ? "none" : "block";
    E.ctx.mode = on ? "script" : "build";
    if (on) { renderCodeEditor(); syncCodeScroll(); }
  }
  e.showScriptScreen = showScriptScreen;
  // 只能在 wire 之后挂：模块顶层的 E 还是 undefined，那时赋值会直接抛错，
  // 整个编辑器脚本就废了（实测 boot 不起来）。
  e.refreshScriptView = refreshScriptView;
  // script-ide.js 要在行号槽重画之后补诊断标记，给它一个"画完了"的钩子
  e.renderCode = renderCodeEditor;
  // 运行游戏 = 进入完整运行模式（官方 GameAPI）
  document.getElementById("scriptPlay").onclick = () => { showScriptScreen(false); window.__play && window.__play(); };
  ta.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.code === "Enter") { ev.preventDefault(); runScript(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); e.markDirty ? e.markDirty() : null; e.toast("脚本已记录（保存世界时一并写入）"); }
  });
  wireCodeEditing(ta);
  wireComplete(E, ta);
  // ---- JS 语法高亮（零依赖 tokenizer，见文件底部模块级实现）----
  const render = () => renderCodeEditor();
  const syncScroll = () => syncCodeScroll();
  ta.addEventListener("input", () => {
    const cur = curScript();
    if (cur) cur.code = ta.value;
    // 协作：改动 1.2 秒后整份发出去（见 collab.js），并告诉别人"我在写这个文件"
    if (cur && E.collab && E.collab.notifyEdit) E.collab.notifyEdit(cur.name);
    if (_errLine >= 0) { _errLine = -1; } // 编辑即清除错误标记
    renderCodeEditor(); // 同步渲染（脚本文件都不大，且后台标签页 rAF 会被节流）
    syncCodeScroll();
  });
  ta.addEventListener("scroll", syncScroll);
  document.getElementById("scriptRun").onclick = runScript;
  document.getElementById("scriptNew").onclick = () => {
    e.state.scripts.push({ name: prompt("新脚本文件名（.js）", "script" + (e.state.scripts.length) + ".js") || "script.js", code: "" });
    renderScriptFiles();
  };
  document.getElementById("scriptDel").onclick = () => {
    // 原来是 !e.__scriptIdx：第一个脚本的下标是 0，falsy，于是"删掉当前脚本"
    // 对第一个文件永远静默失效。
    if (e.__scriptIdx == null) return;
    if (e.state.scripts.length <= 1) { e.toast("至少保留一个脚本文件"); return; }
    e.state.scripts.splice(e.__scriptIdx, 1);
    e.__scriptIdx = null;
    renderScriptFiles();
  };
  document.getElementById("scriptRename").onclick = () => {
    const cur = curScript();
    if (!cur) return;
    const nm = prompt("重命名", cur.name);
    if (nm && /\.js$/i.test(nm)) { cur.name = nm; renderScriptFiles(); }
    else if (nm) e.toast("文件名需以 .js 结尾");
  };
  document.getElementById("scriptExample").onclick = () => {
    const cur = curScript();
    if (!cur) return;
    cur.code = DEFAULT_SCRIPT;
    document.getElementById("scriptCode").value = DEFAULT_SCRIPT;
    render();
  };
  document.getElementById("scriptGenEntities").onclick = genEntitiesFromScript;
  renderScriptFiles();
}
/** 当前选中的脚本文件；下标越界（换地图把脚本清空了、或刚删掉一个）时返回 null。
 *  __scriptIdx 是编辑器状态，state.scripts 是地图状态，两者生命周期不同，
 *  直接拿前者当下标就会在换图后指到不存在的位置上。 */
function curScript() {
  const e = E;
  return e.__scriptIdx == null ? null : (e.state.scripts || [])[e.__scriptIdx] || null;
}
function renderScriptFiles() {
  const e = E;
  const list = document.getElementById("scriptFiles");
  const ta = document.getElementById("scriptCode");
  if (!list) return;
  list.innerHTML = "";
  e.state.scripts.forEach((f, i) => {
    const it = document.createElement("button");
    it.className = "sfile" + (e.__scriptIdx === i ? " active" : "");
    it.innerHTML = `<span class="sdot"></span><span>${f.name}</span>`;
    it.onclick = () => {
      e.__scriptIdx = i;
      document.getElementById("scriptCode").value = f.code;
      list.querySelectorAll(".sfile").forEach((x) => x.classList.remove("active"));
      it.classList.add("active");
      renderCodeEditor(); syncCodeScroll();
    };
    list.appendChild(it);
  });
  // 越界的下标先夹回来，再决定默认选中谁
  if (e.__scriptIdx != null && e.__scriptIdx >= e.state.scripts.length) e.__scriptIdx = null;
  if (e.__scriptIdx == null && e.state.scripts.length) e.__scriptIdx = 0;
  if (e.__scriptIdx != null) {
    ta.value = e.state.scripts[e.__scriptIdx].code || "";
    renderCodeEditor(); syncCodeScroll();
  } else {
    ta.value = "";
    const pre = document.getElementById("scriptHighlight");
    if (pre) pre.textContent = "";
    const ln = document.getElementById("scriptLines");
    if (ln) ln.textContent = "";
  }
}

/* ---- 代码编辑器：零依赖 JS 语法高亮 + 行号 + 滚动同步 ---- */
const _esc = (s) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
const _KW = "const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|default|class|extends|new|this|typeof|instanceof|import|export|from|as|async|await|try|catch|finally|throw|yield|in|of|delete|void|null|undefined|true|false|super|static";
const _TOKEN = new RegExp(
  "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" +
  "|(`(?:\\\\[\\s\\S]|[^\\\\`])*`|\"(?:\\\\.|[^\\\\\"\\n])*\"|'(?:\\\\.|[^\\\\'\\n])*')" +
  "|\\b(0[xX][0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)\\b" +
  "|\\b(" + _KW + ")\\b" +
  "|([A-Za-z_$][\\w$]*)(?=\\s*\\()" +
  "|([A-Za-z_$][\\w$]*)(?=\\s*(?:=\\s*(?:async\\s+)?(?:function|\\()|\\s*:\\s*(?:async\\s+)?function))",
  "g");
function highlightJS(src) {
  let out = "", last = 0, m;
  _TOKEN.lastIndex = 0;
  while ((m = _TOKEN.exec(src))) {
    out += _esc(src.slice(last, m.index));
    const [full, com, str, num, kw, call, fndef] = m;
    const cls = com ? "tk-com" : str ? "tk-str" : num ? "tk-num" : kw ? "tk-kw" : call ? "tk-call" : fndef ? "tk-fndef" : null;
    out += cls ? `<span class="${cls}">${_esc(full)}</span>` : _esc(full);
    last = m.index + full.length;
    if (m.index === _TOKEN.lastIndex) _TOKEN.lastIndex++;
  }
  out += _esc(src.slice(last));
  return out;
}
let _errLine = -1; // 沙箱运行出错的编辑器行号（0 基），renderCodeEditor 画红色标记
function renderCodeEditor() {
  const ta = document.getElementById("scriptCode");
  const hiCode = document.getElementById("scriptHiCode");
  const hiPre = document.getElementById("scriptHi");
  const gutter = document.getElementById("scriptGutter");
  if (!ta || !hiCode || !gutter) return;
  hiCode.innerHTML = highlightJS(ta.value) + "\n";
  // 错误行红色标记（行高 12.5px × 1.6 = 20px，pre 顶部 padding 12px）
  hiPre.querySelectorAll(".err-mark").forEach((n) => n.remove());
  if (_errLine >= 0) {
    const mark = document.createElement("div");
    mark.className = "err-mark";
    mark.style.top = (12 + _errLine * 20) + "px";
    hiPre.appendChild(mark);
  }
  const lines = ta.value.split("\n").length;
  // 行号按作者上色：一眼看出"这行是谁写的"。作者表由服务端算（LCS 保留未改动行的
  // 原作者），客户端只画，不参与判定——否则谁都能把改动写成别人的。
  const authors = (E.collab && E.collab.authors && curScriptName()) ? E.collab.authors.get(curScriptName()) : null;
  let g = "";
  for (let i = 1; i <= lines; i++) {
    const label = (i - 1 === _errLine ? "▶" : i);
    const who = authors && authors[i - 1];
    // 每行都必须包成带 data-ln 的节点：诊断标记要按行号找位置，
    // 而裸文本节点不算 children —— 不包的时候行号槽看起来正常，标记却永远画不上。
    // 行与行的分隔交给 .ln{display:block}，这里不能再留 \n：
    // 块级元素 + pre 里的换行文本会各占一行，实测行距从 20px 变成 40px，
    // 而诊断标记与当前行是按 20px 定位的，整套就会错开半行。
    g += `<span class="${who ? "bl ln" : "ln"}" data-ln="${i}"${who ? ` data-by="${escAttr(who)}" style="color:${blameColor(who)}"` : ""}>${label}</span>`;
  }
  gutter.innerHTML = g;
}
function curScriptName() {
  const c = curScript();
  return c ? c.name : null;
}
const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 颜色与在线列表/改动流共用 diff.js 里的同一个函数，否则"甲的行"和"甲的名字"
// 在屏幕上会成两种颜色，标注等于没标。
const blameColor = authorColor;
/** 远端把当前打开的这个文件改了：把新内容搬到屏幕上，不然用户看到的还是旧版。 */
function refreshScriptView(name) {
  const idx = (E.state.scripts || []).findIndex((f) => f.name === name);
  if (idx < 0) return;
  const ta = document.getElementById("scriptCode");
  if (E.__scriptIdx === idx && ta) ta.value = E.state.scripts[idx].code || "";
  renderCodeEditor(); syncCodeScroll();
}
function syncCodeScroll() {
  const ta = document.getElementById("scriptCode");
  const hiPre = document.getElementById("scriptHi");
  const gutter = document.getElementById("scriptGutter");
  if (!ta || !hiPre || !gutter) return;
  hiPre.scrollTop = ta.scrollTop;
  hiPre.scrollLeft = ta.scrollLeft;
  gutter.scrollTop = ta.scrollTop;
}
function refreshScriptList() { renderScriptFiles(); }
export { refreshScriptList };

// 从导入脚本中识别 #id / .tag，自动生成实体标记（可再用位置滑杆调整）
function genEntitiesFromScript() {
  const e = E;
  const refs = io.extractEntityRefs(e.state.scripts || []);
  const [X, Y, Z] = e.world.shape;
  const cx = Math.floor(X / 2), cz = Math.floor(Z / 2);
  let top = 0;
  for (let y = Y - 1; y >= 0; y--) if (e.world.get(cx, y, cz)) { top = y + 1; break; }
  let i = 0;
  for (const id of refs.ids) {
    addEntityMarker({ id, tags: [], pos: [cx + (i % 4) * 3, top, cz + Math.floor(i / 4) * 3], bounds: [1.5, 1.5, 1.5] });
    i++;
  }
  for (const tag of refs.tags) {
    addEntityMarker({ id: tag + "-" + (i + 1), tags: [tag], pos: [cx + (i % 4) * 3, top, cz + Math.floor(i / 4) * 3], bounds: [1.5, 1.5, 1.5] });
    i++;
  }
  if (i === 0) { e.toast("脚本里没有检测到 #id / .tag 实体引用"); return; }
  if (E.ui && E.ui.refreshTree) E.ui.refreshTree();
  renderModelList();
  e.toast("已生成 " + i + " 个实体标记（可在模型模式中拖动位置）");
}

// 生成/添加一个实体标记模型（编辑器里可视化，运行时可查询/交互）
export function addEntityMarker(d) {
  const e = E;
  // 几何与材质全图共用一份：一张 68 个实体的图以前是 68 套 BoxGeometry + EdgesGeometry
  // + 136 个材质，光状态切换就把编辑器画慢了。尺寸改走 group.scale，视觉与原来逐格一致。
  if (!MARKER_GEO) {
    MARKER_GEO = new THREE.BoxGeometry(2, 1, 2).translate(0, 0.5, 0);   // x/z ∈ [-1,1]，y ∈ [0,1]
    MARKER_EDGE = new THREE.EdgesGeometry(MARKER_GEO);
    MARKER_FILL = new THREE.MeshBasicMaterial({ color: 0xe3a63c, transparent: true, opacity: 0.25 });
    // 逻辑触发器（本来就没有模型）只留描边：填充面关掉颜色写入但保留网格，
    // 视口里照样点得中，画面不再被几十个半透明大盒子糊住。
    MARKER_FILL_FAINT = new THREE.MeshBasicMaterial({ color: 0xe3a63c, transparent: true, opacity: 0.25, colorWrite: false, depthWrite: false });
    MARKER_LINE = new THREE.LineBasicMaterial({ color: 0xe3a63c });
  }
  const group = new THREE.Group();
  const cube = new THREE.Mesh(MARKER_GEO, d.mesh ? MARKER_FILL : MARKER_FILL_FAINT);
  const edges = new THREE.LineSegments(MARKER_EDGE, MARKER_LINE);
  // 尺寸落在子网格上而不是 group.scale：属性卡的「缩放」条驱动的是 group.scale
  // （基线是 1），要是这里先占了 group.scale，一拖滑杆标记盒就塌成单位立方体。
  const b = d.bounds || [1.5, 1.5, 1.5];
  cube.scale.set(b[0], b[1] * 2, b[2]);
  edges.scale.copy(cube.scale);
  group.add(cube, edges);
  group.userData.marker = true;      // 封面渲染要跳过它：这是编辑器的标记盒，不是地图内容
  const ent = {
    id: "m" + Date.now().toString(36) + Math.floor(Math.random() * 99),
    name: (d.id || "实体") + (d.tags && d.tags.length ? " " + d.tags.map((t) => "." + t).join(" ") : ""),
    entId: d.id, entTags: d.tags || [], entityBounds: (d.bounds || [1.5, 1.5, 1.5]).slice(),
    _baseBounds: (d.bounds || [1.5, 1.5, 1.5]).slice(), entCollides: !!d.collides, entPhys: d.phys || null,
    entity: true,
    pos: [d.pos[0], d.pos[1] - (d.bounds ? d.bounds[1] : 1), d.pos[2]],
    scale: 1, rotY: 0,
    object: group,
  };
  group.position.set(ent.pos[0] + 0.5, ent.pos[1] + (d.bounds ? d.bounds[1] : 1), ent.pos[2] + 0.5);
  e.renderer.models.add(group);
  e.state.models = e.state.models || [];
  e.state.models.push(ent);
  e.state.selectedModel = ent;
  renderModelList(); // 模型面板立即出现该标记（含实体属性区）
  return ent;
}

/* ------------------------------ 脚本运行（sb 方块沙箱） ------------------------------ */
/**
 * 跑一段方块沙箱代码，把结果当**数据**返回。这是唯一的执行体：
 * runScript() 只负责把它接到 DOM 上，AI Agent 直接调它拿观察结果。
 *
 * 之所以要能"不看界面、只要结果"地调用：Agent 下一步做什么，依据就是这一轮的
 * 输出文本、变更格数和报错原文。让它去读 #scriptOut 的 DOM 等于把渲染时序引进来。
 * 出错时不抛异常而是返回 {ok:false, error, line}——Agent 要能把报错原样喂回模型。
 * @returns {{ok: boolean, out: string, changes: number, error?: string, line?: number}}
 */
export function runSandboxCode(e, code) {
  const w = e.world, atlas = e.atlas;
  const changes = new Map();
  const apply = (x, y, z, id) => {
    if (!w.inBounds(x, y, z)) return;
    const k = x + "," + y + "," + z;
    const oldId = changes.has(k) ? changes.get(k).newId : w.get(x, y, z);
    changes.set(k, { x, y, z, oldId, oldRot: w.getRot(x, y, z), newId: id, newRot: 0 });
  };
  const idOf = (b) => (typeof b === "number" ? b : (atlas.get(b) ? atlas.get(b).id : 0));
  const sb = {
    set: (x, y, z, b) => apply(x | 0, y | 0, z | 0, idOf(b)),
    del: (x, y, z) => apply(x | 0, y | 0, z | 0, 0),
    block: (name) => idOf(name),
    box: (min, max, b, shell) => {
      const id = idOf(b);
      for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) {
        if (shell && !(x === min[0] || x === max[0] || y === min[1] || y === max[1] || z === min[2] || z === max[2])) continue;
        apply(x, y, z, id);
      }
    },
    sphere: (c, r, b) => {
      const id = idOf(b);
      for (let x = c[0] - r; x <= c[0] + r; x++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let z = c[2] - r; z <= c[2] + r; z++)
        if ((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 <= r * r) apply(x, y, z, id);
    },
    clear: () => { for (const k of [...w.map.keys()]) { const [x, y, z] = w.unpack(k); apply(x, y, z, 0); } },
    count: () => { let n = w.size(); for (const c of changes.values()) { if (c.newId && !c.oldId) n++; else if (!c.newId && c.oldId) n--; } return n; },
    size: () => w.shape.slice(),
    log: (m) => pushConsole("log", m),
  };
  const lines = [];
  try {
    const fn = new Function("sb", "Math", "console", code);
    _errLine = -1; // 清除上次错误行标记
    // 沙箱 console：官方脚本常用 clear/warn/info，一并支持。
    // 严重度在这里就分好——事后再从文本里猜"这是不是错误"会看漏。
    fn(sb, Math, {
      log: (...a) => { const s = a.join(" "); lines.push(s); pushConsole("log", s); },
      error: (...a) => { const s = a.join(" "); lines.push("错误: " + s); pushConsole("error", s); },
      warn: (...a) => { const s = a.join(" "); lines.push("警告: " + s); pushConsole("warn", s); },
      info: (...a) => { const s = a.join(" "); lines.push(s); pushConsole("log", s); },
      clear: () => { lines.length = 0; clearConsole(); },
    });
    const list = [...changes.values()].filter((c) => c.oldId !== c.newId);
    e.history.commit(list, "script");
    e.renderer.rebuildAll();
    e.updateStatus();
    if (e.ui && e.ui.refreshTree) e.ui.refreshTree();
    const text = lines.join("\n");
    const shown = text || "运行成功 · " + list.length + " 处变更";
    // 控制台是日志不是状态栏：条目在脚本调用时就进 console（见上面的沙箱 console），
    // 这里只补一行本次结果。原来这里是 out.textContent = shown ——
    // 一次运行只留最后一行，再跑一次就把上一轮抹掉，两条输出根本没法比对。
    pushConsole("log", `→ ${list.length} 处变更`);
    return { ok: true, out: shown, changes: list.length };
  } catch (err) {
    // 官方 scriptErrorFound：定位出错行并在编辑器里高亮
    // 实测 V8：new Function 包裹后栈行号 = 代码行号 + 2（代码第3行报栈第5行）
    const m = String(err.stack || "").match(/<anonymous>:(\d+):\d+/);
    _errLine = m ? Math.max(0, parseInt(m[1], 10) - 3) : -1;
    const error = String(err && err.message || err || "");
    pushConsole("error", (m ? `第 ${_errLine + 1} 行错误: ` : "错误: ") + error, m ? { line: _errLine + 1 } : null);
    renderCodeEditor();
    return { ok: false, out: "", changes: 0, error, line: _errLine };
  }
}

function runScript() {
  const e = E;
  const idx = e.__scriptIdx == null ? 0 : e.__scriptIdx;
  const code = (e.state.scripts[idx] || { code: "" }).code;
  return runSandboxCode(e, code);
}

/**
 * 「AI Agent」入口。和「AI 生成」并排放在脚本界面标题栏右侧——
 * 两者是同一件事的两档：那一档你问一句它答一段，这一档你给个目标它自己跑十几轮。
 * 放一起是为了让人自己选要不要交出控制权，而不是偷偷给 AI 加一个自动执行的开关。
 */
function wireAgentBtn(editor) {
  const head = document.querySelector("#scriptScreen .ss-head");
  if (!head || document.getElementById("aiAgentBtn")) return;
  const btn = document.createElement("button");
  btn.id = "aiAgentBtn";
  btn.title = "给一个目标，让它自己写脚本、盖模型、跑一遍验证、再按报错修正";
  btn.textContent = "AI Agent";
  btn.style.cssText = "border-color:#123a2a;color:#7ee0a8";
  const anchor = document.getElementById("scriptRun");
  head.insertBefore(btn, anchor || null);
  btn.onclick = () => openAgent(editor);
}

/* ------------------------------ 模型 (.glb / 选区体素) ------------------------------ */
function wireModels() {
  const e = E;
  e.state.models = e.state.models || [];
  e.renderModelList = renderModelList; // 供 main.js 模型拖放选中后刷新列表
  document.getElementById("modelImport").onclick = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".glb,.gltf,.vox,.png,.jpg";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const buf = await f.arrayBuffer();
      try {
        const { GLTFLoader } = await import("../vendor/three/GLTFLoader.js");
        new GLTFLoader().parse(buf, "", async (gltf) => {
          // 官方 uploadModel：上传到世界资产目录，重载后可从该目录重建
          const base = f.name.replace(/\.(glb|gltf)$/i, "");
          const rel = "models/" + encodeURIComponent(base) + ".gltf";
          let uploaded = false;
          try {
            const r = await fetch(`/api/world/${E.worldId}/asset?path=${rel}`, { method: "POST", body: buf });
            uploaded = r.ok;
          } catch {}
          addModel(gltf.scene, base, uploaded ? { meshName: base, assetRoot: `/assets/worlds/${window.__worldId}/` } : null);
        }, (err) => e.toast("模型解析失败"));
      } catch { e.toast("不支持的模型文件"); }
    };
    inp.click();
  };
  // 从当前选区生成体素模型（像素体模型 → 可播放）
  document.getElementById("modelFromVoxels").onclick = () => {
    if (!e.state.selection) { e.toast("请先用框选工具 (S) 框选一片体素"); return; }
    const obj = voxelSelectionToMesh();
    addModel(obj, "体素模型" + Date.now().toString(36).slice(-3));
  };
  renderModelList();
}
// 把选区体素转换为带图集纹理的 Mesh（侧面同样渲染）
/** 把 world 在 [min,max] 范围内的体素烘成一张网格（面剔除 + 图集 UV）。
 *  atlas 必须由调用方传进来：features.js 的模块级 E 要等 initFeatures 才有值，
 *  而 main.js 的 boot 在更早就会走到这里（加载世界资产里的 .vox）。
 *  当时写成 meshVoxelRange(E, ...) 就是 "Cannot read properties of undefined (reading 'atlas')"。 */
function meshVoxelRange(atlas, w, min, max) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.92, metalness: 0, transparent: true, opacity: 1 });
  const FACES = [
    // 与 renderer.js 保持一致：外侧逆时针绕序，v=0 在底部
    { dir: [1, 0, 0], slot: 1, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { dir: [-1, 0, 0], slot: 0, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { dir: [0, 1, 0], slot: 3, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { dir: [0, -1, 0], slot: 2, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { dir: [0, 0, 1], slot: 4, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { dir: [0, 0, -1], slot: 5, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  ];
  const pos = [], nor = [], uv = [], idx = [];
  let vc = 0;
  for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
    const id = w.get(x, y, z); if (!id) continue;
    const block = atlas.byId(id); if (!block) continue;
    for (const f of FACES) {
      const nid = w.get(x + f.dir[0], y + f.dir[1], z + f.dir[2]);
      const nb = nid ? atlas.byId(nid) : null;
      if (nid && nb && !nb.transparent) continue;
      const tile = block.faces[f.slot];
      const [u0, v0, u1, v1] = atlas.tileUV(tile);
      for (let c = 0; c < 4; c++) {
        const co = f.corners[c];
        pos.push(x - min.x + co[0], y - min.y + co[1], z - min.z + co[2]);
        nor.push(f.dir[0], f.dir[1], f.dir[2]);
        const [su, sv] = f.uv[c];
        uv.push(u0 + su * (u1 - u0), v0 + sv * (v1 - v0));
      }
      idx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function voxelSelectionToMesh() {
  const e = E, { min, max } = e.state.selection;
  return meshVoxelRange(e.atlas, e.world, min, max);
}
/**
 * 把 .vox 解出来的 [x, z, yDown, palette] 列表变成一个可摆放的模型。
 * 官方 dao3 包里的雕像/奖杯全是这个格式，不吃进来就等于"导入成功但画面是空的"。
 * 颜色按调色板顺序映射到图集方块——和整图 .vox 导入走的是同一条映射，不再另立一套。
 */
export function voxListToModel(voxels, atlas) {
  let mx = 0, my = 0, mz = 0;
  for (const v of voxels) { if (v[0] > mx) mx = v[0]; if (v[1] > mz) mz = v[1]; if (v[2] > my) my = v[2]; }
  const world = new VoxelWorld([mx + 1, my + 1, mz + 1]);
  const palette = atlas.list().slice(0, 255).map((b) => b.id);
  const fallback = palette[0] || 1;
  for (const [x, z, yDown, pal] of voxels) {
    const id = palette[Math.max(0, Math.min(254, (pal || 1) - 1))] || fallback;
    world.set(x, my - yDown, z, id);
  }
  const mesh = meshVoxelRange(atlas, world, { x: 0, y: 0, z: 0 }, { x: mx, y: my, z: mz });
  // 实体记录给的是**中心**坐标，体素网格的几何原点在一个角上，不居中就会整体偏出半座雕像
  mesh.geometry.translate(-mx / 2, 0, -mz / 2);
  return mesh;
}
function addModel(obj, name, assetRef) {
  const e = E;
  // 归一化尺寸到 ~6 格
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z) || 1;
  const scale = 6 / maxd;
  obj.scale.multiplyScalar(scale);
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const [X, , Z] = e.world.shape;
  const ent = { id: "m" + Date.now().toString(36), name, object: obj, pos: [X / 2, 0, Z / 2], scale, rotY: 0, meshName: assetRef ? assetRef.meshName : null, assetRoot: assetRef ? assetRef.assetRoot : null };
  obj.position.set(ent.pos[0], ent.pos[1], ent.pos[2]);
  e.renderer.models.add(obj);
  e.state.models.push(ent);
  e.state.selectedModel = ent;
  renderModelList();
  e.toast("已导入模型：" + name);
}
// 从持久化数据重建一个场景模型（官方 entitiesTree 记录：position 浮点 / orientation 四元数 / scale 向量）
export function addPlacedModel(d) {
  const e = E;
  const obj = d.source.clone(true);
  const sv = Array.isArray(d.scaleVec) ? d.scaleVec : [d.scale ?? 1, d.scale ?? 1, d.scale ?? 1];
  obj.scale.set(sv[0], sv[1], sv[2]);
  if (d.orientation) obj.quaternion.fromArray(d.orientation);
  else obj.rotation.y = d.rotY || 0;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  obj.position.set(d.pos[0], d.pos[1], d.pos[2]);
  const ent = {
    id: d.id || "m" + Date.now().toString(36) + Math.floor(Math.random() * 99),
    name: d.name, object: obj, pos: d.pos.slice(), scale: d.scale || 1, scaleVec: sv,
    orientation: d.orientation ? d.orientation.slice() : null,
    rotY: d.rotY || 0, meshName: d.meshName, meshId: d.meshId ?? null, parentId: d.parentId || "ROOT_ID",
    // 官方实体字段（物理/外观/玩法），保存时原样写回 meta.entities
    bounds: d.bounds || null, tags: d.tags || [], collision: !!d.collision,
    fixed: !!d.fixed, gravity: !!d.gravity, mass: d.mass ?? 1, friction: d.friction ?? 1,
    restitution: d.restitution ?? 0, emissive: d.emissive ?? 0, metalness: d.metalness ?? 0,
    shininess: d.shininess ?? 0, tint: d.tint || null, damage: d.damage || null,
    particle: d.particle || null, sound: d.sound || null, defaultMotionId: d.defaultMotionId || "",
    hidden: d.meshInvisible === true, anchorOffset: d.anchorOffset || null,
  };
  obj.visible = d.meshInvisible !== true;
  e.renderer.models.add(obj);
  e.state.models.push(ent);
  renderModelList();
  return ent;
}
let _suspendList = false;
export function suspendModelList(v) { _suspendList = !!v; }
export function refreshModelList() { renderModelList(); }
export function refreshScriptFiles() { renderScriptFiles(); }
function renderModelList() {
  const e = E, list = document.getElementById("modelList");
  if (!list || _suspendList) return;
  list.innerHTML = "";
  renderEntProps();
  if (e.ui && e.ui.refreshFxSound) e.ui.refreshFxSound();
  const models = e.state.models || [];
  const assets = (e.state.assets && e.state.assets.meshes) || {};
  const assetEntries = Object.keys(assets).map((k) => ({ name: k, asset: assets[k], isAsset: true }));
  if (!models.length && !assetEntries.length) { list.innerHTML = '<div class="muted" style="padding:8px">暂无模型 / 实体标记</div>'; return; }
  if (models.length) {
    const head = document.createElement("div"); head.className = "mhead"; head.textContent = "场景模型"; list.appendChild(head);
    for (const m of models) {
      const it = document.createElement("div");
      it.className = "mitem" + (e.state.selectedModel === m ? " active" : "");
      const badge = (m.tags && m.tags.length) ? "实体" : "模型";
      it.innerHTML = `<span class="mico${(m.tags && m.tags.length) ? " ent" : ""}"></span><span class="mname">${escHtml(m.name || "未命名")}</span><span class="mbadge">${badge}</span><span class="del">×</span>`;
      it.querySelector(".del").onclick = (ev) => { ev.stopPropagation(); e.renderer.models.remove(m.object); e.state.models = e.state.models.filter((x) => x !== m); if (e.state.selectedModel === m) e.state.selectedModel = null; m._destroyed = true; renderModelList(); };
      it.onclick = (ev) => { if (ev.target.classList.contains("del")) return; e.state.selectedModel = m; renderModelList(); focusModel(m); if (E.ui && E.ui.refreshTree) E.ui.refreshTree(); };
      list.appendChild(it);
    }
  }
  if (assetEntries.length) {
    const head = document.createElement("div"); head.className = "mhead"; head.textContent = "资产库"; list.appendChild(head);
    for (const a of assetEntries) {
      const it = document.createElement("div"); it.className = "mitem asset" + (e.state.selectedModel && e.state.selectedModel.name === a.name ? " active" : ""); it.dataset.assetName = a.name;
      it.innerHTML = `<span class="mico"></span><span class="mname">${escHtml(a.name)}</span><span class="mbadge">资产</span>`;
      it.onclick = (ev) => {
        if (ev.target.classList.contains("del")) return;
        // 方块式：点资产 = 拿起，之后鼠标在地形上预览、左键摆放（可连续摆）
        holdModel(a.name, a.asset.object || a.asset, a.asset.scale || 1, { meshName: a.name, assetRoot: (E.state.meta && E.state.meta.assetRoot) || "/assets/racing/models/" });
        renderModelList();
      };
      list.appendChild(it);
    }
  }
}
/* ---------------- 手持模型：与方块一致的「拿起 → 预览 → 摆放」 ---------------- */
let held = null; // { name, source, scale, obj, rotY, pos, ref }
export function holdModel(name, source, scale, ref) {
  dropHeldModel();
  const obj = source.clone(true);
  obj.scale.setScalar(scale || 1);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material && o.material.clone) o.material = o.material.clone();
    if (o.material) { o.material.transparent = true; o.material.opacity = 0.38; o.material.depthWrite = false; }
    o.castShadow = false; o.receiveShadow = false;
  });
  obj.visible = false;
  obj.renderOrder = 5;
  obj.userData.ghost = true; // 预览件不参与视口拾取
  E.renderer.models.add(obj);
  held = { name, source, scale: scale || 1, obj, rotY: 0, pos: null, ref: ref || null };
  E.state.heldModel = name;
  E.toast(`已拿起「${name}」· 左键摆放 · Y 旋转 90° · Esc 放下`);
  return held;
}
export function dropHeldModel() {
  if (!held) return false;
  if (held.obj.parent) held.obj.parent.remove(held.obj);
  held = null;
  if (E.state) E.state.heldModel = null;
  return true;
}
export function rotateHeldModel() {
  if (!held) return false;
  held.rotY = (held.rotY + Math.PI / 2) % (Math.PI * 2);
  held.obj.rotation.y = held.rotY;
  return true;
}
// pick 来自 renderer.pick()：ax/ay/az 是命中面的相邻格（与放方块同一语义）
// 目标格下方没有实心方块时向下找真实路面，避免模型悬空或掉进虚空
function snapToSurface(x, y, z) {
  const w = E.world;
  if (!w) return y;
  const solid = (cx, cy, cz) => {
    if (!w.inBounds(cx, cy, cz)) return false;
    const id = w.get(cx, cy, cz);
    if (!id) return false;
    const b = E.atlas.byId(id);
    return !b || b.name === "barrier" || !b.transparent;
  };
  const cx = Math.floor(x), cz = Math.floor(z);
  if (solid(cx, Math.floor(y) - 1, cz)) return Math.floor(y);
  for (let cy = Math.floor(y); cy >= 0; cy--) {
    if (solid(cx, cy, cz)) return cy + 1;
  }
  for (let cy = Math.floor(y); cy < w.shape[1]; cy++) {
    if (solid(cx, cy, cz)) return cy + 1;
  }
  return Math.max(0, Math.floor(y));
}
export function moveHeldModelTo(pick) {
  if (!held) return;
  if (!pick) { held.obj.visible = false; return; }
  const x = pick.ax ?? pick.x, y = pick.ay ?? 0, z = pick.az ?? pick.z;
  const sy = snapToSurface(x, y, z);
  held.pos = [x, sy, z];
  held.obj.position.set(x + 0.5, sy, z + 0.5);
  held.obj.rotation.y = held.rotY;
  held.obj.visible = true;
}
export function placeHeldModel() {
  if (!held || !held.pos) return null;
  const [x, y, z] = held.pos;
  const ent = addPlacedModel({
    name: held.name, meshName: held.ref && held.ref.meshName, assetRoot: held.ref && held.ref.assetRoot,
    pos: [x, y, z], scale: held.scale, rotY: held.rotY, source: held.source,
  });
  E.state.selectedModel = ent;
  E.markDirty && E.markDirty();
  return ent;
}
export function getHeldModel() { return held; }
// 选中了场景里已有的模型但没拿起资产时，把它当作手持件（像选中方块一样）
export function ensureHeldFromSelection() {
  if (held) return held;
  const m = E.state.selectedModel;
  if (!m || !m.meshName) return null;
  const asset = (E.state.assets && E.state.assets.meshes[m.meshName]) || null;
  if (!asset || !asset.object) return null;
  return holdModel(m.meshName, asset.object, m.scale || 1, { meshName: m.meshName, assetRoot: m.assetRoot || null });
}

const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 选中模型/实体标记时在模型面板下方编辑属性（重命名/旋转/缩放 + 实体的 bounds/碰撞/物理）
function renderEntProps() {
  const pane = document.getElementById("entProps");
  if (!pane) return;
  const card = document.getElementById("propCard");
  const m = E.state.selectedModel;
  if (card) {
    const close = document.getElementById("propClose");
    if (E.state.propsFor !== (m && m.id)) { E.state.propsHidden = false; E.state.propsFor = m && m.id; }
    if (close) close.onclick = () => { E.state.propsHidden = true; card.classList.remove("show"); };
    card.classList.toggle("show", !!m && !E.state.propsHidden);
  }
  if (!m) {
    pane.innerHTML = '<div class="muted" style="padding:6px 8px;font-size:11px;color:var(--font-black-minor)">点击列表选中模型后可编辑属性</div>';
    return;
  }
  // 保存时每个场景模型都会写进 meta.entities，所以只要有 id 就是实体，属性行必须可见
  const isEnt = !!m.id || !!((m.tags && m.tags.length) || m.entId || (m.entTags && m.entTags.length));
  pane.innerHTML = "";
  const head = document.createElement("div"); head.className = "mhead"; head.textContent = isEnt ? "实体属性" : "模型属性"; pane.appendChild(head);
  // 通用行构造
  const mkRow = (label, val, cb) => {
    const r = document.createElement("div"); r.className = "frow"; r.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:11px";
    const lb = document.createElement("label"); lb.textContent = label; lb.style.cssText = "width:56px;color:var(--font-black-minor)"; r.appendChild(lb);
    const i = document.createElement("input"); i.type = "number"; i.step = "0.5"; i.min = "0.1"; i.value = val;
    i.style.cssText = "flex:1;min-width:0";
    i.onchange = () => { cb(Math.max(0.1, parseFloat(i.value) || 0.1)); E.markDirty(); };
    r.appendChild(i); pane.appendChild(r);
  };
  // 所有模型通用：重命名 / 旋转 / 缩放
  const genRow = (label, build) => {
    const r = document.createElement("div"); r.className = "frow"; r.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:11px";
    const lb = document.createElement("label"); lb.textContent = label; lb.style.cssText = "width:56px;color:var(--font-black-minor)"; r.appendChild(lb);
    build(r); pane.appendChild(r);
  };
  const nameRow = genRow("名字", (r) => {
    const ni = document.createElement("input"); ni.type = "text"; ni.value = m.name || ""; ni.style.cssText = "flex:1;min-width:0";
    ni.onchange = () => { m.name = ni.value; renderModelList(); E.markDirty(); };
    r.appendChild(ni);
  });
  genRow("旋转°", (r) => {
    const cur = ((m.object.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    const s = document.createElement("input"); s.type = "range"; s.min = "0"; s.max = "360"; s.step = "5"; s.value = Math.round(cur); s.style.cssText = "flex:1;min-width:0";
    const em = document.createElement("em"); em.textContent = s.value; em.style.cssText = "width:30px;text-align:right;font-style:normal";
    const apply = () => { m.object.rotation.y = (+s.value) * Math.PI / 180; m.orientation = m.object.quaternion.toArray(); em.textContent = s.value; };
    s.oninput = apply; s.onchange = () => E.markDirty();
    r.appendChild(s); r.appendChild(em);
  });
  genRow("缩放", (r) => {
    const base = m.scaleVec && m.scaleVec[0] ? m.scaleVec.slice() : [m.scale || 1, m.scale || 1, m.scale || 1];
    const k0 = (m.object.scale.x || 1) / (base[0] || 1);
    const s = document.createElement("input"); s.type = "range"; s.min = "0.2"; s.max = "4"; s.step = "0.1"; s.value = k0.toFixed(2); s.style.cssText = "flex:1;min-width:0";
    const em = document.createElement("em"); em.textContent = (+k0).toFixed(1); em.style.cssText = "width:30px;text-align:right;font-style:normal";
    s.oninput = () => { const k = parseFloat(s.value) || 0.2; m.object.scale.set(base[0] * k, base[1] * k, base[2] * k); em.textContent = k.toFixed(1); };
    s.onchange = () => E.markDirty();
    r.appendChild(s); r.appendChild(em);
  });
  // 实体专有：官方 entitiesTree 字段（bounds 为完整包围盒，运行时按 ÷2 作为半径）
  if (!isEnt) return;
  const tg = document.createElement("div"); tg.className = "frow"; tg.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:11px";
  const tlb = document.createElement("label"); tlb.textContent = "标签"; tlb.style.cssText = "width:56px;color:var(--font-black-minor)"; tg.appendChild(tlb);
  const ti = document.createElement("input"); ti.type = "text"; ti.value = (m.tags || []).join(","); ti.placeholder = "逗号分隔"; ti.style.cssText = "flex:1;min-width:0";
  ti.onchange = () => { m.tags = ti.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean); ti.value = m.tags.join(","); renderModelList(); E.markDirty(); };
  tg.appendChild(ti); pane.appendChild(tg);
  const b = m.bounds || [1, 1, 1];
  const setB = (idx, v) => { m.bounds = (m.bounds || [1, 1, 1]).slice(); m.bounds[idx] = v; };
  mkRow("bounds X", b[0], (v) => setB(0, v));
  mkRow("bounds Y", b[1], (v) => setB(1, v));
  mkRow("bounds Z", b[2], (v) => setB(2, v));
  // 官方 anchorOffset：几何中心相对锚点的偏移；留空则由运行时按模型几何自动推导
  genRow("盒偏移", (r) => {
    const o = Array.isArray(m.anchorOffset) ? m.anchorOffset.slice() : [0, 0, 0];
    const set = (i, v) => { const c = (m.anchorOffset = (Array.isArray(m.anchorOffset) ? m.anchorOffset : [0, 0, 0]).slice()); c[i] = v; };
    for (let i = 0; i < 3; i++) {
      const inp = document.createElement("input");
      inp.type = "number"; inp.step = "0.1"; inp.value = (+o[i] || 0).toFixed(2); inp.title = "物理盒偏移 " + "XYZ"[i];
      inp.style.cssText = "flex:1;min-width:0";
      inp.onchange = () => { set(i, parseFloat(inp.value) || 0); E.markDirty(); };
      r.appendChild(inp);
    }
    const auto = document.createElement("button");
    auto.className = "ss-btn"; auto.textContent = "自动"; auto.title = "清空后由模型几何推导物理盒";
    auto.style.cssText = "flex:none;padding:2px 6px;font-size:10px";
    auto.onclick = () => { m.anchorOffset = null; E.markDirty(); renderEntProps(); };
    r.appendChild(auto);
  });
  const chk = (label, val, cb) => {
    const r2 = document.createElement("div"); r2.className = "frow"; r2.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:11px";
    const lb = document.createElement("label"); lb.textContent = label; lb.style.cssText = "width:56px;color:var(--font-black-minor)"; r2.appendChild(lb);
    const i2 = document.createElement("input"); i2.type = "checkbox"; i2.checked = !!val;
    i2.onchange = () => { cb(i2.checked); E.markDirty(); };
    r2.appendChild(i2); pane.appendChild(r2);
  };
  chk("参与碰撞", m.collision, (v) => { m.collision = v; });
  chk("可推动", !!m.collision && !m.fixed, (v) => { m.collision = true; m.fixed = !v; if (v) m.gravity = false; });
  chk("受重力", m.gravity, (v) => { m.gravity = v; if (v) m.fixed = false; });
  chk("固定不动", m.fixed, (v) => { m.fixed = v; if (v) m.gravity = false; });
  chk("显示", m.hidden !== true, (v) => { m.hidden = !v; if (m.object) m.object.visible = v; });
  const numRow = (label, val, min, max, step, cb) => {
    const r2 = document.createElement("div"); r2.className = "frow"; r2.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:11px";
    const lb = document.createElement("label"); lb.textContent = label; lb.style.cssText = "width:56px;color:var(--font-black-minor)"; r2.appendChild(lb);
    const i2 = document.createElement("input"); i2.type = "number"; i2.value = val; i2.min = min; i2.max = max; i2.step = step; i2.style.cssText = "flex:1;min-width:0";
    i2.onchange = () => { cb(parseFloat(i2.value) || 0); E.markDirty(); };
    r2.appendChild(i2); pane.appendChild(r2);
  };
  numRow("质量", m.mass ?? 1, 0.1, 1000, 0.1, (v) => { m.mass = v; });
  numRow("摩擦", m.friction ?? 1, 0, 1, 0.05, (v) => { m.friction = v; });
  numRow("弹性", m.restitution ?? 0, 0, 1, 0.05, (v) => { m.restitution = v; });
  numRow("自发光", m.emissive ?? 0, 0, 1, 0.05, (v) => { m.emissive = v; });
  numRow("金属度", m.metalness ?? 0, 0, 1, 0.05, (v) => { m.metalness = v; });
  numRow("光泽", m.shininess ?? 0, 0, 1, 0.05, (v) => { m.shininess = v; });
  const section = (text) => {
    const d = document.createElement("div");
    d.style.cssText = "padding:6px 8px 2px;font-size:10px;color:var(--font-black-minor)";
    d.textContent = text; pane.appendChild(d);
  };
  section("伤害（官方 damage）");
  const dmgOn = !!(m.damage && m.damage.enabled);
  chk("可受伤", dmgOn, (v) => {
    m.damage = v ? Object.assign({ enabled: true, hp: 100, maxHp: 100, showDamage: true, showHealth: true }, m.damage || {}, { enabled: true }) : null;
    renderEntProps();
  });
  if (dmgOn) {
    numRow("当前血量", m.damage.hp ?? 100, 1, 100000, 1, (v) => { m.damage.hp = v; });
    numRow("血量上限", m.damage.maxHp ?? 100, 1, 100000, 1, (v) => { m.damage.maxHp = v; });
    chk("显示血条", m.damage.showHealth !== false, (v) => { m.damage.showHealth = v; });
    chk("显示飘字", m.damage.showDamage !== false, (v) => { m.damage.showDamage = v; });
  }
  section("音效（官方 sound · 取样已导入的 40 个音频）");
  const names = (E.state.assets && E.state.assets.audioNames) || [];
  const snd = () => (m.sound = m.sound || {});
  const spec = (slot) => (m.sound && m.sound[slot]) || null;
  for (const [label, slot] of [["聊天", "chat"], ["受伤", "hurt"], ["死亡", "die"], ["交互", "interact"]]) {
    const r2 = document.createElement("div"); r2.className = "frow";
    r2.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 8px;font-size:11px";
    const lb = document.createElement("label"); lb.textContent = label;
    lb.style.cssText = "width:56px;color:var(--font-black-minor)"; r2.appendChild(lb);
    const sel = document.createElement("select"); sel.style.cssText = "flex:1;min-width:0";
    const cur = (spec(slot) || {}).sample || "";
    const opt = (text, value) => { const o = document.createElement("option"); o.textContent = text; o.value = value; if (cur === value) o.selected = true; sel.appendChild(o); };
    opt("无", "");
    names.forEach((n) => opt(n.replace(/\.[a-z0-9]+$/i, ""), "audio/" + n));
    if (cur && !names.some((n) => "audio/" + n === cur)) opt(cur, cur);
    sel.onchange = () => {
      const s = snd();
      s[slot] = Object.assign({ gain: 1, gainRange: 0, pitch: 1, pitchRange: 0, radius: 32, sample: "" }, s[slot] || {}, { sample: sel.value });
      if (!sel.value) delete s[slot];
      E.markDirty();
    };
    r2.appendChild(sel); pane.appendChild(r2);
  }
  const sub = document.createElement("div"); sub.style.cssText = "padding:2px 8px;font-size:10px;color:var(--font-black-minor)";
  sub.textContent = "参与碰撞＝实心盒（会被挡住、可站上去）；再关掉「固定不动」即可被玩家推动。脚本以 #名称 选择实体、以 .标签 批量选择。";
  pane.appendChild(sub);
}

// 用位置滑杆移动选中模型（官方 position 是浮点块坐标，不做格心偏移）
export function moveSelectedModel(x, y, z) {
  const e = E; const m = e.state.selectedModel; if (!m) return;
  m.pos = [x, y, z];
  m.object.position.set(x, y, z);
}

/* ------------------------------ zip 项目包导入 ------------------------------ */
export async function importProject(file) {
  const e = E;
  const res = await io.importProjectZip(file);
  if (!res.world) { e.toast("导入失败：" + res.warnings.join("；")); return false; }
  // block.json 点名了、但包里没带的配置：问一句再联网取。逻辑在 io.completeMissingFromBlock，
  // 工作台那条导入路径共用同一段——以前两边各写一份，工作台那份干脆没问，
  // 于是官方清单式导出永远是"导入成功、0 个实体"。
  await io.completeMissingFromBlock(res, { onProgress: (k) => e.toast("正在取回 " + k + "…") });
  const prev = e.state.meta || {};
  const cfg = res.projectCfg || {};
  const meta = Object.assign(prev, {
    name: res.name, displayName: res.name, terrain: e.state.terrain,
    scripts: res.scripts.length ? res.scripts : (prev.scripts || []),
    entities: res.entities || [], groups: res.groups || [], models: [],
    meshNames: (res.meshNames && res.meshNames.length) ? res.meshNames : (prev.meshNames || []),
  });
  if (cfg.player) {
    // 认**形状**而不是认数值大小：官方 blob 一定带 allowJump / noClip / cameraType 这类
    // 只有官方才有的键。旧写法是 "walkSpeed > 1 就当旧单位"，可官方中跑速本来就是 0.4，
    // 一旦某张图把它填成 2，整份玩家属性会被再按 15.625 除一遍，速度全废。
    const OFFICIAL_ONLY = ["allowJump", "allowDoubleJump", "allowFlight", "allowMove", "allowCrouch",
      "noClip", "cameraType", "playerSounds", "movementBounds", "initialPosition"];
    const official = OFFICIAL_ONLY.some((k) => k in cfg.player);
    meta.player = Object.assign({}, cfg.player, { _units: official ? "official" : "legacy" });
  }
  if (cfg.physics) {
    meta.worldSettings = Object.assign({}, prev.worldSettings, cfg.physics, {
      airFriction: cfg.physics.airFriction ?? cfg.physics.velocityDamping ?? 0.01,
      useOBB: !!cfg.physics.useOBB,
    });
  }
  if (cfg.ambientSound) meta.ambientSound = cfg.ambientSound;
  // 官方 environment blob 有 46 个叶子键，换算成内部扁平键后再落盘，不能整块丢弃
  if (cfg.environment && (cfg.environment.fog || cfg.environment.sky)) {
    const hexOf = (c) => "#" + [c.red, c.green, c.blue].map((v) => Math.round(Math.max(0, Math.min(1, +v || 0)) * 255).toString(16).padStart(2, "0")).join("");
    const cl = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
    const flat = io.fromOfficialEnvironment(cfg.environment);
    meta.worldSettings = Object.assign({}, meta.worldSettings, flat);
    // 这里必须是 e.state：features.js 没有模块级的 state，这一句是从 main.js 抄过来的。
    // 于是只要包里带 environment.json，整段就抛 ReferenceError、导入半途而废——
    // 而官方 dao3 包一定带这个文件，所以这条分支从来没跑通过。
    const tn = e.state.terrain || {};
    if (flat.fogUniformDensity != null) tn.fogDensity = flat.fogUniformDensity;
    if (flat.skyTopLight) tn.skyTop = hexOf(flat.skyTopLight);
    if (flat.skyBottomLight) tn.skyBottom = hexOf(flat.skyBottomLight);
    if (flat.sunLight) {
      const luma = (Number(flat.sunLight.red) + Number(flat.sunLight.green) + Number(flat.sunLight.blue)) / 3;
      if (luma <= 1.001) tn.sunIntensity = cl(luma, 0, 4);
    }
    if (flat.globalLight != null) tn.ambient = cl(flat.globalLight, 0, 1);
    if (flat.sunPhase != null) tn.dayNight = flat.sunPhase;
    e.applyTerrain && e.applyTerrain();
  }
  if (cfg.zones) meta.zones = cfg.zones;
  if (Array.isArray(cfg.ui)) meta.ui = cfg.ui; // 界面部件走 compat，官方 uiTree 是 nodes 形态
  if (Array.isArray(cfg.products)) meta.products = cfg.products;
  if (cfg.gameRules) meta.gameRules = Object.assign({}, prev.gameRules, cfg.gameRules);
  if (cfg.displayName) { meta.displayName = cfg.displayName; meta.name = cfg.displayName; }
  if (cfg.description != null) meta.description = cfg.description;
  e.state.meta = meta;
  e.state.scripts = meta.scripts;
  // 官方资源表（project/assets.json）里的 audio/lut/part 名字要落到面板真正读的那两处：
  // 音效下拉读 state.assets.audioNames，导出时再写回 assets.json。
  // 只把"zip 里带了音频字节"的键当音效表是不够的——官方包常常只登记不携带文件。
  const audioNames = [...new Set([...Object.keys(res.audio || {}), ...((res.assetNames && res.assetNames.audio) || [])])];
  // .vox 转成可渲染模型，并按实体引用的裸名注册进 meshes：注册名和 d.mesh 必须同一口径，
  // 否则 applySceneModels 取不到东西，整张图就只剩标记框。单个失败不该拖垮整次导入。
  let voxOk = 0;
  for (const vm of res.voxMeshes || []) {
    try { res.meshes[vm.name] = { object: voxListToModel(vm.voxels, E.atlas), scale: 1 }; voxOk++; }
    catch (err) { res.warnings.push(`网格「${vm.name}」建模失败: ${(err && err.message) || err}`); }
  }
  if (voxOk) res.warnings.push(`已把 ${voxOk} 个 .vox 网格转成可渲染模型`);
  // .vb 走同一条建模管线：先解成体素列表，颜色按**实际 hex 最近邻**映到图集方块，
  // 而不是按序号硬取——图集顺序和 VOXA 调色板毫无关系，按序号会把白雕像染成荧光绿。
  let vbOk = 0;
  for (const vm of res.vbMeshes || []) {
    try {
      const list = vbToVoxList(vm.json, E.atlas.list());
      if (!list || !list.voxels.length) { res.warnings.push(`网格「${vm.name}」解出来是空的`); continue; }
      res.meshes[vm.name] = { object: voxListToModel(list.voxels, E.atlas), scale: 1 };
      vbOk++;
    } catch (err) { res.warnings.push(`网格「${vm.name}」建模失败: ${(err && err.message) || err}`); }
  }
  if (vbOk) res.warnings.push(`已把 ${vbOk} 个 .vb 网格解成体素并建模`);
  // **网格必须落盘。** 之前只把名字写进 meta.meshNames，几何体留在内存里：
  // 于是"导入成功、这次会话里看得见"，一存盘重开就什么都不剩，
  // 而且因为 assetRoot 还指着上一张图的目录，每次打开都要打上百个 404。
  const meshFiles = [
    ...(res.meshFiles || []).map((f) => ({ rel: "models/" + f.name + f.ext, bytes: f.bytes })),
    ...(res.voxMeshes || []).filter((v) => v.bytes).map((v) => ({ rel: "models/" + v.name + ".vox", bytes: v.bytes })),
    ...(res.vbMeshes || []).filter((v) => v.bytes).map((v) => ({ rel: "models/" + v.name + ".vb", bytes: v.bytes })),
  ];
  const wid = e.worldId || window.__worldId;
  let stored = 0;
  if (wid) {
    for (const f of meshFiles) {
      try {
        const r = await fetch(`/api/world/${encodeURIComponent(wid)}/asset?path=${encodeURIComponent(f.rel)}`, { method: "POST", body: f.bytes });
        if (r.ok) stored++;
      } catch { /* 单个存不上不该让整次导入失败，下面统一报数 */ }
    }
  }
  if (stored) meta.assetRoot = `/assets/worlds/${wid}/models/`;
  else if ((meta.meshNames || []).length) {
    // 包里有网格名但没有网格文件（官方 map-master-full 一类导出不含网格本体，
    // 那些在官方那边是按 CID 从 IPFS 取的）。这时**不要**再猜一个目录去 fetch：
    // 猜赛车目录就会像刚才那样一次打开刷出 161 个 404，还全都报"加载失败"。
    delete meta.assetRoot;
    res.warnings.push(`${meta.meshNames.length} 个网格只有名字、包里没有网格文件（官方部分导出不含网格本体）；这些实体以标记框显示`);
  }
  e.state.assets = { audio: res.audio, meshes: res.meshes, meshNames: meta.meshNames, audioNames };
  // 官方资源表（路径 → {hash,type,size}）与它的 CID：代码包面板要靠这两样
  // 才能把"名字下面那个内容地址"显示出来，并按地址把包里没带的文件取回来。
  meta.assetIndex = res.assets || prev.assetIndex || null;
  meta.assetsCid = (res.block && res.block.assets) || null;
  // 按 CID 取回来但还没映射的部分先原样存着，别丢——重映射时不用再联网
  meta.remoteCfg = res.remoteCfg || prev.remoteCfg || null;
  meta.lutNames = (res.assetNames && res.assetNames.lut) || [];
  meta.partNames = (res.assetNames && res.assetNames.part) || [];
  meta.pictureNames = (cfg.pictureNames && cfg.pictureNames.length) ? cfg.pictureNames : (res.pictureNames || []);
  // 派生状态必须跟着换。实体标记与场景模型是 state.entities / state.models 驱动的，
  // 而画面上那些标记读的是 state.entities（不是 meta.entities）——
  // 之前只换了 meta，于是导入后画面里没有这张图的实体，模型列表却还是上一张图的。
  e.state.entities = meta.entities;
  e.state.models = [];
  e.state.selectedModel = null;
  e.__scriptIdx = 0;
  renderScriptFiles();
  if (window.__replaceWorld) window.__replaceWorld(res.world); // 内部按 meta.entities 重建场景模型
  const refs = io.extractEntityRefs(res.scripts);
  const names = new Set((meta.entities || []).map((d) => d.name));
  const missing = [...refs.ids].filter((id) => !names.has(id) && !(e.state.models || []).some((m) => m.name === id));
  const missingTags = [...refs.tags].filter((t) => !(meta.entities || []).some((x) => (x.tags || []).includes(t)));
  if (missing.length || missingTags.length) genEntitiesFromScript();
  if (E.ui && E.ui.refreshTree) E.ui.refreshTree();
  renderModelList();
  // 每个面板都是初始化时一次性把 meta 灌进 DOM 的，换整块 meta 之后必须重建。
  // 不重建不只是"数字是旧的"：世界参数滑杆握着的是被丢弃的旧 ws 对象，
  // 用户拖它改的是空气——看着生效了，一存盘全没有。
  if (E.ui && E.ui.reloadPanels) E.ui.reloadPanels();
  // 导入即改动。不标脏的话「返回主界面」那句 if (state.dirty) 不成立，
  // 一整张刚导入的图会被静默丢掉。
  e.markDirty();
  const warns = res.warnings.length ? "\n" + res.warnings.join("\n") : "";
  // 报数只能用"最后真的落到标记框上的实体数"，不能拿实体数去比网格文件数：
  // 一个网格文件常被多个实体复用（赤碧城 19 个 .vox 撑起 34 个实体），
  // 按文件数一比就得出"34 个实体的网格不在包里"，而实际全摆出来了。
  const gotMesh = Object.keys(res.meshes || {}).length;
  // 网格是异步 ensure 的，等摆完再报——否则这个数只能是还没摆之前的错觉
  await (e.modelsReady || Promise.resolve());
  const unplaced = (e.state.entities || []).filter((d) => d.mesh).length;
  e.toast(`已导入「${res.name}」· ${meta.entities.length} 实体 / ${res.scripts.length} 脚本 / ${gotMesh} 个网格文件`
    + (unplaced ? `（${unplaced} 个实体引用的网格不在包里，已用标记框显示）` : "") + warns);
  // 只有包里真的带脚本才跳到脚本页：导入一张图之后用户想看的是世界，
  // 而官方 dao3 包经常是空 scripts/（这次就是），硬跳过去等于把成果盖住。
  if (res.scripts.length) {
    document.getElementById("scriptScreen").classList.add("show");
    E.ctx.mode = "script";
  }
  return true;
}
/* ------------------------------ 玩家设置（顶部「玩家」tab） ------------------------------ */
// 官方单位制：速度/力度为"每 tick（64ms）格数"，见 api/GamePlayerEntity/input.md
const PL_DEFAULTS = {
  _units: "tick", name: "玩家",
  walkSpeed: 0.22, walkAcceleration: 0.19, runSpeed: 0.4, runAcceleration: 0.35,
  crouchSpeed: 0.1, crouchAcceleration: 0.09, flySpeed: 2, swimSpeed: 0.4,
  jumpPower: 0.96, doubleJumpPower: 0.9, cameraMode: "follow", cameraFreezedAxis: "", cameraDistance: 8.5, cameraFovY: 0.25,
  canFly: false, invisible: false, spectator: false, enableJump: true, enableDoubleJump: true,
};
// 旧存档用的是"格/秒"单位与 FIRST/THIRD 枚举，按官方口径迁移
export function migratePlayerMeta(raw) {
  const p = Object.assign({}, raw || {});
  // 空槽补官方默认档（脚步/跳跃/二段跳/落地/游泳/入水/重生 + 受击/死亡/发言/交互）。
  // 放在这个唯一入口里：编辑器面板、运行期、导出三条路都经过它，
  // 所以面板里看到的就是会响的，作者改过的槽也不会被覆盖。
  applyDefaultPlayerSounds(p);
  const validCam = ["follow", "fps", "fixed", "relative"].includes(p.cameraMode);
  // 官方 project.json 的 player 段：数值本来就是「每 tick」单位，只需改名对齐内部字段
  if (p._units === "official") {
    const local = io.fromOfficialPlayer(p);
    const out = Object.assign({}, PL_DEFAULTS, local);
    out.canFly = !!p.allowFlight;
    out.enableJump = p.allowJump !== false;
    out.enableDoubleJump = p.allowDoubleJump !== false;
    out.enableCrouch = p.allowCrouch !== false;
    out.spectator = !!p.noClip; // 官方 blob 里穿墙叫 noClip，运行期 API 叫 spectator
    out.name = p.name || PL_DEFAULTS.name;
    out._units = "tick";
    return out;
  }
  // 默认一律官方第三人称跟随；只有玩家在面板里显式改过镜头才沿用其选择
  if (p._units === "tick") {
    if (!(p._camSet && validCam)) p.cameraMode = "follow";
    return p;
  }
  const per = 1000 / 64;
  const conv = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? +(n / per).toFixed(3) : dflt; };
  const out = Object.assign({}, PL_DEFAULTS, p);
  out.walkSpeed = conv(p.walkSpeed, PL_DEFAULTS.walkSpeed);
  out.runSpeed = conv(p.runSpeed, PL_DEFAULTS.runSpeed);
  out.crouchSpeed = conv(p.crouchSpeed, PL_DEFAULTS.crouchSpeed);
  out.jumpPower = p.jumpPower === 0 ? 0 : conv(p.jumpPower, PL_DEFAULTS.jumpPower);
  out.cameraMode = p._camSet && validCam ? p.cameraMode : "follow";
  out._units = "tick";
  return out;
}
const FREEZE_AXES = ["", "x", "y", "z", "xy", "xz", "yz", "xyz"]; // 官方 GameCameraFreezedAxis
// 官方 playerSounds 的 14 个槽、ambientSound 的 5 个槽、Gamepad 的图标槽
const PL_SOUND_SLOTS = [["跳跃", "jump"], ["二段跳", "doubleJump"], ["落地", "land"], ["蹲下", "crouch"], ["脚步", "step"],
  ["游泳", "swim"], ["入水", "enterWater"], ["出水", "leaveWater"], ["起飞", "startFly"], ["停飞", "endFly"],
  ["出生", "spawn"], ["动作 A", "action0"], ["动作 B", "action1"], ["背景音乐", "music"]];
const AMBIENT_SLOTS = [["破坏方块", "breakVoxel"], ["放置方块", "placeVoxel"], ["玩家加入", "playerJoin"],
  ["玩家离开", "playerLeave"], ["环境底噪", "ambient"]];
const SKIN_PARTS = [["hips", "髋"], ["torso", "躯干"], ["neck", "颈"], ["head", "头"],
  ["leftShoulder", "左肩"], ["leftUpperArm", "左上臂"], ["leftLowerArm", "左小臂"], ["leftHand", "左手"],
  ["rightShoulder", "右肩"], ["rightUpperArm", "右上臂"], ["rightLowerArm", "右小臂"], ["rightHand", "右手"],
  ["leftUpperLeg", "左大腿"], ["leftLowerLeg", "左小腿"], ["leftFoot", "左脚"],
  ["rightUpperLeg", "右大腿"], ["rightLowerLeg", "右小腿"], ["rightFoot", "右脚"]];
const PAD_SLOTS = [["摇杆底盘", "joystickBackground"], ["摇杆帽", "joystickController"], ["跳跃键", "jump"],
  ["蹲下键", "crouch"], ["动作 A", "actionA"], ["动作 B", "actionB"], ["飞行键", "flyButton"],
  ["飞行底盘", "flyingBackground"], ["飞行帽", "flyingController"]];
const SOUND_DEFAULT = { gain: 1, gainRange: 0, pitch: 1, pitchRange: 0, radius: 32, sample: "" };
function wirePlayer() {
  const e = E;
  e.state.meta.player = migratePlayerMeta(e.state.meta.player);
  const panel = document.getElementById("playerPanel");
  const $ = (id) => document.getElementById(id);
  const num = (id, min, max, dflt) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? clampF(v, min, max) : dflt;
  };
  function load() {
    const p = e.state.meta.player;
    $("plName").value = p.name;
    $("plWalk").value = p.walkSpeed; $("plRun").value = p.runSpeed; $("plCrouch").value = p.crouchSpeed;
    $("plJump").value = p.jumpPower; $("plJump2").value = p.doubleJumpPower;
    $("plCam").value = p.cameraMode; $("plDist").value = p.cameraDistance; $("plFov").value = p.cameraFovY;
    if ($("plFreeze")) $("plFreeze").value = FREEZE_AXES.includes(p.cameraFreezedAxis) ? p.cameraFreezedAxis : "";
    $("plFly").checked = !!p.canFly; $("plInvisible").checked = !!p.invisible;
    $("plSpectator").checked = !!p.spectator; $("plEnableJump").checked = p.enableJump !== false;
    $("plEnableDouble").checked = p.enableDoubleJump !== false;
    $("plScale").value = p.scale ?? 1;
    $("plColor").value = rgbToHex(p.color);
    $("plEmissive").value = p.emissive ?? 0; $("plMetal").value = p.metalness ?? 0; $("plShine").value = p.shininess ?? 0;
    $("plShowName").checked = p.showName !== false; $("plShowInd").checked = !!p.showIndicator;
    extras.load();
  }
  // 面板负责官方 player 配置里的这些键，其余官方键（damage/movementBounds/initialPosition/…）必须原样保留
  const PANEL_KEYS = ["name", "walkSpeed", "runSpeed", "crouchSpeed", "jumpPower", "doubleJumpPower", "cameraMode",
    "cameraFreezedAxis", "cameraDistance", "cameraFovY", "canFly", "invisible", "spectator", "enableJump",
    "enableDoubleJump", "scale", "color", "emissive", "metalness", "shininess", "showName", "showIndicator",
    "_units", "_camSet"];
  function save() {
    const prev = e.state.meta.player || {};
    e.state.meta.player = Object.assign({}, prev, {
      _units: prev._units || "tick", _camSet: true,
      name: $("plName").value || "玩家",
      walkSpeed: num("plWalk", 0.01, 4), runSpeed: num("plRun", 0.01, 8), crouchSpeed: num("plCrouch", 0.01, 4),
      jumpPower: num("plJump", 0, 4), doubleJumpPower: num("plJump2", 0, 4),
      cameraMode: $("plCam").value, cameraFreezedAxis: $("plFreeze") ? $("plFreeze").value : (prev.cameraFreezedAxis || ""),
      cameraDistance: num("plDist", 1, 40), cameraFovY: num("plFov", 0.05, 1.8),
      canFly: $("plFly").checked, invisible: $("plInvisible").checked, spectator: $("plSpectator").checked,
      enableJump: $("plEnableJump").checked, enableDoubleJump: $("plEnableDouble").checked,
      scale: num("plScale", 0.1, 8, 1), color: hexToRgb01($("plColor").value),
      emissive: num("plEmissive", 0, 16, 0), metalness: num("plMetal", 0, 4, 0), shininess: num("plShine", 0, 4, 0),
      showName: $("plShowName").checked, showIndicator: $("plShowInd").checked,
    });
    e.markDirty();
  }
  ["plName", "plWalk", "plRun", "plCrouch", "plJump", "plJump2", "plCam", "plFreeze", "plDist", "plFov",
    "plFly", "plInvisible", "plSpectator", "plEnableJump", "plEnableDouble",
    "plScale", "plColor", "plEmissive", "plMetal", "plShine", "plShowName", "plShowInd"].forEach((id) => { const el = $(id); if (el) el.onchange = save; });
  $("plReset").onclick = () => {
    // 只把面板管的键恢复成官方默认，面板之外的官方键（damage / movementBounds / playerSounds …）保持不动
    const prev = e.state.meta.player || {};
    const kept = {};
    for (const k of Object.keys(prev)) if (!PANEL_KEYS.includes(k)) kept[k] = prev[k];
    e.state.meta.player = Object.assign({}, PL_DEFAULTS, kept, { _units: "tick", _camSet: prev._camSet });
    load(); e.markDirty(); e.toast("已恢复官方默认玩家属性（其余官方字段保留）");
  };
  $("plOk").onclick = () => { panel.classList.remove("show"); e.toast("玩家设置已保存"); };
  const extras = buildPlayerExtras(e, $);
  load();
  // 换图（导入项目包）之后必须能被重新灌一次值，否则面板仍是上一张图的玩家属性
  E.ui && E.ui.onReload && E.ui.onReload(load);
  e.syncPlayerPanel = load;
  mountPlayerAsAttrsPanel(e, panel, $, load);
}

/**
 * 把现成的「玩家属性」表单搬进官方那个左栏弹窗，而不是再复制一份表单。
 *
 * 官方截图里 玩家 是**一个**弹窗 + 左侧导航（属性 / 皮肤库 / 虚拟按键），
 * 而我们原来只有一个孤立的 #playerPanel 遮罩。与其把这套表单（含 14 槽音效、
 * 18 槽皮肤、9 槽按键图标）重写一遍——重写必然漂移——不如整体挪 DOM：
 * 事件都绑在元素自身上，换爹不掉监听，字段口径因此和旧面板逐字节一致。
 * 关掉时再挪回 #playerPanel，任何还按老路径找它的人都不会拿到空节点。
 */
function mountPlayerAsAttrsPanel(e, panel, $, reload) {
  const box = panel.querySelector(".modal-box");
  if (!box) return;
  // 注册是异步的，而用户可能在 boot 后立刻点「玩家」。把 promise 存下来，
  // openPlayerModal 先 await 它——否则 PANELS 里还没有 "attrs"，
  // openPlayerModal 会静默返回 null，表现为"点了 tab 什么也没发生"。
  const ready = import("./panels/player-modal-shell.js").then((shell) => {
    shell.registerPanel("attrs", {
      title: "玩家属性",
      render: (ctx) => {
        const keep = document.createComment("playerPanel-slot");
        box.parentNode && box.parentNode.insertBefore(keep, box);
        const wrap = document.createElement("div");
        wrap.className = "pm-attrs";
        ctx.el.appendChild(wrap);
        wrap.appendChild(box);
        const ok = $("plOk");
        const prevOk = ok && ok.onclick;
        if (ok) ok.onclick = () => { shell.closePlayerModal(); e.toast("玩家设置已保存"); };
        return () => {
          if (keep.parentNode) { keep.parentNode.insertBefore(box, keep); keep.remove(); }
          wrap.remove();
          if (ok) ok.onclick = prevOk;
        };
      },
    });
    return shell;
  });
  e.openPlayerModal = async () => {
    const shell = await ready;
    const s = await shell.openPlayerModal(e, "attrs");
    // null = 弹窗没起来。老遮罩是最后的兜底：玩家属性不能改不了。
    if (!s) { panel.classList.add("show"); reload(); }
    return s;
  };
}

// 官方颜色既可能是 GameRGBColor({red,green,blue})，也可能是 project.json 里的 [r,g,b]（0..1），
// 还可能是皮肤库写的 "#rrggbb" 字符串（运行时 skinColorOf 只认这一种）。
// 少了字符串分支，套完皮肤再开玩家面板，那 18 个取色器会整片显示成黑色——
// 看上去像皮肤把角色涂黑了，其实是面板读不出来。
function rgbToHex(c) {
  if (!c) return "#f2c27d";
  if (typeof c === "string") return /^#[0-9a-f]{6}$/i.test(c) ? c : "#f2c27d";
  const v = Array.isArray(c) ? c : [c.red ?? c.r, c.green ?? c.g, c.blue ?? c.b];
  const hx = (x) => Math.max(0, Math.min(255, Math.round((Number(x) || 0) * 255))).toString(16).padStart(2, "0");
  return "#" + hx(v[0]) + hx(v[1]) + hx(v[2]);
}
const hexToRgb01 = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16) / 255);

/* 玩家面板里那 4 组「按官方结构嵌套」的设置：音效 / 环境音 / 皮肤 / 虚拟按键。
   行由代码生成，值直接写回 meta.player.playerSounds / meta.ambientSound / skin / gamepad，
   保持与官方 project.json 同一形状，导出时无需二次转换。 */
function buildPlayerExtras(e, $) {
  const names = () => (e.state.assets && e.state.assets.audioNames) || [];
  const row = (host, label, input) => {
    const r = document.createElement("div");
    r.className = "pp-cell";
    const lb = document.createElement("label"); lb.textContent = label;
    r.appendChild(lb); r.appendChild(input); host.appendChild(r);
    return r;
  };
  const audioSelect = (get, set) => {
    const sel = document.createElement("select");
    const fill = () => {
      // 官方空槽写的是 "audio/.mp3"（文件名以点开头），语义上就是「没有音效」
      const raw = get() || "";
      const cur = !raw || /\/\.[a-z0-9]+$/i.test(raw) ? "" : raw;
      sel.innerHTML = "";
      const add = (text, value) => { const o = document.createElement("option"); o.textContent = text; o.value = value; if (cur === value) o.selected = true; sel.appendChild(o); };
      add("无", "");
      for (const n of names()) add(n.replace(/\.[a-z0-9]+$/i, ""), "audio/" + n);
      // 官方模板引用了本地没有的文件（dive/splash…）：仍要能显示并保留原值，不能静默丢掉
      if (cur && !names().some((n) => "audio/" + n === cur)) add(cur.replace(/^audio\//, "").replace(/\.[a-z0-9]+$/i, "") + "（缺文件）", cur);
      sel.value = cur;
    };
    fill();
    sel.onchange = () => { set(sel.value); e.markDirty(); };
    return sel;
  };
  const textInput = (get, set, ph) => {
    const i = document.createElement("input");
    i.type = "text"; i.placeholder = ph || "picture/…"; i.value = get() || "";
    i.onchange = () => { set(i.value.trim()); e.markDirty(); };
    return i;
  };
  const colorInput = (get, set) => {
    const i = document.createElement("input");
    i.type = "color"; i.value = rgbToHex(get());
    i.onchange = () => { set(hexToRgb01(i.value)); e.markDirty(); };
    return i;
  };
  const chkInput = (get, set, label) => {
    const l = document.createElement("label"); l.className = "pp-chk";
    const i = document.createElement("input"); i.type = "checkbox"; i.checked = !!get();
    i.onchange = () => { set(i.checked); e.markDirty(); };
    l.appendChild(i); l.appendChild(document.createTextNode(label || "隐藏"));
    return l;
  };
  const host = (id) => $(id);

  function load() {
    const p = e.state.meta.player;
    const ps = (p.playerSounds = p.playerSounds || {});
    const amb = (e.state.meta.ambientSound = e.state.meta.ambientSound || {});
    const skin = (p.skin = p.skin || {});
    const skinOff = (p.skinInvisible = p.skinInvisible || {});
    const pad = (p.gamepad = p.gamepad || {});
    const spec = (o) => (o && typeof o === "object" ? o.sample || "" : String(o || ""));
    const setSpec = (o, k, sample) => { o[k] = Object.assign({}, SOUND_DEFAULT, o[k] || {}, { sample }); if (!sample) delete o[k]; };
    for (const id of ["plSounds", "plAmbient", "plSkin", "plPad"]) host(id).innerHTML = "";
    for (const [label, slot] of PL_SOUND_SLOTS) {
      row(host("plSounds"), label, audioSelect(() => spec(ps[slot]), (v) => setSpec(ps, slot, v)));
    }
    for (const [label, slot] of AMBIENT_SLOTS) {
      row(host("plAmbient"), label, audioSelect(() => spec(amb[slot]), (v) => setSpec(amb, slot, v)));
    }
    for (const [part, label] of SKIN_PARTS) {
      const cell = document.createElement("div");
      cell.className = "pp-cell pp-cell3";
      const lb = document.createElement("label"); lb.textContent = label;
      cell.appendChild(lb);
      cell.appendChild(colorInput(() => skin[part], (v) => { skin[part] = { r: v[0], g: v[1], b: v[2] }; }));
      cell.appendChild(chkInput(() => skinOff[part], (v) => { skinOff[part] = v; }));
      host("plSkin").appendChild(cell);
    }
    for (const [label, slot] of PAD_SLOTS) {
      row(host("plPad"), label, textInput(() => pad[slot] || "", (v) => { pad[slot] = v; }));
    }
  }
  return { load };
}

/* ------------------------------ 界面编辑器（顶部「界面」tab） ------------------------------ */
function wireUiEditor() {
  const e = E;
  e.state.meta.ui = e.state.meta.ui || [];
  const screen = document.getElementById("uiScreen");
  const stage = document.getElementById("uiStage");
  const list = document.getElementById("uiList");
  const props = document.getElementById("uiProps");
  let sel = null, drag = null;
  const $ = (id) => document.getElementById(id);

  function widgets() { return e.state.meta.ui; }
  function persist() { e.markDirty(); }
  // 项目内图片路径 → URL：与运行时 GameRuntime._assetUrl 同一套规则（编辑器里也要能预览）
  function pictureUrl(src) {
    const s = String(src == null ? "" : src).trim();
    if (!s) return "";
    if (/^(https?:|data:|blob:|\/)/i.test(s)) return s;
    const root = (e.state.meta && e.state.meta.assetRoot) || "";
    const rel = s.replace(/^\.\//, "");
    const pics = (e.state.meta && e.state.meta.pictureNames) || [];
    if (pics.includes(rel)) return root + rel;
    if (pics.includes("picture/" + rel)) return root + "picture/" + rel;
    return root + (rel.includes("/") ? rel : "picture/" + rel);
  }
  function render() {
    stage.innerHTML = "";
    list.innerHTML = "";
    for (const w of widgets()) {
      const el = document.createElement("div");
      el.className = "uiw-ed uiw-" + w.type + (sel === w.id ? " sel" : "");
      el.dataset.wid = w.id;
      const label = w.type === "button" ? "按钮" : w.type === "image" ? "图片" : "文本";
      if (w.type === "image") {
        const im = document.createElement("img");
        im.src = pictureUrl(w.image || w.text);
        im.alt = "";
        im.style.cssText = "width:100%;height:100%;object-fit:contain;display:block";
        el.appendChild(im);
      } else el.textContent = w.text || label;
      el.style.cssText = `left:${w.x}%;top:${w.y}%;width:${w.w}%;height:${w.h}%;font-size:${w.size || 14}px;color:${w.color || "#fff"};${w.bg ? "background:" + w.bg + ";" : ""}`;
      el.onmousedown = (ev) => startDrag(ev, w);
      stage.appendChild(el);
      const it = document.createElement("button");
      it.className = "sfile" + (sel === w.id ? " active" : "");
      it.innerHTML = `<span class="sdot"></span><span>${label} · ${w.id}</span>`;
      it.onclick = () => { sel = w.id; render(); };
      list.appendChild(it);
    }
    if (!widgets().length) list.innerHTML = '<div class="muted" style="padding:8px;font-size:12px">暂无控件 · 用右上角按钮添加</div>';
    renderProps();
  }
  function renderProps() {
    const w = widgets().find((x) => x.id === sel);
    if (!w) { props.innerHTML = '<div class="muted" style="padding:8px;font-size:12px">选中一个控件后编辑属性</div>'; return; }
    props.innerHTML = "";
    const row = (label, input) => { const r = document.createElement("div"); r.className = "frow"; r.innerHTML = `<label>${label}</label>`; r.appendChild(input); props.appendChild(r); };
    const mk = (type, val, cb, attrs = "") => { const i = document.createElement("input"); i.type = type; i.value = val; i.onchange = () => { cb(i); persist(); render(); }; i.setAttribute("style", attrs); return i; };
    row("ID", mk("text", w.id, (i) => { w.id = i.value.trim() || w.id; }));
    if (w.type === "image") {
      // 图片路径可手填，也可从项目内 picture/ 资产里选（resources.ls("picture") 的同一份名单）
      const dl = "picList";
      if (!document.getElementById(dl)) {
        const d = document.createElement("datalist");
        d.id = dl;
        document.body.appendChild(d);
      }
      const pics = (e.state.meta && e.state.meta.pictureNames) || [];
      document.getElementById(dl).innerHTML = pics.map((p) => `<option value="${p.replace(/"/g, "&quot;")}"></option>`).join("");
      const i = mk("text", w.image || w.text || "", (el) => { w.image = el.value.trim(); w.text = w.image; });
      i.setAttribute("list", dl);
      i.placeholder = pics.length ? "picture/…" : "picture/xxx.png（项目内暂无图片）";
      row("图片路径", i);
    } else row("文本", mk("text", w.text || "", (i) => { w.text = i.value; }));
    row("X%", mk("number", w.x, (i) => { w.x = Math.max(0, Math.min(100, +i.value || 0)); }));
    row("Y%", mk("number", w.y, (i) => { w.y = Math.max(0, Math.min(100, +i.value || 0)); }));
    row("宽%", mk("number", w.w, (i) => { w.w = Math.max(2, Math.min(100, +i.value || 10)); }));
    row("高%", mk("number", w.h, (i) => { w.h = Math.max(2, Math.min(100, +i.value || 6)); }));
    row("字号", mk("number", w.size || 14, (i) => { w.size = Math.max(8, Math.min(72, +i.value || 14)); }));
    row("颜色", mk("color", w.color || "#ffffff", (i) => { w.color = i.value; }));
    if (w.type === "button") row("背景", mk("color", w.bg || "#e3a63c", (i) => { w.bg = i.value; }));
  }
  function startDrag(ev, w) {
    ev.preventDefault();
    sel = w.id; render();
    const el = stage.querySelector(`[data-wid="${w.id}"]`);
    const r = stage.getBoundingClientRect();
    drag = { w, el, r, dx: ev.clientX - (r.left + w.x / 100 * r.width), dy: ev.clientY - (r.top + w.y / 100 * r.height) };
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", endDrag);
  }
  function onDrag(ev) {
    if (!drag) return;
    const { w, r } = drag;
    w.x = Math.max(0, Math.min(96, (ev.clientX - drag.dx - r.left) / r.width * 100));
    w.y = Math.max(0, Math.min(94, (ev.clientY - drag.dy - r.top) / r.height * 100));
    drag.el.style.left = w.x + "%";
    drag.el.style.top = w.y + "%";
  }
  function endDrag() {
    if (drag) { persist(); render(); }
    drag = null;
    window.removeEventListener("mousemove", onDrag);
    window.removeEventListener("mouseup", endDrag);
  }
  // 官方节点条里的五种：框架 / 滚动框 / 文本 / 输入框 / 图片。
  // 之前编辑器只能放按钮、文本、图片——运行时的 UiBox / UiScrollBox / UiInput
  // 都实现了，却在编辑器里摆不出来，等于这三类节点对作者是不存在的。
  const KIND = {
    box: { w: 26, h: 18 }, scroll: { w: 22, h: 26 }, text: { text: "文本", w: 24, h: 8 },
    input: { w: 24, h: 7, placeholder: "请输入" }, image: { w: 20, h: 16, image: "" },
    button: { text: "按钮", w: 16, h: 8, bg: "#e3a63c" },
  };
  const addWidget = (type) => {
    const k = KIND[type] || KIND.text;
    // 逐个错开落点：全都放在同一个坐标时，连点四个节点看着就像只放了一个
    const n = widgets().length;
    const w = Object.assign({ id: type + (n + 1), type, text: "", x: 40 + (n % 5) * 4, y: 44 + (n % 5) * 5, w: 24, h: 8, size: 16, color: "#ffffff" }, k);
    widgets().push(w); sel = w.id; persist(); render();
  };
  document.querySelectorAll("#uiPalette [data-t]").forEach((b) => { b.onclick = () => addWidget(b.dataset.t); });
  const paletteClose = $("uiPaletteClose");
  if (paletteClose) paletteClose.onclick = () => document.getElementById("uiPalette").classList.remove("show");
  $("uiDel").onclick = () => {
    if (!sel) { e.toast("先选中一个控件"); return; }
    e.state.meta.ui = widgets().filter((x) => x.id !== sel); sel = null; persist(); render();
  };
  $("uiBack").onclick = () => { screen.classList.remove("show"); document.getElementById("libCard").style.display = "block"; E.ctx.mode = "build"; document.querySelector('.mtab[data-menu="build"]')?.classList.add("active"); };
  e.renderUiEditor = render;
  render();
  E.ui && E.ui.onReload && E.ui.onReload(render);   // 界面部件列表面板
}

/* ------------------------------ 商城（本地商品表） ------------------------------ */
const PRODUCT_DEFAULT = () => ({
  productId: Math.floor(Math.random() * 9e8) + 1e8,
  name: "新商品", price: 100, currency: "钻石", icon: "", describe: "", limited: 0, enabled: true,
});
export function wireStore() {
  const e = E;
  const $ = (id) => document.getElementById(id);
  const screen = document.getElementById("storeScreen");
  if (!screen) return;
  const list = document.getElementById("storeList"), props = document.getElementById("storeProps");
  let sel = null;
  const items = () => (e.state.meta.products = Array.isArray(e.state.meta.products) ? e.state.meta.products : []);
  const persist = () => { e.markDirty(); render(); };
  function render() {
    list.innerHTML = "";
    const arr = items();
    if (!arr.length) {
      const em = document.createElement("div"); em.className = "muted"; em.style.cssText = "padding:10px;font-size:12px";
      em.textContent = "还没有商品"; list.appendChild(em);
    }
    arr.forEach((p, i) => {
      const it = document.createElement("div");
      it.className = "sfile" + (sel === i ? " on" : "");
      it.textContent = (p.enabled === false ? "○ " : "") + (p.name || "未命名");
      it.onclick = () => { sel = i; render(); };
      list.appendChild(it);
    });
    props.innerHTML = "";
    const p = items()[sel];
    if (!p) {
      // 空态居中：一坨说明文字贴在巨大空白区的左上角，是"这页还没做完"的样子
      const em = document.createElement("div"); em.className = "ss-blank";
      em.innerHTML = "没有选中商品<div class=\"sb-sub\">左侧新建一个，或点右上角「＋ 新建商品」</div>";
      props.appendChild(em); return;
    }
    const row = (label, key, type, opts) => {
      const r = document.createElement("div"); r.className = "frow";
      const lb = document.createElement("label"); lb.textContent = label;
      const inp = document.createElement("input");
      inp.type = type === "number" ? "number" : "text";
      if (type === "bool") { inp.type = "checkbox"; inp.checked = p[key] !== false; }
      else inp.value = p[key] == null ? "" : p[key];
      if (opts && opts.title) inp.title = opts.title;
      inp.onchange = () => {
        p[key] = type === "number" ? (parseFloat(inp.value) || 0) : type === "bool" ? inp.checked : inp.value;
        if (key === "productId") p[key] = Math.floor(Number(p[key]) || 1);
        e.markDirty(); render();
      };
      r.appendChild(lb); r.appendChild(inp); props.appendChild(r);
    };
    row("商品 ID", "productId", "number", { title: "脚本里用 world.products() 按 productId 匹配" });
    row("名称", "name");
    row("价格", "price", "number");
    row("货币", "currency");
    row("图标", "icon", "text", { title: "图片 URL 或 /data 下的路径" });
    row("描述", "describe");
    row("限购数量", "limited", "number", { title: "0 表示不限购" });
    row("上架", "enabled", "bool");
    const del = document.createElement("button"); del.className = "ss-btn"; del.textContent = "删除该商品";
    del.onclick = () => { items().splice(sel, 1); sel = null; persist(); };
    props.appendChild(del);
  }
  $("storeAdd").onclick = () => { items().push(PRODUCT_DEFAULT()); sel = items().length - 1; persist(); e.toast("已新建商品"); };
  const pb = $("packBack");
  if (pb) pb.onclick = () => { document.getElementById("packScreen").classList.remove("show"); document.getElementById("libCard").style.display = "block"; document.querySelector('.mtab[data-menu="build"]')?.classList.add("active"); };
  $("storeBack").onclick = () => { screen.classList.remove("show"); document.getElementById("libCard").style.display = "block"; E.ctx.mode = "build"; document.querySelector('.mtab[data-menu="build"]')?.classList.add("active"); };
  e.renderStore = render;
  render();
  E.ui && E.ui.onReload && E.ui.onReload(render);   // 商品表面板
}

/* 点击模型列表 → 相机缓动飞到该模型位置 */
/** 把镜头平滑移到这个包围盒上。返回 false 表示没动（第一人称下不打断）。 */
function focusBox(box) {
  const r = E.renderer;
  if (r.fpMode) return false;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 6;
  const dist = Math.max(8, size * 1.4);
  const dir = new THREE.Vector3(1, 0.55, 1).normalize();
  const camFrom = r.camera.position.clone(), tgtFrom = r.controls.target.clone();
  const camTo = c.clone().addScaledVector(dir, dist), tgtTo = c.clone();
  const t0 = performance.now(), dur = 450;
  (function step() {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const e2 = 1 - Math.pow(1 - k, 3); // easeOutCubic
    r.camera.position.lerpVectors(camFrom, camTo, e2);
    r.controls.target.lerpVectors(tgtFrom, tgtTo, e2);
    r.controls.update();
    // 用 setTimeout 自驱：窗口被完全遮挡时 rAF 会整个挂起，而 setTimeout 最多节流到 1Hz，最多 1 秒内到位
    if (k < 1) setTimeout(step, 16);
  })();
  return true;
}
function focusModel(m) { return focusBox(new THREE.Box3().setFromObject(m.object)); }

/** Shift+F「聚焦选中」。选中的可能是模型、也可能是体素选区，两种都要管：
 *  只认模型的话，框选一片之后按键什么都不动，比没有这个键更让人困惑。 */
function frameSelected() {
  const m = E.state.selectedModel, s = E.state.selection;
  if (m && m.object && focusModel(m)) return;
  if (s && focusBox(new THREE.Box3(
    new THREE.Vector3(s.min.x - .5, s.min.y - .5, s.min.z - .5),
    new THREE.Vector3(s.max.x + 1.5, s.max.y + 1.5, s.max.z + 1.5)))) return;
  E.toast((m || s) ? "角色视角下不打断镜头，先按 Esc 退出" : "没有选中的模型，也没框选体素", true);
}
