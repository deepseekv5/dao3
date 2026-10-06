/**
 * test/social.test.mjs — 社交层的浏览器回归：好友面板、扩列、私聊、世界频道、主页资料。
 *
 * 为什么必须两个真浏览器会话：这一层的全部判据都是"另一个人那边变了没有"。
 * 用 fetch 能测通接口，但测不出抽屉打不开、未读角标不涨、对方接受之后我这边
 * 列表不刷新、主页上皮肤根本没画这几类问题——它们全是"两个会话 + 真 DOM"才现形的。
 *
 * 运行：npm run test:social
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session, freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(6300, 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-social-"));
const PW = "a-long-enough-password-42";
const RUN = "s" + Date.now().toString(36).slice(-5);
const NAME_A = RUN + "甲";
const NAME_B = RUN + "乙";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 320) : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
function cleanup() {
  try { child.kill("SIGTERM"); } catch { /* 已退 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 交给系统 */ }
}
process.on("exit", cleanup);

let up = false;
for (let i = 0; i < 80; i++) {
  await sleep(200);
  try {
    const j = await (await fetch(BASE + "/api/whoami")).json().catch(() => null);
    if (j && j.app === "laoyou-metaverse") { up = true; break; }
  } catch { /* 还没起来 */ }
}
if (!up) { console.log("FAIL  服务没起来"); process.exit(1); }

