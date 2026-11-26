// io.js — 世界持久化与导入导出。
// .gz 格式与 box3lab Unity 导出一致：gzip(JSON(VoxelPayload))，用浏览器原生 CompressionStream。
import * as THREE from "../vendor/three/three.module.js";
import { VoxelWorld, encodeVox, decodeVox, readVox } from "./world.js";
import { decodeVb } from "./vb.js";
import { readZipEntries, writeZip } from "./zip.js";

export async function apiLoadWorld(id) {
  const r = await fetch(`/api/world/${id}`);
  if (!r.ok) return null;
  return r.json();
}
export async function apiLoadWorldFast(id, onProgress) {
  const r = await fetch(`/api/world/${id}?format=binary`);
  if (!r.ok || r.headers.get("x-world-format") !== "binary-v1") {
    const payload = await apiLoadWorld(id);
    if (!payload) return null;
    const world = VoxelWorld.fromPayload(payload);
    world.meta = payload.meta || {};
    return world;
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = view.getUint32(0, true);
  let p = 4 + metaLen;
  if (p + 16 > bytes.byteLength) throw new Error("世界二进制头不完整");
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen)) || "{}");
  const shape = [view.getUint32(p, true), view.getUint32(p + 4, true), view.getUint32(p + 8, true)];
  const count = view.getUint32(p + 12, true);
  p += 16;
  if (p + count * 7 > bytes.byteLength) throw new Error("世界二进制数据不完整");
  const world = new VoxelWorld(shape);
  for (let i = 0; i < count; i++) {
    const idx = view.getUint32(p, true);
    const id = view.getUint16(p + 4, true);
    const rot = bytes[p + 6];
    if (id) world.map.set(idx, id | (rot << 16));
    p += 7;
    if ((i & 0x7ffff) === 0x7ffff) {
      onProgress?.((i + 1) / count);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  world.meta = meta;
  onProgress?.(1);
  return world;
}
export async function apiSaveWorld(id, payload) {
  const json = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  let body = json;
  try {
    body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    headers["Content-Encoding"] = "gzip";
  } catch { /* 浏览器不支持压缩就按原样发，服务端也认 */ }
  const r = await fetch(`/api/world/${id}`, { method: "POST", headers, body });
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
  const ids = [...new Set([...world.map.values()].map((v) => v & 0xffff))];
  const vox = encodeVox(world, ids);
  downloadBlob(new Blob([vox], { type: "application/octet-stream" }), (world.meta?.name || "model") + ".vox");
}
export async function importVox(file, atlas) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const { voxels, size, palette: pal } = readVox(buf);
  // 世界尺寸跟着模型走：以前硬开 64³，100 格的模型导入进来会被无声裁掉一半
  const span = (i) => Math.max(...voxels.map((v) => v[i]), size && size[i] || 0, 8);
  const hi = (v) => Math.min(256, Math.max(8, v));
  const world = new VoxelWorld([hi(span(0)) + 1, hi(span(1)) + 1, hi(span(2)) + 1]);
  // 用方块 id 序列重建（palette 顺序 = 出现顺序），无颜色信息时退化为默认方块
  const ids = atlas.list().slice(0, 255).map((b) => b.id);
  const fallback = (atlas.get("grass") || atlas.list()[0] || { id: 1 }).id;
  // 模型居中：不居中的话导入完玩家出生在空地处，看到的是世界角落的一个小方块
  const lo = [Infinity, Infinity, Infinity], hi3 = [-Infinity, -Infinity, -Infinity];
  for (const [x, z, yd] of voxels) {
    lo[0] = Math.min(lo[0], x); hi3[0] = Math.max(hi3[0], x);
    lo[1] = Math.min(lo[1], z); hi3[1] = Math.max(hi3[1], z);
    lo[2] = Math.min(lo[2], yd); hi3[2] = Math.max(hi3[2], yd);
  }
  const off = [0, 0, 0];
  for (let i = 0; i < 3; i++) off[i] = Math.floor((world.shape[i] - (hi3[i] - lo[i] + 1)) / 2) - lo[i];
  let maxy = 0; for (const v of voxels) maxy = Math.max(maxy, v[2]);
  for (const [x, z, yDown, palIdx] of voxels) {
    const y = maxy - yDown + off[1];
    const id = ids[Math.max(0, Math.min(254, palIdx - 1))] || fallback;
    if (world.inBounds(x + off[0], y, z + off[2])) world.set(x + off[0], y, z + off[2], id);
  }
  world.voxPalette = pal;
  return world;
}

