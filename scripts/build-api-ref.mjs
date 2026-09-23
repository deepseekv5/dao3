#!/usr/bin/env node
// build-api-ref.mjs — 从官方类型声明生成 API 参考文档 docs/api-reference.md。
//
// 为什么生成而不是手写：官方 GameAPI.d.ts 每个成员都带 @zh 中文说明和单位
// （"单位为米""每 tick""单位为毫秒"）。手抄一遍必然和契约对不上，而且对不上的时候
// 文档看起来完全正常——这正是最坏的一种错。生成物可以随上游声明重新跑一次。
//
// 同时交叉比对本地实现实际有哪些成员（public/data/api-impl.json 由 audit:api 产出），
// 于是文档能直接回答"这个函数我能不能用"，而不只是"官方定义长什么样"。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = [
  ["server", "vendor/ArenaPro-CLI/server/types/GameAPI.d.ts"],
  ["client", "vendor/ArenaPro-CLI/client/types/ClientAPI.d.ts"],
];
const OUT = path.join(ROOT, "docs", "api-reference.md");

const esc = (s) => String(s).replace(/\|/g, "\\|").trim();
function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

/** 官方注释里的 {@link Foo}：能锚到本页某个类型就变链接，锚不到就退成行内代码，
 *  免得生成一堆点不动的死锚。 */
function linkify(s, known) {
  return String(s).replace(/\{@link\s+([A-Za-z0-9_.]+)(?:\s+([^}]*?))?\s*\}/g, (_m, t, label) => {
    const text = (label || t).trim();
    return known.has(t) ? `[${text}](#${slug(t)})` : `\`${text}\``;
  });
}

function readDts(rel) {
  const abs = path.join(ROOT, rel);
  // 上游 d.ts 是 CRLF。注释标签的正则锚在 $ 上，\r 会让 (.*) 永远匹配不到内容——
  // 症状是签名全对（不依赖 $）但说明整列为空，所以读进来先归一化换行。
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n?/g, "\n") : null;
}

/* ---------------- 噪声过滤 ----------------
 * 官方把 TypeScript 自带的 ES 标准库声明一起打进了 GameAPI.d.ts。Array / Promise /
 * WeakMap 这些不是 DAO3 的 API，列进来会把真正的游戏 API 淹没——111 个标准库类型
 * 占了生成物 278 KB / 451 KB。用黑名单而不是白名单：上游哪天加新的游戏类型，
 * 白名单会静默漏掉它，黑名单只是多一条噪音。 */
const STD_LIB = new Set(`
Array ArrayBuffer ArrayBufferTypes ArrayConstructor ArrayLike Atomics BigInt
BigInt64Array BigInt64ArrayConstructor BigIntConstructor BigUint64Array
BigUint64ArrayConstructor Boolean BooleanConstructor CallableFunction ConcatArray
DataView DataViewConstructor Date DateConstructor Error ErrorConstructor EvalError
EvalErrorConstructor Float32Array Float32ArrayConstructor Float64Array
Float64ArrayConstructor Function FunctionConstructor Generator GeneratorFunction
GeneratorFunctionConstructor GlobalDescriptor IArguments ImportMeta Int16Array
Int16ArrayConstructor Int32Array Int32ArrayConstructor Int8Array Int8ArrayConstructor
Iterable IterableIterator Iterator IteratorReturnResult IteratorYieldResult JSON
LinkError Map MapConstructor Math Memory MemoryDescriptor Module
ModuleExportDescriptor ModuleImportDescriptor NewableFunction Number
NumberConstructor Object ObjectConstructor Promise PromiseConstructor
PromiseFulfilledResult PromiseLike PromiseRejectedResult PropertyDescriptor
PropertyDescriptorMap ProxyConstructor ProxyHandler RangeError RangeErrorConstructor
ReadonlyArray ReadonlyMap ReadonlySet ReferenceError ReferenceErrorConstructor
RegExp RegExpConstructor RegExpExecArray RegExpMatchArray RuntimeError Set
SetConstructor SharedArrayBuffer SharedArrayBufferConstructor String
StringConstructor Symbol SymbolConstructor SyntaxError SyntaxErrorConstructor Table
TableDescriptor TemplateStringsArray ThisType TypedPropertyDescriptor TypeError
TypeErrorConstructor URIError URIErrorConstructor URL URLSearchParams ValueTypeMap
WeakMap WeakMapConstructor WeakSet WeakSetConstructor WebAssemblyInstantiatedSource
Uint8Array Uint8ArrayConstructor Uint8ClampedArray Uint8ClampedArrayConstructor
Uint16Array Uint16ArrayConstructor Uint32Array Uint32ArrayConstructor
ArrayBufferConstructor AsyncGenerator AsyncGeneratorFunction
AsyncGeneratorFunctionConstructor AsyncIterable AsyncIterableIterator AsyncIterator
Generator GeneratorFunction GeneratorFunctionConstructor Gamepad
NaN Infinity eval parseInt parseFloat isNaN isFinite decodeURI decodeURIComponent
encodeURI encodeURIComponent escape unescape __dirname __filename undefined null
globalThis BigInt64Array BigUint64Array Reflect Intl
`.trim().split(/\s+/));

