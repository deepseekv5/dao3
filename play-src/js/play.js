// play.js — 在线体验版入口：把官方「赛车模板」跑在一个最小 editor 上下文里。
//
// 与 public/js/main.js 的关系：只借用它「装配 GameRuntime」那一段做法
// （atlas.load → VoxelRenderer → VoxelWorld.fromPayload → setWorld → applyTerrain →
//   renderer.start → new GameRuntime(__editor) → game.start({scripts, assets, player})），
// 编辑器那一半（工具 / UI / 历史 / 存档 / 服务端 IO）完全不带进来。
//
// 硬性约束：路径全部相对（Pages 子路径下绝对路径会 404）、零 /api/ 请求。
import { BlockAtlas } from "./atlas.js";
import { VoxelWorld } from "./world.js";
import { VoxelRenderer } from "./renderer.js";
import { GameRuntime, logGameError } from "./game.js";
import * as THREE from "../vendor/three/three.module.js";

const WORLD_URL = "./world.json.gz";
const ATLAS_BASE = "./data";

const $ = (id) => document.getElementById(id);
const boot = $("boot"), bootFill = $("bootFill"), bootText = $("bootText"), bootPct = $("bootPct");
const t0 = performance.now();
const timing = {};

// 进度：写条 + 标签 + 等两帧，保证长任务前的百分比真的能显示出来
function say(pct, text) {
  timing[text] = +(performance.now() - t0).toFixed(0);
  bootFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  bootPct.textContent = Math.round(pct) + "%";
  bootText.textContent = text;
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// 失败提示全部走 textContent，不把任何字符串当 markup 解析
function fail(lines) {
  boot.classList.add("failed");
  const f = $("bootFail");
  f.replaceChildren();
  for (const line of lines) {
    const p = document.createElement("p");
    if (typeof line === "string") p.textContent = line;
    else {
      const b = document.createElement("b");
      b.textContent = line.b;
      p.appendChild(b);
      p.appendChild(document.createTextNode(line.text || ""));
    }
    f.appendChild(p);
  }
  f.hidden = false;
  bootText.textContent = "无法启动";
  bootPct.textContent = "";
  $("bootStart").hidden = true;
}
function failNoWebgl() {
  document.body.classList.add("no-webgl");
  fail([
    { b: "这个浏览器用不了 WebGL，跑不了体素渲染。", text: "" },
    "请换较新的 Chrome / Edge / Firefox / Safari，或在浏览器设置里打开「硬件加速 / 使用 GPU」后重开本页。",
    "手机请用 iOS 15+ 的 Safari，或 Android 的 Chrome。",
  ]);
}

/* ---------------- 0. 输入形态判定（按能力，不看 UA） ---------------- */
const isTouch = (window.matchMedia && matchMedia("(hover: none)").matches)
  || ("ontouchstart" in window) || ((navigator.maxTouchPoints || 0) > 0);
document.documentElement.classList.toggle("touch-capable", isTouch);

/* ---------------- 1. 地图下载（gzip JSON：2.8MB → 19MB） ---------------- */
async function loadWorldPayload() {
  if (typeof DecompressionStream !== "function") {
    throw new Error("这个浏览器不支持 DecompressionStream，无法解开随包发布的 .gz 地图（需 Chrome 80+ / Firefox 113+ / Safari 16.4+）。");
  }
  const resp = await fetch(WORLD_URL);
  if (!resp.ok || !resp.body || !resp.body.getReader) {
    throw new Error("地图下载失败（HTTP " + resp.status + "）");
  }
  const total = Number(resp.headers.get("content-length")) || 0;
  const gunzip = new DecompressionStream("gzip");
  const textP = new Response(gunzip.readable).text();
  const reader = resp.body.getReader();
  const sink = gunzip.writable.getWriter();
  let got = 0, lastPaint = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    sink.write(value).catch(() => {});
    const now = performance.now();
    if (now - lastPaint > 140) {
      lastPaint = now;
      const mb = (got / 1048576).toFixed(1) + " / " + (total ? (total / 1048576).toFixed(1) + " MB" : "? MB");
      await say(6 + (total ? 30 * got / total : 15), "正在下载地图 " + mb);
    }
  }
  try { sink.close(); } catch {}
  await say(38, "正在解压…");
  const text = await textP;
  await say(44, "正在解析世界数据…");
  return JSON.parse(text);
}

