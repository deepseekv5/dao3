// voxa-ui.test.mjs — VOXA 交互层回归（真指针事件 + 真 DOM）
//
// 为什么必须常驻：public/js/voxa/app.js 与 view.js 一共近 2000 行交互与渲染代码，
// 之前一条断言都没有（test/voxa.test.mjs 只测 model.js 的纯函数）。这一层的 bug
// 全是"看起来正常"那一类：撤销不干净、高亮只亮一格、透明度存盘即丢——
// 类型检查和纯函数测试都抓不到，只有真的按下去、拖一下、存一遍才暴露。
//
// 运行：npm run serve &  然后  npm run test:voxa-ui
import { launchChrome, Session } from "./cdp.mjs";

const ok = (name, cond, extra = "") => console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  " + extra : ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { port } = await launchChrome({});
const s = await Session.open(port, { width: 1440, height: 900,
  initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3");localStorage.removeItem("dao3_voxa_model")}catch(e){}' ] });
const page = (b) => s.evaluate(`(async () => { ${b} })()`);
const wait = async (cond, ms = 60000, label = cond) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page(`return (${cond});`).catch(() => false)) return true; await sleep(250); }
  ok(`超时：${label}`, false); return false;
};

await s.goto("http://127.0.0.1:5173/voxa", { settleMs: 5000 });
await wait(`!!window.__voxa && !!window.__voxa.doc && window.__voxa.doc.parts.length > 0`, 90000, "VOXA 就绪");

/* ---------- 底栏初值：DOM 说开着，画面就得是开着 ---------- */
const boot = await page(`const a = window.__voxa;
  return { edges: a.view._edges, glow: a.view._glowOn,
    edgeSel: document.getElementById("vxEdge").value,
    statOn: document.getElementById("uStat").classList.contains("on"),
    statShown: getComputedStyle(document.getElementById("vxStat")).display !== "none",
    glowBtn: document.getElementById("uGlow").classList.contains("on") };`);
ok("底栏开关的初值与渲染状态一致（不用点两下才生效）",
  boot.edges === true && boot.glow === true && boot.statOn === boot.statShown && boot.glowBtn === boot.glow,
  JSON.stringify(boot));

/** 找一个真的能命中部件 / 骨骼的屏幕点：坐标由渲染层自己算，不在测试里猜 */
const findPoint = (kind) => page(`
  const v = window.__voxa.view, r = v.canvas.getBoundingClientRect();
  for (let gx = 0.2; gx <= 0.8; gx += 0.04) for (let gy = 0.2; gy <= 0.8; gy += 0.04) {
    const e = { clientX: r.left + r.width * gx, clientY: r.top + r.height * gy };
    if (${kind === "bone" ? "v.pickBone(e)" : "v.pickVoxel(e)"}) return { x: e.clientX, y: e.clientY };
  }
  return null;`);

/** 等相机停住：OrbitControls 开了阻尼，上一次右键的余量还会继续漂一秒上下。
 *  漂着的时候取到的命中点，下一次 evaluate 就已经打不中了——测试会以为拖拽没生效。 */
async function settle(maxMs = 2500) {
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const now = await page(`const c = window.__voxa.view.camera.position; return [c.x, c.y, c.z].map((v) => v.toFixed(3)).join(",");`);
    if (last !== null && now === last) return true;
    last = now;
    await sleep(150);
  }
  return false;
}
async function drag(from, to) {
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6, button: "left", buttons: 1 });
    await sleep(20);
  }
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0 });
  await sleep(220);
}
const partPos = () => page(`return window.__voxa.doc.parts[0].pos.slice();`);

/* ---------- 部件拖拽：一步一撤 ---------- */
await page(`window.__voxa.setTool("move"); window.__voxa.undoStack.length = 0; return 1;`);
const p0 = await partPos();
await settle();
const hit = await findPoint("voxel");
ok("视口里能找到可命中的体素点（否则下面几条测不到）", !!hit, JSON.stringify(hit));
await drag(hit, { x: hit.x + 120, y: hit.y - 70 });
const p1 = await partPos();
await page(`window.__voxa.undo(); return 1;`);
const p2 = await partPos();
ok("拖动部件改位置，撤销一步就回到拖之前（快照必须拍在改动前）",
  JSON.stringify(p1) !== JSON.stringify(p0) && JSON.stringify(p2) === JSON.stringify(p0),
  JSON.stringify({ p0, p1, p2 }));

