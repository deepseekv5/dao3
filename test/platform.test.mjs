/**
 * platform.test.mjs — 平台层的真实浏览器验收：两个隔离会话 = 两个真人。
 *
 * 为什么不能用 HTTP 测试代替：community.test.mjs 证明的是接口对不对，
 * 而"注册后首个账号是不是管理员""皮肤色号有没有贴到人偶上""Esc 是不是把人踢回编辑器"
 * 这些是页面上的事实，只有真浏览器 + 真 cookie + 真命中测试才说得住。
 *
 * 两个会话各带自己的 cookie：这才是"用户 A 做事、用户 B 也做事"，
 * 而不是拿一个会话假装两个人。
 *
 * 自己起服务、自己挑空目录：管理员只有一个，"首个注册即管理员"只有在空库上才成立。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5500 + ((Date.now() % 400) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-platform-"));
const ACK = 'localStorage.setItem("dao3_disclaimer_ack","3")';
const HOOK = 'window.__errs=[];addEventListener("error",(e)=>__errs.push("err:"+e.message+" @"+(e.filename||"").split("/").pop()+":"+(e.lineno||"")));addEventListener("unhandledrejection",(e)=>__errs.push("rej:"+((e.reason&&(e.reason.message||e.reason))||"")));';
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
const boot = [];
child.stdout.on("data", (b) => boot.push(String(b)));
child.stderr.on("data", (b) => boot.push(String(b)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanup() {
  try { child.kill("SIGTERM"); } catch { /* 已经退了 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 临时目录交给系统 */ }
}
process.on("exit", cleanup);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + String(extra).slice(0, 300) : "")); }
};
/** 轮询到条件成立为止：这条链路上全是异步渲染，固定 sleep 只会又慢又脆。 */
async function until(s, expr, { tries = 20, ms = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    let v = null;
    try { v = await s.evaluate(expr); } catch { /* 页面正在跳转 */ }
    if (v) return v;
    await sleep(ms);
  }
  return false;
}
/** 在页面里发请求：cookie 与 CSRF 由浏览器自己带上，不用从外面搬来搬去。 */
const pageFetch = (s, method, p) => s.evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(p)}, { method: ${JSON.stringify(method)}, credentials: "same-origin" });
  return { status: r.status, json: await r.json().catch(() => null) };
})()`);

{
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      const j = await (await fetch(BASE + "/api/whoami")).json().catch(() => null);
      if (j && j.app === "laoyou-metaverse") { up = true; break; }
    } catch { /* 还没起来 */ }
  }
  if (!up) { console.log("FAIL  测试用的本地服务起不来（端口 " + PORT + "）"); process.exit(1); }
}

let chrome;
try { chrome = await launchChrome({}); }
catch (e) { console.log("SKIP  起不了浏览器，平台浏览器验收跳过：" + e.message); process.exit(0); }
const A = await Session.open(chrome.port, { isolated: true, width: 1280, height: 860, initScripts: [ACK, HOOK] });
const B = await Session.open(chrome.port, { isolated: true, width: 1280, height: 860, initScripts: [ACK, HOOK] });
fs.writeFileSync("/tmp/ly-pixel.png", PNG);

/** 首次进工作台会弹"官方素材授权"，那是一层盖住整页的模态；先替这台实例表态。 */
async function primeConsent(s) {
  await s.goto(BASE + "/"); await sleep(800);
  await s.evaluate(`fetch("/api/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({racingTemplate:false,racingAssets:false})})`);
  await sleep(300);
}
await primeConsent(A);

async function register(s, name) {
  await s.goto(BASE + "/community"); await sleep(800);
  await s.click('#wbAuth [data-x="reg"]');
  if (!await until(s, `!!document.querySelector("#auPw2")`, { tries: 12, ms: 200 })) return "注册表单没出来";
  await s.type("#auName", name);
  await s.type("#auPw", "a-long-enough-password");
  await s.type("#auPw2", "a-long-enough-password");
  await s.click('#authModal [data-x="go"]');
  return until(s, `(document.querySelector("#wbAuth .au-chip")||{}).title === ${JSON.stringify(name)}`, { tries: 20, ms: 300 });
}

/* ---------------- 账号 ---------------- */
const stamp = Date.now().toString(36).slice(-5);
const nameA = "老攸" + stamp, nameB = "阿乙" + stamp;
ok("A 注册成功并顶栏显示身份", await register(A, nameA), await A.evaluate(`(document.querySelector("#wbAuth")||{}).innerHTML.slice(0,120)`));
ok("B 注册成功（两个会话互不共享 cookie）", await register(B, nameB), await B.text());
const roles = await pageFetch(A, "GET", "/api/community/me");
ok("空库上首个注册账号自动成为管理员", roles.json?.user?.role === "admin", JSON.stringify(roles.json?.user || {}));
ok("第二个账号只是普通用户", (await pageFetch(B, "GET", "/api/community/me")).json?.user?.role === "user");

