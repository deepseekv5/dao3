// io.js — 世界持久化与导入导出。
// .gz 格式与 box3lab Unity 导出一致：gzip(JSON(VoxelPayload))，用浏览器原生 CompressionStream。
import * as THREE from "../vendor/three/three.module.js";
import { VoxelWorld, encodeVox, decodeVox } from "./world.js";
import { readZipEntries, writeZip } from "./zip.js";

export async function apiLoadWorld(id) {
  const r = await fetch(`/api/world/${id}`);
  if (!r.ok) return null;
  return r.json();
}
export async function apiSaveWorld(id, payload) {
  const r = await fetch(`/api/world/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return r.json();
}
export async function apiListWorlds() {
  const r = await fetch("/api/worlds"); return (await r.json()).worlds || [];
}
export async function apiDeleteWorld(id) {
  const r = await fetch(`/api/world/${id}`, { method: "DELETE" });
  return r.ok;
}

async function gzip(bytes) {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function exportGz(world, meta) {
  const payload = world.toPayload(meta);
  const gz = await gzip(new TextEncoder().encode(JSON.stringify(payload)));
  downloadBlob(new Blob([gz], { type: "application/gzip" }), (meta.name || "world") + ".gz");
}
export async function importGz(file, atlas) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let text;
  try { text = new TextDecoder().decode(await gunzip(buf)); }
  catch { text = new TextDecoder().decode(buf); } // 兼容未压缩 json
  const payload = JSON.parse(text);
  return VoxelWorld.fromPayload(payload);
}
export function exportVox(world, atlas) {
  const ids = [...new Set([...world.map.values()].map((c) => c.id))];
  const vox = encodeVox(world, ids);
  downloadBlob(new Blob([vox], { type: "application/octet-stream" }), (world.meta?.name || "model") + ".vox");
}
export async function importVox(file, atlas) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const voxels = decodeVox(buf);
  // 用方块 id 序列重建（palette 顺序 = 出现顺序），无颜色信息时退化为默认方块
  const world = new VoxelWorld([64, 64, 64]);
  const palette = atlas.list().slice(0, 255).map((b) => b.id);
  let maxy = 0; for (const v of voxels) maxy = Math.max(maxy, v[2]);
  for (const [x, z, yDown, pal] of voxels) {
    const y = maxy - yDown;
    const id = palette[Math.max(0, Math.min(254, pal - 1))] || atlas.get("grass").id;
    if (world.inBounds(x, y, z)) world.set(x, y, z, id);
  }
  return world;
}

// -------- 官方 environment / physics blob 双向映射 --------
// 官方 environment.raw 是嵌套形状（drawDistance + fog6 + rain6 + sky13 + snow7），
// physics.raw 只有 gravity / useOBB / velocityDamping；我运行时用一套扁平键，故必须显式换算。
const rgbOfEnv = (c, dflt) => (c && typeof c === "object" ? { r: +c.red ?? +c.r ?? dflt, g: +c.green ?? +c.g ?? dflt, b: +c.blue ?? +c.b ?? dflt } : { r: dflt, g: dflt, b: dflt });
const rgbaOfEnv = (c) => (c && typeof c === "object" ? { r: +c.red || 0, g: +c.green || 0, b: +c.blue || 0, a: c.alpha == null ? 1 : +c.alpha } : { r: 0, g: 0, b: 0, a: 1 });
const vecOfEnv = (v, d) => (v && typeof v === "object" ? { x: +v.x || 0, y: +v.y ?? d, z: +v.z || 0 } : { x: 0, y: d, z: 0 });

export function toOfficialEnvironment(s = {}) {
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  return {
    drawDistance: num(s.drawDistance, 1024),
    fog: {
      fogColor: { r: num(s.fogColor?.red ?? s.fogColor?.r, 1), g: num(s.fogColor?.green ?? s.fogColor?.g, 1), b: num(s.fogColor?.blue ?? s.fogColor?.b, 1) },
      fogDensity: num(s.fogUniformDensity ?? s.fogDensity, 0),
      fogHeightFalloff: num(s.fogHeightFalloff, 0),
      fogHeightOffset: num(s.fogHeightOffset, -10),
      fogStartDistance: num(s.fogStartDistance, 0),
      maxFog: num(s.maxFog, 0),
    },
    rain: {
      color: rgbaOfEnv(s.rainColor),
      density: num(s.rainDensity, 0),
      direction: vecOfEnv(s.rainDirection, 1),
      interference: num(s.rainInterference, 0.04),
      size: { w: num(s.rainSizeLo, 0), h: num(s.rainSizeHi, 0) },
      speed: num(s.rainSpeed, 1),
    },
    sky: {
      gamma: num(s.gamma, 2.2),
      globalLight: num(s.globalLight, 0.29),
      lunarPhase: num(s.lunarPhase, 0),
      skyBack: rgbOfEnv(s.skyBackLight, 0), skyBottom: rgbOfEnv(s.skyBottomLight, 0), skyFront: rgbOfEnv(s.skyFrontLight, 0),
      skyLeft: rgbOfEnv(s.skyLeftLight, 0), skyRight: rgbOfEnv(s.skyRightLight, 0), skyTop: rgbOfEnv(s.skyTopLight, 0),
      skyType: num(s.skyType, 0),
      sunColor: rgbOfEnv(s.sunLight, 1),
      sunDirection: vecOfEnv(s.sunDirection, 1),
      sunFrequency: num(s.sunFrequency, 0),
      sunPhase: num(s.sunPhase, 0.67),
    },
    snow: {
      color: rgbaOfEnv(s.snowColor),
      density: num(s.snowDensity, 0),
      fallSpeed: num(s.snowFallSpeed, 1),
      size: { w: num(s.snowSizeLo, 0), h: num(s.snowSizeHi, 0) },
      spinSpeed: num(s.snowSpinSpeed, 0),
      texture: String(s.snowTexture || ""),
    },
  };
}

// 官方嵌套 → 我运行时的扁平键（同时喂给 worldSettings 与 sky 两组键名，保持两边都能读到）
export function fromOfficialEnvironment(env = {}) {
  const o = {};
  if (env.drawDistance != null) o.drawDistance = +env.drawDistance;
  const f = env.fog || {};
  if (f.fogColor) o.fogColor = { red: +f.fogColor.r || 0, green: +f.fogColor.g || 0, blue: +f.fogColor.b || 0 };
  if (f.fogDensity != null) o.fogUniformDensity = +f.fogDensity;
  if (f.fogHeightFalloff != null) o.fogHeightFalloff = +f.fogHeightFalloff;
  if (f.fogHeightOffset != null) o.fogHeightOffset = +f.fogHeightOffset;
  if (f.fogStartDistance != null) o.fogStartDistance = +f.fogStartDistance;
  if (f.maxFog != null) o.maxFog = +f.maxFog;
  const r = env.rain || {};
  if (r.color) o.rainColor = { red: +r.color.r || 0, green: +r.color.g || 0, blue: +r.color.b || 0, alpha: r.color.a == null ? 1 : +r.color.a };
  if (r.density != null) o.rainDensity = +r.density;
  if (r.direction) o.rainDirection = [r.direction.x || 0, r.direction.y || 0, r.direction.z || 0];
  if (r.interference != null) o.rainInterference = +r.interference;
  if (r.size) { o.rainSizeLo = +r.size.w || 0; o.rainSizeHi = +r.size.h || 0; }
  if (r.speed != null) o.rainSpeed = +r.speed;
  const k = env.snow || {};
  if (k.color) o.snowColor = { red: +k.color.r || 0, green: +k.color.g || 0, blue: +k.color.b || 0, alpha: k.color.a == null ? 1 : +k.color.a };
  if (k.density != null) o.snowDensity = +k.density;
  if (k.fallSpeed != null) o.snowFallSpeed = +k.fallSpeed;
  if (k.size) { o.snowSizeLo = +k.size.w || 0; o.snowSizeHi = +k.size.h || 0; }
  if (k.spinSpeed != null) o.snowSpinSpeed = +k.spinSpeed;
  if (k.texture != null) o.snowTexture = String(k.texture);
  const s = env.sky || {};
  if (s.gamma != null) o.gamma = +s.gamma;
  if (s.globalLight != null) o.globalLight = +s.globalLight;
  if (s.lunarPhase != null) o.lunarPhase = +s.lunarPhase;
  if (s.skyType != null) o.skyType = +s.skyType;
  if (s.sunFrequency != null) o.sunFrequency = +s.sunFrequency;
  if (s.sunPhase != null) o.sunPhase = +s.sunPhase;
  if (s.sunDirection) o.sunDirection = [s.sunDirection.x || 0, s.sunDirection.y || 1, s.sunDirection.z || 0];
  if (s.sunColor) o.sunLight = { red: +s.sunColor.r || 0, green: +s.sunColor.g || 0, blue: +s.sunColor.b || 0 };
  for (const [key, mine] of [["skyLeft", "skyLeftLight"], ["skyRight", "skyRightLight"], ["skyBottom", "skyBottomLight"], ["skyTop", "skyTopLight"], ["skyFront", "skyFrontLight"], ["skyBack", "skyBackLight"]]) {
    if (s[key]) o[mine] = { red: +s[key].r || 0, green: +s[key].g || 0, blue: +s[key].b || 0 };
  }
  return o;
}
// 官方 physics.raw 只有这三个键
export const toOfficialPhysics = (ws = {}) => ({ gravity: ws.gravity ?? -0.1, useOBB: !!ws.useOBB, velocityDamping: ws.velocityDamping ?? ws.airFriction ?? 0.01 });

// CIDv0（sha2-256 + base58btc）：官方资源哈希就是这个形态，本地没有平台也能算出真实内容哈希
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export async function cidOf(bytes) {
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice ? bytes.slice(0) : bytes));
    const mh = new Uint8Array(2 + digest.length);
    mh[0] = 0x12; mh[1] = 0x20; mh.set(digest, 2);
    let n = 0n;
    for (const b of mh) n = n * 256n + BigInt(b);
    let s = "";
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of mh) { if (b) break; s = "1" + s; }
    return s; // 0x1220 前缀使 base58 结果天然以 "Qm" 开头
  } catch { return ""; }
}

// 官方 assets.json 是「路径 → 8 字段条目」的映射（type 6=audio、3=lut、4=part），不含 mesh
export function toOfficialAssetsMap({ audioNames = [], lutNames = [], partNames = [], sizes = {} } = {}) {
  const mk = (type, size) => ({ animated: false, bounds: [0, 0, 0], contentId: 0, hash: "", ownerId: 0, previewImage: "", size: size || 0, type });
  const map = {};
  for (const n of audioNames) map["audio/" + n] = mk(6, sizes["audio/" + n]);
  for (const n of lutNames) map["lut/" + n] = mk(3, sizes["lut/" + n]);
  for (const n of partNames) map["part/" + n] = mk(4, sizes["part/" + n]);
  return map;
}

// -------- 项目包全量导出：与官方导出同构（code/ + project/ + build/ + entities/ + mesh/ + audio/）--------
// 把编辑器里的所有内容写进一个 zip：脚本、体素、实体树、玩家/物理/环境/区域/UI 配置、模型与音频资产。
// 官方 project.json 的 player blob 恰好这 41 个键（对照 racing-template/player.raw）。
// 本地运行时用的是 API 侧名字（canFly/spectator/cameraMode…），导出必须翻回去，
// 而 skin / gamepad / _units 这类本地扩展官方 blob 里没有，走 project/compat.json。
const OFFICIAL_PLAYER_KEYS = ["allowAction0", "allowAction1", "allowCrouch", "allowDoubleJump", "allowFlight",
  "allowJump", "allowMove", "cameraType", "color", "colorLUT", "crouchAcceleration", "crouchSpeed", "damage",
  "doubleJumpPower", "emissive", "flyAcceleration", "flySpeed", "friction", "initialPosition", "initialYaw",
  "invisible", "jumpAccelerationFactor", "jumpPower", "jumpSpeedFactor", "mass", "metalness", "movementBounds",
  "noClip", "playerSounds", "restitution", "runAcceleration", "runSpeed", "scale", "shininess", "showIndicator",
  "showName", "sounds", "swimAcceleration", "swimSpeed", "walkAcceleration", "walkSpeed"];
const PLAYER_RENAME = { canFly: "allowFlight", enableJump: "allowJump", enableDoubleJump: "allowDoubleJump", enableCrouch: "allowCrouch", spectator: "noClip" };
const PLAYER_SOUND_SLOTS = { jump: "jumpSound", doubleJump: "doubleJumpSound", land: "landSound", crouch: "crouchSound", step: "stepSound", swim: "swimSound", enterWater: "enterWaterSound", leaveWater: "leaveWaterSound", startFly: "startFlySound", endFly: "stopFlySound", spawn: "spawnSound", action0: "action0Sound", action1: "action1Sound", music: "music" };
const PLAYER_HIT_SLOTS = { chat: "chatSound", die: "dieSound", hurt: "hurtSound", interact: "interactSound" };
const specOf = (v) => (v && typeof v === "object" && v.sample ? { gain: v.gain ?? 1, gainRange: v.gainRange ?? 0, pitch: v.pitch ?? 1, pitchRange: v.pitchRange ?? 0, radius: v.radius ?? 32, sample: v.sample } : null);

export function toOfficialPlayer(p = {}) {
  const out = {};
  for (const [k, off] of Object.entries(PLAYER_RENAME)) if (p[k] !== undefined) out[off] = p[k];
  if (p.cameraMode !== undefined) out.cameraType = p.cameraMode;
  const c = p.color;
  if (c !== undefined) out.color = Array.isArray(c) ? c : [c.red ?? c.r ?? 1, c.green ?? c.g ?? 1, c.blue ?? c.b ?? 1];
  for (const k of OFFICIAL_PLAYER_KEYS) {
    if (k in out || p[k] === undefined) continue;
    if (k === "movementBounds" && !(p[k] && p[k].lo && p[k].hi)) continue;
    out[k] = p[k];
  }
  // 扁平 *Sound 字段折回官方 playerSounds / sounds（已有的官方 blob 值优先，不覆盖）
  const ps = Object.assign({}, p.playerSounds || {});
  for (const [slot, field] of Object.entries(PLAYER_SOUND_SLOTS)) {
    const s = specOf(p[field]);
    if (s && !specOf(ps[slot])) ps[slot] = s;
  }
  out.playerSounds = ps;
  const snd = Object.assign({}, p.sounds || {});
  for (const [slot, field] of Object.entries(PLAYER_HIT_SLOTS)) {
    const s = specOf(p[field]);
    if (s && !specOf(snd[slot])) snd[slot] = s;
  }
  out.sounds = snd;
  return out;
}
// 官方 blob → 本地运行时名字（导入回环用；未列出的键原样保留）
export function fromOfficialPlayer(o = {}) {
  const p = Object.assign({}, o);
  for (const [k, off] of Object.entries(PLAYER_RENAME)) if (p[off] !== undefined) { p[k] = p[off]; delete p[off]; }
  if (p.cameraType !== undefined) { p.cameraMode = p.cameraType; delete p.cameraType; }
  if (Array.isArray(p.color)) p.color = { red: p.color[0], green: p.color[1], blue: p.color[2] };
  return p;
}

export async function exportProjectZip({ world, state, name, download = true }) {
  const meta = state.meta || {};
  const files = [];
  const scripts = state.scripts || meta.scripts || [];
  const scriptAssets = {};
  for (const s of scripts) {
    const fn = (s.name || s.id || "index.js").replace(/[^\w.\-]/g, "_");
    const code = s.code || s.content || "";
    const base = fn.endsWith(".js") ? fn : fn + ".js";
    files.push({ name: "code/" + base, data: code });
    // 官方 scriptAssets 形状：服务端脚本 type=1，clientIndex 一类 type=7
    const bytes = new TextEncoder().encode(code);
    scriptAssets[base] = {
      animated: false, bounds: [0, 0, 0], contentId: 0, hash: await cidOf(bytes), ownerId: 0, previewImage: "",
      size: bytes.length,
      // 官方 scriptAssets.raw 里 type 是数字：服务端脚本 1、clientIndex 一类 7
      type: /client/i.test(base) || s.client ? 7 : 1,
    };
  }
  const payload = world.toPayload(meta);
  files.push({ name: "build/voxel-sparse.gz", data: await gzip(new TextEncoder().encode(JSON.stringify(payload))) });

  // 实体树还原成官方 nodes 形态（Root / 组 / 实体）。
  // value 严格只写官方 entitiesTree 的 22 个字段；本地扩展字段另存 project/compat.json
  const ents = meta.entities || [];
  const compat = { entities: {}, gameRules: meta.gameRules || null, products: meta.products || [], ui: meta.ui || [], pictureNames: meta.pictureNames || [] };
  // 皮肤 / 虚拟按键 / 本地单位标记：官方 player blob 里没有这些键，放 compat 才能回环
  {
    const p = meta.player || {};
    const ex = {};
    for (const k of ["skin", "skinInvisible", "gamepad", "_units", "_camSet", "wearables"]) if (p[k] !== undefined) ex[k] = p[k];
    if (Object.keys(ex).length) compat.playerExtras = ex;
  }
  const groups = meta.groups || [];
  const tree = { ROOT_ID: { childrenIds: groups.length ? groups.map((g) => g.id) : ents.filter((e) => !e.parentId || e.parentId === "ROOT_ID").map((e) => String(e.id)), id: "ROOT_ID", name: "Root", parentId: "", type: 0 } };
  for (const g of groups) tree[g.id] = { childrenIds: (g.childrenIds || []).map(String), id: g.id, name: g.name, parentId: g.parentId || "ROOT_ID", type: 2 };
  for (const e of ents) {
    const c = {};
    if (e.meshInvisible === true) c.meshInvisible = true;
    if (Array.isArray(e.anchorOffset) && e.anchorOffset.some((v) => v)) c.anchorOffset = e.anchorOffset;
    if (Object.keys(c).length) compat.entities[String(e.id)] = c;
    tree[String(e.id)] = {
      childrenIds: [], id: String(e.id), name: e.name, parentId: e.parentId || "ROOT_ID", type: 1,
      value: {
        bounds: e.bounds || [0, 0, 0], collision: !!e.collision, damage: e.damage || { enabled: false, hp: 100, maxHp: 100, showDamage: true, showHealth: true },
        defaultMotionId: e.defaultMotionId || "", emissive: e.emissive || 0, fixed: !!e.fixed, friction: e.friction ?? 1,
        gravity: !!e.gravity, mass: e.mass ?? 1, mesh: e.mesh ? "mesh/" + e.mesh + ".vb" : "", meshId: e.meshId ?? 0,
        metalness: e.metalness || 0, name: e.name, orientation: e.orientation || [0, 0, 0, 1],
        particle: e.particle || null, position: e.position, restitution: e.restitution ?? 0, scale: e.scale,
        shininess: e.shininess || 0, sound: e.sound || null, tags: e.tags || [], tint: e.tint || [255, 255, 255, 255],
      },
    };
  }
  files.push({ name: "entities/entitiesTree.json", data: JSON.stringify(tree) });
  files.push({ name: "entities/models.json", data: JSON.stringify(ents) }); // 扁平形态，回环导入更快
  files.push({ name: "project/compat.json", data: JSON.stringify(compat) }); // 本地扩展：官方清单里没有这些
  // 官方 blob：zones / uiTree / deleteAssets 始终存在（官方空值分别是 [] 与根节点树）
  const envSrc = Object.assign({}, meta.terrain, meta.worldSettings);
  const cfg = { player: toOfficialPlayer(meta.player || {}), physics: toOfficialPhysics(meta.worldSettings), environment: toOfficialEnvironment(envSrc), ambientSound: meta.ambientSound, zones: meta.zones || [], uiTree: meta.uiTree || { ROOT_ID: { childrenIds: ["DEFAULT_SCREEN_ID"], id: "ROOT_ID", name: "Root", parentId: "", type: 0 }, DEFAULT_SCREEN_ID: { childrenIds: [], id: "DEFAULT_SCREEN_ID", name: "screen", parentId: "ROOT_ID", type: 2, value: { data: { enable: true, layout: { data: null, type: "none" } }, type: "screen" } } } };
  for (const [k, v] of Object.entries(cfg)) if (v) files.push({ name: "project/" + k + ".json", data: JSON.stringify(v) });
  // 清单里只指向真实写出的文件；官方没有该 blob 时留空串，避免留下悬空引用
  const ref = (k) => (files.some((f) => f.name === "project/" + k + ".json") ? "project/" + k + ".json" : "");
  files.push({ name: "project/deleteAssets.json", data: "[]" });
  files.push({ name: "project/scriptAssets.json", data: JSON.stringify(scriptAssets, null, 1) });
  const preview = meta.previewImage || "";
  files.push({
    name: "project/info.json", data: JSON.stringify({
      bannerImages: preview ? [preview] : [], description: meta.description || "",
      displayName: meta.displayName || meta.name || name || "world",
      isNeverChangeDisplayName: false, notice: meta.notice || "", previewImage: preview,
    }, null, 1),
  });
  // 官方 project.json：键按字母序、版本号 0.3.23，本地没有 CID 所以各引用指向包内相对路径
  const manifest = {
    ambientSound: ref("ambientSound"), assets: "project/assets.json", collisionFilter: [],
    committerId: 0, deleteAssets: "project/deleteAssets.json", entitiesTree: "entities/entitiesTree.json",
    environment: ref("environment"), features: { enableTriggerAPI: true }, info: "project/info.json",
    physics: ref("physics"), player: ref("player"), prevHash: "project/prevHash.json",
    scriptAssets: "project/scriptAssets.json", scriptIndex: "index.js", storageMode: "sqlite",
    timestamp: new Date().toISOString(), type: "project", uiTree: ref("uiTree"),
    version: "0.3.23", voxels: "build/voxel-sparse.gz", zones: ref("zones"),
  };
  const sorted = Object.fromEntries(Object.entries(manifest).sort((a, b) => a[0].localeCompare(b[0])));
  files.push({ name: "project/project.json", data: JSON.stringify(sorted, null, 1) });
  files.push({ name: "project/prevHash.json", data: JSON.stringify(sorted, null, 1) });
  files.push({ name: "project/map.json", data: JSON.stringify({ id: meta.mapId || 0, name: meta.displayName || meta.name || name || "world", branch: "master", projectHash: "" }, null, 1) });
  const assetIndex = {};  // 官方形状的资源表，等抓到字节后在末尾写出

  // 模型与音频资产：从本地资产目录取原始字节
  const grab = async (url) => { try { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } };
  const meshNames = meta.meshNames || Object.keys(state.assets?.meshes || {});
  const root = meta.assetRoot || "/assets/racing/models/";
  const audio = await grab("/data/assets/audio/index.json");
  if (audio) {
    try {
      const names = JSON.parse(new TextDecoder().decode(audio));
      for (const n of names) {
        const b = await grab("/data/assets/audio/" + encodeURIComponent(n));
        if (!b) continue;
        files.push({ name: "audio/" + n, data: b });
        assetIndex["audio/" + n] = { animated: false, bounds: [0, 0, 0], contentId: 0, hash: await cidOf(b), ownerId: 0, previewImage: "", size: b.length, type: 6 };
      }
    } catch {}
  }
  await Promise.all(meshNames.map(async (n) => {
    for (const ext of [".gltf", ".glb"]) {
      const b = await grab(root + encodeURIComponent(n) + ext);
      if (b) { files.push({ name: "mesh/" + n + ext, data: b }); return; }
    }
  }));
  for (const n of meta.lutNames || []) if (!assetIndex["lut/" + n]) assetIndex["lut/" + n] = { animated: false, bounds: [0, 0, 0], contentId: 0, hash: "", ownerId: 0, previewImage: "", size: 0, type: 3 };
  for (const n of meta.partNames || []) if (!assetIndex["part/" + n]) assetIndex["part/" + n] = { animated: false, bounds: [0, 0, 0], contentId: 0, hash: "", ownerId: 0, previewImage: "", size: 0, type: 4 };
  files.push({ name: "project/assets.json", data: JSON.stringify(assetIndex, null, 1) });
  const zip = await writeZip(files);
  const blob = new Blob([zip], { type: "application/zip" });
  if (download) downloadBlob(blob, (meta.displayName || meta.name || name || "project") + ".zip");
  return { entries: files.length, bytes: zip.length, blob, names: files.map((f) => f.name) };
}

// -------- Box3/dao3 项目包 (.zip) 导入：code/ + project/ + build/ + audio/ + mesh/ + models/ --------
export async function importProjectZip(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const { entries, extract } = await readZipEntries(u8);
  const warnings = [];
  const name = String(file.name || "导入项目").replace(/\.zip$/i, "") || "导入项目";
  let world = null, entities = [];

  // 1) 地图：build/*.gz（VoxelPayload json，可能 gzip 压缩）或任意 .gz / 大 .json
  const gzEnt = entries.find((e) => /(^|\/)(build|map|world|voxels?)\/.*\.(gz|json)$/i.test(e.name))
    || entries.find((e) => e.name.endsWith(".gz"))
    || entries.find((e) => /(voxel|map|world).*\.json$/i.test(e.name) && !e.name.startsWith("project/"));
  if (gzEnt) {
    try {
      const raw = await extract(gzEnt);
      let text;
      try {
        const ds = new DecompressionStream("gzip");
        const stream = new Blob([raw]).stream().pipeThrough(ds);
        text = new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer()));
      } catch { text = new TextDecoder().decode(raw); } // 未压缩
      const payload = JSON.parse(text);
      if (Array.isArray(payload.shape) && Array.isArray(payload.indices)) {
        world = VoxelWorld.fromPayload(payload);
        entities = Array.isArray(payload.entities) ? payload.entities : entities;
      } else throw new Error("不是 VoxelPayload 结构");
    } catch (err) { warnings.push("地图解析失败: " + err.message); }
  } else {
    warnings.push("包内未找到地图数据 (build/*.gz)");
    world = null;
  }

  // 2) 项目名（project/map.json 优先）
  const mapJson = entries.find((e) => /project\/map\.json$/i.test(e.name));
  if (mapJson) {
    try {
      const j = JSON.parse(new TextDecoder().decode(await extract(mapJson)));
      if (j.name) name = j.name;
    } catch {}
  }

  // 3) 实体：优先扁平 entities/models.json，其次官方 nodes 形态 entitiesTree
  const flatEnt = entries.find((e) => /entities\/models\.json$/i.test(e.name)) || entries.find((e) => /(^|\/)entities\.json$/i.test(e.name));
  const treeEnt = entries.find((e) => /entitiesTree.*\.json$/i.test(e.name));
  const flattenTree = (j) => Object.values(j || {}).filter((n) => n && n.type === 1).map((n) => {
    const v = n.value || {};
    return {
      id: n.id, name: n.name, parentId: n.parentId, tags: v.tags || [],
      mesh: String(v.mesh || "").replace(/^mesh\//, "").replace(/\.vb$/, ""), meshId: v.meshId ?? null,
      position: v.position, orientation: v.orientation || [0, 0, 0, 1], scale: v.scale || [1, 1, 1],
      bounds: v.bounds || [0, 0, 0], collision: !!v.collision, fixed: !!v.fixed, gravity: !!v.gravity,
      mass: v.mass ?? 1, friction: v.friction ?? 1, restitution: v.restitution ?? 0, emissive: v.emissive ?? 0,
      metalness: v.metalness ?? 0, shininess: v.shininess ?? 0, tint: v.tint || [255, 255, 255, 255],
      damage: v.damage || null, particle: v.particle || null, sound: v.sound || null, defaultMotionId: v.defaultMotionId || "",
    };
  });
  const groups = treeEnt ? Object.values(JSON.parse(new TextDecoder().decode(await extract(treeEnt)))).filter((n) => n.type === 2).map((n) => ({ id: n.id, name: n.name, parentId: n.parentId, childrenIds: n.childrenIds })) : [];
  if (flatEnt && !entities.length) {
    try {
      const j = JSON.parse(new TextDecoder().decode(await extract(flatEnt)));
      entities = Array.isArray(j) ? j : (Array.isArray(j.entities) ? j.entities : []);
    } catch {}
  }
  if (treeEnt && !entities.length) {
    try { entities = flattenTree(JSON.parse(new TextDecoder().decode(await extract(treeEnt)))); } catch (err) { warnings.push("entitiesTree 解析失败: " + err.message); }
  }
  // 3a2) project/compat.json：官方清单里没有的本地扩展（隐藏网格 / 物理盒偏移 / gameRules / 商品表 / 界面部件）
  const compatEnt = entries.find((e) => /project\/compat\.json$/i.test(e.name));
  let compat = null;
  if (compatEnt) {
    try { compat = JSON.parse(new TextDecoder().decode(await extract(compatEnt))); } catch {}
  }
  if (compat && compat.entities) {
    for (const en of entities) {
      const c = compat.entities[String(en.id)];
      if (!c) continue;
      if (c.meshInvisible) en.meshInvisible = true;
      if (Array.isArray(c.anchorOffset)) en.anchorOffset = c.anchorOffset;
    }
  }
  if (!entities.length) {
    const entJson = entries.find((e) => /entities.*\.json$/i.test(e.name));
    if (entJson) {
      try {
        const j = JSON.parse(new TextDecoder().decode(await extract(entJson)));
        entities = Array.isArray(j) ? j : (Array.isArray(j.entities) ? j.entities : (typeof j === "object" ? flattenTree(j) : []));
      } catch {}
    }
  }
  // 3b) 项目配置块（官方 blob：player / physics / environment / ambientSound / zones / uiTree）
  const projectCfg = {};
  await Promise.all(["player", "physics", "environment", "ambientSound", "zones", "uiTree"].map(async (k) => {
    const en = entries.find((e) => new RegExp("project/" + k + "\\.json$", "i").test(e.name));
    if (!en) return;
    try { projectCfg[k] = JSON.parse(new TextDecoder().decode(await extract(en))); } catch {}
  }));
  if (compat) {
    if (compat.gameRules) projectCfg.gameRules = compat.gameRules;
    if (Array.isArray(compat.products)) projectCfg.products = compat.products;
    if (Array.isArray(compat.ui)) projectCfg.ui = compat.ui;
    if (Array.isArray(compat.pictureNames)) projectCfg.pictureNames = compat.pictureNames;
    // 官方名字的 player blob 原样带出，由 features.js 的 migratePlayerMeta 统一翻成本地名字；
    // compat 里的本地扩展键（皮肤 / 虚拟按键 / 单位标记）并回去
    if (compat.playerExtras) projectCfg.player = Object.assign({}, projectCfg.player || {}, compat.playerExtras);
  }
  const infoEnt = entries.find((e) => /project\/info\.json$/i.test(e.name));
  if (infoEnt) {
    try {
      const info = JSON.parse(new TextDecoder().decode(await extract(infoEnt)));
      if (info.displayName) projectCfg.displayName = info.displayName;
      if (info.description != null) projectCfg.description = info.description;
    } catch {}
  }

  // 4) 脚本：code/*.js（index.js / clientIndex.js / 任意文件）
  const scriptEntries = entries.filter((e) => /(^|\/)(code|scripts)\/.*\.js$/i.test(e.name))
    .sort((a, b) => score(a.name) - score(b.name));
  function score(nm) {
    const b = nm.toLowerCase();
    if (b.endsWith("/index.js")) return 0;
    if (b.includes("clientindex") || b.includes("client/index")) return 1;
    return 2;
  }
  const scripts = [];
  for (const se of scriptEntries) {
    try {
      const code = new TextDecoder().decode(await extract(se));
      scripts.push({ name: se.name.split("/").pop(), code });
    } catch (err) { warnings.push("脚本读取失败: " + se.name); }
  }
  if (!scripts.length) warnings.push("包内没有 /code/*.js 脚本");

  // 5) 音效 audio/ + 网格资产名 mesh/（.vb 专有格式仅登记名字，实体换 mesh 时给出占位提示）
  const audio = {}, meshNames = [], pictureNames = [];
  await Promise.all(entries.map(async (e) => {
    if (/(^|\/)(audio|sound)\/.*\.(mp3|wav|ogg|m4a|aac)$/i.test(e.name)) {
      try { audio[e.name.split("/").pop()] = await extract(e); } catch {}
    } else if (/(^|\/)(mesh|models?)\/.*\.(vb|vox|glb|gltf)$/i.test(e.name)) {
      meshNames.push(e.name.split("/").pop().replace(/\.(vb|vox|glb|gltf)$/i, ""));
    } else if (/(^|\/)(picture|image|ui)\/.*\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(e.name)) {
      pictureNames.push(e.name.replace(/^.*?(?=picture\/|image\/|ui\/)/, ""));
    }
  }));

  // 5b) 官方资源表 project/assets.json：路径 → {animated,bounds,contentId,hash,ownerId,previewImage,size,type}
  let assets = null;
  const assetsEnt = entries.find((e) => /project\/assets\.json$/i.test(e.name));
  if (assetsEnt) {
    try {
      const j = JSON.parse(new TextDecoder().decode(await extract(assetsEnt)));
      if (j && typeof j === "object" && !Array.isArray(j)) {
        assets = j;
        if (!Object.keys(j).some((k) => j[k] && typeof j[k] === "object" && "type" in j[k])) assets = null; // 旧的非官方形状不作为资源表
      }
    } catch {}
  }
  const assetNames = { audio: [], lut: [], part: [] };
  if (assets) {
    for (const p of Object.keys(assets)) {
      const t = assets[p]?.type;
      if (t === 6) assetNames.audio.push(p.split("/").pop());
      else if (t === 3) assetNames.lut.push(p.split("/").pop());
      else if (t === 4) assetNames.part.push(p.split("/").pop());
    }
  }

  // 6) 模型 models/*.gltf|glb —— 解析为可播放 mesh 资产（赛车模板的汽车模型即在其中）
  const meshes = {};
  await Promise.all(entries.map(async (e) => {
    if (!/(^|\/)(models?|mesh)\/.*\.(glb|gltf)$/i.test(e.name)) return;
    try {
      const buf = await extract(e);
      const { GLTFLoader } = await import("../vendor/three/GLTFLoader.js");
      await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (g) => {
        const base = e.name.split("/").pop().replace(/\.(glb|gltf)$/i, "");
        meshes[base] = { object: g.scene, scale: 1 };
        res();
      }, rej));
    } catch {}
  }));

  return { world, name, scripts, entities, groups, projectCfg, audio, meshNames, pictureNames, meshes, assets, assetNames, warnings };
}

// 从导入脚本里识别出引用的实体选择器（#id / .tag），用于自动生成实体标记。
// 注意：querySelector / querySelectorAll 两种形态都要匹配（'All?' 写法匹配不到 'querySelector'）。
export function extractEntityRefs(scripts) {
  const refs = { ids: new Set(), tags: new Set() };
  const re = /(?:querySelector(?:All)?)\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const s of scripts) {
    let m;
    while ((m = re.exec(s.code || ""))) {
      for (const tok of m[1].split(/\s+/)) {
        if (tok.startsWith("#")) refs.ids.add(tok.slice(1));
        else if (tok.startsWith(".")) refs.tags.add(tok.slice(1));
      }
    }
  }
  return refs;
}
export async function exportGlb(renderer, meta) {
  const { GLTFExporter } = await import("../vendor/three/GLTFExporter.js");
  const group = new THREE.Group();
  for (const rec of renderer.chunkMeshes.values()) {
    if (rec.opaque) group.add(rec.opaque.clone());
    if (rec.trans) group.add(rec.trans.clone());
  }
  const exporter = new GLTFExporter();
  exporter.parse(group, (result) => {
    const blob = new Blob([result], { type: "model/gltf-binary" });
    downloadBlob(blob, (meta.name || "model") + ".glb");
  }, (err) => console.error("glb export", err), { binary: true });
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