/* ---------- 数值框改位置也要进撤销栈 ---------- */
// 官方形态是三个独立数字格（X/Y/Z 各一格），所以这里只动 X 一格：
// 只想改一个数就得把三个数重打一遍，是"0, 0, 0"挤一格那种文本框的毛病。
await page(`const i = document.querySelector('#vxProps input[data-vec="pos"][data-i="0"]');
  i.value = "7"; i.dispatchEvent(new Event("change")); return 1;`);
await sleep(200);
const p3 = await partPos();
await page(`window.__voxa.undo(); return 1;`);
const p4 = await partPos();
ok("数值框改位置进撤销栈（只动 X 一格，另两格不受牵连）",
  p3[0] === 7 && JSON.stringify(p3.slice(1)) === JSON.stringify(p0.slice(1)) && JSON.stringify(p4) === JSON.stringify(p0),
  JSON.stringify({ p3, p4 }));

/* ---------- 框选高亮：容量 1 的缓冲写 4000 个实例 ---------- */
await page(`window.__voxa.setInPart(true); window.__voxa.setTool("select"); return 1;`);
await sleep(200);
const inPart = await page(`return window.__voxa.inPart;`);
if (inPart) {
  await settle();
  const a = await findPoint("voxel");
  await drag(a, { x: a.x + 90, y: a.y + 60 });
  const sel = await page(`const v = window.__voxa.view; return { n: window.__voxa.selection.length, drawn: v.selMesh.count, cap: v.selMesh.instanceMatrix.count };`);
  ok("框选的高亮格数等于选中格数（高亮层容量按上限分配，不是 1）",
    sel.n > 3 && sel.drawn === sel.n && sel.cap >= sel.n, JSON.stringify(sel));
  await page(`window.__voxa.setInPart(false); return 1;`);
}

/* ---------- 部件不透明度：要进画面、要存得住 ---------- */
const opq = await page(`
  const a = window.__voxa, p = a.doc.parts[0];
  const sl = document.querySelector("#vxProps input[type=range]");
  if (!sl) return { err: "参数面板里没有不透明度滑杆" };
  sl.value = "0.4"; sl.dispatchEvent(new Event("input"));
  const n = a.view.partNodes.get(p.id);
  const back = a.constructor ? null : null;
  const ser = JSON.parse(JSON.stringify(a.doc));
  return { model: p.opacity, mat: n.mesh ? +n.mesh.material.opacity.toFixed(2) : null,
    transparent: n.mesh ? n.mesh.material.transparent : null, ser: ser.parts[0].opacity };`);
ok("部件不透明度：滑杆改得动、材质跟得上、序列化带得走",
  !opq.err && opq.model === 0.4 && opq.mat === 0.4 && opq.transparent === true && opq.ser === 0.4,
  JSON.stringify(opq));

/* ---------- 骨骼不透明度：applyPose 不能把它冲回 1 ---------- */
const bop = await page(`
  const a = window.__voxa;
  a.setMode ? a.setMode("anim") : document.querySelector('#vxModes [data-mode="anim"]').click();
  const b = a.doc.bones[a.doc.bones.length - 1];
  a.activeBone = b; a.renderProps();
  const sl = document.querySelector("#vxProps input[type=range]");
  if (!sl) return { err: "动画参数面板没有不透明度滑杆" };
  sl.value = "0.25"; sl.dispatchEvent(new Event("input"));
  a.view.applyPose(a.doc, a.doc.anims[a.doc.curAnim] || null, 0);
  const o = a.view.boneNodes.get(b.id);
  return { model: b.op, runtime: o ? o.userData.op : null, ser: JSON.parse(JSON.stringify(a.doc)).bones.find((x) => x.id === b.id).op };`);
ok("骨骼不透明度存得下、applyPose 之后还在（先前每帧被冲回 1）",
  !bop.err && bop.model === 0.25 && bop.runtime === 0.25 && bop.ser === 0.25, JSON.stringify(bop));

