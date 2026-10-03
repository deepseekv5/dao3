/**
 * covers.mjs — 没有编辑器截图时，用体素数据自己画一张封面。
 *
 * 为什么要自己画：广场里每张没有封面的图都会退化成"按 id 派生的一段渐变"。
 * 看着花哨，实际后果是整个广场像同一个模板生成的——颜色不是内容给的，是随机数给的。
 * 这里改成把地图本身等距投影出来：草地是绿的、赛道是红的、夜景是黑的，
 * 每张卡片长得不一样，因为它画的就是那张图。
 *
 * 只用 Node 内置：PNG 的解码就是 inflate + 反滤波，编码就是加过滤字节再 deflate。
 */
import fs from "node:fs";
import zlib from "node:zlib";

const CHUNK = { IHDR: 0x49484452, IDAT: 0x49444154, PLTE: 0x504C5445, IEND: 0x49454E44 };

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 解一张非隔行 PNG（支持灰度/RGB/调色板/RGBA，8 位），统一返回 RGBA。 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.readUInt32BE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK.IHDR) {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error("不支持隔行 PNG");
      if (bitDepth !== 8) throw new Error("只支持 8 位 PNG");
    } else if (type === CHUNK.IDAT) idat.push(Buffer.from(data));
    else if (type === CHUNK.IEND) break;
    off += 12 + len;
  }
  const chans = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : 0;
  if (!chans) throw new Error("不支持的 PNG 色彩类型 " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * chans;
  const px = Buffer.alloc(width * height * 4);
  let pos = 0;
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= chans ? line[x - chans] : 0;
      const b = prev[x];
      const c = x >= chans ? prev[x - chans] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      line[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * chans;
      if (colorType === 6) {
        px[o] = line[s]; px[o + 1] = line[s + 1]; px[o + 2] = line[s + 2]; px[o + 3] = line[s + 3];
      } else if (colorType === 2) {
        px[o] = line[s]; px[o + 1] = line[s + 1]; px[o + 2] = line[s + 2]; px[o + 3] = 255;
      } else if (colorType === 3) {
        const idx = line[s];
        px[o] = palette(buf)[idx * 3] || 0; px[o + 1] = palette(buf)[idx * 3 + 1] || 0;
        px[o + 2] = palette(buf)[idx * 3 + 2] || 0; px[o + 3] = 255;
      } else {
        const g = colorType === 4 ? line[s] : line[s];
        px[o] = px[o + 1] = px[o + 2] = g; px[o + 3] = colorType === 4 ? line[s + 1] : 255;
      }
    }
    prev.set(line);
  }
  return { width, height, px };
}

let _palCache = new WeakMap();
function palette(buf) {
  if (_palCache.has(buf)) return _palCache.get(buf);
  let p = Buffer.alloc(0), off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.readUInt32BE(off + 4);
    if (type === CHUNK.PLTE) p = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  _palCache.set(buf, p);
  return p;
}

/** 8bit RGBA → PNG（filter 0，逐行加前缀字节再 deflate）。 */
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const body = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.alloc(4); t.writeUInt32BE(type, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    body(CHUNK.IHDR, ihdr),
    body(CHUNK.IDAT, zlib.deflateSync(raw, { level: 6 })),
    body(CHUNK.IEND, Buffer.alloc(0)),
  ]);
}

