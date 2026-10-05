// voxa/model.js — VOXA 模型文档：调色板 / 部件 / 骨骼 / 绑定 / 动画 / 物理盒 + 序列化。
// 口径来自官方文档 vendor/box3-product-document/voxa/：
//   部件=体素容器，骨骼=层级，绑定为刚体（多部件需先编组），动画固定 24 帧/秒，
//   物理盒 默认=初始模型最小包围盒 / 自定义=固定立方体，部件上限 128。
import { readVox } from "../world.js";

export const VOXA_VERSION = 1;
export const MAX_PARTS = 128;
// 单个部件框的边长上限。镜像增补与自动扩框都要撞这条线，写在一处才不会再各 clamp 各的。
export const MAX_BOX = 128;
export const ANIM_FPS = 24; // editor/animation/animationPanel.md：默认速率 24 帧/秒（不可更改）
export const EASINGS = ["normal", "step", "in", "out", "inout"]; // 正常/打断/缓入/缓出/缓入缓出
// 换肤模板的 18 个可绑定骨骼节点（editor/skinningMode.md）
export const SKIN_BONES = [
  "hips", "torso", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
];

let uid = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(r, g, b) {
  const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function newPaletteEntry(hex = "#c8a06c", emissive = 0, group = "Group") {
  // g 是色组名。官方色板是"多个命名色组 × 每组若干色块"（截图里 Group / Color /
  // Group-1 并存），我们原先是一条平铺的列表，等于把这块做成了占位。
  return { i: nextId("c"), hex, emissive, g: group || "Group" };
}
export function newPart(name = "Object", size = [8, 8, 8]) {
  return {
    id: nextId("p"), name, size: size.slice(), pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    // 官方 parts/propertiesPanel.md：属性面板除位置/方向外"同时也可设置透明"
    visible: true, opacity: 1, voxels: [], bone: null, group: null,
  };
}
export function newBone(name = "Bone", parent = null) {
  // op 是"不透明度"这条动画通道的落点（官方 animation/propertiesPanel.md：
  // 用不透明度做模型显示/隐藏动画），所以它是数据字段而不是 _ 开头的运行时缓存
  return { id: nextId("b"), name, parent, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], op: 1 };
}
export function newAnim(name = "idle") {
  return { id: nextId("a"), name, fps: ANIM_FPS, tracks: {} };
}

export function newDoc(name = "未命名模型", type = "free") {
  const root = newBone("Root", null);
  root.id = "root";
  return {
    version: VOXA_VERSION, name,
    // 官方口径：作品类型（自由 / 换肤）在创建时刻即决定，且不支持之后修改
    type: type === "skin" ? "skin" : "free",
    palette: [newPaletteEntry()],
    // palCur：新加的颜色落进哪个色组（官方"增加颜色组"之后加色就进那一组）
    palCur: "Group",
    parts: [], bones: [root],
    anims: [newAnim("idle")], curAnim: 0,
    physics: { mode: "default", center: [0, 0, 0], size: [1, 1, 1] },
  };
}

/* ------------------------------ 体素存取 ------------------------------ */
export const vkey = (x, y, z) => `${x},${y},${z}`;

export function partIndex(part) {
  if (!part._idx) {
    part._idx = new Map();
    for (let k = 0; k < part.voxels.length; k++) {
      const v = part.voxels[k];
      part._idx.set(vkey(v.x, v.y, v.z), k);
    }
  }
  return part._idx;
}
export function invalidateIndex(part) { part._idx = null; }

