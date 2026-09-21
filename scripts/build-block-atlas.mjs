#!/usr/bin/env node
/**
 * build-block-atlas.mjs
 * 构建期将 box3lab/Box3Blocks-unityPackage 的方块 ID 主表 (block-id.json)、
 * 渲染规则 (block-spec.json) 与 2000+ 张 16×16 真实贴图合成为 Web 端可用的图集：
 *   - public/data/block-atlas.png   RGBA 图集（每瓦片 16px + 1px 重复描边防漏色）
 *   - public/data/block-atlas.json  瓦片索引 + 每个方块的面/物理属性
 *   - public/data/thumbnails/*.png  每个方块的等距三视缩略图（方块库 UI 用）
 *
 * 面序约定来自 Unity 侧验证：texture[6] = [left, right, bottom, top, front, back]。
 * 贴图解析采用多级回退：spec 精确基名 → 动画帧剥后缀 → 方块名前缀 + 面后缀 → 纯色占位。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "vendor/Box3Blocks-unityPackage/Editor/SourceAssets");
const OUT = path.join(ROOT, "public/data");

const TILE = 16;
const PAD = 1;
const CELL = TILE + PAD * 2; // 18
const SIDES = ["back", "bottom", "front", "left", "right", "top"];
const FACE_ORDER = ["left", "right", "bottom", "top", "front", "back"]; // spec texture[] 槽位含义

/* ---------------- PNG codec (pure node) ---------- */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 8, colorType = 6, idat = [];
  let plte = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("bit depth unsupported");
  const src = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error("colorType unsupported");
  const bpp = ch, stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = src[p++];
    const line = Buffer.from(src.subarray(p, p + stride)); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      line[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, al = 255;
      if (colorType === 6) { r = line[x * 4]; g = line[x * 4 + 1]; b = line[x * 4 + 2]; al = line[x * 4 + 3]; }
      else if (colorType === 2) { r = line[x * 3]; g = line[x * 3 + 1]; b = line[x * 3 + 2]; if (trns && r === trns[0] && g === trns[1] && b === trns[2]) al = 0; }
      else if (colorType === 0) { r = g = b = line[x]; if (trns) al = line[x] === trns[0] ? 0 : 255; }
      else if (colorType === 4) { r = g = b = line[x * 2]; al = line[x * 2 + 1]; }
      if (plte) { const idx = (colorType === 0 || colorType === 4) ? line[x * (colorType === 4 ? 2 : 1)] : line[x]; r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]; al = trns && trns[idx] !== undefined ? trns[idx] : 255; }
      const o = (y * width + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = al;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/* ------------------------------ asset scanning ----------------------------- */
// 两张小表随仓库分发在 data/upstream/；纹理仍只存在于本地 vendor/ 克隆里（200MB+，不再分发）
const UP = path.join(ROOT, "data/upstream");
const table = (f) => [path.join(UP, f), path.join(SRC, f)].find((p) => fs.existsSync(p)) || path.join(SRC, f);
const spec = JSON.parse(fs.readFileSync(table("block-spec.json"), "utf8"));
const ids = JSON.parse(fs.readFileSync(table("block-id.json"), "utf8"));
// 官方简体中文方块名（Editor/I18n/block-names.zh-CN.json，键形如 block.box3.grass）
const zhNames = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(SRC, "..", "I18n", "block-names.zh-CN.json"), "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const m = /^block\.box3\.(.+)$/.exec(k);
      if (m) out[m[1]] = v;
    }
    return out;
  } catch { return {}; }
})();
// 官方 I18n 表未覆盖的方块（果汁/实验室件/水等）用英文名直译补齐，标在 zhSrc 以便区分
const zhSupplemented = new Set();
const ZH_SUPPLEMENT = {
  water: "水", milk: "牛奶", coffee: "咖啡", soy_sauce: "酱油",
  blueberry_juice: "蓝莓汁", grape_juice: "葡萄汁", lemon_juice: "柠檬汁", lime_juice: "青柠汁",
  orange_juice: "橙汁", peach_juice: "桃子汁", strawberry_juice: "草莓汁",
  greenbelt_L: "绿化带 L", greenbelt_L1: "绿化带 L1", lab_screen: "实验室屏幕", lab_wire: "实验室线路",
  ...Object.fromEntries([1, 2, 3].map((i) => [`lab_lamp_0${i}`, `实验室灯0${i}`])),
  ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`lab_material_${String(i + 1).padStart(2, "0")}`, `实验室材料${String(i + 1).padStart(2, "0")}`])),
};
for (const [k, v] of Object.entries(ZH_SUPPLEMENT)) if (!zhNames[k]) { zhNames[k] = v; zhSupplemented.add(k); }
const idByNum = {};
for (const [num, name] of Object.entries(ids)) idByNum[Number(num)] = name;
const numByName = {};
for (const [num, name] of Object.entries(ids)) numByName[name] = Number(num);