let _crcTable = null;
function crc32(buf) {
  if (!_crcTable) {
    _crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

/* ---------------- 方块代表色 ---------------- */

let _colors = null;
/**
 * 每个方块 id 的代表色 = 它顶面 tile 的平均像素 × 表里的 color 乘数。
 * 顶面在 faceOrder 里是第 4 个（index 3），three 的 slot 3 对应它。
 */
export function blockColors(atlasJsonPath, atlasPngPath) {
  if (_colors) return _colors;
  const j = JSON.parse(fs.readFileSync(atlasJsonPath, "utf8"));
  const { px, width } = decodePng(fs.readFileSync(atlasPngPath));
  const topSlot = Math.max(0, (j.faceOrder || []).indexOf("top"));
  const tileOf = (b) => (b.faces && b.faces[topSlot != null ? 3 : 0]) || (b.faces && b.faces[0]) || 0;
  const out = new Map();
  for (const b of j.blocks || []) {
    const t = tileOf(b);
    const col = Math.floor(t % j.cellsPerRow), row = Math.floor(t / j.cellsPerRow);
    const x0 = col * j.cellSize + j.pad, y0 = row * j.cellSize + j.pad;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = 0; y < j.tileSize; y++) {
      for (let x = 0; x < j.tileSize; x++) {
        const o = ((y0 + y) * width + (x0 + x)) * 4;
        if (px[o + 3] < 40) continue;                 // 透明像素不参与平均，否则颜色会被背景拉灰
        r += px[o]; g += px[o + 1]; bl += px[o + 2]; n++;
      }
    }
    if (!n) continue;
    const m = Array.isArray(b.color) ? b.color : [1, 1, 1, 1];
    out.set(b.id, [
      Math.min(255, Math.round((r / n) * Math.min(1.6, m[0] + 0.35))),
      Math.min(255, Math.round((g / n) * Math.min(1.6, m[1] + 0.35))),
      Math.min(255, Math.round((bl / n) * Math.min(1.6, m[2] + 0.35))),
    ]);
  }
  _colors = out;
  return out;
}

/* ---------------- 等距封面 ---------------- */

/**
 * 把世界画成一张俯视小地图：每列取最高的实心方块，转 45° 铺满封面。
 *
 * 存档是稀疏的：indices 是 pack 过的下标数组（x + y·X + z·X·Y），
 * data 是与之并行的方块 id。按稠密网格去下标读会一路读到 undefined，
 * 画出来就是一张纯色背景——看起来像"这张图是空的"，其实是索引口径错了。
 *
 * 为什么不是等距 3D：试过了——平坦的赛道会渲染成一块灰色菱形，比不画还像模板。
 * 小地图配坡度光照就不一样：路面和草地同色但坡度不同，赛道边线、地形起伏、
 * 建筑轮廓全都看得见。颜色全部来自方块图集，封面里没有任何一个随机数。
 */
export function renderCover({ indices, data, shape, colors, width = 480, height = 300 }) {
  const [sx, sy, sz] = shape;
  if (!indices || !indices.length || !data) return null;
  const XY = sx * sy;
  // 第一遍：每列的最高实心格。1.5M 体素也就是几百毫秒。
  const top = new Int32Array(sx * sz).fill(-1);
  const topId = new Int32Array(sx * sz);
  let hMin = sy, hMax = 0;
  for (let k = 0; k < indices.length; k++) {
    const id = data[k];
    if (!id) continue;
    const i = indices[k];
    const z = Math.floor(i / XY), r = i - z * XY;
    const y = Math.floor(r / sx), x = r - y * sx;
    if (x < 0 || x >= sx || z < 0 || z >= sz) continue;
    if (y > top[z * sx + x]) { top[z * sx + x] = y; topId[z * sx + x] = id; }
  }
  // 抽样上限：256×256 的图 6.5 万格，一帧就能画完；再大的图宁可糊一点也别卡住发布请求
  const stride = Math.max(1, Math.ceil(Math.sqrt((sx * sz) / 70000)));
  const nx = Math.ceil(sx / stride), nz = Math.ceil(sz / stride);
  const cells = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = Math.min(sx - 1, ix * stride), z = Math.min(sz - 1, iz * stride);
      const y = top[z * sx + x];
      if (y < 0) continue;
      if (y < hMin) hMin = y;
      if (y > hMax) hMax = y;
      cells.push([ix, iz, y, topId[z * sx + x]]);
    }
  }
  if (!cells.length) return null;

  const rgba = Buffer.alloc(width * height * 4);
  // 底色是中性石墨，不用渐变：封面里唯一的颜色应该来自地图本身
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 18; rgba[i * 4 + 1] = 18; rgba[i * 4 + 2] = 19; rgba[i * 4 + 3] = 255;
  }
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };
  const span = nx + nz;
  const tw = (width * 0.99) / span;             // 横向半格
  const th = (height * 0.94) / span;            // 纵向半格（压扁到刚好铺满）
  const lift = Math.min(20, height * 0.08) / Math.max(1, hMax - hMin);
  const ox = width / 2, oy = height * 0.03;
  // 坡度光照要读邻居高度，所以先把抽样后的面高度存成一张小网格
  const face = new Int32Array(nx * nz).fill(-1);
  for (const [ix, iz, y] of cells) face[iz * nx + ix] = y;
  // 从后往前画：旋转 45° 之后 ix+iz 越大越靠近观察者
  cells.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const nb = (ix, iz) => (ix < 0 || iz < 0 || ix >= nx || iz >= nz) ? -1 : face[iz * nx + ix];
  for (const [ix, iz, y, id] of cells) {
    const rgb = colors.get(id) || [110, 110, 115];
    // 朝"右上"的面亮、朝"左下"的面暗，平坦处保持本色。
    // 这一步让同色的路面和草地也分得出轮廓，否则整张图就是一块纯色。
    const slope = ((nb(ix + 1, iz) - nb(ix - 1, iz)) - (nb(ix, iz + 1) - nb(ix, iz - 1))) / (stride * 2);
    const k = Math.max(0.55, Math.min(1.3, 1 + slope * 0.45 + (y - (hMin + hMax) / 2) * 0.004));
    const cx = ox + (ix - iz) * tw;
    const cy = oy + (ix + iz) * th - y * lift;
    const r = Math.min(255, Math.round(rgb[0] * k)), g = Math.min(255, Math.round(rgb[1] * k)), b = Math.min(255, Math.round(rgb[2] * k));
    const hw = Math.max(0.7, tw), hh = Math.max(0.7, th);
    const y0 = Math.max(0, Math.floor(cy - hh)), y1 = Math.min(height - 1, Math.ceil(cy + hh));
    for (let py = y0; py <= y1; py++) {
      const t = Math.abs(py - cy) / hh;
      if (t > 1) continue;
      const half = hw * (1 - t);
      for (let px = Math.round(cx - half); px <= Math.round(cx + half); px++) set(px, py, r, g, b);
    }
  }
  return encodePng(width, height, rgba);
}

