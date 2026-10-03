// ai-agent.js — 「AI Agent」全自动小窗：给一个目标，它自己写脚本、自己盖模型、
// 自己跑一遍看报不报错，报错就改，直到收工。没有步数上限。
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
//  1. **不设步数上限**，但会认"卡住"：同一动作连续失败 4 次、或连续 12 步
//     没有任何成功改动，就停下来等人。这不是保守，是因为那种情况下继续跑
//     只会一直花用户的 API 额度而不会再产出任何东西。
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
import { renderMd, mdEl, MD_CSS } from "./md.js";

/**
 * 算"有进展"的动作：真的动了世界、脚本或存盘。
 * 只读类（project.info / script.get / runtime.logs）不算——否则一个
 * 反复 inspect 却什么都不改的循环会被当成有进展，永远停不下来。
 */
const PROGRESS_ACTIONS = new Set(["blocks.edit", "model.build", "entity.add", "ui.add",
  "zone.add", "settings.set", "script.upload", "script.rename", "storage.set",
  "storage.remove", "map.save", "project.export", "project.create"]);

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

  { name: "ui.add", desc: "往屏幕上加一个 HUD 部件（计分板、提示条、按钮）。坐标是视口百分比。",
    args: { type: "text | button | image", text: "显示文字（button 时是按钮标题）",
      x: "左边 % 0..100", y: "上边 % 0..100", w: "宽 %", h: "高 %",
      size: "可选字号 px，默认 14", color: "可选 CSS 颜色，默认 #fff", bg: "可选背景 CSS 颜色",
      id: "可选部件 id；不填自动生成，填了脚本才能稳定找到它" } },
  { name: "zone.add", desc: "加一个区域触发器（脚本用 world.onZoneEnter / onZoneLeave 响应）。",
    args: { name: "区域名，如 森林", min: "[x,y,z] 角点", max: "[x,y,z] 对角点",
      selector: "可选实体选择器，默认 player", label: "可选标签" } },
  { name: "settings.set", desc: "改地图级设置：游戏规则（重生、PVP、计时）或世界物理（重力、速度阻尼、雾…）。",
    args: { gameRules: "可选对象，写进 meta.gameRules", worldSettings: "可选对象，写进 meta.worldSettings" } },
  { name: "project.export", desc: "把整个工程导出成官方同构的项目包 .zip —— 这就是交付物。",
    args: { name: "可选导出名" } },
  { name: "plan.set", desc: "登记或更新你的计划清单（会显示在小窗顶部）。开工前先发一次；每完成一项就再发一次把状态改成 done。",
    args: { items: `[{text, status}]，status 只能是 todo / doing / done / skip，最多 12 项` } },
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
  checkScripts: "build.check", validate: "build.check", playtest: "runtime.start", "package.export": "project.export",
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
  } else if (action === "ui.add") {
    const type = String(raw.type || "text").trim().toLowerCase();
    if (!["text", "button", "image"].includes(type)) {
      return { ok: false, error: `ui.add 的 type 只能是 text / button / image，收到 "${raw.type}"` };
    }
    const pct = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
    args.type = type;
    args.text = String(raw.text ?? raw.value ?? "").slice(0, 200);
    if (type === "image") args.image = String(raw.image || raw.src || "").trim().slice(0, 200);
    args.x = pct(raw.x, 2); args.y = pct(raw.y, 2);
    args.w = Math.max(1, pct(raw.w, 24)); args.h = Math.max(1, pct(raw.h, 8));
    args.size = Math.max(6, Math.min(96, Math.round(Number(raw.size) || 14)));
    args.color = String(raw.color || "#fff").trim().slice(0, 24);
    args.bg = String(raw.bg || "").trim().slice(0, 24);
    args.id = String(raw.id || "").trim().slice(0, 48);
  } else if (action === "zone.add") {
    const min = Array.isArray(raw.min) ? raw.min.map((v) => Math.round(Number(v) || 0)) : null;
    const max = Array.isArray(raw.max) ? raw.max.map((v) => Math.round(Number(v) || 0)) : null;
    if (!min || !max || min.length !== 3 || max.length !== 3) {
      return { ok: false, error: "zone.add 需要 args.min 与 args.max，各是 [x,y,z] 三个整数" };
    }
    if (min.some((v, i) => v > max[i])) return { ok: false, error: `zone.add 的 min [${min}] 每一维都该 ≤ max [${max}]` };
    args.name = String(raw.name || "").trim().slice(0, 64) || `区域-${(E0zones() + 1)}`;
    args.min = min; args.max = max;
    args.selector = String(raw.selector || "player").trim().slice(0, 64);
    args.label = String(raw.label || "").trim().slice(0, 64);
  } else if (action === "settings.set") {
    const gr = raw.gameRules, ws = raw.worldSettings;
    const plainObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    if (!plainObj(gr) && !plainObj(ws)) {
      return { ok: false, error: "settings.set 至少要给 args.gameRules 或 args.worldSettings 其中一个对象" };
    }
    if (plainObj(gr)) args.gameRules = JSON.parse(JSON.stringify(gr));
    if (plainObj(ws)) args.worldSettings = JSON.parse(JSON.stringify(ws));
  } else if (action === "project.export") {
    args.name = String(raw.name || "").trim().slice(0, 64);
  } else if (action === "plan.set") {
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (!rawItems.length) return { ok: false, error: 'plan.set 需要 args.items，形如 [{"text":"造地基","status":"todo"}]（status：todo/doing/done/skip）' };
    const allowed = new Set(["todo", "doing", "done", "skip"]);
    const items = [];
    for (const it of rawItems.slice(0, 12)) {
      const text = String((it && it.text) || "").trim().slice(0, 90);
      if (!text) continue;
      let st = String((it && it.status) || "todo").trim().toLowerCase();
      if (!allowed.has(st)) st = "todo";
      items.push({ text, status: st });
    }
    if (!items.length) return { ok: false, error: "plan.set 的 items 里没有一项带 text" };
    args.items = items;
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
    // 严格度面板勾了什么就真的查什么。这些结果同时喂回模型，
    // 所以面板不是装饰：关掉一条，模型就少收到一类反馈。
    const findings = lintScript(code, scriptChecks(E));
    const lint = findings.length ? " · 检查器 " + findings.map((f) => `${f.line}行 ${f.rule}`).slice(0, 6).join("、") : "";
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
    rows.push(`${s.name}: ${syn.ok ? "语法通过" : "语法错误 " + syn.error}${lint}${bad.length ? " · 用到未实现成员 " + bad.join(",") : ""}`);
    for (const f of findings) rows.push(`  ${f.line} 行 · ${f.rule}：${f.msg}`);
  }
  return rows.length ? rows.join("\n") : "（这张地图没有脚本）";
}

