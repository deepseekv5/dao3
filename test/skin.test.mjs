/**
 * test/skin.test.mjs — 皮肤两条新链路的浏览器回归：
 *   A. 骨骼皮肤（CC0 机甲）：认关节 → 推朝向 → 装成人偶 → **由运行时自己的姿态函数驱动它**
 *   B. 皮肤社区：广场能按皮肤筛、详情页能一键穿到账号上
 *
 * 为什么必须跑在浏览器里：A 的判据是"骨骼的世界位移方向对不对"，
 * 这需要真 GLTFLoader 解析真 .glb、真 three 算真矩阵；在 Node 里既没有
 * 裸名 "three" 的解析能力，也证不了绑定后的骨骼会不会动。
 * 为什么要拿 GameRuntime.prototype._updateAvatar 来驱动而不是测试自己写姿态：
 * 自己写一遍公式，测的就只是 skin-rig 自己，而不是"运行时接得上"这件事。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session, freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(6100, 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-skin-"));
const PW = "a-long-enough-password-42";
const RUN = "r" + Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
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
for (let i = 0; i < 60; i++) {
  await sleep(200);
  try {
    const j = await (await fetch(BASE + "/api/whoami")).json().catch(() => null);
    if (j && j.app === "laoyou-metaverse") { up = true; break; }
  } catch { /* 还没起来 */ }
}
if (!up) { console.log("FAIL  服务没起来"); process.exit(1); }

/* 最小 cookie 客户端（与 community.test.mjs 同一套口径） */
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

/* ---------- B 的前置：服务端先造一套皮肤发布，浏览器只负责看与穿 ---------- */
const U = client();
await U.boot();
const nameU = `皮肤作者${RUN.slice(1)}`;
const reg = await U.call("POST", "/api/community/register", { name: nameU, password: PW });
ok("测试账号已注册", reg.status === 200 && !!reg.data.user, JSON.stringify(reg.data).slice(0, 120));
const six = { head: "#1f6f8b", body: "#12313f", armL: "#12313f", armR: "#12313f", legL: "#2a2f45", legR: "#1a1d2b" };
const pub = await U.call("POST", "/api/community/publish", {
  kind: "skin", title: RUN + " 深海配色", slug: RUN + "-deep", desc: "回归测试用",
  skin: { name: RUN + " 深海配色", skin: six },
});
ok("配色皮肤已发布到皮肤社区", pub.status === 200 && pub.data.pub?.kind === "skin", JSON.stringify(pub.data).slice(0, 140));
const pubId = pub.data.pub.id;

const chrome = await launchChrome({});
const S = await Session.open(chrome.port, { isolated: true, width: 980, height: 720 });
// 把刚才那个账号的会话搬进浏览器：不然"应用到我的角色"只会弹登录框，测不到写入
await S.send("Network.enable", {});
for (const [k, v] of U.jar) {
  await S.send("Network.setCookie", { name: k, value: v, url: BASE, path: "/", httpOnly: k === "ly_session", sameSite: "Lax" });
}

