import { raycastVoxelWorld } from "../public/js/voxel-raycast.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + extra : "")); }
};
const worldOf = (cells, shape = [16, 16, 16]) => {
  const map = new Map(cells.map(([x, y, z, id]) => [x + y * shape[0] + z * shape[0] * shape[1], id]));
  return { shape, get: (x, y, z) => x < 0 || y < 0 || z < 0 || x >= shape[0] || y >= shape[1] || z >= shape[2] ? 0 : map.get(x + y * shape[0] + z * shape[0] * shape[1]) || 0 };
};

{
  const w = worldOf([[5, 0, 0, 1]]);
  const h = raycastVoxelWorld(w, () => ({}), { x: -1, y: .5, z: .5 }, { x: 1, y: 0, z: 0 });
  ok("+X 命中格与相邻格正确", h && h.x === 5 && h.ax === 4 && h.nx === -1 && Math.abs(h.point[0] - 5) < 1e-6, JSON.stringify(h));
  const h2 = raycastVoxelWorld(w, () => ({}), { x: 10, y: .5, z: .5 }, { x: -1, y: 0, z: 0 });
  ok("-X 命中法线反向", h2 && h2.x === 5 && h2.ax === 6 && h2.nx === 1, JSON.stringify(h2));
}
{
  const w = worldOf([[3, 3, 3, 2], [6, 3, 3, 1]]);
  const h = raycastVoxelWorld(w, (id) => ({ pickable: id !== 2 }), { x: -1, y: 3.5, z: 3.5 }, { x: 1, y: 0, z: 0 });
  ok("不可拾取 barrier 会跳到后方实体", h && h.x === 6, JSON.stringify(h));
}
{
  const w = worldOf([[2, 2, 2, 3]]);
  const h = raycastVoxelWorld(w, () => ({ pickable: true }), { x: -1, y: 2.5, z: 2.5 }, { x: 1, y: 0, z: 0 });
  ok("水/透明方块仍可拾取", h && h.x === 2 && h.y === 2 && h.z === 2, JSON.stringify(h));
  const miss = raycastVoxelWorld(w, () => ({}), { x: -1, y: 8.5, z: 8.5 }, { x: 1, y: 0, z: 0 });
  ok("未命中返回 null", miss === null);
}
{
  let seed = 123456789;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cells = [];
  for (let i = 0; i < 120; i++) cells.push([1 + (rnd() * 14) | 0, 1 + (rnd() * 14) | 0, 1 + (rnd() * 14) | 0, 1]);
  const w = worldOf(cells);
  let same = 0;
  for (let i = 0; i < 200; i++) {
    const o = { x: -2 + rnd() * 20, y: -2 + rnd() * 20, z: -2 + rnd() * 20 };
    const d = { x: rnd() * 2 - 1, y: rnd() * 2 - 1, z: rnd() * 2 - 1 };
    const len = Math.hypot(d.x, d.y, d.z) || 1; d.x /= len; d.y /= len; d.z /= len;
    const h = raycastVoxelWorld(w, () => ({}), o, d);
    let brute = null;
    for (let t = .01; t < 40; t += .01) {
      const x = Math.floor(o.x + d.x * t), y = Math.floor(o.y + d.y * t), z = Math.floor(o.z + d.z * t);
      if (w.get(x, y, z)) { brute = [x, y, z]; break; }
    }
    if ((!h && !brute) || (h && brute && h.x === brute[0] && h.y === brute[1] && h.z === brute[2])) same++;
  }
  ok("随机射线与密集采样对拍 200/200", same === 200, `${same}/200`);
}

console.log(`\nvoxel-raycast: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