/* ---------------- 服务端先造好两个账号与资料 ---------------- */
function client() {
  const jar = new Map();
  return {
    jar,
    get csrf() { return jar.get("ly_csrf") || ""; },
    cookieHeader() { return [...jar].map(([k, v]) => `${k}=${v}`).join("; "); },
    async call(method, p, body) {
      if (method !== "GET" && !jar.get("ly_csrf")) await this.call("GET", "/api/community/me");
      const headers = { "Content-Type": "application/json" };
      if (jar.size) headers.cookie = this.cookieHeader();
      if (method !== "GET") headers["x-csrf-token"] = this.csrf;
      const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      for (const line of res.headers.getSetCookie?.() || []) {
        const [kv] = line.split(";");
        const i = kv.indexOf("=");
        const k = kv.slice(0, i).trim(), v = decodeURIComponent(kv.slice(i + 1).trim());
        if (v === "") jar.delete(k); else jar.set(k, v);
      }
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    boot() { return this.call("GET", "/api/community/me"); },
  };
}
const A = client(); const B = client();
await A.boot(); await B.boot();
const rA = await A.call("POST", "/api/community/register", { name: NAME_A, password: PW });
const rB = await B.call("POST", "/api/community/register", { name: NAME_B, password: PW });
ok("两个测试账号注册成功", rA.status === 200 && rB.status === 200, JSON.stringify([rA.status, rB.status]));
const ID_A = rA.data.user.id, ID_B = rB.data.user.id;

const profA = await A.call("PATCH", "/api/community/me", {
  bio: "跑图与建图都来一点", region: "广东", gender: "f", looking: "open", persona: ["funny", "craft"],
  skin: { skin: "#e8b48c", shirt: "#12b5c9", pants: "#2b3550", hair: "#1c1c1e", shoe: "#241f1a" },
});
ok("甲的资料四件都收下了",
  profA.data.user.region === "广东" && profA.data.user.gender === "f"
  && profA.data.user.looking === "open" && profA.data.user.persona.join(",") === "funny,craft",
  JSON.stringify(profA.data.user).slice(0, 200));
// 乙穿骨骼皮肤（那台 CC0 机甲）：主页要能把它画出来，这条也顺带钉住"给别人看皮肤"这条路
await B.call("PATCH", "/api/community/me", {
  region: "浙江", gender: "m", looking: "team",
  skin: { name: "ATLAS-09 机甲", kind: "rig", model: "/skins/atlas-09.glb",
    bones: { hips: "pelvis", torso: "chest", head: "head", leftUpperArm: "upper_armL", rightUpperArm: "upper_armR",
      leftLowerArm: "forearmL", rightLowerArm: "forearmR", leftUpperLeg: "thighL", rightUpperLeg: "thighR",
      leftLowerLeg: "shinL", rightLowerLeg: "shinR" } },
});

const chrome = await launchChrome({});
async function session(name, cookie) {
  const s = await Session.open(chrome.port, { isolated: true, width: 1280, height: 820,
    // 免责声明是本地首屏闸门：不预先 ack，截图拍到的只有那张弹窗，
    // 界面判据（抽屉、主页卡片）看着"通过"其实全在弹窗底下。
    initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3");}catch(e){}'] });
  await s.send("Network.enable", {});
  for (const [k, v] of cookie) {
    await s.send("Network.setCookie", { name: k, value: v, url: BASE, path: "/", httpOnly: k === "ly_session", sameSite: "Lax" });
  }
  await s.goto(BASE + "/community", { settleMs: 1400 });
  return s;
}
const SA = await session("A", A.jar);
const SB = await session("B", B.jar);
const ev = (s, body) => s.evaluate(`(async () => { ${body} })()`);
const openDrawer = (s, tab) => ev(s, `
  const b = document.getElementById("soEntry");
  if (!b) return "no-entry";
  b.click();
  await new Promise((r) => setTimeout(r, 300));
  const t = document.querySelector('.so-tabs [data-tab="${tab}"]');
  t && t.click();
  await new Promise((r) => setTimeout(r, 900));
  return document.querySelector("#soDrawer").classList.contains("on");`);
const rows = (s, sel) => ev(s, `return [...document.querySelectorAll('${sel}')].map((e) => e.textContent.trim());`);

/* ---------------- 1. 入口与抽屉 ---------------- */
const hasEntry = await ev(SA, `return !!document.getElementById("soEntry");`);
ok("顶栏有那颗消息入口（登录之后才出现）", hasEntry === true, String(hasEntry));
const opened = await openDrawer(SA, "expand");
ok("点一下抽屉真的滑出来并停在「扩列」", opened === true, String(opened));

/* ---------------- 2. 扩列：按地区找人并加好友 ---------------- */
const filtered = await ev(SA, `
  const q = document.querySelector(".so-filters .so-q");
  q.value = "${NAME_B}"; q.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  const row = [...document.querySelectorAll(".so-people .so-row")].find((e) => e.textContent.includes("${NAME_B}"));
  return JSON.stringify({ hit: !!row, txt: row ? row.textContent.replace(/\\s+/g, " ") : "", add: !!(row && row.querySelector("[data-add]")) });`);
const F2 = JSON.parse(filtered);
ok("扩列能搜到对方，并且给的是「加好友」而不是私聊", F2.hit && F2.add, filtered);
ok("扩列卡片上就写着地区 / 性别 / 扩列状态（不用点进主页）",
  /浙江/.test(F2.txt) && /男/.test(F2.txt) && /找固定队友/.test(F2.txt), F2.txt);
await SA.shot("tmp/social-expand.png");
const added = await ev(SA, `
  const row = [...document.querySelectorAll(".so-people .so-row")].find((e) => e.textContent.includes("${NAME_B}"));
  row.querySelector("[data-add]").click();
  await new Promise((r) => setTimeout(r, 1200));
  const back = [...document.querySelectorAll(".so-people .so-row")].find((e) => e.textContent.includes("${NAME_B}"));
  return back ? back.textContent.replace(/\\s+/g, " ") : "";`);
ok("加好友之后卡片变成「等待回应」（请求真的发出去了）", /等待回应/.test(added), added);

/* ---------------- 3. 好友请求：乙那边接受 ---------------- */
await openDrawer(SB, "friends");
const reqSeen = await ev(SB, `
  return [...document.querySelectorAll("#soBody .so-row [data-acc]")].map((b) => b.closest(".so-row").textContent).join("|");`);
ok("乙的好友页签里躺着这条请求（带接受按钮）", reqSeen.includes(NAME_A), reqSeen.slice(0, 200));
await ev(SB, `
  const b = document.querySelector("#soBody .so-row [data-acc]");
  b.click();
  await new Promise((r) => setTimeout(r, 1400));
  return 1;`);
const friendOf = await ev(SB, `
  const row = [...document.querySelectorAll("#soBody .so-row")].find((e) => e.textContent.includes("${NAME_A}"));
  return JSON.stringify({ inFriends: !!row, hasDm: !!(row && row.querySelector("[data-dm]")), hasNote: !!(row && row.querySelector("[data-note]")) });`);
ok("接受之后甲出现在乙的好友列表里，并且能私聊、能备注", JSON.parse(friendOf).inFriends && JSON.parse(friendOf).hasDm, friendOf);
await ev(SB, `
  const row = [...document.querySelectorAll("#soBody .so-row")].find((e) => e.textContent.includes("${NAME_A}"));
  const btn = row.querySelector("[data-note]");
  const old = window.prompt; window.prompt = () => "老搭子";
  btn.click();
  await new Promise((r) => setTimeout(r, 1200));
  window.prompt = old;
  return document.querySelector("#soBody").textContent;`);
const noted = await rows(SB, "#soBody .so-main b");
ok("备注改完立刻显示在列表上（真名跟着括在边上）", noted.some((t) => /老搭子/.test(t)), JSON.stringify(noted));

/* ---------------- 4. 私聊：双向都看得见，未读会涨会清 ---------------- */
const conv = JSON.parse(await ev(SB, `
  const row = [...document.querySelectorAll("#soBody .so-row")].find((e) => /${NAME_A}/.test(e.textContent));
  row.querySelector("[data-dm]").click();
  await new Promise((r) => setTimeout(r, 1200));
  // 全新一个会话（还没说过话）打开必须是空会话，不是"读不到这条私聊"
  const fresh = ((document.getElementById("soLog") || {}).textContent || "").trim();
  const box = document.getElementById("soBox");
  box.value = "在吗，一起跑那张赛车图";
  document.getElementById("soGo").click();
  await new Promise((r) => setTimeout(r, 1600));
  return JSON.stringify({
    fresh,
    n: document.querySelectorAll(".so-msg").length,
    mine: !!document.querySelector(".so-msg.mine"),
    conv: !!document.querySelector(".so-conv"),
    log: ((document.getElementById("soLog") || {}).outerHTML || "").slice(0, 200),
    toast: ((document.getElementById("cmToast") || {}).textContent || "").slice(0, 120) });`));
ok("点开一个还没说过话的好友，会话是空的而不是报错",
  !/读不到|失败|错误/.test(conv.fresh || ""), JSON.stringify({ fresh: conv.fresh }));
ok("私聊会话打开并发了出去（自己那条靠右）", conv.n >= 1 && conv.mine, JSON.stringify(conv).slice(0, 420));
await SB.shot("tmp/social-dm.png");

const badgeA = JSON.parse(await ev(SA, `
  await new Promise((r) => setTimeout(r, 1200));
  const b = document.getElementById("soBadge");
  return JSON.stringify({ hidden: b ? b.hidden : null, txt: b ? b.textContent : "", open: document.querySelector("#soDrawer").classList.contains("on") });`));
ok("甲那边角标涨了（抽屉开着也能算，靠的是推送不是刷新）", badgeA.hidden === false && Number(badgeA.txt) >= 1, JSON.stringify(badgeA));
const readA = await ev(SA, `
  document.getElementById("soEntry").click();
  await new Promise((r) => setTimeout(r, 500));
  document.querySelector('.so-tabs [data-tab="messages"]').click();
  await new Promise((r) => setTimeout(r, 1400));
  const t = [...document.querySelectorAll("[data-ch]")].find((e) => e.textContent.includes("${NAME_B}"));
  if (!t) return "no-thread";
  t.click();
  await new Promise((r) => setTimeout(r, 1600));
  return JSON.stringify({
    msgs: [...document.querySelectorAll(".so-msg .so-bubble span")].map((e) => e.textContent),
    badge: (document.getElementById("soBadge") || {}).textContent });`);
const RD = JSON.parse(readA);
ok("甲打开会话看得见乙那句话，未读随之清零",
  Array.isArray(RD.msgs) && RD.msgs.some((x) => x.includes("一起跑那张赛车图")) && (!RD.badge || Number(RD.badge) === 0), readA);

/* ---------------- 5. 世界频道：不进气房也收得到 ---------------- */
const world = await ev(SA, `
  document.querySelector('.so-tabs [data-tab="messages"]').click();
  await new Promise((r) => setTimeout(r, 900));
  const w = [...document.querySelectorAll("[data-ch]")].find((e) => e.dataset.ch === "world");
  w.click();
  await new Promise((r) => setTimeout(r, 1200));
  const box = document.getElementById("soBox");
  box.value = "${RUN} 全世界都听得见";
  document.getElementById("soGo").click();
  await new Promise((r) => setTimeout(r, 1200));
  return [...document.querySelectorAll(".so-msg .so-bubble span")].map((e) => e.textContent).join("|");`);
ok("世界频道发得出去也看得见", world.includes(RUN + " 全世界都听得见"), world.slice(0, 200));
const worldB = await ev(SB, `
  document.querySelector('.so-tabs [data-tab="messages"]').click();
  await new Promise((r) => setTimeout(r, 900));
  const w = [...document.querySelectorAll("[data-ch]")].find((e) => e.dataset.ch === "world");
  w.click();
  await new Promise((r) => setTimeout(r, 1800));
  return [...document.querySelectorAll(".so-msg .so-bubble span")].map((e) => e.textContent).join("|");`);
ok("乙没进任何房间，也在世界频道里看到这句（推送到了社交连接）",
  worldB.includes(RUN + " 全世界都听得见"), worldB.slice(0, 200));

/* ---------------- 6. 陌生人拿不到别人的私聊（服务端与界面同一道闸） ---------------- */
const C = client();
await C.boot();
await C.call("POST", "/api/community/register", { name: RUN + "丙", password: PW });
// 私聊 key 是"我自己 + 对方"算出来的，所以丙读 dm:<甲> 读到的是**丙自己那条空会话**，
// 而不是甲乙的对话。判据因此是"拿不到甲乙那句话"，不是"报 400"。
const leak = await C.call("GET", "/api/community/chat?ch=dm:" + ID_A);
const leaked = ((leak.data || {}).rows || []).some((x) => /一起跑那张赛车图/.test(x.text || ""));
ok("陌生人读 dm 只会拿到自己那条空会话，拿不到甲乙的对话",
  leak.status === 200 && leaked === false, JSON.stringify(leak.data).slice(0, 160));
const dmNo = await C.call("POST", "/api/community/chat", { ch: "dm:" + ID_A, text: "陌生人居然能私聊" });
ok("非好友发不出私聊（先加好友这条规矩在服务端）", dmNo.status === 400 && /好友/.test(dmNo.data.error || ""), JSON.stringify(dmNo.data));

/* ---------------- 7. 主页：皮肤、地区、性别、性格 ---------------- */
// 页面内改 location.href 会把当前执行上下文一起销毁，evaluate 的 promise 拿不回来；
// 跳页一律走 CDP 的 goto。
await SB.goto(BASE + "/u/" + encodeURIComponent(NAME_A), { settleMs: 1800 });
const pf = await ev(SB, `
  // 主页皮肤预览现在是图内同款 3D 人偶（avatar.js），挂载走动态 import，
  // 所以这里必须等它真的出现，固定 settle 会读到还没画出来的空槽。
  let cv = null;
  for (let i = 0; i < 40 && !cv; i++) {
    cv = document.querySelector(".pf-dollbox canvas");
    if (!cv) await new Promise((r) => setTimeout(r, 150));
  }
  let colors = 0;
  if (cv) {
    const c = document.createElement("canvas"); c.width = 48; c.height = 60;
    const x = c.getContext("2d"); x.drawImage(cv, 0, 0, 48, 60);
    const d = x.getImageData(0, 0, 48, 60).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 24) continue;
      seen.add((d[i] >> 3) + "," + (d[i + 1] >> 3) + "," + (d[i + 2] >> 3));
    }
    colors = seen.size;
  }
  return JSON.stringify({
    hasCard: !!document.querySelector(".pf-card"),
    doll: !!cv,
    paper: !!document.querySelector(".pf-dollbox .pf-doll"),
    colors,
    facts: [...document.querySelectorAll(".pf-fact")].map((e) => e.textContent.replace(/\\s+/g, " ")),
    tags: [...document.querySelectorAll(".pf-tagline .pf-tag")].map((e) => e.textContent),
    dm: !!document.getElementById("pfDm"),
    friend: !!document.getElementById("pfFriend"),
  });`);
const P7 = JSON.parse(pf);
ok("主页有皮肤预览（用的是图内同款 3D 人偶，画得出多个色阶）",
  P7.hasCard && P7.doll && !P7.paper && P7.colors >= 4, pf);
ok("主页显示地区 / 性别 / 扩列状态", P7.facts.some((f) => /广东/.test(f)) && P7.facts.some((f) => /女/.test(f))
  && P7.facts.some((f) => /欢迎扩列/.test(f)), JSON.stringify(P7.facts));
ok("主页显示性格标签", P7.tags.join(",") === "搞笑,爱建", JSON.stringify(P7.tags));
ok("已是好友：主页给「私聊」按钮", P7.dm === true && P7.friend === true, pf);
await SB.shot("tmp/social-profile.png");

await SA.goto(BASE + "/u/" + encodeURIComponent(NAME_B), { settleMs: 5200 });
const rig = await ev(SA, `
  const box = document.querySelector(".pf-dollbox");
  const cv = box && box.querySelector("canvas");
  return JSON.stringify({ hasCanvas: !!cv, w: cv ? cv.width : 0, txt: box ? box.textContent.trim() : "" });`);
const R7 = JSON.parse(rig);
ok("骨骼皮肤的主页用真模型预览（canvas 画得出来，不是退回方块人偶）",
  R7.hasCanvas && R7.w > 0, rig);
await SA.shot("tmp/social-profile-rig.png");

/* ---------------- 8. 编辑资料那四个字段在界面上能改 ---------------- */
await SA.goto(BASE + "/u/" + encodeURIComponent(NAME_A), { settleMs: 1600 });
const edit = await ev(SA, `
  document.getElementById("pfEdit").click();
  await new Promise((r) => setTimeout(r, 700));
  return JSON.stringify({
    region: !!document.getElementById("eRegion"),
    gender: !!document.getElementById("eGender"),
    looking: !!document.getElementById("eLooking"),
    tags: document.querySelectorAll("#eTags [data-tag]").length,
    on: [...document.querySelectorAll("#eTags .pf-tag.on")].map((b) => b.textContent),
    regionVal: document.getElementById("eRegion").value,
  });`);
const E8 = JSON.parse(edit);
ok("编辑资料里有地区 / 性别 / 扩列 / 12 个性格标签，并且回填了现值",
  E8.region && E8.gender && E8.looking && E8.tags === 12 && E8.regionVal === "广东", edit);
const capped = await ev(SA, `
  const btns = [...document.querySelectorAll("#eTags [data-tag]")];
  for (const b of btns) if (!b.classList.contains("on")) b.click();
  await new Promise((r) => setTimeout(r, 300));
  return document.querySelectorAll("#eTags .pf-tag.on").length;`);
ok("性格标签封顶 6 个（多点不会无限加）", capped === 6, String(capped));

await SA.close(); await SB.close();
console.log(`\nsocial: ${pass} passed, ${fail} failed`);
// 必须显式退出：spawn 出来的 server.js 占着 stdio 管道，事件循环不会空，
// 于是这个脚本每次都"打印完结论然后挂住"，攒下一堆僵尸把后面的浏览器测试拖死。
cleanup();
process.exit(fail ? 1 : 0);