export function getVoxel(part, x, y, z) {
  const k = partIndex(part).get(vkey(x, y, z));
  return k === undefined ? null : part.voxels[k];
}
export function setVoxel(doc, part, x, y, z, colorHex, emissive = 0) {
  if (x < 0 || y < 0 || z < 0 || x >= part.size[0] || y >= part.size[1] || z >= part.size[2]) return false;
  const idx = partIndex(part);
  const key = vkey(x, y, z);
  const c = ensureColor(doc, colorHex, emissive);
  const at = idx.get(key);
  if (at === undefined) {
    idx.set(key, part.voxels.length);
    part.voxels.push({ x, y, z, c });
  } else part.voxels[at].c = c;
  return true;
}
export function eraseVoxel(part, x, y, z) {
  const idx = partIndex(part);
  const key = vkey(x, y, z);
  const at = idx.get(key);
  if (at === undefined) return false;
  part.voxels.splice(at, 1);
  invalidateIndex(part);
  return true;
}
export function recolorVoxel(part, x, y, z, colorHex, emissive = 0) {
  const v = getVoxel(part, x, y, z);
  if (!v) return false;
  v.c = ensureColor(globalDocOf(part) || {}, colorHex, emissive);
  return true;
}
// 体素记录挂在 part 上，改色需要能拿到 doc；用弱映射避免序列化时带上
const DOC_OF = new WeakMap();
export function bindDoc(part, doc) { DOC_OF.set(part, doc); return doc; }
function globalDocOf(part) { return DOC_OF.get(part); }

export function ensureColor(doc, hex, emissive = 0) {
  const want = String(hex || "#ffffff").toLowerCase();
  const found = doc.palette.find((p) => p.hex.toLowerCase() === want && Math.abs((p.emissive || 0) - emissive) < 0.01);
  if (found) return found.i;
  const e = newPaletteEntry(want, emissive, doc.palCur || "Group");
  doc.palette.push(e);
  return e.i;
}
export function colorOf(doc, id) { return doc.palette.find((p) => p.i === id) || doc.palette[0]; }
export function removeUnusedColors(doc) {
  const used = new Set();
  for (const p of doc.parts) for (const v of p.voxels) used.add(v.c);
  doc.palette = doc.palette.filter((c, i) => used.has(c.i) || i === 0);
}

/* ------------------------------ 部件操作 ------------------------------ */
export function addPart(doc, part) {
  if (doc.parts.length >= MAX_PARTS) return null;
  doc.parts.push(part);
  bindDoc(part, doc);
  return part;
}
export function clonePart(doc, part, nameSuffix = " copy") {
  const p = newPart(part.name + nameSuffix, part.size.slice());
  p.pos = part.pos.slice(); p.rot = part.rot.slice(); p.scale = part.scale.slice();
  p.voxels = part.voxels.map((v) => ({ ...v }));
  return addPart(doc, p);
}
// 自动裁剪：把部件框收缩到刚好包住所有体素
export function autoCrop(part) {
  if (!part.voxels.length) return;
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const v of part.voxels) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], v["xyz"[a]]);
    hi[a] = Math.max(hi[a], v["xyz"[a]]);
  }
  const off = [lo[0], lo[1], lo[2]];
  part.voxels.forEach((v) => { v.x -= off[0]; v.y -= off[1]; v.z -= off[2]; });
  part.size = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  part.pos = [part.pos[0] + off[0], part.pos[1] + off[1], part.pos[2] + off[2]];
  invalidateIndex(part);
}
// 体素级几何变换：mirror（镜像增补）/ flip（原地翻面）/ rotate 90°（axis: 0=X 1=Y 2=Z）
// 官方顶栏那三颗按钮里，"镜像"是**镜像增加体素**（editor/voxels/globalToolbar.md:7）：
// 保留原样，在轴的另一侧再补一份对称的，框随之长大——这才是做对称角色要的东西。
// 以前 mirror 与 flip 的函数体逐字相同，于是顶栏给了用户两个一样的按钮，
// 而且"镜像"会把原件删掉，做一半的角色一按就没了。
export function transformVoxels(part, kind, axis) {
  const [X, Y, Z] = part.size;
  const a = "xyz"[axis];
  const flipOne = (v) => {
    const o = { ...v };
    if (axis === 0) o.x = X - 1 - v.x; else if (axis === 1) o.y = Y - 1 - v.y; else o.z = Z - 1 - v.z;
    return o;
  };
  if (kind === "mirror") {
    const grown = [X, Y, Z];
    if (grown[axis] * 2 > MAX_BOX) return false;
    grown[axis] *= 2;
    const moved = part.voxels.map((v) => ({ ...v }));
    const mirrored = part.voxels.map((v) => { const o = flipOne(v); o[a] += grown[axis] / 2; return o; });
    part.voxels = moved.concat(mirrored);
    part.size = grown;
    invalidateIndex(part);
    return true;
  }
  const out = [];
  let nsize = [X, Y, Z];
  for (const v of part.voxels) {
    if (kind === "flip") { out.push(flipOne(v)); continue; }
    let { x, y, z } = v;
    // 绕给定轴顺时针 90°，另外两轴互换并调整框尺寸
    if (axis === 1) { out.push({ x: Z - 1 - z, y, z: x, c: v.c }); continue; }
    if (axis === 0) { out.push({ x, y: Z - 1 - z, z: y, c: v.c }); continue; }
    out.push({ x: Y - 1 - y, y: x, z, c: v.c });
  }
  if (kind === "rot") {
    if (axis === 1) nsize = [Z, Y, X];
    else if (axis === 0) nsize = [X, Z, Y];
    else nsize = [Y, X, Z];
  }
  part.voxels = out;
  part.size = nsize;
  invalidateIndex(part);
  return true;
}
/** 把部件框扩到能装下这个格子：只在正方向长，负方向整体平移并补偿 pos。
    以前越界就 setVoxel 静默 return false，玩家只知道"点了没反应"，
    还得自己猜该把 boxX/boxY/boxZ 里哪一个调大。 */
