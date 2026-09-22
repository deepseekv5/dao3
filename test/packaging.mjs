// test/packaging.mjs — 发布物的三条硬行为，全部用真进程 + 真文件系统验，不看代码猜。
//
//   1. 安装目录只读时必须还能跑（从 .dmg 直接双击 run.sh 是真实用户路径，曾经直接崩）。
//   2. 官方赛车模板随包分发，但未确认前不得落地；确认后落地；用户改过的图不得被覆盖。
//   3. 端口被"我们自己的"上一个实例占着要能要回来；被无关进程占着绝不能杀。
//
// 前置：先跑 npm run package 生成 ../DAO3-便携包
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = path.resolve(ROOT, "..", "DAO3-便携包");
const ok = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (x ? "   " + x : "")); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (port, p) => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 2500 }, (r) => {
    let b = ""; r.setEncoding("utf8"); r.on("data", (c) => b += c);
    r.on("end", () => resolve({ status: r.statusCode, body: b }));
  });
  req.on("error", () => resolve(null));
  req.on("timeout", () => { req.destroy(); resolve(null); });
});
const post = (port, p, obj) => new Promise((resolve) => {
  const body = JSON.stringify(obj);
  const req = http.request({ host: "127.0.0.1", port, path: p, method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
  (r) => { let b = ""; r.setEncoding("utf8"); r.on("data", (c) => b += c); r.on("end", () => resolve(b)); });
  req.on("error", () => resolve(null));
  req.write(body); req.end();
});
async function waitUp(port, ms = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = await get(port, "/api/whoami"); if (r && r.status === 200) return true; await sleep(250); }
  return false;
}
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
const worlds = async (port) => {
  const r = await get(port, "/api/worlds");
  if (!r) return [];
  try { return JSON.parse(r.body).worlds.map((w) => ({ name: w.name, shape: w.shape, entities: w.entities, blocks: w.blockCount })); }
  catch { return []; }
};

if (!fs.existsSync(path.join(PKG, "server.js"))) {
  console.log("SKIP  没有 " + PKG + "，先跑 npm run package");
  process.exit(0);
}

