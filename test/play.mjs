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
const CE_PATH = "/dao3ce";     // 同一批文件，但 .gz 走传输层解压（见下面的服务器）

const pw = await playwright();
if (!pw) {
  console.log("SKIP  找不到 playwright-core：设 PLAYWRIGHT_MODULE=/path/to/playwright-core");
  process.exit(0);
}
if (!fs.existsSync(path.join(PLAY, "index.html"))) {
  console.log("FAIL  play/ 还没构建：先跑 node scripts/build-play.mjs");
  process.exit(1);
}

/* ---------------- 拟真静态服务器（只认 /dao3play/ 与 /dao3ce/ 前缀） ---------------- */
// /dao3ce/ 与 /dao3play/ 服务同一批文件，唯一区别是给 .gz 打上
// Content-Encoding: gzip —— 浏览器会替我们解掉那一层，JS 拿到的是纯 JSON。
// Pages 前面的 CDN 完全可能这么干，而这条路径只有真机才测得到。
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".gz": "application/gzip", ".ico": "image/x-icon",
  ".webp": "image/webp", ".woff2": "font/woff2",
  ".gltf": "model/gltf+json", ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const prefix = url.startsWith(CE_PATH + "/") || url === CE_PATH ? CE_PATH : BASE_PATH;
  if (!url.startsWith(prefix + "/") && url !== prefix) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("outside the emulated project-page prefix");
  }
  let rel = url.slice(prefix.length).replace(/^\/+/, "");
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
  const headers = {
    "content-type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream",
    "content-length": body.length,
  };
  if (prefix === CE_PATH && abs.endsWith(".json.gz")) {
    // 声明成传输层编码：浏览器替我们解压，JS 侧拿到的首字节就不再是 1f 8b
    headers["content-encoding"] = "gzip";
    delete headers["content-length"];
  }
  res.writeHead(200, headers);
  res.end(body);
});
// LIVE=<线上地址> 时整套断言改跑线上站点：本地全绿不等于线上能跑，
// Pages 的构建源、缓存与 CDN 的传输层编码都只在真实部署里才看得到。
const LIVE = process.env.LIVE ? process.env.LIVE.replace(/\/+$/, "") + "/" : null;
let ORIGIN = LIVE || "";
if (!LIVE) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
}
const PAGE = LIVE || ORIGIN + BASE_PATH + "/";

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
// 官方模型与音效现在随包分发：实体必须真的挂上网格，而不是退回"只有碰撞与逻辑"。
// 只断言"没有告警"是不够的——把 assets.meshes 全塞空 Group 也能让告警消失，
// 但画面是一片空白，所以这里量真实子节点数与音频清单。
const art = await page.evaluate(() => {
  const g = window.__game;
  let named = 0, holders = 0;
  for (const e of g.entities) {
    if (e._meshName) named++;
    if (e._meshHolder && e._meshHolder.children.length) holders++;
  }
  const an = (g.assets || {}).audioNames;
  return {
    named, holders, placed: g.e.state.models.length,
    audioCount: Array.isArray(an) ? an.length : -1, audioType: Object.prototype.toString.call(an),
    audioBase: (g.assets || {}).audioBase,
  };
});
ok("赛道模型真的挂上了实体（不是空占位）", art.named > 150 && art.holders > 150,
   `${art.holders}/${art.named} 个实体有网格，场景模型 ${art.placed} 个`);
ok("官方音效清单已加载且走相对路径", art.audioCount >= 40 && !/^\/|^\.\.\//.test(art.audioBase || "/"),
   `${art.audioCount} 个(${art.audioType}) · base=${art.audioBase}`);

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