export function ensureRoom(part, x, y, z, max = MAX_BOX) {
  const size = part.size.slice();
  let shift = [0, 0, 0], grew = false;
  for (let a = 0; a < 3; a++) {
    const v = [x, y, z][a];
    if (v < 0) { shift[a] = -v; grew = true; }
    if (v >= size[a]) {
      const want = v + 1;
      if (want > max) return false;
      size[a] = want; grew = true;
    }
  }
  if (shift.some((s) => s > 0)) {
    for (const v of part.voxels) { v.x += shift[0]; v.y += shift[1]; v.z += shift[2]; }
    part.pos = [part.pos[0] - shift[0], part.pos[1] - shift[1], part.pos[2] - shift[2]];
    size[0] += shift[0]; size[1] += shift[1]; size[2] += shift[2];
  }
  if (!grew) return false;
  part.size = size.map((n) => Math.min(max, n));
  invalidateIndex(part);
  return true;
}
/** 拖拽两点确定的"面"：只在与拖动方向垂直的那根轴上留一层，不是实心盒子。
    rangeCells 给的是整个 AABB，用它当"面建造"会拿 20 倍体素才能砌出一堵墙。 */
export function faceCells(from, to) {
  const lo = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
  const hi = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];
  const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const flat = span.indexOf(Math.min(...span));
  const out = [];
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    if (flat === 0 && x !== lo[0]) continue;
    if (flat === 1 && y !== lo[1]) continue;
    if (flat === 2 && z !== lo[2]) continue;
    out.push([x, y, z]);
  }
  return out;
}
// 洪泛填充（油漆桶）/ 魔棒：在同色相邻连通块上工作
export function floodSelect(part, start, sameColor = true) {
  const seen = new Set();
  const out = [];
  const stack = [start];
  const base = getVoxel(part, start[0], start[1], start[2]);
  if (!base) return out;
  while (stack.length) {
    const [x, y, z] = stack.pop();
    const k = vkey(x, y, z);
    if (seen.has(k)) continue;
    const v = getVoxel(part, x, y, z);
    if (!v) continue;
    if (sameColor && v.c !== base.c) continue;
    seen.add(k);
    out.push([x, y, z]);
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      if (nx >= 0 && ny >= 0 && nz >= 0 && nx < part.size[0] && ny < part.size[1] && nz < part.size[2]) stack.push([nx, ny, nz]);
    }
  }
  return out;
}
export function fillRange(part, from, to, colorId) {
  const lo = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
  const hi = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];
  let n = 0;
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    if (x < 0 || y < 0 || z < 0 || x >= part.size[0] || y >= part.size[1] || z >= part.size[2]) continue;
    const idx = partIndex(part);
    const key = vkey(x, y, z);
    if (idx.has(key)) continue;
    idx.set(key, part.voxels.length);
    part.voxels.push({ x, y, z, c: colorId });
    n++;
  }
  return n;
}
export function eraseRange(part, from, to) {
  const lo = [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])];
  const hi = [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])];
  let n = 0;
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) if (eraseVoxel(part, x, y, z)) n++;
  return n;
}
export function linePoints(a, b) {
  const [x0, y0, z0] = a, [x1, y1, z1] = b;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), dz = Math.abs(z1 - z0);
  const steps = Math.max(dx, dy, dz, 1);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), Math.round(z0 + (z1 - z0) * t)]);
  }
  return out;
}
// 面拉伸：把选中的单层面沿法轴挤出 height 格（负值即反向）
export function extrude(doc, part, sel, axis, height) {
  if (!sel.length) return 0;
  let n = 0;
  const src = sel.map(([x, y, z]) => getVoxel(part, x, y, z)).filter(Boolean);
  for (let h = 1; h <= Math.abs(height); h++) {
    const dir = Math.sign(height) * h;
    for (const v of src) {
      const x = v.x + (axis === 0 ? dir : 0), y = v.y + (axis === 1 ? dir : 0), z = v.z + (axis === 2 ? dir : 0);
      const col = colorOf(doc, v.c) || { hex: "#ffffff", emissive: 0 };
      if (setVoxel(doc, part, x, y, z, col.hex, col.emissive || 0)) n++;
    }
  }
  return n;
}

