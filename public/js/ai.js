// ai.js — OpenAI 兼容接口的共享层：配置、调用、设置面板、产出解析。
//
// 三条硬约束：
//  1. **密钥只留在这台设备上**。只存 localStorage，只发往用户自己填的那个地址，
//     不进地图数据、不进项目包、不进日志。上游报错文本里可能回显请求 URL
//     （有些网关把 key 拼在 query 里），所以任何要显示给用户的字符串先过 redact()。
//  2. **调用一律走本地 server 的 /api/ai/chat 代理**，不在浏览器里直连第三方。
//     浏览器直连要赌对方开了 CORS（各家兼容网关参差不齐），而代理只多一次
//     localhost 请求；顺带让"静态托管的体验版没有 AI"这件事是真的。
//  3. **AI 的产出必须先预览再生成**：脚本要人点一下才落进文件，体素程序要过
//     越界与配额校验。绝不把模型返回的内容直接执行或写入世界。

const CFG_KEY = "dao3_ai_config";
const DEFAULTS = { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", temperature: 0.4, maxTokens: 2048 };

/** 每次现读 localStorage，不做内存缓存：一次设置读取比一次网络往返便宜三个数量级，
 *  而缓存会带来一类真 bug——用户在设置面板改了模型名，界面里却还拿着旧值发请求。 */
export function loadConfig() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch { raw = null; }
  return Object.assign({ key: "" }, DEFAULTS, raw && typeof raw === "object" ? raw : {});
}
export function saveConfig(patch) {
  const next = Object.assign({}, loadConfig(), patch || {});
  try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch {}
  return next;
}
export function clearKey() { saveConfig({ key: "" }); }
/** 填了地址、模型和密钥才算可用；只填两项时界面要提示还缺什么。 */
export function configGaps() {
  const c = loadConfig();
  const miss = [];
  if (!String(c.baseUrl || "").trim()) miss.push("接口地址");
  if (!String(c.model || "").trim()) miss.push("模型名");
  if (!String(c.key || "").trim()) miss.push("密钥");
  return miss;
}
export function aiReady() { return configGaps().length === 0; }

/** 把密钥从任何要显示/记录的字符串里抹掉。 */
export function redact(text) {
  const k = String(loadConfig().key || "").trim();
  let s = String(text == null ? "" : text);
  if (k && s.includes(k)) s = s.split(k).join("••••");
  return s.replace(/sk-[A-Za-z0-9_\-]{12,}/g, "sk-••••");
}

/**
 * 一次对话补全。走 server 代理；代理不在（静态托管 / 老版本 server）时给出
 * 能照着修的错误，而不是静默失败。
 * @returns {Promise<{text:string, usage?:object, model?:string}>}
 */
export async function chat(messages, opts = {}) {
  const gaps = configGaps();
  if (gaps.length) throw new Error("还没配置 AI：" + gaps.join("、") + " 未填");
  const c = loadConfig();
  const ctrl = new AbortController();
  const ms = Math.max(5000, opts.timeout || 120000);
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (opts.signal) opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  let resp;
  try {
    resp = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: c.baseUrl, model: c.model, key: c.key,
        messages, temperature: c.temperature, maxTokens: c.maxTokens,
        json: !!opts.json,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") throw new Error("请求超时（" + Math.round(ms / 1000) + " 秒）");
    throw new Error("连不上本地服务的 AI 代理：" + redact(e.message || e) + "。这个能力需要由 node server.js 提供，静态托管的体验版没有。");
  }
  clearTimeout(timer);
  let data = null;
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok || !data || data.ok === false) {
    const detail = data && (data.error || data.detail) || ("HTTP " + resp.status);
    throw new Error(redact(detail));
  }
  const text = typeof data.text === "string" ? data.text : "";
  if (!text.trim()) throw new Error("模型返回了空内容");
  return { text, usage: data.usage || null, model: data.model || c.model };
}

/* ---------------- 产出解析 ---------------- */

