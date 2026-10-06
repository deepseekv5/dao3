// ide.test.mjs — 编辑器外壳（状态栏 + 命令面板）的浏览器回归。
// 运行：npm run serve &  然后  npm run test:ide
//
// 为什么这些断言值得常驻：这一层的 bug 全是"看起来正常"那一类，类型检查抓不到。
// 实测两条都是这套断言当场抓出来的：
//   · .script-screen 是 fixed 整屏遮罩，压在状态栏上 → 诊断按钮"看得见点不到"；
//   · 顶栏躺着两颗没接线的图标，其中一颗写着「协作」却提示"暂未开放"。
// 断言走真实指针事件（Session.click 会做命中测试），所以遮挡这一类才报得出来。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, Session } from "./cdp.mjs";

const ok = (name, cond, extra = "") => console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  " + extra : ""));

/* ---------- 静态：颜色只有一个来源 ---------- */
// 换主题那次只改了 :root，内层留着一堆上一套主题的硬编码色，
// 结果是同一个界面里两种底色、五种"错误红"。这条断言是为了不再退回去。
const CSS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/css/editor.css"), "utf8");
const afterRoot = CSS.slice(CSS.indexOf("\n}") + 2);      // :root 是文件里的第一个块，它自己当然可以写字面色
// 规则针对的是**有彩色**：#fff / #000 这种中性色写死不算跑偏，
// 而 #4b5563、#0d0f12 这类"上一套主题的灰"才是问题——它们会让一个界面出现两种底色。
const NEUTRAL = new Set(["#fff", "#ffffff", "#000", "#000000"]);
const ALLOWED = new Set([...NEUTRAL, "#ff5b5b", "#ff8a5b"]);   // 后两个是血条渐变：游戏内元素，不是界面 chrome
const bad = [...afterRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]).filter((c) => !ALLOWED.has(c));
ok(`editor.css 里 :root 之外没有游离的有彩色（剩 ${bad.length} 个）`, bad.length === 0, [...new Set(bad)].join(" "));

