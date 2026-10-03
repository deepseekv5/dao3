// scripts/build-world-covers.mjs — 给所有还没有封面的地图补一张。
//
// 为什么要单独一个脚本：编辑器只在"人开着编辑器看这个窗口"时才截一张封面图，
// 于是新建的图、脚本批量生成的图、导入进来的图都没有封面，列表里就退化成
// 那个按 id 派生渐变的占位块。这里读每张图自己的体素画一张小地图（covers.mjs），
// 让"所有地图都有封面"这件事与有没有人打开过编辑器无关。
//
// 用法：node scripts/build-world-covers.mjs [--force]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { blockColors, renderCover } from "../server/covers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "server", "data");
const WORLDS = path.join(DATA_DIR, "worlds");
const ASSETS = path.join(DATA_DIR, "assets");
const ATLAS_JSON = path.join(ROOT, "public", "data", "block-atlas.json");
const ATLAS_PNG = path.join(ROOT, "public", "data", "block-atlas.png");
const FORCE = process.argv.includes("--force");

if (!fs.existsSync(WORLDS)) {
  console.log("没有 worlds 目录，跳过（可能数据目录换过）。");
  process.exit(0);
}
const colors = blockColors(ATLAS_JSON, ATLAS_PNG);
const files = fs.readdirSync(WORLDS).filter((f) => f.endsWith(".json.gz"));
let made = 0, skip = 0, fail = 0;

for (const f of files) {
  const id = f.replace(/\.json\.gz$/, "");
  const cover = path.join(ASSETS, id, "cover.png");
  if (!FORCE && fs.existsSync(cover)) { skip++; continue; }
  let world;
  try { world = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(WORLDS, f))).toString()); }
  catch (e) { console.log("  读不出来，跳过：" + id); fail++; continue; }
  try {
    const png = renderCover({ indices: world.indices, data: world.data, shape: world.shape, colors });
    if (!png) { console.log("  没有体素，跳过：" + id); fail++; continue; }
    fs.mkdirSync(path.dirname(cover), { recursive: true });
    fs.writeFileSync(cover, png);
    made++;
    process.stdout.write(`  ✓ ${id}  ${world.shape.join("×")}  ${(png.length / 1024).toFixed(0)} KB\n`);
  } catch (e) {
    console.log("  画封面失败，跳过：" + id + "（" + e.message + "）"); fail++;
  }
}
console.log(`\n世界封面：补了 ${made} 张，已存在 ${skip} 张，跳过 ${fail} 张。`);
process.exit(0);