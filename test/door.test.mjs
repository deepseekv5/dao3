/**
 * test/door.test.mjs — 世界之门：图与图之间真的走得通。
 *
 * 为什么值得单独一份：world.teleport 以前是个占位——toast 一句"本地运行不支持跨世界传送"
 * 然后 reject。官网因此只能挂着"跨图连成同一个大世界：还没做"。
 * 这类缺口最会骗人：接口名在、签名对、调用不炸，唯独事情本身没发生。
 * 所以这里判的是"页面真的换到了另一张图"，不是"函数返回了个 Promise"。
 *
 * 门有两种摆法都验：脚本调 world.teleport，以及作者在区域面板里填一个目标（不写代码也能造门）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5900 + ((Date.now() % 250) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-door-"));
const SRC = "216d665d3ca92bd1b9a2";
const DST = "wdoordst";
const AUTHORED = "wdoorauth";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
const cleanup = () => { try { child.kill("SIGKILL"); } catch { /* 已经退了 */ } try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 交给系统 */ } };
process.on("exit", cleanup);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + String(extra).slice(0, 260) : "")); }
};
async function until(expr, tries = 24, ms = 500) {
  for (let i = 0; i < tries; i++) {
    let v = null;
    try { v = await S.evaluate(expr); } catch { /* 正在换页 */ }
    if (v) return v;
    await sleep(ms);
  }
  return false;
}

{
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try { const j = await (await fetch(BASE + "/api/whoami")).json().catch(() => null); if (j && j.app) { up = true; break; } } catch { /* 还没起来 */ }
  }
  if (!up) { console.log("FAIL  测试用的本地服务起不来（端口 " + PORT + "）"); process.exit(1); }
}

let chrome;
try { chrome = await launchChrome({}); }
catch (e) { console.log("SKIP  起不了浏览器，世界之门验收跳过：" + e.message); process.exit(0); }
const S = await Session.open(chrome.port, {
  width: 1280, height: 800, isolated: true,
  initScripts: ['localStorage.setItem("dao3_disclaimer_ack","3");window.__errs=[];'
    + 'addEventListener("error",e=>__errs.push(e.message+" @"+(e.filename||"").split("/").pop()+":"+e.lineno));'
    + 'addEventListener("unhandledrejection",e=>__errs.push("rej:"+((e.reason&&e.reason.message)||e.reason)));'
    // 运行时的 _guard 把子系统异常写成 console.error：它不抛到全局，所以页面"看着没报错"
    // 而整个区域子系统其实已经停了。门就是被这个盲区放过去的，因此这里也接进来。
    + 'const _ce=console.error;console.error=function(){window.__errs.push("console.error:"+String(arguments[0]).slice(0,80)+((arguments[1]&&arguments[1].message)?" / "+arguments[1].message:""));return _ce.apply(null,arguments)};'],
});

async function fork(to, name) {
  const r = await fetch(`${BASE}/api/world/${SRC}/fork?to=${to}&name=${encodeURIComponent(name)}`, { method: "POST" });
  return (await r.json()).ok;
}
const playUrl = (id) => `${BASE}/edit/${id}?play=1`;
async function waitRunning() {
  return until(`!!(window.__game && window.__game.running && window.__game.playerEntity)`, 90, 1000);
}

await S.goto(BASE + "/", { settleMs: 1500 });
await S.evaluate(`fetch("/api/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({racingTemplate:false,racingAssets:false})})`);
await sleep(400);
ok("能复制出目的地那张图", await fork(DST, "门那边") === true);

/* ---------------- 官方错误状态：认不出来的目标要拒绝，而不是假装传送成功 ---------------- */
await S.goto(playUrl(SRC), { settleMs: 2000 });
ok("起点图进得了运行", !!(await waitRunning()));
const bad = await until(`(async () => {
  const g = window.__game;
  const w = g && g.world;
  if (!w || typeof w.teleport !== "function") return "拿不到 world.teleport";
  return await w.teleport("没有这么一张图", [g.playerEntity]).then(() => "resolved", (e) => String(e.status || e.message));
})()`, 12, 500);
ok("world.teleport 认不出目标时按官方状态拒绝", bad === "UNKNOWN", String(bad));
ok("拒绝之后没有换页", await S.evaluate(`location.pathname.includes(${JSON.stringify(SRC)})`),
  await S.evaluate(`location.pathname`));