console.log("== 上车（官方赛车流程最容易坏的一步） ==");
// 官方脚本在 onInteract 里把 player.scale 设成 0.13 并换上车的 mesh。
// 曾经相机避让射线会打到玩家自己的实体（实测 distance 0），
// dist 被夹到 0.22 的贴身下限，于是 1.3 格长的车壳糊满整屏、什么都看不见。
const board = await page.evaluate(async () => {
  const g = window.__game, r = g.e.renderer, ent = g.playerEntity;
  const gate = g.world.querySelector("#报名点");
  if (!gate) return { skip: "没有 #报名点" };
  ent.position.set(gate.position.x, gate.position.y + 1, gate.position.z + 2);
  g._vy = 0; g._grounded = true;
  await new Promise((x) => setTimeout(x, 200));
  const hint = document.getElementById("gameInteract").textContent;
  const before = { camDist: 0, ent: [ent.position.x, ent.position.z] };
  before.camDist = Math.hypot(r.camera.position.x - ent.position.x, r.camera.position.z - ent.position.z);
  const api = g.world.querySelector("player");
  api.motion.loadByName({ iterations: Infinity, motions: [{ iterations: 1, name: "run" }] });
  // 直接触发交互，等价于玩家按 E
  gate._channels.Interact.fire({ tick: g.currentTick, entity: ent, player: api });
  await new Promise((x) => setTimeout(x, 1200));
  const after = Math.hypot(r.camera.position.x - ent.position.x, r.camera.position.z - ent.position.z);
  return { hint, before: +before.camDist.toFixed(2), after: +after.toFixed(2),
    want: g.player.cameraDistance, scale: g.player.scale, mesh: ent._meshName || "",
    avatarVisible: ent._avatar.visible,
    holderKids: ent._meshHolder ? ent._meshHolder.children.length : 0,
    clips: ent._clips ? ent._clips.length : 0 };
});
ok("报名点可交互且提示正确", /报名点/.test(board.hint || ""), JSON.stringify(board.hint || ""));
ok("上车后相机仍保持第三人称距离（没塌进车壳里）",
  board.after > 2 || board.skip, JSON.stringify({ before: board.before, after: board.after, want: board.want }));
ok("上车后换上车的网格并收起人物本体", board.holderKids > 0 && board.mesh.includes("汽车")
  && board.avatarVisible === false, JSON.stringify({ mesh: board.mesh, kids: board.holderKids, av: board.avatarVisible }));
await page.screenshot({ path: path.join(OUT, "play-boarded.png") });

// 车头朝向与镜头取景。官方 .vb→glTF 丢了动画轨道，而官方正是靠轨道驱动车头朝向，
// 所以网格会停在导出朝向：实测 汽车模板-1 车头在 −X、行进在 +Z，车是"横着开"的。
// 现在每帧按部件命名（前轮/后轮/尾翼）量车尾→车头，转最短角对齐速度方向。
const drive = await page.evaluate(async () => {
  const g = window.__game, THREE = g.THREE || await import("./vendor/three/three.module.js");
  const ent = g.playerEntity, h = ent._meshHolder;
  if (!h || !h.children.length) return { skip: "没有车辆网格" };
  const named = () => { const o = {}; h.traverse((n) => { if (n.name && (n.name.includes("前") || n.name.includes("后")) && !o[n.name]) o[n.name] = n.getWorldPosition(new THREE.Vector3()); }); return o; };
  // 官方模板上车后有 3 秒倒计时，期间 disableInputDirection=BOTH（按键无效）。
  // 不等它结束就按 W，只会量到一辆停着不动的车。
  for (let i = 0; i < 60; i++) {
    if (String(g.player.disableInputDirection || "none") === "none") break;
    await new Promise((x) => setTimeout(x, 200));
  }
  const p0 = { ent: [ent.position.x, ent.position.z], x: ent.position.x, z: ent.position.z };
  g._keys.w = true;
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((x) => setTimeout(x, 150));
    const v = { x: ent.velocity.x, z: ent.velocity.z }, sp = Math.hypot(v.x, v.z);
    const nm = named();
    if (sp < 0.05 || !nm["前轮"] || !nm["后轮"]) continue;
    const c = new THREE.Box3().setFromObject(h).getCenter(new THREE.Vector3());
    const f = nm["前轮"];
    samples.push({
      lead: +(((f.x - c.x) * v.x + (f.z - c.z) * v.z) / sp).toFixed(2),
      len: (() => { const sz = new THREE.Box3().setFromObject(h).getSize(new THREE.Vector3()); return +Math.max(sz.x, sz.z).toFixed(2); })(),
      along: (() => { const sz = new THREE.Box3().setFromObject(h).getSize(new THREE.Vector3()); return Math.abs(v.z) > Math.abs(v.x) ? sz.z > sz.x : sz.x > sz.z; })(),
    });
  }
  g._keys.w = false;
  const moved = Math.hypot(ent.position.x - p0.x, ent.position.z - p0.z);
  const cam = Math.hypot(g.e.renderer.camera.position.x - ent.position.x, g.e.renderer.camera.position.z - ent.position.z);
  return { n: samples.length, lead: samples.map((x) => x.leads ?? x.lead), alongAll: samples.every((x) => x.along),
    moved: +moved.toFixed(2), cam: +cam.toFixed(2), want: g.player.cameraDistance, scale: g.player.scale };
});
if (drive.skip) console.log("SKIP  车头朝向：", drive.skip);
else {
  ok("开起来后车头朝在行进方向（不是横着/倒着）",
    drive.n >= 3 && drive.lead.filter((v) => v != null).length >= 3 && drive.lead.slice(-3).every((v) => v > 0.3),
    "前伸 " + drive.lead.join(","));
  ok("车身长轴与行进方向一致", drive.alongAll === true);
  ok("镜头按主体大小取景（0.13 比例的车不再用 8.5 格远看）",
    drive.cam < drive.want * 0.6 && drive.cam > 1, `${drive.cam} 格 vs cameraDistance ${drive.want}`);
}
await page.screenshot({ path: path.join(OUT, "play-car-driving.png") });