/* ------------------------------ 骨骼 ------------------------------ */
export function addBone(doc, name, parent) {
  const b = newBone(name || uniqueBoneName(doc, "Bone"), parent ? parent.id : "root");
  doc.bones.push(b);
  return b;
}
export function uniqueBoneName(doc, base) {
  const names = new Set(doc.bones.map((b) => b.name));
  if (!names.has(base)) return base;
  let i = 1;
  while (names.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
export function childBones(doc, boneId) { return doc.bones.filter((b) => b.parent === boneId); }
export function bonePath(doc, boneId) {
  const out = [];
  let cur = doc.bones.find((b) => b.id === boneId);
  while (cur) { out.unshift(cur.name); cur = doc.bones.find((b) => b.id === cur.parent); }
  return out.join("/");
}
export function removeBone(doc, boneId) {
  if (boneId === "root") return;
  const kill = new Set([boneId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of doc.bones) if (!kill.has(b.id) && kill.has(b.parent)) { kill.add(b.id); grew = true; }
  }
  doc.bones = doc.bones.filter((b) => !kill.has(b.id));
  for (const p of doc.parts) if (kill.has(p.bone)) p.bone = null;
  for (const a of doc.anims) for (const id of [...Object.keys(a.tracks)]) if (kill.has(id)) delete a.tracks[id];
}
// 刚体绑定：部件挂到骨骼节点上（多部件需先编组，见 skiningMode.md:21）
export function bindPart(doc, part, boneId) { part.bone = boneId || null; }
export function groupParts(doc, parts, name) {
  const g = { id: nextId("g"), name: name || "Group", partIds: parts.map((p) => p.id) };
  doc.groups = doc.groups || [];
  doc.groups.push(g);
  parts.forEach((p) => { p.group = g.id; });
  return g;
}

/* ------------------------------ 动画 ------------------------------ */
export function curAnim(doc) { return doc.anims[doc.curAnim] || doc.anims[0]; }
export function ensureTrack(doc, boneId) {
  const a = curAnim(doc);
  if (!a.tracks[boneId]) a.tracks[boneId] = [];
  return a.tracks[boneId];
}
const easeFn = {
  normal: (t) => t, in: (t) => t * t, out: (t) => 1 - (1 - t) * (1 - t),
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2), step: (t) => (t >= 1 ? 1 : 0),
};
export function sampleTrack(keys, frame) {
  if (!keys || !keys.length) return null;
  if (frame <= keys[0].f) return keys[0];
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].f < frame) i++;
  const a = keys[i], b = keys[i + 1];
  const span = Math.max(1, b.f - a.f);
  const t = easeFn[b.ease || "normal"]((frame - a.f) / span);
  const mix = (k) => [0, 1, 2].map((j) => a[k][j] + (b[k][j] - a[k][j]) * t);
  return {
    f: frame, pos: mix("pos"), rot: mix("rot"), scale: mix("scale"),
    op: (a.op ?? 1) + ((b.op ?? 1) - (a.op ?? 1)) * t,
  };
}
export function createFrame(doc, bone, transform, frame) {
  const tr = ensureTrack(doc, bone.id);
  const key = {
    f: frame, pos: transform.position.slice(), rot: transform.rotation.slice(),
    scale: transform.scale.slice(), op: transform.op ?? 1, ease: "normal",
  };
  const at = tr.findIndex((k) => k.f === frame);
  if (at >= 0) tr[at] = key; else tr.push(key);
  tr.sort((a, b) => a.f - b.f);
  return key;
}
export function animDuration(doc) {
  let max = 0;
  for (const a of doc.anims) for (const keys of Object.values(a.tracks)) for (const k of keys) max = Math.max(max, k.f);
  return max;
}

