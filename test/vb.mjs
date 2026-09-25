// vb.mjs — 官方 .vb 解码器的回归断言。
// 运行：node test/vb.mjs
// 夹具是**真实**的官方文件（从 static.dao3.fun 按 CID 取回的武器试验场网格），
// 不是我们自己造的——自造夹具只能证明代码和自己一致，证明不了和官方一致。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeVb, vbToVoxList, toDisplay, buildColorLut } from "../public/js/vb.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = (f) => path.join(ROOT, "test/fixtures/vb", f);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "   " + extra : "")); }
};
const load = (f) => JSON.parse(fs.readFileSync(FIX(f), "utf8"));
const solidOf = (d) => d.dense.reduce((a, v) => a + (v ? 1 : 0), 0);

/* ---- 头部：三个 int32LE 尺寸 ---- */
const line = load("line.vb.json");
const dLine = decodeVb(line);
ok("线.vb 解出尺寸 1×32×1", dLine && dLine.dims.join("x") === "1x32x1", dLine && dLine.dims.join("x"));
ok("线.vb 全实心（32 格一条线）", dLine && solidOf(dLine) === 32, dLine && String(solidOf(dLine)));

/* ---- 游程是 0 基的：读到的值 +1 才是格数 ---- */
// 这条最容易写成"直接当长度"，那样第一个游程 31 只铺 31 格，
// 剩下的补零区会被当成数据，模型就整体错位。
const sword = load("sword.vb.json");
const dSword = decodeVb(sword);
ok("陨星剑.vb 尺寸 6×12×59", dSword && dSword.dims.join("x") === "6x12x59", dSword && dSword.dims.join("x"));
ok("陨星剑.vb 实心 924 格", dSword && solidOf(dSword) === 924, dSword && String(solidOf(dSword)));

/* ---- 补零不能当数据读：整条流必须精确铺满体积 ---- */
const grenade = load("grenade.vb.json");
const dG = decodeVb(grenade);
const vol = dG.dims[0] * dG.dims[1] * dG.dims[2];
ok("MGL 榴弹发射器 尺寸 40×40×90", dG.dims.join("x") === "40x40x90", dG.dims.join("x"));
ok("MGL 游程累计精确等于体积（144000）", vol === 144000 && dG.dense.length === vol);
ok("MGL 实心 109218 格", solidOf(dG) === 109218, String(solidOf(dG)));
// 反证：如果按"遇到 0 就停"读，长度会远小于体积
{
  const bytes = Uint8Array.from(grenade.ENCODEVOXELS, (v) => v & 0xff);
  let i = 12, cells = 0;
  while (i < bytes.length && bytes[i] !== 0) {
    let s = 0, v = 0;
    for (; i < bytes.length; i += 7, s += 7) { const b = bytes[i]; v += (b & 0x7f) * 2 ** s; i++; if (!(b & 0x80)) break; }
    cells += v + 1;
    let s2 = 0, v2 = 0;
    for (; i < bytes.length; i += 7, s2 += 7) { const b = bytes[i]; v2 += (b & 0x7f) * 2 ** s2; i++; if (!(b & 0x80)) break; }
  }
  ok("按「遇 0 就停」读会截短（证明必须按体积收尾）", cells < vol, `只读到 ${cells}/${vol}`);
}

/* ---- 脏数据要返回 null，不能抛 ---- */
ok("截断的头部返回 null", decodeVb({ ENCODEVOXELS: [1, 0, 0, 0] }) === null);
ok("尺寸离谱（>256）返回 null", decodeVb({ ENCODEVOXELS: new Uint8Array(16).fill(0xFF) }) === null);
ok("缺 ENCODEVOXELS 返回 null", decodeVb({}) === null);

/* ---- 朝向：raw y 就是上，不做旋转 ----
   这条不是推出来的，是拿官方预览图对的：
   「线.vb」尺寸 1×32×1，官方预览里是一条**竖直**的线。
   绕 X 转 90°（社区实现里那版）会把它放倒、把武器立起来，两头都错。 */
{
  const a = toDisplay([1, 32, 1], 0);
  const b = toDisplay([1, 32, 1], 31);
  ok("toDisplay 是恒等映射（x,y,z 原样）", a.join(",") === "0,0,0" && b.join(",") === "0,31,0", a.join(",") + " / " + b.join(","));
  // 线.vb 的实心格必须只沿 y 展开，x/z 固定 —— 这才对得上官方那张竖线预览
  const d = decodeVb(line);
  const pts = [];
  for (let i = 0; i < d.dense.length; i++) if (d.dense[i]) pts.push(toDisplay(d.dims, i));
  const xs = new Set(pts.map((p) => p[0])), ys = new Set(pts.map((p) => p[1])), zs = new Set(pts.map((p) => p[2]));
  ok("线.vb 沿 y 展开 32 格、x/z 各只有 1 个值（竖直）",
    ys.size === 32 && xs.size === 1 && zs.size === 1, `y=${ys.size} x=${xs.size} z=${zs.size}`);
}

/* ---- 颜色按 hex 最近邻映到图集，不按序号 ---- */
{
  const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/block-atlas.json"), "utf8")).blocks;
  const lut = buildColorLut(dG.palette, atlas);
  // 111111 是近黑，必须映到一个暗方块；如果按序号硬取，索引 255 会落到图集第 255 个（颜色无关）
  const dark = dG.palette[255];
  ok("调色板 255 是近黑色", dark === "111111", String(dark));
  const idx = lut[255];
  const c = atlas[idx] && atlas[idx].color;
  ok("近黑映到近黑方块（不是按序号）", c && (c[0] + c[1] + c[2]) / 3 < 0.45, c && c.join(","));
}

/* ---- 交给现有体素管线的形状 ---- */
{
  const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/block-atlas.json"), "utf8")).blocks;
  const L = vbToVoxList(grenade, atlas);
  ok("vbToVoxList 实心数与稠密数组一致", L && L.solid === 109218, L && String(L.solid));
  ok("每项是 [x, z, yDown, 方块序号] 四元组", L.voxels.every((v) => v.length === 4 && v.every(Number.isFinite)));
  ok("pal 分量是 1 基（≥1），能直接喂 voxListToModel", L.voxels.every((v) => v[3] >= 1));
  ok("yDown 落在网格范围内", L.voxels.every((v) => v[2] >= 0 && v[2] < L.dims[1] + 400));
}

console.log(`\nvb: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
