// vb.js — 官方 .vb 体素模型（VOXA 工程文件）解码。
//
// .vb 不是二进制，是一段 JSON：
//   { HEXCOLORS: 4 条调色板 × 256 项 "#RRGGBB",
//     PBRATTRBS: 4 组 × 256 个 [a,b,c],
//     TR: 编辑期变换, CURRENTCOLORINDEX: 当前调色板序号,
//     ENCODEVOXELS: 字节数组 }
//
// ENCODEVOXELS 的布局（对着四个真实样本反推，尺寸从 1×32×1 到 126×127×126 都精确闭合）：
//   头 12 字节 = int32LE nx, ny, nz（体素网格尺寸）
//   之后是 (游程, 色号) 交替的 LEB128 varint 流，**游程是 0 基的**（读到的值 +1 才是格数），
//   色号 0 = 空。整条流按 2 的幂补零到固定长度，所以不能靠"遇到 0 就停"判断结束，
//   只能靠累计格数等于 nx*ny*nz 收尾。
//   线性下标 x 最快：i = x + nx*(y + ny*z)。
//
// 官方渲染时把这条轴序绕 X 转了 90°（体素的 +Z 变成世界的上方），
// 不转的话模型会躺着显示。见 toDisplay()。

const EMPTY = 0;

/** 读一条 LEB128 varint；越界或未正常结束返回 null。 */
function readVarint(bytes, at) {
  let shift = 0, val = 0, i = at.p;
  for (; i < bytes.length && shift <= 28; i += 7, shift += 7) {
    const b = bytes[i];
    val += (b & 0x7f) * Math.pow(2, shift);   // 用乘法而不是 <<，避免 32 位溢出
    i++;
    if (!(b & 0x80)) { at.p = i; return val; }
  }
  at.p = bytes.length + 1;
  return null;
}

/**
 * 解出稠密体素数组。返回 null 表示这不是一个能认的 .vb，
 * 调用方应当回退到"只登记名字"而不是抛异常——一张图里坏一个模型不该让整次导入失败。
 */
export function decodeVb(json) {
  const raw = json && json.ENCODEVOXELS;
  const bytes = raw instanceof Uint8Array ? raw : Array.isArray(raw) ? Uint8Array.from(raw, (v) => v & 0xff) : null;
  if (!bytes || bytes.length < 12) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getInt32(0, true), ny = dv.getInt32(4, true), nz = dv.getInt32(8, true);
  // 上限按 256³ 卡：官方 VOXA 单模型没这么大，超出基本说明头部读歪了
  if (!(nx > 0 && ny > 0 && nz > 0) || nx > 256 || ny > 256 || nz > 256) return null;
  const total = nx * ny * nz;
  const dense = new Uint8Array(total);
  const at = { p: 12 };
  let i = 0;
  while (i < total) {
    const run = readVarint(bytes, at);
    if (run === null) break;
    const color = readVarint(bytes, at);
    if (color === null) break;
    const len = run + 1;
    if (color !== EMPTY) dense.fill(Math.min(255, color), i, Math.min(total, i + len));
    i += len;
  }
  // 游程没铺满体积就说明流被截断（补零区不能当数据读），宁可退回不渲染
  if (i < total) return null;
  const palettes = Array.isArray(json.HEXCOLORS) ? json.HEXCOLORS : [];
  const idx = Math.max(0, Math.min(palettes.length - 1, Number(json.CURRENTCOLORINDEX) || 0));
  return { dims: [nx, ny, nz], dense, palette: palettes[idx] || palettes[0] || [] };
}

/**
 * 原始下标 → 显示坐标。**不做任何旋转**：raw y 就是上。
 *
 * 这条是拿官方自己的预览图对出来的，不是推的：
 * 「线.vb」尺寸 1×32×1，官方预览里是一条**竖直**的线 → 长的这一维（raw y）就是高度。
 * 而「陨星剑」6×12×59、「MGL榴弹发射器」40×40×90 的预览都是横躺着的，
 * 长边（raw z）指向水平方向 —— 两件事只有"raw y 向上、不转"能同时解释。
 * （社区实现里有一版绕 X 转了 90°，那会把武器立起来、把线放倒，两头都错。）
 */
export function toDisplay(dims, i) {
  const [nx, ny, nz] = dims;
  const x = i % nx;
  const y = Math.floor(i / nx) % ny;
  const z = Math.floor(i / (nx * ny));
  return [x, y, z];
}

const hexToRgb01 = (h) => {
  if (typeof h !== "string") return null;
  const e = h.trim().replace(/^#/, "");
  if (e.length < 6) return null;
  return [parseInt(e.slice(0, 2), 16) / 255, parseInt(e.slice(2, 4), 16) / 255, parseInt(e.slice(4, 6), 16) / 255];
};

/**
 * 把 .vb 的色号映射到方块图集里**颜色最接近**的那个方块。
 *
 * 为什么不直接按序号取：图集顺序和 VOXA 调色板毫无关系，
 * 按序号取会把一座白雕像染成荧光绿。这里建一次 256 项的 LUT，
 * 之后每个体素只是查表。
 */
export function buildColorLut(palette, atlasBlocks) {
  const lut = new Int16Array(256).fill(-1);
  if (!atlasBlocks || !atlasBlocks.length) return lut;
  for (let v = 1; v < 256; v++) {
    const rgb = hexToRgb01(palette[v]);
    if (!rgb) continue;
    let best = -1, bestD = Infinity;
    for (let b = 0; b < atlasBlocks.length; b++) {
      const c = atlasBlocks[b] && atlasBlocks[b].color;
      if (!c || c.length < 3) continue;
      const dr = rgb[0] - c[0], dg = rgb[1] - c[1], db = rgb[2] - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = b; }
    }
    lut[v] = best;
  }
  return lut;
}

/**
 * .vb → 现有体素管线能吃的列表。
 *
 * 返回项是 [x, z, yDown, pal]，与 voxListToModel 的入参形状一致
 * （它按 MagicaVoxel 的 XYZI 约定处理：第三个分量是"离顶多高"）。
 * pal 已经换算成"图集第 N 个方块 + 1"，所以坏色号会自动退到兜底方块。
 */
export function vbToVoxList(json, atlasBlocks) {
  const dec = decodeVb(json);
  if (!dec) return null;
  const { dims, dense, palette } = dec;
  const lut = buildColorLut(palette, atlasBlocks || []);
  const [nx, ny, nz] = dims;
  const out = [];
  for (let i = 0; i < dense.length; i++) {
    const v = dense[i];
    if (!v) continue;
    const [dx, dy, dz] = toDisplay(dims, i);
    const blockIdx = lut[v] >= 0 ? lut[v] : 0;
    // voxListToModel 的入参是 MagicaVoxel 约定：[x, z, 离顶多高]，所以 y 要翻过来
    out.push([dx, dz, (ny - 1) - dy, blockIdx + 1]);
  }
  return { voxels: out, dims: [nx, ny, nz], solid: out.length };
}
