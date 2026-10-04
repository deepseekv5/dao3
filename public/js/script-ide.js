// script-ide.js — 把脚本页从"一个带高亮的 textarea"变成能干活的那一层。
//
// 参照的是官方 ArenaNext 那支编辑器增强脚本：它的核心不是 Monaco，而是
// 「诊断看得见 + 光标在哪就能对哪段代码下手」。这两件事我们原来都缺：
// lint.js 早就真的在跑规则，但结果只喂给 AI 规范注入，屏幕上一点痕迹没有；
// 语法错也只有沙箱跑完才在控制台冒出来，行号还要自己猜。
//
// 不换编辑器内核。本工程运行时零依赖，Monaco 是几兆的构建产物，
// 而且现有那套 textarea + <pre> 覆盖层已经能挂装饰：行高 20px、pre 上内边距 12px，
// 定位是确定的。缺的只是把诊断画上去、把动作放到手边。
import { checkSyntax } from "./ai.js";
import { lintScript, symbolsOf } from "./lint.js";
import { askAbout } from "./ai-script.js";
import { scriptChecks } from "./features.js";

const LH = 20, PAD = 12;
const SEV = { error: 0, warn: 1, info: 2 };
const MARK = { error: "●", warn: "▲", info: "○" };

export function wireScriptIde(E) {
  const screen = document.getElementById("scriptScreen");
  if (!screen || screen.dataset.ideOn) return;
  screen.dataset.ideOn = "1";

  let diags = [];
  let filter = "all";
  let cursorLine = 1;
  let timer = null;

  /* ---------- 骨架：行内动作条 + 问题面板 ---------- */
  const lens = document.createElement("div");
  lens.className = "ss-lens";
  lens.id = "ssLens";
  const head = screen.querySelector(".ss-head");
  head.after(lens);

  const consoleBox = document.getElementById("scriptConsole");
  const tabs = document.createElement("div");
  tabs.className = "ss-tabs";
  tabs.innerHTML = `<button class="ss-tab active" data-t="out">控制台</button>
    <button class="ss-tab" data-t="prob">问题<b id="ssProbN"></b></button>
    <span class="ss-spacer"></span>
    <span class="ss-dim" id="ssProbSum"></span>`;
  consoleBox.querySelector(".ss-console-head").after(tabs);
  const probBox = document.createElement("div");
  probBox.className = "ss-problems";
  probBox.id = "ssProblems";
  consoleBox.appendChild(probBox);
  const outBox = document.getElementById("scriptOut");
  // 哪一格可见交给 CSS（.ss-console[data-pane=...]），不在这里逐个 hidden：
  // 后来加的东西（比如控制台那排筛选项）不会出现在这份清单里，
  // 于是切到「问题」时它还赖在屏幕上。
  consoleBox.dataset.pane = "out";
  tabs.onclick = (ev) => {
    const b = ev.target.closest(".ss-tab");
    if (!b) return;
    for (const x of tabs.querySelectorAll(".ss-tab")) x.classList.toggle("active", x === b);
    consoleBox.dataset.pane = b.dataset.t;
    if (b.dataset.t === "prob") renderProblems();
  };

  const ta = () => document.getElementById("scriptCode");
  // 编辑中的真相在 textarea 里，不在 state.scripts 里：__scriptIdx 在用户点过文件列表
  // 之前是 null，features.js 的 input 处理那时根本不会写回任何文件。
  // 早先这里回退到 scripts[0]，于是 lint 的是另一个文件——标出来的行全是错的。
  const editingCode = () => { const t = ta(); return t ? t.value : ((cur() || {}).code || ""); };
  const cur = () => (E.__scriptIdx == null ? null : (E.state.scripts || [])[E.__scriptIdx]);

  /* ---------- 诊断 ---------- */
  function recheck() {
    const code = editingCode();
    const out = [];
    if (code.trim()) {
      const syn = checkSyntax(code);
      if (!syn.ok) {
        // 语法都没过时不跑规则检查：括号不配对会让整份代码的行号全漂，
        // 报出来的"未使用变量"既不准也把人从真正的语法错上引开。
        out.push({ line: 0, rule: "语法", msg: syn.error, sev: "error" });
      } else {
        for (const d of lintScript(code, scriptChecks(E))) out.push(d);
      }
    }
    diags = out.sort((a, b) => SEV[a.sev] - SEV[b.sev] || a.line - b.line);
    paint();
    renderLens();
    if (!probBox.hidden) renderProblems();
  }
  const scheduleRecheck = () => { clearTimeout(timer); timer = setTimeout(recheck, 350); };

  function shown() { return filter === "all" ? diags : diags.filter((d) => d.sev === filter); }

  /** 行装饰 + 行号槽标记。每次 renderCode 重画行号槽，所以要在它之后跑。 */
  function paint() {
    const hi = document.getElementById("scriptHi");
    const gutter = document.getElementById("scriptGutter");
    if (!hi || !gutter) return;
    hi.querySelectorAll(".dg-row").forEach((n) => n.remove());
    for (const d of diags) {
      if (d.line < 1) continue;   // 语法错定位不到行（见 ai.js 的注释），不画到第 1 行去冒充
      const row = document.createElement("div");
      row.className = `dg-row dg-${d.sev}`;
      row.style.top = (PAD + (d.line - 1) * LH) + "px";
      row.title = `${d.rule}：${d.msg}`;
      hi.appendChild(row);
    }
    const byLine = new Map();
    for (const d of diags) { const p = byLine.get(d.line) || []; p.push(d); byLine.set(d.line, p); }
    const lines = editingCode().split("\n").length;
    // 按 data-ln 找那一行的行号节点：找不到就跳过，宁可少画一个点也不要标错行。
    for (let ln = 1; ln <= lines; ln++) {
      const list = byLine.get(ln);
      if (!list) continue;
      const worst = list.slice().sort((a, b) => SEV[a.sev] - SEV[b.sev])[0];
      const node = gutter.querySelector(`[data-ln="${ln}"]`);
      if (!node || node.querySelector(".dg-mark")) continue;
      const m = document.createElement("i");
      m.className = `dg-mark dg-${worst.sev}`;
      m.textContent = MARK[worst.sev];
      m.title = list.map((d) => `${d.rule}：${d.msg}`).join("\n");
      node.appendChild(m);
    }
    document.getElementById("ssProbN").textContent = diags.length ? String(diags.length) : "";
    const n = (s) => diags.filter((d) => d.sev === s).length;
    document.getElementById("ssProbSum").textContent =
      diags.length ? `错误 ${n("error")} · 警告 ${n("warn")} · 提示 ${n("info")}` : "没有问题";
    // 控制台空的时候会被收成一根竖条（那是它自己的设计）。但"有问题"就是它该展开的理由，
    // 收着等于把诊断藏起来——正是这次要修的毛病。
    if (diags.some((d) => d.sev !== "info")) consoleBox.classList.remove("is-closed");
  }

  /* ---------- 问题面板 ---------- */
  function renderProblems() {
    const rows = shown();
    probBox.innerHTML = `<div class="dg-filter">
        ${["all", "error", "warn", "info"].map((k) => `<button class="dg-chip${filter === k ? " on" : ""}" data-f="${k}">${({ all: "全部", error: "仅错误", warn: "仅警告", info: "仅提示" })[k]}</button>`).join("")}
        ${diags.some((d) => d.sev === "error") ? `<button class="dg-fix" id="dgFix">把 ${diags.filter((d) => d.sev === "error").length} 个错误交给 AI 修</button>` : ""}
      </div>` +
      (rows.length ? rows.map((d, i) => `<button class="dg-item" data-i="${diags.indexOf(d)}">
          <i class="dg-dot dg-${d.sev}"></i><span class="dg-where">${esc(d.rule)} · ${d.line >= 1 ? "第 " + d.line + " 行" : "整份文件"}</span>
          <span class="dg-msg">${esc(d.msg)}</span></button>`).join("")
        : `<p class="dg-empty">${diags.length ? "当前筛选下没有问题" : "这份脚本没有发现问题"}</p>`);
    probBox.querySelectorAll(".dg-chip").forEach((b) => { b.onclick = () => { filter = b.dataset.f; renderProblems(); }; });
    probBox.querySelectorAll(".dg-item").forEach((b) => {
      b.onclick = () => { const d = diags[+b.dataset.i]; if (d.line >= 1) gotoLine(d.line); else (ta() || {}).focus?.(); };
    });
    const fix = probBox.querySelector("#dgFix");
    if (fix) fix.onclick = () => {
      const errs = diags.filter((d) => d.sev === "error");
      askAbout(E, `这份脚本有 ${errs.length} 个错误，请逐个修掉后重发完整代码，保持原有功能不变。\n\n` +
        errs.map((d) => `第 ${d.line} 行 · ${d.rule}：${d.msg}`).join("\n"));
    };
  }

  function gotoLine(ln) {
    const t = ta();
    if (!t) return;
    const lines = t.value.split("\n");
    const at = lines.slice(0, Math.max(0, ln - 1)).reduce((a, s) => a + s.length + 1, 0);
    t.focus();
    t.setSelectionRange(at, at + (lines[ln - 1] || "").length);
    // textarea 没法直接滚到某行：借 scrollTop 按行高推，再把视口夹在中间
    t.scrollTop = Math.max(0, (ln - 1) * LH - t.clientHeight / 2);
    const pre = document.getElementById("scriptHi"), g = document.getElementById("scriptGutter");
    if (pre) pre.scrollTop = t.scrollTop;
    if (g) g.scrollTop = t.scrollTop;
    cursorLine = ln;
    renderLens();
  }

  /* ---------- 行内动作（CodeLens 的那半边） ---------- */
  function renderLens() {
    const t = ta();
    const code = (t && t.value) || "";
    const syms = symbolsOf(code);
    const here = syms.filter((s) => s.line <= cursorLine).pop();
    const counts = diags.filter((d) => d.line === cursorLine);
    lens.innerHTML = `<span class="lens-where">${here ? esc(here.kind) + " " + esc(here.name) : "第 " + cursorLine + " 行"}</span>` +
      (here ? `<span class="lens-acts">
          <button data-a="explain">解释</button><button data-a="comment">加注释</button>
          <button data-a="optimize">优化重构</button><button data-a="fix">纠正错误</button>
        </span>` : "") +
      (counts.length ? `<button class="lens-err" data-a="line">${counts.length} 个问题</button>` : "") +
      `<span class="ss-spacer"></span><span class="lens-keys">F8 下一个问题 · Ctrl+G 跳行 · Ctrl+P 切文件</span>`;
  }
  lens.onclick = (ev) => {
    const b = ev.target.closest("button[data-a]");
    if (!b) return;
    const t = ta();
    const code = t.value;
    const syms = symbolsOf(code).filter((s) => s.line <= cursorLine);
    const s = syms.pop();
    const body = s ? sliceFunction(code, s.line) : selectedOrLine(t);
    const head = s ? `针对函数 ${s.name}（第 ${s.line} 行起）：\n\n` : "针对这段代码：\n\n";
    const PROMPT = {
      explain: `${head}请详细解释这段代码的功能和实现原理，包括核心逻辑、算法思路和关键部分的作用。\n\n${body}`,
      comment: `${head}请为这段代码补全注释，说明函数用途、参数、返回值与实现逻辑；涉及官方接口处用 JSDoc 标注类型。\n\n${body}`,
      optimize: `${head}请优化并重构这段代码，提高执行效率与可读性，保持原有功能不变。\n\n${body}`,
      fix: `${head}请找出这段代码里的错误并给出修复，说明错误原因。\n\n${body}`,
      line: `第 ${cursorLine} 行报了这些问题，请修掉：\n${diags.filter((d) => d.line === cursorLine).map((d) => `${d.rule}：${d.msg}`).join("\n")}`,
    };
    askAbout(E, PROMPT[b.dataset.a] || "", b.dataset.a === "explain" ? "new" : "revise");
  };

  /** 从起始行往下找到该函数的收尾大括号：够用就行，不做完整解析。 */
  function sliceFunction(code, fromLine) {
    const lines = code.split("\n");
    let depth = 0, seen = false, end = fromLine;
    for (let i = fromLine - 1; i < lines.length && i < fromLine - 1 + 400; i++) {
      for (const ch of lines[i]) { if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--; }
      end = i + 1;
      if (seen && depth <= 0) break;
    }
    return lines.slice(fromLine - 1, end).join("\n").slice(0, 6000);
  }
  function selectedOrLine(t) {
    const sel = t.value.slice(t.selectionStart, t.selectionEnd).trim();
    if (sel) return sel.slice(0, 6000);
    const ln = lineOfCursor(t);
    return (t.value.split("\n")[ln - 1] || "").trim();
  }
  function lineOfCursor(t) { return t.value.slice(0, t.selectionStart).split("\n").length; }

  /* ---------- 快捷键 ---------- */
  function step(dir) {
    const rows = shown().slice().sort((a, b) => a.line - b.line);
    if (!rows.length) return E.toast("没有问题需要跳转", true);
    let i = rows.findIndex((d) => d.line > cursorLine);
    if (dir > 0 && i < 0) i = 0;
    if (dir < 0) { i = rows.findIndex((d) => d.line >= cursorLine); i = i < 0 ? rows.length - 1 : Math.max(0, i - 1); }
    gotoLine(rows[i].line);
  }
  function quickOpen() {
    const list = E.state.scripts || [];
    if (list.length < 2) return E.toast("只有一个脚本文件", true);
    const name = prompt("切到哪个文件？\n" + list.map((f, i) => `${i + 1}. ${f.name}`).join("\n"), list[0].name);
    if (!name) return;
    const i = list.findIndex((f) => f.name === name.trim());
    if (i < 0) return E.toast(`没有这个文件：${name}`, true);
    E.__scriptIdx = i;
    if (E.refreshScriptView) E.refreshScriptView(list[i].name);
    recheck();
  }
  screen.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "F8") { ev.preventDefault(); step(ev.shiftKey ? -1 : 1); return; }
    if (mod && ev.key.toLowerCase() === "g") {
      ev.preventDefault();
      const n = parseInt(prompt("跳到第几行？", String(cursorLine)) || "", 10);
      if (n > 0) gotoLine(n);
      return;
    }
    if (mod && !ev.shiftKey && ev.key.toLowerCase() === "p") { ev.preventDefault(); quickOpen(); }
  });

  /* ---------- 挂接 ---------- */
  // 直接挂 textarea，不用 #scriptScreen 委托：委托要求事件冒泡，而 input 的
  // bubbles 默认是 false（程序派发的尤其容易忘），一旦不冒泡就是"改了不重查"，
  // 症状和没做一样。features.js 那边也是直接挂的。
  const taEl = ta();
  if (taEl) {
    taEl.addEventListener("input", () => { cursorLine = lineOfCursor(taEl); scheduleRecheck(); });
    taEl.addEventListener("keyup", (ev) => {
      if (ev.key === "Control" || ev.key === "Meta") return;
      cursorLine = lineOfCursor(taEl);
      renderLens();
    });
    taEl.addEventListener("click", () => {
      // 点击后 selectionStart 才更新，放到下一拍再读
      setTimeout(() => { cursorLine = lineOfCursor(taEl); renderLens(); }, 0);
    });
  }
  const origRender = E.renderCode;
  E.renderCode = () => { if (origRender) origRender(); paint(); };
  // 切文件走 refreshScriptView：换的正是诊断的输入，必须跟着重算，
  // 否则屏幕上标的是上一个文件的问题，点一下还跳错行。
  const origView = E.refreshScriptView;
  E.refreshScriptView = (name) => { if (origView) origView(name); recheck(); };
  E.ideRecheck = recheck;
  // 命令面板和状态栏要能复用同一套跳转，不在那边重写一遍。
  // 包一层"先切到脚本页"：人可能在搭建页点诊断，而 gotoLine 是对 textarea 调 focus()——
  // 页面没打开时那个 textarea 是 display:none，focus 不报错也不动，症状正是"点了没反应"。
  E.ideStep = (dir) => {
    if (E.ctx && E.ctx.mode !== "script") document.querySelector('.mtab[data-menu="script"]')?.click();
    step(dir);
  };
  E.ideGoto = (n) => {
    if (E.ctx && E.ctx.mode !== "script") document.querySelector('.mtab[data-menu="script"]')?.click();
    gotoLine(n);
  };
  // 状态栏只读这一个口子，不去各自数 diags：数法一多就会出现"面板说有 2 个、
  // 底栏说 3 个"，而两处都"没错"（一处按筛选、一处按全量）。
  E.ideDiags = () => diags;
  // 给测试用：断言"屏幕上的诊断"必须能拿到这一层的真实输入，
  // 否则探针只能猜（第一次就误判成 lint 读错了文件）。
  E.ideState = () => ({ code: editingCode().slice(0, 40), lines: editingCode().split("\n").length, diags, lens: cursorLine });
  recheck();
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