/* ------------------------------ 物理盒 ------------------------------ */
export function modelBounds(doc) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], any = false;
  for (const p of doc.parts) {
    if (!p.voxels.length) continue;
    any = true;
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p.pos[a]);
      hi[a] = Math.max(hi[a], p.pos[a] + p.size[a] * p.scale[a]);
    }
  }
  if (!any) return { center: [0, 0, 0], size: [1, 1, 1] };
  return { center: lo.map((v, i) => (v + hi[i]) / 2), size: hi.map((v, i) => Math.max(1, v - lo[i])) };
}
export function refreshPhysics(doc) {
  if (doc.physics.mode === "default") {
    const b = modelBounds(doc);
    doc.physics.center = b.center;
    doc.physics.size = b.size;
  }
  return doc.physics;
}

/* ------------------------------ 统计 / 序列化 ------------------------------ */
export function stats(doc) {
  let voxels = 0, faces = 0;
  const colors = new Set();
  for (const p of doc.parts) {
    voxels += p.voxels.length;
    for (const v of p.voxels) colors.add(v.c);
    faces += p.voxels.length * 6;
  }
  return { parts: doc.parts.length, bones: doc.bones.length, voxels, faces, colors: colors.size, anims: doc.anims.length };
}
export function serialize(doc) {
  const { parts, bones, anims, palette, physics, name, version, groups } = doc;
  return {
    version: version || VOXA_VERSION, name,
    // type（换肤 / 自由）在新建时就定死、之后不可改，所以必须跟着序列化走。
    // 以前它不在这里，于是 deserialize 落到 newDoc 的默认值 "free"：
    // 换肤作品存一次盘、撤销一次、或走一次 V 口令，就悄悄变成自由模式。
    type: doc.type || "free",
    palette: palette.map((c) => ({ i: c.i, hex: c.hex, emissive: c.emissive || 0, g: c.g || "Group" })),
    palCur: doc.palCur || "Group",
    parts: parts.map((p) => ({
      id: p.id, name: p.name, size: p.size, pos: p.pos, rot: p.rot, scale: p.scale,
      visible: p.visible !== false, opacity: p.opacity ?? 1, bone: p.bone || null, group: p.group || null,
      voxels: p.voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, c: v.c })),
    })),
    bones: bones.map((b) => ({ id: b.id, name: b.name, parent: b.parent, position: b.position, rotation: b.rotation, scale: b.scale, op: b.op ?? 1 })),
    groups: (groups || []).map((g) => ({ id: g.id, name: g.name, partIds: g.partIds })),
    anims: anims.map((a) => ({ id: a.id, name: a.name, fps: a.fps, tracks: a.tracks })),
    curAnim: doc.curAnim || 0,
    physics,
  };
}
export function deserialize(raw) {
  const doc = newDoc(raw.name || "未命名模型");
  if (raw.type) doc.type = raw.type;
  doc.palette = (raw.palette && raw.palette.length) ? raw.palette.map((c) => Object.assign({ g: "Group" }, c)) : doc.palette;
  doc.palCur = raw.palCur || "Group";
  doc.parts = (raw.parts || []).map((p) => Object.assign({ visible: true, opacity: 1, voxels: [] }, p));
  doc.parts.forEach((p) => bindDoc(p, doc));
  // 老文件里没有 op：给回 1，而不是留 undefined 让渲染层每次都要 ?? 
  doc.bones = (raw.bones && raw.bones.length) ? raw.bones.map((b) => Object.assign({ op: 1 }, b)) : doc.bones;
  doc.groups = raw.groups || [];
  doc.anims = (raw.anims && raw.anims.length) ? raw.anims : doc.anims;
  doc.curAnim = raw.curAnim || 0;
  doc.physics = raw.physics || doc.physics;
  doc.parts.forEach((p) => invalidateIndex(p));
  return doc;
}

