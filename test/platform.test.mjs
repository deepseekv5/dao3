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
  leave: (document.querySelector("#pmLeave") || {}).textContent,
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

/* 全程不许有未捕获异常：上面每一条都可能"看着过了"其实页面早就报错在跑降级路径 */
const errsA = await A.evaluate(`JSON.stringify((window.__errs || []).slice(0, 5))`);
ok("两个会话全程没有未捕获错误", errsA === "[]" && errsB === "[]", "A=" + errsA + " B=" + errsB);

console.log(`\nplatform: ${pass} passed, ${fail} failed`);
await A.close(); await B.close();
process.exit(fail ? 1 : 0);
