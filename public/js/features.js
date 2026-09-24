// features.js — 地图尺寸、多文件脚本、实体生成、模型库、zip 项目包导入、运行接线。
import * as THREE from "../vendor/three/three.module.js";
import { VoxelWorld } from "./world.js";
import { generate as genTerrain, PRESETS, presetById } from "./terrain.js";
import * as io from "./io.js";
import { wireScriptAi } from "./ai-script.js";

let E; // window.__editor 引用

export function initFeatures(editor) {
  E = editor;
  wireTopMenu();
  wireSizeModal();
  wireTerrainModal();
  wireScript();
  wireScriptAi(editor);
  wireModels();
  wirePlayer();
  wireUiEditor();
  wireStore();
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
      scriptScreen.classList.remove("show");
      uiScreen.classList.remove("show");
      playerPanel.classList.remove("show");
      modelPanel.classList.remove("show");
      libCard.style.display = "block";
      E.ctx.mode = "build";
      if (m === "model") { libCard.style.display = "none"; modelPanel.classList.add("show"); E.ctx.mode = "model"; }
      else if (m === "script") { libCard.style.display = "none"; scriptScreen.classList.add("show"); E.ctx.mode = "script"; if (E.showScriptScreen) E.showScriptScreen(true); }
      else if (m === "ui") { document.getElementById("uiScreen").classList.add("show"); E.ctx.mode = "ui"; if (E.renderUiEditor) E.renderUiEditor(); }
      else if (m === "player") { document.getElementById("playerPanel").classList.add("show"); }
      else if (m === "store") { document.getElementById("storeScreen").classList.add("show"); document.getElementById("libCard").style.display = "none"; E.ctx.mode = "store"; if (E.renderStore) E.renderStore(); }
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

function wireScript() {
  const e = E;
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
  // 运行游戏 = 进入完整运行模式（官方 GameAPI）
  document.getElementById("scriptPlay").onclick = () => { showScriptScreen(false); window.__play && window.__play(); };
  ta.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.code === "Enter") { ev.preventDefault(); runScript(); return; }
    if (ev.code === "Tab") {
      ev.preventDefault();
      const s = ta.selectionStart, t = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(t);
      ta.selectionStart = ta.selectionEnd = s + 2;
      ta.dispatchEvent(new Event("input"));
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); e.markDirty ? e.markDirty() : null; e.toast("脚本已记录（保存世界时一并写入）"); }
  });
  // ---- JS 语法高亮（零依赖 tokenizer，见文件底部模块级实现）----
  const render = () => renderCodeEditor();
  const syncScroll = () => syncCodeScroll();
  ta.addEventListener("input", () => {
    const cur = curScript();
    if (cur) cur.code = ta.value;
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
  let g = "";
  for (let i = 1; i <= lines; i++) g += (i - 1 === _errLine ? "▶" : i) + "\n";
  gutter.textContent = g;
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
  const group = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(d.bounds[0] * 2, d.bounds[1] * 2, d.bounds[2] * 2).translate(0, d.bounds[1], 0),
    new THREE.MeshBasicMaterial({ color: 0xfc8308, transparent: true, opacity: 0.25 }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(d.bounds[0] * 2, d.bounds[1] * 2, d.bounds[2] * 2).translate(0, d.bounds[1], 0)),
    new THREE.LineBasicMaterial({ color: 0xfc8308 }));
  group.add(cube, edges);
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
function runScript() {
  const e = E, w = e.world, atlas = e.atlas;
  const out = document.getElementById("scriptOut");
  out.style.color = "";
  const idx = e.__scriptIdx == null ? 0 : e.__scriptIdx;
  const code = (e.state.scripts[idx] || { code: "" }).code;
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
    log: (m) => { out.textContent = String(m); },
  };
  try {
    const fn = new Function("sb", "Math", "console", code);
    _errLine = -1; // 清除上次错误行标记
    // 沙箱 console：官方脚本常用 clear/warn/info，一并支持
    fn(sb, Math, {
      log: (...a) => { out.textContent += (out.textContent ? "\n" : "") + a.join(" "); },
      error: (...a) => { out.textContent += (out.textContent ? "\n" : "") + "错误: " + a.join(" "); },
      warn: (...a) => { out.textContent += (out.textContent ? "\n" : "") + "警告: " + a.join(" "); },
      info: (...a) => { out.textContent += (out.textContent ? "\n" : "") + a.join(" "); },
      clear: () => { out.textContent = ""; },
    });
    const list = [...changes.values()].filter((c) => c.oldId !== c.newId);
    e.history.commit(list, "script");
    e.renderer.rebuildAll();
    e.updateStatus();
    if (e.ui && e.ui.refreshTree) e.ui.refreshTree();
    if (!out.textContent) out.textContent = "运行成功 · " + list.length + " 处变更";
    out.style.color = "";
  } catch (err) {
    // 官方 scriptErrorFound：定位出错行并在编辑器里高亮
    // 实测 V8：new Function 包裹后栈行号 = 代码行号 + 2（代码第3行报栈第5行）
    const m = String(err.stack || "").match(/<anonymous>:(\d+):\d+/);
    _errLine = m ? Math.max(0, parseInt(m[1], 10) - 3) : -1;
    out.textContent = (m ? `第 ${_errLine + 1} 行错误: ` : "错误: ") + (err.message || err);
    out.style.color = "#ff6b6b";
    renderCodeEditor();
  }
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
function voxelSelectionToMesh() {
  const e = E, w = e.world, atlas = e.atlas;
  const sel = e.state.selection;
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
  const { min, max } = sel;
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
  const prev = e.state.meta || {};
  const cfg = res.projectCfg || {};
  const meta = Object.assign(prev, {
    name: res.name, displayName: res.name, terrain: e.state.terrain,
    scripts: res.scripts.length ? res.scripts : (prev.scripts || []),
    entities: res.entities || [], groups: res.groups || [], models: [],
    meshNames: (res.meshNames && res.meshNames.length) ? res.meshNames : (prev.meshNames || []),
  });
  if (cfg.player) meta.player = Object.assign({}, cfg.player, { _units: (cfg.player.walkSpeed || 0) > 1 ? "legacy" : "official" });
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
    const tn = state.terrain || {};
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
  e.state.assets = { audio: res.audio, meshes: res.meshes, meshNames: meta.meshNames };
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
  const warns = res.warnings.length ? "\n" + res.warnings.join("\n") : "";
  e.toast(`已导入「${res.name}」· ${meta.entities.length} 实体 / ${res.scripts.length} 脚本 / ${meta.meshNames.length} 模型` + warns);
  document.getElementById("scriptScreen").classList.add("show");
  E.ctx.mode = "script";
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
  e.syncPlayerPanel = load;
}

// 官方颜色既可能是 GameRGBColor({red,green,blue})，也可能是 project.json 里的 [r,g,b]（0..1）
function rgbToHex(c) {
  if (!c) return "#f2c27d";
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
    if (w.type === "button") row("背景", mk("color", w.bg || "#fc8308", (i) => { w.bg = i.value; }));
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
  const addWidget = (type) => {
    const w = { id: type + (widgets().length + 1), type, text: type === "button" ? "按钮" : type === "image" ? "" : "文本", x: 40, y: 44, w: type === "button" ? 16 : 24, h: 8, size: type === "button" ? 14 : 16, color: "#ffffff", bg: "#fc8308" };
    if (type === "image") { w.w = 20; w.h = 16; w.image = ""; }
    widgets().push(w); sel = w.id; persist(); render();
  };
  $("uiAddButton").onclick = () => addWidget("button");
  $("uiAddText").onclick = () => addWidget("text");
  if ($("uiAddImage")) $("uiAddImage").onclick = () => addWidget("image");
  $("uiDel").onclick = () => {
    if (!sel) { e.toast("先选中一个控件"); return; }
    e.state.meta.ui = widgets().filter((x) => x.id !== sel); sel = null; persist(); render();
  };
  $("uiBack").onclick = () => { screen.classList.remove("show"); document.getElementById("libCard").style.display = "block"; E.ctx.mode = "build"; document.querySelector('.mtab[data-menu="build"]')?.classList.add("active"); };
  e.renderUiEditor = render;
  render();
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
      em.textContent = "还没有商品，点右上角「＋ 新建商品」。"; list.appendChild(em);
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
      const em = document.createElement("div"); em.className = "muted"; em.style.cssText = "padding:10px;font-size:12px";
      em.textContent = "选中左侧商品后可编辑。价格与货币仅本地记账：官方平台结算不在本地范围内。";
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
  $("storeBack").onclick = () => { screen.classList.remove("show"); document.getElementById("libCard").style.display = "block"; E.ctx.mode = "build"; document.querySelector('.mtab[data-menu="build"]')?.classList.add("active"); };
  e.renderStore = render;
  render();
}

/* 点击模型列表 → 相机缓动飞到该模型位置 */
function focusModel(m) {
  const r = E.renderer;
  if (r.fpMode) return; // 第一人称下不打断
  const box = new THREE.Box3().setFromObject(m.object);
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
}
