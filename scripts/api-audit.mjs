// scripts/api-audit.mjs — 机械比对：官方 d.ts 声明的成员 vs 我们的运行时实现
//
// 产出三份 JSON：
//   public/data/api-members.json  每个类官方声明了哪些成员（浏览器内探针拿它当待查清单）
//   public/data/api-methods.json  其中声明为可调用方法的那一批（探针要按 typeof 校验）
//   public/data/api-impl.json     静态比对认为"本地有"的那一批（API 参考文档的"本地"列用它）
// members 与 impl 是两份东西，别混用：impl 曾直接复用 members 的清单，
// 于是文档里每一行都写着 ✅，包括本地根本没有的那 21 个。
//
// 判定"已实现"用的是静态文本比对：在运行时源码里能不能找到这个名字。它对
// name / get / value 这类通用词会误判成"有"，所以只看单个类的相对缺口，
// 别把它当成绝对覆盖率。GameWorld/GameEntity/GamePlayer/GameVoxels 另有
// 浏览器内的真运行时对账（public/js/api-probe.js），那个才是可信的。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DTS = [
  "vendor/ArenaPro-CLI/server/types/GameAPI.d.ts",
  "vendor/ArenaPro-CLI/client/types/ClientAPI.d.ts",
];
// 标准库噪声：官方 d.ts 把 TypeScript 自带的 ES 声明一起打进来了，见 build-api-ref.mjs 的说明
const STD_LIB = new Set(fs.readFileSync(path.join(ROOT, "scripts/build-api-ref.mjs"), "utf8")
  .slice(0, 6000).match(/const STD_LIB = new Set\(`([\s\S]*?)`/)[1].trim().split(/\s+/));

const CORE = ["GameWorld", "GameEntity", "GamePlayer", "GameVoxels"];

// 有一批成员不是我们写的代码，而是把平台原生对象直接交出去：http.fetch 返回的就是
// 浏览器自己的 Response，statusText / bodyUsed / formData 天生在上面。静态 grep 看不到，
// 于是文档会报出一串假"缺"。这里逐个名字登记（不是整类放开），依据是在 Node 与浏览器里
// 都验过 Response.prototype 上确实有这些属性。
const NATIVE = {
  GameHttpFetchResponse: ["status", "statusText", "headers", "ok", "json", "text", "arrayBuffer"],
  BodyMixin: ["body", "bodyUsed", "arrayBuffer", "formData", "blob", "json", "text"],
  Response: ["status", "statusText", "headers", "ok", "json", "text", "arrayBuffer", "bodyUsed", "formData"],
}

const sources = fs.readdirSync(path.join(ROOT, "public/js"))
  .filter((f) => f.endsWith(".js") && f !== "api-probe.js")
  .map((f) => `public/js/${f}`)
  .concat(["play-src/js/play.js"].filter((f) => fs.existsSync(path.join(ROOT, f))))
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");

// on*/next* 是 attachChannels 动态挂的，静态文本里根本不会出现这个名字。
// 不特殊处理的话 GameWorld 会一口气报 32 个"缺失"，全是误报。
const channelNames = new Set();
for (const m of sources.matchAll(/attachChannels\s*\([^,]+,\s*\[([\s\S]*?)\]/g))
  for (const q of m[1].matchAll(/"([A-Z][A-Za-z0-9_]*)"|'([A-Z][A-Za-z0-9_]*)'/g)) channelNames.add(q[1] || q[2]);

const wordRe = new Map();
function implemented(name) {
  const ev = /^(?:on|next)([A-Z][A-Za-z0-9_]*)$/.exec(name);
  if (ev && channelNames.has(ev[1])) return true;
  if (!wordRe.has(name)) {
    // 单双字母名（r / g / b / a）用词边界匹配等于恒真："spectator:" 里就含 "r"。
    // 官方 GameRGBColor 的分量叫 r/g/b，我们内部用 red/green/blue，于是审计一路
    // "已实现"而脚本里 color.r 其实是 undefined —— 短名只认"成员位置"：
    // 属性访问、访问器声明、对象字面量的键。长名仍按整词匹配。
    wordRe.set(name, name.length <= 2
      ? new RegExp(`\\.\\s*${name}\\s*[(:=,)\\]}.;]|(?:get|set)\\s+${name}\\s*\\(|[{,]\\s*${name}\\s*:`, "m")
      : new RegExp(`(^|[^$A-Za-z0-9_])${name}($|[^A-Za-z0-9_])`));
  }
  return wordRe.get(name).test(sources);
}

/** 从 d.ts 里取一个类的成员（顶层两空格缩进的那些） */
function membersOf(lines, className) {
  const i = lines.findIndex((l) => new RegExp(`^(?:export\\s+)?declare\\s+(?:class|interface)\\s+${className}[\\s({:]`).test(l)
    || new RegExp(`^${className}\\s*(?:<[^>]*>)?\\s*(?:extends[^{]*)?\\{`).test(l));
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^\}/.test(l)) break;
    if (/^\s*(private|\/\*|\*|\/\/)/.test(l)) continue;
    // 泛型方法（findChildByName<T extends UiElement>(…)）名字后面紧跟 <，
    // 不把 < 算进分隔符就会把整个成员从官方清单里漏掉——分母错了，覆盖率反而虚高。
    const m = l.match(/^  (?:static |readonly |get |set |async )*(?:declare\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*[:?(<]/);
    if (!m) continue;
    const after = l.slice(m.index + 2 + m[1].length);
    out.push({ name: m[1], callable: after.startsWith("(") || /^\s*<.*>\s*\(/.test(after) || /^\s*:\s*\(/.test(after) || /^\s*\(/.test(after) });
  }
  const seen = new Set();
  return out.filter((e) => !seen.has(e.name) && seen.add(e.name));
}

function classNames(lines) {
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    const m = /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
    if (!m) continue;
    const n = m[2];
    if (!STD_LIB.has(n) && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

const lines = DTS.flatMap((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n?/g, "\n").split("\n"));
const names = classNames(lines);
const groups = {};
for (const n of names) {
  const list = membersOf(lines, n);
  if (list.length) groups[n] = list;
}

let total = 0, done = 0;
const missingAll = [];
for (const [k, list] of Object.entries(groups)) {
  const nm = list.map((e) => e.name);
  const miss = nm.filter((x) => !implemented(x));
  total += nm.length;
  done += nm.length - miss.length;
  if (miss.length) missingAll.push(...miss.map((m) => `${k}.${m}`));
  if (CORE.includes(k)) {
    console.log(`${k}: 官方成员 ${nm.length} · 已实现 ${nm.length - miss.length} · 缺失 ${miss.length}`
      + ` · 其中可调方法 ${list.filter((e) => e.callable).length}`);
    if (miss.length) console.log("   缺失 → " + miss.join(", "));
  }
}
console.log(`\n合计 ${names.length} 个游戏类型 / ${Object.keys(groups).length} 个有成员级声明，`
  + `${total} 个官方成员，静态比对到 ${done}（覆盖 ${(100 * done / total).toFixed(1)}%）`);

// 事件通道必须成对：on* 与 next*
const evNames = new Set();
for (const l of lines) {
  const m = /^  (on|next)([A-Z][a-zA-Z0-9_]*)\s*:/.exec(l);
  if (m) evNames.add(m[2]);
}
const evMiss = [...evNames].filter((n) => !implemented("on" + n) || !implemented("next" + n));
console.log(`\n官方事件 ${evNames.size} 类；on*/next* 静态没找到成对实现：${evMiss.length ? evMiss.join(", ") : "无"}`);
console.log("（on*/next* 由 attachChannels 动态挂载，静态搜不到属正常，以 api-probe.js 的运行时对账为准）");

// 核心四类单独再打一遍，保持历史输出格式（文档站与人工比对都看这四行）
for (const c of CORE) if (!groups[c]) console.log(`警告：${c} 在 d.ts 里没找到，探针与文档会缺这一类`);

const impl = {};
for (const [c, l] of Object.entries(groups)) {
  const native = NATIVE[c] || [];
  impl[c] = l.map((e) => e.name).filter((n) => implemented(n) || native.includes(n));
}
fs.writeFileSync(path.join(ROOT, "public/data/api-impl.json"), JSON.stringify(impl));
fs.writeFileSync(path.join(ROOT, "public/data/api-members.json"), JSON.stringify(
  Object.fromEntries(Object.entries(groups).map(([c, l]) => [c, l.map((e) => e.name)]))
));
fs.writeFileSync(path.join(ROOT, "public/data/api-methods.json"), JSON.stringify(
  Object.fromEntries(Object.entries(groups).map(([c, l]) => [c, l.filter((e) => e.callable).map((e) => e.name)]))
));
console.log("已写出 public/data/api-members.json、api-methods.json 与 api-impl.json（探针与 API 参考文档用）");
