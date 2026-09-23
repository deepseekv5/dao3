// main.js — 编辑器装配：加载资源与世界、指针事件→拾取→工具、键盘、UI、运行模式。
import { BlockAtlas } from "./atlas.js";
import * as THREE from "../vendor/three/three.module.js";
import { VoxelWorld } from "./world.js";
import { VoxelRenderer } from "./renderer.js";
import { History } from "./history.js";
import { TOOLS, readSelection, eraseSelection, pasteVoxels } from "./tools.js";
import { mirror, rotate90, flip } from "./ops.js";
import * as io from "./io.js";
import { buildUI } from "./ui.js";
import { initFeatures, moveSelectedModel, importProject, migratePlayerMeta, placeHeldModel, moveHeldModelTo, rotateHeldModel, dropHeldModel, ensureHeldFromSelection, refreshModelList, refreshScriptFiles, createWorld } from "./features.js";
import { GameRuntime, logGameError } from "./game.js";

const worldId = (location.pathname.match(/\/edit\/([a-zA-Z0-9_-]+)/) || [])[1] || "216d665d3ca92bd1b9a2";

const atlas = new BlockAtlas();
const canvas = document.getElementById("viewport");
const renderer = new VoxelRenderer(canvas, atlas);
let world = new VoxelWorld([64, 64, 64]);

const state = {
  tool: "place",
  currentBlock: 127, // grass
  selection: null,
  clipboard: null,
  terrain: { skyTop: 0x2f6fb0, skyBottom: 0xbfe0ff, fogDensity: 0.006, sunIntensity: 2.4, ambient: 0.22, hemi: 0.65, shadows: true, grid: true, glow: 0.9, dayNight: 0.35, exposure: 1.12 },
  dirty: false,
  meta: { name: "新建世界" },
  scripts: [],
  entities: [],
  assets: { audio: {}, meshes: {}, meshNames: [] },
  models: [],
};
let game = null; // GameRuntime 实例

const history = new History(world, (touched) => {
  for (const k of touched) { const [x, y, z] = k.split(",").map(Number); renderer.markDirty(x, y, z); }
  markDirty(); updateStatus();
});

/* 编辑期方块音效：与官方 ambientSound 配置同名素材（破坏 / 放置），批量操作只响一次 */
const EDIT_SFX = { break: "break_block.mp3", boxBreak: "break_block.mp3" };
let _sfxAt = 0, _sfxEl = null;
function playEditSfx(label) {
  const now = performance.now();
  if (now - _sfxAt < 90) return;
  _sfxAt = now;
  const file = EDIT_SFX[label] || "place_block.mp3";
  try {
    if (!_sfxEl) { _sfxEl = new Audio(); _sfxEl.preload = "auto"; }
    const url = "/data/assets/audio/" + encodeURIComponent(file);
    if (_sfxEl.src !== url) _sfxEl.src = url;
    _sfxEl.volume = 0.45;
    _sfxEl.currentTime = 0;
    _sfxEl.play().catch(() => {});
  } catch {}
}
{
  const origCommit = history.commit.bind(history);
  history.commit = (changes, label) => {
    const n = changes ? changes.length : 0;
    const out = origCommit(changes, label);
    if (n) playEditSfx(label || "edit");
    return out;
  };
}

function markDirty() { state.dirty = true; const el = document.getElementById("saveState"); if (el) el.textContent = "● 未保存"; }
function markSaved() { state.dirty = false; const el = document.getElementById("saveState"); if (el) el.textContent = "已保存"; }