/* ---------------- 2. 装配 ---------------- */
async function boot_() {
  const probe = document.createElement("canvas");
  let gl = null;
  try { gl = probe.getContext("webgl2") || probe.getContext("webgl") || probe.getContext("experimental-webgl"); } catch {}
  if (!gl) { failNoWebgl(); return; }
  try { const ext = gl.getExtension("WEBGL_lose_context"); ext && ext.loseContext(); } catch {}

  await say(3, "正在加载方块图集…");
  const atlas = new BlockAtlas();
  try {
    await atlas.load(ATLAS_BASE);
  } catch (err) {
    fail([{ b: "方块图集没能取到。", text: "" }, String((err && err.message) || err), "可以直接刷新本页重试。"]);
    return;
  }

  const canvas = $("viewport");
  let renderer = null;
  try {
    renderer = new VoxelRenderer(canvas, atlas);
  } catch (err) {
    failNoWebgl();
    console.error(err);
    return;
  }
  for (const m of [renderer.opaqueMat, renderer.transparentMat, renderer.glowMat, renderer.barrierMat]) {
    m.map = atlas.texture;
    m.needsUpdate = true;
  }
  renderer.setAtlasParams(atlas);

  let payload;
  try {
    payload = await loadWorldPayload();
  } catch (err) {
    fail([{ b: "地图没能加载完成。", text: "" }, String((err && err.message) || err), "网络抖动可以直接刷新本页重试。"]);
    return;
  }

  const voxelCount = (payload.indices || []).length;
  await say(50, "正在写入体素数据（" + voxelCount.toLocaleString("zh-CN") + " 格）…");
  const world = VoxelWorld.fromPayload(payload);
  // 交还原数组占的内存，手机上留给分块网格
  payload.indices = payload.data = payload.rot = null;

  const state = {
    tool: "place",
    currentBlock: (atlas.get("grass") || {}).id || 127,
    selection: null,
    clipboard: null,
    terrain: Object.assign({
      skyTop: 0x2f6fb0, skyBottom: 0xbfe0ff, fogDensity: 0.006, sunIntensity: 2.4, ambient: 0.22,
      hemi: 0.65, shadows: true, grid: true, glow: 0.9, dayNight: 0.35, exposure: 1.12,
    }, payload.meta.terrain || {}),
    dirty: false,
    meta: payload.meta || {},
    scripts: (payload.meta && payload.meta.scripts) || [],
    entities: (payload.meta && payload.meta.entities) || [],
    assets: { audio: {}, meshes: {}, meshNames: [] },
    models: [],
  };

  function sunDirFromDayNight(h) {
    const a = (h * 1.25 - 0.12) * Math.PI;
    return [Math.cos(a), Math.sin(a), 0.35];
  }
  function applyTerrain() {
    const t = state.terrain;
    renderer.setTerrain({
      skyTop: t.skyTop, skyBottom: t.skyBottom, fogDensity: t.fogDensity,
      sunIntensity: t.sunIntensity, ambient: t.ambient, hemi: t.hemi,
      shadows: t.shadows, grid: t.grid, glow: t.glow, exposure: t.exposure,
      sunDir: sunDirFromDayNight(t.dayNight),
    });
  }
  let toastTimer;
  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  await say(58, "正在生成区块网格（" + voxelCount.toLocaleString("zh-CN") + " 格，这一步最慢）…");
  renderer.setWorld(world);
  applyTerrain();
  renderer.start();
  await say(88, "正在装配运行时…");

  /* ---- 最小 editor 上下文 ----
     GameRuntime 实际取用的就是：state（meta / models / entities / scripts）、atlas、world、
     renderer、toast、applyTerrain，外加两个可选钩子 stopPlay / worldId。 */
  let game = null;
  function stopPlay() {
    if (game && game.running) game.stop();
    $("endPanel").classList.add("show");
  }
  const editor = { state, atlas, world, renderer, toast, applyTerrain, stopPlay, worldId: "racing-template" };
  game = new GameRuntime(editor);
  window.__editor = editor;
  window.__game = game;
  game.spawnPoint = state.meta.spawnPoint || game.spawnPoint;
  game.gameRules = Object.assign({}, game.gameRules, state.meta.gameRules || {});

  // 官方 project.json 的 player 段数值本就是「每 tick」单位；这里只做 main.js 那条
  // migratePlayerMeta 对 _units==="tick" 的等价归一（镜头回跟随），不引入 features.js。
  function playerMeta() {
    const p = Object.assign({}, state.meta.player || {});
    const validCam = ["follow", "fps", "fixed", "relative"].includes(p.cameraMode);
    if (!(p._camSet && validCam)) p.cameraMode = "follow";
    p._units = "tick";
    return p;
  }
  function startRun() {
    game.start({
      scripts: state.scripts || [],
      // 音效与赛道模型因著作权未随包分发。 meshes 里按官方 meshNames 逐个登记一个**空节点**：
      // 运行时找不到资产会退回橙色线框占位盒（编辑器里那是有用的告警），但公开演示里
      // 199 个橙色方块只会让人以为页面坏了。空节点让实体退回"只有碰撞与逻辑"，
      // 体素赛道本身照常渲染，脚本行为完全不变。
      assets: {
        audio: {}, audioBase: "", audioNames: [],
        meshes: Object.fromEntries((state.meta.meshNames || []).map((n) => [n, { object: new THREE.Group(), scale: 1 }])),
        pictureNames: state.meta.pictureNames || [], lutNames: [], partNames: [],
      },
      player: playerMeta(),
    });
    const hint = $("gameHint");
    if (hint) {
      hint.textContent = isTouch
        ? "体验版 · 官方脚本已在你的浏览器里真实执行 · 左摇杆移动，右侧拖动转视角"
        : "体验版 · 官方脚本已在你的浏览器里真实执行 · WASD 移动 · 按 H 开画面设置 · Esc 结束";
      hint.classList.add("show");
      clearTimeout(hint._t);
      hint._t = setTimeout(() => hint.classList.remove("show"), 9000);
    }
  }

  // 运行期未捕获异常 → 游戏控制台（与 main.js 同一做法）
  setInterval(() => {
    while (window.__errs && window.__errs.length) logGameError(window.__errs.shift());
  }, 400);

  await say(94, "准备就绪");
  const mapName = state.meta.name || "赛车模板";
  $("bbMap").textContent = mapName + " · 在线体验";
  $("gameTitle").textContent = mapName;
  document.title = mapName + " · 在线体验版 · 神奇代码岛";
  const startBtn = $("bootStart");
  startBtn.hidden = false;
  startBtn.focus();
  startBtn.addEventListener("click", () => {
    boot.classList.add("done");
    setTimeout(() => { boot.style.display = "none"; }, 500);
    startRun();
  }, { once: true });
  $("endRestart").addEventListener("click", () => {
    $("endPanel").classList.remove("show");
    startRun();
  });
  await say(100, "点「进入体验」开始（官方脚本会立即执行）");

  window.__play = {
    isTouch,
    timing,
    voxels: () => world.size(),
    registryEntities: () => state.entities.length,
    liveEntities: () => game.entities.length,
    tick: () => game.currentTick,
    running: () => !!(game && game.running),
    position: () => {
      const p = game.playerEntity && game.playerEntity.position;
      return p ? { x: p.x, y: p.y, z: p.z } : null;
    },
    speed: () => (game.player ? { walk: game.player.walkSpeed, run: game.player.runSpeed } : null),
    consoleText: () => {
      const el = $("gameConsole");
      return el ? el.textContent : "";
    },
    chatText: () => {
      const el = $("gameChat");
      return el ? el.textContent : "";
    },
    say: (t) => game.say(t),
  };
}

boot_().catch((err) => {
  console.error(err);
  fail([{ b: "启动过程中出了错。", text: "" }, String((err && err.message) || err)]);
});
