// code-edit.js — 脚本编辑框里的"打字手感"：查找替换、行操作、括号配对、底部读数。
//
// 为什么值得单独一层：脚本页此前只有"高亮 + 行号 + 补全 + 诊断"。
// 但一个人改脚本时手的动作是**查找、跳到下一个、整块上下挪、删掉这一行、补全括号**，
// 这些在 textarea 上要么没有、要么得用浏览器自带的（Ctrl+F 会去搜整个页面，
// 包括侧栏和面板的文字，还关不掉）。缺了它们，"能看代码"和"能改代码"是两回事。
//
// 仍然不换编辑器内核：本工程运行时零第三方依赖，Monaco 是几兆的构建产物。
// textarea 装不下多光标，所以 Ctrl+D 的语义是"把选区扩到下一个相同词"（连成一片），
// 不是 VSCode 那样每个匹配一个光标 —— 这点在提示里写明白，不假装一样。
import { applyEdit, blockRange } from "./features.js";
import { metrics, posOf, textAdvance } from "./code-metrics.js";

const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set(Object.values(PAIRS));
const WORD_RE = /[\w$]/;
const MAX_HITS = 3000;           // 命中框画到几千个就开始吃 DOM，再多只拖慢打字

/** 把查询按当前选项包成匹配式。整词用 \b 夹，但 \b 对中文无效，
 *  所以只在两端是 ASCII 词字符时才加——否则搜「玩家」会被自己挡掉。 */
function toRe(q, useCase, useWord) {
  const body = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = useWord && /^\w/.test(q) ? "\\b" : "";
  const b = useWord && /\w$/.test(q) ? "\\b" : "";
  return new RegExp(a + body + b, "g" + (useCase ? "" : "i"));
}