// ---- 工具上下文 ----
const ctx = {
  world, atlas, history, renderer, mode: "build",
  get currentBlock() { return state.currentBlock; },
  pick: null,
  modifiers: { shift: false, ctrl: false, alt: false },
  selection: null,
  onPickBlock(id) { state.currentBlock = id; ui.onBlockPicked(id); },
  setSelection(min, max) { state.selection = { min, max }; renderer.setSelectionBox([min.x, min.y, min.z], [max.x, max.y, max.z]); ctx.selection = state.selection; ui.onSelection(state.selection); },
  previewMove(sel, dx, dy, dz) { const mn = { x: sel.min.x + dx, y: sel.min.y + dy, z: sel.min.z + dz }, mx = { x: sel.max.x + dx, y: sel.max.y + dy, z: sel.max.z + dz }; renderer.setSelectionBox([mn.x, mn.y, mn.z], [mx.x, mx.y, mx.z]); },
  commitMove(sel, dx, dy, dz, cs) {
    const vox = readSelection(world, sel);
    for (const v of vox) cs.remove(v.x, v.y, v.z);
    for (const v of vox) { const x = v.x + dx, y = v.y + dy, z = v.z + dz; if (world.inBounds(x, y, z)) cs.set(x, y, z, v.id, v.rot); }
    history.commit(cs.changes(), "move");
    state.selection = { min: { x: sel.min.x + dx, y: sel.min.y + dy, z: sel.min.z + dz }, max: { x: sel.max.x + dx, y: sel.max.y + dy, z: sel.max.z + dz } };
    ctx.selection = state.selection;
  },
};

/* ==================== 运行模式（玩家出生在地图中心，脚本全量运行） ==================== */
function enterPlay() {
  if (renderer.fpMode) setFirstPerson(false);
  // 全屏子界面（脚本 / UI / 商城）会盖住运行画面，先收起
  let closedFs = false;
  for (const id of ["scriptScreen", "uiScreen", "storeScreen"]) {
    const el = document.getElementById(id);
    if (el && el.classList.contains("show")) { el.classList.remove("show"); closedFs = true; }
  }
  // 玩家设置、地图尺寸这类浮层同样是 .modal.show，不关掉就会糊在运行画面上
  for (const el of document.querySelectorAll(".modal.show")) { el.classList.remove("show"); closedFs = true; }
  if (closedFs) {
    document.getElementById("libCard").style.display = "block";
    ctx.mode = "build";
    document.querySelectorAll(".mtab").forEach((x) => x.classList.remove("active"));
    document.querySelector('.mtab[data-menu="build"]')?.classList.add("active");
  }
  if (!game) game = new GameRuntime(window.__editor);
  window.__game = game;
  // 运行要用当前内存里的编辑结果：先把场景模型同步回 meta.entities
  state.meta.entities = collectEntities();
  const assets = {
    audio: state.assets.audio || {}, audioBase: "/data/assets/audio/",
    audioNames: state.assets.audioNames || [], meshes: { ...(state.assets.meshes || {}) },
    pictureNames: state.assets.pictureNames || state.meta.pictureNames || [],
    lutNames: state.assets.lutNames || [], partNames: state.assets.partNames || [],
  };
  game.spawnPoint = state.meta.spawnPoint || game.spawnPoint;
  game.gameRules = Object.assign({}, game.gameRules, state.meta.gameRules || {});
  game.start({ scripts: state.scripts || [], assets, player: migratePlayerMeta(state.meta.player) });
  const hint = document.getElementById("gameHint");
  if (hint) { hint.classList.add("show"); clearTimeout(hint._t); hint._t = setTimeout(() => hint.classList.remove("show"), 6000); }
  // 全局错误 → 游戏控制台（异步报错同样要"报错"）
  if (!game._errFlush) game._errFlush = setInterval(() => {
    while (game.running && window.__errs && window.__errs.length) logGameError(window.__errs.shift());
  }, 400);
}
function stopPlay() {
  if (!game) return;
  if (game._errFlush) { clearInterval(game._errFlush); game._errFlush = null; }
  game.stop();
  if (game.spawnPoint) state.meta.spawnPoint = game.spawnPoint;
  // 运行期改的东西不落盘（官方口径：运行是预览）；以前这里把运行时默认 gameRules 反写进 meta，
  // 导致「跑一次自动化测试」就把默认值固化进地图存档
  state.terrain.sunIntensity = renderer.sun.intensity;
  state.terrain.dayNight = renderer.getDayNight ? renderer.getDayNight() : state.terrain.dayNight;
  applyTerrain();
  document.getElementById("gameHint")?.classList.remove("show");
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
}
window.__play = enterPlay;
window.__stopPlay = stopPlay;
window.__loadZip = (file) => importProject(file); // 测试钩子：导入项目包

