// ai-agent.js — 「AI Agent」全自动小窗：给一个目标，它自己写脚本、自己盖模型、
// 自己跑一遍看报不报错，报错就改，直到收工或用完预算。
//
// 为什么是"小窗"而不是又一个全屏抽屉：Agent 一跑就是十几轮、几十秒到几分钟，
// 用户要能同时看到世界在长什么样子，也要能随时打断。所以它是一个可拖动的浮层，
// 而且刻意不用 .modal 这个类——enterPlay() 会关掉所有 .modal.show，
// 而 playtest 这一步正好要进运行模式，日志被顺手关掉的话这一轮就成黑箱了。
//
// 为什么是 JSON 动作协议，而不是 OpenAI 的 function calling：
// 用户填的是"任意 OpenAI 兼容服务"，各家对 tools / tool_calls 的支持参差很大
// （LM Studio 要开 parser、部分中转站直接吞掉、Ollama 的兼容层时好时坏）。
// 让模型回一段 JSON 是所有实现都支持的最大公约数，代价是要自己解析与容错——
// 所以下面 parseAction / sanitizeAction 是全流程里最要紧的两个纯函数，
// 它们必须能在没有浏览器、没有网络的情况下被测（test/ai.mjs 就是干这个的）。
//
// 三条底线：
//  1. **预算**。步数、每次调用的 token、观察文本长度全部有上限，跑飞了会自己停。
//  2. **不越权**。Agent 能写的只有地图脚本与体素；碰不到存档、网络、文件系统，
//     也碰不到用户填的密钥（写脚本时故意不告诉它配置的存在）。
//  3. **每步都可撤销**。盖体素走 history，写脚本前整份脚本表先 snapshot，
//     所以"Agent 把世界搞坏了"这件事的正确答案永远是 Cmd-Z。

import { chat, aiReady, openSettings, checkSyntax, extractJson, validateVoxelProgram, programToVoxels } from "./ai.js";
import { apiDigest, specPrompt } from "./ai-script.js";
import { runSandboxCode, createWorld, addEntityMarker } from "./features.js";
import { exportProjectZip } from "./io.js";
import { dataStorageKey, dataStoragePrefix } from "./game.js";
import { PRESETS } from "./terrain.js";

const MAX_STEPS_DEFAULT = 14;
const MAX_CODE = 20000;         // 单个脚本的字符上限
const MAX_OBS = 3600;           // 每条观察回喂给模型的字符上限
const MAX_READ = 6000;          // readScript 回喂上限

/* ---------------- 动作协议（纯函数，可离线测） ---------------- */

/* ---------------- 动作协议（纯函数，可离线测） ---------------- */

/**
 * 动作名一律用官方 CLI `apc` 的 `<组>.<动词>` 形状，而不是我自己发明的驼峰。
 * 依据是官方文档 arenapro/zh/cli/guide/cli-commands.md 与 engine-openapi-mcp 的 README
 * （script.saveOrUpdate / storage.get|set|remove|page 那一套），只对齐**命名与参数形状**，
 * 不搬它们的代码（engine-openapi-mcp 仓库没有 LICENSE）。
 *
 * 为什么值得对齐：模型在训练与文档里见过的就是这套名字。自己另起一套
 * （inspectWorld / writeScript / playtest）等于凭空增加一次映射失败——
 * 它会输出 apc 风格的 script.upload，然后收到一句"不认识的动作"，
 * 白烧一轮。别名表就是为这件事留的兜底，不是兼容包袱。
 */
export const TOOLS = [
  { name: "project.info", desc: "看当前地图工程现状：世界尺寸、方块数、模型与实体数、玩家位置、脚本清单。无参数。" },
  { name: "project.create", desc: "新建一张空图并切过去（会丢掉当前未保存的编辑，谨慎用）。",
    args: { name: "地图名", size: "[X,Y,Z] 三个整数，各轴 8..256", terrain: `可选地貌，只能是：${PRESETS.map((p) => p.id).join(" / ")}；省略就是平地` } },
  { name: "map.save", desc: "把当前地图保存到本地世界库（Agent 做完一批改动就该存一次，别等收尾）。" },
  { name: "map.blocks", desc: "列出可用方块名与分类，供 blocks.edit 与 model.build 选材质。（官方没有这个动词，纯粹是本实现的地编能力）" },

  { name: "script.list", desc: "列出本工程所有脚本（文件名、端、行数）。无参数。" },
  { name: "script.get", desc: "读一个脚本的全文。", args: { entry: "脚本文件名，如 index.js", side: "可选 server|client；同名脚本分端时用它区分" } },
  { name: "script.upload", desc: "新建或覆盖一个脚本。落地前先过语法预检，语法不过不会写入。跨文件复用用 CommonJS：require(\"./x.js\") 与 module.exports。",
    args: { entry: "脚本文件名，必须以 .js 结尾", side: "server 或 client（官方契约要求显式声明，不要靠文件名猜）", code: "完整 JavaScript 源码" } },
  { name: "script.rename", desc: "重命名一个脚本。", args: { entry: "现名", newEntry: "新名" } },

  { name: "storage.set", desc: "写一条持久化数据。scope=project 等价脚本里的 storage.getDataStorage(name)（只这张图），scope=group 是 getGroupStorage（本实现里退化为这台设备共享）。",
    args: { name: "存储名", key: "键", value: "任意 JSON 值", scope: "可选 project|group，默认 project" } },
  { name: "storage.get", desc: "读一条持久化数据。", args: { name: "存储名", key: "键", scope: "可选 project|group" } },
  { name: "storage.list", desc: "列出某个存储里的键。", args: { name: "存储名", scope: "可选 project|group" } },
  { name: "storage.remove", desc: "删一条持久化数据。官方 storage delete 要带 --yes，这里同样要求显式确认。",
    args: { name: "存储名", key: "键", scope: "可选 project|group", confirm: "必须传 true 才会真删" } },

  { name: "blocks.edit", desc: "立刻执行一段方块沙箱代码（只有 sb.* 全局），返回输出与变更格数。造地形、砌墙用它。",
    args: { code: "sb 沙箱代码：sb.set/del/block/box/sphere/clear/count/size/log" } },
  { name: "model.build", desc: "把一个体素图元程序盖进世界（可撤销）。做独立物件、道具、装饰用它。",
    args: { at: "[x,y,z] 整数世界坐标，部件左下角锚点", program: "体素程序 {name, parts:[{name,size,prims:[...]}]}" } },
  { name: "entity.add", desc: "放一个**实体触发盒**进世界（区域/检查点/道具都用它），带名字与标签供脚本用 #名字 / .标签 取。注意：这不是放模型网格，模型用 model.build。",
    args: { name: "实体名，如 检查点-0", at: "[x,y,z] 整数世界坐标（盒底中心）", label: "可选标签，供 .标签 选择器", bounds: "可选半尺寸 [hx,hy,hz]，默认 [1.5,1.5,1.5]", collides: "可选，是否参与碰撞" } },

  { name: "build.check", desc: "发布前那道静态闸门：逐个脚本查语法、查有没有用到本实现没提供的 API 成员。不执行任何东西。" },
  { name: "runtime.start", desc: "进入运行模式开始预览。", args: { ticks: "要跑多久，1..200 tick（1 tick = 64ms）" } },
  { name: "runtime.status", desc: "问运行模式现在是什么状态、引擎跑到第几个 tick。" },
  { name: "runtime.logs", desc: "取运行期日志尾部（配合 runtime.start 用）。", args: { level: "all 或 error" } },
  { name: "runtime.stop", desc: "退出运行模式，回到编辑。" },
  { name: "scene.capture", desc: "截一张当前视口，显示在小窗里给人看，同时回一段文字概要给模型。" },
  { name: "package.export", desc: "把整个工程导出成官方同构的项目包 .zip。做完整项目时这是交付物。" },

  { name: "finish", desc: "收工。summary 里说清做了什么、怎么触发、还剩什么没做。", args: { summary: "给用户看的中文小结" } },
];

