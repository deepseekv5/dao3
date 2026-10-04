// ai-script.js — 脚本界面的「AI 生成」抽屉：把需求写成一个能直接跑的地图脚本。
//
// 为什么值得单独一个文件：它要同时懂两件事——AI 调用（ai.js）和脚本面板的内部结构
// （state.scripts / __scriptIdx / renderScriptFiles）。塞进 features.js 会让那个文件
// 再胖一截，塞进 ai.js 又会让共享层依赖编辑器状态。
//
// 提示词里的 API 清单是**运行时从 public/data/*.json 现取的**，不是手抄的。
// 手抄一份必然在下一次 api-audit 之后过期，而过期的清单会让模型自信地调用
// 一个我们根本没实现的成员——那比模型不会写代码更难查。

import { chat, aiReady, openSettings, extractCode, configGaps, checkSyntax } from "./ai.js";
import { forbiddenMembers, specBrief, SANDBOX_BRIEF } from "./ai-spec.js";

let _spec = null;        // public/data/api-spec.json（生成物）
let _digest = {};        // 按端缓存的成品片段
let _blockNames = "";

/**
 * 这些类给**完整签名 + 官方中文说明**，其余只给成员名。
 * 依据是"脚本实际会碰到的东西"：全给说明约 90KB，每次请求都带上纯属烧上下文；
 * 全给名字又丢掉了单位与语义。核心清单以 side 划分，客户端脚本用的类差别很大。
 */
const CORE = {
  server: ["GameWorld", "GameEntity", "GamePlayer", "GamePlayerEntity", "GameVector3", "GameBounds3",
    "GameRGBColor", "GameRGBAColor", "GameQuaternion", "GameDataStorage", "GameGroupStorage",
    "GameQueryResult", "GameHttpFetchResponse", "GameGUI", "GameWidget",
    "GameButtonType", "GameDialogType", "GameCameraMode", "GameInputDirection", "GameEasing", "GameBodyPart", "GameAssetType"],
  client: ["GameWorld", "GameEntity", "Vec3", "Vec2", "Coord2", "UiBox", "UiText", "UiInput", "UiImage",
    "UiScrollBox", "UiScreen", "Audio", "Navigator", "EventEmitter", "GameRGBColor", "GameRGBAColor"],
};

async function loadSpec() {
  if (_spec) return _spec;
  try { _spec = await (await fetch("/data/api-spec.json")).json(); }
  catch { _spec = { classes: {} }; }
  return _spec;
}

/**
 * 组装提示词里的 API 面。未实现的成员**一律不写进可用清单**，
 * 而是另外列进"绝对不要用"的禁用段——告诉模型"可以用"结果跑不通，
 * 比不提更糟；而明确列出禁用的那几条，能挡住模型凭通用知识去猜它。
 */
export async function apiDigest(atlas, side = "server") {
  const spec = await loadSpec();
  if (atlas && atlas.ready && !_blockNames) {
    const byCat = new Map();
    for (const b of atlas.list()) {
      const arr = byCat.get(b.category) || [];
      if (arr.length < 6) arr.push(b.name);
      byCat.set(b.category, arr);
    }
    _blockNames = [...byCat.entries()].map(([c, ns]) => `${c}: ${ns.join(" ")}`).join("；");
  }
  const cacheKey = side + ":" + Object.keys(spec.classes).length;
  if (_digest[cacheKey]) return _digest[cacheKey];

  const core = new Set(CORE[side] || []);
  const full = [], brief = [];
  for (const [cls, d] of Object.entries(spec.classes)) {
    if (d.side !== (side === "client" ? "client" : "server") && d.side !== "both") continue;
    const names = Object.keys(d.m).filter((n) => d.m[n].i !== 0);   // 未实现的不进可用清单
    if (!names.length) continue;
    if (core.has(cls)) {
      full.push(`${cls} — ${d.d || ""}`.trim());
      for (const n of names) {
        const m = d.m[n];
        full.push(`  ${cls}.${n}${m.s && !m.s.startsWith(cls) ? "  ·  " + m.s : ""}${m.d ? "  —  " + m.d : ""}`);
      }
      full.push("");
    } else {
      brief.push(`${cls}: ${names.join(", ")}`);
    }
  }
  const out = {
    api: full.join("\n") + "\n【其余可用类型（只有成员名，签名请按常识与类型名推断）】\n" + brief.join("\n"),
    forbidden: forbiddenMembers(spec),
    names: _blockNames,
    counts: { fullClasses: core.size, classes: Object.keys(spec.classes).length },
    spec,                                  // Agent 的 checkScripts 要拿它判"未实现成员"
  };
  _digest[cacheKey] = out;
  return out;
}