export function wireCodeEdit(E, ta) {
  const host = ta.closest(".code-editor");
  if (!host || host.dataset.editOn) return;
  host.dataset.editOn = "1";

  /* ================= 查找 / 替换 ================= */
  const box = document.createElement("div");
  box.className = "fd-box";
  box.id = "fdBox";
  box.innerHTML = `<div class="fd-row">
      <input id="fdQ" placeholder="查找" spellcheck="false">
      <button type="button" id="fdCase" title="区分大小写">Aa</button>
      <button type="button" id="fdWord" title="全词匹配">▣</button>
      <span class="fd-n" id="fdN"></span>
      <button type="button" id="fdPrev" title="上一个（Shift+Enter）">↑</button>
      <button type="button" id="fdNext" title="下一个（Enter / F3）">↓</button>
      <button type="button" id="fdClose" title="关闭（Esc）">×</button>
    </div>
    <div class="fd-row fd-rep">
      <input id="fdR" placeholder="替换为" spellcheck="false">
      <button type="button" id="fdOne" title="只替换当前这一处">替换</button>
      <button type="button" id="fdAll" title="替换掉全部命中">全部替换</button>
    </div>`;
  host.appendChild(box);
  const qI = box.querySelector("#fdQ"), rI = box.querySelector("#fdR"), nI = box.querySelector("#fdN");
  let hits = [], at = -1, useCase = false, useWord = false;

  const pre = () => document.getElementById("scriptHi");
  const qLen = () => qI.value.length;

  /** 命中框画在高亮层里，于是横向滚动、行号槽、字体全都自动跟着走。
   *  坐标一律来自 code-metrics 量出来的行高/内边距/字宽，不在这里写死。 */
  function paintMarks() {
    const el = pre();
    if (!el) return;
    el.querySelectorAll(".fd-hit").forEach((n) => n.remove());
    if (!hits.length) return;
    const m = metrics(ta);
    const lines = ta.value.split("\n");
    let acc = 0, ln = 0;
    for (let i = 0; i < hits.length && i < MAX_HITS; i++) {
      const h = hits[i];
      while (ln < lines.length - 1 && acc + lines[ln].length + 1 <= h) { acc += lines[ln].length + 1; ln++; }
      const mark = document.createElement("i");
      mark.className = "fd-hit" + (i === at ? " on" : "");
      mark.style.top = (m.padT + ln * m.lh) + "px";
      mark.style.left = (m.padL + textAdvance(m, (lines[ln] || "").slice(0, h - acc))) + "px";
      mark.style.width = Math.max(1, qLen()) * m.charW + "px";
      mark.style.height = m.lh + "px";
      el.appendChild(mark);
    }
  }
  function report() {
    nI.textContent = !qLen() ? "" : hits.length ? `${at + 1}/${hits.length}` : "无结果";
    nI.classList.toggle("none", !!qLen() && !hits.length);
  }
  function scan() {
    hits = [];
    if (!qLen()) { at = -1; paintMarks(); report(); return; }
    const re = toRe(qI.value, useCase, useWord);
    let mm;
    while ((mm = re.exec(ta.value)) && hits.length < MAX_HITS) {
      hits.push(mm.index);
      if (!mm[0].length) re.lastIndex++;            // 空匹配会原地不动，不推就死循环
    }
    at = at >= hits.length ? 0 : at;
    if (at < 0) at = hits.length ? 0 : -1;
    paintMarks();
    report();
  }
  /** 只挪选区和滚动，不 focus：查找框要留在焦点上，人还在打字。 */
  function show(i) {
    if (!hits.length) return;
    at = (i + hits.length) % hits.length;
    const pos = hits[at];
    ta.setSelectionRange(pos, pos + qLen());
    const m = metrics(ta);
    ta.scrollTop = Math.max(0, posOf(ta.value, pos).line * m.lh - ta.clientHeight / 2);
    ta.dispatchEvent(new Event("scroll"));
    paintMarks();
    report();
  }
  const next = () => show(at + 1);
  const prev = () => show(at - 1);

  function open(withRe) {
    box.classList.add("on");
    box.dataset.re = withRe ? "1" : "";
    // 选中的文字直接当查询：查找框十有八九是为了再找一遍眼前这段。
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && sel.length < 200 && !sel.includes("\n")) qI.value = sel;
    at = -1;
    scan();
    if (hits.length) show(at);
    (withRe ? rI : qI).select();
  }
  /** 关掉查找框要把命中框一起收掉：留着它们，屏幕上就是"没在搜任何东西却有十几处高亮"，
   *  而这些人接下来多半要改代码，被别人的旧搜索结果干扰是最讨厌的。 */
  function close() {
    box.classList.remove("on");
    hits = []; at = -1;
    paintMarks(); report();
    ta.focus();
  }

  qI.oninput = () => { at = -1; scan(); if (hits.length) show(0); };
  qI.onkeydown = (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); ev.shiftKey ? prev() : next(); return; }
    if (ev.key === "Escape") { ev.preventDefault(); close(); }
  };
  rI.onkeydown = (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); replaceOne(); }
    if (ev.key === "Escape") { ev.preventDefault(); close(); }
  };
  box.querySelector("#fdNext").onclick = next;
  box.querySelector("#fdPrev").onclick = prev;
  box.querySelector("#fdClose").onclick = close;
  for (const [id, key] of [["#fdCase", "case"], ["#fdWord", "word"]]) {
    const b = box.querySelector(id);
    b.onclick = () => {
      if (key === "case") useCase = !useCase; else useWord = !useWord;
      b.classList.toggle("on", key === "case" ? useCase : useWord);
      at = -1; scan(); if (hits.length) show(0);
    };
  }
  function replaceOne() {
    if (!hits.length || at < 0) return;
    const s = hits[at], e = s + qLen();
    applyEdit(ta, ta.value.slice(0, s) + rI.value + ta.value.slice(e), s + rI.value.length);
    scan();
    if (hits.length) show(Math.min(at, hits.length - 1));
  }
  function replaceAll() {
    if (!hits.length) return;
    const n = hits.length;
    applyEdit(ta, ta.value.replace(toRe(qI.value, useCase, useWord), () => rI.value), 0);
    E.toast(`已替换 ${n} 处`);
    at = -1; scan(); if (hits.length) show(0);
  }
  box.querySelector("#fdOne").onclick = replaceOne;
  box.querySelector("#fdAll").onclick = replaceAll;

  /* ================= 行操作 ================= */
  /** 选区盖到的整行范围（行号 0 基，含头含尾）。 */
  function rowRange() {
    const v = ta.value;
    const { first, last } = blockRange(ta);
    return { from: v.slice(0, first).split("\n").length - 1, to: v.slice(0, last).split("\n").length - 1 };
  }
  const offsetOf = (lines, n) => lines.slice(0, n).reduce((a, s) => a + s.length + 1, 0);
  function moveLines(dir) {
    const lines = ta.value.split("\n");
    const { from, to } = rowRange();
    if (dir < 0 ? from === 0 : to >= lines.length - 1) return;   // 顶到头就停，别把行甩出文件
    const block = lines.splice(from, to - from + 1);
    const put = dir < 0 ? from - 1 : from + 1;
    lines.splice(put, 0, ...block);
    const start = offsetOf(lines, put);
    applyEdit(ta, lines.join("\n"), start, start + block.join("\n").length);
  }
  function dupLines() {
    const lines = ta.value.split("\n");
    const { from, to } = rowRange();
    const block = lines.slice(from, to + 1);
    lines.splice(to + 1, 0, ...block);
    const start = offsetOf(lines, to + 1);
    applyEdit(ta, lines.join("\n"), start, start + block.join("\n").length);
  }
  function delLines() {
    const lines = ta.value.split("\n");
    const { from, to } = rowRange();
    lines.splice(from, to - from + 1);
    const n = Math.min(from, lines.length - 1);
    applyEdit(ta, lines.join("\n"), lines.length === 1 && !lines[0] ? 0 : offsetOf(lines, n));
  }
  /** Ctrl+D：没选东西先选中光标下那个词，再按就把选区扩到下一个相同词。 */
  function selectNext() {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const word = v.slice(s, e);
    if (!word) {
      let a = s, b = s;
      while (a > 0 && WORD_RE.test(v[a - 1])) a--;
      while (b < v.length && WORD_RE.test(v[b])) b++;
      if (a === b) return;
      ta.setSelectionRange(a, b);
      paintStatus();
      return;
    }
    let i = v.indexOf(word, e);
    if (i < 0) i = v.indexOf(word);                 // 到底了从头找，和查找框一样环绕
    if (i < 0) return E.toast(`没有下一处「${word}」`, true);
    ta.setSelectionRange(s, i + word.length);
    paintStatus();
  }

  /* ================= 括号与引号配对 ================= */
  function onKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (PAIRS[k]) {
      const close = PAIRS[k], quote = k === '"' || k === "'" || k === "`";
      // 撇号不该被当成开引号：注释里 don't / it's 天天有
      if (quote && WORD_RE.test(v[s - 1] || "")) return;
      const after = v[s] || "";
      // 有选区时"后面是字母"正是我们要包住它，不是拦自己的理由
      if (s === e && after && WORD_RE.test(after)) return;    // 紧跟着标识符：这是在改词，不是配对
      ev.preventDefault();
      if (s !== e) applyEdit(ta, v.slice(0, s) + k + v.slice(s, e) + close + v.slice(e), s + 1, e + 1);
      else applyEdit(ta, v.slice(0, s) + k + close + v.slice(e), s + 1);
      return;
    }
    if (CLOSERS.has(k) && s === e && v[s] === k) {
      ev.preventDefault();                           // 右半边已经在，越过去而不是插第二个
      ta.setSelectionRange(s + 1, s + 1);
      return;
    }
    if (k === "Backspace" && s === e && s > 0 && CLOSERS.has(v[s]) && PAIRS[v[s - 1]] === v[s]) {
      ev.preventDefault();                           // 空对一起删，不会留下半个
      applyEdit(ta, v.slice(0, s - 1) + v.slice(s + 1), s - 1);
    }
  }

  /* ================= 编辑器底部读数 ================= */
  const bar = document.getElementById("codeStatus");
  function paintStatus() {
    if (!bar) return;
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const p = posOf(v, s), sel = e > s ? v.slice(s, e) : "";
    const ind = (v.slice(v.lastIndexOf("\n", s - 1) + 1, s).match(/^[ \t]*/) || [""])[0];
    bar.textContent = "";
    const add = (t, title) => {
      const sp = document.createElement("span");
      sp.textContent = t;
      if (title) sp.title = title;
      bar.appendChild(sp);
    };
    add(`行 ${p.line + 1}，列 ${p.col + 1}`);
    if (sel) add(`已选择 ${sel.length} 个字符${sel.includes("\n") ? `（${sel.split("\n").length} 行）` : ""}`);
    add(/^[ ]*$/.test(ind) ? `空格: ${ind.length}` : "制表符缩进", "当前行的缩进");
    add("UTF-8");
    add("JavaScript", "官方 GameAPI 的 JavaScript 脚本");
  }

  /* ================= 装饰层：缩进引导线 + 括号配对高亮 =================
     这两样是"一眼是不是 IDE"的分水岭，画法是覆盖而不是改文本：
     坐标一律来自 code-metrics 量出来的行高/内边距/字宽，中文行也不会跑偏。
     高亮层每次被重画（输入、切文件）都要补一次，所以 E.renderCode 也包了一层。 */
  function lineOfIndex(v, i) { const s = v.lastIndexOf("\n", i - 1); return { line: v.slice(0, s + 1).split("\n").length - 1, col: i - s - 1 }; }
  function paintGuides() {
    const el = pre();
    if (!el) return;
    el.querySelectorAll(".ig").forEach((n) => n.remove());
    const m = metrics(ta);
    const lines = ta.value.split("\n");
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length && i < 1500; i++) {
      const s = lines[i];
      if (!s) continue;
      let n = 0;
      while (n < s.length && (s[n] === " " || s[n] === "\t")) n++;
      const cols = s.slice(0, n).replace(/\t/g, "  ").length;      // tab 也按两级算
      const lvl = Math.floor(cols / 2);
      if (!lvl) continue;                                          // 顶格行没有引导线
      const d = document.createElement("i");
      d.className = "ig";
      d.style.top = (m.padT + i * m.lh) + "px";
      d.style.left = m.padL + "px";
      d.style.width = (lvl * 2 * m.charW) + "px";
      d.style.height = m.lh + "px";
      d.style.setProperty("--ig-step", (2 * m.charW) + "px");
      frag.appendChild(d);
    }
    el.appendChild(frag);
  }
  /** 从 i 出发找配对的括号：一层层数着走。
   *  开号往后数、闭号往前数，两种情况都是"遇到同类加、遇到对头减，减到 0 就是它"。
   *  上一版把闭号那支写反了（只加不减），症状是光标停在 } 上时什么都不亮——
   *  而那恰好是最常见的那一半。 */
  function matchBracket(v, i) {
    const ch = v[i];
    const isOpen = PAIRS[ch] !== undefined;
    if (!isOpen && !CLOSERS.has(ch)) return -1;
    const dir = isOpen ? 1 : -1;
    const mate = isOpen ? PAIRS[ch] : Object.keys(PAIRS).find((k) => PAIRS[k] === ch);
    if (!mate) return -1;
    let depth = 0;
    for (let p = i; p >= 0 && p < v.length; p += dir) {
      if (inStringOrComment(v, p)) continue;
      const c = v[p];
      if (c === ch) depth++;
      else if (c === mate) { depth--; if (depth === 0) return p; }
    }
    return -1;
  }
  // 粗略跳过字符串与注释：数该行之前出现的未转义引号与 // 位置
  function inStringOrComment(v, i) {
    const lineStart = v.lastIndexOf("\n", i - 1) + 1;
    const seg = v.slice(lineStart, i);
    const cmt = seg.indexOf("//");
    if (cmt >= 0 && !/["'`]/.test(seg.slice(cmt))) return true;
    let q = -1;
    for (let k = 0; k < seg.length; k++) {
      const ch = seg[k];
      if (ch === "\\") { k++; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { if (q < 0) q = k; else if (seg[q] === ch) q = -1; }
    }
    return q >= 0;
  }
  function paintPair() {
    const el = pre();
    if (!el) return;
    el.querySelectorAll(".bp-match").forEach((n) => n.remove());
    if (ta.selectionEnd !== ta.selectionStart) return;
    const v = ta.value, s = ta.selectionStart;
    let idx = -1;
    if (PAIRS[v[s]] !== undefined || CLOSERS.has(v[s])) idx = s;
    else if (PAIRS[v[s - 1]] !== undefined || CLOSERS.has(v[s - 1])) idx = s - 1;
    if (idx < 0) return;
    const other = matchBracket(v, idx);
    if (other < 0 || other === idx) return;
    const m = metrics(ta);
    const lines = v.split("\n");
    for (const p of [idx, other]) {
      const { line, col } = lineOfIndex(v, p);
      const d = document.createElement("i");
      d.className = "bp-match";
      d.style.top = (m.padT + line * m.lh) + "px";
      d.style.left = (m.padL + textAdvance(m, (lines[line] || "").slice(0, col))) + "px";
      d.style.width = m.charW + "px";
      d.style.height = m.lh + "px";
      el.appendChild(d);
    }
  }
  const decorate = () => { paintGuides(); paintPair(); };
  // 高亮层是 innerHTML 整个重写的，装饰会被抹掉；包一层钩子而不是在 features 里加调用，
  // 免得"谁重画谁负责补"这件事有两份清单。
  const rc = E.renderCode;
  E.renderCode = () => { if (rc) rc(); decorate(); };

  /* ================= 右键菜单 ================= */
  ta.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const hasSel = ta.selectionEnd > ta.selectionStart;
    ideMenu(E, [
      { label: "剪切", keys: "Ctrl+X", disabled: !hasSel, run: async () => { await copySel(); cutSel(); } },
      { label: "复制", keys: "Ctrl+C", disabled: !hasSel, run: () => copySel() },
      { label: "粘贴", keys: "Ctrl+V", run: () => pasteAt() },
      { sep: true },
      { label: "全选", keys: "Ctrl+A", run: () => { ta.focus(); ta.setSelectionRange(0, ta.value.length); paintStatus(); } },
      { label: "查找", keys: "Ctrl+F", run: () => open(false) },
      { label: "查找与替换", keys: "Ctrl+H", run: () => open(true) },
      { sep: true },
      { label: "注释 / 取消注释这一行", keys: "Ctrl+/", run: () => { ta.focus(); toggleCommentHere(); } },
      { label: "跳到下一个问题", keys: "F8", run: () => E.ideStep?.(1) },
      { label: "运行脚本", keys: "Ctrl+Enter", run: () => document.getElementById("scriptRun")?.click() },
    ], ev.clientX, ev.clientY);
  });
  // 菜单项要用到的编辑动作：剪贴板走 navigator.clipboard，没权限就说清为什么不行
  const cutSel = async () => { const { first, last } = blockRange(ta); applyEdit(ta, ta.value.slice(0, first) + ta.value.slice(last), first); };
  const copySel = async () => {
    const text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch { E.toast("浏览器不让网页写剪贴板，选区还在：按 Ctrl+C 就行", true); }
  };
  const pasteAt = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const s = ta.selectionStart, e = ta.selectionEnd;
      applyEdit(ta, ta.value.slice(0, s) + text + ta.value.slice(e), s + text.length);
    } catch { E.toast("浏览器不给网页读剪贴板（这是安全边界，不是坏了）：按 Ctrl+V", true); }
  };
  const toggleCommentHere = () => {
    const { first, last } = blockRange(ta);
    const v = ta.value;
    const head = v.slice(first, last);
    const all = head.split("\n").every((s) => /^\s*\/\//.test(s) || !s.trim());
    const out = head.split("\n").map((s) => (all ? s.replace(/^(\s*)\/\/ ?/, "$1") : (s.trim() ? s.replace(/^(\s*)/, "$1// ") : s))).join("\n");
    applyEdit(ta, v.slice(0, first) + out + v.slice(last), first, first + out.length);
  };

  /* ================= 接线 ================= */
  ta.addEventListener("keydown", onKey);
  ta.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey, k = (ev.key || "").toLowerCase();
    if (mod && k === "f") { ev.preventDefault(); open(false); return; }
    if (mod && k === "h") { ev.preventDefault(); open(true); return; }
    if (ev.key === "F3") {
      ev.preventDefault();
      if (!box.classList.contains("on")) open(false);
      else ev.shiftKey ? prev() : next();
      return;
    }
    if (ev.key === "Escape" && box.classList.contains("on")) { ev.preventDefault(); close(); return; }
    if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault(); moveLines(ev.key === "ArrowDown" ? 1 : -1); return;
    }
    if (mod && ev.shiftKey && k === "k") { ev.preventDefault(); delLines(); return; }
    if (mod && ev.shiftKey && k === "d") { ev.preventDefault(); dupLines(); return; }
    if (mod && !ev.shiftKey && k === "d") { ev.preventDefault(); selectNext(); return; }
    if (mod && !ev.shiftKey && k === "l") {
      ev.preventDefault();
      const { first, last } = blockRange(ta);
      ta.setSelectionRange(first, last);
      paintStatus();
    }
  });
  ta.addEventListener("input", () => {
    paintStatus();
    decorate();
    if (box.classList.contains("on")) scan();
  });
  ta.addEventListener("keyup", () => { paintStatus(); paintPair(); });
  ta.addEventListener("click", () => setTimeout(() => { paintStatus(); paintPair(); }, 0));
  paintStatus();
  decorate();
  // 命令面板与别处要能复用同一个查找框，不在那边再搭一份输入框。
  E.codeFind = (withRe) => open(!!withRe);
  E.codeFindOpen = () => box.classList.contains("on");
  E.ideDecorate = decorate;
}

