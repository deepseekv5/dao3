// avatar.js — 角色本身：唯一一份人偶几何与配色。
//
// 为什么要从 game.js 里抽出来：这具人偶以前有三个各自独立的画法——运行时
// `makeAvatar()`、皮肤面板里手搓的一份、个人主页上一张纯 CSS 纸片人。
// 三份各自调比例、各自配暗部，于是"我主页上看到的"和"我进图之后是"永远不像
// 同一个人。抽成一份之后，预览就是运行时那一份，改不动第二遍。
//
// THREE 与 `clamp` 的来路和 game.js 一致，导出的对象契约（userData.parts /
// userData.rig）也与 skin-rig.js 的 poseWalk() 对齐：预览里走的那套循环，
// 就是图里走路用的那套公式。
import * as THREE from "../vendor/three/three.module.js";
import { clamp } from "./gapi.js";
import { buildTexturedAvatar, loadSkinTexture } from "./skin3d.js";

// 圆角盒：把 90° 硬边倒成球面，顶点按"到内侧盒面的向量"重定位，
// 法线用同一个式子解析求出。平面上它正好退化成面法线，所以相邻面在接缝处
// 拿到同一个法线——不必 mergeVertices 也能全表面平滑着色。
// 为什么要换掉直角盒：整套人偶由三十个 90° 硬边盒子拼成时，剪影读起来是
// "一摞纸箱"而不是"一个人"。这是"不好看"的第一来源，比配色严重。
const _rboxCache = new Map();
export function rbox(w, h, d, r, seg = 5) {
  const key = `${w}|${h}|${d}|${r}|${seg}`;
  const hit = _rboxCache.get(key);
  if (hit) return hit;
  const rad = Math.max(0.002, Math.min(r, w / 2, h / 2, d / 2));
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const ix = w / 2 - rad, iy = h / 2 - rad, iz = d / 2 - rad;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = clamp(x, -ix, ix), cy = clamp(y, -iy, iy), cz = clamp(z, -iz, iz);
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-9) {
      const k = rad / len;
      pos.setXYZ(i, cx + dx * k, cy + dy * k, cz + dz * k);
      nor.setXYZ(i, dx / len, dy / len, dz / len);
    }
  }
  geo.computeBoundingSphere();
  _rboxCache.set(key, geo);
  return geo;
}

/** #rrggbb 或 0x 整数 → 乘一个系数得到暗部，避免每个部位都要手配两色。 */
export function shade(color, k) {
  const n = typeof color === "string" ? parseInt(color.replace("#", ""), 16) : (color | 0);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** 账号皮肤（社区里那份）覆盖基础色；只认 #rrggbb，其余保持默认。 */
export function avatarPalette(override) {
  const src = override && typeof override === "object" ? override : {};
  const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? parseInt(String(v).slice(1), 16) : null);
  const C = {
    skin: 0xe7b98f, skinShade: 0xc9956c, skinLight: 0xf4d3b3, blush: 0xd98f7c,
    hair: 0x2a211d, hairDeep: 0x171311, hairLight: 0x49362b,
    eye: 0x26313a, shine: 0xfff8e9, lip: 0xa85f52,
    shirt: 0xd5a24a, shirtDeep: 0x9f7030, shirtLight: 0xf0c874,
    collar: 0xf3eee4, button: 0x39424a, accent: 0x2f7f86, accentDeep: 0x235c63,
    pants: 0x2b3440, pantsDeep: 0x1d2530, pantsLight: 0x3c4958,
    belt: 0x1c2026, buckle: 0xe3a63c,
    shoe: 0xeee9df, sole: 0x30343a, shoeAccent: 0xd5a24a,
  };
  for (const [key, base] of [["skin", "skin"], ["shirt", "shirt"], ["pants", "pants"], ["hair", "hair"], ["shoe", "shoe"]]) {
    const v = hex(src[key]);
    if (v == null) continue;
    C[key] = v;
    if (key === "skin") { C.skinShade = shade(v, 0.84); C.skinLight = shade(v, 1.12); C.blush = shade(v, 0.92); }
    if (key === "shirt") { C.shirtDeep = shade(v, 0.68); C.shirtLight = shade(v, 1.18); C.shoeAccent = v; }
    if (key === "pants") { C.pantsDeep = shade(v, 0.70); C.pantsLight = shade(v, 1.25); }
    if (key === "hair") { C.hairDeep = shade(v, 0.58); C.hairLight = shade(v, 1.35); }
    if (key === "shoe") C.sole = shade(v, 0.30);
  }
  return C;
}

