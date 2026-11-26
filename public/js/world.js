// world.js — 体素数据模型。稀疏存储，与 box3lab .gz VoxelPayload 格式互转。
// 坐标打包：index = x + y*shapeX + z*shapeX*shapeY（与 Unity 导出一致）。

// 大世界用密集 ID 数组，旋转仍按稀疏 Map 保存；避免上千万个 Map 条目触发长 GC。
class DenseVoxelMap {
  constructor(cells) {
    this.ids = new Uint16Array(cells);
    this.rotations = new Map();
    this.count = 0;
  }
  get size() { return this.count; }
  get(index) {
    const id = this.ids[index];
    return id ? id | ((this.rotations.get(index) || 0) << 16) : undefined;
  }
  has(index) { return this.ids[index] !== 0; }
  set(index, value) {
    const id = value & 0xffff, old = this.ids[index];
    if (id && !old) this.count++;
    else if (!id && old) this.count--;
    this.ids[index] = id;
    const rot = (value >>> 16) & 0xffff;
    if (rot) this.rotations.set(index, rot);
    else if (this.rotations.size) this.rotations.delete(index);
    return this;
  }
  delete(index) {
    if (!this.ids[index]) return false;
    this.ids[index] = 0; this.rotations.delete(index); this.count--;
    return true;
  }
  clear() { this.ids.fill(0); this.rotations.clear(); this.count = 0; }
  *keys() {
    const ids = this.ids;
    for (let i = 0; i < ids.length; i++) if (ids[i]) yield i;
  }
  *values() {
    const ids = this.ids, rotations = this.rotations;
    for (let i = 0; i < ids.length; i++) if (ids[i]) yield ids[i] | ((rotations.get(i) || 0) << 16);
  }
  *entries() {
    const ids = this.ids, rotations = this.rotations;
    for (let i = 0; i < ids.length; i++) if (ids[i]) yield [i, ids[i] | ((rotations.get(i) || 0) << 16)];
  }
  forEach(cb, thisArg) {
    for (const [key, value] of this.entries()) cb.call(thisArg, value, key, this);
  }
  [Symbol.iterator]() { return this.entries(); }
}

export class VoxelWorld {
  constructor(shape = [64, 64, 64]) {
    this.shape = shape.slice();
    this.cells = shape[0] * shape[1] * shape[2];
    this.map = this.cells >= 16 * 1024 * 1024 && this.cells <= 160 * 1024 * 1024 ? new DenseVoxelMap(this.cells) : new Map();
  }
  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.shape[0] && y < this.shape[1] && z < this.shape[2];
  }
  pack(x, y, z) { return x + y * this.shape[0] + z * this.shape[0] * this.shape[1]; }
  unpack(i) {
    const X = this.shape[0], XY = this.shape[0] * this.shape[1];
    const z = Math.floor(i / XY), r = i - z * XY;
    const y = Math.floor(r / X), x = r - y * X;
    return [x, y, z];
  }
  get(x, y, z) { if (x < 0 || y < 0 || z < 0 || x >= this.shape[0] || y >= this.shape[1] || z >= this.shape[2]) return 0; return (this.map.get(this.pack(x, y, z)) || 0) & 0xffff; }
  getRot(x, y, z) { if (x < 0 || y < 0 || z < 0 || x >= this.shape[0] || y >= this.shape[1] || z >= this.shape[2]) return 0; return (this.map.get(this.pack(x, y, z)) || 0) >>> 16; }
  set(x, y, z, id, rot = 0) {
    const i = this.pack(x, y, z);
    if (id === 0) { this.map.delete(i); return; }
    this.map.set(i, (id & 0xffff) | ((rot & 0xffff) << 16));
  }
  has(x, y, z) { return this.map.has(this.pack(x, y, z)); }
  size() { return this.map.size; }
  bounds() {
    if (this.map.size === 0) return null;
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    for (const i of this.map.keys()) {
      const [x, y, z] = this.unpack(i);
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
  }

  toPayload(meta = {}) {
    const indices = [], data = [];
    let rot = null;
    for (const [i, v] of this.map) {
      indices.push(i); data.push(v & 0xffff);
      const r = v >>> 16;
      if (r) {
        if (!rot) rot = new Array(indices.length - 1).fill(0);
        rot.push(r);
      } else if (rot) rot.push(0);
    }
    const out = { formatVersion: "unity", shape: this.shape, dir: [1, 1, 1], indices, data, meta };
    if (rot) out.rot = rot;
    return out;
  }
  static fromPayload(p) {
    const w = new VoxelWorld(p.shape || [64, 64, 64]);
    const idx = p.indices || [], dat = p.data || [], rt = p.rot || [];
    for (let k = 0; k < idx.length; k++) {
      const id = dat[k];
      if (!id) continue;
      w.map.set(idx[k], (id & 0xffff) | (((rt[k] || 0) & 0xffff) << 16));
    }
    return w;
  }
}

