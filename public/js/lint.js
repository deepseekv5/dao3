// lint.js — 脚本页「检查严格度」背后的真实检查。
//
// 为什么不是把面板画出来就完事：官方那一栏里有几项是 TypeScript 检查器
// （允许检查脚本 / 禁止隐式any / 严格空值检查 / 禁止隐式this / 未使用局部变量）。
// 本实现没有 TS，所以**能真做的就真做，做不到的就明说做不到**——
// 勾了却什么都不发生的开关比没有开关更糟，它会让人以为自己的代码被查过了。

/** 官方明确会返回 undefined 的取物接口：直接 .foo 上去就是运行时炸点。 */
const NULLABLE = /\b(world|w|rt)\.(querySelector|querySelectorEntity|getById|getEntityByName|getPlayerByName)\s*\(|\bstorage\.(getDataStorage|getGroupStorage)\s*\([^)]*\)\s*\.\s*get\s*\(/g;
/** 只读的官方属性：赋值进去不会报错，但也不会生效——所以必须报。 */
const READONLY_API = /\b(world)\.(projectName|mapName|mapId|projectId)\s*=/g;
const DECL = /(?:^|[;{}\n])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const FUNC = /(?:^|[;{}\n])\s*function\s*\*?\s*([A-Za-z_$][\w$]*)/g;
const WORD = /[A-Za-z_$][\w$]*/g;
/** 去掉字符串、模板串、正则与注释，避免把文本里的单词当成标识符。 */
function stripNoise(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, ' "" ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, ' "" ')
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' "" ');
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;

/**
 * @param code 脚本正文
 * @param opts meta.scriptChecks：{ enabled, nullable, unused, readonly }
 * @returns [{ line, rule, msg, sev }]  sev: "error" | "warn" | "info"
 */
export function lintScript(code, opts = {}) {
  if (!opts.enabled || !code || !code.trim()) return [];
  const src = stripNoise(code);
  const out = [];

  if (opts.noUnusedLocals) {
    const decls = [];
    for (const re of [DECL, FUNC]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) decls.push({ name: m[1], at: m.index + m[0].indexOf(m[1]) });
    }
    for (const d of decls) {
      if (d.name.startsWith("_")) continue;
      const re = new RegExp(`\\b${d.name.replace(/\$/g, "\\$")}\\b`, "g");
      let n = 0;
      while (re.exec(src)) n++;
      // 声明本身占一次；再赋过值也只算写了没读，这里不区分读写——
      // 所以这一条只报"整个名字只出现过一次"的情况，宁可漏报不误报。
      if (n <= 1) out.push({ line: lineOf(code, d.at), rule: "未使用局部变量", msg: `局部变量「${d.name}」声明后没有被引用`, sev: "info" });
    }
  }

  const on = (k) => opts[k] !== false;
  for (const [re, rule, msg, want, sev] of [
    [NULLABLE, "严格空值检查", "这个官方接口可能返回 undefined，直接取属性会抛错；先判空或走 ?.value", "strictNullChecks", "warn"],
    [READONLY_API, "只读官方属性", "官方把这个属性定义为只读，赋值不会生效", "readonlyApi", "error"],
  ]) {
    if (!on(want)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) out.push({ line: lineOf(code, m.index), rule, msg, sev });
  }

  return out.sort((a, b) => a.line - b.line);
}

/* ---- 符号：给「大纲」和函数上方的行内动作条用 ---- */
// 只认四种最常见的定义写法。对象方法/类方法故意不做：正则误判率高，
// 列出来的"符号"点下去跳错位置，比少列几类更伤。
const SYMBOL = [
  [/(?:^|[;{}\n])\s*(?:export\s+)?async\s+function\s*\*?\s*([A-Za-z_$][\w$]*)/g, "函数"],
  [/(?:^|[;{}\n])\s*(?:export\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g, "函数"],
  [/(?:^|[;{}\n])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, "箭头函数"],
  [/(?:^|[;{}\n])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g, "函数"],
  [/(?:^|[;{}\n])\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g, "类"],
];
/** @returns [{ name, kind, line }] 行号 1 基，和诊断同一口径 */
export function symbolsOf(code) {
  const src = stripNoise(String(code || ""));
  const seen = new Set(), out = [];
  for (const [re, kind] of SYMBOL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, kind, line: lineOf(code, m.index + m[0].indexOf(name)) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** 面板要列的项。available:false 的一律禁用并说明原因，不做哑开关。 */
export const CHECK_GROUPS = [
  { title: "基础选项", items: [
    { key: "enabled", label: "允许检查脚本", hint: "在 .js 文件中报告错误" },
  ] },
  { title: "类型检查", items: [
    { key: "noImplicitAny", label: "禁止隐式 any", tsOnly: true },
    { key: "strictNullChecks", label: "严格空值检查", hint: "官方接口可能返回 undefined 时提示" },
    { key: "noImplicitThis", label: "禁止隐式 this", tsOnly: true },
  ] },
  { title: "代码质量", items: [
    { key: "noUnusedLocals", label: "未使用局部变量" },
    { key: "readonlyApi", label: "给只读官方属性赋值" },
  ] },
];
export const TS_ONLY_NOTE = "本实现不跑 TypeScript 检查器，这一项点了也不会生效";
