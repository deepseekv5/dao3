// blocks.js — 积木编辑器（低代码）：把块拼成程序，编译成官方 API 的 JavaScript 写进脚本。
//
// 为什么值得做：脚本页对"从来没写过代码的人"仍然是一堵墙。积木是同一份脚本的另一种
// 输入法：拼完点一下，生成的 JS 就落在脚本工作区的 blocks.js 里，可以接着手改、可以存盘、
// 可以运行游戏。两条通路共用同一个真相（state.scripts），不存在"积木版"和"代码版"两份程序。
//
// 形状语言照 Scratch / Blockly：块有顶部凹槽与底部凸榫，事件块是帽子形，容器块把子块
// 包在自己的"口"里（左轨 + 底压条）。这不是装饰——榫与口直接把"谁能嵌进谁、这一串是一个
// 整体"画出来，靠间距和虚线框表达不了这件事。
//
// 只发官方存在的接口。onChat 的 {entity,message}、onPress 的 {entity,button,pressed}、
// onPlayerJoin 的 {tick,entity} 这些 payload 形状都照 game.js 逐条核过，不编 API。
import { highlightJS } from "./features.js";
import { checkSyntax } from "./ai.js";
import { ideMenu } from "./code-edit.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lit = (s) => JSON.stringify(String(s == null ? "" : s));      // 字符串字段 → JS 字面量
const num = (v, d = 0) => (Number.isFinite(+v) ? String(+v) : String(d));
const indent = (lines, d) => lines.map((s) => (s ? "  ".repeat(d) + s : s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const CATS = [["event", "事件"], ["action", "动作"], ["flow", "控制"], ["var", "变量"], ["world", "玩法"], ["voxel", "方块"]];
// 每类一个线框图标：分类靠形状就能分开，颜色只是加强（不用 emoji）
const ICONS = {
  event: '<path d="M5 20V5l6 2.5L17 5v9l-6 2.5L5 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  action: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  flow: '<path d="M4 6h9M4 12h13M4 18h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="17" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  var: '<rect x="4" y="6" width="16" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10.5h4M8 14h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  world: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12h16M12 4c2.6 2.4 2.6 13.2 0 16M12 4c-2.6 2.4-2.6 13.2 0 16" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  voxel: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.4"/>',
};

/** 变量名允许中文，而中文在 ECMAScript 里本来就是合法标识符（\p{L} 覆盖 CJK），
    所以上一版只认 ASCII 的写法是多余的：积木里写「得分」，出码却变成 v_ivrg7a，
    等于把用户在两块面板之间看得懂的那根线剪断。这一版只在**真的**不合法时
    （含空格、标点、是保留字）才退化成稳定短名，原名留在注释里。 */
const RESERVED = new Set("if else for while do switch case default break continue var let const class function return new this typeof instanceof in of delete void null true false super static extends import export async await yield try catch finally throw with debugger entity tick world message button pressed".split(" "));
const ID_RE = /^[\p{L}\p{Nl}$_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\u200c\u200d$_]*$/u;
function safeName(n) {
  const s = String(n || "").trim();
  if (!s) return "v_empty";
  if (ID_RE.test(s) && !RESERVED.has(s)) return s;
  let out = "";
  for (const ch of s) out += ch.charCodeAt(0).toString(36);
  return "v_" + out.slice(0, 12);
}

// 块定义：hat = 顶层事件块（帽子形）；body = 有口，能装子块；entity = 需要"谁"，
// 只能待在绑定 entity 的事件块里（编译时靠 inEntity 判断，见 compileBlocks）。
const TYPES = {
  on_join: { cat: "event", hat: true, body: true, gives: true, label: "当玩家进入世界时",
    emit: (b, inner) => ["world.onPlayerJoin(({ entity }) => {", ...inner, "});"] },
  on_leave: { cat: "event", hat: true, body: true, gives: true, label: "当玩家离开世界时",
    emit: (b, inner) => ["world.onPlayerLeave(({ entity }) => {", ...inner, "});"] },
  on_chat: { cat: "event", hat: true, body: true, gives: true, label: "当有人发言且包含",
    fields: { kw: { t: "text", d: "开始" } },
    emit: (b, inner) => ["world.onChat(({ entity, message }) => {", `  if (!message.includes(${lit(b.f.kw)})) return;`, ...inner, "});"] },
  on_press: { cat: "event", hat: true, body: true, gives: true, label: "当玩家按下动作键时",
    emit: (b, inner) => ["world.onPress(({ entity, button, pressed }) => {", "  if (!pressed) return;", ...inner, "});"] },
  on_tick: { cat: "event", hat: true, body: true, label: "每隔", unit: "tick 执行一次",
    fields: { every: { t: "num", d: 20 } },
    emit: (b, inner) => ["world.onTick(({ tick }) => {", `  if (tick % ${Math.max(1, Math.round(+b.f.every || 20))} !== 0) return;`, ...inner, "});"] },

  say: { cat: "action", needs: true, label: "让 TA 头顶飘出", fields: { msg: { t: "text", d: "你好！" } },
    emit: (b) => [`entity.say(${lit(b.f.msg)});`] },
  world_say: { cat: "action", label: "全服广播", fields: { msg: { t: "text", d: "比赛开始" } },
    emit: (b) => [`world.say(${lit(b.f.msg)});`] },
  dialog: { cat: "action", needs: true, label: "给 TA 弹对话框", fields: {
    title: { t: "text", d: "提示" }, content: { t: "text", d: "欢迎来到这张图" } },
    emit: (b) => [`entity.player.dialog({ type: GameDialogType.TEXT, title: ${lit(b.f.title)}, content: ${lit(b.f.content)} });`] },
  sound: { cat: "action", needs: true, label: "给 TA 播放音效", fields: { sample: { t: "text", d: "click" } },
    emit: (b) => [`entity.player.playSound({ sample: ${lit(b.f.sample)} });`] },
  teleport: { cat: "action", needs: true, label: "把 TA 传到", fields: {
    x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 } },
    emit: (b) => [`entity.player.teleport({ x: ${num(b.f.x)}, y: ${num(b.f.y)}, z: ${num(b.f.z)} });`] },
  timer: { cat: "action", body: true, label: "等", unit: "毫秒后执行", fields: { ms: { t: "num", d: 3000 } },
    emit: (b, inner) => ["world.setTimeout(() => {", ...inner, `}, ${num(b.f.ms, 0)});`] },

  repeat: { cat: "flow", body: true, label: "重复", unit: "次", fields: { n: { t: "num", d: 3 } },
    emit: (b, inner) => [`for (let i = 0; i < ${num(b.f.n, 0)}; i++) {`, ...inner, "}"] },
  if_expr: { cat: "flow", body: true, label: "如果（JS 条件）", fields: { cond: { t: "expr", d: "true" } },
    emit: (b, inner) => [`if (${b.f.cond || "true"}) {`, ...inner, "}"] },
  var_if: { cat: "flow", body: true, label: "如果变量", fields: {
    name: { t: "name", d: "得分" }, op: { t: "sel", opts: [">", ">=", "<", "<=", "==", "!="], d: ">" }, value: { t: "expr", d: "0" } },
    vars: (b) => [b.f.name],
    emit: (b, inner) => [`if (${safeName(b.f.name)} ${b.f.op || ">"} ${b.f.value || "0"}) {`, ...inner, "}"] },

  var_set: { cat: "var", label: "把变量", unit: "设为", fields: { name: { t: "name", d: "得分" }, value: { t: "expr", d: "0" } },
    vars: (b) => [b.f.name], emit: (b) => [`${safeName(b.f.name)} = ${b.f.value || "null"};`] },
  var_add: { cat: "var", label: "给变量", unit: "加上", fields: { name: { t: "name", d: "得分" }, value: { t: "num", d: 1 } },
    vars: (b) => [b.f.name], emit: (b) => [`${safeName(b.f.name)} += ${num(b.f.value, 0)};`] },
  var_say: { cat: "var", needs: true, label: "把变量", unit: "飘给 TA 看", fields: { name: { t: "name", d: "得分" } },
    vars: (b) => [b.f.name], emit: (b) => [`entity.say(String(${safeName(b.f.name)}));`] },

  set_voxel: { cat: "voxel", label: "在 XYZ 放置方块", fields: {
    x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 }, name: { t: "block", d: "grass" } },
    emit: (b) => [`world.setVoxel(${num(b.f.x)}, ${num(b.f.y)}, ${num(b.f.z)}, ${lit(blockName(b.f.name))});`] },
  if_voxel: { cat: "voxel", body: true, label: "如果 XYZ 是方块", fields: {
    x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 }, name: { t: "block", d: "grass" } },
    emit: (b, inner) => [`if (world.getVoxelName(${num(b.f.x)}, ${num(b.f.y)}, ${num(b.f.z)}) === ${lit(blockName(b.f.name))}) {`, ...inner, "}"] },
  weather: { cat: "world", label: "设置天气", fields: { rain: { t: "num", d: 0 }, snow: { t: "num", d: 0 }, thunder: { t: "num", d: 0 } },
    emit: (b) => [`world.rainDensity = ${clamp(+b.f.rain || 0, 0, 1)};`, `world.snowDensity = ${clamp(+b.f.snow || 0, 0, 1)};`, `world.thunderDensity = ${clamp(+b.f.thunder || 0, 0, 1)};`] },
  spawn: { cat: "world", label: "把出生点设到 XYZ", fields: {
    x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 } },
    emit: (b) => [`world.setWorldSpawn({ x: ${num(b.f.x)}, y: ${num(b.f.y)}, z: ${num(b.f.z)} });`] },
  log: { cat: "world", label: "打印到控制台", fields: { msg: { t: "expr", d: '"跑了一次"' } },
    emit: (b) => [`console.log(${b.f.msg || '""'});`] },

  hurt: { cat: "action", needs: true, label: "让 TA 受到", unit: "点伤害", fields: { amount: { t: "num", d: 10 } },
    emit: (b) => [`entity.hurt(${num(b.f.amount, 0)});`] },
  heal: { cat: "action", needs: true, label: "给 TA 治疗", unit: "点生命", fields: { amount: { t: "num", d: 10 } },
    emit: (b) => [`entity.heal(${num(b.f.amount, 0)});`] },
  destroy_entity: { cat: "action", needs: true, label: "摧毁 TA", emit: () => ["entity.destroy();"] },
  entity_velocity: { cat: "action", needs: true, label: "把 TA 速度设为", fields: {
    x: { t: "num", d: 0 }, y: { t: "num", d: 0 }, z: { t: "num", d: 0 } },
    emit: (b) => [`entity.velocity.set(${num(b.f.x)}, ${num(b.f.y)}, ${num(b.f.z)});`] },
  entity_tag: { cat: "action", needs: true, label: "给 TA 添加标签", fields: { tag: { t: "text", d: "敌人" } },
    emit: (b) => [`entity.addTag(${lit(b.f.tag)});`] },
  player_prop: { cat: "action", needs: true, label: "设置玩家属性", fields: {
    key: { t: "sel", opts: ["walkSpeed", "runSpeed", "jumpPower", "cameraDistance", "canFly", "invisible"], d: "walkSpeed" },
    value: { t: "expr", d: "0.4" } },
    emit: (b) => { const key = ["walkSpeed", "runSpeed", "jumpPower", "cameraDistance", "canFly", "invisible"].includes(b.f.key) ? b.f.key : "walkSpeed"; return [`entity.player.${key} = ${b.f.value || "0"};`]; } },

  while_cond: { cat: "flow", body: true, label: "当 JS 条件成立时重复", fields: { cond: { t: "expr", d: "false" } },
    emit: (b, inner) => [`while (${b.f.cond || "false"}) {`, ...inner, "}"] },
  each_entity: { cat: "flow", body: true, gives: true, label: "遍历 XYZ 周围", unit: "格内的实体", fields: {
    x: { t: "num", d: 0 }, y: { t: "num", d: 0 }, z: { t: "num", d: 0 }, radius: { t: "num", d: 8 } },
    emit: (b, inner) => [`for (const target of world.entitiesInRadius({ x: ${num(b.f.x)}, y: ${num(b.f.y)}, z: ${num(b.f.z)} }, ${num(b.f.radius, 1)})) {`, "  const entity = target;", ...inner, "}"] },
  interval: { cat: "flow", body: true, label: "每隔", unit: "毫秒重复执行", fields: { ms: { t: "num", d: 1000 } },
    emit: (b, inner) => ["world.setInterval(() => {", ...inner, `}, ${Math.max(50, Math.round(+b.f.ms || 1000))});`] },
  clear_timer: { cat: "flow", label: "清除定时器", fields: { id: { t: "expr", d: "0" } },
    emit: (b) => [`world.clearTimeout(${b.f.id || "0"}); world.clearInterval(${b.f.id || "0"});`] },

  world_gravity: { cat: "world", label: "设置世界重力", fields: { value: { t: "num", d: -0.1 } },
    emit: (b) => [`world.gravity = ${num(b.f.value, -0.1)};`] },
  world_time: { cat: "world", label: "设置昼夜相位", fields: { value: { t: "num", d: 0.25 } },
    emit: (b) => [`world.sunPhase = ${clamp(+b.f.value || 0, 0, 1)};`] },
  world_fog: { cat: "world", label: "设置雾密度", fields: { value: { t: "num", d: 0.004 } },
    emit: (b) => [`world.fogUniformDensity = ${clamp(+b.f.value || 0, 0, 0.1)};`] },
  game_rule: { cat: "world", label: "设置游戏规则", fields: { name: { t: "text", d: "doImmediateRespawn" }, value: { t: "expr", d: "true" } },
    emit: (b) => [`world.setGameRule(${lit(b.f.name)}, ${b.f.value || "null"});`] },
};

