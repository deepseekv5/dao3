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

console.log(fails ? `\n${fails} 项未通过` : "\n全部通过");
process.exitCode = fails ? 1 : 0;
