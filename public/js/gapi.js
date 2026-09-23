// gapi.js — 官方 GameAPI 值类型、枚举、事件通道与工具函数。
// 权威依据：vendor/ArenaPro-CLI/server/types/GameAPI.d.ts 与
//          vendor/box3-product-document/api/**（逐字段默认值）。
import * as THREE from "../vendor/three/three.module.js";

export const TICK_MS = 64; // world.onTick 周期，见 api/GameWorld/mapInfo.md
export const ROT_SCALE = 16384; // 旋转码：每顺时针 90° 加 16384，见 api/GameVoxels/operate.md
export const EYE_HEIGHT = 1.62;
export const ENTITY_QUOTA = 4096;
// 自动踏步高度：低于一整格，所以走路能过台阶、但上 1 格墙必须起跳（官方即如此）
export const STEP_UP = 0.55;

export const PLAYER_DEFAULTS = {
  canFly: false, spectator: false, enableJump: true, enableDoubleJump: true, enableCrouch: true, enable3DCursor: false,
  walkSpeed: 0.22, walkAcceleration: 0.19,
  runSpeed: 0.4, runAcceleration: 0.35,
  crouchSpeed: 0.1, crouchAcceleration: 0.09,
  flySpeed: 2, flyAcceleration: 2,
  swimSpeed: 0.4, swimAcceleration: 0.1,
  jumpPower: 0.96, jumpSpeedFactor: 0.85, jumpAccelerationFactor: 0.55, doubleJumpPower: 0.9,
  cameraMode: "follow", cameraDistance: 8.5, cameraFovY: 0.25,
};
export const WORLD_DEFAULTS = { gravity: -0.1, airFriction: 0.001, useOBB: false };

/* ------------------------------ 值类型 ------------------------------ */
export class GameVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new GameVector3(this.x, this.y, this.z); }
  add(v) { return new GameVector3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new GameVector3(this.x - v.x, this.y - v.y, this.z - v.z); }
  mul(v) { return new GameVector3(this.x * v.x, this.y * v.y, this.z * v.z); }
  div(v) { return new GameVector3(this.x / v.x, this.y / v.y, this.z / v.z); }
  scale(n) { return new GameVector3(this.x * n, this.y * n, this.z * n); }
  addEq(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  subEq(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  mulEq(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  divEq(v) { this.x /= v.x; this.y /= v.y; this.z /= v.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    return new GameVector3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }
  mag() { return Math.hypot(this.x, this.y, this.z); }
  sqrMag() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const m = this.mag(); if (m > 0) { this.x /= m; this.y /= m; this.z /= m; } return this; }
  distance(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v, n) {
    return new GameVector3(this.x + (v.x - this.x) * n, this.y + (v.y - this.y) * n, this.z + (v.z - this.z) * n);
  }
  towards(v) { return v.sub(this).normalize(); }
  angle(v) { return Math.acos(clamp(this.dot(v) / (this.mag() * v.mag() || 1), -1, 1)); }
  max(v) { return new GameVector3(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z)); }
  min(v) { return new GameVector3(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z)); }
  equals(v) { return !!v && Math.abs(this.x - v.x) < 1e-6 && Math.abs(this.y - v.y) < 1e-6 && Math.abs(this.z - v.z) < 1e-6; }
  exactEquals(v) { return !!v && this.x === v.x && this.y === v.y && this.z === v.z; }
  toString() { return `(${this.x}, ${this.y}, ${this.z})`; }
  static fromPolar(theta, phi, r = 1) {
    const s = Math.sin(phi);
    return new GameVector3(r * s * Math.cos(theta), r * Math.cos(phi), r * s * Math.sin(theta));
  }
}

export class GameBounds3 {
  constructor(lo, hi) { this.lo = lo || new GameVector3(); this.hi = hi || new GameVector3(); }
  set(lo, hi) { this.lo = lo; this.hi = hi; return this; }
  copy(b) { this.lo = b.lo.clone(); this.hi = b.hi.clone(); return this; }
  intersects(o) {
    return this.lo.x <= o.hi.x && this.hi.x >= o.lo.x &&
      this.lo.y <= o.hi.y && this.hi.y >= o.lo.y &&
      this.lo.z <= o.hi.z && this.hi.z >= o.lo.z;
  }
  intersect(o) {
    const lo = this.lo.max(o.lo), hi = this.hi.min(o.hi);
    if (lo.x > hi.x || lo.y > hi.y || lo.z > hi.z) return null;
    return new GameBounds3(lo, hi);
  }
  contains(v) {
    return v.x >= this.lo.x && v.x <= this.hi.x && v.y >= this.lo.y && v.y <= this.hi.y && v.z >= this.lo.z && v.z <= this.hi.z;
  }
  containsBounds(b) { return this.contains(b.lo) && this.contains(b.hi); }
  toString() { return `${this.lo} ~ ${this.hi}`; }
  static fromPoints(pts) {
    let lo = null, hi = null;
    for (const p of pts) {
      const v = toVec3(p);
      if (!lo) { lo = v.clone(); hi = v.clone(); continue; }
      lo = lo.min(v); hi = hi.max(v);
    }
    return new GameBounds3(lo || new GameVector3(), hi || new GameVector3());
  }
}