/* ---------------- Agent 主循环 ---------------- */

// 每条声明必须以 ; 或 } 结尾。上一版这里少了 z-index 后面的分号，CSS 解析器
// 会把 "9100 background:#12161d" 当成一个非法值整条丢掉——小窗于是 z-index:auto，
// 被 z-index:90 的脚本界面盖住：界面看着正常，但底部按钮全部点不到。
//
// 版式照 Claude Code：一条动作两行，⏺ 工具(参数) 在上、⎿ 结果在下，
// 参数与长结果折叠可展开，右侧挂耗时与状态。为什么要做成"看得见在调什么工具"：
// 全自动循环最怕的就是黑箱——十几步跑完，用户不知道它到底写没写过文件、
// 有没有真的跑过测试，只能选择信或不信。每一行都能展开看到原始参数和原始输出，
// 才是可以被检查的自动化。
const CSS = `
#aiAgent{position:fixed;right:18px;top:88px;width:430px;max-width:94vw;height:min(660px,82vh);z-index:9100;
  background:#12161d;border:1px solid #2a3444;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.55);
  display:flex;flex-direction:column;color:#dfe6f0;font-size:12.5px}
#aiAgent header{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #232c3a;cursor:move;user-select:none}
#aiAgent header b{font-size:13.5px}
#aiAgent .ag-hd{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11px;color:#8b98ab;font-variant-numeric:tabular-nums}
#aiAgent .ai-x{background:none;border:none;color:#8b98ab;font-size:17px;cursor:pointer;padding:0 4px}
#aiAgent .ag-body{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:9px}
#aiAgent .ag-goal{display:flex;flex-direction:column;gap:5px}
#aiAgent textarea{background:#0d1117;border:1px solid #2a3444;border-radius:6px;color:#e6edf6;padding:7px 9px;
  font-size:12.5px;font-family:inherit;min-height:52px;resize:vertical;line-height:1.6}
#aiAgent .ag-plan{border:1px solid #232c3a;border-radius:8px;padding:8px 10px;background:#0f141b}
#aiAgent .ag-plan h4{margin:0 0 6px;font-size:11px;color:#8b98ab;font-weight:600;letter-spacing:.4px}
#aiAgent .ag-plan ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
#aiAgent .ag-plan li{display:flex;gap:6px;align-items:baseline;color:#a9b6c8;font-size:12px;line-height:1.45}
#aiAgent .ag-plan li.done{color:#6fd08c}#aiAgent .ag-plan li.doing{color:#ffc46b}#aiAgent .ag-plan li.skip{color:#5d6b7f;text-decoration:line-through}
#aiAgent .ag-row{display:grid;grid-template-columns:14px 1fr;column-gap:6px}
#aiAgent .ag-bul{color:#22c8dd;line-height:1.5;font-weight:700}
#aiAgent .ag-run .ag-bul::after{content:"◐";animation:agSpin 1s linear infinite;display:inline-block}
@keyframes agSpin{to{transform:rotate(360deg)}}
#aiAgent .ag-tool{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#e6edf6;line-height:1.5;word-break:break-word}
#aiAgent .ag-tool .nm{color:#ffc46b;font-weight:600}
#aiAgent .ag-tool .ar{color:#8fa3bd}
#aiAgent .ag-meta{margin-left:6px;font-size:10.5px;color:#5d6b7f;font-variant-numeric:tabular-nums}
#aiAgent .ag-meta.bad{color:#ff8f8f}#aiAgent .ag-meta.ok{color:#6fd08c}
#aiAgent .ag-res{color:#9fb0c6;white-space:pre-wrap;word-break:break-word;line-height:1.55;font-size:12px}
#aiAgent .ag-res::before{content:"⎿ ";color:#4a5c78}
#aiAgent .ag-res.bad{color:#f0a5ad}
#aiAgent .ag-think{color:#7f8ea3;font-style:italic;font-size:12px;line-height:1.5}
#aiAgent details{margin:0}
#aiAgent summary{cursor:pointer;color:#5d6b7f;font-size:11px;list-style:none;user-select:none}
#aiAgent summary::-webkit-details-marker{display:none}
#aiAgent summary::before{content:"▸ "}
#aiAgent details[open] summary::before{content:"▾ "}
#aiAgent details summary:hover{color:#9fb0c6}
#aiAgent pre.ag-code{margin:3px 0 0;background:#0b0f15;border:1px solid #1e2733;border-radius:6px;padding:6px 8px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;max-height:230px;overflow:auto;
  white-space:pre;color:#c8d4e4}
#aiAgent .dl{display:block}#aiAgent .dl.add{color:#6fd08c}#aiAgent .dl.del{color:#e0596a}#aiAgent .dl.ctx{color:#5d6b7f}
#aiAgent .ag-acts{display:flex;gap:7px;padding:9px 12px;border-top:1px solid #232c3a;flex-wrap:wrap;align-items:center}
#aiAgent .ag-acts button{background:#222c3a;border:1px solid #33415a;color:#dfe6f0;border-radius:6px;padding:6px 11px;cursor:pointer;font-size:12.5px}
#aiAgent .ag-acts button.primary{background:#22c8dd;border-color:#22c8dd;color:#14100a;font-weight:600}
#aiAgent .ag-acts button:disabled{opacity:.45;cursor:default}
#aiAgent .ag-budget{margin-left:auto;color:#8b98ab;font-size:11.5px;font-variant-numeric:tabular-nums}
#aiAgent .ag-budget.ok{color:#6fd08c}#aiAgent .ag-budget.err{color:#ff8f8f}
`;