/* ---------------- 模型预览 ---------------- */

const hex2rgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * 给 VOXA 模型画一张预览图：纯黑底 + 等距体素，跟官方模型展厅一个口径。
 * 官方那张展厅里每张卡都是模型自己的 3D 渲染居中放在黑底上——那才是"预览"，
 * 一个写着文件名的灰框不是。颜色取模型自己的调色板，跟地图封面用方块图集一个道理：
 * 预览里的颜色是内容给的。
 */
export function renderModelPreview(doc, { width = 320, height = 320 } = {}) {
  const parts = (doc && doc.parts) || [];
  if (!parts.length) return null;
  const pal = new Map();
  for (const c of (doc.palette || [])) {
    const rgb = hex2rgb(c.hex);
    if (rgb) pal.set(String(c.i), rgb);
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = 8; rgba[i * 4 + 1] = 8; rgba[i * 4 + 2] = 9; rgba[i * 4 + 3] = 255; }
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    rgba[o] = r < 0 ? 0 : r > 255 ? 255 : r; rgba[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g; rgba[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b; rgba[o + 3] = 255;
  };
  // 顶面 / 两侧的明暗，和地图封面用同一套，让两种缩略图看起来是一个系统
  const TOP = 1.0, LEFT = 0.62, RIGHT = 0.82;

  // 先算出所有方块的世界格位置（部件的 pos/rot/scale 折叠进来），再定 scale 把整体居中
  const cubes = [];
  for (const p of parts) {
    if (p.visible === false) continue;
    const sz = p.size || [1, 1, 1];
    const pos = p.pos || [0, 0, 0];
    const rot = (p.rot || [0, 0, 0]).map((r) => (Number(r) || 0) * Math.PI / 180);
    const sc = p.scale || [1, 1, 1];
    // 绕 Y/X/Z 依次旋转（VOXA 的欧拉序），再缩放再平移
    const rotPt = (v) => {
      let [x, y, z] = v;
      let c = Math.cos(rot[0]), s = Math.sin(rot[0]);
      let y1 = y * c - z * s, z1 = y * s + z * c; y = y1; z = z1;
      c = Math.cos(rot[1]); s = Math.sin(rot[1]);
      let x1 = x * c + z * s, z2 = -x * s + z * c; x = x1; z = z2;
      c = Math.cos(rot[2]); s = Math.sin(rot[2]);
      x1 = x * c - y * s; y1 = x * s + y * c; x = x1; y = y1;
      return [x * (sc[0] ?? 1), y * (sc[1] ?? 1), z * (sc[2] ?? 1)];
    };
    const pivot = [sz[0] / 2, sz[1] / 2, sz[2] / 2];
    for (const v of p.voxels || []) {
      const rgb = pal.get(String(v.c)) || [190, 190, 195];
      const local = [v.x - pivot[0] + 0.5, v.y - pivot[1] + 0.5, v.z - pivot[2] + 0.5];
      const w = rotPt(local);
      cubes.push({ x: w[0] + pos[0], y: w[1] + pos[1], z: w[2] + pos[2], rgb });
    }
  }
  if (!cubes.length) return null;

  const HW = 0.5, HH = 0.25, VH = 0.55;   // 半宽 / 半高 / 立面高（像素单位，乘 tw）
  // 先把每个方块在等距投影下的包围盒算出来，得到真正的二维范围；
  // 直接拿体素跨度去估缩放，斜投影下会算出一个比模型大一圈的框，图就顶满画布。
  const proj = (x, y, z) => [(x - z) * HW, (x + z) * HH - y * VH];
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
  for (const c of cubes) {
    for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
      const [px, py] = proj(c.x + dx, c.y + dy, c.z + dz);
      if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
      if (py < by0) by0 = py; if (py > by1) by1 = py;
    }
  }
  const pw = Math.max(0.001, bx1 - bx0), ph = Math.max(0.001, by1 - by0);
  const pad = 0.86;                          // 留白占的比例：图是展品，四周要空一点
  const tw = Math.min(width / pw, height / ph) * pad;
  const ox = width / 2 - ((bx0 + bx1) / 2) * tw;
  const oy = height / 2 - ((by0 + by1) / 2) * tw;

  const cubesSorted = cubes.slice().sort((a, b) => (a.x + a.z + a.y) - (b.x + b.z + b.y));
  for (const c of cubesSorted) {
    const [pcx, pcy] = proj(c.x + 0.5, c.y, c.z + 0.5);
    const sx = ox + pcx * tw;
    const sy = oy + pcy * tw;
    const r = c.rgb[0], g = c.rgb[1], b = c.rgb[2];
    const hw = HW * tw, hh = HH * tw;
    // 顶面菱形
    for (let y = Math.max(0, Math.floor(sy - hh)); y <= Math.min(height - 1, Math.ceil(sy + hh)); y++) {
      const t = hh > 0 ? Math.abs(y - sy) / hh : 0;
      if (t > 1) continue;
      const half = hw * (1 - t);
      for (let x = Math.round(sx - half); x <= Math.round(sx + half); x++) set(x, y, r * TOP, g * TOP, b * TOP);
    }
    // 两侧立面（让立方体有厚度，不是薄片）
    const vh = Math.max(2, VH * tw);
    for (let y = Math.max(0, Math.round(sy)); y <= Math.min(height - 1, Math.round(sy + vh)); y++) {
      const k = 1 - Math.min(1, Math.abs(y - sy) / (hh || 1)) * 0.0;
      const half = hw * k;
      for (let x = Math.round(sx - half); x <= Math.round(sx); x++) set(x, y, r * LEFT, g * LEFT, b * LEFT);
      for (let x = Math.round(sx); x <= Math.round(sx + half); x++) set(x, y, r * RIGHT, g * RIGHT, b * RIGHT);
    }
  }
  return encodePng(width, height, rgba);
}