/**
 * 别名：旧驼峰名与模型最常自己发挥的几个写法。
 * 命中别名会**归一化成正式动作**再往下走，所以 execTool 只认正式名。
 */
const ALIAS = {
  inspectWorld: "project.info", worldDigest: "project.info", inspect: "project.info",
  listScripts: "script.list", readScript: "script.get", writeScript: "script.upload",
  saveScript: "script.upload", "script.saveOrUpdate": "script.upload", "script.save": "script.upload",
  runSandbox: "blocks.edit", sandbox: "blocks.edit", buildModel: "model.build", model: "model.build",
  checkScripts: "build.check", validate: "build.check", playtest: "runtime.start",
  "storage.page": "storage.list", "storage.delete": "storage.remove", "storage.del": "storage.remove",
  save: "map.save", "map.saveWorld": "map.save", finishTask: "finish", done: "finish",
};

/** 把任意写法归一到正式动作名；认不出来返回 null。 */
export function normalizeAction(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  if (TOOL_NAMES_SET.has(s)) return s;
  const lower = s.toLowerCase();
  for (const [k, v] of Object.entries(ALIAS)) if (k.toLowerCase() === lower) return v;
  for (const n of TOOL_NAMES) if (n.toLowerCase() === lower) return n;
  return null;
}

const TOOL_NAMES_SET = new Set(TOOLS.map((t) => t.name));
export const TOOL_NAMES = TOOLS.map((t) => t.name);

/** 把动作协议讲给模型听。这段是协议的唯一来源，别处不许再抄一份措辞。 */
export function toolBrief() {
  return TOOLS.map((t) => {
    const a = t.args ? Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join("；") : "（无参数）";
    return `- ${t.name} — ${t.desc}\n    args: ${a}`;
  }).join("\n");
}

/**
 * 从模型回答里取出一个动作。容错是有意的：模型经常把 JSON 包在围栏里、
 * 或者在前后加解释话。但**只取第一个对象**，多的说明它想一次干好几件事——
 * 那种情况要让它拆开，否则失败时说不清是哪一步坏的。
 * @throws {Error} 解析不出来时抛错，调用方把错误原文喂回模型
 */
const META_KEYS = new Set(["action", "tool", "name", "thought", "plan", "args"]);

export function parseAction(text) {
  const obj = extractJson(text);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("不是一个 JSON 对象");
  const action = String(obj.action || obj.tool || "").trim();
  if (!action) throw new Error('缺少 "action" 字段');
  // 两种写法都收：{"action":"writeScript","args":{...}} 与摊平的
  // {"action":"writeScript","name":…,"code":…}。模型对后者的命中率明显更高，
  // 但摊平时别把 action/thought 自己也当成参数带下去——日志里会出现
  // "writeScript {action:writeScript, thought:…}" 这种看着像协议坏掉的东西。
  let args = null;
  if (obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)) args = obj.args;
  else if (obj.args) args = {};
  else {
    args = {};
    for (const [k, v] of Object.entries(obj)) if (!META_KEYS.has(k)) args[k] = v;
    // "name" 在摊平形式里既是动作名又是真参数（readScript 的 name），只能猜：
    // 有 code 说明是 writeScript 的文件名，没有就按脚本名用。
    if (typeof obj.name === "string" && obj.name !== action) args.name = obj.name;
  }
  return { action, args, thought: typeof obj.thought === "string" ? obj.thought : (typeof obj.plan === "string" ? obj.plan : "") };
}

/** 观察文本回喂前的截断。太长会把上下文挤爆，而中间截断能同时留住头尾。 */
export function clip(text, n = MAX_OBS) {
  const s = String(text == null ? "" : text);
  if (s.length <= n) return s;
  const head = Math.floor(n * 0.7), tail = n - head - 20;
  return s.slice(0, head) + "\n…（中间省略 " + (s.length - n) + " 字）…\n" + s.slice(s.length - tail);
}

/**
 * 校验并夹紧一个动作。返回 {ok:true, action, args} 或 {ok:false, error}。
 * 这里**不抛异常**：动作不合法是常态（模型会犯），要变成一句能喂回去的观察，
 * 而不是把整个循环打断。
 */
