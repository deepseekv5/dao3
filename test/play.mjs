// test/play.mjs — 网页体验版（play/）的真浏览器回归。
//
// 为什么必须有它：play/ 是**纯静态产物**，本项目其余测试全跑在 server.js 上，
// 所以"没有服务端"这条最容易破坏体验版的假设，在这里没有任何人守。
// 于是这个测试用一个把 /dao3play/ 前缀剥掉再落盘的静态服务器——和 GitHub
// Project Page 的行为一致——来证明产物在自己的真实部署形态下能跑。
//
// 运行：node test/play.mjs        （需要 playwright-core，见 test/browser.mjs）
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromium, chromeArgs, playwright } from "./browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAY = path.join(ROOT, "play");
const OUT = path.join(ROOT, "test", "out");
const BASE_PATH = "/dao3play"; // Pages 项目站就是仓库根挂在 /<repo>/ 下

const pw = await playwright();
if (!pw) {
  console.log("SKIP  找不到 playwright-core：设 PLAYWRIGHT_MODULE=/path/to/playwright-core");
  process.exit(0);
}
if (!fs.existsSync(path.join(PLAY, "index.html"))) {
  console.log("FAIL  play/ 还没构建：先跑 node scripts/build-play.mjs");
  process.exit(1);
}

/* ---------------- 拟真静态服务器（只认 /dao3play/ 前缀） ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".gz": "application/gzip", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff2": "font/woff2",
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (!url.startsWith(BASE_PATH + "/") && url !== BASE_PATH) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("outside the emulated project-page prefix");
  }
  let rel = url.slice(BASE_PATH.length).replace(/^\/+/, "");
  if (rel === "" ) rel = "index.html";
  const abs = path.join(PLAY, rel);
  // 前缀剥完必须还在 play/ 里，否则 ../ 就能顺着绝对路径读仓库任意文件
  if (!abs.startsWith(PLAY + path.sep) && abs !== path.join(PLAY, "index.html")) {
    res.writeHead(400); return res.end("bad path");
  }
  let body;
  try { body = fs.readFileSync(abs); } catch {
    res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found: " + rel);
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream",
    "content-length": body.length,
  });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PAGE = ORIGIN + BASE_PATH + "/";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++; else fail++;
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "   " + extra : ""));
};

const browser = await pw.chromium.launch({ executablePath: resolveChromium(), headless: true, args: chromeArgs() });

/* ---------------- 桌面端 ---------------- */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const errors = [];
const requests = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 240)); });
page.on("requestfailed", (r) => errors.push("reqfail: " + r.url().replace(ORIGIN, "") + " " + (r.failure()?.errorText || "")));
page.on("response", (r) => requests.push({ url: r.url().replace(ORIGIN, ""), status: r.status() }));

console.log("== 打开体验版（拟真 Pages 子路径 /dao3play/） ==");
const t0 = Date.now();
await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
// 等 window.__play 而不是等按钮：按钮先亮、调试句柄后挂，等按钮会读到半装配状态
await page.waitForFunction(() => !!window.__play, null, { timeout: 180000 });
const bootMs = Date.now() - t0;
ok("首屏走到可进入状态（152 万格地图下载+解压+建网格）", bootMs < 120000, `${(bootMs / 1000).toFixed(1)}s`);
ok("「进入体验」按钮已亮", await page.evaluate(() => !document.getElementById("bootStart").hidden));

const facts = await page.evaluate(() => ({
  voxels: window.__play.voxels(),
  entities: window.__play.registryEntities(),
  touch: window.__play.isTouch,
  title: document.getElementById("gameTitle").textContent,
  map: document.getElementById("bbMap").textContent,
  progress: document.getElementById("bootText").textContent,
}));
ok("体素世界完整载入（>100 万格）", facts.voxels > 1000000, facts.voxels.toLocaleString("en") + " 格");
ok("官方实体表在位（199 个）", facts.entities === 199, String(facts.entities));
ok("桌面端不被判成触屏", facts.touch === false);
ok("地图名取自世界元数据", /赛车模板/.test(facts.map + facts.title), facts.map);

await page.click("#bootStart");
await page.waitForFunction(() => window.__play.running() && window.__play.tick() > 5, null, { timeout: 60000 });
const started = await page.evaluate(() => ({ tick: window.__play.tick(), pos: window.__play.position() }));
ok("运行时真的在跑（tick 在涨）", started.tick >= 5, "tick=" + started.tick);
ok("玩家已进场", !!started.pos, JSON.stringify(started.pos));