/* ---------- 局部 / 世界坐标：切了数字必须不一样 ---------- */
const sp = await page(`
  const a = window.__voxa, doc = a.doc, p = doc.parts[0];
  const b = { id: "probe-bone", name: "探针骨", parent: "root", position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], op: 1 };
  doc.bones.push(b);
  p.pos = [0, 0, 0]; p.bone = b.id;
  a.setMode ? a.setMode("model") : document.querySelector('#vxModes [data-mode="model"]').click();
  a.activePart = p; a.view.rebuild();
  const read = () => [...document.querySelectorAll('#vxProps input[data-vec="pos"]')].map((i) => i.value).join(",");
  a.space = "local"; a.renderProps(); const local = read();
  a.space = "world"; a.renderProps(); const world = read();
  return { local, world };`);
ok("部件绑在偏移过的骨骼上：局部与世界坐标读数不同",
  !!sp.local && !!sp.world && sp.local !== sp.world && /5/.test(sp.world), JSON.stringify(sp));

/* ---------- 骨骼拖拽：位移跟着指针，不是越拖越快 ---------- */
await page(`document.querySelector('#vxModes [data-mode="anim"]').click(); return 1;`);
await sleep(250);
await page(`const a = window.__voxa; a.undoStack.length = 0; return 1;`);
// 拾取到的不一定是我预埋那根骨骼（Root 的标记也在指针下面），
// 所以先把每根骨骼的起点记下来，再按"实际被拖走的那根"来判定。
const bonesBefore = await page(`return window.__voxa.doc.bones.map((b) => ({ id: b.id, pos: b.position.slice() }));`);
await settle();
const bp = await findPoint("bone");
if (bp) {
  await drag(bp, { x: bp.x + 100, y: bp.y });
  const after = await page(`const b = window.__voxa.activeBone; return b ? { id: b.id, pos: b.position.slice() } : null;`);
  const was = bonesBefore.find((b) => after && b.id === after.id);
  await page(`window.__voxa.undo(); return 1;`);
  const back = await page(`const b = window.__voxa.activeBone; return b ? b.position.slice() : null;`);
  const dx = after && was ? after.pos[0] - was.pos[0] : 0;
  // 100px × 0.06 = 6 格。旧实现每个 pointermove 都再加一遍"距起点的总位移"，
  // 6 步下来是 6+12+18+…的量级，所以"落在 3..9 之间"才说明它真的跟手。
  ok("骨骼拖拽跟手（增量从起点算，不是每帧累加）且能撤销",
    !!after && !!was && dx > 3 && dx < 9 && JSON.stringify(back) === JSON.stringify(was.pos),
    JSON.stringify({ picked: after && after.id, from: was && was.pos, to: after && after.pos, dx: +dx.toFixed(2), back }));
} else {
  ok("视口里能找到可命中的骨骼点", false, "扫描 15×15 个点都没命中骨骼");
}

const setMode = (m) => page(`document.querySelector('#vxModes [data-mode="${m}"]').click(); return window.__voxa.mode = "${m}";`);
/* 骨骼不透明度与骨骼拖拽那两节把模式留在了 anim，后面几节要的是部件层，
   模式不显式切回去就会测到另一套面板与另一条分支（右键会弹骨骼菜单）。 */
await setMode("model");
await page(`const a = window.__voxa; a.activePart = a.doc.parts[0]; a.view.setActivePart(a.doc.parts[0]); a.renderProps(); return 1;`);
await sleep(200);
const axis = await page(`
  const rows = [...document.querySelectorAll("#vxProps .vx-axis2")];
  return { n: rows.length,
    labels: rows.map((r) => r.querySelector("label").textContent),
    caps: rows.map((r) => [...r.querySelectorAll(".vx-axcell em")].map((e) => e.textContent).join("/")),
    boxes: rows[0] ? rows[0].querySelectorAll("input[type=number]").length : 0,
    pct: !!document.querySelector("#vxProps .vx-pct input[type=number]") };`);
const overflow = await page(`
  const pr = document.getElementById("vxProps").getBoundingClientRect();
  return [...document.querySelectorAll("#vxProps .vx-axis2")].filter((r) => r.getBoundingClientRect().right > pr.right + 1).length;`);