/* ==================== 第一人称编辑模式 ==================== */
const FP_HINT = "角色视角：WASD 移动 · 鼠标转身 · Space 上升 / Ctrl 下降 · K 起飞或降落 · 左键用当前工具建造 · Esc 回全局";
function setFirstPerson(on) {
  if (on) {
    const p = ctx.pick;
    const c = renderer.camera.position;
    const spawn = p ? [p.x, p.y + 2, p.z] : [c.x, c.y + 2, c.z];
    renderer.setFirstPerson(true, spawn);
    toast(FP_HINT);
  } else {
    renderer.setFirstPerson(false);
  }
  ui && ui.syncEditSeg && ui.syncEditSeg();
}
function toggleRoleFlight() {
  const fly = !renderer.fpControls.flyMode;
  renderer.fpControls.setFlyMode(fly);
  toast(fly ? "角色视角：已起飞（Space 上升 · Ctrl 下降 · Shift 加速）" : "角色视角：已降落（WASD 行走 · Space 跳跃）");
}
window.__fpToggle = () => setFirstPerson(!renderer.fpMode);
window.__fpOn = setFirstPerson;
window.__fpFly = (on) => { renderer.fpControls.setFlyMode(on); };
document.addEventListener("keydown", (e) => {
  if (game && game.running) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "k") { e.preventDefault(); window.__fpFly && window.__fpFly(!renderer.fpControls.flyMode); toast(renderer.fpControls.flyMode ? "编辑器飞行：开" : "编辑器行走：开"); return; }
  if (renderer.fpMode) {
    if (k === "k") { e.preventDefault(); toggleRoleFlight(); }
    if (k === "escape") setFirstPerson(false);
    return; // FP 模式下其余快捷键由控制组件处理
  }
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); history.redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "c") { copySel(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "v") { paste(); return; }
  if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); duplicateSel(); return; }
  if (k === "delete" || k === "backspace") { deleteSel(); return; }
  if (k === "escape") { if (dropHeldModel()) { toast("已放下模型"); return; } clearSel(); return; }
  const toolKeys = { b: "place", e: "break", g: "paint", f: "fill", m: "eyedropper", l: "line", r: "box", x: "boxBreak", t: "extrude", s: "select" };
  if (toolKeys[k] && !e.ctrlKey && !e.metaKey) { ui.setTool(toolKeys[k]); return; }
  // Y：旋转（官方 placeVoxel 的 rot 语义，90° 步进）；手持模型优先
  if (k === "y") {
    if (rotateHeldModel()) { toast("模型旋转 90°"); return; }
    ctx.blockRot = ((ctx.blockRot || 0) + 1) % 4; toast("方块旋转 90° × " + ctx.blockRot); return;
  }
  if (k === "q") history.undo();
  if (k === "o") renderer.setOrtho(!renderer._ortho), ui.syncOrtho();
  if (k === " ") { e.preventDefault(); }
});

function copySel() { if (!state.selection) return; state.clipboard = readSelection(world, state.selection); toast(`已复制 ${state.clipboard.length} 个体素`); }
function paste() { if (!state.clipboard) return; history.commit(pasteVoxels(world, state.clipboard, 0, 0, 0), "paste"); toast("已粘贴"); }
function duplicateSel() { if (!state.selection) return; const v = readSelection(world, state.selection); history.commit(pasteVoxels(world, v, 1, 0, 1), "duplicate"); toast("已复制副本"); }
function deleteSel() { if (!state.selection) return; history.commit(eraseSelection(world, state.selection), "delete"); clearSel(); }
function clearSel() { state.selection = null; ctx.selection = null; renderer.setSelectionBox(null); ui.onSelection(null); }
function updateStatus() { const el = document.getElementById("blockCount"); if (el) el.textContent = world.size().toLocaleString(); }
// 拾取坐标读数（工具悬停 / FP 中心拾取共用）
function updateCoords(pick) {
  const el = document.getElementById("coords"); if (!el) return;
  el.textContent = pick ? (pick.ground ? `X ${pick.x}  Z ${pick.z}` : `X ${pick.x}  Y ${pick.y}  Z ${pick.z}`) : "—";
}