// 键盘按键必须真的 fire 官方 player.onPress。曾经只有触屏按钮会 fire，
// 键盘只改了内部 _jumpBuf —— 于是桌面端玩家吃了加速道具也按不出来
// （赛车模板的消耗判定是 button == GameButtonType.JUMP）。
const pressFires = await page.evaluate(async () => {
  const g = window.__game, pl = g.world.querySelector("player").player;
  const seen = [];
  pl.onPress(({ button }) => seen.push("d:" + button));
  pl.onRelease(({ button }) => seen.push("u:" + button));
  for (const code of ["Space", "ControlLeft", "KeyF"]) {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));   // 长按连发
    window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
  }
  return seen;
});
ok("键盘 Space/Ctrl/F 会触发 onPress 与 onRelease", pressFires.filter((s) => s.startsWith("d:")).length === 3
  && pressFires.filter((s) => s.startsWith("u:")).length === 3, pressFires.join(" "));
ok("长按连发不会重复触发 Press", new Set(pressFires).size === pressFires.length, pressFires.join(" "));

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

// fixed 元素只写 top 不写 bottom:auto，就会从 top 一直撑到 bottom ——
// .pe-readout 曾经因此变成 750px 高的容器，把状态读数甩到屏幕正中压住准星。
// 横向溢出测不出这种错（宽度没变），所以这里量高度与所在区带。
const bands = await mpage.evaluate(() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; };
  return { readout: box(".pe-readout"), state: box("#gameState"), vitals: box("#gameVitals"), cross: box("#gameCross") };
});
const cross = bands.cross || { y: 422, h: 0 };
ok("读数条没被撑高（fixed 只写 top 会撑满整屏）", bands.readout.h < 60, JSON.stringify(bands.readout));
ok("状态读数在顶部区带、没压住准星", bands.state.y < 160 && Math.abs(bands.state.y - cross.y) > 120,
   `state.y=${bands.state.y} cross.y=${cross.y}`);
ok("血条在顶部区带内", bands.vitals.y < 160 && bands.vitals.h < 80, JSON.stringify(bands.vitals));