/**
 * 系统提示的**规范部分**（不含输出格式要求）。
 * 单独拆出来是因为同一个 Agent 与单次生成要的是同一份开发规范，
 * 但产出契约完全不同：一个要 ```js 代码块，一个要动作 JSON。
 * 如果只有 buildSystemPrompt，Agent 就只能带着"输出恰好一个 js 代码块"
 * 这句话去跑——它会真的回一段代码而不是动作，整个循环卡在第一步。
 */
export async function specPrompt(side, digest) {
  const d = digest || await apiDigest(null, side);
  const head = `你在为「神奇代码岛 DAO3」的本地兼容实现写地图脚本。语言是浏览器里的 JavaScript（服务端脚本支持顶层 await）。
产出必须只跑在这套实现上：下面列出的全局、类型与成员就是全部可用面，没列出来的一律当作不存在。
`;
  return head + specBrief(side, d);
}

/**
 * 系统提示 = 开发规范（ai-spec.js，单一来源）+ 该端的输出契约。
 *
 * 沙箱那一路必须单独收尾：OUTPUT_RULES 讲的是 sleep / setInterval / entity /
 * remoteChannel 这些官方全局，而方块沙箱里只有 sb / Math / console 三个。
 * 之前把同一份契约拼给沙箱，等于一边在规范里写"这里没有 world"、
 * 一边又在同一条提示的最后告诉模型"要按 tick 就在 tick 回调里累加"——
 * 模型照做就生成出跑不通的代码。契约按端分开，才谈得上自洽。
 */
export async function buildSystemPrompt(side, digest) {
  const spec = await specPrompt(side, digest);
  return spec + "\n\n" + (side === "sandbox" ? SANDBOX_OUTPUT_RULES : OUTPUT_RULES);
}

const SANDBOX_OUTPUT_RULES = `【输出要求】
1. 只写方块沙箱脚本：全局仅有 sb、Math、console 三个，world / entity / player / storage / ui 全都不存在。
2. 计时不要写无限循环；要分批就用有限次数循环。
3. 输出恰好一个 \`\`\`js 代码块；块外最多两句中文，说明这段会造出什么。
4. 不要 import/require，不要访问 DOM，不要读 localStorage。
5. 坐标必须是整数格且落在世界尺寸内；先用 sb.size() 探边界再下笔。
6. 代码要能直接运行。`;

const OUTPUT_RULES = `【输出要求】
1. 先判断该写服务端、客户端还是方块沙箱；用户没说清就默认服务端，并在说明里点出这个选择。
2. 只用规范里列出的全局与成员。清单里没有的**不要用**，改成更简单的等价写法。
3. 输出恰好一个 \`\`\`js 代码块；块外最多两句中文，说明这段做什么、怎么触发。
4. 跨文件复用用 CommonJS（require("./x.js") / module.exports），不要写 ES module 的 import/export。不要假设 DOM，不要写死玩家数量，不要留 TODO 占位。
5. 延时用 await sleep(毫秒) 或 setInterval（引擎托管）；要按 tick 计数就在 tick 回调里自己累加，1 tick = ${(1000 / 64).toFixed(3)}ms。
6. 代码要能直接运行。`;

/* ---------------- 面板 ---------------- */

const CSS = `
.ai-drawer{position:absolute;top:0;right:0;bottom:0;width:min(430px,46vw);background:#12161d;border-left:1px solid #2a3444;display:flex;flex-direction:column;z-index:60;box-shadow:-12px 0 32px rgba(0,0,0,.35)}
.ai-drawer header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #232c39}
.ai-drawer header b{font-size:13px}
.ai-drawer .ai-x{margin-left:auto;background:none;border:none;color:#8b98ab;font-size:17px;cursor:pointer;line-height:1}
.ai-dbody{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px;flex:1}
.ai-drawer textarea,.ai-drawer select{width:100%;background:#0d1117;border:1px solid #2a3444;border-radius:6px;color:#e6edf6;padding:7px 9px;font-size:12.5px;font-family:inherit;box-sizing:border-box}
.ai-drawer textarea{min-height:82px;resize:vertical;line-height:1.55}
.ai-drawer label{display:block;color:#a9b6c8;font-size:11.5px;margin-bottom:3px}
.ai-optrow{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ai-out{background:#0d1117;border:1px solid #232c39;border-radius:7px;padding:9px 10px;font-size:12px;line-height:1.6;color:#c8d4e4;white-space:pre-wrap;word-break:break-word;max-height:46vh;overflow:auto}
.ai-out code{display:block;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#d6e3f5}
.ai-state{font-size:11.5px;color:#8b98ab;min-height:16px}
.ai-state.bad{color:#ff8f8f}.ai-state.ok{color:#6fd08c}
.ai-acts{display:flex;gap:7px;flex-wrap:wrap;padding:10px 12px;border-top:1px solid #232c39}
.ai-acts button{background:#222c3a;border:1px solid #33415a;color:#dfe6f0;border-radius:6px;padding:6px 11px;cursor:pointer;font-size:12.5px}
.ai-acts button.primary{background:#00e5ff;border-color:#00e5ff;color:#14100a;font-weight:600}
.ai-acts button:disabled{opacity:.45;cursor:default}
.ai-chips{display:flex;flex-wrap:wrap;gap:5px}
.ai-chips button{background:#182029;border:1px solid #2a3444;color:#9fb0c6;border-radius:20px;padding:3px 9px;font-size:11.5px;cursor:pointer}
.ai-chips button:hover{border-color:#4a5c78;color:#dfe6f0}
`;

