import { compileBlocks } from "../public/js/blocks.js";
import { checkSyntax } from "../public/js/ai.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + extra : "")); }
};

const src = compileBlocks([
  { type: "var_set", f: { name: "entity", value: "1" }, children: [] },
  { type: "var_set", f: { name: "tick", value: "2" }, children: [] },
  { type: "var_set", f: { name: "得分", value: "3" }, children: [] },
]);
ok("变量名不会覆盖事件回调的 entity / tick", !/\blet\s+(entity|tick)\b/.test(src), src);
ok("中文合法变量名保持原样", /let 得分 = null/.test(src), src);
ok("生成代码通过语法检查", checkSyntax(src).ok, checkSyntax(src).error || "");

const nested = compileBlocks([{ type: "on_tick", f: { every: 20 }, children: [
  { type: "repeat", f: { n: 3 }, children: [{ type: "world_say", f: { msg: "hi" }, children: [] }] },
] }]);
ok("事件与循环容器生成可执行结构", /world\.onTick/.test(nested) && /for \(let i = 0; i < 3; i\+\+\)/.test(nested), nested);

console.log(`\nblocks: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