/* ---------- A. 骨骼皮肤：由运行时自己的姿态函数驱动 ---------- */
// 用 /voxa 而不是工作台首页：GLTFLoader 按裸名 "three" 引依赖，只有带 importmap 的页面能解析
await S.goto(BASE + "/voxa", { settleMs: 1500 });
const A = JSON.parse(await S.evaluate(`(async () => {
  const T = await import('/vendor/three/three.module.js');
  const R = await import('/js/skin-rig.js');
  const { GameRuntime } = await import('/js/game.js');
  const scene = await R.loadRigScene('/skins/atlas-09.glb');
  const names = R.boneNames(scene);
  const auto = R.autoMap(names);
  // 这里刻意用**内置预设那张表**（编辑器「内置机甲」按钮与 VOXA 默认皮肤走的就是它），
  // 不再用现场 autoMap：表里一个关节名写错，穿上去就是"模型在但站着不动"，
  // 而 autoMap 会替它兜底、把这个问题永远测不出来。
  const P = (await import('/js/skin-presets.js')).DEFAULT_SKIN_RIG;
  const presetBad = Object.entries(P.bones).filter(([, n]) => !names.includes(n)).map(([s]) => s);
  const presetMiss = Object.keys(auto).filter((s) => !P.bones[s]);
  const map = P.bones;
  const fwd = R.deriveFacing(scene, map);
  const rec = { model: '/skins/atlas-09.glb', bones: map };
  const av = R.assembleRig(await R.loadRigScene('/skins/atlas-09.glb'), rec);
  const box = new T.Box3().setFromObject(av);
  const byName = new Map();
  av.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const at = (slot) => byName.get(map[slot]).getWorldPosition(new T.Vector3());
  const rest = { lfoot: at('leftFoot'), rfoot: at('rightFoot'), lhand: at('leftHand'), rhand: at('rightHand') };
  // 用运行时那一个函数驱动：它写的是 parts/rig 的 rotation.x/.z，
  // 契约对不上就根本动不了，比任何"看起来像"都硬。
  const ent = { _avatar: av, _netAnim: 'run', player: null };
  const fake = { _animCode: () => 'run' };
  const F = fwd.clone().setY(0).normalize();
  const Rr = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), F).normalize();
  // 一个步态周期里逐帧采样，取"最大前后摆"与"最大左右摆"来比：
  // 只量最后一下是不行的——那一帧的相位可能刚好在零点附近，看着像没动。
  const series = [];
  for (let i = 0; i < 46; i++) {
    GameRuntime.prototype._updateAvatar.call(fake, ent, 0.03);
    av.updateWorldMatrix(true, true);
    const v = (r, cur) => cur.sub(r);
    const lf = v(rest.lfoot, at('leftFoot')), rf = v(rest.rfoot, at('rightFoot'));
    const lh = v(rest.lhand, at('leftHand')), rh = v(rest.rhand, at('rightHand'));
    series.push({ lf: lf.dot(F), rf: rf.dot(F), lh: lh.dot(F), rh: rh.dot(F),
      ls: Math.abs(lf.dot(Rr)) + Math.abs(rf.dot(Rr)), len: lh.length() });
  }
  const amax = (k) => Math.max(...series.map((x) => Math.abs(x[k])));
  const peakL = amax('lf'), peakR = amax('rf'), peakLH = amax('lh'), peakRH = amax('rh');
  const minProd = (a, b) => Math.min(...series.map((x) => x[a] * x[b]));
  const maxSide = Math.max(...series.map((x) => x.ls));
  return JSON.stringify({
    slots: Object.keys(map).length, hasNeck: !!map.neck,
    presetBad, presetMiss,
    facing: [F.x, F.y, F.z].map((v) => +v.toFixed(2)),
    height: +(box.max.y - box.min.y).toFixed(2), floor: +box.min.y.toFixed(3),
    parts6: ['head','body','armL','armR','legL','legR'].every((k) => av.userData.parts[k]),
    joints4: ['elbowL','elbowR','kneeL','kneeR'].every((k) => av.userData.rig[k]),
    noBob: Object.keys(av.userData.rig.base || {}).length === 0, rigSkin: !!av.userData.rigSkin,
    peakL: +peakL.toFixed(3), peakR: +peakR.toFixed(3), peakLH: +peakLH.toFixed(3), peakRH: +peakRH.toFixed(3),
    maxSide: +maxSide.toFixed(3), legOpp: +minProd('lf', 'rf').toFixed(4), armOpp: +minProd('lh', 'rh').toFixed(4),
  });
})()`));
ok("内置预设的每一个关节名都在模型里真实存在（认不出的那一段会站着不动）",
  A.presetBad.length === 0, JSON.stringify(A.presetBad));
ok("预设覆盖 autoMap 能认出的每一段（这台没有 neck，其余 17 段一一对上）",
  A.slots === 17 && !A.hasNeck && A.presetMiss.length === 0, JSON.stringify({ slots: A.slots, miss: A.presetMiss }));
ok("朝向由骨架几何推出：这台机甲脸朝 -Z", A.facing[2] === -1 && Math.abs(A.facing[0]) < 0.01, JSON.stringify(A.facing));
ok("装出来的是同一个人偶契约（六块 + 四关节 + rigSkin 标记）",
  A.parts6 && A.joints4 && A.rigSkin && A.noBob, JSON.stringify({ p: A.parts6, j: A.joints4, s: A.rigSkin, b: A.noBob }));
