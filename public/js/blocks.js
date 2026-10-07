// blocks.js — 积木编辑器（低代码）：把块拼成程序，编译成官方 API 的 JavaScript 写进脚本。
//
// 为什么值得做：脚本页对"从来没写过代码的人"仍然是一堵墙。积木不是玩具——
// 它是同一份脚本的另一种输入法：拼完点一下，生成的 JS 就落在脚本工作区的
// blocks.js 里，可以接着手改、可以存盘、可以运行游戏。两条通路写的是同一个真相
// （state.scripts），不存在"积木版"和"代码版"两份程序。
//
// 只发官方存在的接口。每个 emit 里写的 world.* / entity.* 都在 game.js 的运行时有
// 实现——onChat 的 {entity, message}、onPress 的 {entity, button, pressed}、
// onPlayerJoin 的 {tick, entity} 这些 payload 形状都是照运行时逐条核过的，
// 不编"看起来像"的 API。
import { highlightJS } from "./features.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lit = (s) => JSON.stringify(String(s == null ? "" : s));      // 字符串字段 → JS 字面量
const num = (v, d = 0) => (Number.isFinite(+v) ? String(+v) : String(d));
const indent = (lines, d) => lines.map((s) => (s ? "  ".repeat(d) + s : s));

const CATS = [["event", "事件"], ["action", "动作"], ["flow", "流程"], ["var", "变量"], ["world", "玩法"]];

/** 变量名允许中文，但落到 JS 里得是合法标识符：不合法就转成稳定的短名，
    原名留在注释里，读代码的人知道 v_3d29… 是哪个。 */
function safeName(n) {
  const s = String(n || "").trim();
  if (!s) return "v_empty";
  if (/^[A-Za-z_$][\w$]*$/.test(s)) return s;
  let out = "";
  for (const ch of s) out += ch.charCodeAt(0).toString(36);
  return "v_" + out.slice(0, 12);
}