export class GameRGBColor {
  constructor(r = 0, g = 0, b = 0) { this.red = r; this.green = g; this.blue = b; }
  // 官方契约里分量就叫 r/g/b（/a），不是 red/green/blue。脚本按官方写 color.r 时
  // 拿到 undefined 是静默失败——颜色会直接变成黑的，所以两组名字都得在。
  get r() { return this.red; }
  set r(v) { this.red = v; }
  get g() { return this.green; }
  set g(v) { this.green = v; }
  get b() { return this.blue; }
  set b(v) { this.blue = v; }
  get a() { return 1; }
  set(r, g, b) { this.red = r; this.green = g; this.blue = b; return this; }
  copy(o) { this.red = o.red ?? o.r; this.green = o.green ?? o.g; this.blue = o.blue ?? o.b; return this; }
  clone() { return new GameRGBColor(this.red, this.green, this.blue); }
  add(o) { return this.clone().addEq(o); }
  sub(o) { return this.clone().subEq(o); }
  mul(o) { return this.clone().mulEq(o); }
  div(o) { return this.clone().divEq(o); }
  addEq(o) { this.red += o.red; this.green += o.green; this.blue += o.blue; return this; }
  subEq(o) { this.red -= o.red; this.green -= o.green; this.blue -= o.blue; return this; }
  mulEq(o) { this.red *= o.red; this.green *= o.green; this.blue *= o.blue; return this; }
  divEq(o) { this.red /= o.red; this.green /= o.green; this.blue /= o.blue; return this; }
  lerp(o, n) {
    return new GameRGBColor(this.red + (o.red - this.red) * n, this.green + (o.green - this.green) * n, this.blue + (o.blue - this.blue) * n);
  }
  equals(o) { return !!o && this.red === o.red && this.green === o.green && this.blue === o.blue; }
  toRGBA() { return new GameRGBAColor(this.red, this.green, this.blue, 1); }
  toString() { return `rgb(${Math.round(this.red * 255)}, ${Math.round(this.green * 255)}, ${Math.round(this.blue * 255)})`; }
  static random() { return new GameRGBColor(Math.random(), Math.random(), Math.random()); }
}

export class GameRGBAColor extends GameRGBColor {
  constructor(r = 0, g = 0, b = 0, a = 1) { super(r, g, b); this.alpha = a; }
  get a() { return this.alpha; }
  set a(v) { this.alpha = v; }
  set(r, g, b, a) { super.set(r, g, b); if (a !== undefined) this.alpha = a; return this; }
  copy(o) { super.copy(o); const a = o.alpha ?? o.a; if (a !== undefined) this.alpha = a; return this; }
  clone() { return new GameRGBAColor(this.red, this.green, this.blue, this.alpha); }
  lerp(o, n) {
    const c = super.lerp(o, n);
    return new GameRGBAColor(c.red, c.green, c.blue, this.alpha + ((o.alpha ?? 1) - this.alpha) * n);
  }
  // 官方 blendEq：把自身当作目标色与给定 RGB 混合后就地写回，返回 GameRGBColor
  blendEq(o) {
    const a = this.alpha;
    this.red = this.red * a + (o.red ?? o.r) * (1 - a);
    this.green = this.green * a + (o.green ?? o.g) * (1 - a);
    this.blue = this.blue * a + (o.blue ?? o.b) * (1 - a);
    return this;
  }
  toString() {
    return `rgba(${Math.round(this.red * 255)}, ${Math.round(this.green * 255)}, ${Math.round(this.blue * 255)}, ${this.alpha})`;
  }
}

