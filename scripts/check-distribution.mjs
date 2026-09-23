#!/usr/bin/env node
// check-distribution.mjs — 发布前的最后一道闸：任何"可对外分发"的产物都不许带
// 未授权素材或凭据。便携包、npm tarball、仓库工作树，以及公开托管的网页体验版
// play/，四处一起查。
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
// 官方赛车模板地图数据：按仓库所有者的决定随包分发，但**必须**在应用内经用户确认后才落地。
// 这是显式登记的例外，不是漏网——其它任何 .gz 一律仍算越界。
const SHIPPED_MAP = "official-project/racing-template.json.gz";
// 官方赛道模型与音效：同样是仓库所有者的分发决定，同样要应用内确认才放行
// （server.js 的 gatedAsset 在未确认时对这两个前缀直接 403）。
// 例外只开这一个目录：public/assets 与 public/data/assets 仍然是运行时产物位置，
// 里面出现任何 .mp3/.gltf 依旧算越界，防止"顺手把别处的素材也带上"。
const SHIPPED_ASSETS = "official-project/racing-assets/";
// cids.json 是 824B 的哈希索引，.gitkeep 是空占位目录——都不是素材本体
const OK_OVERRIDE = (p) => p.endsWith("cids.json") || p.endsWith(".gitkeep")
  || p === SHIPPED_MAP || p.startsWith(SHIPPED_ASSETS);

const SECRET_RES = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];

function inspect(label, files, readFn, opts = {}) {
  const badExt = opts.badExt || BAD_EXT;
  const allowed = opts.allowed || OK_OVERRIDE;
  const required = opts.required || REQUIRED;
  const leaks = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (allowed(norm)) continue;
    if ((opts.badRoot || BAD_ROOT).some((d) => norm.startsWith(d))) leaks.push({ f: norm, why: "顶层目录" });
    else if ((opts.badAsset || BAD_ASSET).some((d) => norm.startsWith(d))) leaks.push({ f: norm, why: "素材目录" });
    else if (badExt.some((e) => norm.endsWith(e))) leaks.push({ f: norm, why: "扩展名" });
  }
  const secrets = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    if (/\.(png|jpg|jpeg|webp|gif|ico|atlas|woff2?|gz)$/i.test(norm)) continue;
    let text = "";
    try { text = readFn(norm); } catch { continue; }
    if (!text || text.length > 4_000_000) continue;
    for (const re of SECRET_RES) if (re.test(text)) { secrets.push(norm); break; }
  }
  return { label, files: files.length, leaks, secrets, missing: missingFrom(files, required) };
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
  "public/manual.html",
  "public/vendor/three/three.module.js", "public/vendor/three/GLTFLoader.js",
  "public/vendor/three/GLTFExporter.js", "public/vendor/three/OrbitControls.js",
  "public/vendor/three/LICENSE", "public/vendor/utils/BufferGeometryUtils.js",
  "public/data/block-atlas.png", "public/data/block-atlas.json",
  "public/data/api-members.json", "public/data/api-methods.json", "public/data/api-impl.json",
  // API 参考页与它的生成器：文档站承诺了这一页，生成物或生成脚本丢了就是死链
  "docs/api-reference.md", "docs/api-reference.html", "scripts/build-api-ref.mjs",
  "data/upstream/block-id.json", "data/upstream/block-spec.json", "data/upstream/LICENSE.Box3Blocks.txt",
  // 缺了它，fetch:official 在新克隆上直接退出——文档承诺的取回路径就是空的
  "official-project/cids.json",
  // 反向断言：模板既然决定分发，丢了就该报错，而不是静默退回程序化 demo
  "official-project/racing-template.json.gz",
  // 官方素材包同理：丢了它，确认框里那两项会变成"本包里没有"，
  // 而文档与界面都承诺了随包分发
  "official-project/racing-assets/models/方格.gltf",
  "official-project/racing-assets/audio/index.json",
  // 体验版的源。play/ 是产物且不入库，所以这三件丢了就等于 build:play 在
  // 使用者手里直接失败——而文档教的就是这条命令。
  "play-src/index.html", "play-src/js/play.js", "play-src/css/play.css",
  "scripts/build-play.mjs",
  "run.sh", "run-win.ps1", "启动-Windows.bat", "启动-macOS.command",
  "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
  // Release 正文由它生成，丢了 workflow 会直接失败——但更早发现更好
  "CHANGELOG.md",
];
const missingFrom = (files, required = REQUIRED) => {
  const set = new Set(files.map((f) => f.replace(/\\/g, "/")));
  return required.filter((r) => !set.has(r));
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

// 3) 便携包目录（如果已经构建过）。
// 目录位置有两种：本地习惯建在仓库旁边，CI 用的是 "$GITHUB_WORKSPACE/DAO3-便携包"
// 即仓库**内部**。只找其中一种的话，另一种环境下这一项会静默跳过——
// 曾经就是这样：本地残留的旧目录让审计看起来在跑，其实一直在检查过期产物。
for (const PKG of [path.resolve(ROOT, "..", "DAO3-便携包"), path.join(ROOT, "DAO3-便携包")]) {
  if (!fs.existsSync(PKG)) continue;
  const label = PKG.startsWith(ROOT + path.sep) ? "便携包目录（仓库内）" : "便携包目录（仓库旁）";
  reports.push(inspect(label, walk(PKG), (f) => fs.readFileSync(path.join(PKG, f), "utf8")));
}

// 4) 网页体验版 play/。它和前三处不一样：不是"发给朋友"，而是**公开镜像**，
//    任何人都能访问，所以尺度要更严——只允许那一份地图数据作为例外，
//    连 .gz 都不许有第二份（音频/模型压缩包也是 .gz）。
const PLAY = path.join(ROOT, "play");
if (fs.existsSync(PLAY)) {
  const PLAY_MAP = "world.json.gz";
  // 体验版是静态站，没有服务端那道 403 闸门，确认点改成首屏那张卡：
  // 它列明来源、著作权与"点进入即表示你确认有权使用"。所以素材可以随包，
  // 但**只许**这两个目录，其它任何音频/模型文件仍然一律越界。
  const PLAY_ALLOWED = ["world.json.gz", "assets/models/", "assets/audio/"];
  reports.push(inspect("网页体验版 play/", walk(PLAY), (f) => fs.readFileSync(path.join(PLAY, f), "utf8"), {
    badExt: [".mp3", ".glb", ".gltf", ".gz", ".wav", ".ogg", ".bin", ".zip"],
    badRoot: [],
    badAsset: ["assets/"],
    allowed: (p) => p === PLAY_MAP || p.endsWith(".gitkeep") || PLAY_ALLOWED.some((d) => p.startsWith(d)),
    required: [
      "index.html", ".nojekyll",
      "js/play.js", "js/game.js", "js/gapi.js", "js/clientui.js",
      "js/renderer.js", "js/world.js", "js/atlas.js",
      "css/play.css", "css/editor.css",
      "vendor/three/three.module.js", "vendor/three/OrbitControls.js",
      "vendor/three/GLTFLoader.js", "vendor/utils/BufferGeometryUtils.js", "vendor/three/LICENSE",
      "data/block-atlas.json", "data/block-atlas.png",
      PLAY_MAP,
      // 素材包整体在场：少了 models 体验版就退回一片橙色线框，少了 audio 音效全哑
      "assets/models/方格.gltf", "assets/audio/index.json",
    ],
  }));
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