/* ================= 通用右键菜单（标签页、资源管理器共用这一份） =================
   为什么放这层：菜单本身没有 IDE 语义，谁都能要一份；两处各写一份的话，
   "关一个另一个还挂着"这类毛病会只出现在其中一边。 */
let menuEl = null;
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function closeIdeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", onEsc, true);
}
function outside(ev) { if (menuEl && !menuEl.contains(ev.target)) closeIdeMenu(); }
function onEsc(ev) { if (ev.key === "Escape") { ev.stopPropagation(); closeIdeMenu(); } }

/** items: {label, keys, disabled, sep, run} */
export function ideMenu(E, items, x, y) {
  closeIdeMenu();
  const el = document.createElement("div");
  el.className = "ide-menu";
  el.setAttribute("role", "menu");
  el.innerHTML = items.map((it, i) => it.sep ? '<i class="im-sep"></i>'
    : `<button role="menuitem" data-i="${i}"${it.disabled ? " disabled" : ""}><span>${escHtml(it.label)}</span>${it.keys ? `<em>${escHtml(it.keys)}</em>` : ""}</button>`).join("");
  document.body.appendChild(el);
  menuEl = el;
  // 贴着屏幕边缘时往里收：菜单被裁掉一半就等于没有
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 8)) + "px";
  el.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 8)) + "px";
  el.onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (!b || b.disabled) return;
    const it = items[+b.dataset.i];
    closeIdeMenu();
    if (it && it.run) it.run();
  };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", onEsc, true);
}
