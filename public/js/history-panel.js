// history-panel.js — 撤销历史窗口：看得见"我在哪一步"，并且能跳回去。
//
// 为什么值得做：只有 Ctrl+Z 的话，撤销是一个"盲按直到看起来对"的操作。
// 一次拖拽、一次脚本执行、一次 AI 建模都算一步，按过了头还得 redo 回来，
// 而人并不知道自己退了几步。列出来之后，它变成一次点击。
//
// 两条约束：
// · 中文名从 TOOLS[key].name 取，不在这里再抄一份。工具改名时这里跟着改；
//   两处各写一份，迟早出现"工具条叫刷色、历史里叫涂色"。
// · 面板开着的时候 250ms 重读一次栈，不在每个 commit 点埋通知。
//   往栈里写的地方现在有二十多处（工具、脚本、AI、粘贴、协作），
//   埋点必然漏掉后来新增的那个，而漏掉的表征就是"列表停在旧状态"。

import { TOOLS } from "./tools.js";

const EXTRA = {
  script: "脚本改动", move: "移动选区", paste: "粘贴", duplicate: "复制副本",
  delete: "删除选区", op: "改动", clear: "清场", terrain: "地形生成",
};

const zh = (label) => TOOLS[label]?.name || EXTRA[label] || label;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function wireHistoryPanel(E) {
  const btn = document.getElementById("histBtn");
  if (!btn) return;
  let box = null, timer = null;

  function rows() {
    const h = E.history;
    const out = [];
    for (let i = h.stack.length - 1; i >= 0; i--) {
      const s = h.stack[i];
      out.push({ i, label: s.label, n: s.changes.length, cur: i === h.pointer, future: i > h.pointer });
    }
    return out;
  }

  function render() {
    if (!box) return;
    const list = rows();
    box.innerHTML = list.length
      ? `<div class="hh-head">撤销历史<span>${list.filter((r) => !r.future).length} / ${list.length} 步可撤销</span></div>` +
        list.map((r) => `<button class="hh-row${r.cur ? " on" : ""}${r.future ? " future" : ""}" data-i="${r.i}">
            <b>${esc(zh(r.label))}</b><i>${r.n} 格</i></button>`).join("")
      : `<p class="hh-empty">还没有可撤销的改动</p>`;
  }

  function jumpTo(i) {
    const h = E.history;
    let guard = h.max + 2;
    while (h.pointer > i && guard-- > 0) h.undo();
    while (h.pointer < i && guard-- > 0) h.redo();
    render();
  }

  function open() {
    if (box) return;
    box = document.createElement("div");
    box.className = "hist-menu";
    document.body.appendChild(box);
    const r = btn.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + "px";
    box.style.top = (r.bottom + 6) + "px";
    box.onclick = (ev) => {
      const row = ev.target.closest(".hh-row");
      if (row) jumpTo(Number(row.dataset.i));
    };
    const out = (ev) => { if (box && !ev.target.closest(".hist-menu") && ev.target !== btn) close(); };
    const key = (ev) => { if (ev.key === "Escape") close(); };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", key, true);
    box._off = () => { document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", key, true); };
    render();
    timer = setInterval(render, 250);
  }
  function close() {
    if (!box) return;
    clearInterval(timer); timer = null;
    box._off?.();
    box.remove(); box = null;
  }

  btn.onclick = () => (box ? close() : open());
  E.historyPanel = { open, close, toggle: () => (box ? close() : open()) };
}