/* ---------------- 注释块 ---------------- */

/** 把一段 JSDoc 正文（已去掉 ` * ` 前缀）切成 { tag, text, raw } 序列。
 *  `{@link X}` 要先藏起来：它内部的 @link 长得就是一个标签，不藏的话
 *  "@zh 创建一个新的 {@link GameEntity} 或复制…" 会在 link 处被切断，后半句整段丢掉。 */
function docTokens(raw) {
  const held = [];
  const shielded = raw.replace(/\{@(\w+)([^}]*)\}/g, (_m, t, rest) => {
    held.push("{@" + t + rest + "}");
    return "\u0000" + (held.length - 1) + "\u0000";
  });
  const re = /@([a-zA-Z]+)/g;
  const marks = [];
  let lm;
  while ((lm = re.exec(shielded))) marks.push({ tag: lm[1], at: lm.index, end: re.lastIndex });
  const unstash = (s) => s.replace(/\u0000(\d+)\u0000/g, (_m, i) => held[+i]);
  const oneLine = (s) => unstash(s).replace(/\s+/g, " ").trim();
  const slice = (i) => {
    const mk = marks[i];
    return shielded.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : shielded.length);
  };
  return {
    head: oneLine(shielded.slice(0, marks.length ? marks[0].at : shielded.length)),
    toks: marks.map((mk, i) => ({ tag: mk.tag, text: oneLine(slice(i)), lines: lineize(unstash(slice(i))) })),
  };
}

/** 注释里的列表要保留换行（资源的 @param 用 "- 'mesh': …" 列了五种取值），
 *  但表格单元格里换行只能写成 <br>，所以在这里就转掉。 */
function lineize(s) {
  const rows = s.split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  // 首行不加点：它紧跟在 "参数名：" 后面，再加个符号就成了 "path：• 可选。"
  return rows.map((r, i) => (i === 0 || r.startsWith("-") ? r : "• " + r)).join("<br>");
}

/** 解析注释块 → { summary, params[], dep, example }。
 *  用一个 bucket 状态机而不是"看到 @zh 就拼摘要"：官方块里 @zh 会出现很多次
 *  （类型说明一次、每个参数一次），而且 @deprecated 后面也紧跟一个 @zh——
 *  不区分归属就会把"已废弃，请改用 X"糊进正常说明里，读起来像是 API 自相矛盾。 */