/* ---- 保存 / 加载 ---- */
// 官方只有一张实体表：场景模型与玩法实体统一按 entitiesTree 扁平 schema 写出
function collectEntities() {
  const placed = (state.models || []).filter((m) => m.object);
  const out = placed.map((m) => {
    const o = m.object, q = o.quaternion, s = o.scale;
    m.pos = [o.position.x, o.position.y, o.position.z];
    return {
      id: m.id, name: m.name, parentId: m.parentId || "ROOT_ID",
      tags: m.tags || [], mesh: m.meshName || null, meshId: m.meshId ?? null,
      position: m.pos, orientation: [q.x, q.y, q.z, q.w], scale: [s.x, s.y, s.z],
      bounds: m.bounds || [0, 0, 0],
      collision: !!m.collision, fixed: !!m.fixed, gravity: !!m.gravity,
      mass: m.mass ?? 1, friction: m.friction ?? 1, restitution: m.restitution ?? 0,
      emissive: m.emissive ?? 0, metalness: m.metalness ?? 0, shininess: m.shininess ?? 0,
      tint: m.tint || [255, 255, 255, 255], damage: m.damage || null,
      particle: m.particle || null, sound: m.sound || null, defaultMotionId: m.defaultMotionId || "",
      meshInvisible: m.hidden === true,
      anchorOffset: m.anchorOffset ? [m.anchorOffset.x, m.anchorOffset.y, m.anchorOffset.z] : null,
    };
  });
  // 带 mesh 的实体正常会变成上面的场景模型；但只要资产没取到（未授权、404、解析失败）
  // 它就落不进 state.models。按"!d.mesh"过滤会让这批实体在保存时被静默清零——
  // 素材读不到不该变成地图数据丢失。所以改成"没被任何已放置模型代表"就原样留回来。
  const covered = new Set();
  for (const m of placed) {
    if (m.name) covered.add("n:" + m.name);
    if (m.id) covered.add("i:" + m.id);
  }
  const has = (d) => (d.name && covered.has("n:" + d.name)) || (d.id && covered.has("i:" + d.id));
  return out.concat((state.entities || []).filter((d) => !has(d)));
}
async function save() {
  const entities = collectEntities();
  const payload = world.toPayload({ ...state.meta, terrain: state.terrain, scripts: state.scripts, entities, models: [], meshNames: state.assets && state.assets.meshNames });
  const res = await io.apiSaveWorld(worldId, payload);
  if (res.ok) { markSaved(); toast("已保存"); captureCover(); } else toast("保存失败: " + (res.error || ""));
}
// 工作台要的封面：保存成功后抓一张视口缩略图存进该项目资产目录
let _coverAt = 0;
function captureCover() {
  if (!worldId || /^boot/.test(String(worldId))) return;
  const now = performance.now();
  if (now - _coverAt < 20000) return;
  _coverAt = now;
  try {
    renderer.renderer.render(renderer.scene, renderer.activeCam || renderer.camera);
    const src = renderer.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = 480; c.height = 300;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0, c.width, c.height);
    c.toBlob((b) => {
      if (!b) return;
      fetch(`/api/world/${encodeURIComponent(worldId)}/asset?path=${encodeURIComponent("cover.png")}`, { method: "POST", body: b }).catch(() => {});
    }, "image/png");
  } catch {}
}
// 从 meta.entities（官方 entitiesTree 扁平化）重建场景模型；无 mesh 的纯玩法实体留在 state.entities
let _restoreChain = Promise.resolve();
function restoreSceneModels(meta) {
  _restoreChain = _restoreChain.then(() => applySceneModels(meta)).catch((err) => console.warn("[models] 恢复失败", err));
}
async function applySceneModels(meta) {
  const ents = (meta && meta.entities) || [];
  const legacy = (meta && meta.models) || [];
  const withMesh = ents.filter((d) => d.mesh);
  if (!withMesh.length && !legacy.length) return;
  const { addPlacedModel, suspendModelList, refreshModelList } = await import("./features.js");
  suspendModelList(true);
  // 幂等：boot 与切世界都会调用，先清空上一批场景模型
  for (const m of state.models || []) { if (m.object && m.object.parent) m.object.parent.remove(m.object); }
  state.models = [];
  state.selectedModel = null;
  const ensure = async (base) => {
    let a = state.assets.meshes[base];
    if (a && a.object) return a;
    const root = (state.meta && state.meta.assetRoot) || "/assets/racing/models/";
    try {
      const { GLTFLoader: L } = await import("../vendor/three/GLTFLoader.js");
      const buf = await (await fetch(root + encodeURIComponent(base) + ".gltf")).arrayBuffer();
      a = await new Promise((res) => new L().parse(buf, "", (g) => res({ object: g.scene, scale: 1 }), () => res(null)));
      if (a) state.assets.meshes[base] = a;
    } catch { a = null; }
    return a;
  };
  const placedSrc = new Set();
  for (const d of withMesh) {
    const a = await ensure(d.mesh);
    if (!a || !a.object) continue;
    addPlacedModel({
      id: d.id, name: d.name, meshName: d.mesh, meshId: d.meshId, parentId: d.parentId,
      pos: d.position, orientation: d.orientation, scaleVec: d.scale, scale: Array.isArray(d.scale) ? d.scale[0] : d.scale,
      bounds: d.bounds, tags: d.tags, collision: d.collision, fixed: d.fixed, gravity: d.gravity,
      mass: d.mass, friction: d.friction, restitution: d.restitution, emissive: d.emissive,
      metalness: d.metalness, shininess: d.shininess, tint: d.tint, damage: d.damage,
      particle: d.particle, sound: d.sound, defaultMotionId: d.defaultMotionId, meshInvisible: d.meshInvisible, anchorOffset: d.anchorOffset, source: a.object,
    });
    placedSrc.add(d);
  }
  for (const d of legacy) {
    const a = await ensure(d.meshName);
    if (!a || !a.object) continue;
    addPlacedModel({ name: d.name, meshName: d.meshName, pos: d.pos, scale: d.scale, rotY: d.rotY || 0, source: a.object });
  }
  // 没摆上的实体必须留在 state.entities 里。旧写法一律按"!d.mesh"过滤，于是资产
  // 403/404 时那 194 个带 mesh 的实体既进不了场景模型、又被这条丢掉，
  // 编辑器下一次保存就把整张图的实体清零——读不到素材不该变成地图数据丢失。
  state.entities = ents.filter((d) => !d.mesh || !placedSrc.has(d));
  suspendModelList(false);
  refreshModelList();
  ui && ui.refreshTree && ui.refreshTree();
}
// 从世界 meta 声明的资产目录加载模型（如赛车模板的 models/*.gltf、VOXA 导出的 .glb），注册进 state.assets.meshes
let _seedAssetsLoaded = false;
async function loadSeedAssets(meta) {
  const names = meta && meta.meshNames;
  if (!names || !names.length) return;
  const root = meta && meta.assetRoot || "/assets/racing/models/"; // 兜底：默认赛车模板资产路径
  const { GLTFLoader } = await import("../vendor/three/GLTFLoader.js");
  state.assets = state.assets || { audio: {}, meshes: {}, meshNames: [] };
  state.assets.meshNames = names;
  let loaded = 0;
  const loadOne = async (base, ext) => {
    const r = await fetch(root + encodeURIComponent(base) + ext);
    if (!r.ok) throw new Error("missing " + ext);
    const buf = await r.arrayBuffer();
    const scene = await new Promise((res, rej) => new GLTFLoader().parse(buf, "", (g) => res(g.scene), rej));
    // 官方 .vb 转 gltf 后各文件的内部枢轴不一致（横向最多偏 13 格、纵向有负的），
    // 统一归一到「XZ 居中、底面为原点」。补偿放在内层 wrapper 上，因为实例化时会覆写根节点 position。
    const box = new THREE.Box3().setFromObject(scene);
    if (isFinite(box.min.x) && isFinite(box.max.x)) {
      const c = box.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group();
      wrap.position.set(-c.x, -box.min.y, -c.z);
      while (scene.children.length) wrap.add(scene.children[0]);
      scene.add(wrap);
      scene.updateMatrixWorld(true);
    }
    return scene;
  };
  await Promise.all(names.map(async (base) => {
    for (const ext of [".gltf", ".glb"]) {
      try {
        const scene = await loadOne(base, ext);
        state.assets.meshes[base] = { object: scene, scale: 1 };
        loaded++;
        return;
      } catch {}
    }
  }));
  if (loaded > 0) console.log("[assets] 已加载 " + loaded + " 个模型");
  if (!state.assets.audioNames) {
    try {
      const r = await fetch("/data/assets/audio/index.json");
      if (r.ok) state.assets.audioNames = await r.json();
    } catch {}
  }
}
async function loadWorld(id) {
  const p = await io.apiLoadWorld(id);
  if (!p) { toast("世界不存在，使用空世界"); return; }
  const w = VoxelWorld.fromPayload(p);
  state.meta = p.meta || { name: "世界" };
  if (p.meta?.terrain) Object.assign(state.terrain, p.meta.terrain);
  if (p.meta?.scripts && p.meta.scripts.length) state.scripts = p.meta.scripts;
  if (p.meta?.entities) state.entities = p.meta.entities;
  if (!_seedAssetsLoaded) { _seedAssetsLoaded = true; await loadSeedAssets(p.meta); }
  replaceWorld(w);
  ui.setWorldName(state.meta.name);
  markSaved();
}
function replaceWorld(w) {
  world = w; ctx.world = w; history.world = w; history.clear();
  state.selection = null; ctx.selection = null;
  renderer.setSelectionBox(null); renderer.setHighlight(null); renderer.setGhost(null);
  if (game) game.stop();
  renderer.setWorld(w);
  renderer.fpControls.setWorld(world);
  applyTerrain();
  updateStatus();
  ui && ui.setWorldName && ui.setWorldName(state.meta.name);
  window.__editor && (window.__editor.world = w);
  ui && ui.refreshTree && ui.refreshTree();
  restoreEntityMarkers();
  restoreSceneModels(state.meta);
}
// 从保存的实体数据重建可视化标记
function restoreEntityMarkers() {
  if (!state.entities || !state.entities.length) return;
  import("./features.js").then(({ addEntityMarker }) => {
    for (const d of state.entities) {
      if ((state.models || []).some((m) => m.entId === d.id)) continue;
      addEntityMarker({ id: d.id, tags: d.tags || [], pos: d.pos || [4, 4, 4], bounds: d.bounds || [1.5, 1.5, 1.5], collides: d.collides, phys: d.phys });
    }
  });
}
window.__replaceWorld = replaceWorld;

