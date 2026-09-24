// ai-script.js — 脚本界面的「AI 生成」抽屉：把需求写成一个能直接跑的地图脚本。
//
// 为什么值得单独一个文件：它要同时懂两件事——AI 调用（ai.js）和脚本面板的内部结构
// （state.scripts / __scriptIdx / renderScriptFiles）。塞进 features.js 会让那个文件
// 再胖一截，塞进 ai.js 又会让共享层依赖编辑器状态。
//
// 提示词里的 API 清单是**运行时从 public/data/*.json 现取的**，不是手抄的。
// 手抄一份必然在下一次 api-audit 之后过期，而过期的清单会让模型自信地调用
// 一个我们根本没实现的成员——那比模型不会写代码更难查。

import { chat, aiReady, openSettings, extractCode, configGaps } from "./ai.js";

let _digest = null;
let _digestKey = "";

/** 类 → 已实现成员清单。未实现的成员**不写进提示词**：告诉模型"可以用"结果跑不通，
 *  比不告诉更糟。 */
export async function apiDigest(atlas) {
  const key = (atlas && atlas.ready ? "atlas" : "noatlas");
  if (_digest && _digestKey === key) return _digest;
  const grab = async (p) => { try { return await (await fetch(p)).json(); } catch { return null; } };
  const [members, impl] = await Promise.all([
    grab("/data/api-members.json"), grab("/data/api-impl.json"),
  ]);
  const lines = [];
  if (members && impl) {
    for (const [cls, mem] of Object.entries(members)) {
      const done = new Set(Array.isArray(impl[cls]) ? impl[cls] : []);
      if (!done.size) continue;
      const keep = mem.filter((m) => done.has(m)).slice(0, 30);
      if (!keep.length) continue;
      lines.push(`${cls}: ${keep.join(", ")}${mem.length > keep.length ? " …" : ""}`);
    }
  }
  // 方块名从图集现取：每个类别挑几个，够模型写出 sb.set(...,"grass") 就行；
  // 全量 383 个名字塞进提示词只是烧 token。
  let names = "";
  if (atlas && typeof atlas.list === "function") {
    const byCat = new Map();
    for (const b of atlas.list()) {
      const arr = byCat.get(b.category) || [];
      if (arr.length < 6) arr.push(b.name);
      byCat.set(b.category, arr);
    }
    names = [...byCat.entries()].map(([c, ns]) => `${c}: ${ns.join(" ")}`).join("；");
  }
  _digest = { api: lines.join("\n"), names };
  _digestKey = key;
  return _digest;
}

const SERVER_GLOBALS = "world, voxels, resources, storage, db, rtc, analytics, gui, randomPick, getEntityBounds, GameVector3, GameBounds3, GameRGBColor, GameRGBAColor, GameQuaternion, GameCameraMode, GameDialogType, GameEasing, GameBodyPart, SocialType 等枚举";
const CLIENT_GLOBALS = "world, navigator, screenWidth, screenHeight, ui, input, screen, media, call, callAsync, UiBox, UiText, UiInput, UiImage, UiScrollBox, Audio, Vec3";