/* ---------------- 工作台的起点卡：卡上说的话要跟着服务端走 ---------------- */
await A.goto(BASE + "/"); await sleep(1200);
{
  // 这台实例在 primeConsent 里拒了官方素材，所以卡上不能印着 256×128×256 那串数字，
  // 也不能摆一个点了只会失败的"复制"。授权之后的另一头在文件末尾。
  const off = await until(A, `(() => { const el = document.querySelector(".wb-start.hot");
    return el && el.querySelector(".m") ? { name: el.querySelector("h3").textContent, meta: el.querySelector(".m").textContent } : null; })()`, { tries: 24, ms: 300 });
  ok("没装官方模板时起点卡不谎称能复制", !!off && off.meta === "未装入本机", JSON.stringify(off));
}

/* ---------------- 发布：快照 + 上传封面 ---------------- */
await A.goto(BASE + "/"); await sleep(1200);
ok("工作台的项目行里有发布入口", await until(A, `!!document.querySelector('tr[data-id="216d665d3ca92bd1b9a2"] [data-act="pub"]')`, { tries: 20 }), await A.text());
await A.click('tr[data-id="216d665d3ca92bd1b9a2"] [data-act="pub"]');
if (!await until(A, `!!document.querySelector("#pCover")`, { tries: 12, ms: 250 })) {
  console.log("FAIL  发布对话框没打开"); fail++;
} else {
  await A.type("#pTitle", "老攸赛道 · 带封面");
  await A.type("#pDesc", "官方赛车模板的完整复刻，封面是自己上传的。");
  await A.type("#pTags", "竞速, 官方兼容");
  await A.setFile("#pCover", "/tmp/ly-pixel.png");
  await A.click("#pOk");
}
const onDetail = await until(A, `location.pathname.startsWith("/p/")`, { tries: 30 });
const pubId = onDetail ? await A.evaluate(`location.pathname.slice(3)`) : "";
ok("发布后跳进作品详情页", !!pubId, await A.evaluate("location.href"));
ok("上传的封面成为详情页头图", await until(A, `!!document.querySelector(".cm-hero img")`), await A.evaluate(`(document.querySelector(".cm-hero")||{}).innerHTML?.slice(0,160)`));
await A.shot(path.join(ROOT, "tmp/ui-detail.png"));

/* ---------------- 个人主页：简介 / 头像 / 皮肤 ---------------- */
await A.goto(BASE + "/me"); await sleep(1400);
const pf = await A.evaluate(`(() => ({ banner: !!document.querySelector(".pf-banner"), cards: document.querySelectorAll(".cm-card").length, edit: !!document.querySelector("#pfEdit") }))()`);
ok("个人主页有横幅、自己的作品与编辑入口", pf.banner && pf.cards === 1 && pf.edit, JSON.stringify(pf));
await A.click("#pfEdit");
await until(A, `!!document.querySelector('#eSkin [data-c="#e8604c"]')`, { tries: 12, ms: 250 });
await A.evaluate(`(() => { const o=[...document.querySelectorAll("#eSkin [data-p]")].find(b=>b.dataset.p!=="shirt"); o.click(); })()`);
await sleep(150);
await A.evaluate(`document.querySelector('#eSkin [data-p="shirt"]').click()`);
await sleep(150);
await A.evaluate(`document.querySelector('#eSkin [data-c="#e8604c"]').click()`);
const doll = await A.evaluate(`(document.querySelector(".pf-doll .d-torso")||{getAttribute:()=>""}).getAttribute("style")`);
ok("皮肤调色板即时反映到预览人偶", /e8604c/i.test(String(doll)), doll);
// 每一格给自己的色板：拿挑上衣的十色去挑脸，怎么选都像贴了块塑料。
const palOf = (p) => A.evaluate(`(() => {
  const b = document.querySelector('#eSkin [data-p="${p}"]'); b.click();
  return [...document.querySelectorAll(".pf-pal [data-c]")].map((x) => x.dataset.c).join(",");
})()`);
ok("「皮肤」那一格给的是肤色梯度而不是通用色板",
  (await palOf("skin")).startsWith("#f6d7bd") && !(await palOf("skin")).includes("#5aa8e8"));
