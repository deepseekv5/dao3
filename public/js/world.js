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
  // 按 MagicaVoxel 规范写：XYZI 的长度字段是**字节数**，MAIN 的两个长度写 0
  // （意思是"内容一直到文件尾"）。旧写法把体素数当长度、又把 bodySize 塞进
  // MAIN 的 contentContentSize，于是我们导出的 .vox 连 MagicaVoxel 自己都打不开。
  const main = [str("MAIN"), u32(0), u32(0), str("XYZI"), u32(xyz.length), u32(0)];
  for (const v of xyz) main.push(u8(v & 0xff));
  const mainBuf = concatBytes(main);
  chunks.push(mainBuf);
  return concatBytes(chunks);
}
export function decodeVox(buf) {
  // back/off/len 三件套都要带：从 zip 里解出来的是一条**子视图**，
  // 只写 buf.buffer 等于从整个 zip 的第 0 字节开始读。
  const back = buf.buffer || buf;
  const off = buf.byteOffset || 0, len = buf.byteLength ?? buf.length;
  const view = new Uint8Array(back, off, len);
  const dv = new DataView(back, off, len);
  let o = 0;
  const rd = (n) => { const s = view.subarray(o, o + n); o += n; return s; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  if (String.fromCharCode(...rd(4)) !== "VOX ") throw new Error("bad vox");
  u32();
  const voxels = [];
  function walk(end) {
    while (o + 12 <= end) {
      const id = String.fromCharCode(...rd(4));
      const clen = u32(), cdata = u32();
      const bodyStart = o;
      // MAIN 按规范两个长度都是 0，含义是"一直到（外层）结尾"
      let bodyEnd = clen + cdata === 0 && id === "MAIN" ? end : Math.min(end, bodyStart + clen + cdata);
      if (id === "MAIN") walk(bodyEnd);
      else if (id === "XYZI") {
        // 只按规范读：clen 是字节数，所以体素数 = 内容字节 / 4。
        // 曾经还留了一条"自家旧口径"的分支，但旧 encodeVox 连 contentContentSize
        // 都没写，那种文件本来就解不出正确的体素，留着只是假装兼容。
        for (let i = bodyStart; i + 3 < bodyEnd; i += 4) voxels.push([view[i], view[i + 1], view[i + 2], view[i + 3]]);
      }
      o = bodyEnd;
    }
  }
  walk(len);
  return voxels; // [x, z, y(down), palIndex]
}
function concatBytes(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let p = 0;
  for (const a of arrs) { out.set(a, p); p += a.length; }
  return out;
}
