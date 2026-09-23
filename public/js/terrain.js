// terrain.js — 程序化地形生成。
//
// 三条硬约束：
//   1. **确定性**：同一个 seed 必须给出逐格相同的地形。用整数哈希 + value noise，
//      不用 Math.random()，也不依赖任何外部资源——否则"重新生成一次"会得到另一张图，
//      存档与协作都没有意义。
//   2. **只用图集里真实存在的方块**：id 一律从 block-atlas 按名字查，查不到就退回
//      最接近的可用方块，而不是写一个凭空猜的数字（写错 id 会渲染成紫色缺失块）。
//   3. **不破坏已有内容**：生成前要求调用方确认；只写目标列，不清空实体/脚本/区域。
// 方块 id 一律**按名字**从图集查，查不到才退回下面这组实测过的数字。
// 不能在模块加载时解析：BlockAtlas 是异步 load 的，模块级求值会拿到空表，
// 于是所有地形都退成硬编码 id——换一份图集就悄悄全错，且不报错。
const BLOCK_NAMES = {
  grass: "grass", darkGrass: "dark_grass", dirt: "dirt", stone: "stone",
  sand: "sand", water: "water", snow: "snow", ice: "ice", wood: "wood",
  leaf: "green_leaf", brick: "grey_stone_brick",
};
// 来自 public/data/block-atlas.json 的实测 id（2026-09-24），仅作兜底
const BLOCK_FALLBACK = {
  grass: 127, darkGrass: 317, dirt: 125, stone: 129, sand: 135, water: 364,
  snow: 169, ice: 398, wood: 257, leaf: 131, brick: 149,
};
/** 把名字解析成数值 id。atlas 可缺省（跑测试时没有图集），那就直接用兜底表。 */
export function resolveBlocks(atlas) {
  const out = {};
  for (const [key, name] of Object.entries(BLOCK_NAMES)) {
    let idv = 0;
    if (atlas && typeof atlas.get === "function") { const b = atlas.get(name); if (b && b.id != null) idv = b.id; }
    out[key] = idv || BLOCK_FALLBACK[key] || 0;
  }
  return out;
}
export const BLOCKS = resolveBlocks(null);

/* ---------------- 确定性噪声 ---------------- */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/** 分形噪声：叠加倍频，振幅折半。返回 0..1 */
function fbm(x, y, seed, oct = 4, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 1301) * amp;
    norm += amp; amp *= gain; freq *= 2;
  }
  return sum / norm;
}
/** 脊状噪声：把 [0,1] 折成尖脊，用来做山脉与峡谷 */
function ridge(x, y, seed, oct = 4) { return 1 - Math.abs(fbm(x, y, seed, oct) * 2 - 1); }

