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
    skin: 0xffd7b0, skinShade: 0xeab88e, blush: 0xe9ac96, hair: 0x6b4630, hairDeep: 0x54372a,
    eye: 0x3a3644, shine: 0xffffff, lip: 0xc0705f,
    shirt: 0xc9714f, shirtDeep: 0x9c5740, collar: 0xf6f1e8, button: 0xece2d2,
    pants: 0x6b625a, pantsDeep: 0x524a44, belt: 0x5b4636, buckle: 0xd9b45e,
    shoe: 0x7b5441, sole: 0x332a2b,
  };
  for (const [key, base] of [["skin", "skin"], ["shirt", "shirt"], ["pants", "pants"], ["hair", "hair"], ["shoe", "shoe"]]) {
    const v = hex(src[key]);
    if (v == null) continue;
    C[key] = v;
    if (key === "skin") { C.skinShade = shade(v, 0.9); C.blush = shade(v, 0.82); }
    if (key === "shirt") C.shirtDeep = shade(v, 0.72);
    if (key === "pants") C.pantsDeep = shade(v, 0.78);
    if (key === "hair") C.hairDeep = shade(v, 0.75);
    if (key === "shoe") C.sole = shade(v, 0.45);
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
const HIP = 0.80;
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
  // 带 MC 皮肤贴图时走经典六面体：把苦力怕的脸贴到 0.46×0.50 的圆角头上，
  // 脸会被挤变形，认不出是谁。没有贴图才走下面那套细节人偶。
  const texSrc = skinOverride && typeof skinOverride === "object" ? skinOverride.texture : null;
  if (typeof texSrc === "string" && texSrc) {
    const av = applyBody(buildTexturedAvatar(null), bodyOf);
    loadSkinTexture(texSrc).then((t) => {
      av.traverse((o) => { if (o.isMesh) { o.material.map = t; o.material.needsUpdate = true; } });
    }).catch(() => { /* 图坏了就留着白模，别把角色变没 */ });
    return av;
  }
  const g = new THREE.Group();
  // 官方 player.metalness / emissive / shininess 是 PBR 参数，Lambert 材质读不到，
  // 所以人偶统一用 Standard（roughness 1 / metalness 0 时观感接近原来的 Lambert）
  const std = (hex, rough = 0.78) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 });
  // 默认配色按"低饱和场景里要跳得出来"来选：游戏光照偏暗（globalLight 0.29 起），
  // 中蓝+深蓝裤子在这个光照下会糊成一块黑柱子。账号皮肤传进来时覆盖对应几项。
  const C = avatarPalette(skinOverride);
  const part = (name, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); p.name = name; g.add(p); return p; };
  // box 的 y 是相对**所属关节**的偏移，不是世界高度。r 缺省取最短边的 32%，
  // 所以厚 0.02 的贴片几乎仍是直角（细节要利落），而头/躯干这种体量会明显圆起来。
  const box = (parent, w, h, d, hex, x, y, z, tint, rough, r) => {
    const m = new THREE.Mesh(rbox(w, h, d, r == null ? Math.min(w, h, d) * 0.32 : r), std(hex, rough));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.baseColor = hex;
    if (tint) m.userData.tint = tint;
    parent.add(m);
    return m;
  };

  // 头：占满 1.30..1.80，圆角收到"玩具人偶"而不是"鸡蛋"的程度
  const head = part("head", 0, 1.30, 0);
  box(head, 0.46, 0.50, 0.42, C.skin, 0, 0.25, 0, "skin", 0.74, 0.12);   // 头
  box(head, 0.045, 0.085, 0.062, C.skinShade, -0.222, 0.225, -0.02, "skin"); // 左耳（贴着颅侧，突出量只留一点）
  box(head, 0.045, 0.085, 0.062, C.skinShade, 0.222, 0.225, -0.02, "skin");  // 右耳
  box(head, 0.485, 0.22, 0.45, C.hair, 0, 0.41, -0.015, null, 0.62, 0.10);   // 头发帽（盖住头顶，露出额头下半）
  box(head, 0.44, 0.36, 0.13, C.hair, 0, 0.21, -0.20, null, 0.62, 0.055);    // 后脑头发（一直收到颈后，免得脑后露出一圈头皮）
  box(head, 0.115, 0.028, 0.028, C.hairDeep, -0.105, 0.305, 0.203);        // 左眉
  box(head, 0.115, 0.028, 0.028, C.hairDeep, 0.105, 0.305, 0.203);         // 右眉
  // 眼睛是"深色眼球 + 一点高光"，不是"白眼白 + 黑瞳"：0.4 格见方的白色眼白
  // 在这个尺寸下只会连成一片，看着像戴了副墨镜。
  box(head, 0.095, 0.115, 0.05, C.eye, -0.105, 0.225, 0.198, null, 0.28, 0.022);
  box(head, 0.095, 0.115, 0.05, C.eye, 0.105, 0.225, 0.198, null, 0.28, 0.022);
  box(head, 0.034, 0.040, 0.02, C.shine, -0.085, 0.258, 0.226, null, 0.2);
  box(head, 0.034, 0.040, 0.02, C.shine, 0.125, 0.258, 0.226, null, 0.2);
  box(head, 0.068, 0.034, 0.02, C.blush, -0.163, 0.152, 0.196, "skin", 0.95);
  box(head, 0.068, 0.034, 0.02, C.blush, 0.163, 0.152, 0.196, "skin", 0.95);
  box(head, 0.085, 0.026, 0.022, C.lip, 0, 0.108, 0.203, null, 0.6, 0.011);  // 嘴

  const body = part("body", 0, 0.80, 0);
  box(body, 0.42, 0.56, 0.26, C.shirt, 0, 0.27, 0, "cloth", 0.8, 0.085);   // 躯干
  box(body, 0.30, 0.075, 0.29, C.collar, 0, 0.545, 0.005, null, 0.7, 0.03); // 领口（比肩窄，才读得出是领子不是垫肩）
  box(body, 0.055, 0.30, 0.02, C.shirtDeep, 0, 0.30, 0.132);               // 门襟
  box(body, 0.034, 0.034, 0.022, C.button, 0, 0.40, 0.14, null, 0.4);       // 上扣
  box(body, 0.034, 0.034, 0.022, C.button, 0, 0.26, 0.14, null, 0.4);       // 下扣
  box(body, 0.435, 0.075, 0.275, C.belt, 0, 0.045, 0, null, 0.66, 0.028);   // 腰带
  box(body, 0.075, 0.058, 0.03, C.buckle, 0, 0.045, 0.145, null, 0.32);     // 铜扣

  const rig = {};
  const arm = (name, side) => {
    const a = part(name, side * 0.235, 1.315, 0);                           // 原点在肩
    box(a, 0.145, 0.30, 0.155, C.shirt, 0, -0.15, 0, "cloth", 0.8, 0.05);   // 上臂（袖子）
    box(a, 0.15, 0.05, 0.16, C.shirtDeep, 0, -0.315, 0, null, 0.75, 0.02);  // 袖口
    const elbow = new THREE.Group(); elbow.position.set(0, -0.33, 0); a.add(elbow);
    // 小臂和手都刻意"方"一点（倒角只给到 0.03 上下）：半径一大，手就变成
    // 两颗球挂在腕上，看着像戴了拳击手套。
    box(elbow, 0.125, 0.20, 0.135, C.skin, 0, -0.10, 0, "skin", 0.74, 0.034); // 小臂
    box(elbow, 0.12, 0.15, 0.125, C.skin, 0, -0.285, 0, "skin", 0.74, 0.038); // 手
    rig[name === "armL" ? "elbowL" : "elbowR"] = elbow;
    return a;
  };
  const armL = arm("armL", -1), armR = arm("armR", 1);

  const leg = (name, side) => {
    const l = part(name, side * 0.108, 0.80, 0);                            // 原点在髋
    box(l, 0.175, 0.40, 0.19, C.pants, 0, -0.20, 0, "cloth", 0.82, 0.058);  // 大腿
    const knee = new THREE.Group(); knee.position.set(0, -0.40, 0); l.add(knee);
    // 小腿往上多长 0.03 盖住膝盖：两块圆角盒正好在关节处各退让一个半径，
    // 不重叠就会露出一圈"可动人偶"的接缝。
    box(knee, 0.165, 0.38, 0.18, C.pantsDeep, 0, -0.16, 0, "cloth", 0.82, 0.05); // 小腿
    box(knee, 0.185, 0.12, 0.30, C.shoe, 0, -0.33, 0.045, null, 0.6, 0.045);     // 鞋（往前伸，有鞋头）
    box(knee, 0.19, 0.04, 0.315, C.sole, 0, -0.375, 0.05, null, 0.85, 0.016);    // 鞋底
    rig[name === "legL" ? "kneeL" : "kneeR"] = knee;
    return l;
  };
  const legL = leg("legL", -1), legR = leg("legR", 1);

  // 静息时手臂略微外张：贴着躯干会交叉进盒子里，看着像没有胳膊
  armL.rotation.z = -0.05; armR.rotation.z = 0.05;
  g.userData.parts = { head, body, armL, armR, legL, legR };
  // 上半身起伏要整体动，所以记下这三块各自的基准高度
  g.userData.rig = Object.assign({ base: { head: 1.30, body: 0.80, armL: 1.315, armR: 1.315 } }, rig);
  return applyBody(g, bodyOf);
}
