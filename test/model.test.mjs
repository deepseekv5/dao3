/**
 * test/model.test.mjs — 模型是不是真的算社区里的一等公民，跑在真浏览器上。
 *
 * 为什么单独一份、而且非要在浏览器里跑：接口层早就允许评论任何一条发布（评论按 pubId 存，
 * 不看 kind），但用户在页面上看到的却是另一回事——模型卡上挂着「存为我的地图」，
 * 点下去 404；模型和地图混在一条流里，模型没有"游玩"这个动作，热度天然低一截，永远沉底；
 * 卡片上只有浏览量，谁也不会想到模型底下其实有个评论区。
 * 这三件事都不会让任何接口报错，只有真页面能暴露。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5800 + ((Date.now() % 300) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-model-"));
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
async function until(expr, tries = 20, ms = 400) {
  for (let i = 0; i < tries; i++) {
    let v = null;
    try { v = await S.evaluate(expr); } catch { /* 页面正在跳转 */ }
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
catch (e) { console.log("SKIP  起不了浏览器，模型社交验收跳过：" + e.message); process.exit(0); }
const S = await Session.open(chrome.port, {
  width: 1360, height: 900, isolated: true,
  initScripts: ['localStorage.setItem("dao3_disclaimer_ack","3");window.__errs=[];'
    + 'addEventListener("error",e=>__errs.push(e.message+" @"+(e.filename||"").split("/").pop()+":"+e.lineno));'
    + 'addEventListener("unhandledrejection",e=>__errs.push("rej:"+((e.reason&&e.reason.message)||e.reason)));'],
});

const MODEL_DOC = {
  name: "会走路的铁盒", type: "voxel",
  parts: [{ name: "body", pos: [0, 0, 0], box: [4, 6, 4], voxels: [[[0, 0, 0], 1], [[1, 1, 1], 2], [[2, 3, 1], 3]] }],
  palette: ["#334455", "#12b5c9", "#f2c14e"],
};

/* ---------------- 作者发一张模型 ---------------- */
await S.goto(BASE + "/", { settleMs: 1200 });
await S.evaluate(`fetch("/api/consent",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({racingTemplate:false,racingAssets:false})})`);
await S.goto(BASE + "/community", { settleMs: 1800 });
const reg = await S.evaluate(`(async () => {
  const c = (document.cookie.match(/ly_csrf=([^;]+)/)||[])[1] || "";
  const r = await fetch("/api/community/register", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(c) },
    body: JSON.stringify({ name: "模型作者", password: "a-long-enough-password" }) });
  return r.status;
})()`);
ok("作者注册成功", reg === 200, String(reg));
const made = await S.evaluate(`(async () => {
  const c = (document.cookie.match(/ly_csrf=([^;]+)/)||[])[1] || "";
  const r = await fetch("/api/community/publish", { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(c) },
    body: JSON.stringify({ kind: "model", title: "会走路的铁盒", desc: "六面都方", tags: ["创造"], doc: ${JSON.stringify(MODEL_DOC)}, name: "bot" }) });
  const j = await r.json().catch(() => null);
  return { status: r.status, id: j && j.pub && j.pub.id, kind: j && j.pub && j.pub.kind };
})()`);
ok("VOXA 那类模型能发布到社区", made.status === 200 && made.kind === "model", JSON.stringify(made));

/* ---------------- 广场：类型分得开，卡片看得出能评论 ---------------- */
await S.goto(BASE + "/community", { settleMs: 1800 });
const kinds = await until(`[...document.querySelectorAll(".cm-kind")].map(b=>b.textContent)`);
ok("广场有地图/模型两种流的开关", JSON.stringify(kinds) === JSON.stringify(["全部", "地图", "模型"]), JSON.stringify(kinds));
const chips = await until(`(() => { const s = document.querySelectorAll(".cm-card .cm-views span");
  return s.length === 3 ? [...s].map(x => ({ t: x.getAttribute("title"), n: x.textContent.trim(), svg: !!x.querySelector("svg") })) : null; })()`);
ok("卡片上把浏览、点赞、评论三个数都摆出来", Array.isArray(chips) && chips.length === 3
  && chips.map((c) => c.t).join(",") === "浏览,点赞,评论" && chips.every((c) => c.svg), JSON.stringify(chips));

await S.evaluate(`document.querySelector('.cm-kind[data-k="model"]').click()`);
ok("只看模型时流里只剩模型", await until(`document.querySelectorAll(".cm-card").length === 1 && !!document.querySelector(".cm-card .cm-badge")`, 12),
  await S.evaluate(`document.querySelectorAll(".cm-card").length`));
await S.evaluate(`document.querySelector('.cm-kind[data-k="map"]').click()`);
ok("只看地图时那张模型卡不在", await until(`document.querySelectorAll(".cm-card").length === 0`, 12));

/* ---------------- 模型详情页：能评论，且没有那个只会 404 的按钮 ---------------- */
await S.goto(BASE + "/p/" + made.id, { settleMs: 2000 });
const detail = await S.evaluate(`(() => ({
  acts: [...document.querySelectorAll("#cmPubActs button")].map(b => b.textContent.trim()),
  fork: !!document.getElementById("cmFork"),
  pull: !!document.getElementById("cmPull"),
  box: !!document.getElementById("cBody"),
}))()`);
ok("模型卡上不再挂「存为我的地图」", !detail.fork && detail.acts.every((a) => !/存为我的地图/.test(a)), JSON.stringify(detail.acts));
ok("模型给的是「取回到模型库」", detail.pull && detail.acts.includes("取回到模型库"), JSON.stringify(detail.acts));
ok("模型详情页有评论区", detail.box);
await S.type("#cBody", "这个铁盒的关节做得不错");
await S.evaluate(`document.querySelector("#cSend").click()`);
ok("别人能在模型下面留言", await until(`document.querySelectorAll(".cm-cmt").length === 1`, 12));
ok("评论数立刻回到标题上", await until(`(document.getElementById("cmCmtN")||{}).textContent === "1"`),
  await S.evaluate(`String((document.getElementById("cmCmtN")||{}).textContent)`));

/* ---------------- 取回：进本机模型库，而不是让人自己找导入入口 ---------------- */
await S.evaluate(`document.getElementById("cmPull").click()`);
ok("取回之后模型库里真有这个", await until(`(async () => {
  const j = await (await fetch("/api/models")).json();
  return (j.models || []).some((m) => m.name === "会走路的铁盒");
})()`, 12));
ok("取回过的按钮改口，不会让人再点一次", await until(`document.getElementById("cmPull").textContent === "已取回"`, 8));
// 编辑器要能真的把它摆进场景，否则"取回"只是换了个地方存文件
await S.goto(BASE + "/edit/216d665d3ca92bd1b9a2", { settleMs: 2600 });
const inEditor = await until(`(async () => {
  const j = await (await fetch("/api/models")).json();
  return !!window.__editor && (j.models || []).some((m) => m.name === "会走路的铁盒");
})()`, 20, 600);
ok("编辑器读得到取回来的模型库", !!inEditor);

const errs = await S.evaluate(`JSON.stringify((window.__errs || []).slice(0, 4))`);
ok("全程没有未捕获错误", errs === "[]", errs);
await S.shot(path.join(ROOT, "tmp/ui-model.png"));

console.log(`\nmodel: ${pass} passed, ${fail} failed`);
await S.close();
process.exit(fail ? 1 : 0);