// -------- 官方 environment / physics blob 双向映射 --------
// 官方 environment.raw 是嵌套形状：顶层 5 组 = drawDistance + fog(6 键) + rain(6 键)
// + sky(14 键) + snow(6 键)，递归到标量共 61 个叶子（实测，见 docs/map-format.md）。
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
/**
 * 官方颜色分量一律收敛到 0..1。这里必须做归一而不是直接抄：
 * 官方 sky.sunColor 用的是**千分制**（实测赤碧城存的是 {r:1000,g:1000,b:1000}），
 * 而 fogColor / skyTop 这些又是 0..1 浮点——同一个 blob 里两套单位。
 * 1000 原样进 GameRGBColor 之后，运行模式的 sunIntensity 会按亮度算到 2600 倍，
 * 画面直接过曝成白片，这就是"运行后光影有问题"的第一处。
 */
function color01(c) {
  if (!c || typeof c !== "object") return null;
  const raw = [+c.r, +c.g, +c.b].map((v) => (Number.isFinite(v) ? v : 0));
  const over = raw.some((v) => v > 1);
  const k = over && raw.every((v) => v >= 0 && v <= 1000) ? 1000 : 1;
  return raw.map((v) => Math.max(0, Math.min(1, v / k)));
}
/** 官方颜色 → GameRGBColor（0..1）。拿不到合法结构时返回 null，让调用方保留自己的默认值。 */
function rgb01(c) {
  const v = color01(c);
  return v ? { red: v[0], green: v[1], blue: v[2] } : null;
}

