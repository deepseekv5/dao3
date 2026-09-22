// build-play.mjs — 组装「浏览器在线体验版」到 play/（纯静态，零服务端）。
//
// 做法：
//   1) 以 play-src/ 为页面与样式来源，原样镜像到 play/；
//   2) 运行时模块**不靠猜**：从入口集合出发，沿 import / import() 递归求闭包，
//      只拷贝真正被引用的文件（voxa、编辑器 UI、io.js、features.js 因此自然落选）；
//   3) 随闭包带上被引用到的 vendor 文件 + three.js 的 LICENSE；
//   4) 拷贝图集、图标，并把官方赛车模板解引用为 play/world.json.gz；
//   5) 自检：产物里不得出现 /api/、也不得出现会踩 Pages 子路径的根绝对路径。
//
// 约束：本脚本只读 public/、official-project/、play-src/，只写 play/。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "play");
const SRC = path.join(ROOT, "play-src");

// 体验版运行时的入口模块（闭包会自己把它们需要的东西拉进来）
const ENTRIES = [
  "public/js/atlas.js",
  "public/js/world.js",
  "public/js/renderer.js",
  "public/js/game.js",
];

const STATIC_FILES = [
  ["public/data/block-atlas.json", "data/block-atlas.json"],
  ["public/data/block-atlas.png", "data/block-atlas.png"],
  ["public/img/arena.svg", "img/arena.svg"],
  ["public/css/editor.css", "css/editor.css"], // 运行 HUD 的全部样式都在这里，整份取用
  ["official-project/racing-template.json.gz", "world.json.gz"],
];

// three.js 以 MIT 随包分发，许可证必须同行
const FORCE_VENDOR = [["public/vendor/three/LICENSE", "vendor/three/LICENSE"]];

const log = (...a) => console.log(...a);
const kb = (n) => (n / 1024).toFixed(1) + " KB";

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/* ---------------- import 闭包 ---------------- */
// 只解析相对说明符（本项目模块全部用相对路径），bare 说明符交给 importmap。
const SPEC_RE = /(?:^|[\s;()])(?:import|export)\s+[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;()])(?:import|export)\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(code) {
  const out = [];
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(code))) out.push(m[1] || m[2] || m[3]);
  return out;
}

function closure(entryRelList) {
  const seen = new Set();
  const queue = [...entryRelList];
  while (queue.length) {
    const rel = queue.shift();
    const abs = path.join(ROOT, rel);
    if (seen.has(rel)) continue;
    if (!fs.existsSync(abs)) throw new Error(`闭包里的模块不存在：${rel}`);
    seen.add(rel);
    const dir = path.dirname(rel);
    for (const spec of specifiers(fs.readFileSync(abs, "utf8"))) {
      if (!spec.startsWith(".")) continue; // bare specifier → importmap 负责，不拷贝
      const resolved = path.normalize(path.join(dir, spec)).split(path.sep).join("/");
      queue.push(resolved);
    }
  }
  return [...seen].sort();
}