ok("参数面板每行三格 X/Y/Z，旋转带 °、缩放带 %，不透明度有百分比读数框",
  axis.n >= 3 && axis.boxes === 3 && axis.caps.some((c) => c === "X°/Y°/Z°")
  && axis.caps.some((c) => c === "X%/Y%/Z%") && axis.pct === true && overflow === 0,
  JSON.stringify({ ...axis, overflow }));

/* ---------- 色板：命名色组 + 每行 11 块 ---------- */
const pal0 = await page(`
  document.getElementById("vxAddColor").click();
  const heads = [...document.querySelectorAll("#vxPalette .vx-grpline .gp-name")].map((n) => n.textContent);
  return { heads, grids: document.querySelectorAll("#vxPalette .vx-palgrid").length,
    cols: getComputedStyle(document.querySelector("#vxPalette .vx-palgrid")).gridTemplateColumns.split(" ").length,
    palCur: window.__voxa.doc.palCur, groups: [...new Set(window.__voxa.doc.palette.map((c) => c.g))],
    ser: JSON.parse(JSON.stringify(window.__voxa.serialize ? {} : {})) };`);
ok("增加颜色组建出真正的色组：两个组名、两块网格、每行 11 列",
  pal0.heads.length === 2 && pal0.grids === 2 && pal0.cols === 11
  && pal0.groups.length === 2 && pal0.palCur === pal0.heads[1], JSON.stringify(pal0));
const palDel = await page(`
  const a = window.__voxa;
  const free = a.doc.palette.find((c) => a.colorUsedCount(c) === 0 && a.doc.palette.length > 1);
  const before = a.doc.palette.length;
  a.deleteColor(free, 0);
  return { before, after: a.doc.palette.length, hex: free && free.hex };`);
ok("色板里的空闲颜色可删除，删除走撤销栈",
  palDel.after === palDel.before - 1, JSON.stringify(palDel));

/* ---------- 右键菜单（官方三篇 shortcutKeys 讲的全是右键） ---------- */
await setMode("model");
await settle();
const rp = await findPoint("voxel");
await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rp.x, y: rp.y, button: "right", buttons: 2, clickCount: 1 });
await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rp.x, y: rp.y, button: "right", buttons: 0 });
await sleep(250);
const cm = await page(`
  const m = document.querySelector(".vx-pop");
  const p = document.getElementById("vxMenuPanel");
  return { mode: window.__voxa.mode, items: m ? [...m.querySelectorAll("button")].map((b) => b.textContent) : null, topShown: p.classList.contains("show") };`);
ok("命中部件时右键出部件菜单（添加/编辑/复制/重命名/编组/删除）",
  !!cm.items && cm.items.length === 6 && cm.items.includes("编辑部件（进体素）") && cm.items.includes("删除部件")
  && cm.topShown === false, JSON.stringify(cm));

// 菜单还开着的话，它就压在画布上方——下一次按下只会先把它关掉（这是对的交互），
// 但那样就测不到拖拽了，所以这里显式收起。
await page(`window.__voxa.closeMenu(); return 1;`);

/* ---------- 编组要真的整组变换，解组要真的散开 ---------- */
await setMode("model");
const grp = await page(`
  const a = window.__voxa, doc = a.doc, p1 = doc.parts[0];
  a.setInPart(true); a.setTool("build"); a.activePart = p1; a.placeOrErase([0, 0, 0], true); a.setInPart(false);
  document.getElementById("vxAddPart").click();
  const q = doc.parts[doc.parts.length - 1];
  a.setInPart(true); a.activePart = q; a.placeOrErase([0, 0, 0], true); a.setInPart(false);
  q.pos = [10, 0, 0]; a.view.applyPartTransform(q);
  a.picked.clear(); a.picked.add(p1); a.picked.add(q);
  document.getElementById("vxGroup").click();
  const g = a.groupOf(p1);
  const before = [p1.pos.slice(), q.pos.slice()];
  const targets = a.dragTargets(p1).length;
  a.setTool("move");
  return { named: !!g, targets, before, qName: q.name };`);