export function fromOfficialEnvironment(env = {}) {
  const o = {};
  if (env.drawDistance != null) o.drawDistance = +env.drawDistance;
  const f = env.fog || {};
  if (rgb01(f.fogColor)) o.fogColor = rgb01(f.fogColor);
  if (f.fogDensity != null) o.fogUniformDensity = +f.fogDensity;
  if (f.fogHeightFalloff != null) o.fogHeightFalloff = +f.fogHeightFalloff;
  if (f.fogHeightOffset != null) o.fogHeightOffset = +f.fogHeightOffset;
  if (f.fogStartDistance != null) o.fogStartDistance = +f.fogStartDistance;
  if (f.maxFog != null) o.maxFog = +f.maxFog;
  const r = env.rain || {};
  if (rgb01(r.color)) o.rainColor = Object.assign(rgb01(r.color), { alpha: r.color.a == null ? 1 : +r.color.a });
  if (r.density != null) o.rainDensity = +r.density;
  if (r.direction) o.rainDirection = [r.direction.x || 0, r.direction.y || 0, r.direction.z || 0];
  if (r.interference != null) o.rainInterference = +r.interference;
  if (r.size) { o.rainSizeLo = +r.size.w || 0; o.rainSizeHi = +r.size.h || 0; }
  if (r.speed != null) o.rainSpeed = +r.speed;
  const k = env.snow || {};
  if (rgb01(k.color)) o.snowColor = Object.assign(rgb01(k.color), { alpha: k.color.a == null ? 1 : +k.color.a });
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
  if (rgb01(s.sunColor)) o.sunLight = rgb01(s.sunColor);   // 千分制在这里被收回来，见 color01 的注释
  for (const [key, mine] of [["skyLeft", "skyLeftLight"], ["skyRight", "skyRightLight"], ["skyBottom", "skyBottomLight"], ["skyTop", "skyTopLight"], ["skyFront", "skyFrontLight"], ["skyBack", "skyBackLight"]]) {
    if (rgb01(s[key])) o[mine] = rgb01(s[key]);
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

  // 一张"实体表"有三种历史形状，都得吃下：
  //   · 数组                          —— 我们的 entities/models.json
  //   · {id: 记录}                    —— 官方 dao3 的 json/entities.json（id 只在键上，记录体里没有）
  //   · {id: {type:1|2, value:{…}}}   —— 官方 entitiesTree（type 2 是分组，不是实体）
  // 之前只认第一种和最后一种，于是官方包导进来是 0 个实体、画面里一个标记都没有。
export const normalizeEntities = (j) => {
    if (Array.isArray(j)) return j;
    if (!j || typeof j !== "object") return [];
    if (Array.isArray(j.entities)) return j.entities;
    const out = [];
    for (const [k, v] of Object.entries(j)) {
      if (!v || typeof v !== "object" || v.type === 2) continue;
      const rec = v.value && typeof v.value === "object" ? v.value : v;
      const r = Object.assign({ id: k }, rec, v.name != null && rec.name == null ? { name: v.name } : {});
      // 官方 mesh 是 "mesh/石王座.vb" 这种带目录带扩展的引用，而我们全链路（资产表键、
      // ensure() 取模型、模型下拉）用的都是裸名。不归一就直接 404，34 个雕像全变占位盒。
      if (typeof r.mesh === "string") r.mesh = r.mesh.replace(/^.*\/(?=[^/]*$)/, "").replace(/\.(vb|vox|glb|gltf)$/i, "");
      out.push(r);
    }
    return out;
  };
export const flattenTree = (j) => Object.values(j || {}).filter((n) => n && n.type === 1).map((n) => {
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
  })

// ---------- 按 block.json 的 CID 补齐包里没带的配置 ----------
// 官方较新的导出（实测 0.3.31 的「异界之岛」）在 zip 里只放 environment / info /
// physics / player / zones 五个 json，实体表、界面树、资源表、手柄布局全部只留一个
// CID。于是"导入成功但 0 个实体"——不是我们解析不出来，是包里没有。
// 这个函数把缺的那几块按地址取回来。**只在用户明确同意后才调用**：本项目默认不联网。
const GATEWAY = "https://static.dao3.fun/block/";
const BLOCK_KEYS = ["entitiesTree", "environment", "physics", "player", "zones", "info", "assets", "uiTree", "gamepad", "ambientSound"];

export async function fetchBlockCid(hash) {
  const r = await fetch(GATEWAY + encodeURIComponent(hash));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

/** 包里缺、block.json 又点名的那几块：问一句再联网补齐，补齐结果直接写回 res。
 *
 *  编辑器与工作台两条导入路径都必须走这里。工作台以前直接调 importProjectZip，
 *  于是官方清单式导出（神岛世界大厅那种：实体表只剩一个 CID）永远是
 *  "导入成功、0 个实体"，连一次询问都不出现——用户只会以为我们的导入器坏了。 */
export async function completeMissingFromBlock(res, { ask = true, onProgress } = {}) {
  if (!res || !res.block) return res;
  const have = {
    entitiesTree: res.entities && res.entities.length, environment: !!res.projectCfg.environment,
    physics: !!res.projectCfg.physics, player: !!res.projectCfg.player,
    zones: !!res.projectCfg.zones, info: !!res.projectCfg.displayName, assets: !!res.assets,
    uiTree: !!res.projectCfg.uiTree, gamepad: !!res.projectCfg.gamepad, ambientSound: !!res.projectCfg.ambientSound,
  };
  const miss = missingFromBlock(res.block, have);
  if (!miss.length) return res;
  if (ask && !confirm(`这个包只带了部分配置。\n\nblock.json 里还点名了 ${miss.length} 项没在包里：\n${miss.join("、")}\n\n要按内容地址（CID）从 static.dao3.fun 取回吗？\n不取的话这张图大概率没有实体、没有界面。`)) {
    res.warnings.push(`包里缺 ${miss.length} 项配置且未取回：${miss.join("、")}`);
    return res;
  }
  const { got, missed } = await completeFromBlock(res.block, have, onProgress);
  const { applied, deferred } = applyCompletion(res, got);
  if (applied.length) res.warnings.push("已补齐：" + applied.join("、"));
  // 取回来但没映射的东西也要说：不然过两天谁都不记得 uiTree 其实还没生效
  if (deferred.length) res.warnings.push(`已取回但暂未映射：${deferred.join("、")}`);
  if (missed.length) res.warnings.push("取回失败：" + missed.join("、"));
  return res;
}

/** 官方 uiTree（nodes 形态）→ 本地平面控件。
 *  官方一个文件里有多块 screen，且坐标是 1920×1080 设计稿的像素 + 锚点；
 *  本地运行时只认平面百分比。这里选“启用且控件最多”的那一屏展开，其余原样留在 meta.uiTree。 */
export function convertUiTree(tree, { width = 1920, height = 1080 } = {}) {
  if (!tree || typeof tree !== "object") return { widgets: [], screens: [], screen: "" };
  const count = (id, seen = new Set()) => {
    if (!id || seen.has(id)) return { total: 0, visible: 0 };
    seen.add(id);
    const n = tree[id]; if (!n) return { total: 0, visible: 0 };
    const d = (((n.value && n.value.data) || {}).data) || {};
    if (n.value && n.value.type === "element" && d.visible === false) return { total: 0, visible: 0 };
    const out = { total: n.value && n.value.type === "element" ? 1 : 0, visible: n.value && n.value.type === "element" ? 1 : 0 };
    for (const c of n.childrenIds || []) { const r = count(c, seen); out.total += r.total; out.visible += r.visible; }
    return out;
  };
  const screens = Object.values(tree).filter((n) => n && n.value && n.value.type === "screen");
  const enabled = screens.filter((n) => !n.value.data || n.value.data.enable !== false);
  const pick = (enabled.length ? enabled : screens).map((n) => ({ n, ...count(n.id) })).sort((a, b) => b.visible - a.visible || b.total - a.total)[0];
  if (!pick) return { widgets: [], screens: screens.map((n) => n.name), screen: "" };
  const hex = (c) => Array.isArray(c) ? "#" + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round((+v || 0) * 255))).toString(16).padStart(2, "0")).join("") : "";
  const out = [];
  const walk = (id, box, depth) => {
    if (!id || depth > 40) return;
    const n = tree[id]; if (!n) return;
    const v = n.value || {};
    let next = box;
    if (v.type === "element") {
      const d = (v.data && v.data.data) || {};
      const t = v.data && v.data.type;
      if (d.visible === false) return;
      const size = d.size || {}, pos = d.position || {}, anchor = d.anchor || [0, 0];
      const w = Math.max(0, box.w * (+(size.ratio && size.ratio[0]) || 0) + (+(size.offset && size.offset[0]) || 0));
      const h = Math.max(0, box.h * (+(size.ratio && size.ratio[1]) || 0) + (+(size.offset && size.offset[1]) || 0));
      const x = box.x + box.w * (+(pos.ratio && pos.ratio[0]) || 0) + (+(pos.offset && pos.offset[0]) || 0) - w * (+anchor[0] || 0);
      const y = box.y + box.h * (+(pos.ratio && pos.ratio[1]) || 0) + (+(pos.offset && pos.offset[1]) || 0) - h * (+anchor[1] || 0);
      next = { x, y, w, h };
      if (d.visible !== false && w > 0.5 && h > 0.5) {
        const x0 = Math.max(0, Math.min(width, x)), y0 = Math.max(0, Math.min(height, y));
        const x1 = Math.max(0, Math.min(width, x + w)), y1 = Math.max(0, Math.min(height, y + h));
        if (x1 - x0 > 0.5 && y1 - y0 > 0.5) {
          const kind = t === "scrollBox" ? "scroll" : (t === "text" || t === "image" ? t : "box");
          const text = kind === "text" ? String(d.textContent || "") : "";
          const bg = (d.backgroundOpacity > 0 ? hex(d.backgroundColor) : "");
          out.push({
            id: String(n.id), name: String(n.name || n.id).slice(0, 40), type: kind,
            x: +(x0 / width * 100).toFixed(2), y: +(y0 / height * 100).toFixed(2),
            w: +((x1 - x0) / width * 100).toFixed(2), h: +((y1 - y0) / height * 100).toFixed(2),
            size: Math.max(8, Math.min(72, Math.round(+d.textFontSize || 14))),
            color: hex(d.textColor) || "#ffffff",
            bg, text: text || (kind === "box" ? "" : ""), image: kind === "image" ? String(d.image || "") : "",
            placeholder: kind === "input" ? String(d.placeholder || "") : undefined,
            screen: pick.n.name, z: +d.zIndex || 1,
          });
        }
      }
    }
    for (const c of n.childrenIds || []) walk(c, next, depth + 1);
  };
  for (const c of pick.n.childrenIds || []) walk(c, { x: 0, y: 0, w: width, h: height }, 0);
  out.sort((a, b) => a.z - b.z);
  return { widgets: out, screens: screens.map((n) => n.name), screen: pick.n.name };
}
export function missingFromBlock(block, have = {}) {
  if (!block || typeof block !== "object") return [];
  return BLOCK_KEYS.filter((k) => typeof block[k] === "string" && /^Qm/.test(block[k]) && !have[k]);
}