const { port } = await launchChrome({});
const s = await Session.open(port, { width: 1440, height: 900, initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")}catch(e){}' ] });
await s.goto("http://127.0.0.1:5173/editor.html", { settleMs: 8000 });

// 等 features 装好并跑过一轮状态栏轮询。冷启动（新 profile、没有 HTTP 缓存）实测
// 要 60s 开外才把 150 万格的默认图 load 完，所以这里等到真读数出现为止。
// 固定 settleMs 是在猜——猜短了断言全红，而红的理由是"还没跑到那一步"，不是坏了。
async function wait(expr, ms = 120000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    // evaluate 超时也算"还没就绪"：世界 load 会把主线程压满几十秒，
    // 那时候轮询本身也会被拖死，把它当失败就会报出一个不存在的 bug。
    let ready = false;
    try { ready = !!(await s.evaluate(`(() => !!(${expr}))()`)); } catch { ready = false; }
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 1500));
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

/* ---------- 视口坐标罗盘 + 聚焦选中 ---------- */
const gz = await s.evaluate(`(() => {
  const g = document.querySelector(".view-gizmo");
  if (!g) return null;
  const r = g.getBoundingClientRect(), rp = document.getElementById("rightPanel").getBoundingClientRect();
  return { groups: g.querySelectorAll("g").length, insideStage: !!g.closest("#stage"), right: Math.round(r.right), rpLeft: Math.round(rp.left) };
})()`);
ok("坐标罗盘在视口里、六根轴都在", gz && gz.groups === 6 && gz.insideStage && gz.right <= gz.rpLeft, JSON.stringify(gz));

// 点 +Z 那根轴的端点：相机应该站到 target 的 +Z 一侧。
// 容差按距离的 5% 算而不是绝对 1 格：OrbitControls.update() 会按它自己的球坐标
// 重算一次位置，换了 up 之后极角映射会有零点几度的偏差，那是实现细节不是 bug。
const tipped = await s.evaluate(`(async () => {
  document.querySelector('.view-gizmo g[data-k="z"][data-s="1"] circle').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const r = window.__editor.renderer, t = r.controls.target, p = r.camera.position;
  const d = p.distanceTo(t);
  return { d: +d.toFixed(1), dx: +(p.x - t.x).toFixed(1), dy: +(p.y - t.y).toFixed(1), dz: +(p.z - t.z).toFixed(1) };
})()`);
const offAxis = Math.max(Math.abs(tipped.dx), Math.abs(tipped.dy));
ok("点轴端点切到那个标准视角（视线沿该轴）", tipped.dz > 10 && offAxis < tipped.d * 0.05, JSON.stringify(tipped));

// Shift+F 聚焦选中：框一片体素，镜头中心应该落到那片上
const framed = await s.evaluate(`(async () => {
  const min = { x: 6, y: 2, z: 90 }, max = { x: 10, y: 6, z: 94 };
  window.__editor.ctx.setSelection(min, max);
  const t0 = window.__editor.renderer.controls.target.clone();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "F", shiftKey: true, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 900));
  const t = window.__editor.renderer.controls.target;
  window.__editor.selOps.clearSel();
  return { moved: +t.distanceTo(t0).toFixed(1), near: Math.abs(t.x - 8) < 3 && Math.abs(t.z - 92) < 3 && Math.abs(t.y - 4) < 3 };
})()`);
ok("Shift+F 把镜头移到选区上", framed.moved > 5 && framed.near, JSON.stringify(framed));

/* ---------- 撤销历史窗口 ---------- */
const hist = await s.evaluate(`(async () => {
  const h = window.__editor.history;
  const edit = (label) => h.commit([{ x: 3, y: 1, z: 3, oldId: 0, oldRot: 0, newId: 1, newRot: 0 }], label);
  edit("place"); edit("fill"); edit("script");
  h.undo();                                    // 停在第二步，第三步是可 redo 的那一步
  document.getElementById("histBtn").click();
  await new Promise(r => setTimeout(r, 350));
  const rows = [...document.querySelectorAll(".hh-row")];
  return { open: !!document.querySelector(".hist-menu"), n: rows.length,
    labels: rows.map(r => r.querySelector("b").textContent),
    on: rows.findIndex(r => r.classList.contains("on")),
    future: rows.filter(r => r.classList.contains("future")).length };
})()`);
ok("历史窗口列出每一步，并标出当前在哪一步",
  hist.open && hist.n === 3 && hist.labels.join(",") === "脚本改动,填充,放置" && hist.on === 1 && hist.future === 1, JSON.stringify(hist));

const jumpedBack = await s.evaluate(`(async () => {
  document.querySelectorAll(".hh-row")[0].click();     // 点最新那一步 = redo 回去
  await new Promise(r => setTimeout(r, 300));
  const h = window.__editor.history;
  const rows = [...document.querySelectorAll(".hh-row")];
  const out = { pointer: h.pointer, on: rows.findIndex(r => r.classList.contains("on")), future: rows.filter(r => r.classList.contains("future")).length };
  while (h.canUndo()) h.undo();                          // 测试改动全部退回，别留在默认图上
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  out.closed = !document.querySelector(".hist-menu");
  return out;
})()`);
ok("点某一步真的跳过去，Esc 关窗", jumpedBack.pointer === 2 && jumpedBack.on === 0 && jumpedBack.future === 0 && jumpedBack.closed, JSON.stringify(jumpedBack));

/* ---------- 按住属性名横向拖就能改数值 ---------- */
const scrub = await s.evaluate(`(async () => {
  document.querySelector('.mtab[data-menu="model"]').click();
  await new Promise(r => setTimeout(r, 1000));
  // 按名选中，不用"列表第一项"：那一项是谁取决于 199 个实体的模型资源谁先加载完，
  // 同一个页面里两次点到的都可能不是同一个模型。抽到别的那个再红，
  // 红的理由就跟被测的东西没关系了。
  const item = [...document.querySelectorAll("#modelList .mitem")].find(x => /报名点/.test(x.textContent));
  if (!item) return { err: "模型列表里没有「报名点」" };
  item.click();
  // 等滑杆真的被填上，别睡一个固定时长：那是渲染循环里"下一帧"才写进去的，
  // 而软件光栅化下这一帧可能要好几秒——睡 700ms 读到的就是初始的 0，
  // 于是断言红得像是拖拽坏了。
  const col = document.querySelectorAll("#posSliders .poscol")[0];
  const num = col.querySelector(".posnum"), lb = col.querySelector(".poslbl");
  const m = window.__editor.state.selectedModel;
  for (let i = 0; i < 60 && (num.disabled || Number(num.value) === 0); i++) await new Promise(r => setTimeout(r, 250));
  const out = { before: Number(num.value), objBefore: m ? +m.object.position.x.toFixed(2) : null };
  const r = lb.getBoundingClientRect();
  const od = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, isPrimary: true, button: 0 });
  lb.dispatchEvent(new PointerEvent("pointerdown", od(r.left + 4, r.top + 4)));
  window.dispatchEvent(new PointerEvent("pointermove", od(r.left + 48, r.top + 4)));
  window.dispatchEvent(new PointerEvent("pointerup", od(r.left + 48, r.top + 4)));
  await new Promise(r2 => setTimeout(r2, 400));
  out.after = Number(num.value);
  out.objAfter = m ? +m.object.position.x.toFixed(2) : null;
  // 滚轮：指针停在数值框上才改值
  const v1 = Number(num.value);
  num.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
  await new Promise(r2 => setTimeout(r2, 250));
  out.wheel = Number(num.value) - v1;
  // 停在列表上滚就是正常滚动，不能顺手改掉一个参数
  const list = document.getElementById("modelList");
  list.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
  await new Promise(r2 => setTimeout(r2, 250));
  out.listNoChange = Number(num.value) === out.wheel + v1;
  while (window.__editor.history.canUndo()) window.__editor.history.undo();   // 测试改动退回
  document.querySelector('.mtab[data-menu="build"]').click();
  return out;
})()`);
ok("拖属性名改数值，并且实时作用到模型上", scrub.after >= scrub.before + 40 && scrub.objAfter >= scrub.objBefore + 40, JSON.stringify(scrub));
ok("滚轮在数值框上改值、在列表上只是滚动", scrub.wheel === 1 && scrub.listNoChange, JSON.stringify({ wheel: scrub.wheel, listNoChange: scrub.listNoChange }));

/* ---------- 平移手柄 ---------- */
const giz = await s.evaluate(`(async () => {
  document.querySelector('.mtab[data-menu="model"]').click();
  await new Promise(r => setTimeout(r, 900));
  const it2 = [...document.querySelectorAll("#modelList .mitem")].find(x => /报名点/.test(x.textContent)) || document.querySelector("#modelList .mitem");
  it2.click();
  await new Promise(r => setTimeout(r, 500));
  window.__editor.gizmo.setMode("move");              // 模式记在本地，后面旋转/缩放那几节会改它
  window.__editor.renderer.onRender(0);              // 让 sync() 跑一拍，手柄位置/尺寸就位
  const ed = window.__editor, m = ed.state.selectedModel;
  const at = () => ({ x: +m.object.position.x.toFixed(2), y: +m.object.position.y.toFixed(2), z: +m.object.position.z.toFixed(2) });
  const before = at();
  const cv = document.getElementById("viewport");
  // 把世界点投到屏幕：断言"跟指针 1:1"要量的是模型本体在屏幕上的位置。
  // 量箭头头部不行——头部离模型有 0.96 倍手柄长，而手柄长度按相机距离反算，
  // 拖近拖远它自己就会变。
  const proj = (v) => {
    const cam = ed.renderer.activeCam || ed.renderer.camera;
    const p = new v.constructor(v.x, v.y, v.z);
    p.project(cam);
    const r = cv.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  };
  const p0 = ed.gizmo.headPoint("y"), s0 = proj(m.object.position);
  const od = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 5, isPrimary: true, button: 0, buttons: 1 });
  cv.dispatchEvent(new PointerEvent("pointerdown", od(p0.x, p0.y)));
  cv.dispatchEvent(new PointerEvent("pointermove", od(p0.x, p0.y - 90)));
  cv.dispatchEvent(new PointerEvent("pointermove", od(p0.x, p0.y - 150)));
  await new Promise(r => setTimeout(r, 150));
  const mid = at();
  const s1 = proj(m.object.position);                // 模型在屏幕上跟指针跟了多远
  cv.dispatchEvent(new PointerEvent("pointerup", od(p0.x, p0.y - 150)));
  await new Promise(r => setTimeout(r, 150));
  const dirty = ed.state.dirty;
  m.pos = [before.x, before.y, before.z]; m.object.position.set(before.x, before.y, before.z);
  ed.state.selectedModel = null;
  ed.renderer.onRender(0);
  await new Promise(r => setTimeout(r, 200));
  return { before, mid, followed: +(s1.y - s0.y).toFixed(1), dx: +(s1.x - s0.x).toFixed(1), dirty, visible: ed.gizmo.visible };
})()`);
ok("拖 Y 箭头只抬高度，X/Z 一格都不偏", giz.mid.y > giz.before.y && giz.mid.x === giz.before.x && giz.mid.z === giz.before.z, JSON.stringify(giz));
// 跟手：指针往上拖，模型在屏幕上就得往上走，比例要在一个"手感正常"的区间里。
// 不断言严格 1:1——单轴拖用的是"包含该轴、正对相机"的平面，
// 沿轴移动会改变与相机的距离，透视下比例本来就会随俯仰角变（Unity 的手柄同理）。
// 比例失控（比如 10 倍或 0.01 倍）才是真 bug，这条抓的是那个。
ok("拖拽跟手：方向一致、比例在合理区间", giz.followed < -75 && giz.followed > -375 && Math.abs(giz.dx) < 4, JSON.stringify(giz));
ok("拖完算一次改动（状态栏/存盘知道图变脏了）", giz.dirty === true, JSON.stringify({ dirty: giz.dirty }));
ok("取消选中后手柄自己收起", giz.visible === false, JSON.stringify({ visible: giz.visible }));

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
  // 「未使用局部变量」这条默认是关的（检查严格度面板里最吵的一项），
  // 而这里要的是三种严重度各来一条。所以先把闸门打开，测完再按原值放回去——
  // 以前直接断 3 条，红的理由是"这条规则平时不响"，跟被测的东西无关。
  const { scriptChecks } = await import("/js/features.js");
  const cfg = scriptChecks(window.__editor);
  window.__unusedWas = cfg.noUnusedLocals;
  cfg.noUnusedLocals = true;
  const ta = document.getElementById("scriptCode");
  ta.value = "const unusedThing = 1;\\nworld.projectName = 'x';\\nworld.querySelector('a').value = 2;\\n";
  ta.dispatchEvent(new Event("input"));
  window.__editor.ideRecheck();
  await new Promise(r => setTimeout(r, 400));
  const d = document.getElementById("sbDiag");
  return { text: d.textContent, sevs: (window.__editor.ideDiags() || []).map(x => x.sev), cls: d.className, title: d.title };
})()`);
ok("诊断按严重度写进状态栏", /1 错误/.test(diag.text) && /1 警告/.test(diag.text) && /1 提示/.test(diag.text), JSON.stringify(diag));
// 悬浮提示必须说的是**当前这份**脚本。以前它按"条数变了没变"决定要不要重写，
// 于是两份各有 2 条问题的脚本之间切换，计数对、行号还是上一个文件的。
ok("状态栏的悬浮提示跟着当前脚本走，不留着上一个文件的行号",
  /第 2 行/.test(diag.title) && !/第 87 行/.test(diag.title), diag.title.slice(0, 120));
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
// 闸门放回原值：后面还有别的断言，不该带着一条临时打开的规则往下跑。
await s.evaluate(`(async () => {
  const { scriptChecks } = await import("/js/features.js");
  scriptChecks(window.__editor).noUnusedLocals = window.__unusedWas;
  window.__editor.ideRecheck();
})()`);

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

/* ---------- 工具拖拽 / 批量建造（必须用真实鼠标输入） ---------- */
// 为什么这一段不能用合成 PointerEvent：真浏览器在 pointermove 上把 e.button 报成 -1
// （哪怕左键正按着），而合成事件的 button 是测试自己填的、想填几填几。
// "盒/线/球一次都建不出来、拖拆一格都拆不掉"这个 bug 就是这么躲过整套断言的：
// toolDispatch 顶部的 e.button !== 0 拦掉了所有 onMove，而断言用合成事件绕过了它。
// 这一节的每一条都必须走 Input.dispatchMouseEvent，否则它就不是回归测试，是同谋。
await wait(`window.__editor && document.getElementById("sbMode").textContent === "搭建"`, 150000, "重载后编辑器就绪");
const page = (body) => s.evaluate(`(() => {${body}})()`);
async function mdown(x, y, mod = 0) { await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers: mod }); await new Promise((r) => setTimeout(r, 60)); }
async function mmove(x, y, mod = 0) { await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers: mod }); await new Promise((r) => setTimeout(r, 60)); }
async function mup(x, y, mod = 0) { await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers: mod }); await new Promise((r) => setTimeout(r, 260)); }
async function stroke(x0, y0, x1, y1, mod = 0) {
  await mdown(x0, y0, mod);
  await mmove(Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2), mod);
  await mmove(x1, y1, mod);
  await mup(x1, y1, mod);
}
// 屏幕上哪一点是实心方块，直接问引擎的拾取接口——写死坐标的话换个角度就测到空气。
// mode="free" 排掉"有模型明显挡在前面"的点（那种点击归模型，测不出工具本身）；
// mode="slack" 只要"模型贴在前半个格内"的点，用来验余量那条规则。
const probePoint = (mode) => page(`
  const ed = window.__editor, r = ed.renderer, W = ed.world;
  const rect = r.renderer.domElement.getBoundingClientRect();
  for (let fy = 0.35; fy <= 0.8; fy += 0.05) for (let fx = 0.3; fx <= 0.8; fx += 0.05) {
    const ndc = { x: fx * 2 - 1, y: -(fy * 2 - 1) };
    const p = r.pick(ndc.x, ndc.y);
    if (!p || p.ground || !W.get(p.x, p.y, p.z)) continue;
    r.raycaster.setFromCamera(ndc, r.activeCam || r.camera);
    let model = null, md = Infinity;
    for (const h of r.raycaster.intersectObjects(r.models.children, true)) {
      let o = h.object; while (o.parent && o.parent !== r.models) o = o.parent;
      if (!o || (o.userData && o.userData.ghost)) continue;
      const m = (ed.state.models || []).find((x) => x.object === o);
      if (m) { model = m.name || m.meshName; md = h.distance; break; }
    }
    const gap = p.dist - md;                       // > 0 = 模型比方块更靠前
    ${mode === "slack" ? "if (!(model && gap > 0 && gap <= 0.6)) continue;" : "if (model && gap > 0.6) continue;"}
    // 手柄画在哪儿，哪儿就归手柄——这是它的本职。工具测试要绕开那些像素，
    // 否则"这一笔没建出来"是手柄吃掉的，不是工具坏了。
    const cx = rect.left + fx * rect.width, cy = rect.top + fy * rect.height;
    if (ed.gizmo.visible && ed.gizmo.grabAt({ clientX: cx, clientY: cy })) continue;
    return { x: Math.round(cx), y: Math.round(cy),
      vx: p.x, vy: p.y, vz: p.z, ax: p.ax, ay: p.ay, az: p.az, model, gap: +gap.toFixed(2) };
  }
  return null;`);
const blockPoint = () => probePoint("free");
const lastStep = () => page(`const e = window.__editor.history.stack.slice(-1)[0]; return e ? { label: e.label, n: e.changes.length } : null;`);
const useTool = (t) => page(`window.__editor.ui.setTool(${JSON.stringify(t)}); return 1;`);
const boxLen = () => page(`const e = window.__editor.history.stack.slice(-1)[0]; if (!e) return 0; window.__editor.history.undo(); return e.changes.length;`);

await useTool("box");
const bp = await blockPoint();
await stroke(bp.x, bp.y, bp.x + 90, bp.y + 55);
const built = await lastStep();
const builtThere = await page(`return window.__editor.world.get(${bp.vx + 3}, ${bp.vy + 3}, ${bp.vz}) !== 0;`);
ok("盒工具一次拖拽真的建出一片（不是只建起点那一格）", built.label === "box" && built.n >= 8, JSON.stringify({ built, builtThere }));
const rolledBack = await boxLen();
ok("撤销一次就把这一拖建的全退回去", rolledBack === built.n, JSON.stringify({ rolledBack, n: built.n }));

await useTool("break");
const bp2 = await blockPoint();
await stroke(bp2.x, bp2.y, bp2.x + 70, bp2.y + 45);
const broke = await lastStep();
ok("破坏工具沿路连拆多格（拖拽不再被丢掉）", broke.label === "break" && broke.n >= 2, JSON.stringify(broke));
await boxLen();

// 赛道围栏这类网格就是紧贴着墙装的（实测只差 0.3 格）。按严格"谁近归谁"判的话
// 每一次点击都被判给围栏，症状正是"拆不掉方块"——用户看着的就是那一格。
const slackPt = await probePoint("slack");
await useTool("break");
let slackRes = null;
if (slackPt) {
  await mdown(slackPt.x, slackPt.y);
  await mup(slackPt.x, slackPt.y);
  slackRes = await page(`
    const ed = window.__editor;
    return { still: ed.world.get(${slackPt.vx}, ${slackPt.vy}, ${slackPt.vz}), sel: ed.state.selectedModel ? 1 : 0 };`);
  await boxLen();
}
ok("模型贴在前半个格内时点击归方块：拆得掉、也不把模型抢去选中",
  !!slackPt && !!slackRes && slackRes.still === 0 && slackRes.sel === 0, JSON.stringify({ slackPt, slackRes }));
await useTool("sphere");
const bp3 = await blockPoint();
await stroke(bp3.x, bp3.y, bp3.x + 12, bp3.y + 6);
const ball = await lastStep();
// 半径 1 的球是中心 + 六个邻格 = 7 格。这里曾经是 0：onDown 里那句
// this._apply=()=>{} 把工具自己的 _apply 覆盖成了空函数，而工具对象是模块单例，
// 一次覆盖永久生效——球/空心球/半径笔刷/圆柱/空心柱五个工具全在建空气。
ok("球体笔刷一次点出一坨而不是 0 格", ball.label === "sphere" && ball.n >= 7, JSON.stringify(ball));
await boxLen();

// Shift 要真的传到工具里（ctx.modifiers.shift 原来只有声明、没有任何写入点，
// 于是 Hollow 盒永远实心）。同一段拖拽，空心必须比实心省下方块。
await useTool("box");
const bp4 = await blockPoint();
await stroke(bp4.x, bp4.y, bp4.x + 96, bp4.y + 60);
const solid = (await lastStep()).n;
await boxLen();
await stroke(bp4.x, bp4.y, bp4.x + 96, bp4.y + 60, 8);        // modifiers 位：Shift = 8
const shell = await lastStep();
ok("按住 Shift 的盒是空心壳（修饰键真的到了工具里）", shell.label === "box" && shell.n < solid && shell.n > 1, JSON.stringify({ solid, shell: shell.n }));
await boxLen();

// 阵列：原来份数和偏移都取同一个 s，s=1 时唯一那份被"跳过原点"的判据略过，
// 一次点击什么都不做；现在偏移按选区自身尺寸算。
// 测之前先在空中放一块孤立方块、拿它当选区：直接拿地表某格的话三个目标格
// 本来就是同一种方块，diff 为空——断言会因为"没变化"而红，而那恰恰是正确行为。
const bp5 = await blockPoint();
await useTool("place");
await stroke(bp5.x, bp5.y, bp5.x, bp5.y);
const sel = { x: bp5.ax, y: bp5.ay, z: bp5.az };
const lone = await page(`
  const ed = window.__editor;
  ed.ctx.setSelection({ x: ${sel.x}, y: ${sel.y}, z: ${sel.z} }, { x: ${sel.x}, y: ${sel.y}, z: ${sel.z} });
  ed.ui.setTool("array");
  return ed.world.get(${sel.x}, ${sel.y}, ${sel.z});`);
await stroke(bp5.x, bp5.y, bp5.x + 4, bp5.y + 4);
const arrayed = await lastStep();
const copied = await page(`
  const W = window.__editor.world, want = ${lone};
  return [[1, 0], [0, 1], [1, 1]].filter(([dx, dz]) => W.get(${sel.x} + ${'dx'}, ${sel.y}, ${sel.z} + ${'dz'}) === want).length;`);
ok("阵列按选区尺寸复制出副本（不再是空操作）", lone !== 0 && arrayed.label === "array" && arrayed.n >= 1, JSON.stringify({ lone, arrayed, copied }));
await boxLen();
await boxLen();
await page(`window.__editor.selOps.clearSel(); window.__editor.ui.setTool("place"); return 1;`);

/* ---------- 旋转 / 缩放手柄 ---------- */
await page(`document.querySelector('.mtab[data-menu="model"]').click(); return 1;`);
await new Promise((r) => setTimeout(r, 900));
await page(`
  const it = [...document.querySelectorAll("#modelList .mitem")].find(x => /报名点/.test(x.textContent)) || document.querySelector("#modelList .mitem");
  it.click();
  const m = window.__editor.state.selectedModel;
  // 这一节会真的转、真的缩放它。自动存档已经关了，但"测试改过出厂图上的实体"
  // 这种痕迹不该靠那道闸门去兜，所以把初始 transform 留着，测完原样写回。
  window.__restoreSel = { q: m.object.quaternion.toArray(), s: m.object.scale.toArray(), p: m.object.position.toArray() };
  return 1;`);
await new Promise((r) => setTimeout(r, 500));
// 先只切模式：grabPoint / 真按下之间必须跑过至少一帧，才谈得上"量到的就是屏幕上的那一支"。
// camera.matrixWorldInverse 只有 render() 会刷，而渲染循环的顺序是
// controls.update() → onRender(sync) → render()，所以刚聚焦完直接投影拿到的是上一帧的视图矩阵。
await page(`window.__editor.gizmo.setMode("rotate"); window.__editor.renderer.onRender(0); return 1;`);
const pA = await page(`const p = window.__editor.gizmo.grabPoint("y"); return { x: +p.x.toFixed(1), y: +p.y.toFixed(1) };`);
await new Promise((r) => setTimeout(r, 300));          // 让真帧跑几拍
const rot = await page(`
  const ed = window.__editor, m = ed.state.selectedModel;
  ed.renderer.onRender(0);
  const cam = ed.renderer.activeCam || ed.renderer.camera;
  const rect = ed.renderer.renderer.domElement.getBoundingClientRect();
  const c = m.object.position.clone().project(cam);
  const ctr = { x: rect.left + (c.x + 1) / 2 * rect.width, y: rect.top + (1 - c.y) / 2 * rect.height };
  const a = ed.gizmo.grabPoint("y");
  const ang = 40 * Math.PI / 180, dx = a.x - ctr.x, dy = a.y - ctr.y;
  const hit = ed.gizmo.grabAt({ clientX: a.x, clientY: a.y });
  return { q0: m.object.quaternion.toArray().map(v => +v.toFixed(3)), yaw0: +(m.object.rotation.y * 180 / Math.PI).toFixed(1),
    p1: { x: +a.x.toFixed(1), y: +a.y.toFixed(1) }, tag: hit ? hit.tag : null, radius: +Math.hypot(dx, dy).toFixed(1),
    from: { x: Math.round(a.x), y: Math.round(a.y) },
    to: { x: Math.round(ctr.x + dx * Math.cos(ang) - dy * Math.sin(ang)), y: Math.round(ctr.y + dx * Math.sin(ang) + dy * Math.cos(ang)) } };`);
const drift = +Math.hypot(rot.p1.x - pA.x, rot.p1.y - pA.y).toFixed(1);
// 这条防的是"投影拿上一帧的相机矩阵"：修之前这里差 200 多像素，
// 于是按下点落不到环上，手柄没抓到、反倒被模型拖走。
ok("刚聚焦就量到的抓点，跑过一帧后仍在原地，并且真抓得住", drift < 2 && rot.tag === "rot:y" && rot.radius > 30, JSON.stringify({ drift, tag: rot.tag, radius: rot.radius }));
await stroke(rot.from.x, rot.from.y, rot.to.x, rot.to.y);
const turned = await page(`
  const ed = window.__editor, m = ed.state.selectedModel;
  const e = (ed.collectEntities() || []).find(x => x.name === (m.name || m.meshName)) || null;
  return { q: m.object.quaternion.toArray().map(v => +v.toFixed(3)), yaw: +(m.object.rotation.y * 180 / Math.PI).toFixed(1),
    orient: m.orientation && m.orientation.map(v => +v.toFixed(3)), dirty: ed.state.dirty,
    saved: e && e.orientation && e.orientation.map(v => +v.toFixed(3)) };`);
ok("拖旋转环真的把模型转了（朝向变了且记成一次改动）",
  JSON.stringify(turned.q) !== JSON.stringify(rot.q0) && Math.abs(turned.yaw - rot.yaw0) > 8 && turned.dirty === true,
  JSON.stringify({ before: rot.yaw0, after: turned.yaw }));
// 保存链路读的必须是 object 的四元数，否则界面上转了、存盘回到没转的样子。
const sameQ = !!turned.saved && !!turned.orient && turned.saved.join(",") === turned.orient.join(",");
ok("旋转结果写进 entitiesTree 的 orientation（不是单位四元数）",
  sameQ && turned.saved.join(",") !== "0,0,0,1", JSON.stringify({ saved: turned.saved, orient: turned.orient }));

const sc = await page(`
  const ed = window.__editor, m = ed.state.selectedModel;
  ed.gizmo.setMode("scale"); ed.renderer.onRender(0);
  const p = ed.gizmo.grabPoint("x");
  const c = (() => { const cam = ed.renderer.activeCam || ed.renderer.camera;
    const rect = ed.renderer.renderer.domElement.getBoundingClientRect();
    const v = m.object.position.clone().project(cam);
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height }; })();
  const dx = p.x - c.x, dy = p.y - c.y, L = Math.hypot(dx, dy) || 1;
  return { s0: m.object.scale.toArray().map(v => +v.toFixed(4)),
    from: { x: Math.round(p.x), y: Math.round(p.y) },
    to: { x: Math.round(p.x + dx / L * 34), y: Math.round(p.y + dy / L * 34) } };`);
await stroke(sc.from.x, sc.from.y, sc.to.x, sc.to.y);
const scaled = await page(`const s = window.__editor.state.selectedModel.object.scale; return s.toArray().map(v => +v.toFixed(4));`);
// 单轴缩放只该动那一根：另外两轴原地不动，才叫"拖 X 端头改 X"。
ok("拖 X 端头只把 X 轴拉长，Y/Z 一点不动",
  scaled[0] > sc.s0[0] * 1.05 && Math.abs(scaled[1] - sc.s0[1]) < 1e-6 && Math.abs(scaled[2] - sc.s0[2]) < 1e-6,
  JSON.stringify({ before: sc.s0, after: scaled }));

const uni = await page(`
  const ed = window.__editor, m = ed.state.selectedModel;
  ed.renderer.onRender(0);
  const p = ed.gizmo.grabPoint("center");
  return { s0: m.object.scale.toArray().map(v => +v.toFixed(6)), from: { x: Math.round(p.x), y: Math.round(p.y) }, to: { x: Math.round(p.x), y: Math.round(p.y) - 46 } };`);
await stroke(uni.from.x, uni.from.y, uni.to.x, uni.to.y);
const unified = await page(`const s = window.__editor.state.selectedModel.object.scale; return s.toArray().map(v => +v.toFixed(6));`);
// 比的是"三轴乘的是不是同一个系数"。4 位小数会把 0.1006944 报成 0.1007，
// 那个误差比这条判据本身还大——留着就会得到一个谁都解释不了的红。
const r0 = unified[0] / uni.s0[0], r1 = unified[1] / uni.s0[1], r2 = unified[2] / uni.s0[2];
ok("拖中间立方体是等比缩放，三轴同比例",
  r0 > 1.05 && Math.abs(r0 - r1) < 1e-4 && Math.abs(r1 - r2) < 1e-4,
  JSON.stringify({ before: uni.s0, after: unified, r: [r0, r1, r2].map(v => +v.toFixed(5)) }));

// 手柄按住后拖到面板上松手：这一串事件里视口收不到 pointerup。
// 不兜住的话 drag 一直挂着，之后每一次工具拖动的 move/up 都被吞掉——
// 症状正是"突然拆不掉方块、也建不了东西"，而且只能刷新页面恢复。
await page(`window.__editor.gizmo.setMode("move"); window.__editor.renderer.onRender(0); return 1;`);
const hp = await page(`const p = window.__editor.gizmo.grabPoint("y"); return { x: Math.round(p.x), y: Math.round(p.y) };`);
await mdown(hp.x, hp.y);
await mmove(hp.x + 40, hp.y - 60);
await mup(1350, 430);                       // 落在右侧面板上，视口收不到这次松开
await new Promise((r) => setTimeout(r, 200));
const afterStuck = await page(`return window.__editor.gizmo.grabbing;`);
// 先回搭建工作区再测建造。模型工作区里（ctx.mode === "model"）指针本来就该归
// "拖模型 / 摆手持模型"，盒工具在那儿一次也建不出来——那是工作区让位，不是手柄吞点击。
await page(`document.querySelector('.mtab[data-menu="build"]').click(); return 1;`);
await new Promise((r) => setTimeout(r, 600));
const ws = await page(`return { mode: window.__editor.ctx.mode, giz: window.__editor.gizmo.visible, sel: !!window.__editor.state.selectedModel };`);
await useTool("box");
const bp6 = await blockPoint();
await stroke(bp6.x, bp6.y, bp6.x + 200, bp6.y + 130);
const survived = await lastStep();
ok("在手柄外松手不会把手柄卡在拖动态", afterStuck === null, JSON.stringify(afterStuck));
// 门槛是"这一次拖拽提交了盒子"，不是"盒子有多大"：视角已经聚焦到一个小模型上，
// 200 像素也只跨几格，把 n>=8 写在这里只会得到一条说不出所以然的红。
ok("卡住之后工具照样能用（这条防的是全瘫）",
  ws.mode === "build" && ws.giz === true && ws.sel === true && survived.label === "box" && survived.n >= 2,
  JSON.stringify({ ws, survived }));
await boxLen();

// 手柄只吃"正落在它上面"的那一次按下：旁边照样能建。
const near = await page(`
  const ed = window.__editor, m = ed.state.selectedModel;
  ed.renderer.onRender(0);
  const p = ed.gizmo.grabPoint("y");
  return { at: !!ed.gizmo.grabAt({ clientX: p.x, clientY: p.y }), far: !!ed.gizmo.grabAt({ clientX: p.x + 120, clientY: p.y + 120 }) };`);
await useTool("box");
const bp7 = await blockPoint();
await stroke(bp7.x, bp7.y, bp7.x + 200, bp7.y + 120);
const withModel = await lastStep();
ok("选中模型时手柄不吞掉远处的建造",
  near.at === true && near.far === false && withModel.label === "box" && withModel.n >= 2,
  JSON.stringify({ near, n: withModel.n }));
await boxLen();
await page(`
  const ed = window.__editor, r = window.__restoreSel, m = ed.state.selectedModel;
  if (r && m) { m.object.quaternion.fromArray(r.q); m.object.scale.fromArray(r.s); m.object.position.fromArray(r.p); m.orientation = r.q; }
  ed.state.selectedModel = null; ed.gizmo.setMode("move"); ed.ui.setTool("place");
  return 1;`);

/* ---------- 脚本编辑的日常四件套（真实键盘） ---------- */
// 同一条理由：Tab / Enter / Ctrl+/ 这些必须用 Input.dispatchKeyEvent 打，
// 合成 KeyboardEvent 的 code/modifiers 是测试自己编的，测不出"浏览器实际会不会走到这里"。
async function pressKey(k, code, modifiers = 0) {
  for (const type of ["keyDown", "keyUp"]) {
    await s.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vkOf(code), ...(modifiers ? { modifiers } : {}) });
  }
  await new Promise((r) => setTimeout(r, 140));
}
function vkOf(code) { return code === "Tab" ? 9 : code === "Enter" ? 13 : code === "Slash" ? 191 : 0; }
const codeVal = () => page(`return document.getElementById("scriptCode").value;`);
const putCode = (text, s0, s1) => page(`
  const ta = document.getElementById("scriptCode");
  ta.value = ${JSON.stringify(text)};
  ta.selectionStart = ${s0}; ta.selectionEnd = ${s1 == null ? s0 : s1};
  ta.focus(); ta.dispatchEvent(new Event("input")); return 1;`);

await page(`document.querySelector('.mtab[data-menu="script"]').click(); return 1;`);
await wait(`document.getElementById("scriptScreen").classList.contains("show")`, 60000, "脚本工作区已打开");
const origCode = await codeVal();
await page(`window.__editor.__scriptIdx = 0; return 1;`);

await putCode("aaa\nbbb\nccc", 0, 11);
await pressKey("Tab", "Tab");
const indented = await codeVal();
await pressKey("Tab", "Tab", 8);                                   // Shift+Tab
const outdented = await codeVal();
// 旧行为：Tab 把整个选区替换成两个空格 —— 选中一段代码按下去，代码就没了。
ok("Tab 缩进整块、Shift+Tab 退回，一个字都不丢",
  indented === "  aaa\n  bbb\n  ccc" && outdented === "aaa\nbbb\nccc",
  JSON.stringify({ indented, outdented }));

await putCode("function f() {", 14);
await pressKey("Enter", "Enter");
const afterBrace = await codeVal();
await putCode("if (a) {}", 8);
await pressKey("Enter", "Enter");
const expanded = await codeVal();
ok("回车自动接上缩进：{ 结尾多一级，夹在 {|} 中间会把收尾挪下去",
  afterBrace === "function f() {\n  " && expanded === "if (a) {\n  \n}",
  JSON.stringify({ afterBrace, expanded }));

await putCode("aaa\nbbb", 0, 7);
await pressKey("/", "Slash", 2);
const commented = await codeVal();
await pressKey("/", "Slash", 2);
const uncommented = await codeVal();
ok("Ctrl+/ 成对地加注释与去注释", commented === "// aaa\n// bbb" && uncommented === "aaa\nbbb",
  JSON.stringify({ commented, uncommented }));

await putCode("l1\nl2\nl3\nl4", 9);
await page(`document.getElementById("scriptCode").dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown", bubbles: true })); return 1;`);
await new Promise((r) => setTimeout(r, 350));
const curLine = await page(`
  const g = document.getElementById("scriptGutter");
  const cur = g.querySelector(".ln.cur"), row = document.getElementById("scriptHi").querySelector(".cur-row");
  const spans = g.querySelectorAll(".ln");
  return { ln: cur && cur.dataset.ln, rowTop: row && row.style.top,
    pitch: spans.length > 1 ? +(spans[1].getBoundingClientRect().top - spans[0].getBoundingClientRect().top).toFixed(1) : -1 };`);
