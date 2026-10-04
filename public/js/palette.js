// palette.js — 命令面板：F1 / Ctrl+Shift+P。
//
// 为什么这是"编辑器变成 IDE"的关键一步，而不是又一个炫技控件：
// 工作台一屏有 115 个可见控件。上一轮我把工具条收成 6 + 更多，那只是把噪音挪了个位置——
// 真正的问题不是"东西太多"，是"没有一条不用找图标就能干活的通路"。
// 有了面板，图标可以更少，因为所有动作都还能敲两个字出来。
//
// 命令一律**转调现有控件的 click()**，不在这里重写一遍行为。
// 理由和 collab.js 里那条一样：两处实现必然漂移，而漂移的症状是
// "从图标点进去对、从面板点进去不对"，最难查。
// 只有确实没有对应控件的（比如"跳到第 n 行"）才自己实现。

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** 子序列匹配："运g" 能中"运行游戏"。返回 null 表示不匹配，否则返回一个越小越好的分。 */
function score(q, text) {
  const s = q.toLowerCase(), t = text.toLowerCase();
  if (!s) return 0;
  const at = t.indexOf(s);
  if (at === 0) return -1000;
  if (at > 0) return at - 500;
  let i = 0, gaps = 0, prev = -2;
  for (const ch of s) {
    const k = t.indexOf(ch, i);
    if (k < 0) return null;
    if (prev >= 0 && k > prev + 1) gaps += k - prev - 1;
    prev = k; i = k + 1;
  }
  return gaps;
}