// 块定义：label + 第一个字段 + unit 拼成一句中文；fields 剩下的字段排在下一行。
// hat = 顶层事件块；body = 有一格插槽；vars(b) 说这个块用到哪些变量名（编译期收集用，
// 不写回块对象——写回去的话每编译一次就多攒一份重复）。
const TYPES = {
  on_join: { cat: "event", hat: true, body: true, label: "当玩家进入世界时",
    emit: (b, inner) => ["world.onPlayerJoin(({ entity }) => {", ...inner, "});"] },
  on_leave: { cat: "event", hat: true, body: true, label: "当玩家离开世界时",
    emit: (b, inner) => ["world.onPlayerLeave(({ entity }) => {", ...inner, "});"] },
  on_chat: { cat: "event", hat: true, body: true, label: "当有人发言、且包含",
    fields: { kw: { t: "text", d: "开始" } },
    emit: (b, inner) => ["world.onChat(({ entity, message }) => {", `  if (!message.includes(${lit(b.f.kw)})) return;`, ...inner, "});"] },
  on_press: { cat: "event", hat: true, body: true, label: "当玩家按下动作键时",
    emit: (b, inner) => ["world.onPress(({ entity, button, pressed }) => {", "  if (!pressed) return;", ...inner, "});"] },
  on_tick: { cat: "event", hat: true, body: true, label: "每隔", unit: "tick 执行一次",
    fields: { every: { t: "num", d: 20 } },
    emit: (b, inner) => ["world.onTick(({ tick }) => {", `  if (tick % ${num(b.f.every, 20)} !== 0) return;`, ...inner, "});"] },

  say: { cat: "action", entity: true, label: "让 TA 头顶飘出", fields: { msg: { t: "text", d: "你好！" } },
    emit: (b) => [`entity.say(${lit(b.f.msg)});`] },
  world_say: { cat: "action", label: "全服广播", fields: { msg: { t: "text", d: "比赛开始" } },
    emit: (b) => [`world.say(${lit(b.f.msg)});`] },
  dialog: { cat: "action", entity: true, label: "给 TA 弹对话框，标题",
    fields: { title: { t: "text", d: "提示" }, content: { t: "text", d: "欢迎来到这张图" } },
    emit: (b) => [`entity.player.dialog({ type: GameDialogType.TEXT, title: ${lit(b.f.title)}, content: ${lit(b.f.content)} });`] },
  sound: { cat: "action", entity: true, label: "给 TA 播放音效", fields: { sample: { t: "text", d: "click" } },
    emit: (b) => [`entity.player.playSound({ sample: ${lit(b.f.sample)} });`] },
  teleport: { cat: "action", entity: true, label: "把 TA 传到", unit: "XYZ",
    fields: { x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 } },
    emit: (b) => [`entity.player.teleport({ x: ${num(b.f.x)}, y: ${num(b.f.y)}, z: ${num(b.f.z)} });`] },
  timer: { cat: "action", body: true, label: "等", unit: "毫秒后执行", fields: { ms: { t: "num", d: 3000 } },
    emit: (b, inner) => ["world.setTimeout(() => {", ...inner, `}, ${num(b.f.ms, 0)});`] },

  repeat: { cat: "flow", body: true, label: "重复", unit: "次", fields: { n: { t: "num", d: 3 } },
    emit: (b, inner) => [`for (let i = 0; i < ${num(b.f.n, 0)}; i++) {`, ...inner, "}"] },
  if_expr: { cat: "flow", body: true, label: "如果（JS 条件）", fields: { cond: { t: "expr", d: "tick % 100 === 0" } },
    emit: (b, inner) => [`if (${b.f.cond || "true"}) {`, ...inner, "}"] },
  var_if: { cat: "flow", body: true, label: "如果变量", unit: "",
    fields: { name: { t: "name", d: "得分" }, op: { t: "sel", opts: [">", ">=", "<", "<=", "==", "!="], d: ">" }, value: { t: "expr", d: "0" } },
    vars: (b) => [b.f.name],
    emit: (b, inner) => [`if (${safeName(b.f.name)} ${b.f.op || ">"} ${b.f.value || "0"}) {`, ...inner, "}"] },

  var_set: { cat: "var", label: "把变量", unit: "设为", fields: { name: { t: "name", d: "得分" }, value: { t: "expr", d: "0" } },
    vars: (b) => [b.f.name], emit: (b) => [`${safeName(b.f.name)} = ${b.f.value || "null"};`] },
  var_add: { cat: "var", label: "给变量", unit: "加上", fields: { name: { t: "name", d: "得分" }, value: { t: "num", d: 1 } },
    vars: (b) => [b.f.name], emit: (b) => [`${safeName(b.f.name)} += ${num(b.f.value, 0)};`] },
  var_say: { cat: "var", entity: true, label: "把变量", unit: "飘给 TA 看", fields: { name: { t: "name", d: "得分" } },
    vars: (b) => [b.f.name], emit: (b) => [`entity.say(String(${safeName(b.f.name)}));`] },

  set_voxel: { cat: "world", label: "在", unit: "XYZ 放一个方块",
    fields: { x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 }, name: { t: "text", d: "stone" } },
    emit: (b) => [`world.setVoxel(${num(b.f.x)}, ${num(b.f.y)}, ${num(b.f.z)}, ${lit(b.f.name)});`] },
  weather: { cat: "world", label: "天气：雨", unit: "· 雪",
    fields: { rain: { t: "num", d: 0 }, snow: { t: "num", d: 0 }, thunder: { t: "num", d: 0 } },
    emit: (b) => [`world.setWeather({ rain: ${num(b.f.rain)}, snow: ${num(b.f.snow)}, thunder: ${num(b.f.thunder)} });`] },
  spawn: { cat: "world", label: "把出生点设到", unit: "XYZ",
    fields: { x: { t: "num", d: 0 }, y: { t: "num", d: 1 }, z: { t: "num", d: 0 } },
    emit: (b) => [`world.setWorldSpawn({ x: ${num(b.f.x)}, y: ${num(b.f.y)}, z: ${num(b.f.z)} });`] },
  log: { cat: "world", label: "打印到控制台（JS 表达式）", fields: { msg: { t: "expr", d: '"跑了一次"' } },
    emit: (b) => [`console.log(${b.f.msg || '""'});`] },
};

let uid = 1;
const nid = () => "b" + uid++;
function mk(type) {
  const d = TYPES[type] || {};
  const f = {};
  for (const [k, fd] of Object.entries(d.fields || {})) f[k] = fd.d;
  return { id: nid(), type, f, children: d.body ? [] : null };
}
const withFields = (type, fields) => Object.assign(mk(type), { f: Object.assign(mk(type).f, fields) });

const EXAMPLE = () => [
  withFields("var_set", { name: "得分", value: "0" }),
  Object.assign(mk("on_join"), { children: [mk("say"), mk("dialog")] }),
  Object.assign(mk("on_chat"), { f: { kw: "得分" }, children: [
    withFields("var_add", { name: "得分", value: 1 }),
    mk("var_say"),
  ] }),
  Object.assign(mk("on_tick"), { f: { every: 600 }, children: [mk("world_say")] }),
];

