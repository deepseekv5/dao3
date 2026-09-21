// scripts/fetch-official-project.mjs — 按 CID 自行取回官方赛车模板的数据块。
//
// 为什么默认不随包分发：这些 blob 来自 dao3.fun 的内容服务（游戏素材与地图数据），
// 版权归 box3lab 及其权利人，没有再分发授权；本仓库只带 official-project/cids.json
// 这份 824 字节的哈希清单。用你自有的访问权限取回，并逐个校验 sha256 与 CID 一致，
// 取到的东西必须和你清单里指向的是同一份内容。
//
// 用法：
//   node scripts/fetch-official-project.mjs              # 取回全部并写进本地种子世界
//   node scripts/fetch-official-project.mjs --no-import  # 只下载，不改地图
//   DAO3_GATEWAY=https://your/mirror node scripts/fetch-official-project.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY = (process.env.DAO3_GATEWAY || "https://static.dao3.fun/block").replace(/\/+$/, "");
const OUT = path.join(ROOT, "official-project/racing-template");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = B58[0] + s; else break; }
  return s;
}
// CIDv0 = multihash(sha256) 的 base58btc：0x12 0x20 <32B 摘要>，结果以 "Qm" 开头
function cidOf(bytes) {
  const digest = crypto.createHash("sha256").update(bytes).digest();
  return base58(Buffer.concat([Buffer.from([0x12, 0x20]), digest]));
}

const listPath = path.join(ROOT, "official-project/cids.json");
if (!fs.existsSync(listPath)) {
  console.error("缺少 official-project/cids.json —— 便携包里应带这份 CID 清单。");
  process.exit(1);
}
const cids = JSON.parse(fs.readFileSync(listPath, "utf8"));
fs.mkdirSync(OUT, { recursive: true });

let ok = 0, mismatch = 0, cached = 0, failed = [];
for (const [key, cid] of Object.entries(cids)) {
  if (typeof cid !== "string" || !cid.startsWith("Qm")) continue;
  const dest = path.join(OUT, key + ".raw");
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    if (cidOf(fs.readFileSync(dest)) === cid) { cached++; continue; }
  }
  const url = `${GATEWAY}/${cid}`;
  let res;
  try { res = await fetch(url); } catch (e) { failed.push(`${key}: ${e.message}`); continue; }
  if (!res.ok) { failed.push(`${key}: HTTP ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) { failed.push(`${key}: 空响应`); continue; }
  const got = cidOf(buf);
  if (got !== cid) {
    console.error(`✗ ${key} 校验失败：期望 ${cid} 实得 ${got}`);
    mismatch++;
    continue;
  }
  fs.writeFileSync(dest, buf);
  ok++;
  console.log(`✓ ${key}  ${buf.length}B  ${cid}`);
}
console.log(JSON.stringify({ downloaded: ok, cached, mismatch, failed }));

// 音频单独走 assets 清单（type 6 的那些），它们同样是内容服务里的素材
const assetsPath = path.join(OUT, "assets.raw");
if (fs.existsSync(assetsPath) && !process.argv.includes("--no-import")) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/fetch-official-audio.mjs")], { stdio: "inherit" });
  } catch (e) { console.warn("音频取回未完成（可稍后单独运行 scripts/fetch-official-audio.mjs）"); }
}

if (!process.argv.includes("--no-import")) {
  if (!fs.existsSync(path.join(OUT, "entitiesTree.raw"))) {
    console.error("entitiesTree 未取回，跳过地图写入。");
    process.exit(2);
  }
  execFileSync(process.execPath, [path.join(ROOT, "scripts/import-official-project.mjs")], { stdio: "inherit" });
  console.log("已把官方模板数据写进本地种子世界。注意：赛道模型 (.vb) 不在分发范围内，");
  console.log("缺模型时实体会以占位盒显示，其余 199 个实体/脚本/音效逻辑照常可用。");
}