ok("「头发」那一格给的是发色", (await palOf("hair")).includes("#1c1c1e") && !(await palOf("hair")).includes("#4ecb8d"));
ok("「上衣」那一格回到通用色板", (await palOf("shirt")).includes("#5aa8e8"));
// 预设：多数人选不出五配色，没有成套预设时这一格等于没做。
const nPreset = await A.evaluate(`document.querySelectorAll("#eSkin [data-o]").length`);
ok("皮肤有成套预设可选", nPreset >= 6, String(nPreset));
await A.evaluate(`document.querySelector('#eSkin [data-o][title="夜行"]').click()`);
const presetDoll = await A.evaluate(`(() => ({
  torso: getComputedStyle(document.querySelector(".pf-doll .d-torso")).backgroundColor,
  chip: getComputedStyle(document.querySelector('#eSkin [data-p="shirt"] span')).backgroundColor,
  on: !!document.querySelector('#eSkin [data-o].on'),
}))()`);
// 夜行的上衣是 #22252c = rgb(34, 37, 44)。浏览器会把 style 属性序列化成 rgb()，比 hex 比不出来。
ok("点预设会同时改人偶和部位色块",
  presetDoll.torso === "rgb(34, 37, 44)" && presetDoll.chip === "rgb(34, 37, 44)" && presetDoll.on, presetDoll);
// 取色器在系统面板里每动一下就触发 input；老写法那时重建宿主，等于把用户正在用的控件销毁掉。
const kept = await A.evaluate(`(async () => {
  const el = document.getElementById("eCustom");
  el.value = "#12b5c9"; el.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  return { same: el === document.getElementById("eCustom"), torso: getComputedStyle(document.querySelector(".pf-doll .d-torso")).backgroundColor };
})()`);
ok("自定义取色器拖动过程中不会被重建", kept.same, JSON.stringify(kept));
ok("自定义颜色立刻贴到人偶上", kept.torso === "rgb(18, 181, 201)", JSON.stringify(kept));
await A.evaluate(`document.querySelector('#eSkin [data-p="shirt"]').click()`);
await A.evaluate(`document.querySelector('#eSkin [data-c="#e8604c"]').click()`);
await A.setFile("#eAvatar", "/tmp/ly-pixel.png");
ok("头像上传后不用刷新就生效", await until(A, `!!document.querySelector(".pf-avatar img")`), await A.evaluate(`(document.querySelector(".pf-avatar")||{}).innerHTML?.slice(0,140)`));
await A.type("#eBio", "造图的人");
await A.click("#eSave");
ok("简介保存生效", await until(A, `(document.querySelector(".pf-bio")||{}).textContent === "造图的人"`), await A.evaluate(`(document.querySelector(".pf-bio")||{}).textContent`));
const meA = await pageFetch(A, "GET", "/api/community/me");
ok("皮肤配色存进了账号", meA.json?.user?.skin?.shirt === "#e8604c", JSON.stringify(meA.json?.user?.skin));
await A.shot(path.join(ROOT, "tmp/ui-profile.png"));

/* ---------------- 另一个人：关注 / 评论 / 举报 ---------------- */
await B.goto(BASE + "/p/" + pubId); await sleep(1400);
await B.evaluate(`(() => { const b=document.querySelector("#cmFollow"); if(!b) throw new Error("没有关注按钮"); b.click(); })()`);
ok("B 关注作者后按钮改口", await until(B, `(document.querySelector("#cmFollow")||{}).textContent === "已关注"`), await B.evaluate(`(document.querySelector("#cmFollow")||{}).textContent`));
await B.type("#cBody", "封面比之前那张好看多了，跑起来也顺。");
await B.click("#cSend");
ok("B 的评论上了墙", await until(B, `document.querySelectorAll(".cm-cmt").length === 1`), await B.text());
B.dialog = { accept: true, promptText: "封面是一张纯色小图，疑似灌水" };
await B.evaluate(`document.querySelector("#cmReport").click()`);
await sleep(800);
B.dialog = { accept: true, promptText: "" };
await B.shot(path.join(ROOT, "tmp/ui-comment.png"));

/* ---------------- 版本控制：同一张图再发一次 ---------------- */
await A.goto(BASE + "/"); await sleep(1400);
await A.click('tr[data-id="216d665d3ca92bd1b9a2"] [data-act="pub"]');
await until(A, `!!document.querySelector("#pNote")`, { tries: 12, ms: 250 });
await A.type("#pNote", "换了封面");
await A.click("#pOk");
ok("再发一次回到同一个作品（没有多开一条）", await until(A, `location.pathname === "/p/${pubId}"`, { tries: 30 }), await A.evaluate("location.href"));
ok("详情页显示版本 2 与可回滚的历史", await until(A, `!!document.querySelector(".cm-ver button") && [...document.querySelectorAll("h4")].some((h)=>/版本\\s*2/.test(h.textContent))`),
  await A.evaluate(`[...document.querySelectorAll("h4")].map((h)=>h.textContent).join(" | ")`));

