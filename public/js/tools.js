// tools.js — 编辑工具实现。每个工具通过 onDown/onMove/onUp 响应指针事件，
// 在 onUp 时把累计的体素变更一次性提交到 History（一次撤销 = 一次拖拽）。
import { VoxelWorld } from "./world.js";

function key(x, y, z) { return x + "," + y + "," + z; }
function snap(ctx, x, y, z) { return { x, y, z }; }

// 记录 old 值，生成一条 change（去重：同格保留首次 old 与最新 new）
class ChangeSet {
  constructor(world) { this.world = world; this.map = new Map(); }
  set(x, y, z, id, rot = 0) {
    const k = key(x, y, z);
    if (this.map.has(k)) { const c = this.map.get(k); c.newId = id; c.newRot = rot; }
    else this.map.set(k, { x, y, z, oldId: this.world.get(x, y, z), oldRot: this.world.getRot(x, y, z), newId: id, newRot: rot });
  }
  remove(x, y, z) { this.set(x, y, z, 0); }
  changes() { return [...this.map.values()].filter((c) => c.oldId !== c.newId || c.oldRot !== c.newRot); }
}

// 3D Bresenham 线
function line3(a, b) {
  const pts = [];
  let x0 = a.x, y0 = a.y, z0 = a.z, x1 = b.x, y1 = b.y, z1 = b.z;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  const dm = Math.max(dx, dy, dz);
  let x = x0, y = y0, z = z0;
  const ex = (dm ? dx / dm : 0) * sx, ey = (dm ? dy / dm : 0) * sy, ez = (dm ? dz / dm : 0) * sz;
  pts.push({ x, y, z });
  for (let i = 0; i < dm; i++) {
    x += ex; y += ey; z += ez;
    const nx = Math.round(x), ny = Math.round(y), nz = Math.round(z);
    if (nx !== pts[pts.length - 1].x || ny !== pts[pts.length - 1].y || nz !== pts[pts.length - 1].z) pts.push({ x: nx, y: ny, z: nz });
  }
  if (pts[pts.length - 1].x !== x1 || pts[pts.length - 1].y !== y1 || pts[pts.length - 1].z !== z1) pts.push({ x: x1, y: y1, z: z1 });
  return pts;
}

function boxFill(min, max, cb, shellOnly = false) {
  for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) {
    if (shellOnly && !(x === min.x || x === max.x || y === min.y || y === max.y || z === min.z || z === max.z)) continue;
    cb(x, y, z);
  }
}
function norm(min, max) {
  return { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y), z: Math.min(min.z, max.z) };
}
function normMax(min, max) {
  return { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y), z: Math.max(min.z, max.z) };
}
function spherePoints(cx, cy, cz, r, hollow = false) {
  const pts = [];
  for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
    if (hollow && Math.abs(x) < r && Math.abs(y) < r && Math.abs(z) < r) continue;
    if (x*x + y*y + z*z <= r*r + 0.5) pts.push({ x: cx + x, y: cy + y, z: cz + z });
  }
  return pts;
}
function cylinderPoints(cx, cy, cz, r, height, hollow = false) {
  const pts = [];
  for (let y = 0; y < height; y++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    if (hollow && Math.abs(x) < r && Math.abs(z) < r) continue;
    if (x*x + z*z <= r*r + 0.5) pts.push({ x: cx + x, y: cy + y, z: cz + z });
  }
  return pts;
}
function circlePoints(cx, cy, cz, r, axis = "y") {
  const pts = [];
  if (axis === "y") {
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (x*x + z*z <= r*r + 0.5) pts.push({ x: cx + x, y: cy, z: cz + z });
    }
  } else if (axis === "x") {
    for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (y*y + z*z <= r*r + 0.5) pts.push({ x: cx, y: cy + y, z: cz + z });
    }
  } else {
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) {
      if (x*x + y*y <= r*r + 0.5) pts.push({ x: cx + x, y: cy + y, z: cz });
    }
  }
  return pts;
}
function floodFill(ctx, start, newId) {
  const { world, atlas } = ctx;
  const oldId = world.get(start.x, start.y, start.z);
  if (oldId === newId) return [];
  const cs = new ChangeSet(world);
  const seen = new Set(); const stack = [start];
  const maxVox = 200000; let n = 0;
  while (stack.length && n < maxVox) {
    const c = stack.pop(); const k = key(c.x, c.y, c.z);
    if (seen.has(k)) continue; seen.add(k); n++;
    if (world.get(c.x, c.y, c.z) !== oldId) continue;
    cs.set(c.x, c.y, c.z, newId, world.getRot(c.x, c.y, c.z));
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = c.x + d[0], ny = c.y + d[1], nz = c.z + d[2];
      if (world.inBounds(nx, ny, nz)) stack.push({ x: nx, y: ny, z: nz });
    }
  }
  return cs.changes();
}