// pitch 必须是 20（与诊断标记、当前行用的 LH 同一个值）。
// 行号改成块级之后，innerHTML 里那些 \n 会再各占一行，实测行距翻成 40 ——
// 数字看着还是 1..n 很整齐，标记却全错位半行，这种错只有量一次才知道。
ok("当前行高亮落在正确行上，且行号槽行距仍是 20px",
  curLine.ln === "4" && curLine.rowTop === "72px" && curLine.pitch === 20, JSON.stringify(curLine));

/* ---------- API 补全弹窗（真实键盘） ---------- */
// 逐字符走 Input.dispatchKeyEvent（带 text），这样插入、keydown、input 三件事的顺序
// 和真人打字一致。用 insertText 只发得到 input，弹窗能开但键盘导航测不到。
async function typeChar(ch) {
  const code = ch === "." ? "Period" : /^[0-9]$/.test(ch) ? "Digit" + ch : "Key" + ch.toUpperCase();
  const vk = ch === "." ? 190 : ch.toUpperCase().charCodeAt(0);
  await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, windowsVirtualKeyCode: vk, text: ch, unmodifiedText: ch });
  await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk });
  await new Promise((r) => setTimeout(r, 70));
}
const typeWord = async (w) => { for (const ch of w) await typeChar(ch); };
const acState = () => page(`
  const pop = document.querySelector(".ac-pop"), ta = document.getElementById("scriptCode");
  const items = [...pop.querySelectorAll(".ac-it")];
  const on = items.find((n) => n.classList.contains("on"));
  const r = pop.getBoundingClientRect(), b = ta.getBoundingClientRect();
  return { show: pop.classList.contains("show"), n: items.length,
    labels: items.slice(0, 8).map((x) => x.querySelector("b").textContent),
    sel: on ? on.querySelector("b").textContent : null,
    doc: on ? on.querySelector(".ac-d").textContent.trim().slice(0, 40) : null,
    foot: pop.querySelector(".ac-doc").textContent.trim().slice(0, 40),
    left: Math.round(r.left - b.left), top: Math.round(r.top - b.top),
    inside: r.right <= b.right + 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1,
    caret: ta.selectionStart, value: ta.value };`);

