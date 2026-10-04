// pause.test.mjs — 运行态的「暂停 / 单帧步进」回归。
// 运行：npm run serve &  然后  npm run test:pause
//
// 这块为什么值得单独测：暂停改的是主循环喂时间的方式，
// 最容易出的两种事故是"暂停了世界还在走"（累加器没清）和
// "步进了但画面不动"（插值按 _acc 取，_acc=0 会画回这一 tick 的起点）。
// 两种都能编译通过、都能类型检查通过，只有真跑起来才看得见。
import { launchChrome, Session } from "./cdp.mjs";

const ok = (name, cond, extra = "") => console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  " + extra : ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE || "http://127.0.0.1:5173";
const EDIT = BASE + "/edit/216d665d3ca92bd1b9a2";

const { port } = await launchChrome({});
const s = await Session.open(port, { width: 1440, height: 900, initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")}catch(e){}'] });
async function wait(expr, ms = 120000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await s.evaluate(`(() => !!(${expr}))()`)) return true; await sleep(1000); }
  throw new Error("等超时：" + label);
}
const tick = () => s.evaluate(`window.__game.currentTick`);

await s.goto(EDIT, { settleMs: 8000 });
await wait(`window.__editor && document.getElementById("sbMode").textContent === "搭建"`, 120000, "编辑器就绪");
await s.evaluate(`window.__editor.enterPlay()`);
await wait(`window.__game && window.__game.running && window.__game.player`, 60000, "进入运行模式");
await sleep(1500);

const hud = await s.evaluate(`(() => {
  const bar = document.querySelector(".hud-play");
  return { shown: !!bar && getComputedStyle(bar).display !== "none",
    pause: document.getElementById("pePause").textContent,
    stepDisabled: document.getElementById("peStep").disabled,
    readout: document.getElementById("peTick").textContent,
    paused: !!window.__game.paused };
})()`);
ok("运行控制浮块在、默认不暂停、单帧按钮禁用", hud.shown && hud.pause === "暂停" && hud.stepDisabled && !hud.paused, JSON.stringify(hud));
ok("tick 读数报的是引擎真实的 tick", Number(hud.readout) > 0, JSON.stringify({ readout: hud.readout }));

const a = await tick();
await sleep(600);
const b = await tick();
ok("没暂停时时间真的在走", b > a, JSON.stringify({ a, b }));

await s.click("#pePause");
await sleep(300);
const c = await tick();
await sleep(800);
const d = await tick();
const st = await s.evaluate(`(() => ({ paused: !!window.__game.paused, pause: document.getElementById("pePause").textContent,
  stepDisabled: document.getElementById("peStep").disabled, cls: document.querySelector(".hud-play").className,
  lock: document.pointerLockElement ? document.pointerLockElement.id : "none" }))()`);
ok("暂停后 tick 冻住", st.paused && c === d, JSON.stringify({ c, d }));
ok("暂停态在界面上说得清（按钮变继续、单帧解禁、整块转暂停样式）",
  st.pause === "继续" && !st.stepDisabled && st.cls.includes("paused"), JSON.stringify(st));
// 这一条是顺手抓出来的旧 bug：HUD 的白名单原来是逐个列 class 的，
// 没列到的那一块第一次点击会被"去过指针锁"吃掉，症状是按钮要按两下才生效。
ok("点 HUD 按钮不会把指针锁抢走（第一次点就得生效）", st.lock === "none", JSON.stringify({ lock: st.lock }));

await s.click("#peStep");
await sleep(300);
const e = await tick();
const moved = await s.evaluate(`(() => { const g = window.__game; const rp = g._rp; return { rp: !!rp, still: !!g.paused, tick: g.currentTick }; })()`);
ok("单帧步进只推进一个 tick，且仍停在暂停态", e === d + 1 && moved.still, JSON.stringify({ d, e, moved }));

// 步进完画面必须真的动了：_rp 是插值后的显示位置，画回起点就等于"按了没反应"
const pos = await s.evaluate(`(() => { const g = window.__game; return { x: +g._rp.x.toFixed(3), y: +g._rp.y.toFixed(3), z: +g._rp.z.toFixed(3), p: +g.playerEntity.position.x.toFixed(3) }; })()`);
ok("步进后渲染位置取的是这一 tick 的终点", Math.abs(pos.x - pos.p) < 0.001, JSON.stringify(pos));

await s.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", bubbles: true }))`);
await sleep(400);
const f = await tick();
await sleep(600);
const g2 = await tick();
ok("P 键解除暂停，时间重新走", !(await s.evaluate(`window.__game.paused`)) && g2 > f, JSON.stringify({ f, g2 }));

// 退出再进不能带着上一次的暂停态
await s.evaluate(`(() => { window.__game._togglePause(true); window.__editor.stopPlay(); return true; })()`);
await sleep(600);
await s.evaluate(`window.__editor.enterPlay()`);
await wait(`window.__game && window.__game.running && window.__game.player`, 60000, "第二次进入运行模式");
await sleep(800);
const again = await s.evaluate(`(() => ({ paused: !!window.__game.paused, btn: document.getElementById("pePause").textContent }))()`);
ok("重进运行时暂停态被清掉", !again.paused && again.btn === "暂停", JSON.stringify(again));

// Esc 菜单里也能暂停/单帧，而且菜单上的字必须跟着真实状态走
const menu = await s.evaluate(`(async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const q = (k) => document.querySelector('#playMenu [data-x="' + k + '"] span');
  const t0 = q("pause") && q("pause").textContent;
  const tick0 = window.__game.currentTick;
  q("step") && q("step").click();
  await new Promise(r => setTimeout(r, 300));
  const g = window.__game;
  const out = { t0, paused: !!g.paused, stepped: g.currentTick - tick0,
    label: q("pause") && q("pause").textContent, note: document.getElementById("gmPauseNote").textContent };
  q("resume") && q("resume").click();
  return out;
})()`);
ok("Esc 菜单能暂停与单帧，菜单文字跟着状态走",
  menu.t0 === "暂停世界" && menu.paused && menu.stepped === 1 && menu.label === "继续世界" && /已暂停/.test(menu.note),
  JSON.stringify(menu));

const errs = (s._events || []).filter((m) => m.method === "Runtime.exceptionThrown");
ok("整轮没有页面异常", errs.length === 0, errs.slice(0, 2).map((m) => m.params.exceptionDetails?.exception?.description).join(" | "));

await s.close();
process.exit(0);