/** 树 → JS。变量声明收齐了再放最前面，所以走两趟：一趟收集，一趟出码。 */
export function compileBlocks(tree) {
  const names = new Map();
  const collect = (list) => {
    for (const b of list || []) {
      const d = TYPES[b.type];
      if (!d) continue;
      for (const n of (d.vars ? d.vars(b) : [])) if (n && String(n).trim()) names.set(safeName(n), String(n).trim());
      collect(b.children);
    }
  };
  collect(tree);

  const emitList = (list, depth, sink, nested) => {
    for (const b of list || []) {
      const d = TYPES[b.type];
      if (!d) { sink.push(...indent([`/* 未知积木：${b.type} */`], depth)); continue; }
      // 事件块套事件块：官方事件本来就是一层回调，嵌套没有对应写法。
      // 与其生成一份跑不了的东西，不如把理由写在代码里。
      if (nested && d.hat) { sink.push(...indent([`/* 事件块「${d.label}」只能放在顶层，已跳过 */`], depth)); continue; }
      const inner = d.body ? [] : null;
      if (d.body) emitList(b.children, depth + 1, inner, true);
      sink.push(...indent(d.emit(b, inner), depth));
    }
  };
  const body = [];
  emitList(tree || [], 0, body, false);
  const head = ["// 由积木编辑器生成：改积木会重写这一段。"];
  if (names.size) {
    head.push(...[...names.entries()].map(([k, v]) => `let ${k} = null;${v !== k ? " // " + v : ""}`));
    head.push("");
  }
  return head.concat(body).join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export function wireBlocks(E) {
  const screen = document.getElementById("blockScreen");
  if (!screen || screen.dataset.on) return;
  screen.dataset.on = "1";
  const tool = screen.querySelector(".bs-tool");
  const listEl = screen.querySelector(".bs-list");
  const codeEl = screen.querySelector(".bs-code code");
  const auto = screen.querySelector("#bsAuto");
  const FILE = "blocks.js";
  let tree = [];

  const find = (id, from = tree) => {
    for (let i = 0; i < from.length; i++) {
      if (from[i].id === id) return { list: from, i, b: from[i] };
      const hit = find(id, from[i].children);
      if (hit) return hit;
    }
    return null;
  };

  /* ---------- 出码 / 落盘 ---------- */
  const js = () => compileBlocks(tree);
  function refreshCode() { codeEl.innerHTML = highlightJS(js()) + "\n"; }
  function writeScript(toast) {
    const arr = E.state.scripts || (E.state.scripts = []);
    const src = js();
    let f = arr.find((x) => x.name === FILE);
    if (!f) { f = { name: FILE, code: "" }; arr.push(f); }
    if (f.code === src) { if (toast) E.toast(`${FILE} 已经是最新的`, true); return; }
    f.code = src;
    if (E.refreshScriptFiles) E.refreshScriptFiles();
    if (E.markDirty) E.markDirty();
    if (toast) E.toast(`已写入 ${FILE}（脚本页里可以接着手改）`);
  }
  function saveTree() {
    E.state.meta = E.state.meta || {};
    E.state.meta.blocks = JSON.parse(JSON.stringify(tree));
    if (E.markDirty) E.markDirty();
  }
  function changed() { refreshCode(); saveTree(); if (auto && auto.checked) writeScript(false); }

  /* ---------- 工具箱 ---------- */
  for (const [cat, zh] of CATS) {
    const sec = document.createElement("div");
    sec.className = "bs-cat bs-" + cat;
    const h = document.createElement("div");
    h.className = "bs-cat-h";
    h.textContent = zh;
    sec.appendChild(h);
    for (const [type, d] of Object.entries(TYPES)) {
      if (d.cat !== cat) continue;
      const chip = document.createElement("button");
      chip.className = "bs-chip";
      chip.draggable = true;
      chip.dataset.type = type;
      chip.title = (d.hat ? "事件块（放顶层）\n" : "") + "点一下加到末尾，或拖进插槽";
      const dot = document.createElement("i"); dot.className = "bs-dot";
      const span = document.createElement("span");
      span.textContent = d.label + (d.fields ? " …" : "");
      chip.append(dot, span);
      chip.onclick = () => add(type, null);
      chip.ondragstart = (ev) => ev.dataTransfer.setData("text/plain", "new:" + type);
      sec.appendChild(chip);
    }
    tool.appendChild(sec);
  }

  /* ---------- 画布 ---------- */
  function fieldInput(b, k, fd) {
    const v = b.f[k];
    const cls = "bk-f" + (fd.t === "expr" ? " expr" : "");
    if (fd.t === "sel") {
      return `<select class="${cls}" data-k="${k}">${fd.opts.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    }
    const type = fd.t === "num" ? "number" : "text";
    return `<input class="${cls}" data-k="${k}" type="${type}"${fd.t === "num" ? ' step="any"' : ""} value="${esc(v)}" placeholder="${esc(fd.d)}">`;
  }
  function blockHtml(b) {
    const d = TYPES[b.type] || {};
    const keys = Object.keys(d.fields || {});
    const first = keys[0] || null;
    const rest = keys.slice(1);
    let text = esc(d.label || "");
    if (first && d.fields[first].t !== "sel") text += " " + fieldInput(b, first, d.fields[first]);
    if (d.unit) text += " " + esc(d.unit);
    const kids = (b.children || []).map(blockHtml).join("");
    return `<div class="bk bk-${d.cat} ${d.hat ? "hat" : ""}" data-id="${b.id}">
        <div class="bk-top">
          <span class="bk-grip" draggable="true" title="按住拖动排序">⠿</span>
          <span class="bk-move"><button data-mv="-1" title="上移">▲</button><button data-mv="1" title="下移">▼</button></span>
          <span class="bk-text">${text}</span>
          <button class="bk-x" title="删掉这块">×</button>
        </div>
        ${rest.length ? `<div class="bk-more">${rest.map((k) => fieldInput(b, k, d.fields[k])).join("")}</div>` : ""}
        ${d.body ? `<div class="bk-slot${kids ? " has" : ""}" data-slot="${b.id}">${kids || '<p class="bk-empty">把块拖到这里</p>'}</div>` : ""}
      </div>`;
  }
  function render() {
    listEl.innerHTML = tree.map(blockHtml).join("");
    screen.querySelector(".bs-blank").hidden = tree.length > 0;
    changed();
  }
  function add(type, slotId, index) {
    if (!TYPES[type]) return;
    const b = mk(type);
    const target = slotId == null ? tree : ((find(slotId) || {}).b || {}).children;
    if (!Array.isArray(target)) return;
    target.push(b);
    if (index != null) { target.splice(Math.min(index, target.length - 1), 0, target.pop()); }
    render();
    const el = listEl.querySelector(`.bk[data-id="${b.id}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }
  function remove(id) { const h = find(id); if (h) { h.list.splice(h.i, 1); render(); } }
  function move(id, dir) {
    const h = find(id);
    if (!h) return;
    const to = h.i + dir;
    if (to < 0 || to >= h.list.length) return;
    h.list.splice(to, 0, h.list.splice(h.i, 1)[0]);
    render();
  }

  listEl.addEventListener("click", (ev) => {
    const top = ev.target.closest(".bk-top");
    if (!top) return;
    const id = top.closest(".bk").dataset.id;
    if (ev.target.matches(".bk-x")) return remove(id);
    const mv = ev.target.closest("[data-mv]");
    if (mv) return move(id, +mv.dataset.mv);
  });
  // 改字段不重建 DOM：重建会让正敲到一半的输入框丢焦点。只重新出码。
  listEl.addEventListener("input", (ev) => {
    const inp = ev.target.closest(".bk-f");
    if (!inp || inp.tagName === "SELECT") return;
    const b = (find(ev.target.closest(".bk").dataset.id) || {}).b;
    if (!b) return;
    const fd = (TYPES[b.type].fields || {})[inp.dataset.k];
    b.f[inp.dataset.k] = fd && fd.t === "num" ? (inp.value === "" ? fd.d : +inp.value) : inp.value;
    changed();
  });
  listEl.addEventListener("change", (ev) => {
    const sel = ev.target.closest("select.bk-f");
    if (!sel) return;
    const b = (find(ev.target.closest(".bk").dataset.id) || {}).b;
    if (b) { b.f[sel.dataset.k] = sel.value; changed(); }
  });

  /* 拖放：工具箱拖入 = 新建；画布内拖 = 移动。落点按指针在各块上半区/下半区算插入位。 */
  listEl.addEventListener("dragstart", (ev) => {
    const grip = ev.target.closest(".bk-grip");
    if (!grip) return;
    const bk = grip.closest(".bk");
    ev.dataTransfer.setData("text/plain", "move:" + bk.dataset.id);
    ev.dataTransfer.effectAllowed = "move";
  });
  const zoneOf = (ev) => ev.target.closest(".bk-slot") || ev.target.closest(".bs-list");
  listEl.addEventListener("dragover", (ev) => {
    const z = zoneOf(ev);
    if (!z) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    z.classList.add("over");
  });
  listEl.addEventListener("dragleave", (ev) => { const z = zoneOf(ev); if (z) z.classList.remove("over"); });
  listEl.addEventListener("drop", (ev) => {
    const z = zoneOf(ev);
    if (!z) return;
    ev.preventDefault();
    z.classList.remove("over");
    const data = ev.dataTransfer.getData("text/plain");
    if (!data) return;
    const [kind, arg] = data.split(":");
    const slotId = z.classList.contains("bk-slot") ? z.dataset.slot : null;
    const kids = [...z.children].filter((c) => c.classList && c.classList.contains("bk"));
    let before = null;
    for (const c of kids) { const r = c.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { before = c; break; } }
    const index = before ? kids.indexOf(before) : kids.length;
    if (kind === "new") return add(arg, slotId, index);
    const h = find(arg);
    if (!h) return;
    if (TYPES[h.b.type].hat && slotId) return E.toast("事件块只能放在顶层", true);
    h.list.splice(h.i, 1);
    const target = slotId == null ? tree : ((find(slotId) || {}).b || {}).children;
    if (!target) return render();
    target.push(h.b);
    target.splice(Math.min(index, target.length - 1), 0, target.pop());
    render();
  });

  /* ---------- 头部按钮 ---------- */
  screen.querySelector("#bsExample").onclick = () => { tree = EXAMPLE(); render(); };
  screen.querySelector("#bsClear").onclick = () => {
    if (!tree.length) return E.toast("画布已经空了", true);
    if (!confirm("清掉所有积木？（脚本里已生成的 " + FILE + " 不会被删）")) return;
    tree = []; render();
  };
  screen.querySelector("#bsWrite").onclick = () => writeScript(true);
  screen.querySelector("#bsRun").onclick = () => {
    writeScript(false);
    document.getElementById("scriptPlay")?.click();
  };
  screen.querySelector(".bs-back").onclick = () => document.querySelector('.mtab[data-menu="build"]')?.click();
  if (auto) auto.onchange = () => { if (auto.checked) writeScript(false); };
  // 预览栏的分隔条得真能拖：一个按下去没反应的把手比没有更糟（它承诺了"这里可以调"）。
  const grip = screen.querySelector("#gripBlocks");
  if (grip) {
    const codeBox = screen.querySelector(".bs-code");
    const root = document.documentElement;
    const setW = (px) => root.style.setProperty("--bs-code-w", Math.round(Math.max(220, Math.min(px, innerWidth * .6))) + "px");
    let sx = 0, sw = 0, on = false;
    grip.addEventListener("pointerdown", (ev) => { on = true; sx = ev.clientX; sw = codeBox.getBoundingClientRect().width; grip.setPointerCapture(ev.pointerId); });
    grip.addEventListener("pointermove", (ev) => { if (on) setW(sw - (ev.clientX - sx)); });
    grip.addEventListener("pointerup", () => { on = false; });
    grip.addEventListener("dblclick", () => { root.style.removeProperty("--bs-code-w"); try { localStorage.removeItem("ly_bsw"); } catch {} });
    grip.addEventListener("keydown", (ev) => {
      const cur = parseFloat(getComputedStyle(root).getPropertyValue("--bs-code-w")) || swDefault();
      if (ev.key === "ArrowLeft") { ev.preventDefault(); setW(cur + 20); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); setW(cur - 20); }
    });
    const swDefault = () => 340;
    try { const w = +localStorage.getItem("ly_bsw"); if (w > 200) setW(w); } catch {}
    grip.addEventListener("pointerup", () => { try { localStorage.setItem("ly_bsw", getComputedStyle(root).getPropertyValue("--bs-code-w") || ""); } catch {} });
  }
  screen.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); writeScript(true); }
  });

  screen.__open = () => {
    const m = (E.state.meta || {}).blocks;
    if (Array.isArray(m) && m.length && !tree.length) tree = JSON.parse(JSON.stringify(m));
    render();
  };
  refreshCode();
}