await putCode("", 0);
await typeWord("world");
const acWord = await acState();
ok("打字母就出候选：world 命中官方全局，带类型与中文说明",
  acWord.show && acWord.sel === "world" && /游戏世界/.test(acWord.doc), JSON.stringify(acWord));

await typeChar(".");
const acDot = await acState();
// GameWorld 有 111 个成员，一次只列 40 个：刚打完点就该看到东西（全量列出来是一堵墙），
// 剩下的靠继续打字收窄。
ok("world. 列出 GameWorld 的成员并截到 40 条",
  acDot.show && acDot.n === 40 && acDot.labels.includes("createEntity"), JSON.stringify({ n: acDot.n, labels: acDot.labels }));

await typeWord("onP");
const acNarrow = await acState();
await pressKey("ArrowDown", "ArrowDown");
const acDown = await acState();
await pressKey("ArrowUp", "ArrowUp");
const acUp = await acState();
ok("继续打字收窄，上下键在候选之间走",
  acNarrow.show && /^onP/.test(acNarrow.sel || "") && acDown.sel !== acNarrow.sel && acUp.sel === acNarrow.sel,
  JSON.stringify({ n: acNarrow.n, sel: acNarrow.sel, down: acDown.sel, up: acUp.sel }));

const pickLabel = acNarrow.sel;      // 排序按"前缀匹配 → 短的在前"，这里不写死名字，只跟着屏幕上的选中项走
await pressKey("Enter", "Enter");
const acAccept = await acState();
ok("Enter 收下候选：事件通道补成可调用形式，光标停在括号里",
  !acAccept.show && acAccept.value === `world.${pickLabel}()` && acAccept.caret === 6 + pickLabel.length + 1,
  JSON.stringify({ value: acAccept.value, caret: acAccept.caret, pickLabel }));
