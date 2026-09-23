// terrain.mjs — 程序化地形的不变量检查（纯 Node，不开浏览器）。
// 运行：node test/terrain.mjs
//
// 为什么值得单独一套：地形是"统计上正确"和"看起来对"最容易脱节的部分。
// 之前 plains 的 82% 地表被刷成沙子、islands 一滴水都没有，用肉眼看截图才发现，
// 而 cells 计数一直是"正常"的。所以这里断言的是**地表构成与水面比例**，不是格数。
import { VoxelWorld } from "../public/js/world.js";
import { generate, PRESETS, resolveBlocks } from "../public/js/terrain.js";

const B = resolveBlocks(null);
const NAME_OF = Object.fromEntries(Object.entries(B).map(([k, v]) => [v, k]));
const SHAPE = [100, 64, 100];   // 与编辑器「新建世界」的默认尺寸一致

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "   " + extra : ""));
  if (!cond) fails++;
};

function run(preset, seed, opts = {}, shape = SHAPE) {
  const w = new VoxelWorld(shape);
  const stats = generate(w, { preset, seed, blocks: B, ...opts });
  const surf = {};   // 每列最高非水方块的材料
  for (let x = 0; x < shape[0]; x++) {
    for (let z = 0; z < shape[2]; z++) {
      for (let y = shape[1] - 1; y >= 0; y--) {
        const id = w.get(x, y, z); if (!id || id === B.water) continue;
        const n = NAME_OF[id]; if (n) surf[n] = (surf[n] || 0) + 1; break;
      }
    }
  }
  const cols = shape[0] * shape[2];
  const pct = (n) => Math.round((surf[n] || 0) / cols * 100);
  return { w, stats, pct, cols };
}
// 4 邻域连通块（面积 > min 才算一座岛）
function landmasses(w, sea, min = 40) {
  const [X, Y, Z] = w.shape;
  const top = new Int32Array(X * Z).fill(-1);
  for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++)
    for (let y = Y - 1; y >= 0; y--) { const id = w.get(x, y, z); if (!id || id === B.water) continue; top[x * Z + z] = y; break; }
  const land = new Uint8Array(X * Z);
  for (let i = 0; i < X * Z; i++) land[i] = top[i] >= sea ? 1 : 0;
  const seen = new Uint8Array(X * Z); const sizes = [];
  for (let i = 0; i < X * Z; i++) {
    if (!land[i] || seen[i]) continue;
    seen[i] = 1; const st = [i]; let sz = 0;
    while (st.length) {
      const c = st.pop(); sz++; const cx = Math.floor(c / Z), cz = c % Z;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = cx + dx, zz = cz + dz;
        if (xx < 0 || zz < 0 || xx >= X || zz >= Z) continue;
        const j = xx * Z + zz;
        if (land[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
    }
    sizes.push(sz);
  }
  sizes.sort((a, b) => b - a);
  return { count: sizes.filter((x) => x > min).length, largest: sizes[0] || 0 };
}

console.log("== 确定性：同 seed 逐格一致，换 seed 必须变 ==");
for (const p of PRESETS) {
  const S = [40, 32, 40];
  const a = JSON.stringify(run(p.id, 1234, {}, S).w.toPayload());
  const b = JSON.stringify(run(p.id, 1234, {}, S).w.toPayload());
  const c = JSON.stringify(run(p.id, 4321, {}, S).w.toPayload());
  ok(`${p.id} 同 seed 可复现`, a === b);
  ok(`${p.id} 换 seed 会变`, a !== c);
}

console.log("== 只用图集里存在的方块（写错 id 会渲染成紫色缺失块） ==");
for (const p of PRESETS) {
  const { w } = run(p.id, 777, {}, [40, 32, 40]);
  const bad = new Set();
  for (const [, c] of w.map) if (!NAME_OF[c.id]) bad.add(c.id);
  ok(`${p.id} 无未知 id`, bad.size === 0, [...bad].slice(0, 5).join(","));
}

console.log("== 逐预设的地表构成 ==");
{
  const { pct, stats } = run("plains", 4242);
  ok("plains 以草地为主", pct("grass") + pct("leaf") >= 55, `草+叶 ${pct("grass") + pct("leaf")}%`);
  ok("plains 沙地不占多数", pct("sand") <= 35, `沙 ${pct("sand")}%`);
  ok("plains 有水面", stats.wetPct > 0 && stats.water > 0, `淹 ${stats.wetPct}%`);
}
{
  const { pct, stats } = run("hills", 4242);
  ok("hills 以草地为主", pct("grass") + pct("leaf") >= 60, `草+叶 ${pct("grass") + pct("leaf")}%`);
  ok("hills 起伏明显", stats.max - stats.min >= 12, `${stats.min}~${stats.max}`);
  ok("hills 有树", stats.trees > 20, `${stats.trees} 棵`);
}
{
  const r = run("islands", 4242);
  const { count, largest } = landmasses(r.w, r.stats.sea);
  ok("islands 大半是海", r.stats.wetPct >= 55, `淹 ${r.stats.wetPct}%`);
  ok("islands 有沙滩环", r.pct("sand") >= 20, `沙 ${r.pct("sand")}%`);
  // 分形噪声在 50% 阈值处必然渗流出一个贯穿全图的连通块，所以群岛得把陆地压到阈值以下。
  // 只断言"≥2 座"会放过"一块大陆 + 一个小礁石"这种不像群岛的结果，所以同时卡最大岛占比。
  ok("islands 真的散成岛链", count >= 6, `${count} 座`);
  ok("islands 没有贯穿全图的大陆", largest < r.cols * 0.35, `最大岛 ${(largest / r.cols * 100) | 0}% 全图`);
}
{
  const r = run("continent", 4242);
  const c = landmasses(r.w, r.stats.sea);
  ok("continent 四周沉入海中", r.stats.wetPct >= 15 && r.stats.wetPct <= 45, `淹 ${r.stats.wetPct}%`);
  ok("continent 是一整块陆地", c.count <= 3 && c.largest > r.cols * 0.3,
    `${c.count} 座，最大 ${(c.largest / r.cols * 100) | 0}%`);
  ok("continent 以草地为主", r.pct("grass") + r.pct("leaf") >= 50, `草+叶 ${r.pct("grass") + r.pct("leaf")}%`);
}
{
  const { pct, stats } = run("canyon", 4242);
  ok("canyon 以砖石为主", pct("brick") >= 70, `砖 ${pct("brick")}%`);
  ok("canyon 不长草", pct("grass") === 0, `草 ${pct("grass")}%`);
  ok("canyon 谷底有水", stats.wetPct > 0 && stats.wetPct < 15, `淹 ${stats.wetPct}%`);
}
{
  const { pct, stats } = run("dunes", 4242);
  ok("dunes 全是沙", pct("sand") >= 99, `沙 ${pct("sand")}%`);
  ok("dunes 无水", stats.water === 0 && stats.wetPct === 0);
}
{
  const { pct, stats } = run("peaks", 4242);
  ok("peaks 山顶有雪", pct("snow") >= 15, `雪 ${pct("snow")}%`);
  ok("peaks 最高", stats.max >= 45, `最高 ${stats.max}`);
}

console.log("== 水位滑杆说的是真话：目标占比与实际淹水比例同向且接近 ==");
for (const preset of ["plains", "hills", "peaks"]) {
  const a = run(preset, 5150, { flood: 0.05 }).stats.wetPct;
  const b = run(preset, 5150, { flood: 0.25 }).stats.wetPct;
  const c = run(preset, 5150, { flood: 0.55 }).stats.wetPct;
  ok(`${preset} 水位单调上升`, a <= b && b <= c && c > a, `${a}% → ${b}% → ${c}%`);
  ok(`${preset} 目标 55% 时误差 ≤ 12 格百分比`, Math.abs(c - 55) <= 12, `实际 ${c}%`);
}
{
  const zero = run("hills", 5150, { flood: 0 }).stats;
  ok("flood=0 一滴水都没有", zero.water === 0);
}

console.log("== 幅度滑杆：起伏越大，海拔区间越宽 ==");
{
  const lo = run("hills", 99, { amplitude: 0.4 }).stats;
  const hi = run("hills", 99, { amplitude: 2 }).stats;
  ok("amplitude 拉开海拔区间", (hi.max - hi.min) > (lo.max - lo.min),
    `${lo.max - lo.min} 格 → ${hi.max - hi.min} 格`);
}

console.log("== 不越界、不塌陷 ==");
for (const shape of [[16, 16, 16], [8, 8, 8], [128, 24, 64], [32, 96, 32]]) {
  for (const p of PRESETS) {
    const w = new VoxelWorld(shape);
    let bad = null, out = 0;
    try {
      generate(w, { preset: p.id, seed: 4, blocks: B });
      for (const k of w.map.keys()) { const [x, y, z] = w.unpack(k); if (!w.inBounds(x, y, z)) out++; }
    } catch (e) { bad = e.message; }
    ok(`${p.id} @ ${shape.join("×")} 正常`, !bad && out === 0, (bad || "") + (out ? ` 越界 ${out}` : ""));
  }
}

console.log(fails ? `\n${fails} 项未通过` : "\n全部通过");
process.exitCode = fails ? 1 : 0;