/** 从回答里取代码：优先 ``` 围栏块（可多段拼接），没有就把全文当代码。 */
export function extractCode(text) {
  const s = String(text || "");
  const blocks = [...s.matchAll(/```[ \t]*([A-Za-z0-9+#-]*)[^\S\n]*\r?\n([\s\S]*?)```/g)];
  if (blocks.length) {
    const pick = blocks.filter((b) => /^(js|javascript|ts|typescript|json|voxel|glsl|lua)?$/i.test(b[1] || ""));
    return (pick.length ? pick : blocks).map((b) => b[2].replace(/\s+$/, "")).join("\n\n");
  }
  return s.replace(/^\s*[\r\n]+/, "").trim();
}
/** 围栏里的 JSON（体素程序用）。解析失败要报"没找到 JSON"而不是 SyntaxError。 */
export function extractJson(text) {
  const raw = extractCode(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("回答里没有找到 JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

/* ---------------- 体素程序：校验与落地 ---------------- */
// 模型不擅长逐格报坐标，所以让它输出**积木式图元**（长方体 / 椭球 / 圆柱），
// 这正是体素美术打草稿的做法，也让我们能硬性限制规模。
const MAX_PARTS = 16;
const MAX_SIZE = 64;
const MAX_PRIMS = 400;
const MAX_VOXELS = 60000;
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
function normHex(v, fallback) {
  const s = String(v || "").trim();
  if (!HEX_RE.test(s)) return fallback;
  return s.startsWith("#") ? s.toLowerCase() : ("#" + s).toLowerCase();
}

/**
 * 校验并归一化模型给出的体素程序。任何越界、超量、类型错的项都被夹回合法范围，
 * 而不是抛错——AI 输出偶尔跑偏是常态，跑偏的部分丢掉、能用的留下。
 * @returns {{models: Array<{name:string, parts:Array<{name:string, size:number[], prims:Array<object>}>}>, dropped:number}}
 */
export function validateVoxelProgram(prog) {
  if (!prog || typeof prog !== "object") throw new Error("JSON 顶层必须是一个对象");
  const list = Array.isArray(prog.models) ? prog.models : [prog];
  const out = [];
  let dropped = 0;
  for (const m of list.slice(0, MAX_PARTS)) {
    const parts = Array.isArray(m && m.parts) ? m.parts : (m && m.size ? [m] : []);
    const cleanParts = [];
    for (const p of parts.slice(0, MAX_PARTS)) {
      const size = Array.isArray(p && p.size) ? p.size : [16, 16, 16];
      const sx = clampInt(size[0], 1, MAX_SIZE), sy = clampInt(size[1], 1, MAX_SIZE), sz = clampInt(size[2], 1, MAX_SIZE);
      const prims = [];
      let budget = MAX_VOXELS;
      for (const pr of (Array.isArray(p && p.prims) ? p.prims : []).slice(0, MAX_PRIMS)) {
        const clean = cleanPrim(pr, [sx, sy, sz]);
        if (!clean) { dropped++; continue; }
        const cost = primCost(clean, [sx, sy, sz]);
        if (cost > budget) { dropped++; continue; }
        budget -= cost;
        prims.push(clean);
      }
      if (!prims.length) { dropped++; continue; }
      cleanParts.push({ name: String((p && (p.name || p.part)) || "部件").slice(0, 24), size: [sx, sy, sz], prims });
    }
    if (!cleanParts.length) continue;
    out.push({ name: String((m && m.name) || "AI 模型").slice(0, 24), parts: cleanParts });
  }
  if (!out.length) throw new Error("没有可用的部件：图元全部越界或超出配额");
  return { models: out, dropped };
}

function pt(v, lim) {
  if (!Array.isArray(v) || v.length < 3) return null;
  return [clampInt(v[0], 0, lim[0] - 1), clampInt(v[1], 0, lim[1] - 1), clampInt(v[2], 0, lim[2] - 1)];
}
function cleanPrim(pr, lim) {
  if (!pr || typeof pr !== "object") return null;
  const kind = String(pr.shape || pr.kind || "box").toLowerCase();
  const color = normHex(pr.color ?? pr.hex ?? pr.c, "#8a8a8a");
  const emissive = pr.emissive ? clampInt(pr.emissive, 0, 15) : 0;
  if (kind === "box" || kind === "cuboid") {
    // 越界分两种处理：差一两格是模型常见的 off-by-one（size 12 却写 to:[12,..]），
    // 夹回来就是它想要的；而 99³ 这种离谱值夹回来会变成"填满整个部件框"，
    // 实测把一座本来灰底座的小塔涂成了红块。跨度超过框 2 格以上的直接丢，
    // 让它进 dropped 计数、在预览里说清楚，而不是悄悄改设计。
    const raw = [pr.from ?? pr.min, pr.to ?? pr.max];
    if (!Array.isArray(raw[0]) || !Array.isArray(raw[1])) return null;
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(Number(raw[0][i]) || 0, Number(raw[1][i]) || 0);
      const hi = Math.max(Number(raw[0][i]) || 0, Number(raw[1][i]) || 0);
      if (hi - lo + 1 > lim[i] + 2) return null;
    }
    const a = pt(raw[0], lim), b2 = pt(raw[1], lim);
    if (!a || !b2) return null;
    const from = [Math.min(a[0], b2[0]), Math.min(a[1], b2[1]), Math.min(a[2], b2[2])];
    const to = [Math.max(a[0], b2[0]), Math.max(a[1], b2[1]), Math.max(a[2], b2[2])];
    return { shape: "box", from, to, color, emissive, shell: !!pr.shell };
  }
  if (kind === "sphere" || kind === "ellipsoid") {
    const center = pt(pr.center ?? pr.at ?? pr.pos, lim);
    if (!center) return null;
    const r = pr.radius != null ? [pr.radius, pr.radius, pr.radius] : pr.radii;
    const rr = [Math.max(0, clampInt(r && r[0] != null ? r[0] : r, 0, lim[0])),
      Math.max(0, clampInt(r && r[1] != null ? r[1] : r, 0, lim[1])),
      Math.max(0, clampInt(r && r[2] != null ? r[2] : r, 0, lim[2]))];
    if (!rr[0] && !rr[1] && !rr[2]) return null;
    return { shape: "sphere", center, radii: rr, color, emissive };
  }
  if (kind === "cylinder") {
    const center = pt(pr.center ?? pr.at ?? pr.pos, lim);
    if (!center) return null;
    const axis = ["x", "y", "z"].includes(String(pr.axis)) ? String(pr.axis) : "y";
    const radius = Math.max(0, clampInt(pr.radius ?? pr.r, 0, lim[0]));
    const height = Math.max(1, clampInt(pr.height ?? pr.h, 1, lim[1]));
    if (!radius) return null;
    return { shape: "cylinder", center, axis, radius, height, color, emissive };
  }
  return null;
}
function primCost(pr, lim) {
  if (pr.shape === "box") {
    const d = [pr.to[0] - pr.from[0] + 1, pr.to[1] - pr.from[1] + 1, pr.to[2] - pr.from[2] + 1];
    if (!pr.shell) return d[0] * d[1] * d[2];
    return d[0] * d[1] * d[2] - Math.max(0, d[0] - 2) * Math.max(0, d[1] - 2) * Math.max(0, d[2] - 2);
  }
  const r = pr.shape === "sphere" ? pr.radii : [pr.radius, pr.radius, pr.radius];
  return Math.max(1, Math.round((4 / 3) * Math.PI * r[0] * r[1] * r[2]));
}

/** 展开成一个部件的体素列表：`{x,y,z,color,emissive}`，按坐标去重（后写的覆盖先写的）。 */
export function programToVoxels(part) {
  const [sx, sy, sz] = part.size;
  const map = new Map();
  const put = (x, y, z, v) => { if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) map.set(x + y * sx + z * sx * sy, { x, y, z, ...v }); };
  for (const pr of part.prims) {
    if (pr.shape === "box") {
      const [a, b] = [pr.from, pr.to];
      for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) {
        const face = pr.shell && (x === a[0] || x === b[0] || y === a[1] || y === b[1] || z === a[2] || z === b[2]);
        if (!pr.shell || face) put(x, y, z, pr);
      }
    } else if (pr.shape === "sphere") {
      const [cx, cy, cz] = pr.center, [rx, ry, rz] = pr.radii;
      for (let x = cx - rx; x <= cx + rx; x++) for (let y = cy - ry; y <= cy + ry; y++) for (let z = cz - rz; z <= cz + rz; z++) {
        if (rx && ry && rz) {
          const d = ((x - cx) + 0.5) ** 2 / (rx * rx) + ((y - cy) + 0.5) ** 2 / (ry * ry) + ((z - cz) + 0.5) ** 2 / (rz * rz);
          if (d > 1.15) continue;
        } else if (!(x === cx && y === cy && z === cz)) continue;
        put(x, y, z, pr);
      }
    } else if (pr.shape === "cylinder") {
      const ai = { x: 0, y: 1, z: 2 }[pr.axis];
      for (let h = 0; h < pr.height; h++) for (let a = -pr.radius; a <= pr.radius; a++) for (let b = -pr.radius; b <= pr.radius; b++) {
        if (a * a + b * b > pr.radius * pr.radius + 0.25) continue;
        const p = [pr.center[0], pr.center[1], pr.center[2]];
        const others = [0, 1, 2].filter((i) => i !== ai);
        p[others[0]] = a + pr.center[others[0]];
        p[others[1]] = b + pr.center[others[1]];
        p[ai] = h - Math.floor(pr.height / 2) + pr.center[ai];
        put(p[0], p[1], p[2], pr);
      }
    }
  }
  return [...map.values()];
}