const BLOCK_ZH = { grass: "草", stone: "石头", rock: "岩石", sand: "沙子", wood: "木头", log: "原木", plank: "木板", brick: "砖块", glass: "玻璃", water: "水", lava: "岩浆", snow: "雪", ice: "冰", cloud: "云", light: "灯", glow: "发光", red: "红", orange: "橙", yellow: "黄", green: "绿", blue: "蓝", purple: "紫", pink: "粉", black: "黑", white: "白", grey: "灰", gray: "灰", dark: "深色", pale: "浅色", all: "全", road: "道路", wall: "墙", door: "门", window: "窗", flower: "花", leaf: "树叶", leaves: "树叶", metal: "金属", iron: "铁", gold: "金", diamond: "钻石", crystal: "水晶", fire: "火", mud: "泥", soil: "土壤", chest: "箱子", fence: "栅栏", roof: "屋顶", floor: "地板", tile: "瓷砖" };
let BLOCK_OPTIONS = [];
const prettyBlock = (name) => String(name).split("_").map((part) => BLOCK_ZH[part] || part).join("");
const blockName = (value) => {
  const q = String(value || "").trim();
  return BLOCK_OPTIONS.find((b) => b.name === q || b.label === q || b.zh === q)?.name || q;
};
function initBlockOptions(atlas) {
  BLOCK_OPTIONS = (atlas && typeof atlas.list === "function" ? atlas.list() : []).map((b) => {
    const name = String(b.name || b.id), zh = prettyBlock(name);
    return { name, zh, label: `${zh} ${name}` };
  });
  const keywords = "方块 block voxel " + BLOCK_OPTIONS.map((b) => b.name + " " + b.zh).join(" ");
  TYPES.set_voxel.keywords = keywords;
  TYPES.if_voxel.keywords = keywords;
}
export function blockCatalogSize() { return Object.keys(TYPES).length; }