export class GameQuaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; this.w = o.w; return this; }
  clone() { return new GameQuaternion(this.x, this.y, this.z, this.w); }
  equals(o) { return !!o && this.x === o.x && this.y === o.y && this.z === o.z && this.w === o.w; }
  mag() { return Math.hypot(this.x, this.y, this.z, this.w); }
  sqrMag() { return this.x ** 2 + this.y ** 2 + this.z ** 2 + this.w ** 2; }
  normalize() { const m = this.mag() || 1; this.x /= m; this.y /= m; this.z /= m; this.w /= m; return this; }
  dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z + this.w * o.w; }
  mul(o) {
    const { x, y, z, w } = this;
    return new GameQuaternion(
      x * o.w + y * o.z - z * o.y + w * o.x,
      -x * o.z + y * o.w + z * o.x + w * o.y,
      x * o.y - y * o.x + z * o.w + w * o.z,
      -x * o.x - y * o.y - z * o.z + w * o.w);
  }
  inv() { return new GameQuaternion(-this.x, -this.y, -this.z, this.w); }
  add(o) { return new GameQuaternion(this.x + o.x, this.y + o.y, this.z + o.z, this.w + o.w); }
  sub(o) { return new GameQuaternion(this.x - o.x, this.y - o.y, this.z - o.z, this.w - o.w); }
  angle(o) { return 2 * Math.acos(clamp(Math.abs(this.dot(o)) / (this.mag() * o.mag() || 1), -1, 1)); }
  rotateX(rad) { return this.mul(GameQuaternion.fromAxisAngle(1, 0, 0, rad)); }
  rotateY(rad) { return this.mul(GameQuaternion.fromAxisAngle(0, 1, 0, rad)); }
  rotateZ(rad) { return this.mul(GameQuaternion.fromAxisAngle(0, 0, 1, rad)); }
  getAxisAngle() {
    const s = Math.sqrt(Math.max(0, 1 - this.w * this.w));
    if (s < 1e-6) return { axis: new GameVector3(0, 1, 0), rad: 0 };
    return {
      axis: new GameVector3(this.x / s, this.y / s, this.z / s),
      rad: 2 * Math.acos(clamp(this.w, -1, 1)),
    };
  }
  slerp(o, t) {
    const q = new THREE.Quaternion(this.x, this.y, this.z, this.w);
    q.slerp(new THREE.Quaternion(o.x, o.y, o.z, o.w), t);
    return new GameQuaternion(q.x, q.y, q.z, q.w);
  }
  toString() { return `(${this.x}, ${this.y}, ${this.z}, ${this.w})`; }
  static fromAxisAngle(x, y, z, rad) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z).normalize(), rad);
    return new GameQuaternion(q.x, q.y, q.z, q.w);
  }
  static fromEuler(x, y, z) { // 官方欧拉序 YZX
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "YZX"));
    return new GameQuaternion(q.x, q.y, q.z, q.w);
  }
  static rotationBetween(a, b) {
    const x = toVec3(a), y = toVec3(b);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(x.x, x.y, x.z).normalize(), new THREE.Vector3(y.x, y.y, y.z).normalize());
    return new GameQuaternion(q.x, q.y, q.z, q.w);
  }
}

/* ------------------------------ 枚举（字符串值同 d.ts） ------------------------------ */
export const GameCameraMode = { FOLLOW: "follow", FPS: "fps", FIXED: "fixed", RELATIVE: "relative" };
export const GameCameraFreezedAxis = { NONE: "", X: "x", Y: "y", Z: "z", XY: "xy", XZ: "xz", YZ: "yz", XYZ: "xyz" };
export const GameInputDirection = { NONE: "none", VERTICAL: "vertical", HORIZONTAL: "horizontal", BOTH: "both" };
export const GamePlayerMoveState = { FLYING: "fly", GROUND: "ground", SWIM: "swim", FALL: "fall", JUMP: "jump", DOUBLE_JUMP: "jump2" };
export const GamePlayerWalkState = { NONE: "", CROUCH: "crouch", WALK: "walk", RUN: "run" };
export const GameButtonType = { WALK: "walk", RUN: "run", CROUCH: "crouch", JUMP: "jump", DOUBLE_JUMP: "jump2", FLY: "fly", ACTION0: "action0", ACTION1: "action1" };
export const GameDialogType = { TEXT: "text", SELECT: "select", INPUT: "input" };
export const GameEasing = { NONE: "none", LINEAR: "linear", QUADRATIC: "quadratic", SINE: "sine", EXP: "exp", BACK: "back", ELASTIC: "elastic", BOUNCE: "bounce", CIRCLE: "circle" };
export const GameAnimationPlaybackState = { PENDING: "pending", RUNNING: "running", FINISHED: "finished" };
export const GameAnimationDirection = { NORMAL: "normal", REVERSE: "reverse", WRAP: "wrap", WRAP_REVERSE: "wrap-reverse", ALTERNATE: "alternate", ALTERNATE_REVERSE: "alternate-reverse" };
export const GameAssetType = { VOXEL_MESH: "mesh", DIRECTORY: "directory", COLOR_LUT: "lut", JS_SCRIPT: "js", IMAGE: "image", PARTICLE_TEXTURE: "snow", SOUND: "sound", PICTURE: "picture" };
export const GameLogLevel = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
export const SocialType = { FOLLOWING: 0, FOLLOWERS: 1, FRIENDS: 2 };
export const GameBodyPart = {
  HIPS: "hips", TORSO: "torso", NECK: "neck", HEAD: "head",
  LEFT_SHOULDER: "leftShoulder", LEFT_UPPER_ARM: "leftUpperArm", LEFT_LOWER_ARM: "leftLowerArm", LEFT_HAND: "leftHand",
  LEFT_UPPER_LEG: "leftUpperLeg", LEFT_LOWER_LEG: "leftLowerLeg", LEFT_FOOT: "leftFoot",
  RIGHT_SHOULDER: "rightShoulder", RIGHT_UPPER_ARM: "rightUpperArm", RIGHT_LOWER_ARM: "rightLowerArm", RIGHT_HAND: "rightHand",
  RIGHT_UPPER_LEG: "rightUpperLeg", RIGHT_LOWER_LEG: "rightLowerLeg", RIGHT_FOOT: "rightFoot",
};
export const PointerEventBehavior = { DISABLE_AND_BLOCK_PASS_THROUGH: 0, DISABLE: 1, BLOCK_PASS_THROUGH: 2, ENABLE: 3 };
export const ImageDisplayMode = { Fill: 0, Contain: 1, Cover: 2, None: 3 };
export const UITextFontFamily = { Default: 0, BoldRound: 1, CodeNewRomanBold: 2, ENSerif: 3 };