const EXAMPLES = [
  ["踩到加速带就提速", "写一个服务端脚本：玩家碰到 .加速带 标签的实体时把 runSpeed 提到 0.8，3 秒后恢复"],
  ["进区域下雨", "玩家走进 .森林 区域时开始下雨并播放环境音，走出区域恢复晴天"],
  ["计分板", "服务端脚本：玩家经过 .检查点 累加分数，用 ui 在屏幕右上角显示分数"],
  ["造一座桥", "沙箱脚本：在当前世界造一座长 30 宽 3 的石桥，拱形，用木头做栏杆"],
];

function ensureCss() {
  if (document.getElementById("aiScriptStyle")) return;
  const s = document.createElement("style");
  s.id = "aiScriptStyle"; s.textContent = CSS;
  document.head.appendChild(s);
}

let _open = null;
let _q = null;   // 打开着的抽屉里那些控件的取用口

/** 在脚本界面加一个「AI 生成」按钮与抽屉。由 initFeatures 调用一次。 */
export function wireScriptAi(E) {
  ensureCss();
  const head = document.querySelector("#scriptScreen .ss-head");
  if (!head || document.getElementById("aiScriptBtn")) return;
  const btn = document.createElement("button");
  btn.id = "aiScriptBtn";
  btn.title = "用自然语言生成或改写当前脚本";
  btn.textContent = "AI 生成";
  btn.style.cssText = "border-color:#4a3a12;color:#ffc46b";
  head.insertBefore(btn, document.getElementById("scriptRun"));
  btn.onclick = () => (_open ? close() : open(E));
}

function close() { _open?.remove(); _open = null; _q = null; }

/**
 * 从编辑器的行内动作（CodeLens 那一排）带着预填需求打开 AI 抽屉。
 * 抽出来是因为"选中函数→解释/注释/修错"和"手写需求"是同一个入口的两种进法，
 * 复制一份抽屉逻辑必然和这边漂移。
 * @param E 编辑器引用
 * @param text 预填的需求正文
 * @param mode "revise" 改当前脚本 | "new" 生成新脚本
 */
export function askAbout(E, text, mode = "revise") {
  if (_open && _q) {
    _q("prompt").value = text;
    if (_q("mode")) _q("mode").value = mode;
    _q("prompt").focus();
    return;
  }
  _pending = { text, mode };
  open(E);
}
let _pending = null;