function parseDoc(blockLines) {
  const raw = blockLines.join("\n").replace(/^\s*\*\s?/gm, " ");
  const { head, toks } = docTokens(raw);
  const summary = [head], params = [], dep = [];
  let bucket = "summary", pending = null, example = "";
  const add = (text, to) => {
    if (!text) return;
    if (to === "summary") summary.push(text);
    else if (to === "dep") dep.push(text);
    else if (to === "param" && pending) pending.text = pending.text ? pending.text + "<br>" + text : text;
  };
  for (const tk of toks) {
    switch (tk.tag) {
      // 摘要要折成一行（它就是一句话）；参数说明保留换行（官方用 "- 'mesh': …" 列了五种取值）
      case "zh": {
        const to = bucket === "param" || bucket === "dep" ? bucket : "summary";
        add(to === "summary" ? tk.text : tk.lines, to); break;
      }
      case "param": case "params": {
        const nm = tk.text.replace(/^\{[^}]*\}\s*/, "").split(/\s+/)[0] || "";
        pending = { name: nm.replace(/[[\]]/g, ""), text: "" }; params.push(pending);
        bucket = "param"; break;
      }
      case "returns": case "return":
        pending = { name: "返回值", text: "" }; params.push(pending); bucket = "param"; break;
      case "deprecated": bucket = "dep"; add(tk.text, "dep"); break;
      case "example": bucket = "skip"; example = dedent(tk.lines.replace(/<br>/g, "\n")); break;
      default: bucket = "skip";   // @en / @category / @remarks：英文段与元信息不进中文表
    }
  }
  return {
    summary: summary.join(" ").replace(/\s+/g, " ").trim(),
    params: params.filter((p) => p.name && p.text).map((p) => `${p.name}：${p.text}`),
    dep: dep.join(" ").replace(/\s+/g, " ").trim(),
    example,
  };
}

