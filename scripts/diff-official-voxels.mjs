// 下载官方体素分块并与本地种子地形逐格对比。
// 用法: node scripts/diff-official-voxels.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "official-project/racing-template/chunks");
fs.mkdirSync(DIR, { recursive: true });

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "official-project/racing-template/voxels.raw"), "utf8"));
const shape = idx.shape; // {x,y,z}
const uniq = [...new Set(idx.chunks)];
console.log(`shape ${shape.x}x${shape.y}x${shape.z} · ${idx.chunks.length} 块 · ${uniq.length} 个唯一分块`);

let fetched = 0, cached = 0;
for (const cid of uniq) {
  const dest = path.join(DIR, cid + ".bin");
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { cached++; continue; }
  const r = await fetch("https://static.dao3.fun/block/" + cid);
  if (!r.ok) { console.log("FAIL", cid, r.status); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
  fetched++;
}
console.log(`分块下载：新增 ${fetched}，命中缓存 ${cached}`);

const sizes = uniq.map((c) => fs.statSync(path.join(DIR, c + ".bin")).size);
const hist = {};
for (const s of sizes) hist[s] = (hist[s] || 0) + 1;
console.log("分块字节分布:", JSON.stringify(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8)));

// 格式猜测：首字节为版本/维度描述符，其后是 (index:u32?, id) 稀疏对
const sample = uniq.map((c) => ({ c, b: fs.readFileSync(path.join(DIR, c + ".bin")) })).filter((o) => o.b.length > 2);
for (const o of sample.slice(0, 3)) {
  console.log(`\n${o.c} len=${o.b.length}`);
  console.log(" head:", [...o.b.slice(0, 32)].map((x) => x.toString(16).padStart(2, "0")).join(" "));
}