const blockDir = path.join(SRC, "block");
const filesIndex = new Map(); // lowercase basename(no ext) -> abs path
const stemSides = new Map();  // stem -> Map(side -> actualBase)
for (const f of fs.readdirSync(blockDir)) {
  if (!f.toLowerCase().endsWith(".png") || f.toLowerCase().endsWith(".mcmeta")) continue;
  const base = f.toLowerCase().replace(/\.png$/, "");
  filesIndex.set(base, path.join(blockDir, f));
  const m = base.match(/^(.*)_([a-z]+)$/);
  if (m && SIDES.includes(m[2])) {
    if (!stemSides.has(m[1])) stemSides.set(m[1], new Map());
    stemSides.get(m[1]).set(m[2], base);
  }
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const normStem = new Map(); // norm(stem) -> stem
for (const stem of stemSides.keys()) {
  const n = norm(stem);
  if (!normStem.has(n) || stem.length < normStem.get(n).length) normStem.set(n, stem);
}

function findStemFor(blockName, specStem) {
  const cands = [];
  if (specStem) {
    if (stemSides.has(specStem)) return specStem;
    const ns = normStem.get(norm(specStem));
    if (ns) return ns;
    cands.push(norm(specStem));
  }
  if (blockName) {
    if (stemSides.has(blockName)) return blockName;
    const nb = normStem.get(norm(blockName));
    if (nb) return nb;
    cands.push(norm(blockName));
  }
  for (const c of cands.filter(Boolean).sort((a, b) => a.length - b.length)) {
    let best = null;
    for (const [n, stem] of normStem) {
      if (n.startsWith(c)) { if (!best || stem.length < best.length) best = stem; }
    }
    if (best) return best;
  }
  return null;
}

function parseSide(s) { const m = s.match(/_([a-z]+)$/); return m && SIDES.includes(m[1]) ? m[1] : null; }

// 解析一个 spec 纹理路径到实体文件基名；slot 为面槽位(0..5)，用于回退
function resolvePath(rawPath, blockName, slot) {
  const base = rawPath.toLowerCase().split("/").pop();
  if (filesIndex.has(base)) return base;
  let candidate = base;
  const frameM = candidate.match(/^(.*?)_?([0-9]+)f$/); // fan_left_1f / conveyor_belt_top1f / lava_01_side1f
  if (frameM) {
    const stripped = frameM[1]; // fan_left / conveyor_belt_top / lava_01_side
    if (filesIndex.has(stripped)) return stripped;
    const side = parseSide(stripped);
    if (side && side !== "side") {
      const stem = stripped.slice(0, stripped.length - side.length - 1);
      const fs2 = findStemFor(blockName, stem);
      if (fs2) { const hit = stemSides.get(fs2).get(side); if (hit) return hit; }
    }
  }
  const side0 = parseSide(candidate);
  if (side0) {
    const stem = candidate.slice(0, candidate.length - side0.length - 1);
    const fs2 = findStemFor(blockName, stem);
    if (fs2) { const hit = stemSides.get(fs2).get(side0); if (hit) return hit; }
  }
  // 方块名 + 槽位面回退（board0 / greenbelt_L / fan 等 spec 路径不可靠的场合）
  const slotSide = FACE_ORDER[slot];
  const direct = `${blockName.toLowerCase()}_${slotSide}`;
  if (filesIndex.has(direct)) return direct;
  const fs3 = findStemFor(blockName, null);
  if (fs3) { const hit = stemSides.get(fs3).get(slotSide); if (hit) return hit; }
  if (blockName && blockName !== "air") {
    const nb = norm(blockName);
    for (const [n, stem] of normStem) {
      if (n.startsWith(nb) && stemSides.get(stem).has(slotSide)) return stemSides.get(stem).get(slotSide);
    }
  }
  return null;
}

const texCache = new Map();
const imgSizeCache = new Map();
function imgSize(key) { // key 可能是 "base#fN"（序列帧切分后的合成键）
  const base = key.split("#")[0];
  if (imgSizeCache.has(base)) return imgSizeCache.get(base);
  const abs = filesIndex.get(base);
  const sz = abs ? (() => { const i = decodePNG(fs.readFileSync(abs)); return { w: i.width, h: i.height, abs }; })() : null;
  imgSizeCache.set(base, sz);
  return sz;
}
// 官方序列帧贴图：竖排 16×(16*n)。返回帧数（非序列帧为 1）
function stripFrames(key) {
  const sz = imgSize(key);
  if (!sz || sz.w !== TILE || sz.h <= TILE) return 1;
  return sz.h % TILE === 0 ? sz.h / TILE : 1;
}
// .png.mcmeta 里的 frametime（Unity 侧语义：frametime * 0.05 秒/帧）
function frameDuration(key) {
  const sz = imgSize(key);
  try {
    const meta = JSON.parse(fs.readFileSync(sz.abs + ".mcmeta", "utf8"));
    const ft = meta?.animation?.frametime ?? 4;
    return Math.round(ft * 50); // 毫秒
  } catch { return 200; }
}
function solidTile(r, g, b, a) {
  const d = Buffer.alloc(TILE * TILE * 4);
  for (let i = 0; i < TILE * TILE; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a; }
  return d;
}
function loadTile(key) {
  if (texCache.has(key)) return texCache.get(key);
  const hash = key.indexOf("#");
  const base = hash < 0 ? key : key.slice(0, hash);
  const frame = hash < 0 ? 0 : Number(key.slice(hash + 2));
  const abs = filesIndex.get(base);
  if (!abs) return null;
  const img = decodePNG(fs.readFileSync(abs));
  let data = img.data;
  const bandTop = frame * TILE;
  const sameSize = img.width === TILE && img.height === TILE && frame === 0;
  if (!sameSize) {
    data = Buffer.alloc(TILE * TILE * 4);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const sy = Math.min(img.height - 1, bandTop + y);
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / TILE));
      img.data.copy(data, (y * TILE + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  texCache.set(key, data);
  return data;
}
// 注册一个面键；竖排序列帧会被拆成 base, base#f1, ... 独立瓦片
function registerFace(key) {
  if (!key || key === "air") return { frames: [], duration: 0 };
  ensure(key, null);
  const n = stripFrames(key);
  const frames = [key];
  for (let i = 1; i < n; i++) { const k = `${key}#f${i}`; needed.set(k, null); frames.push(k); }
  return { frames, duration: n > 1 ? frameDuration(key) : 0 };
}

/* 预解析所有方块面 */
const needed = new Map(); // key -> placeholder info(null) or {color}
function ensure(key, color) {
  if (key === null) return null;
  if (!needed.has(key)) needed.set(key, color ?? null);
  return key;
}

const blockList = [];
function placeholderFace(name, slot, rawColor) {
  const k = `__ph_${name}_${slot}`;
  if (!needed.has(k)) needed.set(k, { r: Math.round(rawColor[0] * 255), g: Math.round(rawColor[1] * 255), b: Math.round(rawColor[2] * 255), a: Math.round((rawColor[3] ?? 1) * 255) });
  return k;
}
for (const [name, s] of Object.entries(spec)) {
  if (name === "air") continue;
  const faces = [], anim = [];
  const rawColor = s.color || [1, 1, 1, 1];
  for (let i = 0; i < 6; i++) {
    const t = (s.texture || [])[i];
    let seq = [];
    if (Array.isArray(t)) {
      for (const fr of t) {
        const k = resolvePath(fr, name, i);
        if (k && k !== "air" && !seq.includes(k)) seq.push(k);
      }
    } else {
      const k = t ? resolvePath(t, name, i) : null;
      if (k && k !== "air") seq.push(k);
    }
    if (!seq.length) { faces.push(placeholderFace(name, i, rawColor)); continue; }
    // spec 若给出多个不同文件则按声明取帧；否则展开竖排序列帧条带
    const frames = [];
    let duration = 0;
    for (const k of seq) {
      const r = registerFace(k);
      for (const f of r.frames) if (!frames.includes(f)) frames.push(f);
      if (r.duration) duration = r.duration;
    }
    faces.push(frames[0]);
    if (frames.length > 1) anim.push({ face: i, frames, duration: duration || 200 });
  }
  const thumb = [];
  for (const p of s.thumbnail || []) {
    const k = resolvePath(Array.isArray(p) ? p[0] : p, name, 3);
    if (k) thumb.push(k);
  }
  blockList.push({
    name, id: numByName[name] ?? s.id ?? -1,
    zh: zhNames[name] || name,
    category: s.category || "other", type: s.type || "unknown",
    transparent: !!s.transparent,
    emissive: Array.isArray(s.emissive) ? s.emissive : [0, 0, 0],
    color: rawColor,
    mass: s.mass ?? 1, friction: s.friction ?? 0.6, restitution: s.restitution ?? 0,
    soundGroup: s.soundGroup || "default",
    // 官方 block-spec 的运行期字段：velocity 驱动弹跳垫/传送带，fluid 驱动游泳与流体接触
    velocity: Array.isArray(s.velocity) ? s.velocity : null,
    fluid: !!s.fluid,
    fluidColor: Array.isArray(s.fluidColor) ? s.fluidColor : null,
    fluidExtinction: s.fluidExtinction ?? null,
    strength: s.strength || null,
    faces, anim,
  });
}

/* ------------------------------- 打包图集 --------------------------------- */
const packOrder = [...needed.keys()].sort();
const cellsPerRow = Math.ceil(Math.sqrt(packOrder.length));
const atlasW = cellsPerRow * CELL, atlasH = atlasW;
const atlas = Buffer.alloc(atlasW * atlasH * 4);
for (const [i, key] of packOrder.entries()) {
  const px = (i % cellsPerRow) * CELL, py = Math.floor(i / cellsPerRow) * CELL;
  const ph = needed.get(key);
  let src = ph ? solidTile(ph.r, ph.g, ph.b, ph.a) : loadTile(key);
  if (!src) src = solidTile(200, 60, 60, 255); // 理论不可达
  for (let y = -PAD; y < TILE + PAD; y++) for (let x = -PAD; x < TILE + PAD; x++) {
    const sx = Math.min(TILE - 1, Math.max(0, x)), sy = Math.min(TILE - 1, Math.max(0, y));
    src.copy(atlas, ((py + y + PAD) * atlasW + (px + x + PAD)) * 4, (sy * TILE + sx) * 4, (sy * TILE + sx) * 4 + 4);
  }
}
const tileIndex = new Map(packOrder.map((k, i) => [k, i]));
for (const b of blockList) {
  b.faces = b.faces.map((f) => (f === null || f === undefined ? -1 : tileIndex.get(f) ?? -1));
  b.anim = b.anim.map((a) => ({ face: a.face, duration: a.duration, frames: a.frames.map((f) => tileIndex.get(f)).filter((x) => x !== undefined) }));
}

/* ------------------------------ 缩略图 ------------------------------------ */
const TH = 48;
function renderThumb(b) {
  const out = Buffer.alloc(TH * TH * 4);
  const tileAt = (idx) => { const k = packOrder[idx]; const ph = k ? needed.get(k) : null; return ph ? solidTile(ph.r, ph.g, ph.b, ph.a) : loadTile(k); };
  const t = tileAt(b.faces[3]) || tileAt(b.faces[0]);
  const l = tileAt(b.faces[0]);
  const r = tileAt(b.faces[1]);
  const glow = b.emissive.reduce((a, x) => a + x, 0) > 0.05;
  const put = (px, py, so, shade) => {
    if (px < 0 || py < 0 || px >= TH || py >= TH) return;
    const o = (py * TH + px) * 4;
    out[o] = Math.min(255, so[0] * shade) | 0; out[o + 1] = Math.min(255, so[1] * shade) | 0;
    out[o + 2] = Math.min(255, so[2] * shade) | 0; out[o + 3] = so[3];
  };
  const face = (tex, ox, oy, ux, uy, vx, vy, shade) => {
    if (!tex) return;
    for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) {
      const x0 = ox + u * ux + v * vx, y0 = oy + u * uy + v * vy;
      const so = (v * TILE + u) * 4;
      for (const [px, py] of [[Math.round(x0), Math.round(y0)], [Math.round(x0 + 1), Math.round(y0)], [Math.round(x0), Math.round(y0 + 1)], [Math.round(x0 + 1), Math.round(y0 + 1)]])
        put(px, py, tex.subarray(so, so + 4), shade);
    }
  };
  const S = 1; // 24px 每面
  const g = glow ? 1.25 : 1;
  const cap = (x) => Math.min(255, Math.round(x * g));
  face(t, 12, 2, 1.125 * S, 0.5625 * S, -1.125 * S, 0.5625 * S, 1);
  face(l, 0, 11, 1.125 * S, 0.5625 * S, 0, 1.2 * S, 0.72);
  face(r, 12, 17.5, 1.125 * S, -0.5625 * S, 0, 1.2 * S, 0.86);
  return out;
}
const thumbDir = path.join(OUT, "thumbnails");
fs.rmSync(thumbDir, { recursive: true, force: true });
fs.mkdirSync(thumbDir, { recursive: true });
for (const b of blockList) {
  const px = renderThumb(b);
  fs.writeFileSync(path.join(thumbDir, `${b.name}.png`), encodePNG(TH, TH, px));
}

/* -------------------------------- output ---------------------------------- */
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "block-atlas.png"), encodePNG(atlasW, atlasH, atlas));

const json = {
  tileSize: TILE, cellSize: CELL, pad: PAD, atlasWidth: atlasW, cellsPerRow,
  faceOrder: FACE_ORDER,
  threeSlotToFace: [1, 0, 3, 2, 4, 5],
  tiles: packOrder,
  blocks: blockList,
  idByNum, numByName,
  categories: [...new Set(blockList.map((b) => b.category))].sort(),
};
// 补全运行时快速查找映射（避免遍历 blocks）
const idMap = new Map();
for (const b of blockList) idMap.set(b.id, b);
json.idMap = Object.fromEntries([...idMap.entries()].map(([k, v]) => [k, v.name]));
json.byId = Object.fromEntries([...idMap.entries()].map(([k, v]) => [k, v]));
fs.writeFileSync(path.join(OUT, "block-atlas.json"), JSON.stringify(json));

const placeholderTiles = packOrder.filter((k) => k.startsWith("__ph_")).length;
console.log(JSON.stringify({
  blocks: blockList.length, tiles: packOrder.length, placeholderTiles,
  atlas: `${atlasW}x${atlasH}`, thumbnails: blockList.length,
}));