export const TOOLS = {
  place: {
    name: "放置", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._apply(ctx); },
    _apply(ctx) {
      const p = ctx.pick; if (!p) return;
      const { x, y, z } = { x: p.ax, y: p.ay, z: p.az };
      if (!ctx.world.inBounds(x, y, z)) return;
      if (ctx.world.get(x, y, z)) return;
      ctx._cs.set(x, y, z, ctx.currentBlock, ctx.blockRot || 0);
      ctx.renderer.setGhost(x, y, z);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "place"); },
  },
  break: {
    name: "破坏", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._apply(ctx); },
    _apply(ctx) { const p = ctx.pick; if (!p || p.ground) return; if (ctx.world.get(p.x, p.y, p.z)) ctx._cs.remove(p.x, p.y, p.z); },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "break"); },
  },
  paint: {
    name: "刷色", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._apply(ctx); },
    _apply(ctx) { const p = ctx.pick; if (!p || p.ground) return; const id = ctx.world.get(p.x, p.y, p.z); if (id && id !== ctx.currentBlock) ctx._cs.set(p.x, p.y, p.z, ctx.currentBlock, ctx.blockRot || 0); },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "paint"); },
  },
  fill: {
    name: "填充", onDown(ctx) { const p = ctx.pick; if (!p || p.ground) return; ctx.history.commit(floodFill(ctx, { x: p.x, y: p.y, z: p.z }, ctx.currentBlock), "fill"); },
    onMove() {}, onUp() {},
  },
  eyedropper: {
    name: "吸管", onDown(ctx) { const p = ctx.pick; if (!p || p.ground) return; const id = ctx.world.get(p.x, p.y, p.z); if (id) ctx.onPickBlock(id); },
    onMove() {}, onUp() {},
  },
  line: {
    name: "线", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); ctx._a = ctx.pick ? { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az } : null; },
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const b = { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az };
      for (const pt of line3(ctx._a, b)) if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "line"); ctx._a = null; },
  },
  box: {
    name: "盒", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); ctx._a = ctx.pick ? { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az } : null; },
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const b = { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az };
      const mn = norm(ctx._a, b), mx = normMax(ctx._a, b);
      const shell = ctx.modifiers.shift;
      boxFill(mn, mx, (x, y, z) => { if (ctx.world.inBounds(x, y, z)) ctx._cs.set(x, y, z, ctx.currentBlock, ctx.blockRot || 0); }, shell);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "box"); ctx._a = null; },
  },
  boxBreak: {
    name: "盒删", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); ctx._a = ctx.pick ? { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z } : null; },
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const b = { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z };
      const mn = norm(ctx._a, b), mx = normMax(ctx._a, b);
      boxFill(mn, mx, (x, y, z) => { if (ctx.world.get(x, y, z)) ctx._cs.remove(x, y, z); }, ctx.modifiers.shift);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "boxBreak"); ctx._a = null; },
  },
  extrude: {
    name: "拉伸", onDown(ctx) {
      const p = ctx.pick; if (!p || p.ground) return;
      ctx._cs = new ChangeSet(ctx.world);
      const id = ctx.world.get(p.x, p.y, p.z);
      const ax = p.x + p.nx, ay = p.y + p.ny, az = p.z + p.nz;
      if (ctx.world.inBounds(ax, ay, az) && !ctx.world.get(ax, ay, az)) ctx._cs.set(ax, ay, az, id);
    },
    onMove() {}, onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "extrude"); },
  },
  select: {
    name: "选择", onDown(ctx) { ctx._a = ctx.pick ? { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z } : null; },
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const b = { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z };
      const mn = norm(ctx._a, b), mx = normMax(ctx._a, b);
      ctx.setSelection(mn, mx);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { ctx._a = null; },
  },
  move: {
    name: "移动", onDown(ctx) {
      if (!ctx.selection) return;
      ctx._cs = new ChangeSet(ctx.world);
      ctx._start = ctx.pick ? { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z } : { x: 0, y: 0, z: 0 };
      ctx._sel = cloneSel(ctx.selection);
    },
    _apply(ctx) {
      if (!ctx.pick || !ctx._sel) return;
      const dx = ctx.pick.x - ctx._start.x, dy = ctx.pick.y - ctx._start.y, dz = ctx.pick.z - ctx._start.z;
      ctx.previewMove(ctx._sel, dx, dy, dz);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) {
      if (!ctx._sel || !ctx.pick) return;
      const dx = ctx.pick.x - ctx._start.x, dy = ctx.pick.y - ctx._start.y, dz = ctx.pick.z - ctx._start.z;
      ctx.commitMove(ctx._sel, dx, dy, dz, ctx._cs);
      ctx._sel = null;
    },
  },
  sphere: {
    name: "球体",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>spherePoints(x,y,z,radius(ctx),false); this._apply=()=>{}; },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "sphere"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  sphereH: {
    name: "空心球",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>spherePoints(x,y,z,radius(ctx),true); this._apply=()=>{}; },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "sphereH"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  radius: {
    name: "半径笔刷",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>circlePoints(x,y,z,radius(ctx),"y"); this._apply=()=>{}; },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "radius"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  cylinder: {
    name: "圆柱",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>cylinderPoints(x,y,z,radius(ctx),1+radius(ctx)*2,false); this._apply=()=>{}; },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "cylinder"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  cylinderH: {
    name: "空心柱",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>cylinderPoints(x,y,z,radius(ctx),1+radius(ctx)*2,true); this._apply=()=>{}; },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "cylinderH"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  flatten: {
    name: "平整",
    onDown(ctx) {
      ctx._cs = new ChangeSet(ctx.world);
      ctx._a = ctx.pick ? { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az } : null;
      ctx._level = ctx.pick ? ctx.pick.ay : 0;
    },
    onMove(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const mn = norm(ctx._a, { x: ctx.pick.ax, y: ctx._level, z: ctx.pick.az }), mx = normMax(ctx._a, { x: ctx.pick.ax, y: ctx._level, z: ctx.pick.az });
      for (let x = mn.x; x <= mx.x; x++) for (let z = mn.z; z <= mx.z; z++) { if (ctx.world.inBounds(x, ctx._level, z)) ctx._cs.set(x, ctx._level, z, ctx.currentBlock); }
    },
    onUp(ctx) { ctx.history.commit(ctx._cs.changes(), "flatten"); ctx._a = null; ctx._level = 0; },
  },
  array: {
    name: "阵列",
    onDown(ctx) {
      if (!ctx.selection) { ctx.notify && ctx.notify("请先用选择工具框选区域"); return; }
      ctx._sel = cloneSel(ctx.selection); ctx._cs = new ChangeSet(ctx.world);
      const p = arrayParams(ctx); ctx._params = p;
    },
    onMove(ctx) {},
    onUp(ctx) {
      if (!ctx._sel) return;
      const { nx, ny, nz, dx, dy, dz } = ctx._params || arrayParams(ctx);
      const vox = readSelection(ctx.world, ctx._sel);
      for (const v of vox) for (let ix=0;ix<nx;ix++) for (let iy=0;iy<ny;iy++) for (let iz=0;iz<nz;iz++) {
        const ox = ix*dx, oy = iy*dy, oz = iz*dz; if (!ix && !iy && !iz) continue;
        const x = v.x+ox, y = v.y+oy, z = v.z+oz; if (ctx.world.inBounds(x,y,z)) ctx._cs.set(x,y,z,v.id,v.rot);
      }
      ctx.history.commit(ctx._cs.changes(), "array"); ctx._sel = null;
    },
  },
};
function cloneSel(s) { return { min: { ...s.min }, max: { ...s.max } }; }

// 选择区域工具函数（供 move / copy / delete 复用）
export function readSelection(world, sel) {
  const out = [];
  boxFill(sel.min, sel.max, (x, y, z) => { const id = world.get(x, y, z); if (id) out.push({ x, y, z, id, rot: world.getRot(x, y, z) }); });
  return out;
}
export function eraseSelection(world, sel) {
  const cs = new ChangeSet(world);
  boxFill(sel.min, sel.max, (x, y, z) => { if (world.get(x, y, z)) cs.remove(x, y, z); });
  return cs.changes();
}
export function pasteVoxels(world, voxels, dx, dy, dz) {
  const cs = new ChangeSet(world);
  for (const v of voxels) { const x = v.x + dx, y = v.y + dy, z = v.z + dz; if (world.inBounds(x, y, z)) cs.set(x, y, z, v.id, v.rot); }
  return cs.changes();
}

function radius(ctx) { return parseInt(ctx.modifiers.shift ? 3 : 1, 10); }
function arrayParams(ctx) {
  const s = ctx.modifiers.shift ? 3 : 1;
  return { nx: s, ny: Math.max(1, Math.floor(s/2)), nz: s, dx: s, dy: 0, dz: s };
}