// MagicaVoxel .vox (RGBA binary) 读写 —— 与线上“导入 vox”一致的能力
//
// 文件里 y 向上（Magica 口径）。自家旧实现写的是"从顶部往下数"，而且不写 SIZE/RGBA，
// 于是导出的文件在 Magica 里是倒的、颜色整个丢掉，回到我们自己的导入器也认不出调色板。
// 现在按规范写：MAIN(0,0) 包 SIZE + XYZI(带体素数) + RGBA。
export function encodeVox(world, palette, colors = null) {
  const b = world.bounds();
  if (!b) return new Uint8Array(0);
  const [minx, miny, minz] = b.min, [maxx, maxy, maxz] = b.max;
  const sx = maxx - minx + 1, sy = maxy - miny + 1, sz = maxz - minz + 1;
  const bytes = [];
  const push = (...xs) => { for (const x of xs) bytes.push(...(x instanceof Uint8Array ? Array.from(x) : x)); };
  const id4 = (s) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
  const u32 = (n) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; };

  push(id4("VOX ")); push(u32(150));
  const body = [];
  const put = (...xs) => { for (const x of xs) body.push(...(x instanceof Uint8Array ? Array.from(x) : x)); };
  put(id4("SIZE"), u32(12), u32(0), u32(sx), u32(sy), u32(sz));
  const xyz = [];
  for (const [i, v] of world.map) {
    const [x, y, z] = world.unpack(i);
    const pal = palette.indexOf(v & 0xffff);
    if (x < minx || y < miny || z < minz) continue;
    xyz.push(x - minx, y - miny, z - minz, Math.max(1, Math.min(255, pal + 1)));
  }
  put(id4("XYZI"), u32(4 + xyz.length), u32(0), u32(xyz.length / 4), xyz);
  if (colors) {
    const rgba = new Uint8Array(1024);
    for (let i = 0; i < 256; i++) {
      const c = colors[i] || [0, 0, 0, 0];
      rgba[i * 4] = c[0] | 0; rgba[i * 4 + 1] = c[1] | 0; rgba[i * 4 + 2] = c[2] | 0;
      rgba[i * 4 + 3] = c[3] == null ? 255 : (c[3] | 0);
    }
    put(id4("RGBA"), u32(1024), u32(0), rgba);
  }
  push(id4("MAIN"), u32(0), u32(0), body);   // 规范：MAIN 两个长度都是 0，内容一直到文件尾
  return Uint8Array.from(bytes);
}

/**
 * 读 .vox，返回 { voxels, size, palette }。
 * voxels 沿用本仓库既有约定 [x, z, yDown, palIndex]——调用方一律 `maxY - yDown` 复原高度，
 * 改这个形状会同时波及 io.js、voxa/model.js 与 main.js 三条路径。
 *
 * 两种历史口径必须同时接住，判错方向会让老素材集体上下翻转：
 *   规范文件（Magica 与现在的我们）：MAIN 两个长度都是 0、有 SIZE、y 向上；
 *   自家旧导出：MAIN 的 childrenSize 被塞了 bodySize，或干脆没有 SIZE，y 已经是"从顶往下"。
 */
export function readVox(buf) {
  const back = buf.buffer || buf;
  const off = buf.byteOffset || 0, len = buf.byteLength ?? buf.length;
  const view = new Uint8Array(back, off, len);
  const dv = new DataView(back, off, len);
  let o = 0;
  const rd = (n) => { const s = view.subarray(o, o + n); o += n; return s; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  if (String.fromCharCode(...rd(4)) !== "VOX ") throw new Error("bad vox");
  u32();
  const raw = [], palette = [];
  let size = null, legacyYDown = false;
  function walk(end) {
    while (o + 12 <= end) {
      const id = String.fromCharCode(...rd(4));
      const clen = u32(), cdata = u32();
      const bodyStart = o;
      const specMain = id === "MAIN" && clen === 0 && cdata === 0;
      if (id === "MAIN" && !specMain) legacyYDown = true;      // 旧 encodeVox 的指纹
      const bodyEnd = specMain ? end : Math.min(end, bodyStart + clen + cdata);
      if (id === "MAIN") walk(bodyEnd);
      else if (id === "SIZE") size = [dv.getUint32(bodyStart, true), dv.getUint32(bodyStart + 4, true), dv.getUint32(bodyStart + 8, true)];
      else if (id === "XYZI") {
        // 前 4 字节是体素数。旧实现把它当第一条体素读了——每条导入都因此多出一个
        // 假体素，并把部件包围盒撑歪，这就是"导入的模型边上多一块"的来历。
        const n = dv.getUint32(bodyStart, true);
        for (let i = bodyStart + 4; i + 3 <= bodyEnd && raw.length < n; i += 4)
          raw.push([view[i], view[i + 1], view[i + 2], view[i + 3]]);   // 文件槽位，先原样收着
      } else if (id === "RGBA") {
        for (let i = bodyStart; i + 3 <= bodyEnd && palette.length < 256; i += 4)
          palette.push([view[i], view[i + 1], view[i + 2], view[i + 3]]);
      }
      o = bodyEnd;
    }
  }
  walk(len);
  if (!size) legacyYDown = true;
  // 文件槽位 → 本仓库口径 [x, z, yDown]：
  //   规范文件按 (x, y↑, z) 存，所以第 2、3 槽要换位、y 还要从顶往下数；
  //   自家旧导出直接把 [x, z, yDown] 写进三个槽，动不得——判错就会整批上下翻转。
  const specShape = !!size && !legacyYDown;
  const h = size ? size[1] : 0;
  const voxels2 = raw.map(specShape ? ([a, b, c, p]) => [a, c, h - 1 - b, p] : (v) => v);
  return { voxels: voxels2, size, palette };
}
export function decodeVox(buf) { return readVox(buf).voxels; }   // [x, z, y(down), palIndex]
export function decodeVoxPalette(buf) { return readVox(buf).palette; }
function concatBytes(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