/* ------------------------------ .vox 导入 ------------------------------ */
// MagicaVoxel XYZI：[x, z, y(down), paletteIndex]
export function importVox(voxels, palette, doc, partName = "导入部件") {
  if (!voxels.length) return null;
  let maxY = 0, maxX = 0, maxZ = 0;
  for (const v of voxels) { maxX = Math.max(maxX, v[0]); maxZ = Math.max(maxZ, v[1]); maxY = Math.max(maxY, v[2]); }
  const part = newPart(partName, [maxX + 1, maxY + 1, maxZ + 1]);
  for (const [x, z, yd, pal] of voxels) {
    const y = maxY - yd;
    const c = palette[Math.max(0, (pal | 0) - 1)] || [200, 160, 108, 255];
    setVoxel(doc, part, x, y, z, rgbToHex(c[0] / 255, c[1] / 255, c[2] / 255));
  }
  return addPart(doc, part);
}
export function parseVoxPalette(bytes) {
  // 旧实现只在**顶层**找 RGBA，而规范文件的 RGBA 是套在 MAIN 里面的：
  // 于是所有 .vox 导入进来都只剩一个兜底色（"导入的模型颜色全没了"的来历）。
  try { return readVox(bytes).palette; } catch { return []; }
}

/* ------------------------------ glTF 导出 ------------------------------ */
// 官方导出格式为 glTF（editor/universal.md:13）；这里生成 .glb 二进制容器。
//
// 结构：一个根节点 + 每根骨骼一个节点（父子关系照 doc.bones）+ 每个部件一个节点，
// 部件节点挂在它绑定的骨骼节点下面。官方 VOXA 是**刚体绑骨**（一个部件整块跟着一根骨骼走，
// 没有顶点权重），所以这里不需要 skins/animations 之外的蒙皮数据：
// 骨骼动 → 子节点跟着动，这正是刚体绑骨的定义。
//
// 动画：每条 doc.anims 一个 glTF animation，通道是骨骼节点的 translation/rotation/scale。
// 五档缓动里 step 与三条平滑档，glTF 的 sampler 只能整条通道一种插值，
// 所以平滑档按 1/4 帧重采样成 LINEAR（形状保真），step 用"同一时刻补一帧旧值"的
// 标准做法跳变。不透明度没有对应的 glTF 通道（要 KHR_materials_* 才勉强），
// 因此不进导出——编辑器里仍然有效，这点在提示语里写明。
const GLB_FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
/** three.js 的 Euler(x,y,z,'XYZ') → 四元数，glTF 要 [x,y,z,w]。
 *  两边必须同一套公式，否则编辑器里看着正对的部件导出去就歪了。 */
