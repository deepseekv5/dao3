// scripts/build-portable.mjs — 生成可分发便携包 / 公开仓库工作树。
//
// 为什么是白名单而不是 rsync 排除：仓库里混着三类素材，只有前两类能对外分发。
//   1) 我们自己写的代码与文档                     → 分发
//   2) Apache-2.0 上游（Box3Blocks-unityPackage / ArenaPro-CLI / box3-product-document，
//      版权 2026 神岛实验室）里构建真正需要的两个小表 → 分发并保留 LICENSE
//   3) 从 static.dao3.fun 内容服务取回的游戏素材（40 个 mp3、转换后的赛道模型、
//      官方地图 blob、本地存档）——没有任何再分发授权，本仓库自己的免责声明也禁止公开镜像
//      → 不分发，改由 scripts/fetch-official-project.mjs 让使用者自行取回
//
// 用法：node scripts/build-portable.mjs [输出目录]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "..", "DAO3-便携包"));

// 版本号只有一个来源：package.json。写死在这里会让 zip 与 .dmg 的版号各说各话。
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
if (!VERSION) { console.error("package.json 缺 version"); process.exit(1); }

// 顶层文件：原样复制
const FILES = [
  "server.js", "start.mjs", "package.json", ".gitignore",
  "run.sh", "run-win.ps1", "启动-Windows.bat", "启动-macOS.command",
  "LICENSE", "NOTICE", "README.md", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md",
  "public/index.html", "public/editor.html", "public/voxa.html", "public/site.html",
  // 玩家游玩手册：工作台左侧、编辑器顶栏、运行 HUD 三处都链到 /manual，
  // 漏了它便携包里这三个入口全是 404
  "public/manual.html",
];
// 目录：整棵复制（内容全部是我们自己的产物）
const DIRS = [
  "public/js", "public/css", "public/img", "public/vendor", "public/data/thumbnails",
  "scripts", "test", "docs", "play-src",
];
// 重命名复制：把上游的授权文件放到包内对应位置，避免"用了别人的东西却说不出来源"
const RENAME = {
  "vendor/Box3Blocks-unityPackage/LICENSE.md": "vendor-licenses/Box3Blocks-unityPackage.LICENSE.md",
  "vendor/Box3Blocks-unityPackage/README.md": "vendor-licenses/Box3Blocks-unityPackage.README.md",
  "vendor/ArenaPro-CLI/LICENSE": "vendor-licenses/ArenaPro-CLI.LICENSE",
  "vendor/box3-product-document/LICENSE": "vendor-licenses/box3-product-document.LICENSE",
};
// 构建/首启必需的 Apache 数据表（server.js 的 ensureSeed 与图集重建脚本都要读）
const LICENSED_DATA = [
  "data/upstream/block-id.json", "data/upstream/block-spec.json", "data/upstream/LICENSE.Box3Blocks.txt",
];
// 已经构建好的图集产物（派生自 Apache 纹理，随包分发以免用户必须装 Unity 才能跑）
const BUILT_DATA = ["public/data/block-atlas.json", "public/data/block-atlas.png",
  // API 参考文档的"本地"列与运行时对账探针都读这三份；缺了文档就只剩官方那一半
  "public/data/api-members.json", "public/data/api-methods.json", "public/data/api-impl.json"];
// 官方地图的 CID 清单（824B 的哈希索引，不含任何素材本体）：供 fetch 脚本使用。
// 赛车模板地图数据（2.8MB gz）按仓库所有者的决定随包分发，但服务端不自动装——
// 必须用户在应用内确认授权后才 copy 进 server/data/worlds（见 server.js /api/consent）。
const MANIFEST_ONLY = ["official-project/cids.json", "official-project/racing-template.json.gz"];
// 官方素材包是整目录随包（20 模型 + 41 音频，约 3.7MB），和地图数据一样要应用内确认才放行
const BUNDLE_DIRS = ["official-project/racing-assets"];
// 明确排除、且要在报告里点名说明的东西——防止以后有人顺手加回来
const DENY = [
  "vendor", "tmp", "official-project", "server/data", "node_modules",
  "public/assets", "public/data/assets", ".git", "run.pid", "run.out",
];
// DIRS 内部的运行产物：test/out 是回归套件写出的截图，不是源码
const PRUNE = new Set(["out", "dist", "cache", ".vite"]);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function copyFile(src, dst) {
  const s = path.join(ROOT, src), d = path.join(OUT, dst);
  if (!fs.existsSync(s)) return null;
  ensureDir(path.dirname(d));
  fs.cpSync(s, d, { recursive: true });
  return dst;
}
function copyTree(rel) {
  const s = path.join(ROOT, rel);
  if (!fs.existsSync(s)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    if (e.name === ".DS_Store" || e.name.endsWith(".meta")) continue;
    if (e.isDirectory() && PRUNE.has(e.name)) continue;
    const sub = path.join(rel, e.name);
    n += e.isDirectory() ? copyTree(sub) : (copyFile(sub, sub) ? 1 : 0);
  }
  return n;
}
function dirBytes(p) {
  let t = 0;
  if (!fs.existsSync(p)) return 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, e.name);
    if (e.isDirectory()) t += dirBytes(fp);
    else if (e.name !== ".DS_Store") t += fs.statSync(fp).size;
  }
  return t;
}