let uid = 1;
const nid = () => "b" + uid++;
function mk(type) {
  const d = TYPES[type] || {};
  const f = {};
  for (const [k, fd] of Object.entries(d.fields || {})) f[k] = fd.d;
  return { id: nid(), type, f, children: d.body ? [] : null };
}
const withF = (type, fields) => { const b = mk(type); Object.assign(b.f, fields); return b; };

// 空态给三条现成的路，比"从左边拖一块进来"有用
const PRESETS = {
  hello: () => [Object.assign(mk("on_join"), { children: [mk("say"), mk("dialog")] })],
  score: () => [
    withF("var_set", { name: "得分", value: "0" }),
    Object.assign(mk("on_chat"), { f: { kw: "得分" }, children: [withF("var_add", { name: "得分", value: 1 }), mk("var_say")] }),
  ],
  rain: () => [Object.assign(mk("on_tick"), { f: { every: 900 }, children: [
    withF("weather", { rain: 0.7, snow: 0, thunder: 0 }),
    Object.assign(mk("timer"), { f: { ms: 12000 }, children: [withF("weather", { rain: 0, snow: 0, thunder: 0 })] }),
    withF("world_say", { msg: "雨停了" }),
  ] })],
};
const EXAMPLE = () => [...PRESETS.score(), ...PRESETS.hello(), ...PRESETS.rain()];