await settle();
const gpt = await findPoint("voxel");
await drag(gpt, { x: gpt.x + 60, y: gpt.y });
console.log("LOG", await page(`return (window.__log||[]).join(" | ");`));
const after = await page(`
  const a = window.__voxa;
  const ids = ((a.doc.groups || [])[0] || {}).partIds || [];
  const out = {}; for (const id of ids) { const p = a.doc.parts.find((x) => x.id === id); if (p) out[id] = p.pos.slice(); }
  return out;`);
const un = await page(`
  const a = window.__voxa, p1 = a.doc.parts[0];
  a.ungroup(p1);
  return { groups: (a.doc.groups || []).length, targets: a.dragTargets(p1).length, g: p1.group };`);
// 按部件 id 比"各自走了多远"，不数下标：前面的测试已经往 doc.parts 里加过部件
const moved = Object.values(after).map((p, i) => p[0] - grp.before[Math.min(i, 1)][0]);
ok("编组后拖一个成员，同组每个成员走的距离一样；解组后回到只拖一个",
  grp.named && grp.targets === 2 && Object.keys(after).length === 2
  && Math.abs(moved[0] - moved[1]) < 0.01 && Math.abs(moved[0]) > 1
  && un.groups === 0 && un.targets === 1 && un.g === null,
  JSON.stringify({ before: grp.before, after, moved, targets: grp.targets, un }));

/* ---------- 顶栏圆点菜单：默认必须是收起来的 ---------- */
// 时间轴的弹出菜单一度也叫 .vx-menu，把主菜单那条 display:none 一起改掉了，
// 症状是"顶栏摊开一大块菜单、把色板压住"。两边类名分家后这条要钉住。
const topMenu = await page(`const p = document.getElementById("vxMenuPanel");
  const cs = getComputedStyle(p), r = p.getBoundingClientRect();
  return { cls: p.className, display: cs.display, shown: r.width > 0 && r.height > 0 };`);
ok("顶栏圆点菜单默认收起（display:none）",
  topMenu.cls.includes("vx-topmenu") && topMenu.display === "none" && topMenu.shown === false, JSON.stringify(topMenu));

/* ---------- 时间轴：每根骨骼一行、段块带缓动曲线、能拖能删能缩放 ---------- */
// ---------- 时间轴：官方那一整块"骨骼 × 帧"的网格 ----------
// 自己建一条动画来测：前面几节（骨骼不透明度、骨骼拖拽）会往默认 idle 里留下键，
// 共用它的话"文档里有几帧"就成了历史累积的结果，测不到渲染本身。
await page(`
  const a = window.__voxa, doc = a.doc;
  document.querySelector('#vxModes [data-mode="anim"]').click();
  if (!doc.bones.some((b) => b.id === "arm")) {
    doc.bones.push({ id: "arm", name: "左臂", parent: "root", position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1], op: 1 });
  }
  const K = (f, ease) => ({ f, pos: [f / 10, 2, 3], rot: [0, f, 0], scale: [1, 1, 1], op: 1, ease });
  doc.anims.push({ id: "walk", name: "walk-test", fps: 24, tracks: {
    root: [K(0, "step"), K(24, "step")],
    arm: [K(0, "normal"), K(12, "in"), K(30, "out")] } });
  doc.curAnim = doc.anims.length - 1;
  a.renderTimeline();
  return 1;`);
await settle();   // 相机阻尼没停的话，下面取键的屏幕坐标会漂
const counts = () => page(`
  const a = window.__voxa, an = a.doc.anims[a.doc.curAnim] || a.doc.anims[0];
  let keys = 0, segs = 0;
  for (const t of Object.values(an.tracks)) { keys += t.length; segs += Math.max(0, t.length - 1); }
  const rows = [...document.querySelectorAll("#vxTracks .tl-row")];
  return { rows: rows.length, bones: a.doc.bones.length, labels: rows.map((r) => r.querySelector(".tl-bone").textContent),
    keys: document.querySelectorAll(".tl-key").length, segs: document.querySelectorAll(".tl-seg").length,
    wantKeys: keys, wantSegs: segs, curves: [...document.querySelectorAll(".tl-seg path")].map((x) => x.getAttribute("d")) };`);