/* ---------------- 共享设置面板 ---------------- */

const STYLE = `
.ai-mask{position:fixed;inset:0;background:rgba(8,10,14,.62);display:flex;align-items:center;justify-content:center;z-index:9000}
.ai-box{width:min(520px,92vw);max-height:88vh;overflow:auto;background:#151a22;border:1px solid #2a3444;border-radius:12px;padding:18px 20px;color:#dfe6f0;box-shadow:0 18px 60px rgba(0,0,0,.5);font-size:13px}
.ai-box h3{margin:0 0 4px;font-size:15px}
.ai-box .ai-sub{margin:0 0 14px;color:#8b98ab;font-size:12px;line-height:1.6}
.ai-row{display:flex;flex-direction:column;gap:4px;margin-bottom:11px}
.ai-row label{color:#a9b6c8;font-size:12px}
.ai-row input,.ai-row select,.ai-row textarea{background:#0d1117;border:1px solid #2a3444;border-radius:6px;color:#e6edf6;padding:7px 9px;font-size:13px;font-family:inherit}
.ai-row input:focus,.ai-row textarea:focus{outline:none;border-color:#fc8308}
.ai-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ai-note{background:#101823;border-left:3px solid #3f5170;padding:8px 10px;color:#9fb0c6;line-height:1.65;font-size:12px;border-radius:0 6px 6px 0}
.ai-warn{border-left-color:#c98a2b;background:#1a1610;color:#d8bd8e}
.ai-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
.ai-acts button{background:#222c3a;border:1px solid #33415a;color:#dfe6f0;border-radius:6px;padding:7px 13px;cursor:pointer;font-size:13px}
.ai-acts button.primary{background:#fc8308;border-color:#fc8308;color:#14100a;font-weight:600}
.ai-acts button:disabled{opacity:.5;cursor:default}
.ai-stat{font-size:12px;margin-right:auto;align-self:center}
.ai-stat.ok{color:#6fd08c}.ai-stat.bad{color:#ff8f8f}
`;

