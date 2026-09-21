// 下载官方 project 的音频资产到 public/data/assets/audio（幂等，已存在则跳过）。
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const A = JSON.parse(fs.readFileSync(path.join(ROOT, "official-project/racing-template/assets.raw"), "utf8"));
const OUT = path.join(ROOT, "public/data/assets/audio");
fs.mkdirSync(OUT, { recursive: true });

const jobs = Object.entries(A).filter(([k]) => k.startsWith("audio/"));
let ok = 0, skip = 0, bad = [];
for (const [key, v] of jobs) {
  const name = path.basename(key);
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { skip++; continue; }
  const r = await fetch("https://static.dao3.fun/block/" + v.hash);
  if (!r.ok) { bad.push(name + " http=" + r.status); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) { bad.push(name + " empty"); continue; }
  fs.writeFileSync(dest, buf);
  ok++;
}
console.log(JSON.stringify({ total: jobs.length, downloaded: ok, skipped: skip, failed: bad }));
const names = jobs.map(([k]) => path.basename(k)).sort();
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(names, null, 1));
console.log("index.json", names.length, "entries");