/* ─────────────── 1 + 2：只读安装目录 & 模板授权 ─────────────── */
{
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "dao3-ro-"));
  const app = path.join(stage, "app");
  fs.cpSync(PKG, app, { recursive: true });
  // 清掉包里可能带来的状态，模拟全新用户
  fs.rmSync(path.join(app, "server/data"), { recursive: true, force: true });
  const fakeHome = path.join(stage, "home");
  fs.mkdirSync(fakeHome, { recursive: true });
  // 让安装目录本身不可写：这就是从 .dmg 挂载运行的等价条件
  fs.mkdirSync(path.join(app, "server"), { recursive: true });
  fs.chmodSync(path.join(app, "server"), 0o500);

  const port = await freePort();
  const child = spawn(process.execPath, [path.join(app, "server.js")], {
    cwd: app, stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", HOME: fakeHome },
  });
  try {
    const up = await waitUp(port);
    ok("安装目录只读时服务仍能启动", up);
    if (up) {
      const root = await get(port, "/");
      ok("只读模式下页面仍可访问", root && root.status === 200, "HTTP " + (root && root.status));
      const ws = await worlds(port);
      ok("未确认授权时只有程序化示例地形", ws.length === 1 && ws[0].entities === 0 && ws[0].blocks < 60000,
        JSON.stringify(ws[0] || null));
      const c0 = JSON.parse((await get(port, "/api/consent")).body);
      ok("consent 初始为 unset 且模板可用", c0.racingTemplate === "unset" && c0.available === true, JSON.stringify(c0));

      const a = JSON.parse(await post(port, "/api/consent", { racingTemplate: true }));
      ok("确认授权后模板落地", a.ok === true && a.installed === true, JSON.stringify(a));
      const ws1 = await worlds(port);
      ok("模板是 199 实体 / 152 万格", ws1[0].entities === 199 && ws1[0].blocks > 1500000, JSON.stringify(ws1[0]));

      // 改过的图不能被模板冲掉。
      // 注意：安装目录是只读的，所以数据其实落在回退目录（fakeHome/.dao3-editor），
      // 这本身正是上面第 1 条要验的行为。
      fs.chmodSync(path.join(app, "server"), 0o700);
      const wpath = path.join(fakeHome, ".dao3-editor/worlds/216d665d3ca92bd1b9a2.json.gz");
      const zlib = await import("node:zlib");
      const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(wpath)).toString());
      j.meta.name = "我改过的图"; j.meta.seedKind = "user";
      fs.writeFileSync(wpath, zlib.gzipSync(Buffer.from(JSON.stringify(j))));
      fs.rmSync(path.join(fakeHome, ".dao3-editor/consent.json"));
      const b = JSON.parse(await post(port, "/api/consent", { racingTemplate: true }));
      ok("已编辑的世界不会被模板覆盖", b.occupied === true && b.installed !== true, JSON.stringify(b));
      const ws2 = await worlds(port);
      ok("世界名保持用户改动", ws2[0].name === "我改过的图", ws2[0].name);
      const d = JSON.parse(await post(port, "/api/consent", { racingTemplate: false }));
      ok("可改主意：拒绝授权记录为 declined", d.racingTemplate === "declined", JSON.stringify(d));
    }
  } finally {
    child.kill(); await sleep(300);
    fs.chmodSync(path.join(stage, "app/server"), 0o700);
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/* ─────────────── 3：端口回收只针对自己的实例 ─────────────── */
// start.mjs 会 spawn 出 server.js 子进程；只 kill 父进程会留下游离的 server.js，
// 所以用 detached + 杀整个进程组。
const spawnGroup = (argv, opts) => {
  const c = spawn(argv[0], argv.slice(1), { detached: true, stdio: opts.stdio, cwd: opts.cwd, env: opts.env });
  c.on("exit", () => {});
  return { proc: c, kill: () => { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch {} } } };
};
{
  const port = await freePort();
  // 3a. 无关进程占端口 → 不能被杀，应让开
  const foreign = net.createServer((s) => s.end("not dao3\n"));
  await new Promise((r) => foreign.listen(port, "127.0.0.1", r));
  const s1 = spawnGroup([process.execPath, path.join(ROOT, "start.mjs")],
    { cwd: ROOT, stdio: "pipe", env: { ...process.env, PORT: String(port) } });
  let out1 = "";
  s1.proc.stdout.on("data", (c) => out1 += c); s1.proc.stderr.on("data", (c) => out1 += c);
  await sleep(7000);
  ok("端口被无关进程占用时不去杀它", foreign.listening === true, foreign.listening ? "占用者仍存活" : "!! 被误杀");
  ok("并明确告知改用其他端口", /不是 DAO3/.test(out1), out1.split("\n").find((l) => l.includes("端口")) || "");
  s1.kill();
  // server.close() 的回调要等所有连接散尽才触发，这里可能永远不 resolve，
  // 用一次性守卫避免挂住顶层 await
  await new Promise((r) => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; foreign.close(fin); setTimeout(fin, 800); });
  await sleep(500);

  // 3b. 我们自己的旧实例占端口 → 应该要回来
  const ours = spawnGroup([process.execPath, path.join(ROOT, "server.js")],
    { cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" } });
  await waitUp(port);
  const s2 = spawnGroup([process.execPath, path.join(ROOT, "start.mjs")],
    { cwd: ROOT, stdio: "pipe", env: { ...process.env, PORT: String(port) } });
  let out2 = "";
  s2.proc.stdout.on("data", (c) => out2 += c); s2.proc.stderr.on("data", (c) => out2 += c);
  const reclaimed = await new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (/已停掉上一个 DAO3 实例/.test(out2)) return resolve(true);
      if (Date.now() - t0 > 20000) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  });
  ok("端口被自己的旧实例占用时要得回来", reclaimed, out2.split("\n").find((l) => l.includes("端口")) || "");
  s2.kill(); ours.kill();
  await sleep(600);
}

console.log(process.exitCode ? "\n发布物行为有问题" : "\n发布物行为全部通过");
// 子进程会把事件循环钉住，必须显式退出，否则这个文件永远不结束
setTimeout(() => process.exit(process.exitCode || 0), 1200).unref();