/* ---------------- 预设 ---------------- */
// height() 只负责**形状**，不负责高度：generate() 会先把实测高度归一化成
// 0..1，再按 floor/relief 映射到世界高度。所以 height() 里的加性常数
// （0.30 + …*0.16 那种）只是让表达式好读，真正决定"这座山多高"的是 relief。
//
// 为什么必须归一化：归一化 fbm 是若干个均匀分布的加权和，取值死死挤在 0.5
// 附近。平原因此只落在 4 个整数层上（实测 98% 的列高 18~19 格），水位不管
// 怎么选都是"淹 0% 或淹 29%"，一滴水都出不来或者整片泡在水里。
//
// flood 是**水面以下占多少比例的地图**，也不是海平面的绝对高度，理由同上：
// 取实测分布的分位数之后，水位与噪声统计特性彻底解耦。
export const PRESETS = [
  {
    id: "plains", name: "平原", desc: "起伏很小，适合当建筑与玩法的底图",
    surface: "grass", subsurface: "dirt", deep: "stone", wet: "sand",
    floor: 0.16, relief: 0.30, flood: 0.10, trees: 0.012,
    height: (x, z, s) => fbm(x / 34, z / 34, s, 4) + fbm(x / 7, z / 7, s + 7, 2) * 0.2,
  },
  {
    id: "hills", name: "丘陵", desc: "连续缓坡与谷地，风景与跑图都合适",
    surface: "grass", subsurface: "dirt", deep: "stone", wet: "sand",
    floor: 0.05, relief: 0.72, flood: 0.12, trees: 0.03,
    height: (x, z, s) => fbm(x / 26, z / 26, s, 5),
  },
  {
    id: "islands", name: "群岛", desc: "海面散落的岛链，适合跑船与跳岛",
    surface: "grass", subsurface: "sand", deep: "stone", wet: "sand",
    floor: 0, relief: 1.0, flood: 0.68, trees: 0.02,
    // 频率 9 + 淹 68%：分形噪声的等值线在 50% 阈值处必然出现一个贯穿全图的连通块
    //（2D 渗流），所以"陆地过半"的群岛不管怎么调都是一块大陆带几个小岛。
    // 实测陆地比例压到 32%（渗流阈值以下）才真的散成 14~18 座岛、最大岛只占 8~13%。
    height: (x, z, s) => fbm(x / 9, z / 9, s, 5) * 1.25 - fbm(x / 6, z / 6, s + 733, 3) * 1.3,
  },
  {
    id: "continent", name: "大陆", desc: "一整块陆地，四周自动沉入海中",
    surface: "grass", subsurface: "dirt", deep: "stone", wet: "sand",
    floor: 0, relief: 1.0, flood: 0.26, trees: 0.02, falloff: true,
    height: (x, z, s) => fbm(x / 26, z / 26, s, 5) * 0.7 + fbm(x / 11, z / 11, s + 91, 4) * 0.3,
  },
  {
    id: "canyon", name: "峡谷", desc: "一条深切谷地，适合做赛道与关卡",
    surface: "brick", subsurface: "stone", deep: "stone", wet: "sand",
    floor: 0.08, relief: 0.85, flood: 0.05, trees: 0.004,
    height: (x, z, s) => {
      const r = ridge(x / 40, z / 40, s, 4);
      const cut = Math.exp(-Math.pow((z - (0.5 + (fbm(x / 60, 0, s + 3, 2) - 0.5) * 0.5)) * 9, 2));
      return r - cut * 0.7;
    },
  },
  {
    id: "dunes", name: "沙丘", desc: "干旱波状沙丘，无水",
    surface: "sand", subsurface: "sand", deep: "stone", wet: "sand",
    floor: 0.25, relief: 0.42, flood: 0, trees: 0,
    height: (x, z, s) => Math.abs(Math.sin(x / 9 + fbm(x / 30, z / 30, s, 3) * 3)) + fbm(x / 44, z / 44, s + 11, 4),
  },
  {
    id: "peaks", name: "雪山", desc: "高脊与冰川，顶部常年积雪",
    surface: "grass", subsurface: "stone", deep: "stone", wet: "sand",
    floor: 0, relief: 1.0, flood: 0.08, trees: 0.015, snowline: 0.70,
    height: (x, z, s) => Math.pow(ridge(x / 30, z / 30, s, 5), 1.35),
  },
];

export function presetById(pid) { return PRESETS.find((p) => p.id === pid) || PRESETS[0]; }

/**
 * 在既有 VoxelWorld 上生成地形。
 * @param world VoxelWorld（会被就地修改）
 * @param {{preset?:string, seed?:number, amplitude?:number, waterLevel?:number,
 *          flood?:number, clear?:boolean, trees?:boolean, y0?:number}} opts
 * @returns {{cells:number, water:number, min:number, max:number, sea:number, preset:string, seed:number}}
 */
