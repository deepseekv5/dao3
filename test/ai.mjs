// ai.mjs — AI 产出解析与体素程序校验/展开的纯函数测试（不开浏览器、不联网）。
// 运行：node test/ai.mjs
//
// 为什么单独一套：这些函数是"AI 说什么都不许把编辑器搞坏"的唯一闸门。
// 它们必须在**没有密钥、没有网络**的条件下可验证，否则 CI 与离线开发都测不到。
import { extractCode, extractJson, validateVoxelProgram, programToVoxels, configGaps } from "../public/js/ai.js";

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "   " + extra : ""));
  if (!cond) fails++;
};

console.log("== 代码块提取 ==");
ok("取 ```js 围栏", extractCode("说明\n```js\nworld.say(1);\n```\n尾巴") === "world.say(1);");
ok("无围栏时原样返回", extractCode("plain code") === "plain code");
ok("多段围栏拼接", extractCode("```js\na()\n```\n中间话\n```js\nb()\n```").split("\n\n").length === 2);
ok("识别 ```javascript", extractCode("```javascript\nx=1\n```") === "x=1");
ok("忽略非代码围栏的语言标记但保留内容", extractCode("```json\n{\"a\":1}\n```") === '{"a":1}');
ok("CRLF 也能取", extractCode("```js\r\na()\r\n```") === "a()");

console.log("== JSON 提取 ==");
ok("围栏里的 JSON", extractJson('```json\n{"name":"x"}\n```').name === "x");
ok("裸 JSON 带前后废话", extractJson('好的：{"name":"y"} 就这样').name === "y");
let threw = false; try { extractJson("这里没有对象"); } catch { threw = true; }
ok("没有 JSON 时抛错而不是返回 undefined", threw);