export function buildSystemPrompt(digest) {
  return `你在为「神奇代码岛 DAO3」的本地兼容实现写地图脚本。语言是浏览器里的 JavaScript（支持顶层 await）。

【目标 A：游戏脚本】运行模式执行，文件名决定端：
- 服务端文件（如 index.js）可用全局：${SERVER_GLOBALS}
- 客户端文件（名字里含 client）可用全局：${CLIENT_GLOBALS}
- 官方常量与单位（必须照用，不要自己编）：物理固定 20 TPS，1 tick = 64ms；
  walkSpeed 0.22、runSpeed 0.4、jumpPower 0.96、gravity -0.1（单位：格/tick、格/tick²）；
  坐标单位是"格"，1 格 = 1 方块；角度用弧度；颜色分量取值 0..1。
- 实体选择器：'#名字' 与 '.标签'；**entity.id 暴露的是实体名字**（如 "检查点-0"），
  要序号就从名字里取数字，不要假设 id 是数字。
- 常用写法：world.onTick(async () => {...})、world.querySelectorAll('.标签')、
  entity.player.say / directMessage / sound({sample:"a.mp3",gain:1})、
  world.addCollisionFilter(a,b)、storage.getDataStorage(namespace).get/set。

【目标 B：方块沙箱脚本】编辑器「运行」按钮执行，只改体素，全局只有 sb / Math / console：
sb.set(x,y,z,block)、sb.del(x,y,z)、sb.block(name)、sb.box([x0,y0,z0],[x1,y1,z1],block,shell?)、
sb.sphere([x,y,z],r,block)、sb.clear()、sb.count()、sb.size()、sb.log(msg)。
block 可以是图集里的方块名。可用方块名举例（按类别）：${digest.names || "grass dirt stone sand water snow wood glass"}。

【本实现真实可用的 API 面（类 → 成员）】
${digest.api || "（清单未取到，只写最基础的 world/entity/player 调用）"}

【硬性要求】
1. 先判断用户要的是 A 还是 B，不明确就做 A 且优先只用到 world/entity/player。
2. 只用上面列出的全局与成员。清单里没有的一律不要用，改成更简单的等价写法。
3. 输出**恰好一个** \`\`\`js 代码块；块外最多两句中文，说明这段做什么、怎么触发。
4. 不要 import/require，不要假设有 DOM（目标 B 里连 document 都没有），不要写死玩家数量。
5. 循环里用 await sleep(ticks) 之类不存在——要延时就用清单里真实存在的方式，或按 tick 计数。
6. 代码要能直接运行，不留 TODO 占位。`;
}

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
.ai-acts button.primary{background:#fc8308;border-color:#fc8308;color:#14100a;font-weight:600}
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

function close() { _open?.remove(); _open = null; }

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
      <button data-k="gen" class="primary">生成</button>
      <span style="flex:1"></span>
      <button data-k="applyNew" disabled>新建文件</button>
      <button data-k="applyCur" disabled>写入当前文件</button>
    </div>`;
  screen.appendChild(d);
  _open = d;

  const q = (k) => d.querySelector(`[data-k="${k}"]`);
  const state = (msg, cls) => { const n = q("state"); n.textContent = msg; n.className = "ai-state" + (cls ? " " + cls : ""); };
  let code = "";
  let busy = null;

  d.querySelector(".ai-x").onclick = close;
  d.querySelectorAll(".ai-chips button").forEach((b) => {
    b.onclick = () => { q("prompt").value = EXAMPLES[+b.dataset.i][1]; q("prompt").focus(); };
  });
  q("cfg").onclick = () => openSettings(() => state(aiReady() ? "接口已配置" : "还没填完", aiReady() ? "ok" : "bad"));

  const setCode = (c) => {
    code = c;
    const out = q("out");
    out.hidden = false;
    out.innerHTML = "";
    const pre = document.createElement("code");
    pre.textContent = c;
    out.appendChild(pre);
    q("applyNew").disabled = !c;
    q("applyCur").disabled = !c || !curScriptSafe(E);
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
      const digest = await apiDigest(E.atlas);
      const msgs = [{ role: "system", content: buildSystemPrompt(digest) }];
      let user = `目标：${mode === "revise" ? "改写下面这份现有脚本" : "写一份新脚本"}；端：${side === "sandbox" ? "方块沙箱" : side}。\n需求：${prompt}`;
      if (mode === "revise") {
        const cur = curScriptSafe(E);
        if (!cur) throw new Error("当前没有选中的脚本文件，先选一个或改成「生成新脚本」");
        user += `\n\n当前文件 ${cur.name} 的内容：\n\`\`\`js\n${cur.code.slice(0, 12000)}\n\`\`\``;
      }
      msgs.push({ role: "user", content: user });
      const r = await chat(msgs, { signal: ctrl.signal });
      const js = extractCode(r.text);
      setCode(js);
      state(`已生成 ${js.split("\n").length} 行 · ${r.model}`, "ok");
    } catch (e) {
      if (e && e.name === "AbortError") state("已取消");
      else state((e && (e.message || String(e))) + "｜缺口：" + (configGaps().join("、") || "无"), "bad");
    } finally {
      q("gen").disabled = false;
      busy = null;
    }
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