let _node = null;

export function closeAgent() { _node?.remove(); _node = null; }
export function agentOpen() { return !!_node; }

export function openAgent(E) {
  closeAgent();
  if (!document.getElementById("aiAgentStyle")) {
    const s = document.createElement("style"); s.id = "aiAgentStyle";
    s.textContent = CSS + "\n" + MD_CSS + "\n#aiAgent .ag-md{color:#c3cfdf}\n#aiAgent .md-p:first-child{margin-top:0}";
    document.head.appendChild(s);
  }
  const d = document.createElement("div");
  d.id = "aiAgent";
  d.innerHTML = `
    <header><b>AI Agent</b><span class="ag-hd"><span data-k="tok"></span><span data-k="clock"></span></span><button class="ai-x" title="收起">×</button></header>
    <div class="ag-body" data-k="body"></div>
    <div class="ag-acts">
      <button data-k="run" class="primary">开始</button>
      <button data-k="stop" disabled>中止</button>
      <button data-k="cfg">接口设置</button>
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
    </div>
    <div class="ag-plan" data-k="plan" hidden><h4>计划</h4><ol></ol></div>`;
  const goal = body.querySelector('[data-k="goal"]');
  const stepsHost = document.createElement("div");
  stepsHost.style.cssText = "display:flex;flex-direction:column;gap:9px";
  body.appendChild(stepsHost);
  const planBox = body.querySelector('[data-k="plan"]');
  const planList = planBox.querySelector("ol");

  dragHeader(d);
  d.querySelector(".ai-x").onclick = closeAgent;
  q("cfg").onclick = () => openSettings(() => stat(aiReady() ? "接口已配置" : "还没填完"));

  let busy = null;
  const stat = (m, cls) => { const n = q("stat"); n.textContent = m; n.className = "ag-budget" + (cls ? " " + cls : ""); };
  const el2 = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };
  /**
   * 一行工具调用：⏺ name(k="v", …) [+ 耗时/状态]，下面 ⎿ 结果，再下面可展开原始参数。
   * 全部用 createElement + textContent 拼：模型返回的文本里出现 <b> 或 " 都不该变成标记。
   */
  const toolRow = (name, argSummary, thought) => {
    const row = el2("div", "ag-row ag-run");
    row.appendChild(el2("div", "ag-bul"));
    const main = el2("div");
    const head = el2("div", "ag-tool");
    head.appendChild(el2("span", "nm", name));
    if (argSummary) head.appendChild(el2("span", "ar", "(" + argSummary + ")"));
    const meta = el2("span", "ag-meta", "运行中");
    head.appendChild(meta);
    main.appendChild(head);
    if (thought) {
      // 想法按 markdown 渲染：模型在这里最爱写 **强调** 和 `标识符`，
      // 原样显示出来就是一排星号，读起来像日志而不像解释。
      const t = el2("div", "ag-think md");
      t.appendChild(renderMd(thought));
      main.appendChild(t);
    }
    row.appendChild(main);
    stepsHost.appendChild(row);
    scroll();
    return {
      row,
      finish: (text, ok, extra, opt) => {
        row.classList.remove("ag-run");
        meta.textContent = extra || "";
        meta.className = "ag-meta " + (ok ? "ok" : "bad");
        if (text) {
          if (opt && opt.md) {
            // 收工小结是给人读的一段话，不是一行工具返回值：整段按 markdown 排，
            // 交付核对的 "- " 也才会真的变成条目而不是两个字符。
            main.appendChild(el2("div", "ag-md md"));
            main.lastChild.appendChild(renderMd(text));
          } else if (opt && opt.block) {
            main.appendChild(el2("pre", "ag-code", text));
          } else {
            const res = el2("div", "ag-res" + (ok ? "" : " bad"));
            const oneLine = String(text).replace(/\s*\n\s*/g, " ⏎ ");
            if (oneLine.length > 220) {
              res.textContent = oneLine.slice(0, 220) + " …";
              const det = document.createElement("details");
              det.appendChild(el2("summary", null, "展开完整输出（" + String(text).split("\n").length + " 行 / " + String(text).length + " 字）"));
              det.appendChild(el2("pre", "ag-code", text));
              main.appendChild(det);
            } else {
              res.textContent = oneLine;
              main.appendChild(res);
            }
          }
        }
        scroll();
      },
      args: (obj) => {
        const det = document.createElement("details");
        det.appendChild(el2("summary", null, "参数"));
        det.appendChild(el2("pre", "ag-code", JSON.stringify(obj, null, 1)));
        main.appendChild(det);
      },
      diff: (htmlRows) => {
        const det = document.createElement("details");
        det.appendChild(el2("summary", null, "代码改动"));
        const pre = el2("pre", "ag-code");
        for (const [cls, txt] of htmlRows) pre.appendChild(el2("span", "dl " + cls, txt));
        det.appendChild(pre);
        main.appendChild(det);
      },
    };
  };
  const plain = (text, cls) => {
    const row = el2("div", "ag-row");
    row.appendChild(el2("div", "ag-bul", cls === "err" ? "✗" : "•"));
    row.appendChild(el2("div", "ag-res" + (cls === "err" ? " bad" : ""), text));
    stepsHost.appendChild(row);
    scroll();
  };
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  const setPlan = (items) => {
    planBox.hidden = false;
    planList.replaceChildren();
    for (const it of items) {
      const st = it.status === "done" ? "done" : it.status === "skip" ? "skip" : it.status === "doing" ? "doing" : "";
      const li = el2("li", st, it.text);
      li.prepend(el2("span", null, it.status === "done" ? "☑" : it.status === "doing" ? "▶" : it.status === "skip" ? "✕" : "☐"));
      planList.appendChild(li);
    }
    scroll();
  };

  /** 一行参数摘要：k="v" 逗号拼接，长的截断。真实参数在可展开的「参数」里。 */
  const summarize = (action, args) => {
    if (action === "script.upload") return `${args.entry}, side="${args.side}", ${args.code.split("\n").length} 行`;
    if (action === "model.build") return `at=[${args.at}], ${args.program && args.program.name || "未命名"}`;
    if (action === "blocks.edit") return JSON.stringify((args.code || "").replace(/\s+/g, " ").slice(0, 60)) + (((args.code || "").length > 60) ? "…" : "");
    if (action === "runtime.start") return `ticks=${args.ticks}`;
    if (action === "ui.add") return `type="${args.type}", ${args.x}%,${args.y}% ${args.w}%x${args.h}%`;
    if (action === "zone.add") return `name=${JSON.stringify(args.name)}, [${args.min}]→[${args.max}]`;
    if (action === "settings.set") return [args.gameRules && "gameRules{" + Object.keys(args.gameRules) + "}",
      args.worldSettings && "worldSettings{" + Object.keys(args.worldSettings) + "}"].filter(Boolean).join(", ");
    if (action === "project.export") return args.name ? `name=${JSON.stringify(args.name)}` : "";
    if (action === "project.create") return `name=${JSON.stringify(args.name)}, size=[${args.size}]${args.terrain ? ", terrain=" + args.terrain : ""}`;
    if (action === "storage.set") return `name=${JSON.stringify(args.name)}, key=${JSON.stringify(args.key)}, scope=${args.scope}`;
    if (action === "storage.get" || action === "storage.remove") return `name=${JSON.stringify(args.name)}, key=${JSON.stringify(args.key)}`;
    if (action === "script.get") return `entry=${JSON.stringify(args.entry)}`;
    const kv = Object.entries(args).filter(([k]) => k !== "code" && k !== "program")
      .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.slice(0, 40)) : JSON.stringify(v)}`);
    return kv.join(", ").slice(0, 120);
  };

  /** 脚本改动的行级 diff。不引库：脚本都是几十到几百行，集合式 LCS 够用。 */
  const codeDiff = (before, after) => {
    const a = String(before || "").split("\n"), b = String(after || "").split("\n");
    const m = a.length, n = b.length;
    if (m * n > 400000) {
      return [["ctx", `（改动较大：${m} 行 → ${n} 行，未逐行比对）`]];
    }
    const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { out.push(["ctx", "  " + a[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(["del", "- " + a[i]]); i++; }
      else { out.push(["add", "+ " + b[j]]); j++; }
    }
    while (i < m) out.push(["del", "- " + a[i++]]);
    while (j < n) out.push(["add", "+ " + b[j++]]);
    return out;
  };

  q("run").onclick = async () => {
    const want = goal.value.trim();
    if (!want) return stat("先写目标", "err");
    if (!aiReady()) { openSettings(); return; }
    stepsHost.replaceChildren();
    planBox.hidden = true;
    goal.disabled = true; q("run").disabled = true; q("stop").disabled = false;
    const ctrl = new AbortController();
    busy = ctrl;
    // 没有步数上限：跑多少步由目标决定，不由我们猜。
    // 唯一保留的停止条件是"卡住"——见下面 stuck 的注释。
    let stuckKey = "", stuckCount = 0, sinceProgress = 0;
    const t0 = Date.now();
    let used = 0, calls = 0;
    // 终态要分得清"完成 / 预算用尽 / 中断"。原先 finally 里无条件把 stat 覆盖成
    // "N tokens · M 次调用"，于是"完成 · 16 步"刚写出来就被冲掉：
    // 明明跑成功了，界面却看不出来，人也分不清、测试也只能等到超时。
    let outcome = "";
    // 每个动作计数：收工时的交付清单要用它判断"到底动过没有"
    const touched = {};
    const tick = setInterval(() => {
      q("clock").textContent = ((Date.now() - t0) / 1000).toFixed(1) + "s";
      q("tok").textContent = used ? used.toLocaleString() + " tok" + (calls ? " · " + calls + " 次调用" : "") : "";
    }, 200);
    // 声明在 for 外面：循环结束后靠"obs 是不是 null"区分正常 finish 与预算用尽。
    // 它曾待在 for 里面，于是 finish 分支跑完、跳出循环去读它时直接
    // ReferenceError——前 16 步的活全干完了，小窗却报"中断"。
    let obs;
    try {
      const digest = await apiDigest(E.atlas, "server");
      const spec = digest.spec || null;
      const sys = await specPrompt("server", digest) + "\n\n" + AGENT_RULES + "\n\n【可用动作】\n" + toolBrief();
      const msgs = [{ role: "system", content: sys }, { role: "user", content: "目标：" + want }];
      for (let step = 1; ; step++) {
        if (ctrl.signal.aborted) throw new Error("已中止");
        stat(`第 ${step} 步`);
        const r = await chat(msgs, { signal: ctrl.signal, json: true, timeout: 150000, maxTokens: 4096 });
        calls++; used += (r.usage && r.usage.total_tokens) || 0;
        let parsed;
        try {
          parsed = parseAction(r.text);
        } catch (e) {
          plain(`第 ${step} 步 · 没能按格式回答：${e.message}。已要求它按 {"thought","action","args"} 重发。`, "err");
          obs = "你的上一次回答没能解析成一个动作 JSON。严格按这个格式重发，整段回答里只放一个 JSON 对象：" +
            `{"thought":"一句想法","action":"${TOOL_NAMES[0]}","args":{}}`;
          msgs.push({ role: "assistant", content: clip(r.text, 2000) });
          msgs.push({ role: "user", content: obs });
          continue;
        }
        const checked = sanitizeAction(parsed);
        if (!checked.ok) {
          const bad = toolRow(String(parsed.action || "?") + " — 动作不合法", "", parsed.thought);
          bad.finish(checked.error, false);
          msgs.push({ role: "assistant", content: JSON.stringify({ thought: parsed.thought, action: parsed.action, args: parsed.args }).slice(0, 4000) });
          msgs.push({ role: "user", content: "这一步没有执行。原因：" + checked.error });
          const k1 = "invalid:" + checked.error;
          stuckCount = k1 === stuckKey ? stuckCount + 1 : 1; stuckKey = k1; sinceProgress++;
          if (stuckCount >= 4) { outcome = "卡住"; plain(`同一个非法动作连续 ${stuckCount} 次，停下等你。它没能理解可用动作清单，继续跑只会白烧你的 token。`, "err"); break; }
          continue;
        }
        const { action, args } = checked;
        touched[action] = (touched[action] || 0) + 1;
        const ts = Date.now();
        // 写脚本之前先把旧内容取出来：跑完才能给出 diff，而不是只说"已写入"。
        const before = action === "script.upload"
          ? ((E.state.scripts || []).find((s) => s.name === args.entry) || {}).code : null;
        const row = toolRow(action, summarize(action, args), parsed.thought);
        row.args(args);
        msgs.push({ role: "assistant", content: JSON.stringify({ thought: parsed.thought, action, args }).slice(0, 6000) });
        if (action === "finish") {
          // 交付清单由**程序自己核对**，不是照抄模型写的小结。
          // 全自动最容易骗人的就在这：模型说"已完成赛道与计分板"，
          // 实际可能一个方块没盖、一次都没存盘。所以这里独立量一遍再附在小结后面。
          const report = deliveryReport(E, touched);
          outcome = `完成 · ${step} 步`;
          row.finish(`${args.summary || ""}\n\n## 交付核对\n\n${report.lines.map((l) => "- " + l).join("\n")}`,
            report.ok, `${((Date.now() - ts) / 1000).toFixed(1)}s`, { md: true });
          stat(report.ok ? "完成，交付物齐" : "完成，但有缺口", report.ok ? "ok" : "err");
          obs = null;
          break;
        }
        let res;
        try {
          res = await execTool(E, action, args, spec, (dataUrl) => {
            const img = document.createElement("img");
            img.src = dataUrl; img.alt = "当前视口";
            img.style.cssText = "max-width:100%;border-radius:6px;border:1px solid #2a3444;margin-top:4px";
            row.row.lastChild.appendChild(img);
          }, setPlan);
        } catch (e) {
          if (e && e.name === "AbortError") throw e;
          res = { ok: false, obs: "执行时本地抛错：" + String(e && e.message || e) };
        }
        obs = res.ok ? res.obs : "失败：" + res.obs;
        row.finish(obs, res.ok, ((Date.now() - ts) / 1000).toFixed(1) + "s");
        // 「卡住」不等于「步数多」：只认两种客观情况——
        //   a) 同一个动作带同样的参数连续失败 4 次（模型在撞墙）
        //   b) 连续 12 步没有任何一步成功改动世界/脚本（没有进展）
        // 这是唯一保留的自动停止条件，因为这两种情况下继续跑只会一直花你的
        // API 额度而不会再产出。步数本身不设限。
        if (res.ok && PROGRESS_ACTIONS.has(action)) { stuckCount = 0; stuckKey = ""; sinceProgress = 0; }
        else {
          sinceProgress++;
          const k2 = action + "|" + JSON.stringify(args).slice(0, 400);
          if (!res.ok) { stuckCount = k2 === stuckKey ? stuckCount + 1 : 1; stuckKey = k2; }
          if (stuckCount >= 4) { outcome = "卡住"; plain(`同一个动作连续失败 ${stuckCount} 次，停下等你。界面里能看到它每次收到的原始报错。`, "err"); break; }
          if (sinceProgress >= 12) { outcome = "无进展"; plain(`连续 12 步没有任何成功改动，停下等你。它在原地打转。`, "err"); break; }
        }
        if (action === "script.upload" && res.ok) row.diff(codeDiff(before, args.code));
        msgs.push({ role: "user", content: "观察：" + clip(obs) });
      }

    } catch (e) {
      if (e && e.name === "AbortError") outcome = "已中止";
      else { plain("中断：" + String((e && (e.message || e)) || ""), "err"); outcome = "中断"; }
    } finally {
      clearInterval(tick);
      goal.disabled = false; q("run").disabled = false; q("stop").disabled = true; busy = null;
      stat(`${outcome || "已停止"} · ${calls} 次调用 · ${((Date.now() - t0) / 1000).toFixed(1)}s`
        + (used ? ` · ${used.toLocaleString()} tokens` : ""),
        outcome.startsWith("完成") ? "ok" : "err");
    }
  };
  q("stop").onclick = () => { busy?.abort(); stat("正在中止…"); };
  if (!aiReady()) stat("先点「接口设置」填完地址、模型与密钥");
  setTimeout(() => goal.focus(), 60);
}

