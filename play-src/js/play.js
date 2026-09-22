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
// 官方素材包（build-play 从 official-project/racing-assets 整目录复制过来）。
// 必须相对：Pages 把本站挂在主页域名的 /dao3play/ 子路径下，写 /assets/... 会打到域名根。
const MODEL_BASE = "./assets/models/";
const AUDIO_BASE = "./assets/audio/";

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
// 是否真的还需要解压，**按首两个字节判**而不是看 Content-Encoding 头：
// Pages 前面的 CDN 有可能已经替我们解过一层，那时再把 gzip 帧喂给
// DecompressionStream 会直接报格式错，整页打不开且本地永远复现不出来。
async function loadWorldPayload() {
  const resp = await fetch(WORLD_URL);
  if (!resp.ok || !resp.body || !resp.body.getReader) {
    throw new Error("地图下载失败（HTTP " + resp.status + "）");
  }
  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body.getReader();
  const head = await reader.read();
  if (head.done || !head.value || head.value.length < 2) throw new Error("地图文件是空的或被截断。");
  const chunk = head.value;
  const gzipped = chunk[0] === 0x1f && chunk[1] === 0x8b;
  if (gzipped && typeof DecompressionStream !== "function") {
    throw new Error("这个浏览器不支持 DecompressionStream，无法解开随包发布的 .gz 地图（需 Chrome 80+ / Firefox 113+ / Safari 16.4+）。");
  }
  const src = new ReadableStream({
    start(c) {
      c.enqueue(chunk);
      reader.read().then(function pull(r) {
        if (r.done) { c.close(); return; }
        c.enqueue(r.value);
        reader.read().then(pull, (e) => c.error(e));
      }, (e) => c.error(e));
    },
  });
  let got = 0, lastPaint = 0;
  const counted = src.pipeThrough(new TransformStream({
    transform(value, controller) {
      got += value.length;
      const now = performance.now();
      if (now - lastPaint > 140) {
        lastPaint = now;
        const mb = (got / 1048576).toFixed(1) + " / " + (total ? (total / 1048576).toFixed(1) + " MB" : "? MB");
        say(6 + (total ? 30 * got / total : 15), "正在下载地图 " + mb);
      }
      controller.enqueue(value);
    },
  }));
  const textP = new Response(gzipped ? counted.pipeThrough(new DecompressionStream("gzip")) : counted).text();
  await say(38, gzipped ? "正在解压…" : "正在读取…");
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

  /* ---- 官方赛道模型与音效 ----
     和地图一样随包分发，确认点是首屏那张卡。运行时自己不会取 gltf：
     编辑器是 main.js 的 loadSeedAssets 先把它们解成 THREE 场景再塞进
     state.assets.meshes，这里做同一件事（含同一套枢轴归一），只是路径换成相对。 */
  const meta = payload.meta || {};
  const meshNames = meta.meshNames || [];
  const assets = { meshes: {}, audio: {}, audioBase: AUDIO_BASE, audioNames: [], pictureNames: meta.pictureNames || [], lutNames: [], partNames: [] };
  {
    await say(54, "正在加载赛道模型（" + meshNames.length + " 个）…");
    const { GLTFLoader } = await import("../vendor/three/GLTFLoader.js");
    const loader = new GLTFLoader();
    const meshFails = [];
    const loadOne = async (base) => {
      for (const ext of [".gltf", ".glb"]) {
        try {
          const r = await fetch(MODEL_BASE + encodeURIComponent(base) + ext);
          if (!r.ok) continue;
          const buf = await r.arrayBuffer();
          const scene = await new Promise((res, rej) => loader.parse(buf, "", (g) => res(g.scene), rej));
          // 官方 .vb 转 gltf 后各文件内部枢轴不一致（横向最多偏 13 格、纵向有负的），
          // 统一归一到「XZ 居中、底面为原点」，否则模型会飘在半空或插进地里。
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
        } catch (err) {
          // 空 catch 会把"一个模型都没挂上"变成一句看不见的错误：这里记下最后一个失败原因，
          // 全部失败时原样打到首屏，而不是让人对着一片橙色线框猜为什么。
          meshFails.push(base + ext + ": " + String((err && err.message) || err));
        }
      }
      return null;
    };
    let loaded = 0;
    // 并发拉：20 个文件里两个就 700KB，串行在手机上会白等好几秒
    await Promise.all(meshNames.map(async (n) => {
      const scene = await loadOne(n);
      if (scene) { assets.meshes[n] = { object: scene, scale: 1 }; loaded++; }
    }));
    if (loaded === 0 && meshNames.length > 0) {
      fail([{ b: "赛道模型一个都没取到。", text: "" },
        `预期 ${meshNames.length} 个，位于 ${MODEL_BASE}。`,
        (meshFails[0] || "无失败记录").slice(0, 200)]);
      return;
    }
    try {
      const r = await fetch(AUDIO_BASE + "index.json");
      if (r.ok) assets.audioNames = await r.json();
    } catch { /* 没音效不影响游玩 */ }
  }

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
    assets,
    models: [],
  };
  // 官方地图里写的是 /assets/racing/models/，静态站挂在 /dao3play/ 下，
  // 根绝对路径会打到主页域名上去了；运行时按这个前缀解析图片与网格目录。
  state.meta.assetRoot = MODEL_BASE;

  /* 把带网格的实体摆成真实场景模型——和编辑器 main.js 的 applySceneModels 同一条路。
     不能只把网格交给运行时的 _setMesh：官方 entitiesTree 的位置/朝向/缩放是按
     「外部对象」的约定算的（_buildRegistry 对 state.models 传 obj、对 state.entities 传 null），
     走 _setMesh 那条分支拿不到 orientation，整批模型会按默认朝向堆在原点，
     结果就是玩家被埋进一片青色围栏里。 */
  {
    const ents = state.entities.filter((d) => d && (d.mesh || d.meshName));
    let placed = 0;
    for (const d of ents) {
      const base = String(d.mesh || d.meshName).replace(/.*[\\/]/, "").replace(/\.(vb|vox|glb|gltf|fbx|obj)$/i, "");
      const a = assets.meshes[base];
      if (!a || !a.object) continue;
      const sv = Array.isArray(d.scaleVec || d.scale) ? (d.scaleVec || d.scale) : [d.scale ?? 1, d.scale ?? 1, d.scale ?? 1];
      const obj = a.object.clone(true);
      obj.scale.set(sv[0] || 1, sv[1] || 1, sv[2] || 1);
      if (d.orientation) obj.quaternion.fromArray(d.orientation);
      else if (typeof d.rotY === "number") obj.rotation.y = d.rotY;
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const pos = d.position || d.pos || [0, 0, 0];
      obj.position.set(pos[0], pos[1], pos[2]);
      obj.visible = d.meshInvisible !== true;
      renderer.models.add(obj);
      state.models.push({
        id: d.id, name: d.name, object: obj, pos: [pos[0], pos[1], pos[2]],
        scale: Array.isArray(d.scale) ? d.scale[0] : (d.scale ?? 1), scaleVec: sv,
        orientation: d.orientation || null, meshName: base,
        bounds: d.bounds || null, tags: d.tags || [], collision: !!d.collision,
        fixed: !!d.fixed, gravity: !!d.gravity, anchorOffset: d.anchorOffset || null,
      });
      placed++;
    }
    if (ents.length && !placed) {
      fail([{ b: "赛道模型一个都没摆进场景。", text: "" }, `带网格的实体 ${ents.length} 个，全部没取到对应资产。`]);
      return;
    }
    assets.placedModels = placed;
  }

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
      // 官方模型与音效随包分发，首屏那张卡就是确认点。
      // 网格在 boot 里已解好塞进 assets.meshes（运行时按名字取），
      // 音效走 audioBase 懒加载，两条路径都是相对的。
      assets,
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