function open(E) {
  close();
  const screen = document.getElementById("scriptScreen");
  const d = document.createElement("div");
  d.className = "ai-drawer";
  d.innerHTML = `
    <header><b>AI 生成脚本</b><button class="ai-x" title="关闭">×</button></header>
    <div class="ai-dbody">
      <div class="ai-optrow">
        <div><label>目标</label><select data-k="mode">
          <option value="new">生成新脚本</option>
          <option value="revise">改写当前脚本</option>
        </select></div>
        <div><label>端</label><select data-k="side">
          <option value="server">服务端（index.js）</option>
          <option value="client">客户端（名字含 client）</option>
          <option value="sandbox">方块沙箱（点「运行」执行）</option>
        </select></div>
      </div>
      <div><label>想要什么</label><textarea data-k="prompt" placeholder="例如：玩家走进森林区域就开始下雨，走出恢复晴天" spellcheck="false"></textarea></div>
      <div class="ai-chips">${EXAMPLES.map((e, i) => `<button data-i="${i}">${e[0]}</button>`).join("")}</div>
      <div class="ai-state" data-k="state"></div>
      <div class="ai-out" data-k="out" hidden></div>
    </div>
    <div class="ai-acts">
      <button data-k="cfg">接口设置</button>
      <button data-k="viewSpec" title="看看这次到底把哪些规范发给了模型">看规范</button>
      <button data-k="gen" class="primary">生成</button>
      <button data-k="more" disabled title="接着上一轮继续改，它会记得自己写过什么">再改一轮</button>
      <button data-k="grabErr" title="把控制台里最近那条运行报错贴进需求，让它自己修">带上报错</button>
      <span style="flex:1"></span>
      <button data-k="applyNew" disabled>新建文件</button>
      <button data-k="applyCur" disabled>写入当前文件</button>
    </div>`;
  screen.appendChild(d);
  _open = d;

  const q = (k) => d.querySelector(`[data-k="${k}"]`);
  _q = q;   // 给 askAbout 用：抽屉已经开着时不用再重建，直接往需求框里填
  if (_pending) {
    q("prompt").value = _pending.text;
    if (q("mode")) q("mode").value = _pending.mode || "revise";
    setTimeout(() => q("prompt").focus(), 0);
    _pending = null;
  }
  const state = (msg, cls) => { const n = q("state"); n.textContent = msg; n.className = "ai-state" + (cls ? " " + cls : ""); };
  let code = "";
  let busy = null;
  // 当前这轮对话（含 system）。换端 / 重新生成都要重建，所以只由 gen 负责赋值。
  let convo = null;

  d.querySelector(".ai-x").onclick = close;
  d.querySelectorAll(".ai-chips button").forEach((b) => {
    b.onclick = () => { q("prompt").value = EXAMPLES[+b.dataset.i][1]; q("prompt").focus(); };
  });
  q("cfg").onclick = () => openSettings(() => state(aiReady() ? "接口已配置" : "还没填完", aiReady() ? "ok" : "bad"));

  const setCode = (c, round) => {
    code = c;
    const out = q("out");
    out.hidden = false;
    out.replaceChildren();
    const pre = document.createElement("code");
    pre.textContent = c;
    out.appendChild(pre);
    // 语法预检决定"能不能落地"，不决定"能不能看"：把模型的产出藏起来只会让人以为
    // 它没反应，而一句带行列号的编译错误正是下一轮最好的输入。
    const syn = checkSyntax(c);
    q("applyNew").disabled = !c || !syn.ok;
    q("applyCur").disabled = !c || !syn.ok || !curScriptSafe(E);
    q("more").disabled = !convo;
    return syn.ok ? `已生成 ${c.split("\n").length} 行 · 语法通过${round ? ` · 第 ${round} 轮` : ""}`
      : `语法不过，先别写入：${syn.error}`;
  };

  /** 把一轮对话推进 convo（不含 system，system 单独存以便换端后重建）。 */
  const ask = async (userText, ctrl, round) => {
    convo.push({ role: "user", content: userText });
    const r = await chat(convo.slice(), { signal: ctrl.signal });
    convo.push({ role: "assistant", content: r.text });
    // 上下文只留最近 8 条：一次"再改一轮"平均 2 条，够四五轮来回，
    // 再多就把 45KB 的规范之外又叠了一层旧对话，收益递减而挤占窗口。
    if (convo.length > 9) convo.splice(1, convo.length - 9);
    return { js: extractCode(r.text), model: r.model, msg: setCode(extractCode(r.text), round) };
  };

  q("gen").onclick = async () => {
    const prompt = q("prompt").value.trim();
    if (!prompt) return state("先写一句需求", "bad");
    if (!aiReady()) { openSettings(); return; }
    const side = q("side").value, mode = q("mode").value;
    state("生成中…");
    q("gen").disabled = true;
    const ctrl = new AbortController();
    busy = ctrl;
    try {
      const digest = await apiDigest(E.atlas, side);
      convo = [{ role: "system", content: await buildSystemPrompt(side, digest) }];
      let user = `目标：${mode === "revise" ? "改写下面这份现有脚本" : "写一份新脚本"}；端：${side === "sandbox" ? "方块沙箱" : side}。\n需求：${prompt}`;
      if (mode === "revise") {
        const cur = curScriptSafe(E);
        if (!cur) throw new Error("当前没有选中的脚本文件，先选一个或改成「生成新脚本」");
        user += `\n\n当前文件 ${cur.name} 的内容：\n\`\`\`js\n${cur.code.slice(0, 12000)}\n\`\`\``;
      }
      const r = await ask(user, ctrl);
      state(r.msg + " · " + r.model, r.msg.startsWith("语法不过") ? "bad" : "ok");
    } catch (e) {
      convo = null;
      if (e && e.name === "AbortError") state("已取消");
      else state((e && (e.message || String(e))) + "｜缺口：" + (configGaps().join("、") || "无"), "bad");
    } finally {
      q("gen").disabled = false;
      busy = null;
    }
  };

  // 「再改一轮」：同一份规范、同一份对话，只把新指令追加进去。
  // 没有这个的话用户每次调整都要重述需求，而模型每次都要重新猜上一版写了什么。
  q("more").onclick = async () => {
    const extra = q("prompt").value.trim();
    if (!extra) return state("先写要怎么改，再点「再改一轮」", "bad");
    if (!convo) return state("还没有上一轮可续，先点「生成」", "bad");
    state("改稿中…");
    q("more").disabled = true;
    const ctrl = new AbortController();
    busy = ctrl;
    try {
      const r = await ask("在上一版基础上继续改：" + extra, ctrl, convo.filter((m) => m.role === "user").length + 1);
      state(r.msg + " · " + r.model, r.msg.startsWith("语法不过") ? "bad" : "ok");
    } catch (e) {
      if (e && e.name === "AbortError") state("已取消");
      else state(String(e && (e.message || e)), "bad");
    } finally {
      q("more").disabled = !convo;
      busy = null;
    }
  };

  // 控制台最近一条报错是现成的、比人话精确得多的输入。不自动带上是刻意的：
  // 自动贴会把用户刚写的需求文字盖掉，而且不是每次报错都想让 AI 介入。
  q("grabErr").onclick = () => {
    const t = (document.getElementById("scriptOut") || {}).textContent || "";
    if (!t.trim()) return state("控制台还是空的——先点一次「运行」让它产出结果或报错", "bad");
    q("prompt").value = (q("prompt").value.trim() ? q("prompt").value.trim() + "\n\n" : "")
      + `这份代码运行时报错，请修掉后重发完整代码。\n控制台原文：\n${t.slice(0, 2000)}`;
    state("已把报错贴进需求，点「生成」或「再改一轮」", "ok");
    q("prompt").focus();
  };

  q("viewSpec").onclick = async () => {
    const side = q("side").value;
    state("整理规范中…");
    try {
      const digest = await apiDigest(E.atlas, side);
      const text = await buildSystemPrompt(side, digest);
      const out = q("out");
      out.hidden = false;
      out.replaceChildren();
      const pre = document.createElement("code");
      pre.textContent = text;
      out.appendChild(pre);
      const kb = (text.length / 1024).toFixed(1);
      state(`规范 ${(text.length).toLocaleString()} 字符（${kb}KB）· 核心类 ${digest.counts.fullClasses} 个 / 全库 ${digest.counts.classes} 类 · 禁用 ${digest.forbidden.length} 项`, "ok");
    } catch (err) { state("取规范失败：" + (err.message || err), "bad"); }
  };
  q("applyNew").onclick = () => applyTo(E, code, true, state);
  q("applyCur").onclick = () => applyTo(E, code, false, state);
  if (!aiReady()) state("先点「接口设置」填地址、模型与密钥");
}