const c0 = await counts();
ok("时间轴每根骨骼一条轨道，没打键的也列出来",
  c0.rows === c0.bones && c0.labels.some((x) => x.startsWith("左臂")) && c0.labels.some((x) => x.startsWith("Root")),
  JSON.stringify({ rows: c0.rows, bones: c0.bones, labels: c0.labels }));
ok("键与键之间画成段块，段块里带缓动曲线形状（DOM 数量与文档一致）",
  c0.keys === c0.wantKeys && c0.segs === c0.wantSegs && c0.wantKeys === 5 && c0.wantSegs === 3 && new Set(c0.curves).size >= 3,
  JSON.stringify(c0));

/** 按骨骼名找键，不按行号：前面的测试会往 doc.bones 里加骨骼，行号会漂 */
const keyPt = (boneName, keyIdx) => page(`
  const row = [...document.querySelectorAll("#vxTracks .tl-row")]
    .find((r) => r.querySelector(".tl-bone").textContent.startsWith(${JSON.stringify(boneName)}));
  const k = row && row.querySelectorAll(".tl-key")[${keyIdx}];
  if (!k) return null;
  const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
const framesOf = () => page(`const an = window.__voxa.doc.anims[window.__voxa.doc.curAnim]; return (an.tracks.arm || []).map((k) => k.f);`);
const kf0 = await framesOf();
const kp = await keyPt("左臂", 1);
await drag(kp, { x: kp.x + 42, y: kp.y });
const kf1 = await framesOf();
await page(`window.__voxa.undo(); return 1;`);
await sleep(150);
const kf2 = await framesOf();
ok("拖动关键帧改时间（12 → 18）并且能撤销回来",
  JSON.stringify(kf0) === "[0,12,30]" && JSON.stringify(kf1) === "[0,18,30]" && JSON.stringify(kf2) === "[0,12,30]",
  JSON.stringify({ kf0, kf1, kf2 }));

const del = await page(`
  const a = window.__voxa, an = a.doc.anims[a.doc.curAnim];
  a.activeBone = a.doc.bones.find((b) => b.id === "arm");
  const before = an.tracks.arm.map((k) => k.f).join(",");
  a.deleteKey(an, a.activeBone, an.tracks.arm[1]);
  const after = ((a.doc.anims[a.doc.curAnim].tracks.arm) || []).map((k) => k.f).join(",");
  a.undo();
  const back = ((a.doc.anims[a.doc.curAnim].tracks.arm) || []).map((k) => k.f).join(",");
  return { before, after, back };`);
ok("删除单帧生效，且删得掉也撤得回",
  del.before === "0,12,30" && del.after === "0,30" && del.back === "0,12,30", JSON.stringify(del));

const zoomed = await page(`
  const before = document.querySelector(".tl-lane").style.width;
  const z = document.getElementById("vxTlZoom"); z.value = "20"; z.dispatchEvent(new Event("input"));
  return { before, after: document.querySelector(".tl-lane").style.width,
    ruler: document.getElementById("vxRuler").style.width };`);
ok("缩放时间轴：轨道宽度跟着每帧像素走，刻度尺比轨道更宽一格",
  zoomed.before === "222px" && zoomed.after === "612px" && parseInt(zoomed.ruler, 10) > parseInt(zoomed.after, 10),
  JSON.stringify(zoomed));

await settle();
const kp2 = await keyPt("左臂", 1);
await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: kp2.x, y: kp2.y, button: "right", buttons: 2, clickCount: 1 });
await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: kp2.x, y: kp2.y, button: "right", buttons: 0 });
await sleep(250);
const pop = await page(`
  const m = document.querySelector(".vx-pop");
  const p = document.getElementById("vxMenuPanel");
  return { items: m ? [...m.querySelectorAll("button")].map((b) => b.textContent) : null,
    on: m ? [...m.querySelectorAll("button.on")].map((b) => b.textContent) : null,
    topShown: p.classList.contains("show"), topDisplay: getComputedStyle(p).display };`);
ok("帧上右键出缓动菜单（5 档 + 删除），且顶栏菜单不被带出来",
  !!pop.items && pop.items.length === 6 && pop.items[5] === "删除这一帧"
  && pop.topShown === false && pop.topDisplay === "none", JSON.stringify(pop));
await page(`window.__voxa.closeMenu(); return 1;`);

await s.close();
process.exit(0);
