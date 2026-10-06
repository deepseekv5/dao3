/**
 * test/play-bundle.test.mjs — 体验版产物（play/）真的能跑，而且真的没有服务端。
 *
 * 为什么单独一条：`npm run build:play` 的自检只扫字符串，扫不出"点了没反应"；
 * `npm run test:play` 依赖 playwright，本机没装就一直 SKIP。于是这个产物
 * 长期处在"构建说没问题、没人真跑过"的状态。这条用 CDP 起一个静态服务
 * （挂 /dao3play/ 子路径，Pages 就是这么部署的），把整条加载→进入→跑图走完。
 *
 * 运行：先 npm run build:play，再 npm run test:play-bundle
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, Session, freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(8100, 60);
const CDP = 9640 + ((Date.now() % 40) | 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
};

if (!fs.existsSync(path.join(ROOT, "play/index.html"))) {
  console.log("SKIP  没有 play/ 产物，先跑 npm run build:play");
  process.exit(0);
}

/* 子路径是判据的一部分：根绝对路径只有挂在 /dao3play/ 下面才现形。
   静态服务自带而不用 `python -m http.server`：一个页面要并发拉十几份模块
   加一份 2.7 MB 的存档，python 那个单文件服务器会在这里稳定丢一两笔请求，
   于是测试报"play.js 加载失败"——红的是测试自己搭的台子，不是产物。 */
const PLAY = path.join(ROOT, "play");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".gz": "application/gzip",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".glb": "model/gltf-binary", ".woff2": "font/woff2", ".txt": "text/plain",
};
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/dao3play/, "") || "/index.html";
  const f = path.join(PLAY, rel);
  // 越界一律 404，不用 try/catch 兜：读别人的文件不是这个测试该做的事
  if (!f.startsWith(PLAY) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end("nope"); return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
function done() { try { srv.close(); } catch { /* 已关 */ } }
process.on("exit", done);

const up = await fetch(`http://127.0.0.1:${PORT}/dao3play/index.html`).then((r) => r.ok).catch(() => false);
if (!up) { console.log("FAIL  静态服务没起来（端口 " + PORT + " 被占了？）"); process.exit(1); }

const BASE = `http://127.0.0.1:${PORT}/dao3play`;
const { port } = await launchChrome({ port: CDP });
const s = await Session.open(port, {
  width: 1280, height: 800,
  initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3")}catch(e){}'],
});

await s.goto(`${BASE}/index.html`, { settleMs: 2000 });
/* 图集 + 2.7MB 世界存档 + 20 个模型：加载要十几秒是常态，这里等真读数而不是猜 settle。 */
const boot = await s.evaluate(`(async () => {
  const g = (id) => document.getElementById(id);
  for (let i = 0; i < 240; i++) {
    if (g("bootStart") && !g("bootStart").hidden) break;
    if (g("bootFail") && g("bootFail").textContent) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return JSON.stringify({
    failed: (g("bootFail") || {}).textContent || "",
    start: !!g("bootStart") && !g("bootStart").hidden,
    status: (g("bootText") || {}).textContent || "",
    errs: (window.__errs || []).slice(0, 4),
  });
})()`);
const B = JSON.parse(boot);
ok("首屏素材闸门自己放行（有「进入体验」，没有失败条）", B.start && !B.failed, boot);
ok("加载全程没有资源 404（子路径下相对路径都通）", B.errs.length === 0, boot);

await s.evaluate(`document.getElementById("bootStart").click()`);
await s.evaluate(`(async () => {
  for (let i = 0; i < 200 && !window.__game; i++) await new Promise((r) => setTimeout(r, 200));
})()`);
const run = await s.evaluate(`JSON.stringify({
  canvas: !!document.querySelector("canvas"),
  running: !!window.__game && window.__game.running !== false,
  title: (document.getElementById("gameTitle") || {}).textContent || "",
  errs: (window.__errs || []).slice(0, 4),
})`);
const R = JSON.parse(run);
ok("点「进入体验」之后运行时起来了（标题就是那张官方图）",
  R.canvas && R.running && /赛车模板/.test(R.title), run);

/* 画面判据走真截图：WebGL 画布没开 preserveDrawingBuffer，在 rAF 之外 drawImage
   过去只会得到一张纯色空图——那测出的是"读不到"，不是"没画出来"。 */
const { data: png } = await s.send("Page.captureScreenshot", {
  format: "png", clip: { x: 200, y: 120, width: 640, height: 400, scale: 1 },
});
const shot = await s.evaluate(`(async () => {
  const b = await (await fetch("data:image/png;base64,${png}")).blob();
  const img = await createImageBitmap(b);
  const c = document.createElement("canvas"); c.width = 128; c.height = 80;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, 128, 80);
  const d = x.getImageData(0, 0, 128, 80).data, seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3));
  return JSON.stringify({ colors: seen.size });
})()`);
/** 判据要绑在"运行时确实起来了"上：只看颜色数的话，首屏那张卡片本身就有几十种色，
 *  游戏根本没开始也能绿。 */
const shotObj = JSON.parse(shot);
ok("赛道真的画出来了（运行时起来了，且合成帧不是一张纯色）",
  R.running && shotObj.colors > 60, shot + " run=" + run);

const tick = await s.evaluate(`(async () => {
  const g = window.__game;
  if (!g) return JSON.stringify({ missing: true });
  const a = g.currentTick;
  await new Promise((r) => setTimeout(r, 1500));
  return JSON.stringify({ before: a, after: g.currentTick });
})()`);
const T = JSON.parse(tick);
ok("定步长循环在推进（tick 真的在涨）", !T.missing && T.after > T.before, tick);

/* Esc 用真按键：合成 KeyboardEvent 在 Chrome 的按键门控前不算数，
   用它测"菜单打得开"只会得到一个假失败。 */
for (const type of ["keyDown", "keyUp"]) {
  await s.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}
await sleep(500);
const menu = await s.evaluate(`(() => {
  const m = document.getElementById("playMenu");
  if (!m) return JSON.stringify({ menu: false });
  const g = window.__game || {};
  return JSON.stringify({
    menu: true,
    profile: !!m.querySelector('[data-x="profile"]'),
    worldPoll: g._worldPoll != null,
  });
})()`);
const M = JSON.parse(menu);
ok("暂停菜单打得开", M.menu === true, menu);
/** 体验版没有服务端：这些出口点了必然 404，那条轮询每 5 秒只会拿到一次失败。
 *  留着比不给更糟——人会以为是网断了，而不是"这里本来就没有"。 */
ok("菜单里没有指向服务端的出口（个人资料不给，世界频道轮询没起）",
  M.profile === false && M.worldPoll === false, menu);

/* 产物侧的硬判据：整包不许出现 api 取用与根绝对跳转，社交层连文件都不该在。 */
const bundle = path.join(ROOT, "play");
const read = (rel) => fs.readFileSync(path.join(bundle, rel), "utf8");
ok("产物里没有社区与账号模块（pubs / social / auth 连文件都不在）",
  !fs.existsSync(path.join(bundle, "js/pubs.js"))
  && !fs.existsSync(path.join(bundle, "js/social.js"))
  && !fs.existsSync(path.join(bundle, "js/auth.js")));
ok("运行时里那份 backend 是体验版实现（serverBacked=false）",
  /serverBacked = false/.test(read("js/backend.js")), read("js/backend.js").slice(0, 80));

console.log(`\nplay-bundle: ${pass} passed, ${fail} failed`);
done();
process.exit(fail ? 1 : 0);