/** 接触阴影（blob shadow）：一张贴着地面跟脚走的软边椭圆。
 *  太阳的阴影贴图只覆盖投影那一片，夜里/洞里还会整块关掉，于是角色"飘在半空"。
 *  脚下那点永远存在的暗，是体素游戏里最便宜也最有效的接地手段。 */
let _blobGeo = null, _blobTex = null;
export function blobShadowMesh() {
  if (!_blobTex) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const rad = g.createRadialGradient(32, 32, 3, 32, 32, 31);
    rad.addColorStop(0, "rgba(0,0,0,.5)"); rad.addColorStop(.55, "rgba(0,0,0,.24)"); rad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rad; g.fillRect(0, 0, 64, 64);
    _blobTex = new THREE.CanvasTexture(c);
    _blobGeo = new THREE.PlaneGeometry(1, 1);
  }
  const m = new THREE.Mesh(_blobGeo, new THREE.MeshBasicMaterial({ map: _blobTex, transparent: true, depthWrite: false, opacity: .9 }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  m.visible = false;
  return m;
}

/** 体型三档：Roblox 那套 Height / Width / Proportion 的本地版。
 *  乘在**新加的内层 group** 上，而不是返回值本身——外层 scale 归 `player.scale`
 *  用（运行时每帧按它 setScalar 写一遍），抢过来就是"调了体型之后玩家缩放失效"
 *  或者反过来被每帧覆盖。
 *  腿长另算：腿的原点在髋（y=0.80），绕髋放大只会把脚沉进地里，所以腿放大之后
 *  必须把躯干/头/手臂整体抬起来，`rig.base` 那三个基准高度跟着一起改——
 *  poseWalk 是按 base 值写绝对高度的，不改就会走路时上半身和腿脱开。 */
const HIP = 0.70;
export const BODY_LIMITS = { min: 0.8, max: 1.25 };
function applyBody(av, body) {
  const src = body && typeof body === "object" ? body : {};
  const mul = (x) => (Number.isFinite(Number(x)) ? Math.min(BODY_LIMITS.max, Math.max(BODY_LIMITS.min, Number(x))) : 1);
  const h = mul(src.h), w = mul(src.w), leg = mul(src.leg);
  if (h === 1 && w === 1 && leg === 1) return av;
  const root = new THREE.Group();
  // 把已经挂上去的东西整体搬进内层：贴图人偶与手工人偶走的是两条构造路径，
  // 在这里统一处理，比在两条路径里各插一层 group 少错一处。
  for (const child of [...av.children]) root.add(child);
  av.add(root);
  av.userData.bodyRoot = root;
  const parts = av.userData.parts || {};
  if (leg !== 1) {
    const lift = (leg - 1) * HIP;
    for (const k of ["head", "body", "armL", "armR"]) {
      const p = parts[k];
      if (p) p.position.y += lift;
    }
    const base = av.userData.rig && av.userData.rig.base;
    if (base) for (const k of ["head", "body", "armL", "armR"]) if (typeof base[k] === "number") base[k] += lift;
  }
  root.scale.set(w, h, w);
  // 预览要知道该把机位拉多远：身高 1.25 还按标准身高取景就会裁掉头
  av.userData.bodyScale = { h, w, leg };
  return av;
}

export function makeAvatar(skinOverride) {
  const bodyOf = skinOverride && typeof skinOverride === "object" ? skinOverride.body : null;
  const texSrc = skinOverride && typeof skinOverride === "object" ? skinOverride.texture : null;
  if (typeof texSrc === "string" && texSrc) {
    const av = applyBody(buildTexturedAvatar(null), bodyOf);
    loadSkinTexture(texSrc).then((t) => {
      av.traverse((o) => { if (o.isMesh) { o.material.map = t; o.material.needsUpdate = true; } });
    }).catch(() => { });
    return av;
  }
  const g = new THREE.Group();
  const std = (hex, rough = 0.78) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 });
  const C = avatarPalette(skinOverride);
  const part = (name, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); p.name = name; g.add(p); return p; };
  const box = (parent, w, h, d, hex, x, y, z, tint, rough = 0.78, r = 0.035) => {
    const m = new THREE.Mesh(rbox(w, h, d, r == null ? Math.min(w, h, d) * 0.32 : r), std(hex, rough));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.baseColor = hex;
    if (tint) m.userData.tint = tint;
    parent.add(m);
    return m;
  };

  box(g, 0.18, 0.16, 0.18, C.skinShade, 0, 1.29, 0, "skin", 0.8, 0.045);
  const head = part("head", 0, 1.30, 0);
  box(head, 0.54, 0.52, 0.48, C.skin, 0, 0.26, 0, "skin", 0.72, 0.115);
  box(head, 0.055, 0.11, 0.075, C.skinShade, -0.286, 0.245, -0.005, "skin", 0.8, 0.025);
  box(head, 0.055, 0.11, 0.075, C.skinShade, 0.286, 0.245, -0.005, "skin", 0.8, 0.025);
  box(head, 0.57, 0.20, 0.51, C.hair, 0, 0.445, -0.012, null, 0.56, 0.09);
  box(head, 0.49, 0.34, 0.14, C.hairDeep, 0, 0.285, -0.225, null, 0.6, 0.055);
  box(head, 0.15, 0.20, 0.10, C.hair, -0.245, 0.255, 0.175, null, 0.58, 0.035);
  box(head, 0.15, 0.17, 0.10, C.hair, 0.245, 0.275, 0.175, null, 0.58, 0.035);
  box(head, 0.17, 0.105, 0.055, C.hairLight, -0.155, 0.405, 0.245, null, 0.52, 0.025);
  box(head, 0.15, 0.085, 0.055, C.hair, 0.005, 0.42, 0.248, null, 0.54, 0.022);
  box(head, 0.13, 0.075, 0.055, C.hairDeep, 0.15, 0.435, 0.245, null, 0.54, 0.022);
  box(head, 0.125, 0.028, 0.03, C.hairDeep, -0.125, 0.335, 0.247, null, 0.65, 0.01);
  box(head, 0.125, 0.028, 0.03, C.hairDeep, 0.125, 0.335, 0.247, null, 0.65, 0.01);
  for (const side of [-1, 1]) {
    const x = side * 0.125;
    box(head, 0.115, 0.125, 0.028, C.collar, x, 0.245, 0.242, null, 0.42, 0.025);
    box(head, 0.060, 0.078, 0.022, C.eye, x + side * 0.008, 0.238, 0.263, null, 0.25, 0.018);
    box(head, 0.020, 0.026, 0.012, C.shine, x - side * 0.012, 0.267, 0.279, null, 0.18, 0.006);
    box(head, 0.070, 0.032, 0.018, C.blush, side * 0.183, 0.145, 0.241, "skin", 0.95, 0.012);
  }
  box(head, 0.048, 0.065, 0.045, C.skinLight, 0, 0.177, 0.255, "skin", 0.76, 0.015);
  box(head, 0.092, 0.024, 0.020, C.lip, 0, 0.102, 0.25, null, 0.6, 0.009);

  const body = part("body", 0, 0.70, 0);
  box(body, 0.50, 0.60, 0.30, C.shirt, 0, 0.30, 0, "cloth", 0.82, 0.075);
  box(body, 0.55, 0.16, 0.31, C.shirtLight, 0, 0.52, -0.005, "cloth", 0.8, 0.05);
  box(body, 0.14, 0.43, 0.035, C.accent, 0, 0.31, 0.164, null, 0.76, 0.018);
  const collarL = box(body, 0.17, 0.075, 0.04, C.collar, -0.092, 0.535, 0.171, null, 0.68, 0.02);
  const collarR = box(body, 0.17, 0.075, 0.04, C.collar, 0.092, 0.535, 0.171, null, 0.68, 0.02);
  collarL.rotation.z = -0.32; collarR.rotation.z = 0.32;
  box(body, 0.024, 0.38, 0.024, C.button, 0, 0.30, 0.19, null, 0.38, 0.008);
  box(body, 0.034, 0.034, 0.026, C.buckle, 0, 0.43, 0.204, null, 0.32, 0.008);
  box(body, 0.13, 0.115, 0.03, C.shirtDeep, -0.145, 0.285, 0.17, "cloth", 0.84, 0.018);
  box(body, 0.14, 0.035, 0.035, C.accent, -0.145, 0.35, 0.184, null, 0.7, 0.012);
  box(body, 0.52, 0.075, 0.315, C.belt, 0, 0.045, 0, null, 0.62, 0.022);
  box(body, 0.085, 0.064, 0.035, C.buckle, 0, 0.045, 0.174, null, 0.3, 0.014);
  for (const x of [-0.17, 0.17]) box(body, 0.035, 0.09, 0.33, C.shirtDeep, x, 0.045, 0, null, 0.7, 0.012);

  const rig = {};
  const arm = (name, side) => {
    const a = part(name, side * 0.34, 1.22, 0);
    box(a, 0.18, 0.34, 0.19, C.shirt, 0, -0.17, 0, "cloth", 0.82, 0.05);
    box(a, 0.185, 0.055, 0.20, C.shirtDeep, 0, -0.35, 0, "cloth", 0.76, 0.018);
    box(a, 0.08, 0.07, 0.205, C.accent, 0, -0.305, 0, null, 0.72, 0.016);
    const elbow = new THREE.Group(); elbow.position.set(0, -0.37, 0); a.add(elbow);
    box(elbow, 0.15, 0.27, 0.16, C.skin, 0, -0.135, 0, "skin", 0.74, 0.038);
    box(elbow, 0.16, 0.18, 0.17, C.skin, 0, -0.31, 0.008, "skin", 0.72, 0.042);
    box(elbow, 0.055, 0.10, 0.07, C.skinShade, -side * 0.085, -0.27, 0.025, "skin", 0.78, 0.018);
    rig[name === "armL" ? "elbowL" : "elbowR"] = elbow;
    return a;
  };
  const armL = arm("armL", -1), armR = arm("armR", 1);

  const leg = (name, side) => {
    const l = part(name, side * 0.13, 0.70, 0);
    box(l, 0.22, 0.32, 0.22, C.pants, 0, -0.16, 0, "cloth", 0.86, 0.05);
    box(l, 0.14, 0.13, 0.028, C.pantsLight, 0, -0.15, 0.116, "cloth", 0.88, 0.018);
    const knee = new THREE.Group(); knee.position.set(0, -0.32, 0); l.add(knee);
    box(knee, 0.20, 0.30, 0.21, C.pantsDeep, 0, -0.15, 0, "cloth", 0.86, 0.045);
    box(knee, 0.23, 0.15, 0.34, C.shoe, 0, -0.29, 0.065, null, 0.62, 0.045);
    box(knee, 0.24, 0.045, 0.35, C.sole, 0, -0.365, 0.07, null, 0.82, 0.016);
    box(knee, 0.23, 0.038, 0.055, C.shoeAccent, 0, -0.245, 0.225, null, 0.66, 0.012);
    for (const y of [-0.27, -0.31]) box(knee, 0.13, 0.018, 0.018, C.collar, 0, y, 0.257, null, 0.8, 0.006);
    rig[name === "legL" ? "kneeL" : "kneeR"] = knee;
    return l;
  };
  const legL = leg("legL", -1), legR = leg("legR", 1);

  armL.rotation.z = -0.055; armR.rotation.z = 0.055;
  g.userData.parts = { head, body, armL, armR, legL, legR };
  g.userData.rig = Object.assign({ base: { head: 1.30, body: 0.70, armL: 1.22, armR: 1.22 } }, rig);
  return applyBody(g, bodyOf);
}