/** @example 里的代码：注释前缀已被换成空格，去掉缩进与 ``` 围栏再返回 */
function dedent(s) {
  let lines = s.replace(/^\n+|\s+$/g, "").split("\n").map((x) => x.replace(/^\s+/, ""));
  if (lines[0] && /^```/.test(lines[0])) lines = lines.slice(1);
  if (lines.length && /^```$/.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
  return lines.join("\n").trim();
}

/* ---------------- 成员 ---------------- */

const MEMBER_RE = /^\s{2}(?:(?:static|readonly|get|set|async|new|abstract|override)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*[(:<]/;
const DECL_RE = /^(?:export\s+)?(?:declare\s+)?(class|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*\{/gm;
const CONST_RE = /^(?:export\s+)?declare\s+(?:const|var|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*/gm;
const FUNC_RE = /^(?:export\s+)?declare\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)(\([^{;]*)[;{]/gm;

/** 从 openBrace 之后扫到配对的 }，返回内部正文 */
function bodyOf(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return text.slice(openIdx + 1);
}

/** 注释块：吃整块（单行与跨行两种写法），返回 { doc, endLine }，找不到闭合返回 null */
function docBlockAt(lines, i) {
  const inline = /^\s*\/\*\*([\s\S]*?)\*\/\s*$/.exec(lines[i]);
  if (inline) return { doc: parseDoc([inline[1]]), end: i };
  const block = [];
  for (let k = i + 1; k < lines.length; k++) {
    const e = lines[k].indexOf("*/");
    if (e >= 0) { block.push(lines[k].slice(0, e)); return { doc: parseDoc(block), end: k }; }
    block.push(lines[k]);
  }
  return null;
}

/** 声明上方的那一个注释块。往前找"最后一个 @zh"会串味：没有文档的声明
 *  会把上一个个成员的说明认领过来，于是文档里出现张冠李戴的解释。 */
function docBefore(text, idx) {
  const before = text.slice(Math.max(0, idx - 6000), idx);
  const at = before.lastIndexOf("/**");
  if (at < 0) return parseDoc([]);
  const tail = before.slice(at);
  const end = tail.indexOf("*/");
  if (end < 0 || tail.slice(end + 2).trim()) return parseDoc([]);
  return parseDoc(tail.slice(3, end).split("\n"));
}

/** 从行 i 起把签名吃到深度 0 的分号。只吃几行就停的话，
 *  addCollisionFilter 这种多行签名会被截成 "( aSelector: GameSelectorString,"。 */
function sigFrom(lines, i) {
  let sig = "", depth = 0, j = i;
  for (; j < lines.length; j++) {
    const raw = lines[j].trim();
    sig += (sig ? " " : "") + raw;
    for (const ch of raw) { if ("({[<".includes(ch)) depth++; else if (")}]>".includes(ch)) depth--; }
    if (depth <= 0 && (raw.endsWith(";") || raw.endsWith(","))) break;
    if (j - i > 20) break;
  }
  return { sig: sig.replace(/[;,]$/, "").replace(/\s+/g, " ").trim(), end: j };
}

const NO_DOC = { summary: "", params: [], dep: "", example: "" };

/** 单趟扫描一个块体：注释先存住，紧接着的成员行认领它，认领不了就丢。
 *  无注释的成员也要收（重载的第二个签名就没注释），所以不能按"有注释"驱动。 */
function members(body) {
  const out = [];
  const lines = body.split("\n");
  let doc = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*\/\*\*/.test(ln)) {
      const blk = docBlockAt(lines, i);
      if (blk) { doc = blk.doc; i = blk.end; }
      continue;
    }
    if (!ln.trim() || /^\s*(\/\/|\*)/.test(ln)) continue;
    const m = MEMBER_RE.exec(ln);
    if (!m) { doc = null; continue; }
    const { sig, end } = sigFrom(lines, i);
    const prev = out[out.length - 1];
    const sameOverload = prev && prev.name === m[1];
    out.push({
      name: m[1],
      sig,
      // 同名相邻即重载：第二个签名没注释就沿用第一个的说明，别显示成空
      doc: doc ? doc.summary : sameOverload ? prev.doc : "",
      params: doc ? doc.params : sameOverload ? prev.params : [],
      dep: doc ? doc.dep : "",
      example: doc ? doc.example : "",
    });
    doc = null;
    i = end;
  }
  return out;
}

/** 脚本里直接可用的全局名字：declare const world: GameWorld、declare function sleep(…)。
 *  类型写成内联对象字面量的（resources、console）也要能列出成员，否则最有用的那几个反而没文档。 */
/** 脚本里直接可用的全局名字：declare const world: GameWorld、declare function sleep(…)。
 *  类型写成内联对象字面量的（resources、console）也要能列出成员，否则最有用的那几个反而没文档。
 *  同名只留一条：官方在标准库段落之后又重复声明了一次 sleep / setTimeout。 */
const NODE_ONLY = new Set(["module", "exports", "require", "process", "__dirname", "__filename"]);
function globalsOf(text, label) {
  const out = [];
  const push = (base, doc) => {
    if (NODE_ONLY.has(base.name)) return;
    out.push({ ...base, doc: doc.summary, params: doc.params, dep: doc.dep, example: doc.example });
  };
  for (const [re, kind] of [[CONST_RE, "const"], [FUNC_RE, "function"]]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (STD_LIB.has(name)) continue;
      const doc = docBefore(text, m.index);
      if (kind === "function") {
        push({ name, kind, type: "", sig: `function ${name}${m[2].trim()}`, members: [], file: label }, doc);
        continue;
      }
      const rest = text.slice(m.index + m[0].length);
      if (rest.startsWith("{")) {
        const body = bodyOf(text, text.indexOf("{", m.index + m[0].length - 1));
        push({ name, kind, type: "（内联对象）", sig: "", members: members(body), file: label }, doc);
        continue;
      }
      const nl = rest.indexOf("\n");
      const typeText = rest.slice(0, nl < 0 ? rest.length : nl).replace(/;\s*$/, "").trim();
      push({ name, kind, type: typeText, sig: "", members: [], file: label }, doc);
    }
  }
  const byName = new Map();
  for (const g of out) {
    const prev = byName.get(g.name);
    // 留下说明更完整的那一份，而不是先出现的那一份：标准库段落里的那条没有中文说明
    if (!prev || (prev.doc.length < g.doc.length)) byName.set(g.name, g);
  }
  return [...byName.values()];
}

function parseDecls(text, label) {
  const res = [];
  const seen = new Set();
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(text))) {
    const name = m[2];
    if (STD_LIB.has(name) || seen.has(name)) continue;
    seen.add(name);
    const body = bodyOf(text, m.index + m[0].length - 1);
    const doc = docBefore(text, m.index);
    res.push({
      kind: m[1], name, file: label, doc: doc.summary, dep: doc.dep,
      members: members(body),
    });
  }
  return res;
}

/* ---------------- 读入 ---------------- */
const texts = {};
for (const [label, rel] of SOURCES) {
  const t = readDts(rel);
  if (!t) { console.error(`找不到 ${rel}（上游参考仓库不入库，需先 clone，见 docs/dependencies.md）`); process.exit(1); }
  texts[label] = t;
}
const decls = SOURCES.map(([label]) => parseDecls(texts[label], label)).flat();
if (process.env.API_REF_DEBUG) {
  for (const [label] of SOURCES) {
    const ds = decls.filter((d) => d.file === label);
    console.error(`debug ${label}: ${ds.length} 类型，有类型说明的 ${ds.filter((d) => d.doc).length}，`
      + `成员 ${ds.reduce((s, d) => s + d.members.length, 0)}，前 5 个：${ds.slice(0, 5).map((d) => d.name).join(" ")}`);
  }
}
const globals = SOURCES.map(([label]) => globalsOf(texts[label], label)).flat()
  .filter((g) => g.doc || g.members.length);
for (const [label] of SOURCES) {
  const n = decls.filter((d) => d.file === label).length;
  if (!n) { console.error(`${label} 源解析出 0 个类型（${SOURCES.find((s) => s[0] === label)[1]} 结构变了？）`); process.exit(1); }
}

/* ---------------- 本地覆盖 ---------------- */
let covered = {};
const covPath = path.join(ROOT, "public/data/api-impl.json");
try { covered = JSON.parse(fs.readFileSync(covPath, "utf8")); } catch { covered = {}; }
const has = (iface, name) => Array.isArray(covered[iface]) && covered[iface].includes(name);
/** 只有 class 才谈"本地有没有这个成员"。interface 是数据形状（Config / Keyframe /
 *  Event 的字段），名字散落在赋值里，静态比对既不能证实也不能证伪，一律给 —，
 *  否则文档会报出 306 个"缺"，把真正缺的 21 个淹掉。 */
const trackedOf = (d) => d.kind === "class" && Array.isArray(covered[d.name]);
const tracked = (name) => Array.isArray(covered[name]);   // 全局对象表按类型名查

/* ---------------- 分组 ---------------- */
/* ---------------- 分组 ----------------
 * 不加 i 标志：^Ui 在忽略大小写时会把 Uint8Array 也算进"客户端界面"，
 * 标准库噪音就是这样从黑名单里漏过去的。 */
const GROUPS = [
  ["世界与实体", /^Game(World|Entity|Player|Motion|Trigger|Zone|Wearable|Hurt|Query|Raycast|FluidContact|VoxelContact|Animation|Sound)/],
  ["方块与体素", /^(GameVoxels?|Voxel|Snow)/],
  ["事件对象", /Event$/],
  ["值与配置", /^Game(Vector3|Bounds3|RGBColor|RGBAColor|Quaternion|Easing|Camera|Input|Walk|Move|Body|Social|Asset|Log|Dialog|Button|PointerType|ImageDisplay|Keyframe|Config|Type|QueryResult|EventHandlerToken|Data)/],
  ["客户端界面", /^(Ui|UI|Vec|Coord|Audio|Media|EventEmitter|Pointer|ImageDisplay|Client|InputSystem|Device|Sound|Headers|Response|Request|Fetch|Abort|Blob|BodyMixin)/],
  ["平台与网络", /^(Game(Http|RTC|Data|Database|Storage|Analytics|Sensor|GUI|Asset)|Server|Query|GUI|Social)/],
];
const GROUP_DESC = {
  "世界与实体": "world / player / entity：跑图时最常碰的那一圈",
  "方块与体素": "voxels 全局对象与体素读写",
  "事件对象": "各 on* / next* 通道回调拿到的事件",
  "值与配置": "构造与传值用的形状：向量、颜色、关键帧、配置",
  "客户端界面": "ClientAPI：ui / input / screen / media / audio",
  "平台与网络": "http / rtc / storage / db / analytics / gui",
};
function groupOf(name) {
  for (const [g, re] of GROUPS) if (re.test(name)) return g;
  return "其它类型";
}
GROUP_DESC["其它类型"] = "没有归进上面几组的声明";

const byGroup = new Map();
for (const d of decls) {
  const g = groupOf(d.name);
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push(d);
}
for (const list of byGroup.values()) list.sort((a, b) => a.name.localeCompare(b.name));
const order = [...GROUPS.map((g) => g[0]), "其它类型"].filter((g) => byGroup.has(g));
const TYPES = new Set(decls.map((d) => d.name));

/* ---------------- 生成 ---------------- */
const totalMembers = decls.reduce((s, d) => s + d.members.length, 0);
const withDoc = decls.reduce((s, d) => s + d.members.filter((m) => m.doc).length, 0);
const L = [];
L.push("# API 参考");
L.push("");
L.push("> **本页由 `npm run build:api-ref` 从官方类型声明自动生成，不要手改。**");
L.push("> 来源：" + SOURCES.map(([l, p]) => `\`${p}\`（${l === "server" ? "服务端" : "客户端"}）`).join(" 与 ") + "；");
L.push("> 本地覆盖列比对 `public/data/api-impl.json`（`npm run audit:api` 产出）。");
L.push("");
L.push(`共 **${decls.length} 个类型**、**${totalMembers} 个成员**，其中 ${withDoc} 个带官方中文说明。`);
L.push("");
L.push("## 怎么读这张表");
L.push("");
L.push("- **说明**里的单位一律照抄官方注释。这套 API 最容易错的就是单位：速度是 **格/tick**（20 tick/秒）"
  + "而不是格/秒，`duration` 是**毫秒**，距离是**米＝格**。详见[物理与单位制](physics.md)。");
L.push("- **本地**列：✅ 表示本地实现里有这个成员；**缺** 表示官方声明里有、本地找不到——"
  + "脚本里用了就是 `undefined`。判定来自 `npm run audit:api` 的**静态比对**（在运行时源码里找这个名字），"
  + "不是逐个真调用；`GameWorld / GameEntity / GamePlayer / GameVoxels` 这四类另有浏览器内的真运行时对账"
  + "（`public/js/api-probe.js`，`test/e2e.mjs` 每次都会跑），那四类可以放心当实测结论。");
L.push("- 标注 **已废弃** 的成员官方不建议再用，本页仍保留，因为老地图的脚本里还在调。");
L.push("- 说明里的 `•` 行是官方 `@param` 逐条参数说明，顺序与签名一致。");
L.push("- 只想把地图跑起来、不打算写脚本：看应用内的游玩手册（工作台左侧「手册」，本地地址 <code>/manual</code>）。");
L.push("- 想按主题读而不是按类型查：[官方 API 兼容层](api-compat.md)；单位与物理口径：[物理与单位制](physics.md)。");
L.push("");

L.push("## 全局对象");
L.push("");
L.push("脚本里不需要 import、直接就能写的那些名字。**服务端**指 `?play` 里跑的那份逻辑，"
  + "**客户端**只在 `ui` 沙箱里可见。同名两端都有的是两个不同对象（比如 `world`）。");
L.push("");
L.push("| 名字 | 端 | 类型 | 说明 | 本地 |");
L.push("| --- | --- | --- | --- | --- |");
for (const g of globals) {
  const cells = [];
  if (g.doc) cells.push(linkify(g.doc, TYPES));
  if (g.dep) cells.push(`**已废弃**：${linkify(g.dep, TYPES)}`);
  L.push(`| \`${esc(g.name)}\` | ${g.file === "client" ? "客户端" : "服务端"} `
    + `| ${g.type ? "`" + esc(g.type) + "`" : "`" + esc(clip(g.sig, 90)) + "`"} `
    + `| ${esc(cells.join("<br>") || "—")} | ${tracked(g.type) || tracked(cap(g.name)) ? "✅" : "—"} |`);
}
L.push("");
for (const g of globals.filter((x) => x.members.length)) {
  L.push(`### ${g.name}`);
  L.push("");
  L.push(`*内联对象 · ${g.file === "client" ? "ClientAPI" : "GameAPI"}*`);
  if (g.doc) L.push("", "> " + linkify(g.doc, TYPES));
  L.push("");
  L.push("| 成员 | 签名 | 说明 |");
  L.push("| --- | --- | --- |");
  for (const mm of g.members) L.push(memberRow(mm, null));
  L.push("");
}

L.push("## 目录");
L.push("");
for (const gn of order) {
  L.push(`### ${gn}`);
  L.push("");
  L.push(byGroup.get(gn).map((d) => `[${d.name}](#${slug(d.name)})`).join(" · "));
  L.push("");
}

for (const gn of order) {
  L.push(`## ${gn}`);
  L.push("");
  L.push(`_${GROUP_DESC[gn]}_`);
  L.push("");
  for (const d of byGroup.get(gn)) {
    L.push(`### ${d.name}`);
    L.push("");
    L.push(`*${d.kind} · ${d.file === "client" ? "ClientAPI" : "GameAPI"}*`);
    const head = [];
    if (d.doc) head.push(linkify(d.doc, TYPES));
    if (d.dep) head.push(`**已废弃**：${linkify(d.dep, TYPES)}`);
    if (head.length) L.push("", "> " + head.join(" "));
    L.push("");
    if (!d.members.length) { L.push("_（无成员级声明：枚举或纯数据形状。）_", ""); continue; }
    const tracked = trackedOf(d);
    L.push(`| 成员 | 签名 | 说明 |${tracked ? " 本地 |" : ""}`);
    L.push(`| --- | --- | --- |${tracked ? " --- |" : ""}`);
    for (const mm of d.members) {
      L.push(memberRow(mm, tracked ? (has(d.name, mm.name) ? "✅" : "**缺**") : "—"));
    }
    L.push("");
    for (const mm of d.members.filter((x) => x.example)) {
      L.push(`\`${d.name}.${mm.name}\` 官方示例：`);
      L.push("");
      L.push("```ts");
      L.push(mm.example);
      L.push("```");
      L.push("");
    }
  }
}

L.push("---");
L.push("");
L.push("本页是生成物：改了官方声明或补了实现，跑 `npm run audit:api && npm run build:api-ref` 重新生成，"
  + "不要直接编辑 `docs/api-reference.md`。上游参考仓库需要先在 `vendor/` 下 clone，见[依赖清单](dependencies.md)。");
L.push("");

fs.writeFileSync(OUT, L.join("\n"));
console.log(`api-reference.md ← ${decls.length} 个类型 / ${totalMembers} 个成员 / `
  + `${withDoc} 条官方中文说明 / ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
if (!totalMembers || !withDoc) { console.error("解析结果为空，生成物不可用"); process.exit(1); }

/* ---------------- 渲染小工具 ---------------- */
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function clip(s, n) {
  const t = String(s).trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t;
}
/** mark 传 null 表示这一类没有"本地"列（内联对象全局变量下面的那张小表） */
function memberRow(mm, mark) {
  const cells = [];
  if (mm.doc) cells.push(linkify(mm.doc, TYPES));
  if (mm.dep) cells.push(`**已废弃**：${linkify(mm.dep, TYPES)}`);
  for (const p of mm.params) cells.push(`• ${linkify(p, TYPES)}`);
  const doc = esc(cells.map((c) => clip(c, 400)).join("<br>"));
  const tail = mark === null ? "" : ` ${mark} |`;
  return `| \`${esc(mm.name)}\` | \`${esc(clip(mm.sig, 220))}\` | ${doc || "—"} |${tail}`;
}