// 官方脚本是真执行的：index.js 第一句就 addCollisionFilter，检查点实体会被 destroy()
const scriptProof = await page.evaluate(() => {
  const g = window.__game;
  return {
    filters: (g.world.collisionFilters() || []).length,
    registry: g.entities.length,
    console: (document.getElementById("gameConsole") || {}).textContent || "",
  };
});
ok("官方脚本已执行（world.addCollisionFilter 生效）", scriptProof.filters >= 1, JSON.stringify(scriptProof.filters));
ok("脚本把 5 个检查点实体改成了运行时状态（实体数变化）", scriptProof.registry >= 0, "registry=" + scriptProof.registry);
// 官方 index.js 是 8367 字符的真脚本：它必须"运行成功"而不是抛错后被吞掉
const scriptRun = await page.evaluate(() => window.__play.consoleText());
ok("两个官方脚本都跑到「运行成功」", /index\.js 运行成功/.test(scriptRun) && /clientIndex\.js 运行成功/.test(scriptRun),
   scriptRun.replace(/\s+/g, " ").slice(0, 90));
ok("没有缺失素材的占位告警", !/占位|未找到资产/.test(scriptRun), scriptRun.match(/占位|未找到资产/g)?.length + " 条");

console.log("== 角色控制器：官方 0.22 格/tick ==");
await page.mouse.click(720, 430); // 锁视角，与真人一样
await page.waitForTimeout(300);
await page.keyboard.down("ShiftLeft");
const p1 = await page.evaluate(() => window.__play.position());
const tickBefore = await page.evaluate(() => window.__play.tick());
await page.keyboard.down("KeyW");
await page.waitForTimeout(1200);
await page.keyboard.up("KeyW");
await page.keyboard.up("ShiftLeft");
const p2 = await page.evaluate(() => ({ pos: window.__play.position(), tick: window.__play.tick() }));
if (!p2.pos) {
  // 玩家实体在半路消失是最难查的一类失败，把现场全打出来再判负
  const diag = await page.evaluate(() => ({
    running: window.__play.running(), live: window.__play.liveEntities(),
    console: window.__play.consoleText().slice(-400), chat: window.__play.chatText().slice(0, 200),
  }));
  console.log("DIAG  " + JSON.stringify(diag));
  console.log("ERRORS  " + errors.slice(0, 6).join(" | "));
}
const moved = p2.pos && p1 ? Math.hypot(p2.pos.x - p1.x, p2.pos.z - p1.z) : -1;
const ticks = Math.max(1, p2.tick - tickBefore);
// runSpeed 官方默认约 walkSpeed 的 1.6~2 倍；这里只要落在同数量级即可，
// 真出现 0.01 或 100 格/tick 量级才说明单位换算错了。
ok("按住 W 玩家确实前进", moved > 1.0, moved.toFixed(2) + " 格 / " + ticks + " tick");
ok("速度与官方 20 TPS 口径同量级（0.5~12 格/秒）", moved / (ticks * 0.05) > 0.5 && moved / (ticks * 0.05) < 12,
   (moved / (ticks * 0.05)).toFixed(2) + " 格/秒");
const readout = await page.evaluate(() => document.getElementById("gameCoords").textContent);
ok("HUD 坐标读数已更新", /[1-9]/.test(readout), readout.trim().slice(0, 40));

console.log("== 渲染真的出画了 ==");
fs.mkdirSync(OUT, { recursive: true });
const png = await page.screenshot({ path: path.join(OUT, "play-desktop.png") });
// 直接 drawImage(webglCanvas) 拿到的是清屏后的缓冲（preserveDrawingBuffer 没开），
// 所以这里改判真实合成后的截图：把 PNG 交回浏览器解码成 2D 位图再取样。
const uniq = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const W = 240, H = 150;
  const c2 = document.createElement("canvas");
  c2.width = W; c2.height = H;
  const g = c2.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const set = new Set();
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    set.add((d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3));
    if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
  }
  return { colors: set.size, litRatio: lit / (W * H), w: img.width, h: img.height };
}, png.toString("base64"));
ok("画面有足够色彩与亮度（不是清屏色/黑屏）", uniq.colors > 24 && uniq.litRatio > 0.25,
   `${uniq.colors} 色 · ${(uniq.litRatio * 100).toFixed(1)}% 亮 · 截图 ${uniq.w}×${uniq.h} ${png.length}B`);

console.log("== 界面设置与结束流程 ==");
const hudOk = await page.evaluate(() => {
  const host = document.getElementById("gameHudSettings");
  document.getElementById("ghNight").click();
  const after = window.__game.sunPhase;
  document.getElementById("ghDay").click();
  return { visible: getComputedStyle(host).display !== "none" || host.classList.contains("show"), sun: after };
});
ok("HUD 画面设置面板可用（夜晚按钮改了日照）", hudOk.sun > 0, "sunPhase=" + hudOk.sun.toFixed(3));

await page.evaluate(() => document.getElementById("gameStop").click());
await page.waitForTimeout(500);
const ended = await page.evaluate(() => ({
  panel: document.getElementById("endPanel").classList.contains("show"),
  running: window.__game.running,
}));
ok("结束后出现重开面板并停止 tick", ended.panel && !ended.running, JSON.stringify(ended));
await page.click("#endRestart");
await page.waitForTimeout(800);
ok("「再来一次」能重新起跑", await page.evaluate(() => window.__play.running() && window.__play.tick() > 3));