export function sanitizeAction(parsed) {
  const asked = String(parsed && parsed.action || "").trim();
  const action = normalizeAction(asked);
  if (!action) {
    return { ok: false, error: `不认识的动作 "${asked}"。可用动作只有：${TOOL_NAMES.join("、")}。请只选一个。` };
  }
  const raw = parsed.args || {};
  const args = {};

  const takeCode = (label) => {
    const code = String(raw.code == null ? "" : raw.code);
    if (!code.trim()) return { err: `${label} 需要 args.code` };
    if (code.length > MAX_CODE) return { err: `代码 ${code.length} 字，超过上限 ${MAX_CODE}。拆成多个文件，或写短一点。` };
    const syn = checkSyntax(code);
    if (!syn.ok) return { err: `语法不过，没有落地。编译器原话：${syn.error}` };
    return { code };
  };
  const takeEntry = (v, label) => {
    const name = String(v || "").trim();
    // 文件名会进 meta.scripts，并作为包内路径的一段被导出，所以只准走安全字符。
    // ".." 与 "/" 必须挡掉，否则一个脚本名就能写出工程目录。
    if (!/^[\w.\- ]{1,64}\.js$/.test(name) || name.includes("..") || name.includes("/") || name.includes("\\")) {
      return { err: `${label}不合法："${name}"。要像 index.js 或 clientIndex.js 这样，以 .js 结尾且不含路径分隔符。` };
    }
    return { name };
  };
  const takeAt = (label) => {
    const at = Array.isArray(raw.at) ? raw.at.map((v) => Math.round(Number(v) || 0)) : null;
    if (!at || at.length !== 3 || at.some((v) => !Number.isFinite(v))) {
      return { err: `${label} 需要 args.at，形如 [x, y, z] 的三个整数世界坐标` };
    }
    return { at };
  };

  if (action === "script.get") {
    const e = takeEntry(raw.entry || raw.name, "脚本文件名");
    if (e.err) return { ok: false, error: e.err };
    args.entry = e.name;
  } else if (action === "script.rename") {
    const e = takeEntry(raw.entry || raw.name, "脚本文件名");
    if (e.err) return { ok: false, error: e.err };
    const n = takeEntry(raw.newEntry || raw.newName, "新文件名");
    if (n.err) return { ok: false, error: n.err };
    args.entry = e.name; args.newEntry = n.name;
  } else if (action === "script.upload") {
    const e = takeEntry(raw.entry || raw.name, "脚本文件名");
    if (e.err) return { ok: false, error: e.err };
    const c = takeCode("script.upload");
    if (c.err) return { ok: false, error: c.err };
    // 端必须由调用方显式声明，这是官方契约（apc script upload <project> <side> <entry>）。
    // 本实现内部按文件名判端，所以这里把 side 翻成文件名约定，而不是另添一个字段——
    // 否则会出现"声明 server、实际按客户端跑"这种两边都说自己没错的状态。
    let side = String(raw.side || "").trim().toLowerCase();
    if (!side) side = /client/i.test(e.name) ? "client" : "server";
    if (side !== "server" && side !== "client") return { ok: false, error: `side 只能是 server 或 client，收到 "${raw.side}"。` };
    let entry = e.name;
    if (side === "client" && !/client/i.test(entry)) entry = entry.replace(/\.js$/i, "Client.js");
    if (side === "server" && /client/i.test(entry)) {
      return { ok: false, error: `side=server，但文件名 "${entry}" 含 client。本实现按文件名判端，它会当客户端脚本跑；换个名字或把 side 改成 client。` };
    }
    args.entry = entry; args.side = side; args.code = c.code;
  } else if (action === "blocks.edit") {
    const c = takeCode("blocks.edit");
    if (c.err) return { ok: false, error: c.err };
    args.code = c.code;
  } else if (action === "model.build") {
    const a = takeAt("model.build");
    if (a.err) return { ok: false, error: a.err };
    if (raw.program == null) return { ok: false, error: "model.build 需要 args.program（体素图元程序）" };
    args.at = a.at; args.program = raw.program;   // 越界与配额在 validateVoxelProgram 里判，别在这重复
  } else if (action === "entity.add") {
    const a = takeAt("entity.add");
    if (a.err) return { ok: false, error: a.err };
    const name = String(raw.name || "").trim();
    if (!name) return { ok: false, error: "entity.add 需要 args.name（脚本要靠 #名字 或 .标签 取它）" };
    if (!/^[\w.\- \u4e00-\u9fa5]{1,64}$/.test(name)) return { ok: false, error: `实体名不合法："${name}"` };
    const b = Array.isArray(raw.bounds) ? raw.bounds.map((v) => Math.max(0.1, Number(v) || 1)) : [1.5, 1.5, 1.5];
    if (b.length !== 3) return { ok: false, error: "entity.add 的 args.bounds 要是三个数，例如 [1.5, 1.5, 1.5]" };
    args.name = name;
    args.at = a.at;
    args.bounds = b;
    args.label = String(raw.label || "").trim().slice(0, 64);
    args.collides = !!raw.collides;
  } else if (action === "project.create") {
    const size = Array.isArray(raw.size) ? raw.size.map((v) => Math.round(Number(v) || 0)) : null;
    if (!size || size.length !== 3 || size.some((v) => v < 8 || v > 256)) {
      return { ok: false, error: "project.create 需要 args.size，形如 [128, 64, 128]，每轴 8..256" };
    }
    args.size = size;
    args.name = String(raw.name || "AI 新建地图").trim().slice(0, 64) || "AI 新建地图";
    // 地貌名以 terrain.js 的 PRESETS 为准，不是把字符串原样传下去：
    // 拼错一个字母会被当成"无地貌"，最后交付一张平地，而模型以为自己有山。
    const t = String(raw.terrain || "").trim();
    if (t && !PRESETS.some((p) => p.id === t)) {
      return { ok: false, error: `没有这个地貌预设 "${t}"。可用：${PRESETS.map((p) => p.id).join("、")}；或省略 terrain 得到平地。` };
    }
    args.terrain = t;
  } else if (action === "storage.set") {
    const name = String(raw.name || "").trim();
    const key = String(raw.key || "").trim();
    if (!name || !key) return { ok: false, error: "storage.set 需要 args.name（存储名）与 args.key" };
    if (raw.value === undefined) return { ok: false, error: "storage.set 需要 args.value（任意 JSON 值）" };
    const sc = storageScope(raw.scope);
    if (sc.err) return { ok: false, error: sc.err };
    args.name = name.slice(0, 64); args.key = key.slice(0, 128); args.value = raw.value; args.scope = sc.scope;
  } else if (action === "storage.get" || action === "storage.remove") {
    const name = String(raw.name || "").trim();
    const key = String(raw.key || "").trim();
    if (!name || !key) return { ok: false, error: `${action} 需要 args.name 与 args.key` };
    const sc = storageScope(raw.scope);
    if (sc.err) return { ok: false, error: sc.err };
    args.name = name.slice(0, 64); args.key = key.slice(0, 128); args.scope = sc.scope;
    // 官方 storage delete 必须带 --yes（cli-commands.md:343），而且删一个不存在的键
    // 要回"无需删除"而不是成功。这里把 confirm 做成同样的闸门。
    if (action === "storage.remove" && raw.confirm !== true) {
      return { ok: false, error: `storage.remove 需要 args.confirm=true 才会真删（对齐官方 storage delete 的 --yes）。要先看有什么，用 storage.list。` };
    }
  } else if (action === "storage.list") {
    const sc = storageScope(raw.scope);
    if (sc.err) return { ok: false, error: sc.err };
    args.name = String(raw.name || "").trim().slice(0, 64); args.scope = sc.scope;
  } else if (action === "runtime.start") {
    const n = Math.round(Number(raw.ticks));
    args.ticks = Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 60;
  } else if (action === "runtime.logs") {
    args.level = String(raw.level || "error").trim().toLowerCase() === "all" ? "all" : "error";
  } else if (action === "finish") {
    args.summary = String(raw.summary || raw.result || "").trim() || "（模型没有写小结）";
  }
  return { ok: true, action, args };
}

