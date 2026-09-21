// scripts/api-audit.mjs — 机械比对：官方 GameAPI.d.ts 的成员 vs 我们的运行时实现
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dts = fs.readFileSync(path.join(ROOT, "vendor/ArenaPro-CLI/server/types/GameAPI.d.ts"), "utf8").split("\n");

function members(className) {
  const i = dts.findIndex((l) => l.includes(className));
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < dts.length; j++) {
    const l = dts[j];
    if (/^\}/.test(l)) break;
    if (/^\s*(private|\/\*|\*|\/\/)/.test(l)) continue;
    const m = l.match(/^  (?:readonly )?([a-zA-Z_][a-zA-Z0-9_]*)\s*[:?(]/);
    if (m) {
      // 官方 d.ts 用「name: (…) => T」表达方法，「name: string」表达属性；简写方法 name(…) 也是方法
      const after = l.slice(m.index + 2 + m[1].length);
      const callable = after.startsWith("(") || /^\s*:\s*\(/.test(after) || /^\s*\(/.test(after);
      out.push({ name: m[1], callable });
    }
  }
  const seen = new Set();
  return out.filter((e) => !seen.has(e.name) && seen.add(e.name));
}

const sources = ["public/js/game.js", "public/js/gapi.js"]
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");

const wordRe = {};
function implemented(name) {
  if (!wordRe[name]) wordRe[name] = new RegExp(`(^|[^$A-Za-z0-9_])${name}($|[^A-Za-z0-9_])`);
  return wordRe[name].test(sources);
}

const groups = {
  GameWorld: members("declare class GameWorld {"),
  GameEntity: members("declare class GameEntity implements"),
  GamePlayer: members("declare class GamePlayer {"),
  GameVoxels: members("declare class GameVoxels {"),
};
let total = 0, missingAll = [];
for (const [k, list] of Object.entries(groups)) {
  const names = list.map((e) => e.name);
  const missing = names.filter((n) => !implemented(n));
  total += names.length;
  missingAll = missingAll.concat(missing.map((m) => `${k}.${m}`));
  console.log(`${k}: 官方成员 ${names.length} · 已实现 ${names.length - missing.length} · 缺失 ${missing.length} · 其中可调方法 ${list.filter((e) => e.callable).length}`);
  if (missing.length) console.log("   缺失 → " + missing.join(", "));
}
console.log(`\n合计 ${total} 个官方成员，缺失 ${missingAll.length}（覆盖 ${(100 * (total - missingAll.length) / total).toFixed(1)}%）`);

// 事件通道必须成对：on* 与 next*
const evNames = new Set();
for (const l of dts) {
  const m = l.match(/^  (on|next)([A-Z][a-zA-Z0-9_]*)\s*:/);
  if (m) evNames.add(m[2]);
}
const evMiss = [...evNames].filter((n) => !(`on` + n) || !implemented("on" + n) || !implemented("next" + n));
console.log(`\n官方事件 ${evNames.size} 类；on*/next* 未成对实现：${evMiss.length ? evMiss.join(", ") : "无"}`);
console.log("（注：on*/next* 由 attachChannels 动态挂载，静态文本搜不到，需配合运行时探针）");

// 导出官方成员表，供浏览器内运行时一致性探针使用
const CLASSES = ["GameWorld", "GameEntity", "GamePlayer", "GameVoxels"];
fs.writeFileSync(path.join(ROOT, "public/data/api-members.json"), JSON.stringify(
  Object.fromEntries(CLASSES.map((c) => [c, groups[c].map((e) => e.name)]))
));
// 方法名单独存一份：探针要按「必须是函数」校验，避免把方法实现成属性
fs.writeFileSync(path.join(ROOT, "public/data/api-methods.json"), JSON.stringify(
  Object.fromEntries(CLASSES.map((c) => [c, groups[c].filter((e) => e.callable).map((e) => e.name)]))
));
console.log("已写出 public/data/api-members.json 与 api-methods.json（运行时探针用）");