const wrote = await page(`const f = window.__editor.state.scripts[window.__editor.__scriptIdx]; return f ? f.code : null;`);
ok("补全走的是正常输入链路（写回当前脚本文件）",
  new RegExp("world\\." + pickLabel + "\\(\\)").test(String(wrote)), String(wrote).slice(0, 40));

// 属性不能补括号：world.url 补成 url() 就是把错代码塞进文件
await putCode("world.u", 7);
const acProp = await acState();
await pressKey("Enter", "Enter");
const acPropDone = await acState();
ok("属性只补名字、不加括号，脚注给出完整签名",
  acProp.sel === "url" && /url:/.test(acProp.foot) && acPropDone.value === "world.url" && acPropDone.caret === 9,
  JSON.stringify({ sel: acProp.sel, value: acPropDone.value, caret: acPropDone.caret }));

// 弹窗开着时 Tab 是"收下"，不是"缩进"：两个功能抢同一个键，必须有一个明确让位
await putCode("wor", 3);
await pressKey("Tab", "Tab");
const acTab = await acState();
ok("弹窗开着时 Tab 收候选而不是缩进", acTab.value === "world" && !acTab.show, JSON.stringify({ value: acTab.value, show: acTab.show }));

await putCode("wor", 3);
const acBeforeEsc = await acState();
await pressKey("Escape", "Escape");
const acEsc = await acState();
ok("Esc 只关弹窗，不动代码", acBeforeEsc.show && !acEsc.show && acEsc.value === "wor", JSON.stringify(acEsc));