// 便携包必须从空目录开始构建：只要上一次构建后有人真的跑过包里的 server.js，
// ensureSeed() 就会往 server/data/worlds 写演示存档，脏文件会跟着 zip 一起发出去。
// 只清我们自己做过的目录（认 BUILD-MANIFEST.json 这个记号），不碰陌生目录。
const isOurs = fs.existsSync(path.join(OUT, "BUILD-MANIFEST.json"));
if (fs.existsSync(OUT)) {
  if (!isOurs) {
    console.error(`拒绝清空陌生目录 ${OUT}\n（缺少 BUILD-MANIFEST.json；换一个输出目录或手动删除后重试）`);
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
}

// 便携包不能带任何"本地存档"，但完全空的 worlds 目录会让 server.js 找不到落盘位置
ensureDir(path.join(OUT, "server/data/worlds"));
fs.writeFileSync(path.join(OUT, "server/data/worlds/.gitkeep"), "");
ensureDir(path.join(OUT, "public/assets/worlds"));
fs.writeFileSync(path.join(OUT, "public/assets/worlds/.gitkeep"), "");

let copied = 0;
for (const f of FILES) if (copyFile(f, f)) copied++;
for (const d of DIRS) copied += copyTree(d);
for (const [s, d] of Object.entries(RENAME)) if (copyFile(s, d)) copied++;
for (const f of LICENSED_DATA) if (copyFile(f, f)) copied++;
for (const f of BUILT_DATA) if (copyFile(f, f)) copied++;
for (const f of MANIFEST_ONLY) if (copyFile(f, f)) copied++;
for (const d of BUNDLE_DIRS) {
  if (!fs.existsSync(path.join(ROOT, d))) throw new Error(`缺少 ${d}/，便携包不该在没有官方模型与音效的情况下发布`);
  const n = copyTree(d);
  if (!n) throw new Error(`${d}/ 里一个文件都没有`);
  copied += n;
}

const stamp = new Date().toISOString();
fs.writeFileSync(path.join(OUT, "VERSION"), [
  `name: DAO3 编辑器复刻`,
  `version: ${VERSION}`,
  `built: ${stamp}`,
  `node: >=18（零第三方依赖，只用 Node 内置模块）`,
  `license: Apache-2.0（本仓库代码）· 上游素材见 THIRD_PARTY_NOTICES.md`,
  "",
].join("\n"));

fs.writeFileSync(path.join(OUT, "BUILD-MANIFEST.json"), JSON.stringify({
  version: VERSION, built: stamp, filesCopied: copied,
  included: { files: FILES, dirs: DIRS, licensedData: LICENSED_DATA, builtData: BUILT_DATA },
  excluded: DENY,
}, null, 1));

const bytes = dirBytes(OUT);

// 便携包的交付物是 zip。用自带的写入器而不是系统 zip：中文条目名必须带 UTF-8 标记，
// .command / run.sh 必须带可执行位，否则在简体中文 Windows 和 macOS 上都会解成不可用的包。
let zip = null;
try {
  const { spawnSync } = await import("node:child_process");
  const name = `DAO3-便携包-v${VERSION}.zip`;
  const target = path.join(path.dirname(OUT), name);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "zip-dir.mjs"), OUT, target], {
    stdio: "pipe", encoding: "utf8",
  });
  const info = r.status === 0 ? JSON.parse((r.stdout || "").trim().split("\n").pop()) : null;
  if (info) zip = { name, sizeMB: info.sizeMB, entries: info.entries };
  else console.warn("zip 生成失败：\n" + (r.stderr || "").slice(0, 400));
} catch (e) {
  console.warn("zip 生成失败：" + e.message);
}

console.log(JSON.stringify({
  out: OUT, files: copied, zip,
  sizeMB: +(bytes / 1048576).toFixed(2),
  excluded: DENY,
}, null, 1));
