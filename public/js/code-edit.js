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
    if (box.classList.contains("on")) scan();
  });
  ta.addEventListener("keyup", paintStatus);
  ta.addEventListener("click", () => setTimeout(paintStatus, 0));
  paintStatus();
  // 命令面板与别处要能复用同一个查找框，不在那边再搭一份输入框。
  E.codeFind = (withRe) => open(!!withRe);
  E.codeFindOpen = () => box.classList.contains("on");
}