// Ctrl+Space：光标前面什么前缀都没有时手动列全量（IDE 的通用键位）
await putCode("", 0);
const acBlank = await acState();
await pressKey(" ", "Space", 2);
const acManual = await acState();
ok("Ctrl+Space 在没有前缀时列出全部全局（并且不会漏进一个空格）",
  !acBlank.show && acManual.show && acManual.n === 40 && acManual.value === "",
  JSON.stringify({ blank: acBlank.show, n: acManual.n, value: acManual.value }));

// 字符串与注释里不弹：本项目脚本满是 "赛车模板"、"#finish" 这类字面量，
// 它们恰好长得像标识符前缀，弹出来就是挡在打字的路中间。
await putCode('const n = "wor', 14);
const acInString = await acState();
await putCode("// wor", 6);
const acInComment = await acState();
ok("字符串里和注释里打字不弹", !acInString.show && !acInComment.show,
  JSON.stringify({ str: acInString.show, cmt: acInComment.show }));

await putCode("world.zzz", 9);
const acNone = await acState();
ok("收窄到没有一个候选时整块收起，不留空框", !acNone.show, JSON.stringify({ n: acNone.n }));

// 纵向定位：弹窗贴在光标那一行下面。12 + (行号+1)*20，与诊断行/当前行同一套数。
await putCode("wor", 3);
const acPos0 = await acState();
await putCode("aaa\nbbb\nwor", 13);
const acPos2 = await acState();
ok("弹窗贴在光标下面，跨两行正好差 40px",
  acPos0.show && acPos0.top === 32 && acPos2.top === 72 && acPos2.inside,
  JSON.stringify({ t0: acPos0.top, t1: acPos2.top, inside: acPos2.inside }));
