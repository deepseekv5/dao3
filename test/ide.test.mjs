// ide.test.mjs — 编辑器外壳（状态栏 + 命令面板）的浏览器回归。
// 运行：npm run serve &  然后  npm run test:ide
//
// 为什么这些断言值得常驻：这一层的 bug 全是"看起来正常"那一类，类型检查抓不到。
// 实测两条都是这套断言当场抓出来的：
//   · .script-screen 是 fixed 整屏遮罩，压在状态栏上 → 诊断按钮"看得见点不到"；
//   · 顶栏躺着两颗没接线的图标，其中一颗写着「协作」却提示"暂未开放"。
// 断言走真实指针事件（Session.click 会做命中测试），所以遮挡这一类才报得出来。
import { launchChrome, Session } from "./cdp.mjs";

const ok = (name, cond, extra = "") => console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  " + extra : ""));

const { port } = await launchChrome({});
const s = await Session.open(port, { width: 1440, height: 900, initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")}catch(e){}' ] });
await s.goto("http://127.0.0.1:5173/editor.html", { settleMs: 8000 });

// 等 features 装好并跑过一轮状态栏轮询。冷启动（新 profile、没有 HTTP 缓存）实测
// 要 60s 开外才把 150 万格的默认图 load 完，所以这里等到真读数出现为止。
// 固定 settleMs 是在猜——猜短了断言全红，而红的理由是"还没跑到那一步"，不是坏了。
async function wait(expr, ms = 120000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await s.evaluate(`(() => !!(${expr}))()`)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("等超时（" + ms + "ms）：" + label);
}
// 冷启动（没有 HTTP 缓存的新 profile）实测要 60s 开外才把 150 万格的默认图 load 完。
await wait(`window.__editor && window.__editor.palette && document.getElementById("sbMode").textContent === "搭建"`, 120000, "编辑器就绪 + 状态栏跑起来");

const errs = (s._events || []).filter((m) => m.method === "Runtime.exceptionThrown" || (m.method === "Log.entryAdded" && m.params?.entry?.level === "error"));
ok("编辑器启动无异常", errs.length === 0, errs.slice(0, 3).map((m) => (m.method === "Log.entryAdded" ? m.params.entry.text : m.params.exceptionDetails?.exception?.description)).join(" | "));

const geo = await s.evaluate(`(() => {
  const hud = document.getElementById("hud"), st = document.getElementById("stage");
  const a = hud.getBoundingClientRect(), b = st.getBoundingClientRect();
  return {
    hudW: Math.round(a.width), vw: window.innerWidth, hudH: Math.round(a.height), hudBottom: Math.round(a.bottom), vh: window.innerHeight,
    stageBottom: Math.round(b.bottom), pos: getComputedStyle(hud).position,
    tool: document.getElementById("sbTool").textContent,
    mode: document.getElementById("sbMode").textContent,
    world: document.getElementById("sbWorld").textContent,
    diag: document.getElementById("sbDiag").textContent,
    count: document.getElementById("blockCount").textContent,
    segCss: getComputedStyle(document.querySelector(".sb-seg + .sb-seg"), "::before").content,
  };
})()`);
console.log(JSON.stringify(geo, null, 1));
ok("状态栏通栏贴在视口底部", geo.pos === "fixed" && geo.hudW === geo.vw && geo.hudBottom === geo.vh && geo.hudH === 24);
ok("画布给状态栏让出 24px", geo.stageBottom === geo.vh - 24, "stage.bottom=" + geo.stageBottom);
ok("读数有内容（工具/工作区/世界名）", geo.tool !== "—" && geo.mode === "搭建" && geo.world.length > 0);
ok("分隔点由 CSS 画出", geo.segCss.includes('"·"'), geo.segCss);

// 工具条浮在画布上，之前按整幅宽居中，右端压进了 300px 的场景/属性面板
// （实拍里"预览/界面"两个 tab 被吃掉一半）。左右都不许碰。
const ov = await s.evaluate(`(() => {
  const t = document.getElementById("editToolbar").getBoundingClientRect();
  const r = document.getElementById("rightPanel").getBoundingClientRect();
  const l = document.getElementById("libCard").getBoundingClientRect();
  return { tbRight: Math.round(t.right), rpLeft: Math.round(r.left), tbLeft: Math.round(t.left), lcRight: Math.round(l.right) };
})()`);
ok("工具条不压右侧面板，也不压左侧方块库", ov.tbRight <= ov.rpLeft && ov.tbLeft >= ov.lcRight, JSON.stringify(ov));

// 顶栏每个图标都得有自己的 id：没 id 的按钮就是"没人接的那一个"。
// 实拍里躺着两个——一颗假「协作」（真协作在旁边能用）和一颗「反馈」，
// 点上去 toast「本地单机版暂未开放」，等于在否认一个已经做好的功能。
const anon = await s.evaluate(`(() => [].map.call(document.querySelectorAll("#topbar .tb-ico"), b => b.title).filter(t => !t) )()`);
const noId = await s.evaluate(`(() => [].filter.call(document.querySelectorAll("#topbar .tb-ico"), b => !b.id).map(b => b.title))()`);
ok("顶栏图标全部有 id（可接线）且 title 不为空", noId.length === 0 && anon.length === 0, JSON.stringify({ noId, anon }));

/* ---------- 分隔条：拖、双击复位、方向键，且派生几何要跟着走 ---------- */
// 用合成 PointerEvent（与 test/e2e.mjs 拖浮标那套同一手法）：
// 我的处理器是 pointerdown 挂在把手、move/up 挂在 window，这条链路必须按顺序打。
const drag = (sel, dx) => s.evaluate(`(async () => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const r = el.getBoundingClientRect();
  const od = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, isPrimary: true, button: 0 });
  el.dispatchEvent(new PointerEvent("pointerdown", od(r.left + 4, r.top + r.height / 2)));
  window.dispatchEvent(new PointerEvent("pointermove", od(r.left + 4 + ${dx}, r.top + r.height / 2)));
  window.dispatchEvent(new PointerEvent("pointerup", od(r.left + 4 + ${dx}, r.top + r.height / 2)));
  await new Promise(r2 => setTimeout(r2, 120));
  return true;
})()`);
const geom = () => s.evaluate(`(() => {
  const cs = getComputedStyle(document.documentElement);
  const rp = document.getElementById("rightPanel").getBoundingClientRect();
  const tb = document.getElementById("editToolbar").getBoundingClientRect();
  const lib = document.getElementById("libCard").getBoundingClientRect();
  return { rpVar: cs.getPropertyValue("--rp-w").trim(), libVar: cs.getPropertyValue("--lib-w").trim(),
    rpW: Math.round(rp.width), rpLeft: Math.round(rp.left), tbRight: Math.round(tb.right), libW: Math.round(lib.width) };
})()`);
const g0 = await geom();
await drag("#gripRight", -120);
const g1 = await geom();
ok("拖右栏分隔条：往左拖变宽，CSS 变量跟着走", g1.rpW - g0.rpW >= 110 && g1.rpVar === g1.rpW + "px", JSON.stringify({ a: g0.rpW, b: g1.rpW, v: g1.rpVar }));
ok("变宽后工具条仍不压面板（居中公式是派生的，不是手调魔数）", g1.tbRight <= g1.rpLeft, JSON.stringify({ tbRight: g1.tbRight, rpLeft: g1.rpLeft }));

await s.evaluate(`document.getElementById("gripRight").focus()`);
await s.evaluate(`document.getElementById("gripRight").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))`);
const g2 = await geom();
ok("方向键微调分隔条（右箭头把手往右 = 右栏变窄 10px）", g1.rpW - g2.rpW === 10, JSON.stringify({ g1: g1.rpW, g2: g2.rpW }));

await s.evaluate(`document.getElementById("gripRight").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
const g3 = await geom();
ok("双击分隔条回到默认宽度", g3.rpW === 300 && g3.rpVar === "300px", JSON.stringify({ rpW: g3.rpW, v: g3.rpVar }));

await drag("#gripLib", 110);
const g4 = await geom();
const cols = await s.evaluate(`(() => getComputedStyle(document.getElementById("blockLib")).gridTemplateColumns.split(" ").length)()`);
ok("拖方块库变宽：卡片跟着变，且多出来的宽度换成更多列", g4.libW - 238 >= 100 && g4.libVar === g4.libW + "px" && cols >= 3, JSON.stringify({ libW: g4.libW, cols }));
await s.evaluate(`document.getElementById("gripLib").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);

// F1 命令面板
await s.evaluate(`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true, cancelable: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 400));
const opened = await s.evaluate(`(() => { const m = document.querySelector(".pl-mask"); return m ? { rows: m.querySelectorAll(".pl-row").length, grp: [].map.call(m.querySelectorAll(".pl-grp"), n => n.textContent).slice(0,6), focused: document.activeElement.className } : null; })()`);
ok("F1 打开命令面板并抢到焦点", !!opened && opened.rows > 10 && opened.focused === "pl-in", JSON.stringify(opened));

await s.evaluate(`(() => { const i = document.querySelector(".pl-in"); i.value = "脚本"; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
const filtered = await s.evaluate(`(() => { const m = document.querySelector(".pl-mask"); const rows = [].map.call(m.querySelectorAll(".pl-row span"), n => n.textContent); return { n: rows.length, first: rows[0], on: !!m.querySelector(".pl-row.on") }; })()`);
ok("输入即过滤且首行选中", filtered.n > 0 && filtered.n < opened.rows && filtered.on, JSON.stringify(filtered));

await s.evaluate(`(() => { const i = document.querySelector(".pl-in"); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 700));
const jumped = await s.evaluate(`(() => ({
  closed: !document.querySelector(".pl-mask"),
  mode: window.__editor.ctx.mode,
  sbMode: document.getElementById("sbMode").textContent,
  screenShown: document.getElementById("scriptScreen").classList.contains("show"),
}))()`);
ok("回车执行命令：切到脚本工作区", jumped.closed && jumped.mode === "script" && jumped.screenShown, JSON.stringify(jumped));

await new Promise((r) => setTimeout(r, 800));
const sb2 = await s.evaluate(`(() => document.getElementById("sbMode").textContent)()`);
ok("状态栏跟着工作区变", sb2 === "脚本", sb2);

// 折叠掉的工具（.ft-extra，默认 display:none）必须还能从面板调到——
// 上一轮"收成 6 + 更多"只是把噪音挪了位置，这一条才是把它接回来的证明。
await s.evaluate(`(() => { const b = document.getElementById("sbPalette"); b.click(); const i = document.querySelector(".pl-in"); i.value = "球体"; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
const hiddenTool = await s.evaluate(`(() => {
  const b = document.querySelector('#editToolbar .ft[data-tool="sphere"]');
  const r = b.getBoundingClientRect();
  return { collapsed: r.width === 0, inList: !!document.querySelector(".pl-row") };
})()`);
await s.evaluate(`(() => { document.querySelector(".pl-in").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 900));
const toolNow = await s.evaluate(`(() => ({ sb: document.getElementById("sbTool").textContent, active: document.querySelector("#editToolbar .ft[data-tool].active").dataset.tool }))()`);
ok("收起的工具能从面板调到，状态栏认得它", hiddenTool.collapsed && hiddenTool.inList && toolNow.active === "sphere" && toolNow.sb === "球体笔刷", JSON.stringify({ hiddenTool, toolNow }));

// 选区类命令：没选区时必须给出理由，不能"点了没反应"（main.js 里它们全是静默 return）。
const noSel = await s.evaluate(`(async () => {
  document.getElementById("sbPalette").click();
  const i = document.querySelector(".pl-in");
  i.value = "复制选区"; i.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 300));
  const t = document.getElementById("toast");
  return { toast: t.textContent, shown: t.classList.contains("show") };
})()`);
ok("没选区时命令给出理由而不是沉默", noSel.shown && /框选/.test(noSel.toast), JSON.stringify(noSel));

// 有选区时同一条命令要真的干活。选区不能写死坐标：默认图是赛道，随便框一个角
// 很可能框到空气（实测 2,0,2 就是 0 个体素，于是"复制"报 0，看着像命令坏了）。
// 从 world.map 里取第一个真实存在的格子当锚点。
const didCopy = await s.evaluate(`(async () => {
  const w = window.__editor.world;
  const k = w.map.keys().next().value;
  const x = k % w.shape[0], y = Math.floor(k / w.shape[0]) % w.shape[1], z = Math.floor(k / (w.shape[0] * w.shape[1]));
  window.__editor.ctx.setSelection({ x, y, z }, { x: x + 2, y: y + 2, z: z + 2 });
  document.getElementById("sbPalette").click();
  const i = document.querySelector(".pl-in");
  i.value = "复制选区"; i.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 300));
  const t = document.getElementById("toast");
  const sb = document.getElementById("sbSel").textContent;
  window.__editor.selOps.clearSel();
  return { anchor: [x, y, z], n: (window.__editor.state.clipboard || []).length, toast: t.textContent, sb };
})()`);
ok("有选区时命令真的执行，状态栏报得出选区", didCopy.n >= 1 && /个体素/.test(didCopy.toast) && /3×3×3/.test(didCopy.sb), JSON.stringify(didCopy));

// 诊断段：写一段真会踩规则的脚本，底栏要报数，点一下要跳到那一行。
// 三种严重度各来一条（error=给只读官方属性赋值，warn=可空接口直接取属性，info=未使用变量），
// 只报"有问题"是不够的——底栏那句得说清是几个什么级别。
// 先把原文留着：脚本页的 input 是会写回 state.scripts 的，不还原就是往默认图里塞垃圾。
const origScript = await s.evaluate(`(() => { const f = (window.__editor.state.scripts || [])[0]; return f ? f.code : ""; })()`);
const diag = await s.evaluate(`(async () => {
  const ta = document.getElementById("scriptCode");
  ta.value = "const unusedThing = 1;\\nworld.projectName = 'x';\\nworld.querySelector('a').value = 2;\\n";
  ta.dispatchEvent(new Event("input"));
  window.__editor.ideRecheck();
  await new Promise(r => setTimeout(r, 400));
  const d = document.getElementById("sbDiag");
  return { text: d.textContent, sevs: (window.__editor.ideDiags() || []).map(x => x.sev), cls: d.className, title: d.title };
})()`);
ok("诊断按严重度写进状态栏", /1 错误/.test(diag.text) && /1 警告/.test(diag.text) && /1 提示/.test(diag.text), JSON.stringify(diag));
ok("有错误时状态栏转成错误色", diag.cls.includes("err"), diag.cls);

// 光标在第 4 行，下一个问题绕回第 1 行（未使用变量），再点一下到第 2 行（只读属性赋值）。
// 环绕是故意的：底栏只有一个小按钮，走到末尾就哑掉的话，人会以为诊断坏了。
await s.click("#sbDiag");
await new Promise((r) => setTimeout(r, 500));
const step = await s.evaluate(`(() => ({ lens: (window.__editor.ideState()||{}).lens, marks: document.querySelectorAll("#scriptGutter .dg-mark").length }))()`);
ok("点诊断段跳到下一个问题（末尾环绕回第一条）", step.marks === 3 && step.lens === 1, JSON.stringify(step));
await s.click("#sbDiag");
await new Promise((r) => setTimeout(r, 500));
const step2 = await s.evaluate(`(() => (window.__editor.ideState()||{}).lens)()`);
ok("再点一下前进到第 2 行", step2 === 2, String(step2));

/* ---------- 控制台：日志是条目，不是一行状态文字 ---------- */
const cs = await s.evaluate(`(async () => {
  const ta = document.getElementById("scriptCode");
  ta.value = "console.log('甲 一');\\nconsole.log('甲 一');\\nconsole.warn('乙 警告');\\nconsole.error('丙 错误');\\nthrow new Error('炸了');\\n";
  ta.dispatchEvent(new Event("input"));
  await new Promise(r => setTimeout(r, 150));
  document.getElementById("scriptRun").click();
  await new Promise(r => setTimeout(r, 500));
  const rows = [...document.querySelectorAll("#scriptOut .cs-row")];
  const chip = (k) => document.querySelector('.cs-chip[data-k="' + k + '"] b').textContent;
  return { n: rows.length, kinds: rows.map(r => r.dataset.k), collapsed: rows.map(r => r.dataset.n),
    log: chip("log"), warn: chip("warn"), err: chip("error"),
    hasGoto: !!document.querySelector("#scriptOut .cs-at") };
})()`);
ok("多条输出并存（不再互相覆盖）", cs.n === 4, JSON.stringify(cs));
ok("严重度分得清", cs.kinds.join(",") === "log,log,warn,error,error" || cs.kinds.join(",") === "log,warn,error,error", JSON.stringify(cs.kinds));
ok("重复的连续行折成 ×N", cs.collapsed.includes("2"), JSON.stringify(cs.collapsed));
ok("筛选按钮上的计数是真的", Number(cs.log) >= 2 && Number(cs.warn) === 1 && Number(cs.err) === 2, JSON.stringify({ log: cs.log, warn: cs.warn, err: cs.err }));
ok("带行号的报错给得出跳转入口", cs.hasGoto, JSON.stringify(cs));

const csFiltered = await s.evaluate(`(async () => {
  document.querySelector('.cs-chip[data-k="error"]').click();
  await new Promise(r => setTimeout(r, 200));
  const vis = [...document.querySelectorAll("#scriptOut .cs-row")].filter(r => getComputedStyle(r).display !== "none").map(r => r.dataset.k);
  document.querySelector('.cs-chip[data-k="error"]').click();
  await new Promise(r => setTimeout(r, 200));
  const back = [...document.querySelectorAll("#scriptOut .cs-row")].filter(r => getComputedStyle(r).display !== "none").length;
  return { vis, back };
})()`);
ok("关掉某个严重度就只剩剩下的（计数不清零）", csFiltered.vis.length === 2 && !csFiltered.vis.includes("error") && csFiltered.back === 4, JSON.stringify(csFiltered));

const csJumped = await s.evaluate(`(async () => {
  const b = document.querySelector("#scriptOut .cs-at");
  const want = Number(b.textContent.replace(/\\D/g, ""));
  b.click();
  await new Promise(r => setTimeout(r, 300));
  return { want, lens: (window.__editor.ideState() || {}).lens };
})()`);
ok("点条目上的行号跳过去", csJumped.lens === csJumped.want, JSON.stringify(csJumped));

const cleared = await s.evaluate(`(async () => {
  document.getElementById("csClear").click();
  await new Promise(r => setTimeout(r, 200));
  const chip = (k) => document.querySelector('.cs-chip[data-k="' + k + '"] b').textContent;
  return { rows: document.querySelectorAll("#scriptOut .cs-row").length, log: chip("log"), warn: chip("warn"), err: chip("error") };
})()`);
ok("清空把条目和计数一起清掉", cleared.rows === 0 && !cleared.log && !cleared.warn && !cleared.err, JSON.stringify(cleared));

// 状态栏那个 F1 按钮（不是快捷键）也要能开合。走真实指针事件：
// 状态栏是 position:fixed 的一层，z-index 写错就是"看得见但点不到"。
await s.click("#sbPalette");
await new Promise((r) => setTimeout(r, 250));
const on = await s.evaluate(`!!document.querySelector(".pl-mask")`);
// 面板是模态遮罩，盖住整屏包括状态栏——所以关它的路子是 Esc / 点遮罩，不是再点一次按钮。
await s.evaluate(`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 250));
const off = await s.evaluate(`!document.querySelector(".pl-mask")`);
ok("状态栏按钮开面板、Esc 关面板", on && off, JSON.stringify({ on, off }));

// 脚本页是 fixed 全屏遮罩，它会压在状态栏上（实测就是这样把 sbDiag 挡到点不到的）：
// 断言它的底边停在 24px 之上，别让"看得见点不动"再回来。
const cover = await s.evaluate(`(() => { const r = document.getElementById("scriptScreen").getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: window.innerHeight }; })()`);
ok("脚本工作区不压住状态栏", cover.bottom === cover.vh - 24, JSON.stringify(cover));

// 脚本页的控制台也是一块面板：它的把手在左边，往左拖变宽。
const c0 = await s.evaluate(`(() => Math.round(document.getElementById("scriptConsole").getBoundingClientRect().width))()`);
await drag("#gripConsole", -90);
const c1 = await s.evaluate(`(() => ({ w: Math.round(document.getElementById("scriptConsole").getBoundingClientRect().width),
  v: getComputedStyle(document.documentElement).getPropertyValue("--console-w").trim(),
  closed: document.getElementById("scriptConsole").classList.contains("is-closed") }))()`);
ok("控制台分隔条能拖宽，且拖的时候自动展开", c1.w - c0 >= 80 && c1.v === c1.w + "px" && !c1.closed, JSON.stringify({ c0, c1 }));
await s.evaluate(`document.getElementById("gripConsole").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);

await s.evaluate(`(() => { document.getElementById("sbPalette").click(); return true; })()`);
await new Promise((r) => setTimeout(r, 400));
await s.shot("test/out/ide-palette.png");
await s.evaluate(`(() => { document.querySelector(".pl-in").value = "视"; document.querySelector(".pl-in").dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
await s.evaluate(`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; })()`);

await s.evaluate(`(() => { document.querySelector('.mtab[data-menu="build"]').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));
await s.shot("test/out/ide-shell.png");

// 运行模式下整条收起、画布回到全高
await s.evaluate(`(() => { document.body.classList.add("playing"); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
const play = await s.evaluate(`(() => {
  const hud = document.getElementById("hud"), st = document.getElementById("stage");
  return { hudShown: getComputedStyle(hud).display !== "none", stageBottom: Math.round(st.getBoundingClientRect().bottom), vh: window.innerHeight };
})()`);
ok("运行时状态栏收起、画布铺满", !play.hudShown && play.stageBottom === play.vh, JSON.stringify(play));

// 默认图不能被这轮测试写脏：autosave 已关，但仍要确认脚本正文回到的是文件本身
await s.evaluate(`(() => {
  const ta = document.getElementById("scriptCode");
  ta.value = ${JSON.stringify(origScript)};
  ta.dispatchEvent(new Event("input"));
  window.__editor.ideRecheck();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 500));
const clean = await s.evaluate(`(() => { const f = (window.__editor.state.scripts || [])[0]; return { n: (window.__editor.state.scripts||[]).length, head: (f && f.code || "").slice(0, 20), restored: (f&&f.code) === ${JSON.stringify(origScript)}, diags: window.__editor.ideDiags().length }; })()`);
ok("测试没把垃圾脚本写回默认图", !/unusedThing/.test(clean.head || "") && clean.restored, JSON.stringify(clean));

// 尺寸要活过一次重载，而且是在世界 load 完**之前**就贴好——
// 否则每次开图都会看到布局从默认值跳到记忆值（initFeatures 要等 60s 冷启动）。
await s.evaluate(`(() => { document.body.classList.remove("playing"); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
await drag("#gripRight", -100);
const want = await geom();
const stored = await s.evaluate(`localStorage.getItem("ly.panelSizes")`);
await s.goto("http://127.0.0.1:5173/editor.html", { settleMs: 1500 });
const early = await s.evaluate(`(() => getComputedStyle(document.documentElement).getPropertyValue("--rp-w").trim())()`);
ok("重载后布局立刻恢复（不等世界 load 完）", early === want.rpVar && want.rpW > 300, JSON.stringify({ stored, rpW: want.rpW, early }));
// 复位，免得这条断言把持久化留在非默认值上影响后面的实拍
await s.evaluate(`(() => { localStorage.setItem("ly.panelSizes", "{}"); return true; })()`);

await s.close();
process.exit(0);