/** 树 → JS。变量声明收齐了再放最前面，所以走两趟；顺带算出"这一层有没有 entity"，
    把需要 TA 的块放到没有 TA 的地方时，宁可写明理由也不生成跑不了的代码。 */
export function compileBlocks(tree) {
  const names = new Map();
  const notes = [];
  const collect = (list) => {
    for (const b of list || []) {
      const d = TYPES[b.type];
      if (!d) continue;
      for (const n of (d.vars ? d.vars(b) : [])) if (n && String(n).trim()) names.set(safeName(n), String(n).trim());
      collect(b.children);
    }
  };
  collect(tree);
  const emitList = (list, depth, sink, hasEntity) => {
    for (const b of list || []) {
      const d = TYPES[b.type];
      if (!d) { sink.push(...indent([`/* 未知积木：${b.type} */`], depth)); continue; }
      if (d.hat && depth > 0) {
        sink.push(...indent([`/* 事件块「${d.label}」只能放在顶层，已跳过 */`], depth));
        continue;
      }
      if (d.needs && !hasEntity) {
        notes.push(`${d.label}：这一层没有"TA"，请放进事件块里`);
        sink.push(...indent([`/* ${d.label} —— 外层没有 entity，跳过 */`], depth));
        continue;
      }
      const inner = d.body ? [] : null;
      if (d.body) emitList(b.children, depth + 1, inner, hasEntity || !!d.gives);
      sink.push(...indent(d.emit(b, inner), depth));
    }
  };
  const body = [];
  emitList(tree || [], 0, body, false);
  const head = ["// 由积木编辑器生成：改积木会重写这一段。"];
  if (names.size) head.push(...[...names.entries()].map(([k, v]) => `let ${k} = null;${v !== k ? " // " + v : ""}`), "");
  if (notes.length) head.push(...notes.map((n) => `/* 注意：${n} */`));
  return head.concat(body).join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/** 出码后自己先过一遍语法：问题当场报在角标上，而不是等人去点运行。
    复用 ai.js 的 checkSyntax（同一份判定），不在这儿再养一个解析器。 */
const checkJs = (code) => { const r = checkSyntax(code); return r.ok ? "" : (r.error || "语法错误"); };

export function wireBlocks(E) {
  const screen = document.getElementById("blockScreen");
  if (!screen || screen.dataset.on) return;
  screen.dataset.on = "1";
  initBlockOptions(E.atlas);
  let blockList = screen.querySelector("#bkBlockOptions");
  if (!blockList) {
    blockList = document.createElement("datalist"); blockList.id = "bkBlockOptions";
    for (const b of BLOCK_OPTIONS) { const option = document.createElement("option"); option.value = b.name; option.label = b.label; blockList.appendChild(option); }
    screen.appendChild(blockList);
  }
  const toolBody = screen.querySelector("#bsTool");
  const filter = screen.querySelector("#bsFilter");
  const canvas = screen.querySelector("#bsCanvas");
  const listEl = screen.querySelector(".bs-list");
  const blankEl = screen.querySelector(".bs-blank");
  const trash = screen.querySelector("#bsTrash");
  const codeBox = screen.querySelector(".bs-code code");
  const lnBox = screen.querySelector("#bsLn");
  const stat = screen.querySelector("#bsStat");
  const auto = screen.querySelector("#bsAuto");
  const FILE = "blocks.js";
  const ZOOMS = [0.7, 0.8, 0.9, 1, 1.15, 1.3];
  let tree = [], sel = null, zoom = 1, undoStack = [], toolLimit = 80;

  const flat = (list = tree, out = []) => { for (const b of Array.isArray(list) ? list : []) { if (!b) continue; out.push(b); if (b.children) flat(b.children, out); } return out; };
  // 叶子块的 children 是 null（不是 []）：直接递归进去会在 null.length 上抛，
  // 症状是"拖拽松手没反应"——异常吞在事件回调里，只在控制台上冒一行。
  const find = (id, from = tree) => {
    if (!Array.isArray(from)) return null;
    for (let i = 0; i < from.length; i++) {
      if (!from[i]) continue;
      if (from[i].id === id) return { list: from, i, b: from[i] };
      const hit = find(id, from[i].children);
      if (hit) return hit;
    }
    return null;
  };

  /* ---------- 出码 / 落盘 / 撤销 ---------- */
  const js = () => compileBlocks(tree);
  function paintCode() {
    const code = js();
    // 预览栏不是编辑器覆盖层，不需要为最后一行补 \n：补了就和行号差一行
    codeBox.innerHTML = highlightJS(code);
    const lines = code.split("\n").length;
    lnBox.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
    const bad = checkJs(code);
    stat.textContent = bad ? "语法有问题" : `${flat().length} 块 · ${lines} 行代码`;
    stat.classList.toggle("bad", !!bad);
    stat.title = bad ? "生成的代码有语法问题：" + bad : "拼好的块数 · 生成的代码行数";
  }
  function writeScript(toast) {
    const src = js();
    const bad = checkJs(src);
    if (bad) { E.toast("先别运行：生成的代码有语法问题 —— " + bad, true); return false; }
    const arr = E.state.scripts || (E.state.scripts = []);
    let f = arr.find((x) => x.name === FILE);
    if (!f) { f = { name: FILE, code: "" }; arr.push(f); }
    if (f.code === src) { if (toast) E.toast(FILE + " 已经是最新的", true); return true; }
    f.code = src;
    if (E.refreshScriptFiles) E.refreshScriptFiles();
    if (E.markDirty) E.markDirty();
    if (toast) E.toast(`已写入 ${FILE}（脚本页里可以接着手改）`);
    return true;
  }
  function saveTree() {
    E.state.meta = E.state.meta || {};
    E.state.meta.blocks = JSON.parse(JSON.stringify(tree));
    if (E.markDirty) E.markDirty();
  }
  const snap = () => { undoStack.push(JSON.stringify(tree)); if (undoStack.length > 60) undoStack.shift(); };
  function afterChange() { paintCode(); saveTree(); if (auto && auto.checked) writeScript(false); }
  function undo() {
    const last = undoStack.pop();
    if (!last) return E.toast("没有可撤销的这一步", true);
    tree = JSON.parse(last);
    render();
    afterChange();                 // 撤销也要把脚本写回，否则 Ctrl+Z 后画布与代码各说各话
  }

  /* ---------- 积木箱 ---------- */
  function renderTool(q = "") {
    toolBody.innerHTML = "";
    toolBody.dataset.total = String(Object.keys(TYPES).length);
    for (const [cat, zh] of CATS) {
      const all = Object.entries(TYPES).filter(([t, d]) => d.cat === cat &&
        (!q || (d.label + (d.unit || "") + (d.keywords || "") + t).toLowerCase().includes(q)));
      if (!all.length) continue;
      const items = cat === "voxel" && !q ? all.slice(0, toolLimit) : all;
      const sec = document.createElement("div");
      sec.className = "bs-cat";
      const h = document.createElement("div");
      h.className = "bs-cat-h";
      h.innerHTML = `<i class="bs-dot c-${cat}"></i><span>${esc(zh)}</span><b>${all.length}</b>`;
      sec.appendChild(h);
      for (const [type, d] of items) {
        const chip = document.createElement("button");
        chip.className = "bs-chip c-" + cat;
        chip.dataset.type = type;
        chip.title = (d.hat ? "事件块：只能放顶层\n" : d.body ? "这一块的口里能装别的块\n" : "") + "点一下加到末尾 · 按住拖进画布";
        chip.innerHTML = `<span class="bs-ci"><svg viewBox="0 0 24 24">${ICONS[cat]}</svg></span>`
          + `<span class="bs-cl">${esc(d.label + (d.unit ? " " + d.unit : ""))}</span>`;
        chip.onclick = () => (d.hat ? addTop(type) : addNear(type, sel));
        chip.addEventListener("pointerdown", (ev) => startDrag(ev, { fresh: type }));
        sec.appendChild(chip);
      }
      if (items.length < all.length) {
        const more = document.createElement("button");
        more.className = "bs-more";
        more.textContent = `再显示 ${Math.min(80, all.length - items.length)} 个方块积木`;
        more.onclick = () => { toolLimit += 80; renderTool(q); };
        sec.appendChild(more);
      }
      toolBody.appendChild(sec);
    }
    if (!toolBody.children.length) toolBody.innerHTML = '<p class="bs-none">没有叫这个的积木</p>';
  }

  /* ---------- 画布渲染 ---------- */
  function fieldInput(b, k, fd) {
    const v = b.f[k];
    const cls = "bk-f" + (fd.t === "expr" ? " expr" : "");
    if (fd.t === "sel") {
      return `<select class="${cls}" data-k="${k}">${fd.opts.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    }
    if (fd.t === "block") {
      return `<input class="${cls}" data-k="${k}" type="text" list="bkBlockOptions" value="${esc(v)}" placeholder="${esc(fd.d)}" spellcheck="false">`;
    }
    const type = fd.t === "num" ? "number" : "text";
    return `<input class="${cls}" data-k="${k}" type="${type}"${fd.t === "num" ? ' step="any"' : ""} value="${esc(v)}" placeholder="${esc(fd.d)}" spellcheck="false">`;
  }
  function blockHtml(b) {
    const d = TYPES[b.type] || {};
    const keys = Object.keys(d.fields || {});
    const first = keys.find((k) => d.fields[k].t !== "sel") || null;
    const rest = keys.filter((k) => k !== first);
    let text = esc(d.label || "");
    if (first) text += " " + fieldInput(b, first, d.fields[first]);
    if (d.unit) text += " " + esc(d.unit);
    const kids = (b.children || []).map(blockHtml).join("");
    return `<div class="bk c-${d.cat}${d.hat ? " hat" : ""}${b.id === sel ? " sel" : ""}" data-id="${b.id}">
        <div class="bk-h">
          <span class="bk-i"><svg viewBox="0 0 24 24">${ICONS[d.cat] || ICONS.world}</svg></span>
          <span class="bk-t">${text}</span>
          <button class="bk-x" title="删除这块（Del）" aria-label="删除">×</button>
        </div>
        ${rest.length ? `<div class="bk-h sub">${rest.map((k) => fieldInput(b, k, d.fields[k])).join("")}</div>` : ""}
        ${d.body ? `<div class="bk-m" data-slot="${b.id}">${kids || '<p class="bk-e">把块放到这里</p>'}</div><i class="bk-cap"></i>` : ""}
      </div>`;
  }
  function render() {
    listEl.innerHTML = tree.map(blockHtml).join("");
    blankEl.hidden = tree.length > 0;
    canvas.style.setProperty("--bk-scale", String(zoom));
    screen.querySelector("#bsZoom").textContent = Math.round(zoom * 100) + "%";
  }
  const commit = () => { render(); afterChange(); };
  function addTop(type) { snap(); const b = mk(type); tree.push(b); sel = b.id; commit(); focus(b.id); }
  function addNear(type, targetId) {
    const b = mk(type);
    const h = targetId ? find(targetId) : null;
    snap();
    if (!h) { tree.push(b); }
    else if (TYPES[h.b.type].body) { (h.b.children = h.b.children || []).push(b); }
    else h.list.splice(h.i + 1, 0, b);
    sel = b.id; commit(); focus(b.id);
  }
  function remove(id) { const h = find(id); if (!h) return; snap(); h.list.splice(h.i, 1); if (sel === id) sel = null; commit(); }
  function dupe(id) {
    const h = find(id); if (!h) return;
    const copy = JSON.parse(JSON.stringify(h.b));
    const reid = (n) => { n.id = nid(); (n.children || []).forEach(reid); };
    reid(copy);
    snap(); h.list.splice(h.i + 1, 0, copy); sel = copy.id; commit(); focus(copy.id);
  }
  function move(id, dir) {
    const h = find(id); if (!h) return;
    const to = h.i + dir;
    if (to < 0 || to >= h.list.length) return;
    snap(); h.list.splice(to, 0, h.list.splice(h.i, 1)[0]); commit();
  }
  function lift(id) {                                   // 从容器里提到顶层
    const h = find(id); if (!h || h.list === tree) return;
    const parent = flat().find((p) => p.children && p.children.some((c) => c.id === id));
    snap(); h.list.splice(h.i, 1);
    const at = tree.indexOf(parent);
    tree.splice(at >= 0 ? at + 1 : tree.length, 0, h.b);
    commit(); focus(id);
  }
  const focus = (id) => listEl.querySelector(`.bk[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });

  /* ---------- 拖拽：指针 + 幽灵 + 插入线 ----------
     HTML5 拖放做不到"跟手的幽灵 + 落在哪插到哪"（也带不动触屏），所以自己实现。 */
  let ghost = null, line = null;
  function dropAt(ev) {
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!over) return null;
    if (over.closest("#bsTrash") || trash.contains(over)) return { kind: "trash" };
    if (!canvas.contains(over)) return null;
    const mouth = over.closest(".bk-m");
    const bk = over.closest(".bk");
    if (mouth && bk && mouth === bk.querySelector(":scope > .bk-m")) return { kind: "into", id: mouth.dataset.slot };
    if (bk) {
      const r = bk.getBoundingClientRect();
      const own = bk.querySelector(":scope > .bk-m");
      // 落在容器块的下半截 = 装进它的口里；其余按"插到这块之前/之后"
      if (own && ev.clientY > r.top + r.height * 0.55) return { kind: "into", id: bk.dataset.id };
      return { kind: "sibling", id: bk.dataset.id, before: ev.clientY < r.top + r.height / 2 };
    }
    return { kind: "tail" };
  }
  function markTarget(t) {
    trash.classList.toggle("on", !!t && t.kind === "trash");
    listEl.querySelectorAll(".bk.over-into").forEach((n) => n.classList.remove("over-into"));
    if (!line) { line = document.createElement("i"); line.className = "bk-line"; }
    if (!t || t.kind === "trash" || t.kind === "tail") { line.remove(); return; }
    if (t.kind === "into") {
      line.remove();
      listEl.querySelector(`.bk[data-id="${t.id}"]`)?.classList.add("over-into");
      return;
    }
    const el = listEl.querySelector(`.bk[data-id="${t.id}"]`);
    if (!el) { line.remove(); return; }
    const host = el.parentElement;
    host.insertBefore(line, t.before ? el : el.nextSibling);
  }
  function startDrag(ev, what) {
    // 只认主指针：右键留给菜单、中键留给浏览器；button 在部分指针事件里是 -1，
    // 用 `if (ev.button)` 会把左键也一起挡掉（Chrome 的 pointermove 上它恒为 -1）
    if (ev.button > 0 || (ev.isPrimary === false && ev.type === "pointerdown")) return;
    const sx = ev.clientX, sy = ev.clientY;
    let live = false;
    const move = (e) => {
      if (!live && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 5) return;
      if (!live) {
        live = true;
        ghost = document.createElement("div");
        ghost.className = "bk-ghost";
        ghost.style.setProperty("--bk-scale", String(zoom));
        const srcId = what.fresh ? null : what.id;
        const src = srcId ? listEl.querySelector(`.bk[data-id="${srcId}"]`) : null;
        ghost.innerHTML = (src ? src.outerHTML : blockHtml(mk(what.fresh))).replace(/ class="bk /, ' class="bk ');
        document.body.appendChild(ghost);
        if (src) src.classList.add("lifted");
        canvas.classList.add("dragging");
      }
      ghost.style.left = e.clientX + 14 + "px";
      ghost.style.top = e.clientY + 12 + "px";
      markTarget(dropAt(e));
      e.preventDefault();
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      if (!live) return;
      const t = dropAt(e);
      ghost?.remove(); ghost = null; line?.remove();
      trash.classList.remove("on");
      listEl.querySelectorAll(".bk.over-into,.bk.lifted").forEach((n) => n.classList.remove("over-into", "lifted"));
      canvas.classList.remove("dragging");
      if (t) commitDrop(t, what);
      else { render(); }
      e.preventDefault();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  }
  function commitDrop(t, what) {
    snap();
    const host = what.fresh ? null : find(what.id);
    if (t.kind === "trash") { if (host) host.list.splice(host.i, 1); if (sel === what.id) sel = null; return commit(); }
    if (host) host.list.splice(host.i, 1);
    const b = what.fresh ? mk(what.fresh) : host.b;
    if (t.kind === "into") {
      const h = find(t.id);
      if (h && TYPES[h.b.type].body) (h.b.children = h.b.children || []).push(b);
      else tree.push(b);
    } else if (t.kind === "sibling") {
      const h = find(t.id);
      if (!h) tree.push(b);
      else h.list.splice(t.before ? h.i : h.i + 1, 0, b);
    } else tree.push(b);
    if (TYPES[b.type].hat && find(b.id).list !== tree) {
      // 事件块被塞进口里：模型上不允许，回到顶层而不是留下一个编译时要跳过的块
      const h = find(b.id); h.list.splice(h.i, 1); tree.push(b);
    }
    sel = b.id; commit(); focus(b.id);
  }

  /* ---------- 交互绑定 ---------- */
  listEl.addEventListener("click", (ev) => {
    const bk = ev.target.closest(".bk");
    if (!bk) { if (sel) { sel = null; render(); } return; }
    if (ev.target.matches(".bk-x")) return remove(bk.dataset.id);
    sel = bk.dataset.id; render();
  });
  listEl.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("input,select,button")) return;
    const bk = ev.target.closest(".bk");
    if (bk) startDrag(ev, { id: bk.dataset.id });
  });
  listEl.addEventListener("input", (ev) => {
    const inp = ev.target.closest(".bk-f");
    if (!inp || inp.tagName === "SELECT") return;
    const b = (find(ev.target.closest(".bk").dataset.id) || {}).b;
    if (!b) return;
    const fd = (TYPES[b.type].fields || {})[inp.dataset.k];
    b.f[inp.dataset.k] = fd && fd.t === "num" ? (inp.value === "" ? fd.d : +inp.value) : inp.value;
    paintCode(); saveTree(); if (auto && auto.checked) writeScript(false);   // 不重建 DOM：那会丢掉正在敲的输入框焦点
  });
  listEl.addEventListener("change", (ev) => {
    const s = ev.target.closest("select.bk-f");
    if (!s) return;
    const b = (find(ev.target.closest(".bk").dataset.id) || {}).b;
    if (!b) return;
    b.f[s.dataset.k] = s.value; paintCode(); saveTree(); if (auto && auto.checked) writeScript(false);
  });
  listEl.addEventListener("contextmenu", (ev) => {
    const bk = ev.target.closest(".bk");
    if (!bk) return;
    ev.preventDefault();
    const id = bk.dataset.id;
    const h = find(id), d = TYPES[h.b.type] || {};
    const inMouth = !!flat().find((p) => p.children && p.children.some((c) => c.id === id));
    ideMenu(E, [
      { label: "复制一块", keys: "Ctrl+D", run: () => dupe(id) },
      { label: "删除这块", keys: "Del", run: () => remove(id) },
      { sep: true },
      { label: "往上一格", run: () => move(id, -1) },
      { label: "往下一格", run: () => move(id, 1) },
      { label: "提到顶层", disabled: !inMouth, run: () => lift(id) },
      { sep: true },
      { label: "清空这一口的内容", disabled: !d.body || !(h.b.children || []).length, run: () => { snap(); h.b.children = []; commit(); } },
    ], ev.clientX, ev.clientY);
  });
  screen.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === "s") { ev.preventDefault(); return writeScript(true); }
    if (ev.key === "/" && !ev.target.matches("input,select")) { ev.preventDefault(); filter.focus(); return; }
    if (ev.key === "Escape" && ev.target === filter) { filter.value = ""; renderTool(); filter.blur(); return; }
    if (mod && ev.key.toLowerCase() === "z") { ev.preventDefault(); return undo(); }
    if (ev.target.matches("input,select")) return;
    if (mod && ev.key.toLowerCase() === "d" && sel) { ev.preventDefault(); return dupe(sel); }
    if (mod && ev.key === "ArrowUp" && sel) { ev.preventDefault(); return move(sel, -1); }
    if (mod && ev.key === "ArrowDown" && sel) { ev.preventDefault(); return move(sel, 1); }
    if ((ev.key === "Delete" || ev.key === "Backspace") && sel) { ev.preventDefault(); return remove(sel); }
    if (ev.key === "Escape" && sel) { sel = null; render(); }
  });
  screen.querySelector(".bs-quick").addEventListener("click", (ev) => {
    const p = ev.target.closest("[data-preset]");
    if (!p || !PRESETS[p.dataset.preset]) return;
    snap(); tree = PRESETS[p.dataset.preset](); sel = null; commit();
  });
  filter.oninput = () => renderTool(filter.value.trim().toLowerCase());

  /* 缩放：Ctrl+滚轮或右上角三颗；块的位置仍按矩形算，插入线不会偏 */
  const setZoom = (z) => { zoom = clamp(z, ZOOMS[0], ZOOMS[ZOOMS.length - 1]); render(); };
  screen.querySelector("#bsZoomIn").onclick = () => setZoom(zoom + 0.15);
  screen.querySelector("#bsZoomOut").onclick = () => setZoom(zoom - 0.15);
  screen.querySelector("#bsZoom").onclick = () => setZoom(1);
  canvas.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    setZoom(zoom + (ev.deltaY > 0 ? -0.06 : 0.06));
  }, { passive: false });

  /* ---------- 头部与代码栏 ---------- */
  screen.querySelector("#bsExample").onclick = () => { snap(); tree = EXAMPLE(); sel = null; commit(); };
  screen.querySelector("#bsClear").onclick = () => {
    if (!tree.length) return E.toast("画布已经空了", true);
    if (!confirm("清掉所有积木？（脚本里已生成的 " + FILE + " 不会被删）")) return;
    snap(); tree = []; sel = null; commit();
  };
  screen.querySelector("#bsUndo").onclick = undo;
  screen.querySelector("#bsWrite").onclick = () => writeScript(true);
  screen.querySelector("#bsRun").onclick = () => { if (!writeScript(false)) return; document.getElementById("scriptPlay")?.click(); };
  screen.querySelector("#bsCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(js()); E.toast("代码已复制"); }
    catch { E.toast("浏览器不给网页写剪贴板（这是安全边界）：到脚本页 Ctrl+A 再复制", true); }
  };
  screen.querySelector("#bsOpen").onclick = () => {
    if (!writeScript(false)) return;
    document.querySelector('.mtab[data-menu="script"]')?.click();
    const i = (E.state.scripts || []).findIndex((f) => f.name === FILE);
    if (i >= 0 && E.__openScriptTab) E.__openScriptTab(i);
  };
  screen.querySelector(".bs-back").onclick = () => document.querySelector('.mtab[data-menu="build"]')?.click();
  if (auto) auto.onchange = () => { if (auto.checked) writeScript(false); };

  const grip = screen.querySelector("#gripBlocks");
  if (grip) {
    const codeCol = screen.querySelector(".bs-code");
    const root = document.documentElement;
    const setW = (px) => root.style.setProperty("--bs-code-w", Math.round(clamp(px, 220, innerWidth * 0.6)) + "px");
    let sx = 0, sw = 0, on = false;
    grip.addEventListener("pointerdown", (ev) => { on = true; sx = ev.clientX; sw = codeCol.getBoundingClientRect().width; try { grip.setPointerCapture(ev.pointerId); } catch {} });
    grip.addEventListener("pointermove", (ev) => { if (on) setW(sw - (ev.clientX - sx)); });
    grip.addEventListener("pointerup", () => { on = false; });
    grip.addEventListener("dblclick", () => { root.style.removeProperty("--bs-code-w"); try { localStorage.removeItem("ly_bsw"); } catch {} });
    grip.addEventListener("keydown", (ev) => {
      const cur = parseFloat(getComputedStyle(root).getPropertyValue("--bs-code-w")) || 340;
      if (ev.key === "ArrowLeft") { ev.preventDefault(); setW(cur + 20); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); setW(cur - 20); }
    });
    try { const w = +localStorage.getItem("ly_bsw"); if (w > 200) setW(w); } catch {}
  }

  renderTool();
  render();
  paintCode();
  screen.__open = () => {
    const m = (E.state.meta || {}).blocks;
    if (Array.isArray(m) && m.length && !tree.length) {
      tree = JSON.parse(JSON.stringify(m));
      for (const b of flat(tree)) {
        const old = /^vox_(set|if)_(\d+)$/.exec(b.type || "");
        if (!old) continue;
        const block = E.atlas.byId(Number(old[2]));
        b.type = old[1] === "set" ? "set_voxel" : "if_voxel";
        b.f = Object.assign({}, b.f, { name: block?.name || "grass" });
      }
    }
    render(); paintCode();
  };
}