/** sanitizeAction 是纯函数（离线可测），拿不到编辑器实例，所以区域默认名只报序号兜底。 */
function E0zones() { return 0; }

/** 官方 storage 有 --scope project|group 两档；映射到我们的 map / group 作用域。 */
function storageScope(v) {
  const s = String(v || "project").trim().toLowerCase();
  if (s === "project" || s === "map") return { scope: "map" };
  if (s === "group") return { scope: "group" };
  return { err: `scope 只能是 project 或 group，收到 "${v}"。project=只这张图（官方 getDataStorage），group=主副图共用（官方 getGroupStorage）。` };
}

/** 执行一个已校验的动作，返回 {ok, obs}。obs 永远是一句能直接喂回模型的话。 */
async function execTool(E, action, args, spec, onShot, setPlan) {
  const scripts = () => E.state.scripts || (E.state.scripts = []);
  const findScript = (name) => scripts().find((s) => s.name === name);
  try {
    switch (action) {
      case "ui.add": {
        const ui = E.state.meta.ui || (E.state.meta.ui = []);
        const id = args.id || "w" + Date.now().toString(36);
        const hit = ui.find((w) => w.id === id);
        const rec = { id, type: args.type, text: args.text, x: args.x, y: args.y,
          w: args.w, h: args.h, size: args.size, color: args.color, bg: args.bg };
        if (args.type === "image") rec.image = args.image;
        if (hit) Object.assign(hit, rec); else ui.push(rec);
        E.markDirty?.();
        return { ok: true, obs: `已${hit ? "更新" : "加上"} HUD 部件 ${id}（${args.type} "${args.text || ""}" 在 ${args.x}%,${args.y}% · ${args.w}%×${args.h}%），共 ${ui.length} 个部件。进运行模式才看得见。` };
      }
      case "zone.add": {
        const w = E.world;
        if (args.min.some((v, i) => v < 0 || v >= w.shape[i]) || args.max.some((v, i) => v < 0 || v >= w.shape[i]))
          return { ok: false, obs: `区域角点出了世界范围（尺寸 ${w.shape.join("×")}）` };
        const zones = E.state.meta.zones || (E.state.meta.zones = []);
        const z = { id: "z" + Date.now().toString(36), name: args.name, selector: args.selector,
          bounds: { min: args.min, max: args.max }, force: [0, 0, 0], massScale: 1, enabled: true };
        if (args.label) z.labels = [args.label];
        zones.push(z);
        E.markDirty?.();
        return { ok: true, obs: `已加区域「${args.name}」[${args.min}]→[${args.max}]（选择器 ${args.selector}），共 ${zones.length} 个；脚本用 world.onZoneEnter / onZoneLeave 响应` };
      }
      case "settings.set": {
        const meta = E.state.meta;
        const keys = [];
        if (args.gameRules) { meta.gameRules = Object.assign({}, meta.gameRules, args.gameRules); keys.push("gameRules: " + Object.keys(args.gameRules).join("/")); }
        if (args.worldSettings) {
          meta.worldSettings = Object.assign({}, meta.worldSettings, args.worldSettings);
          keys.push("worldSettings: " + Object.keys(args.worldSettings).join("/"));
        }
        E.markDirty?.();
        return { ok: true, obs: `已改设置 ${keys.join(" · ")}；下一次进入运行模式时生效` };
      }
      case "project.export": {
        const r = await exportProjectZip({ world: E.world, state: E.state,
          name: args.name || E.state.meta?.name || "AI 作品", download: true });
        return { ok: true, obs: `已导出项目包：${r.entries || "?"} 个文件 · ${((r.bytes || 0) / 1048576).toFixed(2)} MB` };
      }
      case "plan.set": {
        setPlan && setPlan(args.items);
        const left = args.items.filter((i) => i.status !== "done" && i.status !== "skip").length;
        return { ok: true, obs: `计划已更新：${args.items.length} 项，还剩 ${left} 项未完成` };
      }
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
      default:
        return { ok: false, obs: `没有实现的动作：${action}` };
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    return { ok: false, obs: "执行这个动作时本地报错了：" + String(e && e.message || e) };
  }
}

/**
 * 收工时的独立核对。ok 表示"客观上像个完整交付"，lines 逐条摆事实。
 * 判据只用能量到的东西：方块数、区域数、HUD 数、脚本数、有没有存盘/导出。
 * 不评价"像不像个游戏"——那只有你玩过才知道。
 */
function deliveryReport(E, touched) {
  const meta = E.state.meta || {};
  const scripts = E.state.scripts || [];
  const blocks = E.world.size();
  const zones = (meta.zones || []).length;
  const hud = (meta.ui || []).length;
  const models = (E.state.models || []).length;
  const lines = [`方块 ${blocks.toLocaleString()} · 模型/实体 ${models} · 区域 ${zones} · HUD 部件 ${hud}`];
  lines.push(scripts.length
    ? "脚本 " + scripts.map((x) => `${x.name}(${(x.code || "").split("\n").length}行/${/client/i.test(x.name) ? "client" : "server"})`).join("、")
    : "脚本：无");
  lines.push(touched["project.export"] ? "已导出项目包 .zip（可转交的交付物）"
    : "未导出项目包 —— 还差 project.export 才有可转交的 .zip");
  const gaps = [];
  if (blocks === 0) gaps.push("世界是空的");
  if (!scripts.length) gaps.push("没有任何脚本，地图不会响应玩家");
  if (!touched["map.save"]) gaps.push("没有 map.save，关掉页面就全没了");
  if (!touched["build.check"]) gaps.push("没有 build.check，脚本没做过静态核对");
  if (!touched["runtime.start"]) gaps.push("没有 runtime.start，脚本没真跑过、行为未验证");
  if (gaps.length) lines.push("⚠ 缺口：" + gaps.join("；"));
  return { ok: gaps.length === 0, lines };
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
3. 动手前用 plan.set 发一份 3~8 项的计划清单，之后每完成一项就再发一次把该项改成 done、
   正在做的改成 doing。用户在界面顶部会看到这份清单实时打勾——这是"全自动"能不能被监督的关键。
4. 造形状有两条路，选对省事的那条：
   - 地形、墙体、大体积用 blocks.edit（sb.box / sb.sphere，直接写进体素世界，坐标是世界格）。
   - 需要精细上色的独立物件用 model.build（图元程序，坐标是部件内相对坐标）。
5. 写地图脚本一律 script.upload，并且**必须显式给 side**（server 或 client）。
   本实现按文件名判端，工具会自动把 client 端的名字改成带 Client 的写法；
   不要指望"先写进去再说"。
6. 写完脚本必须 build.check（发布前那道静态闸门：语法 + 有没有用到本实现没提供的成员）；
   要行为证据就 runtime.start，然后 runtime.logs 看有没有异常，最后 runtime.stop 收干净。
   抓到异常时把它当本轮观察去改脚本，而不是当本轮失败就 finish。
7. 做了能交付的一批改动就 map.save 一次；别攒到最后，中间断了用户什么也拿不到。
8. 同一个动作连续失败两次就换思路（换位置、换更小尺寸、换更简单写法），不要重复撞墙。
9. 做完就 finish，小结里写清「做了什么 / 用什么触发 / 还有什么没做」。
   做不完也要 finish，小结里写清卡在哪一步、需要什么信息才能继续。
   summary 会按 markdown 渲染（## 标题、- 列表、**粗体**、\`代码\`），所以请分点写，别堆成一段。
   没有步数上限：跑够为止。但连续撞同一个墙我们会停下来等你，不会闷烧你的额度。

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
