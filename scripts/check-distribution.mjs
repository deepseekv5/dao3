#!/usr/bin/env node
// check-distribution.mjs — 发布前的最后一道闸：任何"可对外分发"的产物都不许带
// 未授权素材或凭据。便携包 zip、npm tarball、以及仓库工作树本身，三处一起查。
//
// 为什么需要它：package.json 的 files 里写一句 "public" 就会把 public/assets
// 整个吞进去，而 npm **不看 .gitignore**（files 存在时）。这类泄漏静默无声。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BAD_EXT = [".mp3", ".glb", ".gltf", ".gz", ".wav", ".ogg", ".bin"];
// 规则一律锚定到产物根：public/vendor/ 是随包分发的 MIT three.js，
// 而顶层 vendor/ 是上游仓库自己的 clone（含 200MB+ 纹理），两者不能混为一谈。
const BAD_ROOT = ["vendor/", "tmp/", "node_modules/", "server/data/", "official-project/racing-template/"];
const BAD_ASSET = ["public/assets/", "public/data/assets/"];
// cids.json 是 824B 的哈希索引，.gitkeep 是空占位目录——都不是素材本体
const OK_OVERRIDE = (p) => p.endsWith("cids.json") || p.endsWith(".gitkeep");

const SECRET_RES = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];

function inspect(label, files, readFn) {
  const leaks = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (OK_OVERRIDE(norm)) continue;
    if (BAD_ROOT.some((d) => norm.startsWith(d))) leaks.push({ f: norm, why: "顶层目录" });
    else if (BAD_ASSET.some((d) => norm.startsWith(d))) leaks.push({ f: norm, why: "素材目录" });
    else if (BAD_EXT.some((e) => norm.endsWith(e))) leaks.push({ f: norm, why: "扩展名" });
  }
  const secrets = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (/\.(png|jpg|jpeg|webp|gif|ico|atlas|woff2?)$/i.test(norm)) continue;
    let text = "";
    try { text = readFn(norm); } catch { continue; }
    if (!text || text.length > 4_000_000) continue;
    for (const re of SECRET_RES) if (re.test(text)) { secrets.push(norm); break; }
  }
  return { label, files: files.length, leaks, secrets, missing: missingFrom(files) };
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

const reports = [];

// 只查"不该在的东西不在"是不够的：gitignore 里一句没锚定的 `vendor/` 会把
// public/vendor/（随包分发的 MIT three.js）一起吞掉，于是仓库能过审、clone 出来却白屏。
// 所以运行时必需文件必须**逐个确认在场**。
const REQUIRED = [
  "server.js", "start.mjs", "package.json",
  "public/index.html", "public/editor.html", "public/voxa.html", "public/site.html",
  "public/vendor/three/three.module.js", "public/vendor/three/GLTFLoader.js",
  "public/vendor/three/GLTFExporter.js", "public/vendor/three/OrbitControls.js",
  "public/vendor/three/LICENSE", "public/vendor/utils/BufferGeometryUtils.js",
  "public/data/block-atlas.png", "public/data/block-atlas.json",
  "data/upstream/block-id.json", "data/upstream/block-spec.json", "data/upstream/LICENSE.Box3Blocks.txt",
  // 缺了它，fetch:official 在新克隆上直接退出——文档承诺的取回路径就是空的
  "official-project/cids.json",
  "run.sh", "run-win.ps1", "启动-Windows.bat", "启动-macOS.command",
  "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
];
const missingFrom = (files) => {
  const set = new Set(files.map((f) => f.replace(/\\/g, "/")));
  return REQUIRED.filter((r) => !set.has(r));
};

// 1) 工作树里被 git 跟踪的文件
try {
  // core.quotePath=false：否则 git 会把 启动-Windows.bat 输出成八进制转义串，
  // 下面的 REQUIRED 精确匹配就会假报"缺文件"
  const tracked = execFileSync("git", ["-c", "core.quotePath=false", "ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  reports.push(inspect("git 跟踪的文件", tracked, (f) => fs.readFileSync(path.join(ROOT, f), "utf8")));
} catch (e) {
  reports.push({ label: "git 跟踪的文件", error: String(e.message).slice(0, 120) });
}

// 2) npm tarball 会打进去什么
try {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  const parsed = JSON.parse(raw);
  const d = Array.isArray(parsed) ? parsed[0] : parsed;
  reports.push(inspect("npm tarball", d.files.map((f) => f.path), (f) => fs.readFileSync(path.join(ROOT, f), "utf8")));
} catch (e) {
  reports.push({ label: "npm tarball", error: String(e.message).slice(0, 200) });
}

// 3) 便携包目录与 zip（如果已经构建过）
const PKG = path.resolve(ROOT, "..", "DAO3-便携包");
if (fs.existsSync(PKG)) {
  reports.push(inspect("便携包目录", walk(PKG), (f) => fs.readFileSync(path.join(PKG, f), "utf8")));
}

let bad = 0;
for (const r of reports) {
  if (r.error) { console.log(`ERROR ${r.label}: ${r.error}`); bad++; continue; }
  const n = r.leaks.length + r.secrets.length + r.missing.length;
  if (n) bad++;
  console.log(`${n ? "FAIL" : "ok  "} ${r.label}: ${r.files} 个文件 | 素材越界 ${r.leaks.length} | 疑似凭据 ${r.secrets.length} | 缺必需文件 ${r.missing.length}`);
  for (const l of r.leaks.slice(0, 8)) console.log(`      ! ${l.f}  (${l.why})`);
  for (const s of r.secrets.slice(0, 8)) console.log(`      $ ${s}`);
  for (const m of r.missing.slice(0, 12)) console.log(`      ← 缺 ${m}`);
}
console.log(bad ? `\n${bad} 处问题，禁止发布` : "\n分发内容审计通过");
process.exit(bad ? 1 : 0);
