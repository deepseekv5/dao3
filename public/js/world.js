// world.js — 体素数据模型。稀疏存储，与 box3lab .gz VoxelPayload 格式互转。
// 坐标打包：index = x + y*shapeX + z*shapeX*shapeY（与 Unity 导出一致）。

export class VoxelWorld {
  constructor(shape = [64, 64, 64]) {
    this.shape = shape.slice();
    this.cells = shape[0] * shape[1] * shape[2];
    this.map = new Map(); // packedIndex -> { id, rot }
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
  get(x, y, z) { if (x < 0 || y < 0 || z < 0 || x >= this.shape[0] || y >= this.shape[1] || z >= this.shape[2]) return 0; const c = this.map.get(this.pack(x, y, z)); return c ? c.id : 0; }
  getRot(x, y, z) { if (x < 0 || y < 0 || z < 0 || x >= this.shape[0] || y >= this.shape[1] || z >= this.shape[2]) return 0; const c = this.map.get(this.pack(x, y, z)); return c ? c.rot : 0; }
  set(x, y, z, id, rot = 0) {
    const i = this.pack(x, y, z);
    if (id === 0) { this.map.delete(i); return; }
    this.map.set(i, { id, rot });
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
    const indices = [], data = [], rot = [];
    for (const [i, c] of this.map) { indices.push(i); data.push(c.id); rot.push(c.rot || 0); }
    return { formatVersion: "unity", shape: this.shape, dir: [1, 1, 1], indices, data, rot, meta };
  }
  static fromPayload(p) {
    const w = new VoxelWorld(p.shape || [64, 64, 64]);
    const idx = p.indices || [], dat = p.data || [], rt = p.rot || [];
    for (let k = 0; k < idx.length; k++) {
      if (!dat[k]) continue;
      const [x, y, z] = w.unpack(idx[k]);
      w.set(x, y, z, dat[k], rt[k] || 0);
    }
    return w;
  }
}

// MagicaVoxel .vox (RGBA binary) 读写 —— 与线上“导入 vox”一致的能力
export function encodeVox(world, palette) {
  const b = world.bounds();
  if (!b) return new Uint8Array(0);
  const [minx, miny, minz] = b.min, [maxx, maxy, maxz] = b.max;
  const sx = maxx - minx + 1, sy = maxy - miny + 1, sz = maxz - minz + 1;
  const chunks = [];
  const str = (s) => { const a = new TextEncoder().encode(s); return a; };
  const u32 = (n) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n, true); return a; };
  const u8 = (n) => new Uint8Array([n]);
  // header
  chunks.push(str("VOX ")); chunks.push(u32(150));
  // MAIN chunk wrapping XYZI
  const xyz = [];
  for (const [i, c] of world.map) {
    const [x, y, z] = world.unpack(i);
    const pal = palette.indexOf(c.id);
    if (x < minx || y < miny || z < minz) continue;
    xyz.push(x - minx, z - minz, sy - 1 - (y - miny), Math.max(1, pal + 1));
  }
  const bodySize = 12 + xyz.length * 4;
  const main = [str("MAIN"), u32(0), u32(bodySize)];
  main.push(str("XYZI"), u32(xyz.length / 4));
  for (const v of xyz) main.push(u8(v & 0xff));
  const mainBuf = concatBytes(main);
  chunks.push(mainBuf);
  return concatBytes(chunks);
}
export function decodeVox(buf) {
  const dv = new DataView(buf.buffer || buf);
  let o = 0;
  const rd = (n) => { const s = new Uint8Array(buf.buffer || buf, (buf.byteOffset || 0) + o, n); o += n; return s; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  if (String.fromCharCode(...rd(4)) !== "VOX ") throw new Error("bad vox");
  u32();
  const voxels = [];
  function walk(end) {
    while (o < end) {
      const id = String.fromCharCode(...rd(4));
      const clen = u32(), cdata = u32(), next = o + clen + cdata;
      if (id === "XYZI") {
        const n = clen;
        for (let i = 0; i < n; i++) { voxels.push([rd(1)[0], rd(1)[0], rd(1)[0], rd(1)[0]]); }
      } else if (id === "MAIN") { walk(next); }
      o = next;
    }
  }
  walk(buf.byteLength || buf.length);
  return voxels; // [x, z, y(down), palIndex]
}
function concatBytes(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