/* ---------------- 工具落地 ---------------- */

function worldDigest(E) {
  const w = E.world;
  const players = (E.state.meta && E.state.meta.players) || [];
  return {
    size: w.shape.slice(),
    blocks: w.size(),
    models: (E.state.models || []).length,
    scripts: (E.state.scripts || []).map((s) => `${s.name}(${(s.code || "").split("\n").length}行)`),
    playerPos: players.length && players[0].position ? players[0].position : null,
    worldName: (E.state.meta && E.state.meta.name) || E.state.name || "",
  };
}

/**
 * 把一个 #rrggbb 映到"颜色最接近的那个方块"。
 * 世界体素存的是方块 id、不是逐格颜色，所以 AI 给的十六进制色只能靠图集里
 * 现成的 383 个方块近似——这也是官方编辑器里玩家自己上色时受到的同一约束，
 * 不是我们这个实现的短板。383 个候选线性扫一遍，配一个 Map 缓存。
 */
const _hexCache = new Map();
function nearestBlockId(atlas, hex) {
  if (_hexCache.has(hex)) return _hexCache.get(hex);
  const t = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!t) return 0;
  const r = parseInt(t[1].slice(0, 2), 16) / 255, g = parseInt(t[1].slice(2, 4), 16) / 255, b = parseInt(t[1].slice(4, 6), 16) / 255;
  let best = 0, bd = Infinity;
  for (const blk of atlas.list()) {
    const c = blk.color || [1, 1, 1];
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = blk.id; }
  }
  _hexCache.set(hex, best);
  return best;
}

/** 盖一个体素程序进世界。返回变更格数；全被丢掉时把原因如实带回去。 */
function stampProgram(E, program, at) {
  const prog = validateVoxelProgram(program);
  const w = E.world;
  const changes = [];
  let placed = 0, unpicked = 0;
  for (const model of prog.models) {
    for (const part of model.parts) {
      for (const v of programToVoxels(part)) {
        const x = at[0] + v.x, y = at[1] + v.y, z = at[2] + v.z;
        if (!w.inBounds(x, y, z)) { unpicked++; continue; }
        const id = nearestBlockId(E.atlas, v.color);
        if (!id) { unpicked++; continue; }
        changes.push({ x, y, z, oldId: w.get(x, y, z), oldRot: w.getRot(x, y, z), newId: id, newRot: 0 });
        placed++;
      }
    }
  }
  if (!placed) return { ok: false, error: "这个程序展开后一个体素都没有（图元全被判定越界或超配额）。按规则重发：先 project.info 看清可用空间，再缩小尺寸。" };
  // 同格重复以最后一次为准，和 sb 沙箱的语义保持一致
  const dedup = new Map();
  for (const c of changes) dedup.set(c.x + "," + c.y + "," + c.z, c);
  const list = [...dedup.values()].filter((c) => c.oldId !== c.newId);
  if (!list.length) return { ok: false, error: "算出来的方块和现有世界完全一样，没有产生变更。" };
  E.history.commit(list, "AI Agent 建模");
  E.renderer.rebuildAll();
  E.updateStatus();
  return { ok: true, placed: list.length, dropped: prog.dropped || 0, unpicked };
}

/** 静态检查所有脚本：语法 + 用了哪些本实现没有的成员。 */
async function checkAllScripts(E, spec) {
  const rows = [];
  for (const s of E.state.scripts || []) {
    const code = s.code || "";
    // 空文件是合法的（新建地图就是两个空脚本），报"语法错误 代码是空的"
    // 会让 Agent 以为自己做错了什么，去改一个本来没问题的文件。
    if (!code.trim()) { rows.push(`${s.name}: （空文件，跳过）`); continue; }
    const syn = checkSyntax(code);
    const bad = [];
    if (syn.ok && spec) {
      // 只抓 `X.member` 形式的成员访问，够用且不会误报成"缺东西"：
      // 判据是"这个成员在规格里被标为未实现"，不是"规格里没提到这个名字"。
      for (const m of code.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        const nm = m[1];
        for (const [cls, d] of Object.entries(spec.classes || {})) {
          if (d.tracked === 1 && d.m[nm] && d.m[nm].i === 0 && !bad.includes(`${cls}.${nm}`)) bad.push(`${cls}.${nm}`);
        }
      }
    }
    rows.push(`${s.name}: ${syn.ok ? "语法通过" : "语法错误 " + syn.error}${bad.length ? " · 用到未实现成员 " + bad.join(",") : ""}`);
  }
  return rows.length ? rows.join("\n") : "（这张地图没有脚本）";
}

