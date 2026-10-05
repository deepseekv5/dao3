// complete.js — 脚本编辑器：打出字母就弹候选列表，方向键选、Enter/Tab 落、Esc 关。
//
// 候选一律从 public/data/api-spec.json 现取（`npm run build:api-ref` 从官方 d.ts 解析）。
// 这里手抄一份名单的话，下一次审计之后它会静默过期，症状是"补出来的成员跑起来 undefined"
// ——比没有补全更难查，所以宁可让弹窗依赖一个 JSON。
//
// 只做"名字"这一层，不做类型推导：`const e = world.getEntity("x")` 之后 `e.` 补不出来。
// 要补那一层得引语言服务，而本工程运行时零第三方依赖（和不用 Monaco 是同一个理由）。
//
// 定位靠算术，不靠测量：行高 20px、上内边距 12px、左内边距 14px 由 editor.css 里
// `.code-editor pre,#scriptCode` 那一条定死（12.5px × 1.6 = 20），跟 script-ide.js 的
// 诊断行、当前行高亮共用同一套数——三处错位说明其中一处改了名。
import { GameRuntime } from "./game.js";

const LH = 20, PAD_T = 12, PAD_L = 14, MAX = 40;

let spec = null, loading = null;
function load() {
  if (spec) return Promise.resolve(spec);
  if (!loading) {
    loading = fetch("/data/api-spec.json").then((r) => r.json())
      .then((s) => { spec = s; return s; })
      .catch(() => { spec = { classes: {}, globals: [] }; loading = null; return spec; });
  }
  return loading;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function wireComplete(E, ta) {
  const host = ta && ta.parentElement;
  if (!host || host.dataset.acOn) return;
  host.dataset.acOn = "1";
  const screen = document.getElementById("scriptScreen");

  const pop = document.createElement("div");
  pop.className = "ac-pop";
  pop.innerHTML = '<div class="ac-list"></div><div class="ac-doc"></div>';
  host.appendChild(pop);
  const listEl = pop.querySelector(".ac-list");
  const docEl = pop.querySelector(".ac-doc");

  let items = [], idx = 0, ctx = null, cw = 0, hush = false, composing = false;
  // 行高从渲染出来的那一行量，不照抄 CSS：CSS 改了字号，弹窗的滚动位置跟着改，
  // 而不是选到第 8 条时列表悄悄不滚。
  let rowH = 22;

  /* ---------- 这一份脚本是哪一端（与运行时同一个判据）---------- */
  const entry = () => (E.__scriptIdx == null ? null : (E.state.scripts || [])[E.__scriptIdx]);
  const clientSide = () => GameRuntime.isClientScript((entry() || {}).name || "index.js", entry());
  const allow = () => new Set(clientSide() ? GameRuntime.CLIENT_GLOBALS : GameRuntime.SERVER_GLOBALS);

  /* ---------- 候选 ---------- */
  /** 一个名字点下去之后能出什么：全局对象看它的类（world → GameWorld），
   *  内联对象（resources、console）用规格里抄好的成员，类名走静态成员（Vec3.create）。 */
  function memberMap(name, side, allowed) {
    const g = (spec.globals || []).find((x) => x.n === name && (x.side === "client") === side);
    if (g) return (g.t && spec.classes[g.t] && spec.classes[g.t].m) || g.m;
    if (allowed.has(name) && spec.classes[name]) return spec.classes[name].m;
    return null;
  }
  /** 能不能直接调用（决定落要不要补一对括号）。
   *  官方事件通道是"属性但是可调用"（onPlayerJoin: GameEventChannel<…>），
   *  所以不能只看有没有 : ( ——那样 world.onPlayerJoin 会补成属性，用户还得自己敲括号。 */
  const callable = (sig) => /^\w+\s*\(/.test(sig) || /:\s*\(/.test(sig) || /:\s*GameEventChannel\b/.test(sig);
  function toItems(mm) {
    const out = [];
    for (const [label, m] of Object.entries(mm || {})) {
      if (m && m.i === 0) continue;   // 官方有、本地没实现的一律不给（与 ai-spec.js 的禁用清单同一口径）
      const sig = (m && m.s) || "";
      const fn = callable(sig);
      out.push({ label, sig, doc: (m && m.d) || "", fn, kind: fn ? "方法" : "属性" });
    }
    return out;
  }
  function globalItems(allowed, side) {
    const out = [], seen = new Set();
    for (const g of spec.globals || []) {
      if ((g.side === "client") !== side || !allowed.has(g.n) || seen.has(g.n)) continue;
      seen.add(g.n);
      out.push({ label: g.n, sig: g.fn ? g.sig : "", doc: g.d || "", fn: !!g.fn, kind: g.fn ? "函数" : "对象" });
    }
    // 类名与枚举能直接写（GameVector3、UiBox、GameButtonType…），但它们不是 declare const，
    // 所以规格里没有它们的全局条目。运行时的注入名单里有，就按名单补进来。
    for (const [cls, d] of Object.entries(spec.classes || {})) {
      if (!allowed.has(cls) || seen.has(cls)) continue;
      seen.add(cls);
      out.push({ label: cls, doc: d.d || "", fn: false, kind: d.kind === "enum" ? "枚举" : "类" });
    }
    for (const n of allowed) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({ label: n, doc: "", fn: false, kind: "内建" });   // Math / JSON / parseInt 这些沙箱转发的内建
    }
    return out;
  }
  function narrow(list, prefix) {
    if (!prefix) return list.slice(0, MAX);
    const p = prefix.toLowerCase();
    const rank = (n) => (n.startsWith(prefix) ? 0 : n.toLowerCase().startsWith(p) ? 1 : n.includes(p) ? 2 : -1);
    return list.map((it) => ({ it, r: rank(it.label) })).filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.it.label.length - b.it.label.length || (a.it.label < b.it.label ? -1 : 1))
      .slice(0, MAX).map((x) => x.it);
  }

  /** 光标左边是什么：`world.` 是点上下文，`woo` 是裸前缀。
   *  两个都拿不到就返回 null（选区非空、行是注释、点在括号后面等等）。 */
  function context() {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return null;
    const before = ta.value.slice(0, pos);
    const line = before.slice(before.lastIndexOf("\n") + 1);
    if (/^\s*(?:\/\/|\*)/.test(line)) return null;   // 注释里打字不弹
    const d = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/.exec(before);
    if (d) return { recv: d[1], prefix: d[2] || "", start: pos - (d[2] || "").length };
    const b = /([A-Za-z_$][\w$]*)$/.exec(before);
    if (b && before[b.index - 1] !== ".") return { recv: null, prefix: b[1], start: pos - b[1].length };
    return { recv: null, prefix: "", start: pos };   // `world.` 刚打完点：列全部成员
  }

  /* ---------- 渲染与定位 ---------- */
  function charWidth() {
    if (cw) return cw;
    const cs = getComputedStyle(ta);
    const s = document.createElement("span");
    s.style.cssText = "position:absolute;left:-9999px;top:0;white-space:pre";
    // 长写而不是一条 font 简写：计算样式里的 font 简写在某些组合下会取空，
    // 取空就等于量到 0，症状是弹窗永远贴在左边缘。
    s.style.fontFamily = cs.fontFamily;
    s.style.fontSize = cs.fontSize;
    s.style.fontWeight = cs.fontWeight;
    s.style.fontStyle = cs.fontStyle;
    s.textContent = "0".repeat(40);
    document.body.appendChild(s);
    cw = s.getBoundingClientRect().width / 40;
    s.remove();
    return cw;
  }
  // 脚注只放"行里放不下的一样东西"：完整签名。没有签名（对象、内建）就整条不渲染，
  // 否则列表只有一条候选时，脚注和那一行字面重复。
  const docLine = (it) => (it && it.sig ? `<b>${esc(it.label)}</b><em>${esc(it.sig)}</em>` : "");
  function keepRowVisible() {
    const top = idx * rowH, view = listEl.clientHeight;
    if (top < listEl.scrollTop) listEl.scrollTop = top;
    else if (top + rowH > listEl.scrollTop + view) listEl.scrollTop = top + rowH - view;
  }
  function render() {
    listEl.innerHTML = items.map((it, i) => `<button type="button" class="ac-it${i === idx ? " on" : ""}" data-i="${i}">`
      + `<span class="ac-k">${it.kind}</span><b>${esc(it.label)}</b>`
      + `<span class="ac-d">${esc(it.doc || it.sig || "")}</span></button>`).join("");
    if (listEl.firstElementChild) rowH = listEl.firstElementChild.offsetHeight;
    docEl.innerHTML = docLine(items[idx]);
    keepRowVisible();
  }
  function place() {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const line = before.split("\n").length - 1;          // 0 基
    const col = pos - (before.lastIndexOf("\n") + 1);
    const w = pop.offsetWidth || 240, h = pop.offsetHeight || 100;
    let x = PAD_L + col * charWidth() - ta.scrollLeft;
    let y = PAD_T + (line + 1) * LH - ta.scrollTop;      // 贴在当前行下面
    if (x + w > ta.clientWidth) x = Math.max(2, ta.clientWidth - w - 2);
    if (y + h > ta.clientHeight) {
      const up = PAD_T + line * LH - h - ta.scrollTop;   // 底下放不下就翻到上一行上面
      y = up >= 0 ? up : Math.max(0, ta.clientHeight - h - 2);
    }
    pop.style.left = Math.max(0, x) + "px";
    pop.style.top = Math.max(0, y) + "px";
  }
  const isOpen = () => pop.classList.contains("show");
  // 关掉要连列表一起清：留着上一次的行，屏幕上是个"看不见的弹窗"，
  // 而任何按 .ac-it 数候选的人（包括测试）数到的都是过期数据。
  function close() { pop.classList.remove("show"); listEl.innerHTML = ""; docEl.innerHTML = ""; ctx = null; items = []; }
  function open(force) {
    if (!spec) { load().then(() => { if (document.activeElement === ta) open(force); }); return; }
    const c = context();
    if (!c) return close();
    if (!c.recv && !c.prefix && !force) return close();  // 裸前缀打不出一个字就不弹
    const allowed = allow();
    const base = c.recv ? toItems(memberMap(c.recv, clientSide(), allowed)) : globalItems(allowed, clientSide());
    if (!base || !base.length) return close();
    const next = narrow(base, c.prefix);
    if (!next.length) return close();
    // 接着打字时保住当前选中项：`wor` 选中 world 后再敲一个 l，列表收窄到只剩 world，
    // 但选中项要是跳回第一条，Enter 就变成选别的了
    const keep = isOpen() && ctx && ctx.recv === c.recv ? ctx.label : null;
    items = next; ctx = c;
    const k = keep ? items.findIndex((x) => x.label === keep) : -1;
    idx = k >= 0 ? k : 0;
    ctx.label = items[idx].label;
    render(); place(); pop.classList.add("show");
  }

  /* ---------- 落定 ---------- */
  function applyText(from, to, text, caret) {
    const v = ta.value;
    ta.value = v.slice(0, from) + text + v.slice(to);
    ta.selectionStart = ta.selectionEnd = caret;
    ta.dispatchEvent(new Event("input"));   // 走 features.js 那条链路：写回文件、重画高亮、标脏
  }
  function accept(i) {
    const it = items[i == null ? idx : i];
    if (!it || !ctx) return;
    hush = true;
    const after = ta.value.slice(ta.selectionEnd);
    // 函数/方法带上括号，光标停在括号里；后面已经有 ( 或 ) 的话不加，免得补出空括号或多余的收尾
    const parens = it.fn && !/^\s*[()]/.test(after);
    const text = it.label + (parens ? "()" : "");
    const start = ctx.start;
    applyText(start, ta.selectionEnd, text, start + it.label.length + (parens ? 1 : 0));
    ta.focus();
    close();
  }

  /* ---------- 事件 ---------- */
  // 挂在 #scriptScreen 的捕获阶段：同一元素上的监听按注册顺序跑，而祖先的捕获阶段
  // 一定在目标之前。Tab/Enter 在 features.js 的 wireCodeEditing 里有别的用途（缩进、
  // 换行补缩进），弹窗开着的时候必须让它们先被这里吃掉。
  screen.addEventListener("keydown", (ev) => {
    if (ev.isComposing || composing) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.code === "Space") { ev.preventDefault(); load(); open(true); return; }
    if (!isOpen() || !items.length) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); ev.stopPropagation(); idx = (idx + 1) % items.length; ctx.label = items[idx].label; render(); return; }
    if (ev.key === "ArrowUp") { ev.preventDefault(); ev.stopPropagation(); idx = (idx - 1 + items.length) % items.length; ctx.label = items[idx].label; render(); return; }
    if (ev.key === "Enter" && !ev.shiftKey && !mod && !ev.altKey) { ev.preventDefault(); ev.stopPropagation(); accept(); return; }
    if (ev.key === "Tab" && !ev.shiftKey && !mod && !ev.altKey) { ev.preventDefault(); ev.stopPropagation(); accept(); return; }
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    // 光标一移开，前缀就不作数了
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(ev.key)) close();
  }, true);

  ta.addEventListener("input", () => {
    if (hush) { hush = false; return; }
    if (composing || ta.selectionStart !== ta.selectionEnd) return close();
    load();
    open(false);
  });
  ta.addEventListener("compositionstart", () => { composing = true; close(); });
  ta.addEventListener("compositionend", () => { composing = false; });
  ta.addEventListener("scroll", () => { if (isOpen()) place(); });
  ta.addEventListener("click", () => { if (isOpen()) close(); });
  ta.addEventListener("blur", () => close());

  listEl.addEventListener("mousedown", (ev) => {
    const b = ev.target.closest(".ac-it");
    if (!b) return;
    ev.preventDefault();   // 不能让 textarea 失焦：焦点一走光标就没了，插入位置会错
    accept(+b.dataset.i);
  });
  listEl.addEventListener("mousemove", (ev) => {
    const b = ev.target.closest(".ac-it");
    if (!b) return;
    const i = +b.dataset.i;
    if (i === idx) return;
    idx = i;
    for (const n of listEl.children) n.classList.toggle("on", n === b);
    if (ctx) ctx.label = items[i].label;
    docEl.innerHTML = docLine(items[i]);
  });

  // 焦点在文件列表或属性卡时上面那条捕获监听不会跑（keydown 的目标不是 textarea 那条链路），
  // 但那种情况下弹窗早就被 blur 收掉了，这里只兜"鼠标点到弹窗外面但焦点还在编辑器"。
  screen.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && isOpen()) close(); });

  load();
}
