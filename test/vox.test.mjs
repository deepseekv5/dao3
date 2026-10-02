/**
 * test/vox.test.mjs — MagicaVoxel .vox 读写的回归。
 *
 * 为什么单独一份：.vox 的三条 bug 全是"看起来能用"的那种——
 * 自家导出自家能读，所以单测一直绿；但 XYZI 的体素数被当成第一条体素读了
 * （每条导入多一个假体素、包围盒被撑歪），RGBA 只在顶层找（规范文件里它在 MAIN 里面，
 * 于是所有模型导入进来都掉色），导出又不写 SIZE/RGBA（Magica 自己打不开）。
 * 这里把三种文件形状都造一遍：规范、自家旧版、round-trip。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VoxelWorld, encodeVox, decodeVox, readVox } from "../public/js/world.js";
import { newDoc, importVox, parseVoxPalette, stats } from "../public/js/voxa/model.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 260) : "")); }
};

const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return [...b]; };
const id4 = (s) => [...s].map((c) => c.charCodeAt(0));
/** 一个 chunk：body 是数组；children 传 true 时两个长度都写 0（规范里 MAIN 就是这样）。 */
const chunk = (name, body = [], { zeroLens = false } = {}) =>
  [...id4(name), ...u32(zeroLens ? 0 : body.length), ...u32(0), ...body];
const cat = (...parts) => Uint8Array.from(parts.flat());

/** 规范形状：VOX 头 + MAIN(0,0){ SIZE, XYZI(带计数), RGBA }，y 向上。 */
function specFile(voxels, size, palette) {
  const xyzi = [...u32(voxels.length)];
  for (const [x, y, z, p] of voxels) xyzi.push(x, y, z, p);
  const rgba = [];
  for (let i = 0; i < 256; i++) { const c = palette[i % palette.length]; rgba.push(c[0], c[1], c[2], c[3] ?? 255); }
  const body = [
    ...chunk("SIZE", [...u32(size[0]), ...u32(size[1]), ...u32(size[2])]),
    ...chunk("XYZI", xyzi),
    ...chunk("RGBA", rgba),
  ];
  return cat([...id4("VOX "), ...u32(150)], chunk("MAIN", body, { zeroLens: true }));
}
/** 自家旧导出形状：MAIN 的 childrenSize 被塞了 bodySize，没有 SIZE，y 是"从顶往下"。 */
function legacyFile(voxelsDown) {
  const xyzi = [...u32(voxelsDown.length)];
  for (const [x, z, yd, p] of voxelsDown) xyzi.push(x, z, yd, p);
  const inner = chunk("XYZI", xyzi);
  return cat([...id4("VOX "), ...u32(150)], [...id4("MAIN"), ...u32(0), ...u32(inner.length), ...inner]);
}

/* ---------- 1. 规范文件：体素数不多不少，y 被翻成内部口径 ---------- */
const vox = [];
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++)
  vox.push([x, y, z, (x + y + z) % 2 ? 1 : 2]);
const spec = specFile(vox, [4, 4, 4], [[240, 60, 60, 255], [40, 120, 240, 255]]);

const got = readVox(spec);
ok("规范文件读到全部体素（旧实现会多读一条假体素）", got.voxels.length === 64, got.voxels.length);
ok("XYZI 的计数字段没被当成体素", !got.voxels.some((v) => v[0] === 64 || v[3] === 0), JSON.stringify(got.voxels[0]));
ok("RGBA 在 MAIN 里面也能读到（旧实现只走顶层，永远掉色）", got.palette.length === 256, got.palette.length);
// 文件里 y=0 是底，内部 yDown 是"距顶"，所以底层的 yDown 应为 3
const bottom = got.voxels.filter((v) => v[2] === 3);
ok("文件 y 向上被翻成内部 yDown", bottom.length === 16 && got.voxels.every((v) => v[2] >= 0 && v[2] <= 3), bottom.length);

/* ---------- 2. 旧版自家文件：不能二次翻转 ---------- */
const legacy = legacyFile([[0, 0, 0, 1], [1, 1, 2, 1], [2, 2, 3, 2]]);
const lg = readVox(legacy);
ok("旧版文件（MAIN 长度不规范 / 无 SIZE）保持原 yDown", lg.voxels.length === 3 && lg.voxels[0][2] === 0 && lg.voxels[2][2] === 3, JSON.stringify(lg.voxels));
ok("旧版文件没有 RGBA 时不报错，只给空调色板", Array.isArray(lg.palette) && lg.palette.length === 0, JSON.stringify(lg.palette));

/* ---------- 3. round-trip：encode → read 位置必须一模一样 ---------- */
const w = new VoxelWorld([12, 9, 12]);
const marks = [[1, 0, 2], [3, 5, 4], [7, 8, 9], [2, 1, 10]];
for (const [x, y, z] of marks) w.set(x, y, z, 1);
const encoded = encodeVox(w, [1]);
const back = readVox(encoded);
ok("导出的文件带 SIZE（旧实现不写，Magica 与自家读取都失去参照）", Array.isArray(back.size) && back.size.length === 3, JSON.stringify(back.size));
// 体素列表是 [x, z, yDown]（本仓库口径）；导出按包围盒最小角归零，所以要加回 min
const gotSet = new Set(back.voxels.map((v) => `${v[0] + 1},${back.size[1] - 1 - v[2]},${v[1] + 2}`));   // 列表是 [x, z, yDown]
ok("round-trip 后体素位置不变（y 没被翻两次）", marks.every(([x, y, z]) => gotSet.has(`${x},${y},${z}`)), [...gotSet].join(" "));
ok("round-trip 体素数不变", back.voxels.length === marks.length, back.voxels.length);

/* ---------- 4. VOXA 导入路径：部件尺寸与颜色 ---------- */
const doc = newDoc("t");
const part = importVox(readVox(spec).voxels, parseVoxPalette(spec), doc, "magica");
ok("VOXA 导入得到部件", !!part && part.voxels.length === 64, part && part.voxels.length);
ok("部件包围盒贴合模型（旧实现被假体素撑成 65×4×4）", part && part.size.join("×") === "4×4×4", part && part.size.join("×"));
ok("导入保留多种颜色（旧实现只剩一个兜底色）", part && new Set(part.voxels.map((v) => v.c)).size === 2, part && new Set(part.voxels.map((v) => v.c)).size);
ok("stats 数得对", stats(doc).voxels === 64, JSON.stringify(stats(doc)));

/* ---------- 5. 仓库里真实存在的 .vox 全部要能读 ---------- */
const found = [];
const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".vox")) found.push(p); } };
walk(path.join(ROOT, "server/data/assets")); walk(path.join(ROOT, "public/assets"));
let thrown = 0, firstBad = "";
for (const f of found) {
  try {
    const r = readVox(new Uint8Array(fs.readFileSync(f)));
    if (!r.voxels.length) { thrown++; firstBad = firstBad || path.basename(f) + " 空体素"; }
    const mx = Math.max(...r.voxels.map((v) => v[0]));
    if (r.size && mx > r.size[0] - 1) { thrown++; firstBad = firstBad || `${path.basename(f)} x=${mx} 超出 SIZE ${r.size.join("×")}`; }
  } catch (e) { thrown++; firstBad = firstBad || path.basename(f) + " → " + e.message; }
}
ok(`仓库内 ${found.length} 个真实 .vox 全部可读且不越界`, thrown === 0, firstBad);

console.log(`\nvox: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
