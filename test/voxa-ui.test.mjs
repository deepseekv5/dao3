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
await page(`const i = document.querySelector('#vxProps input[data-vec="pos"]');
  i.value = "3, 4, 5"; i.dispatchEvent(new Event("change")); return 1;`);
await sleep(200);
const p3 = await partPos();
await page(`window.__voxa.undo(); return 1;`);
const p4 = await partPos();
ok("数值框改位置进撤销栈（手滑打错一个数能撤回来）",
  JSON.stringify(p3) === JSON.stringify([3, 4, 5]) && JSON.stringify(p4) === JSON.stringify(p0),
  JSON.stringify({ p3, p4 }));

/* ---------- 框选高亮：容量 1 的缓冲写 4000 个实例 ---------- */
await page(`window.__voxa.setInPart(true); window.__voxa.setTool("select"); return 1;`);
await sleep(200);
const inPart = await page(`return window.__voxa.inPart;`);
if (inPart) {
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
  const read = () => document.querySelector('#vxProps input[data-vec="pos"]').value;
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

await s.close();
process.exit(0);