export function eulerToQuatXYZ(rx, ry, rz) {
  const d = Math.PI / 180 / 2, c1 = Math.cos(rx * d), s1 = Math.sin(rx * d);
  const c2 = Math.cos(ry * d), s2 = Math.sin(ry * d), c3 = Math.cos(rz * d), s3 = Math.sin(rz * d);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
const compOf = (a) => (a instanceof Uint32Array ? 5125 : a instanceof Uint16Array ? 5123 : 5126);

export function toGLB(doc) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [], accessors = [], materials = [], meshes = [], nodes = [];
  const addView = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
    return bufferViews.length - 1;
  };
  const addAcc = (typed, type, target, min, max) => {
    const n = type === "VEC4" ? 4 : type === "VEC3" ? 3 : 1;
    const a = { bufferView: addView(typed, target), componentType: compOf(typed), count: typed.length / n, type };
    if (min) { a.min = min; a.max = max; }
    accessors.push(a);
    return accessors.length - 1;
  };
  const SOLID_MAT = addMaterial({ base: null });
  function addMaterial({ base, emissive }) {
    const pbr = { metallicFactor: 0, roughnessFactor: 0.85 };
    const m = { pbrMetallicRoughness: pbr };
    if (base) {
      pbr.baseColorFactor = base;
      if (emissive) {
        m.emissiveFactor = [Math.min(1, emissive[0]), Math.min(1, emissive[1]), Math.min(1, emissive[2])];
        // 发光强度超过 1 的部分只能靠扩展表达（emissiveFactor 各分量按规范必须 ≤ 1）
        const strength = 1 + (emissive[3] || 0) * 1.5;
        if (strength > 1.001) { m.extensions = { KHR_materials_emissive_strength: { emissiveStrength: +strength.toFixed(3) } }; m.__emissiveExt = true; }
      }
    }
    materials.push(m);
    return materials.length - 1;
  }

  // ---- 节点：根 → 骨骼树 → 部件 ----
  nodes.push({ name: doc.name || "voxa", children: [] });
  const boneNode = new Map();
  for (const b of doc.bones) {
    boneNode.set(b.id, nodes.length);
    nodes.push({ name: b.name, translation: b.position.slice(), rotation: eulerToQuatXYZ(...b.rotation), scale: b.scale.slice(), children: [] });
  }
  for (const b of doc.bones) {
    const parent = b.parent != null && boneNode.has(b.parent) ? nodes[boneNode.get(b.parent)] : nodes[0];
    (parent.children || (parent.children = [])).push(boneNode.get(b.id));
  }
  let usedEmissiveExt = false;
  for (const p of doc.parts) {
    if (p.visible === false) continue;
    const prims = [];
    const solid = { pos: [], nrm: [], col: [], idx: [] };
    const glows = new Map();   // 颜色 id → 一套顶点（每种发光色一个 primitive，发光才不会被平均掉）
    const quad = (rec, v, rgb, bright) => {
      for (const f of GLB_FACES) {
        const base = rec.pos.length / 3;
        for (const corner of f.c) {
          rec.pos.push(v.x + corner[0], v.y + corner[1], v.z + corner[2]);
          rec.nrm.push(...f.n);
          rec.col.push(Math.min(1, rgb[0] * bright), Math.min(1, rgb[1] * bright), Math.min(1, rgb[2] * bright));
        }
        rec.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    for (const v of p.voxels) {
      const c = colorOf(doc, v.c) || { hex: "#ffffff", emissive: 0 };
      const [r, g, b] = hexToRgb(c.hex);
      const em = c.emissive || 0;
      if (em > 0.02) {
        const key = c.i;
        const rec = glows.get(key) || { pos: [], nrm: [], col: [], idx: [], rgb: [r, g, b], em };
        quad(rec, v, [r, g, b], 1);
        glows.set(key, rec);
      } else quad(solid, v, [r, g, b], 1);
    }
    const pushPrim = (rec, material) => {
      if (!rec.pos.length) return;
      const f32 = (a) => { const t = new Float32Array(a.length); a.forEach((x, i) => { t[i] = x; }); return t; };
      const posA = f32(rec.pos);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < posA.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], posA[i + a]); max[a] = Math.max(max[a], posA[i + a]); }
      const idxA = new Uint32Array(rec.idx);
      const attrs = { POSITION: addAcc(posA, "VEC3", 34962, min, max), NORMAL: addAcc(f32(rec.nrm), "VEC3", 34962) };
      if (material === SOLID_MAT) attrs.COLOR_0 = addAcc(f32(rec.col), "VEC3", 34962);
      prims.push({ attributes: attrs, indices: addAcc(idxA, "SCALAR", 34963), material, mode: 4 });
    };
    pushPrim(solid, SOLID_MAT);
    for (const rec of glows.values()) {
      const mi = addMaterial({ base: [rec.rgb[0], rec.rgb[1], rec.rgb[2], 1], emissive: [rec.rgb[0], rec.rgb[1], rec.rgb[2], rec.em] });
      if (materials[mi].extensions) usedEmissiveExt = true;
      pushPrim(rec, mi);
    }
    if (!prims.length) continue;
    meshes.push({ name: p.name, primitives: prims });
    const parent = p.bone && boneNode.has(p.bone) ? nodes[boneNode.get(p.bone)] : nodes[0];
    (parent.children || (parent.children = [])).push(nodes.length);
    nodes.push({ name: p.name, mesh: meshes.length - 1, translation: p.pos.slice(), rotation: eulerToQuatXYZ(...p.rot), scale: p.scale.slice() });
  }

  // ---- 动画 ----
  const animations = [];
  const fps = ANIM_FPS;
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (const an of doc.anims) {
    const channels = [], samplers = [];
    for (const [boneId, keysRaw] of Object.entries(an.tracks || {})) {
      const node = boneNode.get(boneId);
      const keys = (keysRaw || []).slice().sort((a, b) => a.f - b.f);
      if (node == null || keys.length < 2) continue;
      const times = [], T = [], R = [], S = [];
      const put = (f, pos, rot, sc) => { times.push(f / fps); T.push(...pos); R.push(...eulerToQuatXYZ(...rot)); S.push(...sc); };
      for (let i = 0; i + 1 < keys.length; i++) {
        const a = keys[i], b = keys[i + 1], ease = b.ease || "normal";
        put(a.f, a.pos, a.rot, a.scale);
        const span = b.f - a.f;
        if (ease === "step") {
          // glTF 一条 sampler 只能一种插值，所以"跳变"用同一时刻补一帧旧值再给新值实现
          put(a.f + 0.01, a.pos, a.rot, a.scale);
          put(b.f, b.pos, b.rot, b.scale);
          continue;
        }
        if (ease === "normal") continue;                 // 两端点已经进了 times，线性即可
        for (let j = 1; j <= 3; j++) {                   // 平滑档：按 1/4 帧重采样成折线
          const u = j / 4, e = easeFn[ease](u), f = a.f + span * u;
          put(f, lerp3(a.pos, b.pos, e), lerp3(a.rot, b.rot, e), lerp3(a.scale, b.scale, e));
        }
      }
      const last = keys[keys.length - 1];
      put(last.f, last.pos, last.rot, last.scale);
      if (times.length < 2) continue;
      const tA = new Float32Array(times);
      // 时间轴只建一份访问器，三条通道共用：每条通道各存一遍同一个 times 数组，
      // 等于把导出文件白涨三成，而且没有哪个 glTF 工具会这么做。
      const inAcc = addAcc(tA, "SCALAR");
      const ch = (path, vals) => {
        samplers.push({ input: inAcc, output: addAcc(new Float32Array(vals), "VEC" + (path === "rotation" ? "4" : "3")), interpolation: "LINEAR" });
        channels.push({ sampler: samplers.length - 1, target: { node, path } });
      };
      ch("translation", T); ch("rotation", R); ch("scale", S);
    }
    if (channels.length) animations.push({ name: an.name, channels, samplers });
  }

  const json = {
    asset: { version: "2.0", generator: "VOXA clone" },
    ...(usedEmissiveExt ? { extensionsUsed: ["KHR_materials_emissive_strength"] } : {}),
    scene: 0, scenes: [{ nodes: [0] }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
    ...(animations.length ? { animations } : {}),
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const padBytes = new Uint8Array(jsonPad);
  const binLen = offset;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLen;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true); dv.setUint32(16, 0x4E4F534A, true);
  let at = 20;
  new Uint8Array(out, at).set(jsonBytes); at += jsonBytes.length + jsonPad;
  dv.setUint32(at, binLen, true); dv.setUint32(at + 4, 0x004E4942, true); at += 8;
  for (const c of chunks) { new Uint8Array(out, at).set(c); at += c.byteLength; }
  return new Blob([out], { type: "model/gltf-binary" });
}
