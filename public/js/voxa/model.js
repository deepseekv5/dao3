// voxa/model.js — VOXA 模型文档：调色板 / 部件 / 骨骼 / 绑定 / 动画 / 物理盒 + 序列化。
// 口径来自官方文档 vendor/box3-product-document/voxa/：
//   部件=体素容器，骨骼=层级，绑定为刚体（多部件需先编组），动画固定 24 帧/秒，
//   物理盒 默认=初始模型最小包围盒 / 自定义=固定立方体，部件上限 128。
export const VOXA_VERSION = 1;
export const MAX_PARTS = 128;
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

export function newPaletteEntry(hex = "#c8a06c", emissive = 0) {
  return { i: nextId("c"), hex, emissive };
}
export function newPart(name = "Object", size = [8, 8, 8]) {
  return {
    id: nextId("p"), name, size: size.slice(), pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    visible: true, voxels: [], bone: null, group: null,
  };
}
export function newBone(name = "Bone", parent = null) {
  return { id: nextId("b"), name, parent, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}
export function newAnim(name = "idle") {
  return { id: nextId("a"), name, fps: ANIM_FPS, tracks: {} };
}

export function newDoc(name = "未命名模型") {
  const root = newBone("Root", null);
  root.id = "root";
  return {
    version: VOXA_VERSION, name,
    palette: [newPaletteEntry()],
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
  const e = newPaletteEntry(want, emissive);
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
// 体素级几何变换：mirror / flip / rotate 90°（axis: 0=X 1=Y 2=Z）
export function transformVoxels(part, kind, axis) {
  const [X, Y, Z] = part.size;
  const out = [];
  let nsize = [X, Y, Z];
  for (const v of part.voxels) {
    let { x, y, z } = v;
    if (kind === "mirror") {
      if (axis === 0) x = X - 1 - x; else if (axis === 1) y = Y - 1 - y; else z = Z - 1 - z;
    } else if (kind === "flip") {
      if (axis === 0) x = X - 1 - x; else if (axis === 1) y = Y - 1 - y; else z = Z - 1 - z;
    } else if (kind === "rot") {
      // 绕给定轴顺时针 90°，另外两轴互换并调整框尺寸
      if (axis === 1) { const nx = Z - 1 - z; out.push({ x: nx, y, z: x, c: v.c }); continue; }
      if (axis === 0) { const ny = Z - 1 - z; out.push({ x, y: ny, z: y, c: v.c }); continue; }
      const nx = Y - 1 - y; out.push({ x: nx, y: x, z, c: v.c }); continue;
    }
    out.push({ x, y, z, c: v.c });
  }
  if (kind === "rot") {
    if (axis === 1) nsize = [Z, Y, X];
    else if (axis === 0) nsize = [X, Z, Y];
    else nsize = [Y, X, Z];
  }
  part.voxels = out;
  part.size = nsize;
  invalidateIndex(part);
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
    palette: palette.map((c) => ({ i: c.i, hex: c.hex, emissive: c.emissive || 0 })),
    parts: parts.map((p) => ({
      id: p.id, name: p.name, size: p.size, pos: p.pos, rot: p.rot, scale: p.scale,
      visible: p.visible !== false, bone: p.bone || null, group: p.group || null,
      voxels: p.voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, c: v.c })),
    })),
    bones: bones.map((b) => ({ id: b.id, name: b.name, parent: b.parent, position: b.position, rotation: b.rotation, scale: b.scale })),
    groups: (groups || []).map((g) => ({ id: g.id, name: g.name, partIds: g.partIds })),
    anims: anims.map((a) => ({ id: a.id, name: a.name, fps: a.fps, tracks: a.tracks })),
    curAnim: doc.curAnim || 0,
    physics,
  };
}
export function deserialize(raw) {
  const doc = newDoc(raw.name || "未命名模型");
  doc.palette = (raw.palette && raw.palette.length) ? raw.palette : doc.palette;
  doc.parts = (raw.parts || []).map((p) => Object.assign({ visible: true, voxels: [] }, p));
  doc.parts.forEach((p) => bindDoc(p, doc));
  doc.bones = (raw.bones && raw.bones.length) ? raw.bones : doc.bones;
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
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder("latin1");
  const out = [];
  let o = 0;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  while (o + 12 <= buf.length) {
    const id = dec.decode(buf.subarray(o, o + 4)); o += 4;
    const clen = u32(), nlen = u32();
    const end = Math.min(buf.length, o + clen + nlen);
    if (id === "RGBA") {
      o += 4;
      for (let i = 0; i < 256 && o + 4 <= end; i++) { out.push([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]); o += 4; }
    }
    o = end;
  }
  return out.length ? out : [[200, 160, 108, 255]];
}

/* ------------------------------ glTF 导出 ------------------------------ */
// 官方导出格式为 glTF（editor/universal.md:13）；这里生成 .glb 二进制容器。
export function toGLB(doc) {
  const pos = [], nrm = [], col = [];
  const FACES = [
    { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
    { n: [0, -1, 0], c: [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]] },
    { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];
  for (const p of doc.parts) {
    if (p.visible === false) continue;
    for (const v of p.voxels) {
      const c = colorOf(doc, v.c) || { hex: "#ffffff" };
      const [r, g, b] = hexToRgb(c.hex);
      for (const f of FACES) {
        const base = pos.length / 3;
        for (const corner of f.c) {
          pos.push(p.pos[0] + v.x + corner[0], p.pos[1] + v.y + corner[1], p.pos[2] + v.z + corner[2]);
          nrm.push(...f.n);
          col.push(r, g, b);
        }
      }
      // 每个面两个三角形：0-1-2, 0-2-3
    }
  }
  const idx = [];
  const quads = pos.length / 12;
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const pack = (arr, Ctor) => { const a = new Ctor(arr.length); arr.forEach((v, i) => { a[i] = v; }); return a; };
  const posA = pack(pos, Float32Array), nrmA = pack(nrm, Float32Array), colA = pack(col, Float32Array), idxA = pack(idx, Uint32Array);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posA.length; i += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], posA[i + a]); max[a] = Math.max(max[a], posA[i + a]);
  }
  const views = [];
  const bufs = [posA, nrmA, colA, idxA];
  let binLen = 0;
  const bufferViews = bufs.map((a, i) => {
    const byteOffset = binLen;
    binLen += a.byteLength;
    views.push(a);
    return { buffer: 0, byteOffset, byteLength: a.byteLength, target: i === 3 ? 34963 : 34962 };
  });
  const bin = new Uint8Array(binLen);
  let off = 0;
  for (const v of views) { bin.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), off); off += v.byteLength; }
  const json = {
    asset: { version: "2.0", generator: "VOXA clone" },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: doc.name }],
    meshes: [{
      name: doc.name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: posA.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: nrmA.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: colA.length / 3, type: "VEC3" },
      { bufferView: 3, componentType: 5125, count: idxA.length, type: "SCALAR" },
    ],
    bufferViews,
    buffers: [{ byteLength: binLen }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonLen = jsonBytes.length + jsonPad, binLen2 = bin.length + binPad;
  const total = 12 + 8 + jsonLen + 8 + binLen2;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true);
  new Uint8Array(out, 20).set(jsonBytes);
  const bo = 20 + jsonLen;
  dv.setUint32(bo, binLen2, true); dv.setUint32(bo + 4, 0x004E4942, true);
  new Uint8Array(out, bo + 8).set(bin);
  return new Blob([out], { type: "model/gltf-binary" });
}