export function generate(world, opts = {}) {
  const p = presetById(opts.preset);
  const seed = (opts.seed >>> 0) || 1;
  const [SX, SY, SZ] = world.shape;
  const amp = opts.amplitude == null ? 1 : Math.max(0.05, Math.min(3, opts.amplitude));
  const baseY = opts.y0 == null ? Math.max(1, Math.floor(SY * 0.18)) : opts.y0;
  const span = Math.max(8, Math.floor(SY * 0.55 * amp));
  const B = opts.blocks || resolveBlocks(opts.atlas);
  const put = (x, y, z, bid) => { if (!bid) return false; world.set(x, y, z, bid); return true; };
  // 预设里写的是**材料名**（"grass"/"stone"…），要过一遍 resolveBlocks 才是数值 id。
  // 直接 B[p.surface] 取到 undefined，put 会静默跳过——地表就整层空掉，
  // 而且 cells 计数照加，看起来"生成了 4 万格"其实一格没放。
  const MAT = { surface: B[p.surface] || B.grass, subsurface: B[p.subsurface] || B.dirt, deep: B[p.deep] || B.stone, wet: B[p.wet] || B.sand };

  if (opts.clear !== false) {
    // 只清"地形层"以上到顶，保留玩家可能放在高空的结构以下？——不行，语义不清。
    // 默认整世界清空体素（实体/脚本/区域/商品由调用方保留），因为"生成地形"
    // 意味着换一张底图；不清空会得到两层叠在一起的地形。
    for (const k of [...world.map.keys()]) world.map.delete(k);
  }

  let water = 0, min = 1e9, max = -1e9;
  // 第一遍：只求形状高度并记录实测极值（浮点，还没落到整数格）
  const raw = new Float32Array(SX * SZ);
  let hmin = Infinity, hmax = -Infinity;
  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      let h = p.height(x, z, seed);
      if (p.falloff) {
        // 岛屿：离中心越远越沉。**不能 clamp 到 0**——原来写成 max(0, 1-d²·1.05)，
        // 于是外圈 28% 的列全被钉在同一个最小值上，分位数水位在那个区间里推不动
        // （淹 2% 和淹 20% 得到同一张图），海床也只有一格深。留成负值才是一条
        // 向外下倾的海床，实测海沟从 2 格变 13 格。
        const dx = (x / SX - 0.5) * 2, dz = (z / SZ - 0.5) * 2;
        h *= 1 - (dx * dx + dz * dz) * 1.25;
      }
      raw[x * SZ + z] = h;
      if (h < hmin) hmin = h;
      if (h > hmax) hmax = h;
    }
  }
  // 第二遍：归一化 → floor/relief → 整数格高
  const heights = new Int32Array(SX * SZ);
  const rel = p.relief == null ? 1 : p.relief;
  const flr = p.floor == null ? 0 : p.floor;
  const norm = hmax - hmin > 1e-6 ? 1 / (hmax - hmin) : 0;
  for (let i = 0; i < raw.length; i++) {
    const t = (raw[i] - hmin) * norm;
    const top = Math.max(0, Math.min(SY - 1, baseY + Math.round((flr + t * rel) * span)));
    heights[i] = top;
    if (top < min) min = top;
    if (top > max) max = top;
  }
  // 海平面 = 实测高度的分位数，见 PRESETS 里 flood 的注释。
  let sea;
  if (opts.waterLevel != null) sea = opts.waterLevel;
  else {
    const flood = opts.flood == null ? p.flood : Math.max(0, Math.min(0.95, opts.flood));
    if (flood > 0) {
      const sorted = Int32Array.from(heights).sort();
      const k = Math.min(sorted.length - 1, Math.max(0, Math.round(flood * sorted.length)));
      const lo = sorted[k];
      // 同一个整数高度层可能一口气占 12% 的列，取 sorted[k]+1 会让"水面占比 10%"
      // 实测淹掉 21%（100×100 的平原就是这样）。把 lo 和 lo+1 两档的实际淹水比例都算出来，
      // 选更接近目标的那一档，滑杆报的数才是它承诺的数。
      let a = 0; while (a < sorted.length && sorted[a] < lo) a++;
      let b = a; while (b < sorted.length && sorted[b] === lo) b++;
      sea = Math.abs(a / sorted.length - flood) <= Math.abs(b / sorted.length - flood) ? lo : lo + 1;
      // 某个整数层占比超过目标淹水比例时，上两档会退化成 sea = min —— "群岛"能生成出
      // 一滴水都没有的平地。至少给一格水，让预设的名字不至于撒谎。
      if (sea <= min) sea = min + 1;
    } else sea = min;
  }
  // 沙滩只出现在**邻着水的**水线格上。原来按"高度 ≤ 海平面 + 1"整条刷，
  // 平原的高度分布是个尖峰（53% 的列落在同一格），于是离水塘很远的草地也被刷成沙，
  // 实测沙地占到 82%。用 8 邻域判定才是"滩涂"的本意：围着水塘一圈，其余是草。
  const nearWater = new Uint8Array(SX * SZ);
  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(SX - 1, x + 1);
      const z0 = Math.max(0, z - 1), z1 = Math.min(SZ - 1, z + 1);
      for (let xx = x0; xx <= x1 && !nearWater[x * SZ + z]; xx++)
        for (let zz = z0; zz <= z1; zz++) if (heights[xx * SZ + zz] < sea) { nearWater[x * SZ + z] = 1; break; }
    }
  }

  for (let x = 0; x < SX; x++) {
    for (let z = 0; z < SZ; z++) {
      const i = x * SZ + z;
      const top = heights[i];
      // 雪线按归一化高度判断，才与"山顶"这个语义一致（按绝对格高判断会随世界高度漂移）
      const snowy = p.snowline != null && (raw[i] - hmin) * norm >= p.snowline;
      const beach = top < sea || (top === sea && nearWater[i]);
      for (let y = 0; y <= Math.max(top, sea); y++) {
        if (y > top) { if (y <= sea && put(x, y, z, B.water)) water++; continue; }
        let bid;
        if (y === top) bid = beach ? MAT.wet : snowy ? B.snow : MAT.surface;
        else if (y >= top - 3) bid = MAT.subsurface;
        else bid = MAT.deep;
        put(x, y, z, bid);
      }
    }
  }

  let trees = 0;
  if (p.trees && opts.trees !== false) {
    for (let x = 2; x < SX - 2; x++) {
      for (let z = 2; z < SZ - 2; z++) {
        const top = heights[x * SZ + z];
        if (top <= sea || top < 1) continue;
        if (world.get(x, top, z) !== B.grass) continue;
        if (hash2(x, z, seed + 991) > p.trees) continue;
        const th = 4 + Math.floor(hash2(x, z, seed + 13) * 3);
        if (top + th + 2 >= SY) continue;
        for (let i = 1; i <= th; i++) put(x, top + i, z, B.wood);
        const cy = top + th;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 2; dy++) {
          const r = Math.abs(dx) + Math.abs(dz) + dy;
          if (r > 3 || (dy === 2 && r > 1)) continue;
          const xx = x + dx, zz = z + dz, yy = cy + dy;
          if (!world.inBounds(xx, yy, zz) || world.has(xx, yy, zz)) continue;
          put(xx, yy, zz, B.leaf);
        }
        trees++;
      }
    }
  }
  // 以世界实际格数为准：树冠会盖掉已有的方块，自己累加会多算（实测差 3~4 格）。
  // wetPct 是**实际**淹水比例：高度只能落在整数层上，滑杆的 10% 做不到精确，
  // 把它回报出来才能让界面说真话。
  let under = 0;
  for (let i = 0; i < heights.length; i++) if (heights[i] < sea) under++;
  return {
    cells: world.size(), water, trees, min, max, sea,
    wetPct: Math.round(under / heights.length * 100),
    preset: p.id, seed,
  };
}