// 真推摇杆。悬浮层现在按 Pointer Events 绑定（鼠标/触屏/手写笔一套代码），
// 而真实手指在浏览器里产生的本来就是 pointer 事件——所以这里也发 pointer 事件。
// 合成 TouchEvent 是"测试自己发明的输入形态"，真机不会只发 touch 不发 pointer。
const before = await mpage.evaluate(() => window.__play.position());
await mpage.touchscreen.tap(mPlay.joy.x + mPlay.joy.w / 2, mPlay.joy.y + mPlay.joy.h / 2);
const handle = await mpage.evaluateHandle(async ({ cx, cy }) => {
  const joy = document.getElementById("joyBase");
  const pe = (type, x, y) => joy.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y,
  }));
  pe("pointerdown", cx, cy);
  await new Promise((r) => setTimeout(r, 60));
  pe("pointermove", cx, cy - 46);
  setTimeout(() => pe("pointerup", cx, cy - 46), 1500);
  return true;
}, { cx: mPlay.joy.x + mPlay.joy.w / 2, cy: mPlay.joy.y + mPlay.joy.h / 2 });
void handle;
await mpage.waitForTimeout(1800);
const after = await mpage.evaluate(() => window.__play.position());
const movedTouch = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
ok("手机摇杆能驱动角色移动", movedTouch > 0.5, movedTouch.toFixed(2) + " 格");
await mpage.screenshot({ path: path.join(OUT, "play-mobile-play.png") });
// 竖屏提示：手册说"竖屏会提示转横屏"，那就得真的在竖屏出现、横屏消失
const rotPortrait = await mpage.evaluate(() => {
  const el = document.getElementById("peRotate");
  return el ? getComputedStyle(el).display : "no-el";
});
ok("竖屏手机上提示转成横屏", rotPortrait === "block", rotPortrait);
await mpage.setViewportSize({ width: 780, height: 390 });
await mpage.waitForTimeout(500);
const rotLandscape = await mpage.evaluate(() => {
  const el = document.getElementById("peRotate");
  return el ? getComputedStyle(el).display : "no-el";
});
ok("转成横屏后提示自动消失", rotLandscape === "none", rotLandscape);
await mpage.setViewportSize({ width: 390, height: 780 });
await mpage.waitForTimeout(300);
ok("手机端零异常与零请求失败", merr.length === 0, merr.slice(0, 3).join(" | "));
await mctx.close();

/* ---------------- CDN 已替我们解压过 gzip 的那条路 ---------------- */
// 这是唯一一个"本地默认配置下永远走不到"的分支：托管层给 .gz 打上
// Content-Encoding: gzip 时，浏览器交出来的是纯 JSON，再喂 DecompressionStream
// 会直接格式错、整页打不开。play.js 按首两字节判，所以必须真发一次这种响应
// ——只能自己起服务器模拟，跑线上时这段没有可注入的传输层，跳过。
if (!LIVE) {
console.log("== 传输层已解压（Content-Encoding: gzip） ==");
const cctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const cpage = await cctx.newPage();
const cerr = [];
cpage.on("pageerror", (e) => cerr.push("pageerror: " + e.message));
await cpage.goto(ORIGIN + CE_PATH + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await cpage.waitForFunction(() => !!window.__play, null, { timeout: 180000 });
const cFacts = await cpage.evaluate(() => ({ voxels: window.__play.voxels(), ents: window.__play.registryEntities() }));
ok("被 CDN 解压过也照样跑得起来", cFacts.voxels > 1000000 && cFacts.ents === 199,
   cFacts.voxels.toLocaleString("en") + " 格 / " + cFacts.ents + " 实体");
ok("这条路径零未捕获异常", cerr.length === 0, cerr.slice(0, 2).join(" | "));
await cctx.close();
}

const total = fs.existsSync(PLAY) ? fs.readdirSync(PLAY).length : 0;
console.log(`\n${LIVE ? "线上" : "产物"}：${PAGE}`);
console.log(`${fail ? "FAIL" : "ok "}  ${pass} 条通过 / ${fail} 条失败`);
await browser.close();
if (server) server.close();
process.exitCode = fail ? 1 : 0;