export function wirePalette(E) {
  let box = null, rows = [], sel = 0, query = "";

  /** 有 id 的按钮直接转调；找不到就报出来，别静默变成"这条命令没反应"。 */
  const click = (sel) => () => {
    const el = document.querySelector(sel);
    if (!el) return E.toast(`找不到入口：${sel}`, true);
    el.click();
  };
  const tool = (id) => () => {
    const el = document.querySelector(`#editToolbar .ft[data-tool="${id}"]`);
    if (!el) return E.toast(`工具 ${id} 不在工具条上`, true);
    el.click();
  };

  function commands() {
    const out = [];
    const g = (group, title, hint, run) => out.push({ group, title, hint, run });
    for (const [key, zh] of [["build", "搭建"], ["model", "模型"], ["script", "脚本"], ["ui", "界面"], ["store", "商城"], ["player", "玩家"], ["pack", "代码包"]]) {
      g("切换工作区", `去「${zh}」`, "顶部菜单", click(`.mtab[data-menu="${key}"]`));
    }
    for (const b of document.querySelectorAll("#editToolbar .ft[data-tool]")) {
      const t = (b.title || "").replace(/\s*\(.*\)$/, "");
      g("工具", `用${t}`, b.title.match(/\(([^)]+)\)/)?.[1] ? `快捷键 ${b.title.match(/\(([^)]+)\)/)[1]}` : "", tool(b.dataset.tool));
    }
    g("视图", "切换网格", "", click("#grid"));
    g("视图", "切换边缘线", "", click("#edges"));
    g("视图", "透视 / 正交", "O", click("#ortho"));
    g("视图", "角色视角编辑", "K", click("#fpEdit"));
    g("视图", "重置视角", "", click("#resetView"));
    g("视图", "聚焦选中", "Shift+F", () => E.frameSelected?.());
    g("视图", "全局视角", "", click("#modeGlobal"));
    g("视图", "重置面板布局", "拖乱了回默认", () => E.resetPanels?.());
    g("编辑", "撤销", "Ctrl+Z", click("#undo"));
    g("编辑", "重做", "Ctrl+Shift+Z", click("#redo"));
    g("编辑", "保存世界", "Ctrl+S", () => E.save());
    // 选区这几个动作原本只有快捷键：main.js 里它们全是"没选区就 return"，
    // 从面板点进去什么都不发生就是"面板坏了"。所以条件不满足时把理由说出来。
    const selOp = (fn, why, need) => () => {
      if (need && !need()) return E.toast(why, true);
      if (!E.selOps?.[fn]) return E.toast(`编辑器没暴露 ${fn}`, true);
      E.selOps[fn]();
    };
    const hasSel = () => !!E.state.selection;
    const selWhy = "先用框选工具 (S) 框住一片体素";
    g("选区", "复制选区", "Ctrl+C", selOp("copySel", selWhy, hasSel));
    g("选区", "粘贴", "Ctrl+V", selOp("paste", "剪贴板是空的，先复制一片选区", () => !!E.state.clipboard));
    g("选区", "就地复制副本", "Ctrl+D", selOp("duplicateSel", selWhy, hasSel));
    g("选区", "删除选区内体素", "Delete", selOp("deleteSel", selWhy, hasSel));
    g("选区", "清除选区", "Esc", selOp("clearSel", selWhy, hasSel));
    g("运行", "运行游戏", "", click("#btnPublish"));
    g("运行", "停止运行", "", () => E.stopPlay && E.stopPlay());
    g("发布与协作", "发布到社区", "", click("#btnShare"));
    g("发布与协作", "开关协作", "", click("#btnCollab"));
    g("跳转", "跳到指定行…", "", () => jumpLine());
    g("跳转", "下一个问题", "F8", () => E.ideStep?.(1));
    g("跳转", "上一个问题", "Shift+F8", () => E.ideStep?.(-1));
    g("帮助与设置", "设置", "", click("#btnSettings"));
    g("帮助与设置", "游玩手册", "", click("#btnManual"));
    g("帮助与设置", "世界库", "", click("#btnWorlds"));
    g("帮助与设置", "返回主界面", "", click("#btnHome"));
    return out;
  }

  function jumpLine() {
    const raw = (prompt("跳到第几行？", "1") || "").trim();
    if (!raw) return;
    const n = parseInt(raw, 10);
    // ideGoto 自己会先切到脚本页，这里不再要求"当前必须在脚本页"。
    if (n > 0) E.ideGoto?.(n);
    else E.toast(`行号得是数字，收到的是「${raw}」`, true);
  }

  function render() {
    const list = query.trim()
      ? commands().map((c) => ({ c, s: score(query.trim(), c.title + " " + c.group) })).filter((x) => x.s !== null)
        .sort((a, b) => a.s - b.s).slice(0, 60).map((x) => x.c)
      : commands().slice(0, 60);
    rows = list;
    sel = Math.max(0, Math.min(sel, list.length - 1));
    const seenG = new Set();
    box.querySelector(".pl-list").innerHTML = list.length ? list.map((c, i) => {
      const head = !seenG.has(c.group) && !query ? `<div class="pl-grp">${esc(c.group)}</div>` : "";
      seenG.add(c.group);
      return `${head}<button class="pl-row${i === sel ? " on" : ""}" data-i="${i}">
        <span>${esc(c.title)}</span><em>${esc(c.hint || "")}</em></button>`;
    }).join("") : `<p class="pl-none">没有匹配的命令</p>`;
    const cur = box.querySelector(".pl-row.on");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function open() {
    if (box) return;
    box = document.createElement("div");
    box.className = "pl-mask";
    box.innerHTML = `<div class="pl-box" role="dialog" aria-label="命令面板">
      <input class="pl-in" placeholder="输入命令名，回车执行 · Esc 关闭" autocomplete="off" spellcheck="false"/>
      <div class="pl-list"></div></div>`;
    document.body.appendChild(box);
    const inp = box.querySelector(".pl-in");
    inp.oninput = () => { query = inp.value; sel = 0; render(); };
    inp.onkeydown = (ev) => {
      if (ev.key === "ArrowDown") { ev.preventDefault(); sel = Math.min(sel + 1, rows.length - 1); render(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (ev.key === "Enter") { ev.preventDefault(); run(sel); }
      else if (ev.key === "Escape") { ev.preventDefault(); close(); }
    };
    box.onclick = (ev) => {
      if (ev.target === box) return close();
      const r = ev.target.closest(".pl-row");
      if (r) run(+r.dataset.i);
    };
    query = ""; sel = 0; render();
    inp.focus();
  }

  function run(i) {
    const c = rows[i];
    close();
    if (!c) return;
    try { c.run(); } catch (e) { E.toast(`命令失败：${e.message}`, true); }
  }
  function close() { if (box) { box.remove(); box = null; } }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "F1" || (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "p") || (ev.metaKey && ev.shiftKey && ev.key.toLowerCase() === "p")) {
      ev.preventDefault();
      box ? close() : open();
    } else if (ev.key === "Escape" && box) { close(); }
  }, true);

  // 状态栏那个入口归这里管：面板开没开只有 open()/close() 自己知道，
  // 让外部按钮去猜 DOM 里有没有遮罩，就是第二份真相——迟早和快捷键不一致。
  const btn = document.getElementById("sbPalette");
  if (btn) btn.onclick = () => (box ? close() : open());

  E.palette = { open, close, toggle: () => (box ? close() : open()) };
  return { open, close, get isOpen() { return !!box; } };
}