/* ---------------- 门：运行时加一道指向另一张图的区域，走进去就换图 ---------------- */
const door = await S.evaluate(`(() => {
  const g = window.__game, p = g.playerEntity.position;
  g._addZone({ name: "去门那边", selector: "player", min: [Math.floor(p.x) - 2, Math.floor(p.y) - 2, Math.floor(p.z) - 2],
    max: [Math.floor(p.x) + 2, Math.floor(p.y) + 2, Math.floor(p.z) + 2], goto: ${JSON.stringify(DST)} });
  return !!g.zones.find((z) => z.goto === ${JSON.stringify(DST)});
})()`);
ok("区域能带上门的目标", !!door);
const landed = await until(`location.pathname === "/edit/${DST}" && location.search.includes("play=1")`, 30, 700);
ok("走进门真的换到了另一张图", !!landed, await S.evaluate(`location.href`));
ok("换过去之后运行起来了", !!(await waitRunning()));
const here = await S.evaluate(`JSON.stringify({ wid: window.__editor.worldId, title: window.__editor.state.meta.name })`);
ok("到了目的地，世界与标题都是那张图的", JSON.parse(here).wid === DST && JSON.parse(here).title === "门那边", here);
const crumb = await S.evaluate(`(async () => { try { return sessionStorage.getItem("ly.cameFrom"); } catch { return null } })()`);
ok("来处被记下来了（不然玩家穿两扇门就迷路）", !!crumb && JSON.parse(crumb).id === SRC, String(crumb));

/* ---------------- 菜单里的"回去"：门得能走回来 ---------------- */
await S.evaluate(`window.__game && window.__game._preloadShell(true)`);
const back = await until(`(() => { const b = document.querySelector('#playMenu [data-x="back"]');
  return b && !b.hidden ? b.querySelector("#gmBack").textContent : false; })()`, 16, 500);
ok("菜单给得出「回到上一张」并且写着来处", String(back).includes("起点") || String(back).includes("赛车") || String(back).includes("「"), String(back));
await S.evaluate(`document.querySelector('#playMenu [data-x="back"]').click()`);
ok("点回去真的回到出发那张", await until(`location.pathname === "/edit/${SRC}"`, 30, 700), await S.evaluate(`location.href`));
ok("回去之后照样能跑", !!(await waitRunning()));

/* ---------------- 作者不写代码也能摆门：存进世界 meta 的 goto ---------------- */
ok("能复制出一张「门已经摆好」的图", await fork(AUTHORED, "带门的图") === true);
// 走整档写回，不走 /meta 那个 PATCH：它的白名单只有名称/简介/标签，
// 传 zones 进去会返回 ok:true 而什么都没存下——那种"成功"骗人骗得最狠。
const whole = await (await fetch(`${BASE}/api/world/${AUTHORED}`)).json();
whole.meta = whole.meta || {};
whole.meta.zones = [{ id: "zdoor", name: "通往门那边", selector: "player",
  bounds: { min: [0, 0, 0], max: [48, 32, 48] }, force: [0, 0, 0], massScale: 1, enabled: true, goto: DST }];
const wrote = await (await fetch(`${BASE}/api/world/${AUTHORED}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(whole),
})).json();
const reread = await (await fetch(`${BASE}/api/world/${AUTHORED}`)).json();
ok("门能随世界存档落盘", wrote.ok === true && (reread.meta?.zones || [])[0]?.goto === DST,
  JSON.stringify({ wrote, zone: (reread.meta?.zones || [])[0] }));
await S.goto(playUrl(AUTHORED), { settleMs: 2000 });
await waitRunning();
ok("作者摆的门（不写脚本）也走得通", await until(`location.pathname === "/edit/${DST}"`, 30, 700), await S.evaluate(`location.href`));

/* ---------------- 编辑器里的"通往"下拉：列本机能去的东西，不逼人手抄 20 位 id ---------------- */
// 面板按 meta.zones 逐条出行列，所以要挑一张已经有区域的图来看这一格——
// 空列表时整个区块只有一句"还没有区域"，那时候断言"下拉存在"毫无意义。
await S.goto(`${BASE}/edit/${AUTHORED}`, { settleMs: 2600 });
const opts = await until(`(() => { const sel = [...document.querySelectorAll(".zrow select")].find(s => [...s.options].some(o => o.value === ${JSON.stringify(DST)}));
  return sel ? [...sel.options].map(o => o.value + "|" + o.textContent) : null; })()`, 20, 600);
ok("区域面板里有「通往」下拉", Array.isArray(opts) && opts.length > 1, JSON.stringify(opts));
ok("下拉里能选到本地世界，写的是名字不是 id", !!opts && opts.some((o) => o.startsWith(DST + "|") && /门那边/.test(o)), JSON.stringify(opts));
const labels = await S.evaluate(`(() => { const sel = [...document.querySelectorAll(".zrow select")].find(s => [...s.options].some(o => o.value === ${JSON.stringify(DST)}));
  return sel ? [...sel.options].map(o => o.textContent).join(" / ") : ""; })()`);
ok("目标分得清是本地还是广场来的", /本地 ·/.test(labels) || /广场 ·/.test(labels), labels.slice(0, 160));

const errs = await S.evaluate(`JSON.stringify((window.__errs || []).slice(0, 4))`);
ok("全程没有未捕获错误", errs === "[]", errs);
await S.shot(path.join(ROOT, "tmp/ui-door.png"));

console.log(`\ndoor: ${pass} passed, ${fail} failed`);
await S.close();
process.exit(fail ? 1 : 0);
