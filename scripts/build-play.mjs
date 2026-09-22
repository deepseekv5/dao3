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

/* play-src/js/play.js 自己不在这份入口里——它是"页面侧"文件，走 play-src/ 整目录镜像。
   但它 import 的东西必须被闭包看见，否则构建照样"审查通过"、一上线就 404：
   之前它只 import 上面四个入口，所以这个洞一直没暴露，直到加了 GLTFLoader。
   play.js 部署在 play/js/，说明符是相对那个位置解析的，而 play/js/ 镜像的是 public/js/，
   所以按 public/js/ 来解析它的相对说明符就等于它在浏览器里的实际解析结果。 */
const SHELL = "play-src/js/play.js";
function shellEntries() {
  const code = fs.readFileSync(path.join(ROOT, SHELL), "utf8");
  const out = [];
  for (const spec of specifiers(code)) {
    if (!spec.startsWith(".")) continue;
    out.push(path.normalize(path.join("public/js", spec)).split(path.sep).join("/"));
  }
  return out;
}

const STATIC_FILES = [
  ["public/data/block-atlas.json", "data/block-atlas.json"],
  ["public/data/block-atlas.png", "data/block-atlas.png"],
  ["public/img/arena.svg", "img/arena.svg"],
  ["public/css/editor.css", "css/editor.css"], // 运行 HUD 的全部样式都在这里，整份取用
  ["official-project/racing-template.json.gz", "world.json.gz"],
];

// 官方赛道模型与音效：随包分发，闸门在应用内那道确认——静态站没有服务端，
// 所以确认点就是首屏那张卡（它列明来源、著作权与"点进入即表示你确认有权使用"）。
const BUNDLE_DIRS = [
  ["official-project/racing-assets/models", "assets/models"],
  ["official-project/racing-assets/audio", "assets/audio"],
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

// 2) 运行时模块闭包（含 play.js 自己 import 的那些）
const mods = closure(ENTRIES.concat(shellEntries()));
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

// 3b) 官方素材包：整目录复制，缺目录就直接失败而不是静默出一个"没模型"的体验版
log(`\n官方素材包`);
for (const [srcRel, destRel] of BUNDLE_DIRS) {
  const from = path.join(ROOT, srcRel);
  if (!fs.existsSync(from)) throw new Error(`缺少素材目录 ${srcRel}/，体验版不该在没有模型与音效的情况下发布`);
  const names = fs.readdirSync(from).filter((f) => fs.statSync(path.join(from, f)).isFile());
  if (!names.length) throw new Error(`${srcRel}/ 是空的`);
  let n = 0;
  for (const f of names) n += copy(path.join(srcRel, f).split(path.sep).join("/"), path.posix.join(destRel, f));
  bytes += n;
  log(`   · ${destRel.padEnd(26)} ${names.length} 个文件 · ${kb(n)}`);
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