/* ---------------- Agent 主循环 ---------------- */

// 每条声明必须以 ; 或 } 结尾。上一版这里少了 z-index 后面的分号，CSS 解析器
// 会把 "9100 background:#12161d" 当成一个非法值整条丢掉——小窗于是 z-index:auto，
// 被 z-index:90 的脚本界面盖住：界面看着正常，但底部按钮全部点不到。
const CSS = `
#aiAgent{position:fixed;right:18px;top:88px;width:392px;max-width:94vw;height:min(600px,80vh);z-index:9100;
  background:#12161d;border:1px solid #2a3444;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.55);
  display:flex;flex-direction:column;color:#dfe6f0;font-size:12.5px}
#aiAgent header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #232c3a;cursor:move;user-select:none}
#aiAgent header b{font-size:13.5px;flex:1}
#aiAgent .ai-x{background:none;border:none;color:#8b98ab;font-size:17px;cursor:pointer;padding:0 4px}
#aiAgent .ag-body{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
#aiAgent .ag-goal{display:flex;flex-direction:column;gap:5px}
#aiAgent textarea{background:#0d1117;border:1px solid #2a3444;border-radius:6px;color:#e6edf6;padding:7px 9px;
  font-size:12.5px;font-family:inherit;min-height:56px;resize:vertical;line-height:1.6}
#aiAgent .ag-step{border-left:2px solid #2f3c50;padding-left:9px}
#aiAgent .ag-step.act{border-left-color:#fc8308}
#aiAgent .ag-step.err{border-left-color:#e0596a}
#aiAgent .ag-step.done{border-left-color:#6fd08c}
#aiAgent .ag-h{color:#ffc46b;font-weight:600}
#aiAgent .ag-o{color:#9fb0c6;white-space:pre-wrap;word-break:break-word;line-height:1.55;margin-top:2px}
#aiAgent .ag-acts{display:flex;gap:7px;padding:9px 12px;border-top:1px solid #232c3a;flex-wrap:wrap;align-items:center}
#aiAgent .ag-acts button{background:#222c3a;border:1px solid #33415a;color:#dfe6f0;border-radius:6px;padding:6px 11px;cursor:pointer;font-size:12.5px}
#aiAgent .ag-acts button.primary{background:#fc8308;border-color:#fc8308;color:#14100a;font-weight:600}
#aiAgent .ag-acts button:disabled{opacity:.45;cursor:default}
#aiAgent .ag-budget{margin-left:auto;color:#8b98ab;font-size:11.5px}
#aiAgent .ag-log{color:#8b98ab;font-size:11.5px}
`;

let _node = null;

export function closeAgent() { _node?.remove(); _node = null; }
export function agentOpen() { return !!_node; }