function applyTerrain() {
  const t = state.terrain;
  renderer.setTerrain({
    skyTop: t.skyTop, skyBottom: t.skyBottom, fogDensity: t.fogDensity,
    sunIntensity: t.sunIntensity, ambient: t.ambient, hemi: t.hemi,
    shadows: t.shadows, grid: t.grid, glow: t.glow, exposure: t.exposure,
    sunDir: sunDirFromDayNight(t.dayNight),
  });
}
function sunDirFromDayNight(h) { const a = (h * 1.25 - 0.12) * Math.PI; return [Math.cos(a), Math.sin(a), 0.35]; }

let toastTimer;
function toast(msg) { const el = document.getElementById("toast"); if (!el) return; el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600); }
ctx.notify = toast;

/* ---- 启动 ---- */
async function boot() {
  try { localStorage.setItem("dao3_last_world", worldId); } catch {}
  await atlas.load("/data");
  for (const m of [renderer.opaqueMat, renderer.transparentMat, renderer.glowMat, renderer.barrierMat]) { m.map = atlas.texture; m.needsUpdate = true; }
  // 接缝线/序列帧动画按图集瓦片边界计算
  renderer.setAtlasParams(atlas);
  state.currentBlock = atlas.get("grass")?.id || 127;
  const seed = await io.apiLoadWorld(worldId);
  if (seed) { world = VoxelWorld.fromPayload(seed); ctx.world = world; history.world = world; state.meta = seed.meta || state.meta; if (seed.meta?.terrain) Object.assign(state.terrain, seed.meta.terrain); if (seed.meta?.scripts && seed.meta.scripts.length) state.scripts = seed.meta.scripts; if (seed.meta?.entities) state.entities = seed.meta.entities; if (!_seedAssetsLoaded) { _seedAssetsLoaded = true; await loadSeedAssets(seed.meta); } }
  renderer.setWorld(world);
  applyTerrain();
  renderer.start();
  // 工具指针调度（非 FP + FP 模式统一通过指针事件驱动 TOOLS；模型模式下拖放/放置模型）
  const viewport = document.getElementById("viewport");
  if (viewport) {
    let fpDown = false;
    // 事件坐标 → NDC（renderer.pick 期望 NDC，之前直接传像素 offsetX 是错的）
    const ndcFromEvent = (e) => {
      const r = viewport.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    // 射线求交场景里的模型（state.models 项），返回 { m, dist }；手持预览（ghost）不参与拾取
    const _boxPt = new THREE.Vector3();
    const modelBox = (m) => {
      const v = m.object.matrixWorld ? m.object.matrixWorld.version : 0;
      if (!m._pickBox || m._pickBoxV !== v) {
        m.object.updateWorldMatrix(true, true);
        m._pickBox = new THREE.Box3().setFromObject(m.object);
        m._pickBoxV = v;
      }
      return m._pickBox;
    };
    const pickModel = (e) => {
      const r = renderer;
      r.raycaster.setFromCamera(ndcFromEvent(e), r.activeCam || r.camera);
      const hits = r.raycaster.intersectObjects(r.models.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o.parent && o.parent !== r.models) o = o.parent;
        if (!o || o.userData?.ghost) continue;
        const m = (state.models || []).find((x) => x.object === o);
        if (m) return { m, dist: h.distance };
      }
      // 网格射不中（单面材质朝后、被裁掉、或已隐藏）时退化到包围盒，保证任何模型都点得到、都设得了
      let best = null;
      for (const m of state.models || []) {
        if (!m.object || m.object.userData?.ghost) continue;
        const box = modelBox(m);
        if (!box || !isFinite(box.min.x)) continue;
        if (!r.raycaster.ray.intersectBox(box, _boxPt)) continue;
        const d = _boxPt.distanceTo(r.raycaster.ray.origin);
        if (!best || d < best.dist) best = { m, dist: d, viaBox: true };
      }
      return best;
    };
    const groundHit = (e, planeY) => {
      const r = renderer;
      r.raycaster.setFromCamera(ndcFromEvent(e), r.activeCam || r.camera);
      const pt = new THREE.Vector3();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      return r.raycaster.ray.intersectPlane(plane, pt) ? pt : null;
    };
    let drag = null; // { m, startPos, startHit, planeY }
    // 点中模型 → 选中并弹出独立的「实体属性」卡（不切页签、不改当前模式，任何模式都能设）
    const selectModel = (m) => {
      if (!m) return false;
      state.selectedModel = m;
      state.propsHidden = false;
      refreshModelList();
      ui && ui.refreshTree && ui.refreshTree();
      renderer.setHighlight(null);
      toast(`已选中「${m.name || m.meshName}」· 可设置碰撞 / 推动 / 显示`);
      return true;
    };
    const toolDispatch = (e, fn) => {
      if (game && game.running) return; // 运行模式下鼠标属于游戏（ACTION0/1），不触发建造工具
      if (e.button !== 0) return;
      if (renderer.fpMode) {
        if (fn === "onDown") fpDown = true;
        if (fn === "onUp") fpDown = false;
        ctx.pick = renderer.pick(0, 0);
      } else if (ctx.mode === "model") {
        // 模型模式：点已有模型 = 选中并拖动；点地形 = 摆放手持模型（与放方块一致）
        if (fn === "onDown") {
          const picked = pickModel(e);
          if (picked && !picked.viaBox) {
            const m = picked.m;
            selectModel(m);
            const planeY = m.object.position.y;
            const hit = groundHit(e, planeY);
            drag = { m, startPos: m.object.position.clone(), startHit: hit || m.object.position.clone(), planeY };
          } else {
            ctx.pick = renderer.pick(ndcFromEvent(e).x, ndcFromEvent(e).y);
            ensureHeldFromSelection();
            moveHeldModelTo(ctx.pick);
            if (placeHeldModel()) { markDirty(); toast("已摆放模型"); }
          }
        } else if (fn === "onMove") {
          if (drag) {
            const hit = groundHit(e, drag.planeY);
            if (hit) {
              const dx = hit.x - drag.startHit.x, dy = hit.y - drag.startHit.y, dz = hit.z - drag.startHit.z;
              drag.m.object.position.set(drag.startPos.x + dx, drag.startPos.y + dy, drag.startPos.z + dz);
              const by = drag.m.entityBounds ? drag.m.entityBounds[1] : 0;
              drag.m.pos = [drag.startPos.x + dx - 0.5, drag.startPos.y + dy - by, drag.startPos.z + dz - 0.5];
            }
          } else {
            ctx.pick = renderer.pick(ndcFromEvent(e).x, ndcFromEvent(e).y);
            ensureHeldFromSelection();
            moveHeldModelTo(ctx.pick);
          }
        } else if (fn === "onUp" && drag) {
          drag = null;
          markDirty();
        }
        return;
      } else {
        ctx.pick = renderer.pick(ndcFromEvent(e).x, ndcFromEvent(e).y);
        // 搭建模式下点到「比方块更靠前」的模型 → 视为选中该模型并弹出属性面板
        if (fn === "onDown") {
          const picked = pickModel(e);
          if (picked && (!ctx.pick || ctx.pick.ground || picked.dist < ctx.pick.dist)) {
            selectModel(picked.m);
            return;
          }
        }
      }
      updateCoords(ctx.pick);
      const t = TOOLS[state.tool];
      if (!t || !t[fn]) return;
      if (renderer.fpMode) {
        if (fn === "onMove" && !fpDown) return;
        if (fn === "onUp" && !fpDown) return;
      }
      t[fn](ctx);
    };
    viewport.addEventListener("pointerdown", (e) => toolDispatch(e, "onDown"));
    viewport.addEventListener("pointermove", (e) => toolDispatch(e, "onMove"));
    viewport.addEventListener("pointerup", (e) => toolDispatch(e, "onUp"));
    viewport.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  ui = buildUI({ state, atlas, world, renderer, history, ctx, save, loadWorld, toast, applyTerrain, clearSel, copySel, paste, deleteSel, markDirty, updateStatus, sunDirFromDayNight, enterPlay, stopPlay, setFirstPerson, importProject });
  window.__editor = { state, atlas, world, renderer, history, ctx, ui, applyTerrain, updateStatus, toast, markDirty, save, worldId, enterPlay, stopPlay, collectEntities, refreshScriptFiles };
  initFeatures(window.__editor);
  restoreEntityMarkers();
  restoreSceneModels(state.meta); // boot 种子世界同样恢复场景模型
  // 第一人称中心拾取预览（幽灵方块跟随屏幕中心）
  ui.setFPRenderer && ui.setFPRenderer(null);
  const uiRender = renderer.onRender;
  renderer.onRender = (d) => {
    if (uiRender) uiRender(d);
    if (renderer.fpMode && !(game && game.running)) {
      ctx.pick = renderer.pick(0, 0);
      updateCoords(ctx.pick);
      const p = ctx.pick;
      if (p && state.tool === "place") renderer.setGhost(p.ax, p.ay, p.az, 0x66ccff);
      else { renderer.setGhost(null); }
    }
  };
  // 启动参数：工作台用 /edit/<新id>?new=1&mode=&X=&Y=&Z=&T=&name= 建图，?play=1 直接进运行模式
  const q = new URLSearchParams(location.search);
  if (q.get("new") === "1") {
    const num = (k, d, a, b) => Math.max(a, Math.min(b, Number(q.get(k)) || d));
    createWorld(q.get("mode") || "flat", num("X", 100, 8, 256), num("Y", 32, 8, 128), num("Z", 100, 8, 256), num("T", 5, 1, 64), (q.get("name") || "").trim() || null);
    updateStatus();
    save();
  } else if (seed && seed.indices && seed.indices.length > 2000) {
    updateStatus(); document.getElementById("loading")?.remove();
  } else {
    if (window.__openSizeModal) window.__openSizeModal(); // 进入即选择大小并生成
    updateStatus();
    document.getElementById("loading")?.remove();
  }
  document.getElementById("loading")?.remove();
  if (q.get("export") === "1") {
    io.exportProjectZip({ world, state, name: state.meta.name || worldId, download: true })
      .then(() => toast("已导出项目包"))
      .catch((err) => toast("导出失败: " + (err && err.message || err)));
  }
  if (q.get("play") === "1") setTimeout(() => { if (!game || !game.running) enterPlay(); }, 60);
  // 自动保存（__noAutosave 供测试/演示标签页禁用，避免覆盖磁盘上的世界）
  setInterval(() => { if (state.dirty && !window.__noAutosave && !(game && game.running)) { save(); document.getElementById("saveState").textContent = "自动保存 " + new Date().toLocaleTimeString(); } }, 30000);
  // 顶部 ▶ 运行按钮
  document.getElementById("btnPublish").onclick = () => { if (game && game.running) { stopPlay(); toast("已返回编辑器"); } else { markDirty(); enterPlay(); } };
}
let ui;
boot();