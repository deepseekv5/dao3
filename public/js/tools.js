// tools.js — 编辑工具实现。
// 三个回调的含义（main.js 只在左键按住时派发 onMove，所以拖动不会漏、悬停不会来）：
//   onDown 一次操作的起点；onMove 拖动途中；onUp 终点 + 一次性提交到 History
//   （一次撤销 = 一次拖拽）。onUp 里先补一次 _apply 再提交，
//   因为 move 可能被浏览器合并掉，最后那一格否则就丢了。

function key(x, y, z) { return x + "," + y + "," + z; }
// 工具读的是 ctx.shift（由 main.js 每次派发时从事件当场取），不是一份全局状态。
// 原来这里读的是 ctx.modifiers.shift，而那个字段只有声明、没有任何写入点，
// 于是盒工具的 Hollow 永远实心、球/柱半径永远最小档、阵列三个方向都是 1——
// 而阵列在 1×1×1 下会把唯一那个实例跳过，等于一次点击什么都不做。
// 从事件现取就少一整个"谁忘了更新"的失败面。
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
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "place"); },
  },
  break: {
    name: "破坏", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._apply(ctx); },
    _apply(ctx) { const p = ctx.pick; if (!p || p.ground) return; if (ctx.world.get(p.x, p.y, p.z)) ctx._cs.remove(p.x, p.y, p.z); },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "break"); },
  },
  paint: {
    name: "刷色", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._apply(ctx); },
    _apply(ctx) { const p = ctx.pick; if (!p || p.ground) return; const id = ctx.world.get(p.x, p.y, p.z); if (id && id !== ctx.currentBlock) ctx._cs.set(p.x, p.y, p.z, ctx.currentBlock, ctx.blockRot || 0); },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "paint"); },
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
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "line"); ctx._a = null; },
  },
  box: {
    name: "盒", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); ctx._a = ctx.pick ? { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az } : null; },
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const b = { x: ctx.pick.ax, y: ctx.pick.ay, z: ctx.pick.az };
      const mn = norm(ctx._a, b), mx = normMax(ctx._a, b);
      const shell = ctx.shift;
      boxFill(mn, mx, (x, y, z) => { if (ctx.world.inBounds(x, y, z)) ctx._cs.set(x, y, z, ctx.currentBlock, ctx.blockRot || 0); }, shell);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "box"); ctx._a = null; },
  },
  boxBreak: {
    name: "盒删", onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); ctx._a = ctx.pick ? { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z } : null; },
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const b = { x: ctx.pick.x, y: ctx.pick.y, z: ctx.pick.z };
      const mn = norm(ctx._a, b), mx = normMax(ctx._a, b);
      boxFill(mn, mx, (x, y, z) => { if (ctx.world.get(x, y, z)) ctx._cs.remove(x, y, z); }, ctx.shift);
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "boxBreak"); ctx._a = null; },
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
    // 松手时补一次：只按下不动鼠标也算"选中这一格"，拖过一片则按最后那一格收口。
    onUp(ctx) { this._apply(ctx); ctx._a = null; },
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
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>spherePoints(x,y,z,radius(ctx),false); },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "sphere"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  sphereH: {
    name: "空心球",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>spherePoints(x,y,z,radius(ctx),true); },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "sphereH"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  radius: {
    name: "半径笔刷",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>circlePoints(x,y,z,radius(ctx),"y"); },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "radius"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  cylinder: {
    name: "圆柱",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>cylinderPoints(x,y,z,radius(ctx),1+radius(ctx)*2,false); },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "cylinder"); },
    _apply(ctx) {
      if (!this._pts) return;
      const p = ctx.pick; if (!p || p.ground) return;
      for (const pt of this._pts(p.ax, p.ay, p.az, ctx)) { if (ctx.world.inBounds(pt.x, pt.y, pt.z)) ctx._cs.set(pt.x, pt.y, pt.z, ctx.currentBlock, ctx.blockRot || 0); }
    },
  },
  cylinderH: {
    name: "空心柱",
    onDown(ctx) { ctx._cs = new ChangeSet(ctx.world); this._pts=(x,y,z)=>cylinderPoints(x,y,z,radius(ctx),1+radius(ctx)*2,true); },
    onMove(ctx) { this._apply(ctx); }, onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "cylinderH"); },
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
    _apply(ctx) {
      if (!ctx._a || !ctx.pick) return;
      const mn = norm(ctx._a, { x: ctx.pick.ax, y: ctx._level, z: ctx.pick.az }), mx = normMax(ctx._a, { x: ctx.pick.ax, y: ctx._level, z: ctx.pick.az });
      for (let x = mn.x; x <= mx.x; x++) for (let z = mn.z; z <= mx.z; z++) { if (ctx.world.inBounds(x, ctx._level, z)) ctx._cs.set(x, ctx._level, z, ctx.currentBlock); }
    },
    onMove(ctx) { this._apply(ctx); },
    onUp(ctx) { this._apply(ctx); ctx.history.commit(ctx._cs.changes(), "flatten"); ctx._a = null; ctx._level = 0; },
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
      const ch = ctx._cs.changes();
      ctx.history.commit(ch, "array"); ctx._sel = null;
      // 副本落在已被同一种方块占住的格子里时 diff 是空的（old==new 全被滤掉），
      // 于是这一笔什么都不改。沉默在这里就等于"这工具坏了"，所以把原因说出来。
      if (!ch.length && ctx.notify) ctx.notify("阵列没有可放的位置：目标格子已被同样的方块占住");
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

function radius(ctx) { return parseInt(ctx.shift ? 3 : 1, 10); }
// 阵列：把选区在 X/Z 上各复制 s-1 份，偏移量取选区自身的尺寸，
// 副本就永远紧贴原件、不会互相压住。原来偏移写死成 s（1 或 3）而份数也等于 s，
// 于是 s=1 时唯一那份被 "if (!ix&&!iy&&!iz) continue" 跳过——一次点击什么都不做；
// s=3 时副本压在原件上。纵向份数一直是 1（floor(1/2) 与 floor(3/2) 之后 ny 都取到 1），
// 所以这里也照实写成 1，不留一个永远不会触发的分支。
function arrayParams(ctx) {
  const s = ctx.shift ? 3 : 2;
  const sel = ctx._sel || ctx.selection;
  const w = sel ? sel.max.x - sel.min.x + 1 : 1;
  const d = sel ? sel.max.z - sel.min.z + 1 : 1;
  return { nx: s, ny: 1, nz: s, dx: w, dy: 0, dz: d };
}