function curScriptSafe(E) {
  return E.__scriptIdx == null ? null : (E.state.scripts || [])[E.__scriptIdx] || null;
}

function applyTo(E, code, asNew, state) {
  if (!code) return state("没有可写入的代码", "bad");
  const side = document.querySelector('.ai-drawer [data-k="side"]')?.value || "server";
  if (asNew) {
    const n = (E.state.scripts || []).length + 1;
    const name = side === "client" ? `clientAi${n}.js` : side === "sandbox" ? `aiSandbox${n}.js` : `aiScript${n}.js`;
    E.state.scripts = E.state.scripts || [];
    E.state.scripts.push({ name, code });
    E.__scriptIdx = E.state.scripts.length - 1;
    E.refreshScriptFiles && E.refreshScriptFiles();
    const ta = document.getElementById("scriptCode");
    if (ta) ta.value = code;
    E.markDirty && E.markDirty();
    state(`已写入新文件 ${name}`, "ok");
  } else {
    const cur = curScriptSafe(E);
    if (!cur) return state("当前没选中脚本文件", "bad");
    cur.code = code;
    const ta = document.getElementById("scriptCode");
    if (ta) ta.value = code;
    E.markDirty && E.markDirty();
    state(`已写入 ${cur.name}`, "ok");
  }
}