/* ---------------- 拷贝与自检 ---------------- */
// 唯一的路径改写：editor.css 里 .load-logo 的 /img/arena.svg 是根绝对路径，
// 在 Pages 子路径下会 404。只改 play/ 里的这份拷贝，public/ 原件一个字都不动。
const CSS_URL_RE = /url\(\s*(['"]?)\/(img|data|css|js|vendor|assets)\//g;

function rewriteCss(text) {
  const hits = (text.match(CSS_URL_RE) || []).length;
  return [text.replace(CSS_URL_RE, "url($1../$2/"), hits];
}

function copy(srcRel, destRel) {
  const from = path.join(ROOT, srcRel);
  const to = path.join(OUT, destRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (destRel.endsWith(".css")) {
    const [text, hits] = rewriteCss(fs.readFileSync(from, "utf8"));
    fs.writeFileSync(to, text);
    if (hits) log(`   ! ${destRel}: 改写 ${hits} 处根绝对 url()`);
  } else {
    fs.copyFileSync(from, to);
  }
  return fs.statSync(to).size;
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(p);
  }
  return out;
}

// 体验版没有服务端：任何 /api/ 取用都是 404；根绝对路径在 Pages 子路径下同样是 404。
// 只认「引号紧跟路径」与「url( 紧跟 /」这类真实取用位置，注释里提到 /api/ 不算。
const BANNED = [
  [/["'`]\/api\//, "取用了 /api/（体验版无服务端）"],
  [/["'`]\/(?:js|css|data|img|vendor|assets|world|edit)\//, "使用了根绝对路径（Pages 子路径会 404）"],
  [/url\(\s*['"]?[\/]/, "CSS url() 使用了根绝对路径"],
];

function audit() {
  const problems = [];
  for (const f of walk(OUT)) {
    const ext = path.extname(f);
    if (![".js", ".mjs", ".html", ".css", ".json"].includes(ext)) continue;
    const text = fs.readFileSync(f, "utf8");
    text.split("\n").forEach((line, i) => {
      // three.module.js 的注释里会出现 "/api/" 之类的字样，只查真正的取用位置
      for (const [re, why] of BANNED) {
        if (re.test(line)) problems.push(`${path.relative(OUT, f)}:${i + 1} ${why}\n    ${line.trim().slice(0, 140)}`);
      }
    });
  }
  return problems;
}

/* ---------------- 主流程 ---------------- */
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

// 1) 页面 / 样式 / 入口模块（play-src 目录结构 1:1 映射到 play/）
const srcFiles = walk(SRC).map((p) => path.relative(SRC, p).split(path.sep).join("/"));
if (!srcFiles.includes("index.html")) throw new Error("play-src/index.html 缺失");
let bytes = 0;
for (const rel of srcFiles) bytes += copy(path.join("play-src", rel).split(path.sep).join("/"), rel);
log(`页面  play-src/ → play/  ${srcFiles.length} 个文件`);
for (const rel of srcFiles) log(`   · ${rel.padEnd(22)} ${kb(fs.statSync(path.join(OUT, rel)).size)}`);

// 2) 运行时模块闭包
const mods = closure(ENTRIES);
const jsBytes = {};
for (const rel of mods) {
  const dest = rel.replace(/^public\//, "");
  jsBytes[dest] = copy(rel, dest);
  bytes += jsBytes[dest];
}
log(`\n运行时（import 闭包，共 ${mods.length} 个模块）`);
for (const rel of mods) log(`   · ${rel.replace(/^public\//, "").padEnd(26)} ${kb(jsBytes[rel.replace(/^public\//, "")])}`);

// 3) 静态资源
log(`\n资源`);
for (const [src, dest] of STATIC_FILES) {
  const n = copy(src, dest);
  bytes += n;
  log(`   · ${dest.padEnd(26)} ${kb(n)}`);
}
for (const [src, dest] of FORCE_VENDOR) {
  if (!fs.existsSync(path.join(ROOT, src))) throw new Error(`缺少 ${src}`);
  bytes += copy(src, dest);
  log(`   · ${dest.padEnd(26)} ${kb(fs.statSync(path.join(OUT, dest)).size)}`);
}

// 4) Pages 不做 Jekyll 处理
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

// 5) 自检
const problems = audit();
if (problems.length) {
  console.error(`\n产物审查未通过（${problems.length} 处）：`);
  for (const p of problems.slice(0, 20)) console.error("  " + p);
  process.exit(1);
}

const total = walk(OUT).reduce((s, f) => s + fs.statSync(f).size, 0);
log(`\n审查通过：无 /api/、无根绝对路径。play/ 共 ${walk(OUT).length} 个文件，${(total / 1048576).toFixed(2)} MB`);
log("发布目录就绪：把 play/ 的内容推到 deepseekv5/dao3play 仓库根即可。");