export async function completeFromBlock(block, have = {}, onProgress) {
  const out = {}, missed = [];
  for (const k of missingFromBlock(block, have)) {
    try {
      out[k] = await fetchBlockCid(block[k]);
      onProgress && onProgress(k);
    } catch (e) { missed.push(`${k}（${(e && e.message) || e}）`); }
  }
  return { got: out, missed };
}

/**
 * 把按 CID 取回来的东西接到导入结果上。哪些算"应用了"要分清楚：
 * 实体表、环境、物理、玩家、区域、info、资源表我们有真实映射；
 * uiTree / gamepad / ambientSound 只是先存下来，映射还没做——
 * 与其假装导入完整，不如把没做的报出来。
 */
export function applyCompletion(res, got = {}) {
  const applied = [], deferred = [];
  if (got.entitiesTree && !res.entities.length) {
    const j = got.entitiesTree;
    res.entities = normalizeEntities(j).length ? normalizeEntities(j) : flattenTree(j);
    applied.push("实体 " + res.entities.length + " 个");
  }
  for (const k of ["environment", "physics", "player", "zones"]) {
    if (got[k] && !res.projectCfg[k]) { res.projectCfg[k] = got[k]; applied.push(k); }
  }
  if (got.info && !res.projectCfg.displayName) {
    if (got.info.displayName) res.projectCfg.displayName = got.info.displayName;
    if (got.info.description != null) res.projectCfg.description = got.info.description;
    applied.push("info");
  }
  if (got.assets && typeof got.assets === "object" && !res.assets) {
    res.assets = got.assets;
    res.assetNames = { audio: [], lut: [], part: [] };
    for (const key of Object.keys(got.assets)) {
      const t = got.assets[key] && got.assets[key].type;
      if (t === 6) res.assetNames.audio.push(key.split("/").pop());
      else if (t === 3) res.assetNames.lut.push(key.split("/").pop());
      else if (t === 4) res.assetNames.part.push(key.split("/").pop());
    }
    applied.push("资源表 " + Object.keys(got.assets).length + " 条");
  }
  if (got.uiTree) {
    res.projectCfg.uiTree = got.uiTree;
    const conv = convertUiTree(got.uiTree);
    if (conv.widgets.length) {
      res.projectCfg.uiWidgets = conv.widgets;
      applied.push(`界面 ${conv.widgets.length} 个控件（屏幕「${conv.screen}」）`);
    }
    if (conv.screens.length > 1) res.warnings.push(`官方界面有 ${conv.screens.length} 块屏幕，已展开「${conv.screen}」；其余屏幕原样保存在 meta.uiTree`);
  }
  for (const k of ["gamepad", "ambientSound"]) {
    if (got[k]) { (res.remoteCfg = res.remoteCfg || {})[k] = got[k]; deferred.push(k); }
  }
  return { applied, deferred };
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
//
// 官方 dao3 导出的包和我们自己导出的包是**两套目录名**：
//   我们：build/voxel-sparse.gz + project/{player,physics,environment,zones,info}.json + code/*.js
//   官方：terrain/voxel-sparse.gz + json/{player,physics,environment,zones,info}.json + scripts/*.js
//        外加 block.json（根清单）、meshes/*.vox、images/（LUT 与粒子贴图）、terrain/raw/*.bin
// 只认前一套的后果不是"少读一个文件"，而是 projectCfg 整个为空：玩家属性、物理、
// 环境、区域一个都没进来，界面自然什么都没变。所以下面统一走 findCfg() 两套都认。
export async function importProjectZip(file) {
  const { entries, extract } = await readZipEntries(file);
  const warnings = [];
  let rawMeshes = 0;   // 只登记了名字、没转成可渲染模型的 .vb/.vox 个数。
                      // 声明放最前面：它曾在第 4 步就被读一次，let 的 TDZ 让整次导入抛错。
  const name = String(file.name || "导入项目").replace(/\.zip$/i, "") || "导入项目";
  let world = null, entities = [];
  // 顶层常套一层项目名文件夹（赤碧城/json/player.json），所以前缀放宽成 (^|/)
  // 官方不同版本的导出里，同一个配置既可能是 json/player.json（单文件），
  // 也可能是 json/player/ 目录下的分片。两种都要认，否则整块配置直接消失。
  const consumed = new Set();
  const findCfg = (key) => {
    const hit = entries.find((e) => new RegExp(`(^|/)(project|json|config)/${key}\\.json$`, "i").test(e.name))
      || entries.find((e) => new RegExp(`(^|/)(json|config)/${key}/[^/]+\\.json$`, "i").test(e.name));
    if (hit) consumed.add(hit.name);
    return hit;
  };
  const jsonOf = async (e) => (e ? JSON.parse(new TextDecoder().decode(await extract(e))) : null);

  // 1) 地图。terrain/raw/*.bin 是官方烘焙好的渲染网格、不是体素（八叉树解码已证伪），
  //    这里刻意不碰它，但必须报出来——静默丢掉一半数据比报错难查得多。
  const rawBins = entries.filter((e) => /(^|\/)terrain\/raw\/.*\.bin$/i.test(e.name)).length;
  const gzEnt = entries.find((e) => /(^|\/)(build|terrain)\/voxel-sparse\.gz$/i.test(e.name))
    || entries.find((e) => /(^|\/)(build|map|world|voxels?)\/.*\.(gz|json)$/i.test(e.name))
    || entries.find((e) => e.name.endsWith(".gz") && !/(^|\/)raw\//.test(e.name))
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
    warnings.push("包内未找到地图数据 (build|terrain/voxel-sparse.gz)");
    world = null;
  }
  if (rawBins) warnings.push(`跳过 ${rawBins} 个 terrain/raw/*.bin：那是官方烘焙网格，不是体素数据`);
  // 认不出的配置也要报数：静默丢掉一半配置比导入失败更难查——用户只会觉得
  // "导入成功了但有些东西不对"，却说不上哪里不对。判据用"有没有真的被消费掉"，
  // 而不是路径白名单：按白名单的话 json/ 整目录放行，json/seeds/ 就永远报不出来。

  // 1b) block.json：官方项目根清单。值大多是 IPFS CID（本地没有内容），
  //     但 scriptIndex / version / features 是明文可用信息。
  let block = null;
  const blockEnt = entries.find((e) => /(^|\/)block\.json$/i.test(e.name));
  if (blockEnt) consumed.add(blockEnt.name);
  try { block = await jsonOf(blockEnt); } catch { block = null; }

  // 2) 项目名（project/map.json 优先）
  const mapJson = entries.find((e) => /project\/map\.json$/i.test(e.name));
  if (mapJson) consumed.add(mapJson.name);
  if (mapJson) {
    try {
      const j = await jsonOf(mapJson);
      if (j.name) name = j.name;
    } catch {}
  } else {
    const nameFile = entries.find((e) => /(^|\/)(config\/mapName|meta\/displayName)\.txt$/i.test(e.name));
    if (nameFile) {
      try {
        const t = new TextDecoder().decode(await extract(nameFile)).trim();
        if (t) name = t;
        consumed.add(nameFile.name);
      } catch {}
    }
  }

  // 3) 实体：优先扁平 entities/models.json，其次官方 nodes 形态 entitiesTree
  const flatEnt = entries.find((e) => /entities\/models\.json$/i.test(e.name))
    || entries.find((e) => /(^|\/)entities\.json$/i.test(e.name));
  const treeEnt = entries.find((e) => /entitiesTree.*\.json$/i.test(e.name));
  if (flatEnt) consumed.add(flatEnt.name);
  if (treeEnt) consumed.add(treeEnt.name);
  const groups = treeEnt ? Object.values(await jsonOf(treeEnt)).filter((n) => n.type === 2).map((n) => ({ id: n.id, name: n.name, parentId: n.parentId, childrenIds: n.childrenIds })) : [];
  if (flatEnt && !entities.length) {
    try { entities = normalizeEntities(await jsonOf(flatEnt)); } catch (err) { warnings.push("entities.json 解析失败: " + err.message); }
  }
  if (treeEnt && !entities.length) {
    try { entities = flattenTree(await jsonOf(treeEnt)); } catch (err) { warnings.push("entitiesTree 解析失败: " + err.message); }
  }
  // 3a2) project/compat.json：官方清单里没有的本地扩展（隐藏网格 / 物理盒偏移 / gameRules / 商品表 / 界面部件）
  const compatEnt = entries.find((e) => /project\/compat\.json$/i.test(e.name));
  if (compatEnt) consumed.add(compatEnt.name);
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
  await Promise.all(["player", "physics", "environment", "ambientSound", "zones", "uiTree", "gamepad"].map(async (k) => {
    const en = findCfg(k);
    if (!en) return;
    try { projectCfg[k] = await jsonOf(en); } catch (err) { warnings.push(k + ".json 解析失败: " + err.message); }
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
  const infoEnt = findCfg("info");
  if (infoEnt) {
    try {
      const info = JSON.parse(new TextDecoder().decode(await extract(infoEnt)));
      if (info.displayName && !/^Project$/i.test(info.displayName)) projectCfg.displayName = info.displayName;
      if (info.description != null) projectCfg.description = info.description;
    } catch {}
  }
  if (projectCfg.uiTree) {
    const conv = convertUiTree(projectCfg.uiTree);
    if (conv.widgets.length) projectCfg.uiWidgets = conv.widgets;
    if (conv.screens.length > 1) warnings.push(`官方界面有 ${conv.screens.length} 块屏幕，已展开「${conv.screen}」（${conv.widgets.length} 个控件）；其余屏幕原样保存在 meta.uiTree`);
    else if (conv.widgets.length) warnings.push(`已导入官方界面「${conv.screen}」（${conv.widgets.length} 个控件）`);
  }

  // 4) 脚本：code/*.js（index.js / clientIndex.js / 任意文件）
  const scriptEntries = entries.filter((e) => /(^|\/)(code|scripts?)\/.*\.js$/i.test(e.name))
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

  // 5) 音效 / 网格名 / 图片。大包（几千个文件、几百 MB）不能把所有条目同时解压：
  //    先只按文件名分类，音频与 UI 引用的图片再按需取字节，模型只解析实体真正引用的那几个。
  const audio = {}, meshNames = [], pictureNames = [];
  const audioEntries = [], modelEntries = [], pictureEntries = [];
  for (const e of entries) {
    if (/(^|\/)(audios?|sounds?)\/.*\.(mp3|wav|ogg|m4a|aac)$/i.test(e.name)) audioEntries.push(e);
    else if (/(^|\/)(meshes?|models?)\/.*\.(vb|vox|glb|gltf)$/i.test(e.name)) {
      modelEntries.push(e);
      const fn = e.name.split("/").pop();
      meshNames.push(fn.replace(/\.(vb|vox|glb|gltf)$/i, ""));
    } else if (/(^|\/)(pictures?|images?|ui)\/.*\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(e.name)) {
      pictureEntries.push(e);
    }
  }
  const picRel = (name) => {
    const m = String(name).match(/(?:^|\/)(?:pictures?|images?|ui)\/(.+)$/i);
    return m ? "picture/" + m[1].split("/").pop() : "picture/" + String(name).split("/").pop();
  };
  for (const e of pictureEntries) pictureNames.push(picRel(e.name));
  const uiPics = new Set();
  const treeForPics = projectCfg.uiTree;
  if (treeForPics && typeof treeForPics === "object") {
    for (const n of Object.values(treeForPics)) {
      const d = (((n && n.value && n.value.data) || {}).data) || {};
      if (typeof d.image === "string") uiPics.add(picRel(d.image));
    }
  }
  // 大包按“实体引用 + UI 引用”取；小包保持原来的全量网格解析。
  const heavy = entries.length > 900 || entries.reduce((s, e) => s + (e.compSize || 0), 0) > 120 * 1024 * 1024;
  const refMesh = new Set();
  for (const en of entities) {
    const m = en && (en.mesh || en.meshName || en.model);
    if (m) refMesh.add(String(m).split("/").pop().replace(/\.(vb|vox|glb|gltf)$/i, ""));
  }
  const modelToRead = heavy ? modelEntries.filter((e) => refMesh.has(e.name.split("/").pop().replace(/\.(vb|vox|glb|gltf)$/i, ""))) : modelEntries;
  // 大包不在这里把 1048 个模型全部读进内存：把条目与读取器交回去，上层逐个取、逐个写盘。
  const meshAssetEntries = heavy ? modelEntries.filter((e) => /\.(glb|gltf)$/i.test(e.name)).map((e) => ({
    name: e.name.split("/").pop().replace(/\.(glb|gltf)$/i, ""),
    ext: /\.glb$/i.test(e.name) ? ".glb" : ".gltf",
    entry: e,
  })) : [];
  const pictureToRead = heavy ? pictureEntries.filter((e) => uiPics.has(picRel(e.name))) : pictureEntries;
  const pictureFiles = [], audioFiles = [];
  for (const e of audioEntries) {
    try {
      const bytes = await extract(e);
      const base = e.name.split("/").pop();
      audio[base] = bytes;
      audioFiles.push({ rel: "audio/" + base, bytes });
    } catch {}
  }
  for (const e of pictureToRead) {
    try { pictureFiles.push({ rel: picRel(e.name), bytes: await extract(e) }); } catch {}
  }
  const voxMeshes = [];  // .vox 解码结果（{name, voxels, bytes}）
  const vbMeshes = [];   // .vb 原始 JSON（{name, json}），建网格留给 features.js（要 atlas）
  const pointerMeshes = []; // 只有 dataHash 的官方指针 .vox：本体不在包里
  for (const e of modelToRead) {
    const fn = e.name.split("/").pop();
    const base = fn.replace(/\.(vb|vox|glb|gltf)$/i, "");
    try {
      if (/\.vox$/i.test(fn)) {
        const bytes = await extract(e);
        const stub = pointerMesh(bytes);
        if (stub) pointerMeshes.push({ name: base, ...stub });
        else {
          const vs = decodeVox(bytes);
          if (vs && vs.length) voxMeshes.push({ name: base, voxels: vs, bytes });
          else rawMeshes++;
        }
      } else if (/\.vb$/i.test(fn)) {
        const bytes = await extract(e);
        const json = JSON.parse(new TextDecoder().decode(bytes));
        if (decodeVb(json)) vbMeshes.push({ name: base, json, bytes });
        else rawMeshes++;
      }
    } catch { rawMeshes++; }
  }
  if (heavy && modelEntries.length > modelToRead.length) {
    warnings.push(`大包里有 ${modelEntries.length} 个模型文件（${Math.round(modelEntries.reduce((s, e) => s + (e.compSize || 0), 0) / 1048576)} MB）：全部写入资产库，导入时只预解析实体引用的 ${modelToRead.length} 个，其余点开时按需加载`);
  }
  // 报出来而不是默默变成占位盒：这条决定"导入后画面是空的"到底该怪包还是怪我们。
  // 必须排在上面这次扫描之后——它曾排在前面，于是永远读到 0，警告一次都没出现过。
  // 两类"没有体素"要分开说：指针包是官方导出的形状（本体压根不在 zip 里），
  // 解不出体素才是我们的解码器不认识这个文件。混成一句，用户会去改包或改代码，
  // 而真正的问题是没有内容寻址存储的访问。
  const badMeshes = rawMeshes - pointerMeshes.length;
  if (badMeshes > 0) warnings.push(`${badMeshes} 个 .vb/.vox 网格解不出体素，只登记了名字；引用它们的实体会以标记框显示`);
  if (pointerMeshes.length) {
    warnings.push(`${pointerMeshes.length} 个 .vox 是指针而不是模型：包里只有 bounds + dataHash，体素本体在官方内容存储里（按 CID 才取到）。画面里它们不会有形状，这不是解码失败`);
  }
  // 有网格名却一个实体都没有：官方清单式导出连 entitiesTree 都是 CID（block.json 里能看到），
  // 于是"模型不加载"其实是"没有任何摆位信息"。这条必须单独报，否则用户只会盯着 meshes/ 看。
  if (meshNames.length && !entities.length) {
    const cid = block && typeof block.entitiesTree === "string" ? block.entitiesTree : "";
    warnings.push(`包里没有实体清单（entities/models.json 或 entitiesTree），所以 ${meshNames.length} 个网格没有摆放位置${cid ? `；官方包里 entitiesTree 只是一个 CID：${cid}` : ""}`);
  }

  // 5b) 官方资源表 project/assets.json：路径 → {animated,bounds,contentId,hash,ownerId,previewImage,size,type}
  let assets = null;
  const assetEnts = entries.filter((e) => /(^|\/)(project\/assets|config\/(picture|audio)Assets)\.json$/i.test(e.name));
  for (const e of assetEnts) consumed.add(e.name);
  for (const e of assetEnts) {
    try {
      const j = JSON.parse(new TextDecoder().decode(await extract(e)));
      if (j && typeof j === "object" && !Array.isArray(j)
        && Object.keys(j).some((k) => j[k] && typeof j[k] === "object" && "type" in j[k])) {
        assets = Object.assign(assets || {}, j);
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
  const meshes = {}, meshFiles = [];
  await Promise.all(modelToRead.map(async (e) => {
    if (!/(^|\/)(models?|meshes?|mesh)\/.*\.(glb|gltf)$/i.test(e.name)) return;
    try {
      const buf = await extract(e);
      meshFiles.push({ name: e.name.split("/").pop().replace(/\.(glb|gltf)$/i, ""),
        ext: /\.glb$/i.test(e.name) ? ".glb" : ".gltf", bytes: buf });
      const { GLTFLoader } = await import("../vendor/three/GLTFLoader.js");
      await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (g) => {
        const base = e.name.split("/").pop().replace(/\.(glb|gltf)$/i, "");
        meshes[base] = { object: g.scene, scale: 1 };
        res();
      }, rej));
    } catch {}
  }));

  for (const e of entries) {
    if (/(^|\/)(config\/(deleteAssets|scriptAssets)|public\/versionControl)\.json$/i.test(e.name)) consumed.add(e.name);
  }
  // 必须排在所有 findCfg 之后：早一步算就会把 player.json / environment.json
  // 当成"未识别"报出来——判据是"有没有真的被消费掉"，而消费发生在下面这些行里。
  if (gzEnt) consumed.add(gzEnt.name);
  const oddJson = entries.filter((e) => /\.json$/i.test(e.name) && !consumed.has(e.name)
    && !/(^|\/)(models?|meshes?)\//i.test(e.name));
  if (oddJson.length) warnings.push(`未识别 ${oddJson.length} 个配置文件（${oddJson.slice(0, 3).map((x) => x.name.split("/").slice(-2).join("/")).join("、")}${oddJson.length > 3 ? " 等" : ""}），已跳过`);

  return { world, name, scripts, entities, groups, projectCfg, audio, audioFiles, meshNames, pictureNames, pictureFiles, meshes, meshFiles, meshAssetEntries, extractEntry: (e) => extract(e), assets, assetNames, block, voxMeshes, vbMeshes, pointerMeshes, warnings };
}

// 官方"清单式导出"里的 .vox 不是模型本体，而是 120~300 字节的指针：
//   {"version":5,"bounds":[x,y,z],"dataHash":"<32 字节 sha256 摘要的 base64url>"}
// 体素流在内容寻址存储里（dataHash 补上 multihash 头 0x12 0x20 再 base58btc 就是 Qm… CID），
// zip 里一个字都没带。images/*.png 与 terrain/raw/*.bin 同理（前者是 {"data":"Qm…"}，
// 后者是 2 个空字节）。认不出这个形状的话，decodeVox 只会抛 "bad vox"，
// 报出来的原因就是假的——用户会以为是我们的解码器坏了。
const pointerMesh = (bytes) => {
  if (!bytes || bytes.length > 4096) return null;
  let j = null;
  try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!j || typeof j !== "object" || typeof j.dataHash !== "string") return null;
  return { dataHash: j.dataHash, bounds: Array.isArray(j.bounds) ? j.bounds : null };
};

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