/* ---------------- 管理后台 ---------------- */
await A.goto(BASE + "/admin"); await sleep(1600);
const adm = await A.evaluate(`(() => ({ cards: document.querySelectorAll(".ad-cards > div").length, tabs: [...document.querySelectorAll("[data-t]")].map((b)=>b.dataset.t) }))()`);
ok("后台总览有数据卡", adm.cards >= 6, JSON.stringify(adm));
ok("举报队列里躺着 B 的那条举报", await until(A, `document.body.textContent.includes("纯色小图")`), await A.text());
await A.evaluate(`(() => { const b=document.querySelector('[data-t="users"]'); if(!b) throw new Error("没有用户 tab"); b.click(); })()`);
ok("后台列出两个账号", await until(A, `document.querySelectorAll(".ad-table tbody tr").length === 2 && document.body.textContent.includes(${JSON.stringify(nameB)})`), await A.text());
await A.shot(path.join(ROOT, "tmp/ui-admin.png"));

/* B 不该进得来：前端藏按钮，服务端也要真的挡 */
await B.goto(BASE + "/admin"); await sleep(1400);
ok("普通用户打开后台看到的是拒绝", await until(B, `document.body.textContent.includes("不是管理员") && !document.querySelector(".ad-cards")`), await B.text());

/* ---------------- 运行时：昵称 / 皮肤 / 内嵌菜单 ---------------- */
await A.goto(BASE + `/edit/216d665d3ca92bd1b9a2?play=1&pub=${pubId}&title=${encodeURIComponent("老攸赛道")}&author=${encodeURIComponent(nameA)}`);
const booted = await until(A, `(() => { const E=window.__editor, g=window.__game;
  if (!E || !E.renderer || !g || !g.player) return false;
  const m = document.body.textContent.match(/X (-?[\\d.]+)/);
  return !!m && Math.abs(E.renderer.camera.position.x - Number(m[1])) < 20; })()`, { tries: 70, ms: 1000 });
ok("社区地图走内嵌运行时启动（不是编辑器视图）", booted, await A.evaluate(`document.body.textContent.slice(0,160)`));
ok("运行时用的是社区昵称", await A.evaluate(`(window.__game && window.__game.player && window.__game.player.name) || "(空)"`) === nameA,
  await A.evaluate(`JSON.stringify({ player: window.__game && window.__game.player && window.__game.player.name, me: window.__me && window.__me.name })`));
const shirt = await A.evaluate(`(() => {
  let c = null;
  window.__editor.renderer.scene.traverse((o) => {
    // 躯干是 "body" 关节下那块布料染色的网格；人偶部件叫 body/head，不叫 torso。
    // 比 baseColor 而不是 material.color：地图可以对布料再乘一层 tint，
    // 我们要验的是"账号那件事有没有发生"，不是这张图把颜色染成了什么。
    if (!c && o.isMesh && o.userData && o.userData.tint === "cloth" && o.parent && o.parent.name === "body") c = o.userData.baseColor;
  });
  return c == null ? null : "#" + c.toString(16).padStart(6, "0");
})()`);
ok("账号皮肤贴到了角色身上", shirt === "#e8604c", String(shirt));
await A.shot(path.join(ROOT, "tmp/ui-play.png"));

/* HUD 的三条硬判据。都是这一版重做踩过的坑，光看截图看不出回归：
   1) 画布要铺满视口——以前 #stage 永远留 48px 顶边，HUD 挂在那条死带上；
   2) 菜单样式必须随页面到——.gm-menu 以前住在懒加载的 player-modal.css 里，
      冷启动进游玩时它是裸的：一整屏透明 div 吃掉所有点击，却什么都看不见。 */
const hud = await A.evaluate(`(() => {
  const cv = document.getElementById("viewport"), r = cv.getBoundingClientRect();
  const tools = document.querySelector(".hud-tools"), map = document.querySelector(".hud-map");
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    vw: innerWidth, vh: innerHeight,
    canvas: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
    legacyBar: !!document.querySelector(".pe-top"),
    tools: tools && cs(tools).display, map: map && cs(map).display,
    exit: (() => { const b = document.getElementById("gameStop"); return b && { text: b.textContent.trim(), bg: cs(b).backgroundColor }; })(),
  };
})()`);
ok("运行画布铺满视口，不留顶边死带", hud.canvas.top === 0 && hud.canvas.h >= hud.vh - 2 && hud.canvas.w >= hud.vw - 2, JSON.stringify(hud));
ok("整宽顶栏已经拿掉，HUD 改成四角浮块", !hud.legacyBar && hud.tools === "flex" && hud.map === "flex", JSON.stringify(hud));
ok("出口是带文字的按钮，不是一个猜得出的圆点", !!hud.exit && hud.exit.text === "退出", JSON.stringify(hud.exit));