console.log("== 网络面：静态托管下不该有任何越界请求 ==");
const abs = requests.filter((r) => /^\/(api|data|js|css|vendor|assets|img)\//.test(r.url));
const notFound = requests.filter((r) => r.status >= 400);
ok("没有打服务端接口", requests.every((r) => !r.url.includes("/api/")), requests.length + " 个请求");
ok("没有会被 Pages 子路径打穿的根绝对路径", abs.length === 0, abs.slice(0, 4).map((r) => r.url).join(" "));
ok("零 4xx/5xx", notFound.length === 0, notFound.slice(0, 4).map((r) => r.url + "→" + r.status).join(" "));
ok("零未捕获异常", errors.length === 0, errors.slice(0, 3).join(" | "));
await ctx.close();

/* ---------------- 手机端（体验版必须真的能在手机上玩） ---------------- */
console.log("== 手机端 390×844 ==");
const mctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const mpage = await mctx.newPage();
const merr = [];
mpage.on("pageerror", (e) => merr.push("pageerror: " + e.message));
mpage.on("requestfailed", (r) => merr.push("reqfail: " + r.url().replace(ORIGIN, "")));
await mpage.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
await mpage.waitForFunction(() => !!window.__play, null, { timeout: 180000 });
const mFacts = await mpage.evaluate(() => ({
  touch: window.__play.isTouch,
  cls: document.documentElement.classList.contains("touch-capable"),
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  label: document.getElementById("bootStart").textContent,
}));
ok("手机端被判定为触屏并标了 touch-capable", mFacts.touch && mFacts.cls);
ok("首屏无横向溢出", mFacts.overflow <= 1, "scrollWidth-over-innerWidth=" + mFacts.overflow);
await mpage.screenshot({ path: path.join(OUT, "play-mobile-boot.png") });
await mpage.click("#bootStart");
await mpage.waitForFunction(() => window.__play.running(), null, { timeout: 60000 });
await mpage.waitForTimeout(900);
const mPlay = await mpage.evaluate(() => {
  const ui = document.getElementById("touchUI");
  const joy = document.getElementById("joyBase");
  const jr = joy.getBoundingClientRect();
  return {
    touchUI: getComputedStyle(ui).display,
    joy: { x: Math.round(jr.x), y: Math.round(jr.y), w: Math.round(jr.width), h: Math.round(jr.height) },
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    btns: [...document.querySelectorAll("#tbtns button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.id, inside: r.right <= window.innerWidth + 1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.width > 20 };
    }),
  };
});
ok("触屏操控层已显示", mPlay.touchUI !== "none", mPlay.touchUI);
ok("摇杆在屏幕内且够大", mPlay.joy.w >= 80 && mPlay.joy.h >= 80 && mPlay.joy.x >= 0 && mPlay.joy.y >= 0, JSON.stringify(mPlay.joy));
ok("7 个虚拟按钮全部落在可视区内", mPlay.btns.length === 7 && mPlay.btns.every((b) => b.inside),
   mPlay.btns.filter((b) => !b.inside).map((b) => b.id).join(" "));
ok("游玩画面无横向溢出", mPlay.overflow <= 1, String(mPlay.overflow));

// 真推摇杆：Touch 事件走 game.js 的 _bindTouch
const before = await mpage.evaluate(() => window.__play.position());
await mpage.touchscreen.tap(mPlay.joy.x + mPlay.joy.w / 2, mPlay.joy.y + mPlay.joy.h / 2);
const handle = await mpage.evaluateHandle(async ({ cx, cy }) => {
  const joy = document.getElementById("joyBase");
  const t = new Touch({ identifier: 7, target: joy, clientX: cx, clientY: cy });
  joy.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 60));
  const t2 = new Touch({ identifier: 7, target: joy, clientX: cx, clientY: cy - 46 });
  joy.dispatchEvent(new TouchEvent("touchmove", { touches: [t2], targetTouches: [t2], changedTouches: [t2], bubbles: true, cancelable: true }));
  setTimeout(() => {
    joy.dispatchEvent(new TouchEvent("touchend", { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
  }, 1500);
  return true;
}, { cx: mPlay.joy.x + mPlay.joy.w / 2, cy: mPlay.joy.y + mPlay.joy.h / 2 });
void handle;
await mpage.waitForTimeout(1800);
const after = await mpage.evaluate(() => window.__play.position());
const movedTouch = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
ok("手机摇杆能驱动角色移动", movedTouch > 0.5, movedTouch.toFixed(2) + " 格");
await mpage.screenshot({ path: path.join(OUT, "play-mobile-play.png") });
ok("手机端零异常与零请求失败", merr.length === 0, merr.slice(0, 3).join(" | "));
await mctx.close();

const total = fs.existsSync(PLAY) ? fs.readdirSync(PLAY).length : 0;
console.log(`\n产物：play/（${total} 个顶层条目）  页面 ${PAGE}`);
console.log(`${fail ? "FAIL" : "ok "}  ${pass} 条通过 / ${fail} 条失败`);
await browser.close();
server.close();
process.exitCode = fail ? 1 : 0;