ok("身高归一到 1.8 格、脚底落在原点", Math.abs(A.height - 1.82) < 0.06 && Math.abs(A.floor) < 0.02, JSON.stringify([A.height, A.floor]));
ok("运行时 _updateAvatar 一驱动，脚就沿前后方向迈出去（不是左右劈）",
  A.peakL > 0.15 && A.peakR > 0.15 && A.peakL + A.peakR > A.maxSide * 2,
  JSON.stringify({ peakL: A.peakL, peakR: A.peakR, maxSide: A.maxSide }));
ok("两条腿反相、两只手也反相（走路而不是行军礼）",
  A.legOpp < -0.3 * A.peakL * A.peakR && A.armOpp < -0.3 * A.peakLH * A.peakRH,
  JSON.stringify({ legOpp: A.legOpp, armOpp: A.armOpp, peaks: [A.peakL, A.peakR, A.peakLH, A.peakRH] }));

/* ---------- B. 皮肤社区 UI ---------- */
await S.goto(BASE + "/community", { settleMs: 1600 });
const tabs = await S.evaluate(`(() => [...document.querySelectorAll(".cm-kind")].map((b) => b.textContent.trim()).join("/"))()`);
ok("广场的类型切换里有「皮肤」这一格", /皮肤/.test(tabs), tabs);
await S.evaluate(`(() => { const b = [...document.querySelectorAll(".cm-kind")].find((x) => x.textContent.trim() === "皮肤"); b && b.click(); return 1; })()`);
await sleep(1500);
const feed = await S.evaluate(`(() => {
  const cards = [...document.querySelectorAll(".cm-card")];
  return JSON.stringify({ n: cards.length, titles: cards.map((c) => (c.querySelector(".cm-title") || {}).textContent),
    badges: cards.map((c) => (c.querySelector(".cm-badge") || {}).textContent) });
})()`);
const F1 = JSON.parse(feed);
ok("切到皮肤之后只列皮肤卡", F1.n > 0 && F1.badges.every((b) => b === "皮肤") && F1.titles.some((t) => t && t.includes(RUN)),
  JSON.stringify(F1).slice(0, 220));
await S.evaluate(`(() => { const c = [...document.querySelectorAll(".cm-card")].find((x) => (x.querySelector(".cm-title")||{}).textContent?.includes(${JSON.stringify(RUN)})); c && c.click(); return 1; })()`);
await sleep(1600);
const detail = await S.evaluate(`(() => {
  const b = document.getElementById("cmApply");
  return JSON.stringify({ hasApply: !!b, label: b ? b.textContent.trim() : "", url: location.pathname });
})()`);
const D = JSON.parse(detail);
ok("皮肤详情页给的是「应用到我的角色」，不是「开始游玩」", D.hasApply && /应用到我的角色/.test(D.label), JSON.stringify(D));
await S.evaluate(`(() => { document.getElementById("cmApply").click(); return 1; })()`);
await sleep(1400);
const worn = await S.evaluate(`(async () => {
  const r = await fetch("/api/community/me", { credentials: "same-origin" });
  const j = await r.json();
  return JSON.stringify({ skin: j.user.skin, name: j.user.name });
})()`);
const W = JSON.parse(worn);
ok("点一下就真的穿到账号上（配色写进五键，进任何一张图都这一身）",
  W.skin && W.skin.skin === "#1f6f8b" && W.skin.shirt === "#12313f" && W.skin.pants === "#2a2f45",
  JSON.stringify(W).slice(0, 200));
const plays = await S.evaluate(`(async () => {
  const r = await fetch(${JSON.stringify(BASE + "/api/community/pubs/" + pubId)});
  const j = await r.json();
  return j.pub.plays;
})()`);
ok("取用会记一次数（广场按热度排要有信号）", Number(plays) >= 1, String(plays));

await S.close();
await chrome.close?.().catch?.(() => { });
console.log(`\nskin: ${pass} passed, ${fail} failed`);
cleanup();
process.exit(fail ? 1 : 0);