/* ------------------------------ 工具 ------------------------------ */
export function sleep(ms) { return new Promise((r) => setTimeout(r, Math.max(0, +ms || 0))); }
export function randomPick(arr) { return (arr || [])[Math.floor(Math.random() * (arr || []).length)]; }
export function getEntityBounds(entity) {
  const { lo, hi } = entityBoxOf(entity);
  return new GameBounds3(new GameVector3(lo.x, lo.y, lo.z), new GameVector3(hi.x, hi.y, hi.z));
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export function toVec3(v, dflt) {
  if (v instanceof GameVector3) return v;
  if (Array.isArray(v)) return new GameVector3(v[0] || 0, v[1] || 0, v[2] || 0);
  if (v && typeof v === "object" && "x" in v) return new GameVector3(v.x || 0, v.y || 0, v.z || 0);
  return dflt || new GameVector3();
}
export const packId = (id, rot) => (id | 0) + ((rot & 3) | 0) * ROT_SCALE;
export const baseId = (id) => ((id | 0) % ROT_SCALE) | 0;
export const rotOf = (id) => Math.floor((id | 0) / ROT_SCALE) & 3;
// 方块 velocity 语义按旋转码绕 Y 顺时针旋转（north = -z）
export function rotateVecByTurn(v, turn) {
  let [x, y, z] = v;
  const t = ((turn | 0) % 4 + 4) % 4;
  for (let i = 0; i < t; i++) { const nx = -z, nz = x; x = nx; z = nz; }
  return [x, y, z];
}
export function luma(c) { return c ? clamp01((c.red + c.green + c.blue) / 3) : 1; }
export function rgbHex(c, night) {
  if (!c) return 0x000000;
  const k = 1 - (night || 0) * 0.75;
  const to = (v) => Math.round(clamp01(v * k) * 255);
  return (to(c.red) << 16) | (to(c.green) << 8) | to(c.blue);
}
export function pickEnv(z) {
  const out = {};
  let any = false;
  // 官方 GameZoneConfig 的环境覆盖键有 30+ 个（fog* / rain* / snow* / sky*），逐个列举必然漏；按前缀全量透传
  for (const k of Object.keys(z || {})) {
    if (/^(fog|rain|snow|sky)[A-Z]/.test(k)) { out[k] = z[k]; any = true; }
  }
  return any ? out : null;
}
export function colorTriple(c) {
  if (c instanceof GameRGBColor) return [clamp01(Math.abs(c.red) > 1 ? c.red / 8 : c.red), clamp01(Math.abs(c.green) > 1 ? c.green / 8 : c.green), clamp01(Math.abs(c.blue) > 1 ? c.blue / 8 : c.blue)];
  if (Array.isArray(c)) { const m = Math.max(...c.map(Math.abs)) || 1; return c.map((v) => clamp01(Math.abs(v) / (m > 1 ? m : 1))); }
  return [1, 1, 1];
}
// 官方 meshColor 是 GameRGBAColor（0..1）。脚本侧可能写 {red,green,blue}、{r,g,b,a}、
// [r,g,b]、0xRRGGBB 或 "#rrggbb"，统一收成一个 GameRGBAColor，避免赋值后材质读到 undefined。
export function rgbaOf(v, cur) {
  const out = cur instanceof GameRGBAColor ? cur : new GameRGBAColor(1, 1, 1, 1);
  if (v == null) return out;
  let r = null, g = null, b = null, a = null;
  if (Array.isArray(v)) { r = v[0]; g = v[1]; b = v[2]; a = v.length > 3 ? v[3] : null; }
  else if (typeof v === "number") { r = ((v >> 16) & 255) / 255; g = ((v >> 8) & 255) / 255; b = (v & 255) / 255; }
  else if (typeof v === "string") { const c = new THREE.Color(v); r = c.r; g = c.g; b = c.b; }
  else {
    r = v.red !== undefined ? v.red : v.r;
    g = v.green !== undefined ? v.green : v.g;
    b = v.blue !== undefined ? v.blue : v.b;
    a = v.alpha !== undefined ? v.alpha : (v.a !== undefined ? v.a : null);
  }
  if (r != null) out.red = Number(r);
  if (g != null) out.green = Number(g);
  if (b != null) out.blue = Number(b);
  if (a != null) out.alpha = Number(a);
  return out;
}
// 官方 particleColor/particleSize 是随寿命衰减的坡道数组
export function sampleRamp(arr, k) {
  if (!arr || !arr.length) return null;
  if (arr.length === 1) return colorTriple(arr[0]);
  const i = clamp(k, 0, 0.999999) * (arr.length - 1);
  const a = Math.floor(i), b = Math.min(arr.length - 1, a + 1), f = i - a;
  const ca = colorTriple(arr[a]), cb = colorTriple(arr[b]);
  return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
}
export function sampleRampNum(arr, k) {
  if (!arr || !arr.length) return null;
  if (arr.length === 1) return arr[0];
  const i = clamp(k, 0, 0.999999) * (arr.length - 1);
  const a = Math.floor(i), b = Math.min(arr.length - 1, a + 1);
  return arr[a] + (arr[b] - arr[a]) * (i - a);
}
export function newParticle(ent) {
  const spread = (v) => v || 0;
  const pv = toVec3(ent.particleVelocity), pvs = toVec3(ent.particleVelocitySpread);
  const life = Math.max(0.05, (ent.particleLifetime || 1) + (Math.random() - 0.5) * 2 * spread(ent.particleLifetimeSpread));
  const speed = 60 / TICK_MS; // 官方 velocity 以每 tick 为单位
  return {
    t: 0, life,
    x: (Math.random() - 0.5) * 0.4, y: (Math.random() - 0.5) * 0.4, z: (Math.random() - 0.5) * 0.4,
    vx: (pv.x + (Math.random() - 0.5) * 2 * pvs.x) * speed,
    vy: (pv.y + (Math.random() - 0.5) * 2 * pvs.y) * speed,
    vz: (pv.z + (Math.random() - 0.5) * 2 * pvs.z) * speed,
    // 官方：particleSizeSpread 是「每个粒子」抽一次 [0, spread) 的随机数，再逐段加到 particleSize 上
    sizeAdd: Math.random() * spread(ent.particleSizeSpread),
    seed: Math.random() * 100,
  };
}
// 官方选择器：'*'、'.tag'、'#id'、'player'、组合 '.a .b'
export function matchSelector(sel, ent, rt) {
  const s = String(sel == null ? "*" : sel).trim();
  if (!s || s === "*") return true;
  for (const part of s.split(/\s+/).filter(Boolean)) {
    if (part === "player" || part === "players") { if (!ent.isPlayer) return false; continue; }
    if (part.startsWith("#")) { if (String(ent.id) !== part.slice(1)) return false; continue; }
    if (part.startsWith(".")) { if (!ent.hasTag(part.slice(1))) return false; continue; }
    if (part.includes("|")) { if (!part.split("|").some((t) => matchSelector(t, ent, rt))) return false; continue; }
    if (!ent.hasTag(part) && String(ent.id) !== part) return false;
  }
  return true;
}
const KEYCODE = {
  BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CONTROL: 17, ALT: 18, ESCAPE: 27, SPACE: 32,
  PAGEUP: 33, PAGEDOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
  INSERT: 45, DELETE: 46, MINUS: 189, EQUAL: 187, BRACKET_OPEN: 219, BACKSLASH: 220,
  BRACKET_CLOSE: 221, QUOTE: 222, COMMA: 188, PERIOD: 190, SLASH: 191, BACKTICK: 192,
};
export function keyCodeOf(ev) {
  if (ev.keyCode) return ev.keyCode;
  const c = String(ev.code || "");
  if (/^Key[A-Z]$/.test(c)) return c.charCodeAt(3); // A=65 … Z=90
  if (/^Digit[0-9]$/.test(c)) return c.charCodeAt(5); // 0=48 … 9=57
  if (/^F([1-9]|1[0-2])$/.test(c)) return 111 + Number(c.slice(1)); // F1=112 … F12=123
  return KEYCODE[c.replace(/^Key/, "").replace(/^Digit/, "")] || 0;
}
// 统一的实体盒口径：盒心 = position + anchorOffset（官方 anchorOffset 就是几何中心相对锚点的偏移），
// 半径 = |bounds|。以前射线按「position 为底面」、getEntityBounds 按「position 为盒心」两套算法，会差半个高。
export function entityBoxOf(ent) {
  const b = ent.bounds || { x: 0.5, y: 0.5, z: 0.5 };
  const c = ent.position;
  const a = ent.anchorOffset || { x: 0, y: 0, z: 0 };
  const cx = c.x + (a.x || 0), cy = c.y + (a.y || 0), cz = c.z + (a.z || 0);
  const rx = Math.abs(b.x), ry = Math.abs(b.y), rz = Math.abs(b.z);
  return { lo: { x: cx - rx, y: cy - ry, z: cz - rz }, hi: { x: cx + rx, y: cy + ry, z: cz + rz }, cx, cy, cz, rx, ry, rz };
}
// 命中返回真正的入射参数 t（>0），未命中返回 -1；out 可选，用于取回命中面法线
export function rayHitsBox(ent, o, dir, tMax, out) {
  const { lo, hi } = entityBoxOf(ent);
  let t0 = 0, t1 = tMax, hitAxis = -1;
  for (const ax of ["x", "y", "z"]) {
    const d = dir[ax];
    if (Math.abs(d) < 1e-9) { if (o[ax] < lo[ax] || o[ax] > hi[ax]) return -1; continue; }
    let ta = (lo[ax] - o[ax]) / d, tb = (hi[ax] - o[ax]) / d;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) { t0 = ta; hitAxis = ax; }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  if (t0 > tMax) return -1;
  if (out && hitAxis >= 0) {
    const inward = dir[hitAxis] > 0 ? -1 : 1;
    out.normal = { x: 0, y: 0, z: 0 };
    out.normal[hitAxis] = inward;
  }
  return t0;
}

/* ------------------------------ 事件通道 ------------------------------ */
// 官方：on*(handler) 返回 {cancel,resume,active} token；next*(filter?) 返回 Promise。
export function makeChannel() {
  const handlers = [];
  const on = (h) => {
    if (typeof h !== "function") return { cancel: () => {}, resume: () => {}, active: () => false };
    const rec = { h, active: true };
    handlers.push(rec);
    return { cancel: () => { rec.active = false; }, resume: () => { rec.active = true; }, active: () => rec.active };
  };
  const next = (filter) => new Promise((resolve) => {
    const tok = on((ev) => { if (!filter || filter(ev)) { tok.cancel(); resolve(ev); } });
  });
  return {
    on, next, handlers,
    fire: (ev) => {
      for (const rec of [...handlers]) {
        if (!rec.active) continue;
        try { rec.h(ev); } catch (err) { reportError(err); }
      }
    },
  };
}
export function attachChannels(target, names) {
  const chans = {};
  for (const n of names) {
    const c = makeChannel();
    chans[n] = c;
    target["on" + n] = c.on;
    target["next" + n] = c.next;
  }
  return chans;
}
export function reportError(err) {
  const msg = err && err.message ? err.message : String(err);
  const el = document.getElementById("gameConsole");
  if (el) consoleDiv(el, "事件错误: " + msg, "err");
  window.__errs && window.__errs.push && window.__errs.push(msg);
}
export function consoleDiv(el, text, kind) {
  const p = el || document.getElementById("gameConsole");
  if (!p) return;
  const d = document.createElement("div");
  d.className = "c-" + (kind || "log");
  d.textContent = String(text);
  p.appendChild(d);
  while (p.children.length > 200) p.removeChild(p.firstChild);
  p.scrollTop = p.scrollHeight;
}
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function fmt(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/* ------------------------------ Sound ------------------------------ */
// 官方 Sound：创建即播放，提供 pause/resume/stop/setCurrentTime。
export class Sound {
  constructor(runtime, spec, origin) {
    const s = typeof spec === "string" ? { sample: spec } : (spec || {});
    this.spec = s;
    this.sample = s.sample || "";
    this.radius = s.radius ?? 32;
    // 官方还有 gainRange / pitchRange：每次播放落在 ±range 内
    const gr = s.gainRange ?? 0, pr = s.pitchRange ?? 0;
    this.gain = Math.max(0, (s.gain ?? 1) * (1 + (Math.random() * 2 - 1) * gr));
    this.pitch = Math.max(0.05, (s.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * pr));
    this.origin = origin || null;
    this.paused = false;
    this._rt = runtime;
    this._audio = runtime._openAudio(this.sample, { loop: !!s.loop, volume: this.gain, rate: this.pitch });
  }
  _applyVolume() {
    if (!this._audio || !this._rt.playerEntity) return;
    let v = this.gain;
    const op = this.origin && (this.origin.position || this.origin);
    if (op && this.radius > 0) {
      const d = this._rt.playerEntity.position.distance(toVec3(op));
      v *= clamp(1 - d / this.radius, 0, 1);
    }
    this._audio.volume = clamp(v, 0, 1);
  }
  pause() { this.paused = true; if (this._audio) this._audio.pause(); }
  resume(t) {
    this.paused = false;
    if (t !== undefined) this.setCurrentTime(t);
    if (this._audio) this._audio.play().catch(() => {});
  }
  stop() {
    if (this._audio) { try { this._audio.pause(); this._audio.currentTime = 0; } catch {} }
    this._rt._sounds.delete(this);
  }
  setCurrentTime(t) { if (this._audio) { try { this._audio.currentTime = +t || 0; } catch {} } }
  get currentTime() { return this._audio ? this._audio.currentTime : 0; }
}

/* ------------------------------ 关键帧动画 ------------------------------ */
// world/entity/player.animate(keyframes, playback)：keyframe 首项 duration/easeIn/easeOut。
const EASE = {
  none: (t) => t, linear: (t) => t, quadratic: (t) => t * t, sine: (t) => 0.5 - Math.cos(t * Math.PI) / 2,
  exp: (t) => t * t * t, back: (t) => t * t * (2.7 * t - 1.7), elastic: (t) => t * t * (3 * t - 2),
  bounce: (t) => 1 - Math.abs(1 - 2 * t) * 0.2, circle: (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
};
export class GameAnimation {
  constructor(rt, target, keyframes, playback, kind) {
    this._rt = rt;
    this.target = target;
    this.kind = kind || "entity";
    this._kf = keyframes;
    this.playback = Object.assign({ duration: 0, delay: 0, endDelay: 0, iterations: 1, direction: GameAnimationDirection.NORMAL, iterationStart: 0 }, playback || {});
    this.startTime = rt.currentTick + (this.playback.startTick ?? 0) + (this.playback.delay || 0) / TICK_MS;
    this.currentTime = 0;
    this.playState = GameAnimationPlaybackState.RUNNING;
    this.playbackRate = 1;
    this._ch = attachChannels(this, ["Ready", "Finish", "Cancel"]);
    this._ch.Ready.fire({ tick: rt.currentTick, target });
    this._total = keyframes.reduce((s, k) => s + (k.duration || 0), 0) || 1;
    this._elapsed = 0;
    this._iter = 0;
    this.then = (res, rej) => this._ch.Finish.next().then(res, rej);
  }
  keyframes() { return this._kf; }
  play(playback) { if (playback) Object.assign(this.playback, playback); this.playState = GameAnimationPlaybackState.RUNNING; }
  cancel() {
    if (this.playState === GameAnimationPlaybackState.FINISHED) return;
    this.playState = GameAnimationPlaybackState.FINISHED;
    this._ch.Cancel.fire({ tick: this._rt.currentTick, target: this.target });
    this._rt.animations = this._rt.animations.filter((a) => a !== this);
  }
  _update() {
    if (this.playState !== GameAnimationPlaybackState.RUNNING) return;
    this._elapsed += 1; // 每 tick 推进 1
    const seg = this._locate(this._elapsed);
    if (!seg) { this._finish(); return; }
    this._apply(seg.k0, seg.k1, seg.f);
    this.currentTime = this._elapsed * TICK_MS;
  }
  _locate(tick) {
    const per = this._total;
    const iters = Number.isFinite(this.playback.iterations) ? this.playback.iterations : Infinity;
    const it = Math.floor(tick / per);
    if (it >= iters) return null;
    let local = tick - it * per;
    if (this.playback.direction === GameAnimationDirection.REVERSE) local = per - 1 - local;
    let acc = 0;
    for (let i = 0; i < this._kf.length - 1; i++) {
      const d = this._kf[i].duration || 0;
      if (local <= acc + d) {
        const f = d ? (local - acc) / d : 1;
        return { k0: this._kf[i], k1: this._kf[i + 1], f };
      }
      acc += d;
    }
    return { k0: this._kf[this._kf.length - 1], k1: this._kf[this._kf.length - 1], f: 1 };
  }
  _apply(k0, k1, f) {
    const t = this.target;
    const ease = (EASE[k0.easeOut || k0.easeIn || "linear"] || EASE.linear)(f);
    for (const key of Object.keys(k1)) {
      if (key === "duration" || key === "easeIn" || key === "easeOut") continue;
      const a = k0[key], b = k1[key];
      if (a === undefined) { t[key] = b; continue; }
      t[key] = lerpValue(a, b, ease);
    }
  }
  _finish() {
    this.playState = GameAnimationPlaybackState.FINISHED;
    this._ch.Finish.fire({ tick: this._rt.currentTick, target: this.target });
    this._rt.animations = this._rt.animations.filter((a) => a !== this);
  }
}
function lerpValue(a, b, f) {
  if (typeof b === "number") return a + (b - a) * f;
  if (a instanceof GameVector3 && b && "x" in b) return a.lerp(toVec3(b), f);
  if (a instanceof GameRGBColor && b && "red" in b) return a.lerp(b, f);
  if (a instanceof GameQuaternion && b && "w" in b) return a.slerp(b, f);
  return f < 0.5 ? a : b;
}

/* ------------------------------ 动作控制器 ------------------------------ */
// entity.motion.loadByName(config) -> GameMotionHandler{play,cancel,onFinish,nextFinish,target}
export function makeMotionController(ent, rt) {
  const ctrl = {
    loadByName: (config) => makeHandler(ent, rt, config),
    setDefaultMotionByName: (name) => { ent._defaultMotionName = name; },
  };
  return ctrl;
}
function makeHandler(ent, rt, config) {
  const cfg = typeof config === "string" ? { motions: [{ name: config, iterations: 1 }] } : (config || {});
  const motions = cfg.motions || (cfg.name ? [{ name: cfg.name, iterations: 1 }] : []);
  const outer = cfg.iterations ?? 1;
  const ch = attachChannels({}, ["Finish", "Cancel"]);
  const handler = {
    target: ent,
    playing: false,
    play: () => { handler.playing = true; start(0); return handler; },
    cancel: () => {
      handler.playing = false;
      ent._mixerAction = null;
      ch.Cancel.fire({ tick: rt.currentTick, target: ent, motionHandler: handler, cancelled: true });
    },
    pause: () => { if (ent._mixerAction) ent._mixerAction.paused = true; },
    resume: () => { if (ent._mixerAction) ent._mixerAction.paused = false; },
    onFinish: ch.Finish.on, nextFinish: ch.Finish.next, onCancel: ch.Cancel.on, nextCancel: ch.Cancel.next,
    get cancelled() { return !handler.playing; },
  };
  const names = motions.map((m) => m.name);
  function start(loop) {
    const name = names[0] || "run";
    if (ent._mixer && ent._clips && ent._clips.length) {
      const clip = ent._clips.find((c) => c.name && c.name.toLowerCase().includes(String(name).toLowerCase())) || ent._clips[0];
      const action = ent._mixer.clipAction(clip);
      action.reset();
      action.setLoop(outer === Infinity ? THREE.LoopPingPong : THREE.LoopOnce, outer === Infinity ? Infinity : 1);
      action.clampWhenFinished = true;
      action.play();
      ent._mixerAction = action;
      ent._motionPlaying = true;
      return;
    }
    ent._motionPlaying = true;
    ent._motionKind = name;
    // 官方 .vb→gltf 的转换没有保留动画轨道（实测 20 个模型 clips 全为 0），
    // 所以 loadByName 指定的动作根本不存在。这里不伪造动画，但必须说清楚：
    // 否则脚本作者以为动作在跑、只是"效果不明显"，会往错误的方向查半天。
    const key = "motion:" + (ent._meshName || ent.id) + ":" + name;
    if (name && rt._warned && !rt._warned.has(key)) {
      rt._warned.add(key);
      consoleDiv(rt.hud && rt.hud.console,
        `实体 ${ent.id} 的网格没有名为 "${name}" 的动画轨道（该模型不含任何动画数据），已跳过播放`, "warn");
    }
  }
  return handler;
}