console.log("== 体素程序校验：越界与配额 ==");
function count(prog) { return prog.models.reduce((a, m) => a + m.parts.reduce((b, p) => b + programToVoxels(p).length, 0), 0); }
{
  const r = validateVoxelProgram({
    name: "塔", parts: [{ name: "底座", size: [12, 4, 12], prims: [
      { shape: "box", from: [0, 0, 0], to: [11, 3, 11], color: "#6b6b6b" },
    ] }],
  });
  ok("合法程序原样通过", r.models.length === 1 && count(r) === 12 * 4 * 12, `${count(r)} 体素`);
}
{
  const r = validateVoxelProgram({
    parts: [{ name: "p", size: [12, 12, 12], prims: [
      { shape: "box", from: [0, 0, 0], to: [11, 11, 11], color: "#6b6b6b" },
      { shape: "box", from: [0, 0, 0], to: [99, 99, 99], color: "#ff0000" },   // 离谱越界
      { shape: "pyramid", from: [0, 0, 0], to: [4, 4, 4], color: "#00ff00" }, // 不认识的 shape
    ] }],
  });
  ok("离谱越界的图元被丢弃（而不是夹成填满整框）", r.dropped === 2, `丢弃 ${r.dropped}`);
  ok("丢掉的部分不影响可用部分", count(r) === 12 * 12 * 12, `${count(r)} 体素`);
}
{
  // off-by-one 是模型最常见的写法错误：size 12 却写 to:[12,..]，应该夹回来而不是丢
  const r = validateVoxelProgram({ parts: [{ size: [12, 12, 12], prims: [
    { shape: "box", from: [0, 0, 0], to: [12, 12, 12], color: "#abcdef" }] }] });
  ok("off-by-one 被夹回合法范围", r.dropped === 0 && count(r) === 12 * 12 * 12, `丢弃 ${r.dropped}`);
}
{
  const r = validateVoxelProgram({ parts: [{ size: [16, 16, 16], prims: [
    { shape: "sphere", center: [8, 8, 8], radii: [4, 4, 4], color: "#111111" }] }] });
  const n = count(r);
  ok("球体展开且体积合理", n > 200 && n < 500, `${n} 体素`);
}
{
  const r = validateVoxelProgram({ parts: [{ size: [16, 16, 16], prims: [
    { shape: "cylinder", center: [8, 8, 8], axis: "y", radius: 3, height: 10, color: "#222222" }] }] });
  ok("圆柱展开", Math.abs(count(r) - Math.PI * 9 * 10) < 40, `${count(r)} 体素`);
}
{
  const r = validateVoxelProgram({ parts: [{ size: [10, 10, 10], prims: [
    { shape: "box", from: [0, 0, 0], to: [9, 9, 9], color: "#333", shell: true }] }] });
  ok("shell 只留外壳", count(r) === 10 * 10 * 10 - 8 * 8 * 8, `${count(r)} 体素`);
}
{
  const prims = [];
  for (let i = 0; i < 900; i++) prims.push({ shape: "box", from: [0, 0, 0], to: [1, 1, 1], color: "#444" });
  const r = validateVoxelProgram({ parts: [{ size: [8, 8, 8], prims }] });
  ok("图元数量有上限", r.models[0].parts[0].prims.length <= 400, `${r.models[0].parts[0].prims.length} 个`);
}
{
  // 64³ 实心块 = 26 万格，超过总体素配额。体素编辑器里没人要实心立方体，
  // 所以这里**明确报错**比"给你一半的墙"更好：错误文案要能看出是配额问题。
  let msg = "";
  try { validateVoxelProgram({ parts: [{ size: [64, 64, 64], prims: [{ shape: "box", from: [0, 0, 0], to: [63, 63, 63], color: "#555" }] }] }); }
  catch (e) { msg = e.message; }
  ok("超配额的实心大块明确报错", /配额/.test(msg), msg);
  const mixed = validateVoxelProgram({ parts: [{ size: [64, 64, 64], prims: [
    { shape: "box", from: [0, 0, 0], to: [63, 63, 63], color: "#555" },
    { shape: "box", from: [0, 0, 0], to: [9, 9, 9], color: "#666" }] }] });
  ok("超配额的图元丢掉后，其余照常可用", mixed.dropped === 1 && count(mixed) === 1000, `${count(mixed)} 体素`);
}
{
  const r = validateVoxelProgram({ parts: [{ size: [200, 200, 200], prims: [{ shape: "box", from: [0, 0, 0], to: [1, 1, 1], color: "#666" }] }] });
  const s = r.models[0].parts[0].size;
  ok("部件框被夹到 64", s.every((v) => v <= 64), JSON.stringify(s));
}
{
  let threw = false;
  try { validateVoxelProgram({ parts: [{ size: [8, 8, 8], prims: [{ shape: "box", from: [0, 0, 0], to: [99, 99, 99] }] }] }); }
  catch { threw = true; }
  ok("全丢光时抛错而不是生成空部件", threw);
}
{
  const r = validateVoxelProgram({ parts: [{ size: [8, 8, 8], prims: [{ shape: "box", from: [0, 0, 0], to: [3, 3, 3], color: "not-a-hex" }] }] });
  const v = programToVoxels(r.models[0].parts[0])[0];
  ok("坏颜色退化成灰而不是 undefined", /^#[0-9a-f]{6}$/.test(v.color), v.color);
}
{
  const r = validateVoxelProgram({ models: [{ name: "A", parts: [{ size: [6, 6, 6], prims: [{ shape: "box", from: [0, 0, 0], to: [5, 5, 5], color: "#abcabc" }] }] }, { name: "B", parts: [{ size: [6, 6, 6], prims: [{ shape: "sphere", center: [3, 3, 3], radii: 2, color: "#defdef" }] }] }] });
  ok("models 数组形态支持多模型", r.models.length === 2 && programToVoxels(r.models[1].parts[0]).length > 10);
}

console.log("== 展开的确定性：同一程序两次展开必须逐格相同 ==");
{
  const prog = { parts: [{ size: [14, 14, 14], prims: [
    { shape: "box", from: [1, 0, 1], to: [12, 5, 12], color: "#8a5a2b" },
    { shape: "sphere", center: [7, 9, 7], radii: [4, 3, 4], color: "#f2c14e" }] }] };
  const v1 = JSON.stringify(programToVoxels(validateVoxelProgram(prog).models[0].parts[0]));
  const v2 = JSON.stringify(programToVoxels(validateVoxelProgram(prog).models[0].parts[0]));
  ok("两次展开完全一致", v1 === v2, `${v1.length} 字节`);
  const vox = JSON.parse(v1);
  ok("坐标都在部件框内", vox.every((v) => v.x >= 0 && v.x < 14 && v.y >= 0 && v.y < 14 && v.z >= 0 && v.z < 14));
  ok("没有重复坐标（Map 去重）", new Set(vox.map((v) => `${v.x},${v.y},${v.z}`)).size === vox.length);
}

console.log("== 配置缺口提示（Node 里没有 localStorage，必须不崩） ==");
{
  let gaps = null, crashed = null;
  try { gaps = configGaps(); } catch (e) { crashed = e.message; }
  // 地址与模型有默认值，所以没配过的唯一缺口就是密钥——这条同时守住
  // "Node 里没有 localStorage 也不能抛 ReferenceError"。
  ok("取不到存储时按未配置处理", !crashed && Array.isArray(gaps) && gaps.join("、") === "密钥", crashed || (gaps.join("、") || "无缺口"));
}

console.log("== 交给 AI 的开发规范（单一来源，不许腐烂） ==");
{
  const fs = await import("node:fs");
  const spec = JSON.parse(fs.readFileSync(new URL("../public/data/api-spec.json", import.meta.url), "utf8"));
  const official = JSON.parse(fs.readFileSync(new URL("../public/data/api-members.json", import.meta.url), "utf8"));
  const impl = JSON.parse(fs.readFileSync(new URL("../public/data/api-impl.json", import.meta.url), "utf8"));
  const { PITFALLS, forbiddenMembers, specBrief } = await import("../public/js/ai-spec.js");

  // 方向要搞对：规格来自 build-api-ref 对 d.ts 的解析，覆盖面**比 api-audit 广**
  // （它连 interface 与嵌套声明都收，audit 只认顶层 class）。所以该断的是
  // "官方清单里的东西规格里都得有"，反过来要求相等只会把 audit 的漏网当成规格的错。
  // 外来类型（Response/Headers/Blob…）被规格有意排除，口径从生成器里读，不在这再抄一份
  const genSrc = fs.readFileSync(new URL("../scripts/build-api-ref.mjs", import.meta.url), "utf8");
  const fm = genSrc.match(/const FOREIGN_TYPES = new Set\(\[([^\]]*)\]/);
  const foreign = new Set(((fm && fm[1]) || "").match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
  const notCovered = Object.entries(official).filter(([c, ms]) =>
    !foreign.has(c) && (!spec.classes[c] || ms.some((n) => !spec.classes[c].m[n])));
  ok("规格完整覆盖官方清单（audit 认到的，AI 也必须看得到）", notCovered.length === 0,
    notCovered.map(([c]) => c).join(", ") || `${Object.keys(official).length} 个类全覆盖`);
  const specOnly = Object.keys(spec.classes).filter((c) => !Array.isArray(official[c]));
  const specOnlyClasses = specOnly.filter((c) => spec.classes[c].kind === "class");
  console.log(`NOTE  规格比官方清单多出 ${specOnly.length} 项（interface ${specOnly.length - specOnlyClasses.length} 个属正常；`
    + `class ${specOnlyClasses.length} 个是 audit 的漏网）` + (specOnlyClasses.length ? `：${specOnlyClasses.join(", ")}` : ""));
  const flagged = Object.entries(spec.classes).flatMap(([c, d]) => Object.entries(d.m).filter(([, m]) => m.i === 0).map(([n]) => [c, n]));
  ok("标为未实现的成员，确实不在 api-impl 里", flagged.every(([c, n]) => !(Array.isArray(impl[c]) && impl[c].includes(n))),
    flagged.map(([c, n]) => c + "." + n).join(", ") || "（无）");
  ok("禁用清单由数据算出，而不是手抄名单", forbiddenMembers(spec).length === flagged.length,
    forbiddenMembers(spec).join(", ") || "空");
  ok("未实现的成员不会混进可用 API 面", !Object.entries(spec.classes).some(([c, d]) => d.tracked === 1 && Object.values(d.m).some((m) => m.i === 0) && forbiddenMembers(spec).length === 0));

  // 语义陷阱条目是手写的（语义没法自动生成），但它引用的成员一旦被改名，
  // 这条规范就成了空话——所以要钉住它确实指向规格里存在的东西。
  const missing = PITFALLS.filter((p) => {
    if (p.api.startsWith("global:")) return false;   // 全局函数由 apiDigest 的可用面保证，不在类表里
    const [c, n] = [p.api.split(".")[0], p.api.split(".")[1]];
    if (!spec.classes[c]) return true;
    if (n && !spec.classes[c].m[n]) return true;
    return false;
  }).map((p) => p.api);
  ok("每条陷阱清单引用的 API 都真实存在", missing.length === 0, missing.join(", ") || `${PITFALLS.length} 条`);
  ok("每条陷阱都带 rule 文本", PITFALLS.every((p) => p.rule && p.rule.length > 20));

  // 常量必须是 import 来的：这里断言 brief 里出现的就是 gapi.js 的真值
  const { TICK_MS, PLAYER_DEFAULTS, WORLD_DEFAULTS, ENTITY_QUOTA, STEP_UP } = await import("../public/js/gapi.js");
  const brief = specBrief("server", { api: "A", forbidden: ["GameDatabase.sql"], names: "grass" });
  ok("规范里的速度/重力就是运行时的真值（没有第二份数字）",
    brief.includes(`walkSpeed ${PLAYER_DEFAULTS.walkSpeed}`) && brief.includes(`runSpeed ${PLAYER_DEFAULTS.runSpeed}`)
    && brief.includes(`gravity ${WORLD_DEFAULTS.gravity}`) && brief.includes(`${TICK_MS}ms`)
    && brief.includes(String(ENTITY_QUOTA)) && brief.includes(`自动踏步高度 ${STEP_UP}`));
  ok("禁用项带 ✗ 出现在规范里", /✗ GameDatabase\.sql/.test(brief));
  ok("服务端与客户端规范分别约束 UI 与全局的差别",
    specBrief("client", { api: "A", forbidden: [], names: "" }).includes("客户端") && !specBrief("client", { api: "A", forbidden: [], names: "" }).includes("world.gui()"));
  ok("沙箱规范不提官方 API，只列 sb.*", (() => {
    const b = specBrief("sandbox", { names: "grass" });
    return b.includes("sb.set") && b.includes("没有") && !b.includes("world.onTick");
  })());

  // 建模那条链的规范不在 api-spec 里，而是写在 voxa/ai-model.js 的提示词里。
  // 它一旦和校验器的常量脱钩，被丢掉图元的是用户，看起来却像"AI 建模不行"，
  // 所以直接拿**插值之后**的成品来对账：提示词里出现的限额必须就是校验器用的那组数。
  const { VOXEL_LIMITS } = await import("../public/js/ai.js");
  const { systemPrompt: modelPrompt } = await import("../public/js/voxa/ai-model.js");
  const mp = modelPrompt();
  ok("建模提示词把限额写全了", mp.includes(`1..${VOXEL_LIMITS.size}`)
    && mp.includes(`最多 ${VOXEL_LIMITS.prims} 个图元`)
    && mp.includes(`最多 ${VOXEL_LIMITS.parts} 个部件`)
    && mp.includes(VOXEL_LIMITS.voxels.toLocaleString()), mp.match(/最多 [^\n]+/g)?.join(" / ") || "");
  ok("建模提示词没有残留未插值的占位符", !/\$\{/.test(mp));
  ok("建模限额本身还是那几个数（改了要连提示词一起改）",
    VOXEL_LIMITS.parts === 16 && VOXEL_LIMITS.size === 64 && VOXEL_LIMITS.prims === 400 && VOXEL_LIMITS.voxels === 60000,
    JSON.stringify(VOXEL_LIMITS));
  // 提示词说"违反的部分会被程序丢弃"，那校验器就必须真的按这些数丢，
  // 否则这句话是在骗模型（也骗用户）。
  const big = validateVoxelProgram({ parts: Array.from({ length: 30 }, (_, i) => ({ name: "p" + i, size: [4, 4, 4], prims: [{ shape: "box", from: [0, 0, 0], to: [3, 3, 3], color: "#777" }] })) });
  ok("校验器丢件的数量与提示词说的一致", big.models[0].parts.length === VOXEL_LIMITS.parts,
    `${big.models[0].parts.length} / 声明 ${VOXEL_LIMITS.parts}`);
}

console.log("== Agent 动作协议：它想干什么，都得先过这一关 ==");
{
  const A = await import("../public/js/ai-agent.js");
  const { parseAction, sanitizeAction, normalizeAction, clip, TOOL_NAMES, toolBrief } = A;

  ok("围栏里的动作能取出来", parseAction('```json\n{"action":"project.info"}\n```').action === "project.info");
  ok("动作前后有废话也能取出来", parseAction('好的，我先看看：{"action":"script.list"} 可以吗').action === "script.list");
  let noAct = false; try { parseAction('{"thought":"想一下"}'); } catch { noAct = true; }
  ok("没有 action 字段时明确报错而不是当成无动作", noAct);

  // 摊平写法（模型命中率更高）不能把 action / thought 当成参数带下去
  const flat = parseAction('{"action":"script.get","thought":"先看看","entry":"index.js"}');
  ok("摊平写法里的 entry 被当成参数", flat.args.entry === "index.js");
  ok("摊平写法不污染参数表", !("action" in flat.args) && !("thought" in flat.args), JSON.stringify(flat.args));

  // 动作名对齐官方 apc / engine-openapi-mcp 的 <组>.<动词> 形状，
  // 并且旧的驼峰写法必须还能归一化——模型两种都会输出。
  ok("动作名都是官方 apc 那种 组.动词 形状",
    TOOL_NAMES.every((n) => /^[a-z]+\.[a-zA-Z]+$/.test(n) || n === "finish"), TOOL_NAMES.join(" "));
  ok("覆盖了官方契约里的脚本与存储动作",
    ["script.upload", "script.get", "script.list", "storage.set", "storage.get", "storage.list", "storage.remove"]
      .every((n) => TOOL_NAMES.includes(n)));
  // 社区动作：Agent 之前只会改图，看不到广场也发不出去。写动作要 confirm 才落地。
  ok("Agent 能读广场、能发布、能评论",
    ["community.who", "community.feed", "community.publish", "community.comment"].every((n) => TOOL_NAMES.includes(n)));

  // 动作名与执行体必须名实一致。apc 二次校准抓到过一个真 bug：TOOLS 里写 map.blocks，
  // switch 里却是 case "map.resource" —— 模型照目录写就走到 default，报"没有实现的动作"，
  // 是静默失败。这条断言把整类问题钉死：目录里的每一个名字都得有对应 case。
  {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../public/js/ai-agent.js", import.meta.url), "utf8");
    const cases = new Set([...src.matchAll(/case "([a-z]+\.[a-zA-Z]+)":/g)].map((m) => m[1]));
    const missing = TOOL_NAMES.filter((n) => n !== "finish" && !cases.has(n));
    ok("TOOLS 里每个动作都有对应的执行分支", missing.length === 0, "缺 case: " + missing.join("、"));
    ok("旧名 map.blocks 归一化到 map.resource", normalizeAction("map.blocks") === "map.resource");
  }
  ok("旧驼峰名与 model 爱写的写法都能归一化",
    normalizeAction("inspectWorld") === "project.info"
    && normalizeAction("writeScript") === "script.upload"
    && normalizeAction("script.saveOrUpdate") === "script.upload"
    && normalizeAction("playtest") === "runtime.start"
    && normalizeAction("storage.page") === "storage.list"
    && normalizeAction("Script.Upload") === "script.upload"
    && normalizeAction("deleteEverything") === null, );
  ok("别名动作最终以正式名执行，参数照旧", (() => {
    const r = sanitizeAction({ action: "writeScript", args: { name: "index.js", code: "world.say(1);" } });
    return r.ok && r.action === "script.upload" && r.args.entry === "index.js";
  })());

  ok("未知动作被拒，并把可用动作告诉模型", (() => {
    const r = sanitizeAction({ action: "deleteWorld", args: {} });
    return !r.ok && TOOL_NAMES.every((n) => r.error.includes(n));
  })());
  ok("脚本文件名挡掉路径穿越", !sanitizeAction({ action: "script.upload", args: { entry: "../../server.js", code: "a" } }).ok);
  ok("反斜杠路径也被挡掉", !sanitizeAction({ action: "script.upload", args: { entry: "..\\x.js", code: "a" } }).ok);
  ok("非 .js 文件名被拒", !sanitizeAction({ action: "script.upload", args: { entry: "index.txt", code: "a" } }).ok);
  ok("空代码不落地", !sanitizeAction({ action: "script.upload", args: { entry: "index.js", code: "   " } }).ok);
  ok("语法不过的代码不落地", !sanitizeAction({ action: "script.upload", args: { entry: "index.js", code: "const a = {" } }).ok);
  ok("语法通过的代码原样放行", (() => {
    const r = sanitizeAction({ action: "script.upload", args: { entry: "index.js", code: "world.onTick(() => {});" } });
    return r.ok && r.args.code.startsWith("world.onTick");
  })());
  ok("顶层 await 不算语法错误（官方服务端脚本支持它）",
    sanitizeAction({ action: "script.upload", args: { entry: "index.js", code: "const r = await http.fetch('https://x'); world.say(r);" } }).ok);
  ok("超长代码被拒而不是截断", !sanitizeAction({
    action: "script.upload", args: { entry: "index.js", code: "// " + "x".repeat(30000) },
  }).ok);

  // 端必须显式，而且和文件名不能互相打脸：本实现按文件名判端，
  // 声明 server 却给个 clientX.js 会静默当客户端脚本跑。
  ok("side=client 会自动把文件名改成带 Client 的写法", (() => {
    const r = sanitizeAction({ action: "script.upload", args: { entry: "hud.js", side: "client", code: "ui.text('a');" } });
    return r.ok && r.args.side === "client" && /client/i.test(r.args.entry);
  })());
  ok("side 与文件名冲突时直接拒，不和稀泥", !sanitizeAction({
    action: "script.upload", args: { entry: "clientHud.js", side: "server", code: "world.say(1);" },
  }).ok);
  ok("非法 side 值被拒并说明只能填什么", (() => {
    const r = sanitizeAction({ action: "script.upload", args: { entry: "index.js", side: "both", code: "a=1" } });
    return !r.ok && /server 或 client/.test(r.error);
  })());

  ok("runtime.start 的 tick 数被夹进安全区间",
    sanitizeAction({ action: "runtime.start", args: { ticks: 1e9 } }).args.ticks === 200
    && sanitizeAction({ action: "runtime.start", args: { ticks: -5 } }).args.ticks === 1
    && sanitizeAction({ action: "runtime.start", args: {} }).args.ticks === 60);
  ok("model.build 没有 at 就要求补，而不是默认盖在原点",
    !sanitizeAction({ action: "model.build", args: { program: { parts: [] } } }).ok);
  ok("entity.add 不给实体名就拒（脚本取不到它，等于白放）",
    !sanitizeAction({ action: "entity.add", args: { at: [1, 1, 1] } }).ok);
  ok("project.create 的非法地貌被拒，而不是悄悄变成平地", (() => {
    const r = sanitizeAction({ action: "project.create", args: { size: [64, 32, 64], terrain: "mountainz" } });
    return !r.ok && /plains/.test(r.error);
  })());
  ok("project.create 的尺寸越界被拒", !sanitizeAction({ action: "project.create", args: { size: [9999, 32, 64] } }).ok);
  ok("storage.set 缺 value 时拒（而不是写成 undefined）",
    !sanitizeAction({ action: "storage.set", args: { name: "s", key: "k" } }).ok
    && sanitizeAction({ action: "storage.set", args: { name: "s", key: "k", value: null } }).ok);
  ok("finish 没有小结也不会变成空字符串",
    /没有写小结/.test(sanitizeAction({ action: "finish", args: {} }).args.summary));

  ok("动作说明书覆盖每个动作且和名单同步", TOOL_NAMES.every((n) => toolBrief().includes(n))
    && (toolBrief().match(/^- /gm) || []).length === TOOL_NAMES.length);
  ok("观察文本超长时头尾都保留、中间截断", (() => {
    const s = "HEAD" + "x".repeat(4000) + "TAIL";
    const c = clip(s, 400);
    return c.startsWith("HEAD") && c.endsWith("TAIL") && c.length < s.length
      && c.length <= 400 && /省略/.test(c);
  })());
  ok("观察文本不长时逐字不变", clip("短句", 400) === "短句");
}

console.log("== 设置自动保存：改了就该在 localStorage 里 ==");
{
  const fs2 = await import("node:fs");
  const src = fs2.readFileSync(new URL("../public/js/ai.js", import.meta.url), "utf8");
  // openSettings 是要浏览器的，这里断言的是"自动保存这件事写进了实现"，
  // 真正点了输入框能不能存住由 test/e2e.mjs 在浏览器里验。
  ok("面板挂了 input 监听做自动保存", /addEventListener\("input"/.test(src) && /function autosave/.test(src));
  ok("界面上没有「保存」按钮了（有就说明自动保存是假的）", !/el\("button", ?"primary", ?"保存"\)/.test(src));
  ok("关闭前兜底再存一次", /function hide\(\) \{[\s\S]*?autosave\(\);/.test(src));
  ok("有清除密钥入口", /清除密钥/.test(src) && /clearKey\(\)/.test(src));
  ok("模型列表走本地代理而不是浏览器直连", /fetch\("\/api\/ai\/models"/.test(src));
  const srv = fs2.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  ok("服务端也开了 /api/ai/models 且只认回环",
    /parts\[2\] === "models"/.test(srv) && /AI 代理只对本机开放/.test(srv));
  ok("模型列表的报错也先擦密钥", /scrub\("上游 " \+ r\.status \+ "：" \+ detail, key\)/.test(srv));
  ok("没有 /models 端点时不算用户配置错", /没有 \/models 端点/.test(srv));
}

console.log("== 官方 next* 事件过滤器：对象匹配器必须认（1:1 破口回归） ==");
{
  const { eventMatches } = await import("../public/js/gapi.js");
  const ent = { id: "player-1" };
  const ev = { entity: ent, input: { jump: true, forward: false }, message: "hi" };
  ok("无过滤器匹配一切", eventMatches(undefined, ev) && eventMatches(null, ev));
  ok("谓词函数照旧可用", eventMatches((e) => e.input.jump, ev) && !eventMatches((e) => e.input.forward, ev));
  // 官方 api/notice/eventDiff.md 的主用法：world.nextPlayerInput({ entity, input: { jump: true } })
  ok("官方对象写法能匹配（旧实现会抛 filter is not a function）",
    eventMatches({ entity: ent, input: { jump: true } }, ev));
  ok("对象写法能判否：jump=false 不该命中 jump=true",
    !eventMatches({ input: { jump: false } }, ev));
  ok("只比给定键，不多要求", eventMatches({ message: "hi" }, ev) && !eventMatches({ message: "yo" }, ev));
  ok("嵌套对象是部分匹配，不是深相等", eventMatches({ input: { forward: false } }, ev));
  ok("数组按值比（坐标类事件）", eventMatches({ tags: ["a", "b"] }, { tags: ["a", "b"] })
    && !eventMatches({ tags: ["a"] }, { tags: ["a", "b"] }));
  // 嵌套一律走部分匹配——`input: { jump: true }` 能工作靠的就是它，
  // 所以 `entity` 也是按结构比而不是按引用比。实际不冲突：两个玩家的
  // name/id 不可能整体相同，而按引用比反而会让跨帧取到的实体包装对象判否。
  ok("entity 按结构部分匹配：不同实例但同字段算命中",
    eventMatches({ entity: { id: "player-1" } }, ev));
  ok("entity 字段不同就不命中", !eventMatches({ entity: { id: "player-2" } }, ev));
  ok("过滤器是原始值时不误判为匹配", !eventMatches(3, ev) && !eventMatches("x", ev));
  ok("事件不是对象时不崩", eventMatches({ a: 1 }, null) === false && eventMatches({ a: 1 }, 7) === false);
}

console.log(fails ? `\n${fails} 项未通过` : "\n全部通过");
process.exitCode = fails ? 1 : 0;