export function openAgent(E) {
  closeAgent();
  if (!document.getElementById("aiAgentStyle")) {
    const s = document.createElement("style"); s.id = "aiAgentStyle"; s.textContent = CSS;
    document.head.appendChild(s);
  }
  const d = document.createElement("div");
  d.id = "aiAgent";
  d.innerHTML = `
    <header><b>AI Agent 全自动</b><span class="ag-log" data-k="log"></span><button class="ai-x" title="收起">×</button></header>
    <div class="ag-body" data-k="body"></div>
    <div class="ag-acts">
      <button data-k="run" class="primary">开始</button>
      <button data-k="stop" disabled>中止</button>
      <button data-k="cfg">接口设置</button>
      <label style="display:flex;align-items:center;gap:4px;color:#8b98ab;font-size:11.5px">步数预算
        <input data-k="budget" type="number" min="2" max="30" value="${MAX_STEPS_DEFAULT}" style="width:46px;background:#0d1117;border:1px solid #2a3444;border-radius:5px;color:#e6edf6;padding:3px 5px;font-size:12px"></label>
      <span class="ag-budget" data-k="stat"></span>
    </div>`;
  document.body.appendChild(d);
  _node = d;

  const q = (k) => d.querySelector(`[data-k="${k}"]`);
  const body = q("body");
  body.innerHTML = `
    <div class="ag-goal">
      <label style="color:#a9b6c8">目标（说人话，越具体越好）</label>
      <textarea data-k="goal" spellcheck="false" placeholder="例：在世界中心用石头盖一座 12×12 的三层城堡，带四角塔楼和一面城墙；再写一个 index.js，玩家靠近城门时播报城堡名字"></textarea>
    </div>`;
  const goal = body.querySelector('[data-k="goal"]');
  const stepsHost = document.createElement("div");
  body.appendChild(stepsHost);

  dragHeader(d);
  d.querySelector(".ai-x").onclick = closeAgent;
  q("cfg").onclick = () => openSettings(() => stat(aiReady() ? "接口已配置" : "还没填完"));

  let busy = null;
  const stat = (m, cls) => { const n = q("stat"); n.textContent = m; n.className = "ag-budget" + (cls ? " " + cls : ""); };
  const line = (html, cls) => {
    const n = document.createElement("div");
    n.className = "ag-step" + (cls ? " " + cls : "");
    n.innerHTML = html;      // 只喂我们自己拼好的片段，见 esc()
    stepsHost.appendChild(n);
    body.scrollTop = body.scrollHeight;
    return n;
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  q("run").onclick = async () => {
    const want = goal.value.trim();
    if (!want) return stat("先写目标", "err");
    if (!aiReady()) { openSettings(); return; }
    stepsHost.replaceChildren();
    goal.disabled = true; q("run").disabled = true; q("stop").disabled = false;
    const ctrl = new AbortController();
    busy = ctrl;
    const budget = Math.max(2, Math.min(30, Number(q("budget").value) || MAX_STEPS_DEFAULT));
    const t0 = Date.now();
    let used = 0;
    // 声明在 for 外面：循环结束后靠"obs 是不是 null"区分正常 finish 与预算用尽。
    // 它曾待在 for 里面，于是 finish 分支跑完、跳出循环去读它时直接
    // ReferenceError——前 16 步的活全干完了，小窗却报"中断"。
    let obs;
    try {
      const digest = await apiDigest(E.atlas, "server");
      const spec = digest.spec || null;
      const sys = await specPrompt("server", digest) + "\n\n" + AGENT_RULES + "\n\n【可用动作】\n" + toolBrief();
      const msgs = [{ role: "system", content: sys }, { role: "user", content: "目标：" + want }];
      for (let step = 1; step <= budget; step++) {
        if (ctrl.signal.aborted) throw new Error("已中止");
        stat(`第 ${step}/${budget} 步 · ${(Date.now() - t0) / 1000 | 0}s`);
        q("log").textContent = "思考中…";
        const r = await chat(msgs, { signal: ctrl.signal, json: true, timeout: 150000, maxTokens: 4096 });
        q("log").textContent = "";
        used += (r.usage && r.usage.total_tokens) || 0;
        let parsed;
        try {
          parsed = parseAction(r.text);
        } catch (e) {
          line(`<span class="ag-h">${step}. 没能按格式回答</span><div class="ag-o">${esc(e.message)}</div>`, "err");
          obs = "你的上一次回答没能解析成一个动作 JSON。严格按这个格式重发，整段回答里只放一个 JSON 对象：" +
            `{"thought":"一句想法","action":"${TOOL_NAMES[0]}","args":{}}`;
          msgs.push({ role: "assistant", content: clip(r.text, 2000) });
          msgs.push({ role: "user", content: obs });
          continue;
        }
        const checked = sanitizeAction(parsed);
        if (!checked.ok) {
          line(`<span class="ag-h">${step}. ${esc(parsed.action)} — 动作不合法</span><div class="ag-o">${esc(checked.error)}</div>`, "err");
          msgs.push({ role: "assistant", content: JSON.stringify({ thought: parsed.thought, action: parsed.action, args: parsed.args }).slice(0, 4000) });
          msgs.push({ role: "user", content: "这一步没有执行。原因：" + checked.error });
          continue;
        }
        const { action, args } = checked;
        const shown = action === "script.upload" ? `${args.entry}［${args.side}］${(args.code || "").split("\n").length} 行`
          : action === "script.get" || action === "script.rename" || action === "storage.list" ? esc(args.entry || args.name || "")
          : action === "model.build" ? `at [${args.at}] · ${esc(args.program && args.program.name || "未命名")}`
          : action === "blocks.edit" ? clip((args.code || "").replace(/\s+/g, " "), 90)
          : action === "runtime.start" ? `${args.ticks} ticks`
          : action === "project.create" ? `${args.name} ${args.size.join("×")}${args.terrain ? " · " + args.terrain : ""}`
          : args.name ? esc(args.name) : "";
        line(`<span class="ag-h">${step}. ${esc(action)}${shown ? " " + shown : ""}</span>`);
        msgs.push({ role: "assistant", content: JSON.stringify({ thought: parsed.thought, action, args }).slice(0, 6000) });
        if (parsed.thought) line(`<div class="ag-o">${esc(parsed.thought)}</div>`);
        if (action === "finish") {
          line(`<div class="ag-o">${esc(args.summary)}</div>`, "done");
          stat(`完成 · ${step} 步 · ${((Date.now() - t0) / 1000).toFixed(1)}s`, "done");
          obs = null;
          break;
        }
        const res = await execTool(E, action, args, spec, (dataUrl) => {
          const img = document.createElement("img");
          img.src = dataUrl; img.alt = "当前视口";
          img.style.cssText = "max-width:100%;border-radius:6px;border:1px solid #2a3444;margin-top:4px";
          stepsHost.lastChild && stepsHost.lastChild.appendChild(img);
        });
        obs = res.ok ? res.obs : "失败：" + res.obs;
        line(`<div class="ag-o">${esc(obs)}</div>`, res.ok ? "act" : "err");
        msgs.push({ role: "user", content: "观察：" + clip(obs) });
      }
      if (obs !== null) {
        line(`<span class="ag-h">用完 ${budget} 步预算，自动停止</span><div class="ag-o">目标可能没做完。提高步数预算继续，或者让它先 finish 汇报现状。</div>`, "err");
        stat(`预算用尽 · ${budget} 步`, "err");
      }
    } catch (e) {
      if (e && e.name === "AbortError") { stat("已中止"); q("log").textContent = ""; }
      else {
        const m = String((e && (e.message || e)) || "");
        line(`<span class="ag-h">中断</span><div class="ag-o">${esc(m)}</div>`, "err");
        stat("中断", "err");
      }
    } finally {
      goal.disabled = false; q("run").disabled = false; q("stop").disabled = true; busy = null;
      if (used) q("log").textContent = `token ${used.toLocaleString()}`;
    }
  };
  q("stop").onclick = () => { busy?.abort(); stat("正在中止…"); };
  if (!aiReady()) stat("先点「接口设置」填完地址、模型与密钥");
  setTimeout(() => goal.focus(), 60);
}

/** 官方 storage 有 --scope project|group 两档；映射到我们的 map / group 作用域。 */
function storageScope(v) {
  const s = String(v || "project").trim().toLowerCase();
  if (s === "project" || s === "map") return { scope: "map" };
  if (s === "group") return { scope: "group" };
  return { err: `scope 只能是 project 或 group，收到 "${v}"。project=只这张图（官方 getDataStorage），group=主副图共用（官方 getGroupStorage）。` };
}

/** 执行一个已校验的动作，返回 {ok, obs}。obs 永远是一句能直接喂回模型的话。 */
async function execTool(E, action, args, spec, onShot) {
  const scripts = () => E.state.scripts || (E.state.scripts = []);
  const findScript = (name) => scripts().find((s) => s.name === name);
  try {
    switch (action) {
      case "project.info": {
        const g = worldDigest(E);
        return { ok: true, obs: `世界「${g.worldName}」 尺寸 ${g.size.join("×")} · ${g.blocks.toLocaleString()} 格方块 · ${g.models} 个模型/实体 · 脚本 ${g.scripts.join("、") || "无"}` +
          (g.playerPos ? ` · 玩家在 [${g.playerPos.map((v) => +v.toFixed(1))}]` : "") };
      }
      case "project.create": {
        createWorld("custom", args.size[0], args.size[1], args.size[2], 16, args.name,
          args.terrain ? { preset: args.terrain } : null);
        return { ok: true, obs: `已新建并切到「${args.name}」 ${args.size.join("×")}${args.terrain ? " · 地貌 " + args.terrain : ""}。当前世界是空的，先 project.info 确认尺寸再动工。` };
      }
      case "map.save": {
        const id = await E.save();
        return { ok: true, obs: `已保存到本地世界库${id ? "（id " + id + "）" : ""}` };
      }
      case "map.resource": {
        return { ok: true, obs: "可用方块（按分类，每类取前几个）：" + (await apiDigest(E.atlas, "server")).names };
      }
      case "script.list": {
        const s = scripts();
        return { ok: true, obs: s.length ? s.map((x) => `${x.name}［${/client/i.test(x.name) ? "client" : "server"}］${(x.code || "").split("\n").length} 行`).join("、") : "本工程还没有脚本" };
      }
      case "script.get": {
        const cur = findScript(args.entry);
        return cur ? { ok: true, obs: clip(cur.code || "（空文件）", MAX_READ) } : { ok: false, obs: `没有叫 ${args.entry} 的脚本` };
      }
      case "script.upload": {
        const s = scripts();
        const hit = findScript(args.entry);
        if (hit) hit.code = args.code; else s.push({ name: args.entry, code: args.code });
        E.markDirty?.();
        E.refreshScriptFiles?.();
        return { ok: true, obs: `已${hit ? "覆盖" : "新建"} ${args.entry}（${args.code.split("\n").length} 行 · ${args.side} 端），语法预检通过。用户按 Cmd-Z 可撤销。` };
      }
      case "script.rename": {
        const hit = findScript(args.entry);
        if (!hit) return { ok: false, obs: `没有叫 ${args.entry} 的脚本` };
        if (findScript(args.newEntry)) return { ok: false, obs: `${args.newEntry} 已经存在，先处理重名` };
        hit.name = args.newEntry;
        E.markDirty?.();
        E.refreshScriptFiles?.();
        return { ok: true, obs: `已把 ${args.entry} 改名为 ${args.newEntry}` };
      }
      case "storage.set": {
        const k = dataStorageKey("storage", args.scope, args.name, args.key, E.worldId);
        try { localStorage.setItem(k, JSON.stringify(args.value)); }
        catch (e) { return { ok: false, obs: "写入失败：" + String(e && e.message || e) }; }
        return { ok: true, obs: `${args.scope === "group" ? "getGroupStorage" : "getDataStorage"}("${args.name}").set("${args.key}", …) 已生效` };
      }
      case "storage.get": {
        const raw = localStorage.getItem(dataStorageKey("storage", args.scope, args.name, args.key, E.worldId));
        return { ok: true, obs: raw == null ? "（这个键还没有值）" : clip(raw, 1200) };
      }
      case "storage.list": {
        if (!args.name) return { ok: false, obs: "storage.list 要 args.name（存储名），例如 \"scores\"" };
        const pre = dataStoragePrefix("storage", args.scope, args.name, E.worldId);
        const ks = [];
        for (let i = 0; i < localStorage.length; i++) {
          const kk = localStorage.key(i);
          if (kk && kk.startsWith(pre)) ks.push(kk.slice(pre.length));
        }
        return { ok: true, obs: `存储「${args.name}」（${args.scope}）里有 ${ks.length} 个键：${ks.slice(0, 40).join("、")}` };
      }
      case "storage.remove": {
        const k = dataStorageKey("storage", args.scope, args.name, args.key, E.worldId);
        const had = localStorage.getItem(k) != null;
        localStorage.removeItem(k);
        // 官方对删不存在的键要求回"无需删除"，不能报成功（cli-commands.md:343）
        return { ok: had, obs: had ? `已删掉 ${args.name}.${args.key}` : "无需删除：这个键本来就不存在" };
      }
      case "blocks.edit": {
        const r = runSandboxCode(E, args.code);
        return r.ok ? { ok: true, obs: (r.out || "（无输出）") + ` · ${r.changes} 格变更` }
          : { ok: false, obs: `第 ${(r.line ?? 0) + 1} 行运行时报错：${r.error}` };
      }
      case "model.build": {
        const w = E.world;
        if (args.at.some((v, i) => v < 0 || v >= w.shape[i])) {
          return { ok: false, obs: `锚点 [${args.at}] 出了世界范围（尺寸 ${w.shape.join("×")}）。先 project.info 再换位置。` };
        }
        const r = stampProgram(E, args.program, args.at);
        return r.ok ? { ok: true, obs: `盖了 ${r.placed.toLocaleString()} 格${r.dropped ? `，丢弃 ${r.dropped} 个越界或超配额图元` : ""}` +
          `${r.unpicked ? `，另有 ${r.unpicked} 格落在世界外或映不到方块被跳过` : ""}` }
          : { ok: false, obs: r.error };
      }
      case "entity.add": {
        const w = E.world;
        if (args.at.some((v, i) => v < 0 || v >= w.shape[i])) return { ok: false, obs: `锚点 [${args.at}] 出了世界范围` };
        // 字段名按 addEntityMarker 的契约来：它读 d.id / d.tags / d.bounds / d.pos，
        // 少传 bounds 会当场 TypeError（第一版就是这么挂的）。
        addEntityMarker({ id: args.name, tags: args.label ? [args.label] : [], bounds: args.bounds, pos: args.at, collides: args.collides });
        E.markDirty?.();
        return { ok: true, obs: `已放实体触发盒 ${args.name}（尺寸 ±${args.bounds.join("/")}）在 [${args.at}]` +
          `${args.label ? "，标签 ." + args.label : ""}，脚本里可以用 #${args.name}${args.label ? " 或 ." + args.label : ""} 取到` };
      }
      case "build.check": {
        const rows = await checkAllScripts(E, spec);
        return { ok: !/语法错误|未实现成员/.test(rows), obs: rows };
      }
      case "runtime.start": {
        // 读 __errLog 而不是 __errs：后者会被运行控制台 shift 掉，
        // 用它判断"有没有报错"等于永远判没问题。见 gapi.js 的 noteError。
        const log = window.__errLog || (window.__errLog = []);
        const mark = log.length;
        E.enterPlay?.();
        await new Promise((r) => setTimeout(r, Math.min(9000, args.ticks * 64 + 900)));
        const tick = window.__game && window.__game.currentTick;
        const errs = log.slice(mark);
        return { ok: errs.length === 0, obs: errs.length
          ? `跑了 ${args.ticks} ticks，抓到 ${errs.length} 个运行时异常：\n` + errs.slice(0, 6).map((e) => String(e)).join("\n") +
            "\n（运行模式还开着，改完可以 runtime.logs 再看一眼，或直接 runtime.stop）"
          : `跑了 ${args.ticks} ticks（引擎走到第 ${tick} tick），没有运行时异常` };
      }
      case "runtime.status": {
        const g = window.__game;
        return { ok: true, obs: g && g.running ? `运行中，第 ${g.currentTick} tick，${(g.players && g.players.size) || 0} 个玩家` : "当前不在运行模式" };
      }
      case "runtime.logs": {
        const log = window.__errLog || [];
        const tail = log.slice(-30);
        if (!tail.length) return { ok: true, obs: "日志为空" };
        return { ok: args.level === "error" ? !/error|错误|异常/i.test(tail.join(" ")) : true, obs: tail.join("\n") };
      }
      case "runtime.stop": {
        if (!(window.__game && window.__game.running)) return { ok: true, obs: "本来就不在运行模式" };
        E.stopPlay?.();
        return { ok: true, obs: "已退出运行模式，回到编辑" };
      }
      case "scene.capture": {
        const g = worldDigest(E);
        const shot = await grabView(E);
        if (shot) onShot && onShot(shot);
        return { ok: true, obs: `视口${shot ? "已截图显示在小窗里" : "截图失败（WebGL 上下文没开 preserveDrawingBuffer）"}` +
          ` · 现在世界里 ${g.blocks.toLocaleString()} 格方块、${g.models} 个模型/实体` };
      }
      case "package.export": {
        const r = await exportProjectZip({ world: E.world, state: E.state, name: E.state.meta?.name || "AI 作品", download: true });
        return { ok: true, obs: `已导出项目包 ${r.entries || "?"} 个文件 · ${((r.bytes || 0) / 1048576).toFixed(1)} MB` };
      }
      default:
        return { ok: false, obs: `没有实现的动作：${action}` };
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    return { ok: false, obs: "执行这个动作时本地报错了：" + String(e && e.message || e) };
  }
}

/** 抓一张当前视口。失败就返回 null——截不到图不该让整轮动作失败。 */
async function grabView(E) {
  try {
    const c = E.renderer && E.renderer.renderer && E.renderer.renderer.domElement;
    if (!c) return null;
    E.renderer.render ? E.renderer.render() : null;
    return c.toDataURL("image/jpeg", 0.6);
  } catch { return null; }
}

const AGENT_RULES = `
【你现在是自主执行的 Agent，不是问答助手】
一次回答**只能有一个动作**，格式是整段回答里就一个 JSON 对象：
{"thought":"一句话说明你这次要干什么、为什么","action":"动作名","args":{...}}
不要输出 markdown 围栏，不要在 JSON 前后加解释话——那些会让这一轮白跑。

工作方式（照着做，不要跳）：
1. 第一步永远是 project.info，看清尺寸和现有内容。不知道世界有多大就盖东西，一定会越界。
2. 一次只推进一小步，然后**读观察结果**。观察结果是这一轮唯一的事实来源，
   不要假设某一步成功了——它可能返回"失败：…"。
3. 造形状有两条路，选对省事的那条：
   - 地形、墙体、大体积用 blocks.edit（sb.box / sb.sphere，直接写进体素世界，坐标是世界格）。
   - 需要精细上色的独立物件用 model.build（图元程序，坐标是部件内相对坐标）。
4. 写地图脚本一律 script.upload，并且**必须显式给 side**（server 或 client）。
   本实现按文件名判端，工具会自动把 client 端的名字改成带 Client 的写法；
   不要指望"先写进去再说"。
5. 写完脚本必须 build.check（发布前那道静态闸门：语法 + 有没有用到本实现没提供的成员）；
   要行为证据就 runtime.start，然后 runtime.logs 看有没有异常，最后 runtime.stop 收干净。
   抓到异常时把它当本轮观察去改脚本，而不是当本轮失败就 finish。
6. 做了能交付的一批改动就 map.save 一次；别攒到最后，中间断了用户什么也拿不到。
7. 同一个动作连续失败两次就换思路（换位置、换更小尺寸、换更简单写法），不要重复撞墙。
8. 做完就 finish，小结里写清「做了什么 / 用什么触发 / 还有什么没做」。
   做不完也 finish——宁可交一个带说明的半成品，也不要默默耗光步数预算。

硬约束：
- 世界坐标必须是整数格；sb 沙箱只有 sb / Math / console 三个全局，官方 API 一个都没有。
- 地图脚本（index.js 等）只能 writeScript 写进去由引擎运行，不能在本轮执行里调 world.*。
- 不要试图读或写文件、网络、localStorage——这些工具不存在。
`;

/* 小窗要能挪开，否则挡住视口就成了新 bug。只拖标题栏。 */
function dragHeader(d) {
  const h = d.querySelector("header");
  let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
  h.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    on = true; h.setPointerCapture(e.pointerId);
    const r = d.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    d.style.right = "auto";
  });
  h.addEventListener("pointermove", (e) => {
    if (!on) return;
    d.style.left = Math.max(4, Math.min(innerWidth - 60, ox + e.clientX - sx)) + "px";
    d.style.top = Math.max(4, Math.min(innerHeight - 40, oy + e.clientY - sy)) + "px";
  });
  const up = () => { on = false; };
  h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
}
