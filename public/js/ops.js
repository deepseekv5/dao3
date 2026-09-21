// ops.js — 全局/选区 镜像、旋转、翻转。返回体素变更 diff，交由 History 提交。
import { readSelection } from "./tools.js";

function boundsOf(world, sel) {
  if (sel) return { min: { ...sel.min }, max: { ...sel.max } };
  const b = world.bounds(); if (!b) return null;
  return { min: { x: b.min[0], y: b.min[1], z: b.min[2] }, max: { x: b.max[0], y: b.max[1], z: b.max[2] } };
}

// 镜像轴 axis: 'x'|'y'|'z'；对选区/整体关于其中心平面翻转
export function mirror(world, axis, sel) {
  const bb = boundsOf(world, sel); if (!bb) return [];
  const vox = sel ? readSelection(world, sel) : allVoxels(world, bb);
  const cs = [];
  const seen = new Map();
  for (const v of vox) seen.set(v.x + "," + v.y + "," + v.z, v);
  const span = bb.max[axis] - bb.min[axis];
  for (const v of vox) {
    const t = v[axis] - bb.min[axis];
    const mirrored = { ...v }; mirrored[axis] = bb.min[axis] + (span - t);
    const src = v[axis] + "," + v.y + "," + v.z;
    const dst = mirrored.x + "," + mirrored.y + "," + mirrored.z;
    if (src === dst) continue;
    const existing = seen.get(dst);
    if (!existing || (v[axis] < mirrored[axis])) {
      cs.push({ x: mirrored.x, y: mirrored.y, z: mirrored.z, oldId: world.get(mirrored.x, mirrored.y, mirrored.z), oldRot: world.getRot(mirrored.x, mirrored.y, mirrored.z), newId: v.id, newRot: v.rot });
    }
  }
  return dedupe(cs);
}

// 绕轴旋转 90°：axis 'x'|'y'|'z'，dir +1/-1
export function rotate90(world, axis, dir, sel) {
  const bb = boundsOf(world, sel); if (!bb) return [];
  const vox = sel ? readSelection(world, sel) : allVoxels(world, bb);
  const c = { x: (bb.min.x + bb.max.x) / 2, y: (bb.min.y + bb.max.y) / 2, z: (bb.min.z + bb.max.z) / 2 };
  const rot = axis === "y" ? (dir > 0 ? (x, y, z) => [c.x + (z - c.z), y, c.z - (x - c.x)] : (x, y, z) => [c.x - (z - c.z), y, c.z + (x - c.x)])
    : axis === "x" ? (dir > 0 ? (x, y, z) => [x, c.y - (z - c.z), c.z + (y - c.y)] : (x, y, z) => [x, c.y + (z - c.z), c.z - (y - c.y)])
      : (dir > 0 ? (x, y, z) => [c.x + (y - c.y), c.y - (x - c.x), z] : (x, y, z) => [c.x - (y - c.y), c.y + (x - c.x), z]);
  const cs = [];
  for (const v of vox) {
    const [nx, ny, nz] = rot(v.x, v.y, v.z).map(Math.round);
    if (!world.inBounds(nx, ny, nz)) continue;
    cs.push({ x: nx, y: ny, z: nz, oldId: world.get(nx, ny, nz), oldRot: world.getRot(nx, ny, nz), newId: v.id, newRot: v.rot });
  }
  return dedupe(cs);
}

export function flip(world, axis, sel) { return mirror(world, axis, sel); }

function allVoxels(world, bb) {
  const out = [];
  for (let x = bb.min.x; x <= bb.max.x; x++) for (let y = bb.min.y; y <= bb.max.y; y++) for (let z = bb.min.z; z <= bb.max.z; z++) {
    const id = world.get(x, y, z); if (id) out.push({ x, y, z, id, rot: world.getRot(x, y, z) });
  }
  return out;
}
function dedupe(cs) {
  const m = new Map();
  for (const c of cs) m.set(c.x + "," + c.y + "," + c.z, c);
  return [...m.values()].filter((c) => c.oldId !== c.newId || c.oldRot !== c.newRot);
}