const realKey = async (code, key, vk) => {
  for (const type of ["keyDown", "keyUp"]) {
    await A.send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }
  await sleep(250);
};
const menuShown = `(() => { const m = document.getElementById("playMenu"); return !!m && m.classList.contains("show"); })()`;

// 先试真键盘。Esc 在浏览器层是"退出全屏/指针锁"的保留键，headless 里可能被吃掉，
// 所以真键不通并不等于产品坏了——再用同一条处理函数派发一次，才分得清是谁的锅。
await realKey("Escape", "Escape", 27);
const escReal = await A.evaluate(menuShown);
const camBefore = await A.evaluate(`window.__game.player.cameraMode`);
await realKey("KeyV", "v", 86);
const camAfter = await A.evaluate(`window.__game.player.cameraMode`);
ok("运行时的真键盘通路是活的（V 切视角）", camAfter !== camBefore, `before=${camBefore} after=${camAfter}`);
if (!escReal) console.log("      注：真 Esc 没落到页面（浏览器保留键），下面直接派发 keydown 验菜单本身");
// 先预热 playshell：Esc 处理里那句 import() 第一次要走网络解析，
// 慢的时候"按下去没反应"其实是模块还没到，而不是菜单逻辑坏了。
await A.evaluate(`import("/js/playshell.js").then(() => true)`);
// 真 Esc 有时会"迟到"：先派发的那下晚到会把菜单又关掉。所以反复派发直到菜单出现，
// 验的是"Esc 这条处理路径能把菜单开出来"，而不是某一次按键的到达时刻。
const menuOf = `(() => { const m = document.getElementById("playMenu"); return m && m.classList.contains("show") ? {
  leave: (document.querySelector("#gmLeave") || {}).textContent,
  running: !!(window.__game && window.__game.running),
} : false; })()`;
let menu = await A.evaluate(menuOf);
for (let i = 0; i < 8 && !menu; i++) {
  await A.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }))`);
  menu = await until(A, menuOf, { tries: 4, ms: 400 });
}
if (!menu) console.log("      菜单诊断: " + await A.evaluate(`JSON.stringify({ el: !!document.getElementById("playMenu"), cls: (document.getElementById("playMenu")||{}).className, running: !!(window.__game && window.__game.running), errs: (window.__errs||[]).slice(0,2) })`));
ok("Esc 打开内嵌菜单，世界还在跑", !!menu && menu.running, JSON.stringify({ escReal, menu }));
ok("社区图的出口是作品页，不是编辑器", !!menu && menu.leave === "离开游戏", menu && menu.leave);
/* 菜单样式必须随页面一起到：.gm-menu 以前住在懒加载的 player-modal.css 里，
   而那份 CSS 要等玩家面板第一次打开才注入——冷启动进游玩时它是裸的，
   一整屏透明 div 吃掉所有点击却什么都看不见。 */
const styledMenu = await A.evaluate(`(() => {
  const m = document.getElementById("playMenu");
  if (!m) return { el: false };
  const card = m.querySelector(".gm-card"), b = m.querySelector(".gm-list button");
  return { el: true, pos: getComputedStyle(m).position, cardBg: card && getComputedStyle(card).backgroundColor,
    btnFont: b && getComputedStyle(b).fontSize };
})()`);
ok("内嵌菜单拿到的是真样式，不是裸按钮", styledMenu.el && styledMenu.pos === "fixed"
  && styledMenu.cardBg !== "rgba(0, 0, 0, 0)" && styledMenu.btnFont === "13.5px", JSON.stringify(styledMenu));

/* 聊天面板与画质档位：右上角那两个专门按钮 */
const panels = await A.evaluate(`(() => {
  const disp = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : "缺元素"; };
  return { chat0: disp("#chatPanel"), q0: disp("#qualityPanel") };
})()`);
ok("开局聊天与画质面板都是收着的", panels.chat0 === "none" && panels.q0 === "none", JSON.stringify(panels));
await A.evaluate(`document.getElementById("qualityToggle").click()`);
const q = await until(A, `(() => {
  const p = document.getElementById("qualityPanel");
  if (!p || getComputedStyle(p).display === "none") return false;
  return { tiers: document.querySelectorAll("#qualityList button").length,
    cur: (document.querySelector("#qualityList button.on") || {}).dataset };
})()`, { tries: 6, ms: 300 });
ok("画质有专门的按钮和五档", q && q.tiers === 5, JSON.stringify(q));
// 曾经精细与极致都写着 2×：屏幕只有 2× 时倍率会被夹住，两档看起来一模一样。
ok("五档的强度标记互不重复", await A.evaluate(`(() => {
  const n = [...document.querySelectorAll("#qualityList .q-bars")].map((b) => b.children.length);
  return n.length === 5 && new Set(n).size === 5; })()`),
  await A.evaluate(`[...document.querySelectorAll("#qualityList .q-bars")].map((b)=>b.children.length).join(",")`));
await A.evaluate(`document.querySelector('#qualityList button[data-q="eco"]').click()`);
const eco = await until(A, `(() => { const R = window.__editor.renderer;
  return R.quality === "eco" && R.renderer.getPixelRatio() <= 0.75 && R.renderer.shadowMap.enabled === false; })()`, { tries: 6, ms: 300 });
ok("切到省电真的降了像素比并关掉阴影", !!eco,
  await A.evaluate(`JSON.stringify({q:window.__editor.renderer.quality,r:window.__editor.renderer.renderer.getPixelRatio(),s:window.__editor.renderer.renderer.shadowMap.enabled})`));
ok("档位记在设备上而不是地图数据里", await A.evaluate(`localStorage.getItem("ly.quality")`) === "eco",
  await A.evaluate(`localStorage.getItem("ly.quality")`));
await A.evaluate(`document.querySelector('#qualityList button[data-q="balanced"]').click()`);
await A.evaluate(`document.getElementById("qualityToggle").click()`);

// 先清成真空闲：进图时系统会播一条提示，不清掉就没法判断"空面板"到底空不空
await A.evaluate(`(() => { const l = document.getElementById("chatLog"); if (l) l.innerHTML = ""; })()`);
await A.evaluate(`document.getElementById("chatToggle").click()`);
const opened = await until(A, `getComputedStyle(document.getElementById("chatPanel")).display !== "none"`, { tries: 6, ms: 300 });
ok("聊天能展开成独立面板", !!opened);
ok("输入框在面板里", await A.evaluate(`!!document.querySelector("#chatPanel #chatBox")`));
// 在面板里 ≠ 看得见：#gameChatInput 那条绝对定位 + display:none 的旧规则让输入行整个消失，
// 而上面这条"在面板里"照样是绿的。量几何，不量存在。
const cp = await A.evaluate(`(() => { const p = document.getElementById("chatPanel").getBoundingClientRect(),
  i = document.getElementById("gameChatInput").getBoundingClientRect();
  return { ph: Math.round(p.height), ih: Math.round(i.height), inside: i.bottom <= p.bottom + 1 && i.top >= p.top - 1 }; })()`);
ok("输入行真的看得见且落在面板内", cp.ih >= 24 && cp.inside && cp.ph >= 120, JSON.stringify(cp));
ok("空面板给一行占位而不是留白", await A.evaluate(`(document.querySelector("#chatLog .cp-empty")||{}).textContent`) === "还没有人说话。",
  await A.evaluate(`document.getElementById("chatLog").innerHTML.slice(0,120)`));
await A.evaluate(`(() => { const g = window.__game;
  g.sendChat("面板第一条"); g._chatLine("同伴: 第二句", "#bfe0ff"); g._chatLine("系统一条", "#8fe3ef", "sys"); })()`);
const hist = await until(A, `document.querySelectorAll("#chatLog .cp-line").length`, { tries: 6, ms: 300 });
ok("面板里留完整历史，说话人各自上色", hist >= 3, "条数 " + hist);
ok("第一句话进来后占位行撤掉", await A.evaluate(`!document.querySelector("#chatLog .cp-empty")`));
ok("系统消息不冒充玩家发言", await A.evaluate(`!!document.querySelector("#chatLog .cp-line.sys")`));
await A.evaluate(`document.getElementById("chatToggle").click()`);
await sleep(300);
await A.evaluate(`window.__game._chatLine("别人: 收起时来的", "#bfe0ff")`);
ok("收起时来新消息会亮未读点", await until(A, `!document.getElementById("chatBadge").hidden`, { tries: 5, ms: 300 }));
await A.shot(path.join(ROOT, "tmp/ui-menu.png"));

/* ---------------- 联机：两个人真的在同一个房间里 ---------------- */
const playUrl = BASE + `/edit/216d665d3ca92bd1b9a2?play=1&pub=${pubId}&title=${encodeURIComponent("老攸赛道")}&author=${encodeURIComponent(nameA)}`;
await A.evaluate(`(() => { const m = document.getElementById("playMenu"); if (m) m.classList.remove("show"); })()`);
await B.goto(playUrl);
// 软件光栅化下第二张图要跑几十秒才起得来。不先等 B 就位就断言"A 看到了 B"，
// 测到的是启动速度而不是联机功能。
const bUp = await until(B, `(() => { const g = window.__game; return !!g && g.running && !!g.player; })()`, { tries: 90, ms: 1000 });
ok("B 也进了同一张图的运行时", bUp, await B.evaluate(`document.body.textContent.slice(0,120)`));
// 这一条等的是"两个进程各自的事件循环把消息送到对方屏幕上"，两个软件渲染的
// WebGL 页面同屏跑时这一步可能十几秒才轮到，所以给足耐心；判据本身不放宽。
const sawEachOther = await until(A, `(() => { const g = window.__game; return g && g._netPeers && g._netPeers.size === 1; })()`, { tries: 60, ms: 500 });
ok("B 进图后 A 的运行时里多出一个同伴", sawEachOther, await A.evaluate(`JSON.stringify({ peers: window.__game && window.__game._netPeers && window.__game._netPeers.size, online: window.__online })`));
ok("B 那边也看到 A", await until(B, `(() => { const g = window.__game; return g && g._netPeers && g._netPeers.size === 1; })()`), await B.evaluate(`String(window.__online)`));
const ghost = await A.evaluate(`(() => { const p = [...(window.__game._netPeers || new Map()).values()][0];
  return p ? { name: p.ent.customName, shown: p.ent.showEntityName, tags: [...p.ent._tags], solid: p.ent.collides, inScene: !!p.ent._obj.parent } : null; })()`);
ok("同伴是以账号昵称出现的角色，且不带碰撞", !!ghost && ghost.name === nameB && ghost.shown && !ghost.solid && ghost.inScene, JSON.stringify(ghost));
ok("联机分身不会冒充脚本眼里的 player", !!ghost && ghost.tags.indexOf("player") === -1, JSON.stringify(ghost));
// 刚进来的人还没报坐标时，服务端记的是 [0,0,0]。真把分身摆到原点，
// 他就长在相机里糊满半个屏幕——这条断言盯的就是这个。
const moved = await until(A, `(() => { const p = [...(window.__game._netPeers || new Map()).values()][0];
  if (!p || !Number.isFinite(p.ent.position.x)) return false;
  const d = Math.hypot(p.ent.position.x, p.ent.position.y, p.ent.position.z);
  return d > 1; })()`, { tries: 20, ms: 500 });
ok("同伴不会站在世界原点（不会糊在镜头上）", moved,
  await A.evaluate(`(() => { const p = [...(window.__game._netPeers || new Map()).values()][0]; return p ? JSON.stringify(p.ent.position) : "null"; })()`));
const badge = await A.evaluate(`(document.getElementById("hudOnline") || {}).textContent`);
ok("HUD 显示 2 人在线", badge === "2 人在线", String(badge));

const sent = await B.evaluate(`(() => { const g = window.__game; const okSend = !!(g._net && g._net.live); g.sendChat("我进来了，看得见我吗"); return okSend; })()`);
ok("发送时 B 的房间通道是连着的", sent === true);
// 聊天条本身 15 秒后会淡掉，所以这条只能"当场看到"。两个软件渲染的 WebGL 页面
// 同屏跑时，A 的主线程可能几十秒才轮到处理一条消息——等得起，判据不放宽。
const heard = await until(A, `document.getElementById("gameChat").textContent.includes("看得见我吗")`, { tries: 90, ms: 1000 });
if (!heard) {
  console.log("      A: " + await A.evaluate(`JSON.stringify({ chat: document.getElementById("gameChat").textContent.slice(0, 120), peers: window.__game._netPeers.size })`));
  console.log("      B: " + await B.evaluate(`JSON.stringify({ chat: document.getElementById("gameChat").textContent.slice(0, 120), live: !!(window.__game._net && window.__game._net.live) })`));
  console.log("      server: " + boot.join("").slice(-600));
}
ok("B 说的话出现在 A 的聊天条上", heard);
await A.shot(path.join(ROOT, "tmp/ui-multiplayer.png"));

// 真人离开是关标签页，不是去调 stop()。走 target 关闭才碰到服务端那条 end 分支。
const errsB = await B.evaluate(`JSON.stringify((window.__errs || []).slice(0, 5))`);
await B.close();
const left = await until(A, `window.__game._netPeers.size === 0`, { tries: 24, ms: 500 });
ok("对方关标签页后房间里的分身被收掉", left, await A.evaluate(`JSON.stringify({ n: window.__game._netPeers.size, online: window.__online })`));
ok("人走了 HUD 上的在线数跟着回落", await until(A, `(document.getElementById("hudOnline")||{}).textContent === ""`), await A.evaluate(`String((document.getElementById("hudOnline")||{}).textContent)`));

/* ---------------- 编辑器里的运行：作者路径 ---------------- */
// 不带 pub 的那一路是作者预览，出口必须是编辑器；而且"按了没反应"等于没有退出方式。
await A.goto(BASE + "/edit/216d665d3ca92bd1b9a2?play=1");
const replay = await until(A, `!!(window.__game && window.__game.running && window.__game.player)`, { tries: 80, ms: 1000 });
ok("作者路径也能进运行", !!replay, await A.evaluate(`document.body.textContent.slice(0,120)`));
const pos0 = await A.evaluate(`(() => { const p = window.__game.playerEntity.position; return [p.x, p.z]; })()`);
await A.send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
let walked = 0;
for (let i = 0; i < 40 && walked < 0.6; i++) {
  await sleep(250);
  walked = await A.evaluate(`(() => { const p = window.__game.playerEntity.position; return Math.hypot(p.x - ${pos0[0]}, p.z - ${pos0[1]}); })()`);
}
ok("按 W 真的往前走", walked > 0.6, "位移 " + walked);
await A.send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
// 脸朝向与移动方向必须同向：曾经角色往前挪、脸朝后走（部件组转了 180° 而父级公式没跟着改）
const face = await A.evaluate(`(() => {
  const ent = window.__game.playerEntity; ent._obj.updateWorldMatrix(true, true);
  const e = ent._obj.matrixWorld.elements;
  let wx = -e[8], wz = -e[10]; const fl = Math.hypot(wx, wz) || 1;
  const v = ent.velocity, dl = Math.hypot(v.x, v.z);
  return dl < 1e-4 ? null : +(((wx / fl) * (v.x / dl)) + ((wz / fl) * (v.z / dl))).toFixed(2);
})()`);
ok("角色脸朝向与移动方向一致", face === null || face > 0.6, "dot=" + face);
await A.evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }))`);
const emenu = await until(A, `(() => { const m = document.getElementById("playMenu"); return m && m.classList.contains("show") ? (document.querySelector("#gmLeave")||{}).textContent : false; })()`, { tries: 6, ms: 400 });
ok("作者预览的出口写着「返回编辑器」，且第一次按 Esc 就出现", emenu === "返回编辑器", String(emenu));
await A.evaluate(`document.querySelector('#playMenu [data-x="leave"]').click()`);
ok("点出口回到编辑器", await until(A, `!window.__game.running && !document.body.classList.contains("playing")`, { tries: 12, ms: 400 }));
ok("退出后菜单不留在屏幕上", await A.evaluate(`(() => { const m = document.getElementById("playMenu"); return !m || !m.classList.contains("show"); })()`));