function ensureStyle() {
  if (document.getElementById("aiLayerStyle")) return;
  const s = document.createElement("style");
  s.id = "aiLayerStyle";
  s.textContent = STYLE;
  document.head.appendChild(s);
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** 打开设置面板（编辑器与 VOXA 共用同一个）。onDone 在保存后回调。 */
export function openSettings(onDone) {
  ensureStyle();
  document.getElementById("aiSettings")?.remove();
  const c = loadConfig();
  const mask = el("div", "ai-mask");
  mask.id = "aiSettings";
  const box = el("div", "ai-box");
  box.appendChild(el("h3", null, "AI 接口设置"));
  box.appendChild(el("p", "ai-sub", "填任意 OpenAI 兼容服务：OpenAI 官方、One-API / 各类中转站、LM Studio、Ollama 的 openai 兼容端点都可以。"));

  const mk = (label, key, type, ph) => {
    const row = el("div", "ai-row");
    row.appendChild(el("label", null, label));
    const i = el("input");
    i.type = type || "text"; i.value = c[key] ?? ""; i.placeholder = ph || "";
    i.dataset.k = key;
    row.appendChild(i); box.appendChild(row);
    return i;
  };
  const url = mk("接口地址（Base URL，到 /v1 为止）", "baseUrl", "text", "https://api.openai.com/v1");
  const key = mk("密钥 API Key", "key", "password", "sk-…");
  const grid = el("div", "ai-grid2");
  const wrap = (label, node) => { const r = el("div", "ai-row"); r.appendChild(el("label", null, label)); r.appendChild(node); return r; };
  const model = el("input"); model.value = c.model || ""; model.placeholder = "gpt-4o-mini";
  const temp = el("input"); temp.type = "number"; temp.min = "0"; temp.max = "2"; temp.step = "0.1"; temp.value = c.temperature;
  grid.appendChild(wrap("模型名", model));
  grid.appendChild(wrap("温度", temp));
  box.appendChild(grid);

  const stat = el("div", "ai-stat");
  const note = el("div", "ai-note ai-warn",
    "密钥只保存在这台设备的浏览器里，请求经由本机 node 服务转发到你填写的地址：不进地图、不进导出包、不写日志。"
    + "换成别人的电脑或清掉浏览器数据后需要重填。");
  box.appendChild(note);

  const acts = el("div", "ai-acts");
  const testBtn = el("button", null, "测试连接");
  const closeBtn = el("button", null, "取消");
  const saveBtn = el("button", "primary", "保存");
  testBtn.onclick = async () => {
    saveFrom();
    stat.className = "ai-stat"; stat.textContent = "正在请求…";
    testBtn.disabled = true;
    try {
      const r = await chat([{ role: "user", content: "只回复两个字：正常" }], { timeout: 30000 });
      stat.className = "ai-stat ok";
      stat.textContent = "可用 · " + r.model + " · " + r.text.slice(0, 24);
    } catch (e) {
      stat.className = "ai-stat bad";
      stat.textContent = redact(e.message || e).slice(0, 160);
    } finally { testBtn.disabled = false; }
  };
  closeBtn.onclick = () => mask.remove();
  saveBtn.onclick = () => { saveFrom(); mask.remove(); onDone && onDone(loadConfig()); };
  mask.onclick = (ev) => { if (ev.target === mask) mask.remove(); };
  acts.append(stat, testBtn, closeBtn, saveBtn);
  box.appendChild(acts);
  mask.appendChild(box);
  document.body.appendChild(mask);

  function saveFrom() {
    return saveConfig({
      baseUrl: url.value.trim().replace(/\/+$/, "") || DEFAULTS.baseUrl,
      key: key.value.trim(),
      model: model.value.trim() || DEFAULTS.model,
      temperature: Math.max(0, Math.min(2, Number(temp.value) || 0)),
    });
  }
}