await putCode("wor", 3);
const acX = await page(`
  const pop = document.querySelector(".ac-pop"), ta = document.getElementById("scriptCode");
  const cs = getComputedStyle(ta);
  const s = document.createElement("span");
  s.style.cssText = "position:absolute;left:-9999px;white-space:pre";
  s.style.fontFamily = cs.fontFamily; s.style.fontSize = cs.fontSize;
  s.textContent = "0".repeat(40); document.body.appendChild(s);
  const chW = s.getBoundingClientRect().width / 40; s.remove();
  const r = pop.getBoundingClientRect(), b = ta.getBoundingClientRect();
  return { show: pop.classList.contains("show"), left: Math.round(r.left - b.left), want: Math.round(14 + 3 * chW), chW: +chW.toFixed(2) };`);
ok("横向贴着光标列（14 + 列×字宽）", acX.show && Math.abs(acX.left - acX.want) <= 2, JSON.stringify(acX));

// 按端裁剪：服务端脚本不该补出客户端名字，反之也一样
await page(`window.__editor.__scriptIdx = 1; return 1;`);
await putCode("voxels", 6);
const acCliSrv = await acState();
await putCode("ui", 2);
const acCli = await acState();
await typeChar(".");
const acCliDot = await acState();
ok("客户端脚本补不出 voxels，但补得出 ui 与它的成员",
  !acCliSrv.show && acCli.sel === "ui" && acCliDot.labels.includes("findChildByName"),
  JSON.stringify({ srv: acCliSrv.show, ui: acCli.sel, m: acCliDot.labels }));
await page(`window.__editor.__scriptIdx = 0; return 1;`);
await putCode("", 0);

await putCode(origCode, 0, 0);
await page(`document.querySelector('.mtab[data-menu="build"]').click(); return 1;`);
await new Promise((r) => setTimeout(r, 500));

// 手柄模式是"这个人的习惯"，要活过重载；测完还回默认，免得影响后面的实拍。
await page(`window.__editor.gizmo.setMode("scale"); return 1;`);
await new Promise((r) => setTimeout(r, 200));
const keptMode = await page(`return localStorage.getItem("ly.gizmoMode");`);
await s.goto("http://127.0.0.1:5173/editor.html", { settleMs: 1500 });
await wait(`window.__editor && document.getElementById("sbMode").textContent === "搭建"`, 150000, "重载后编辑器就绪");
const reloaded = await page(`return { mode: window.__editor.gizmo.mode, on: document.querySelector('#gizModes [data-gm="scale"]').classList.contains("on") };`);
ok("手柄模式记在本地并在重载后恢复", keptMode === "scale" && reloaded.mode === "scale" && reloaded.on, JSON.stringify({ keptMode, reloaded }));
await page(`window.__editor.gizmo.setMode("move"); return 1;`);

await s.close();
process.exit(0);