/* ---------------- 授权之后同一张卡改口：数字是服务端现读的 ---------------- */
{
  // 放在最后：这一步会把示例世界换成随包的真模板，前面的断言都还在用那张小图。
  await A.evaluate(`fetch("/api/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({racingTemplate:true,racingAssets:true})})`);
  await sleep(2000);
  await A.goto(BASE + "/"); await sleep(1500);
  const c = (await pageFetch(A, "GET", "/api/consent")).json || {};
  const f = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));
  const want = `${c.template.shape.join("×")} · ${f(c.template.blocks)} 方块 · ${c.template.entities} 实体`;
  const on = await until(A, `(document.querySelector(".wb-start.hot .m")||{}).textContent === ${JSON.stringify(want)} ? ${JSON.stringify(want)} : null`, { tries: 20, ms: 300 });
  ok("授权之后起点卡改成服务端的尺寸与数量", on === want && c.installed === true, JSON.stringify({ on, want, installed: c.installed }));
}

/* 全程不许有未捕获异常：上面每一条都可能"看着过了"其实页面早就报错在跑降级路径 */
const errsA = await A.evaluate(`JSON.stringify((window.__errs || []).slice(0, 5))`);
ok("两个会话全程没有未捕获错误", errsA === "[]" && errsB === "[]", "A=" + errsA + " B=" + errsB);

console.log(`\nplatform: ${pass} passed, ${fail} failed`);
await A.close(); await B.close();
process.exit(fail ? 1 : 0);
