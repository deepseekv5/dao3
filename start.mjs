#!/usr/bin/env node
// start.mjs — 跨平台启动器（macOS / Windows / Linux 同一份实现）。
//
// 为什么把逻辑写在 Node 里而不是 shell 里：run.sh 用了 ifconfig / lsof / stat -f%i，
// 这些在 Windows 上都不存在。端口探测、局域网地址、打开浏览器交给 node 的内置能力后，
// 三个平台的行为才是同一套，而不是"mac 能跑、win 靠运气"。
//
// 用法：node start.mjs [--port=5173] [--no-open] [--host=0.0.0.0]
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.match(/^--([^=]+)(?:=(.*))?$/) || [])
  .filter((m) => m[1]).map((m) => [m[1], m[2] === undefined ? true : m[2]]));

const MIN_NODE = 18;
const major = Number(process.versions.node.split(".")[0]);
if (major < MIN_NODE) {
  console.error(`✗ 需要 Node.js ${MIN_NODE}+，当前为 ${process.versions.node}。`);
  console.error("  下载：macOS 用 https://nodejs.org/ 或 brew install node；Windows 用 nodejs.org 安装包。");
  process.exit(1);
}

const HOST = String(args.host || process.env.HOST || "0.0.0.0");

// 图集是构建期产物；便携包里已带，但从 git 克隆时没有（PNG 派生自 Apache 上游纹理）
function ensureAtlas() {
  const json = path.join(ROOT, "public/data/block-atlas.json");
  const png = path.join(ROOT, "public/data/block-atlas.png");
  if (fs.existsSync(json) && fs.existsSync(png)) return true;
  const src = path.join(ROOT, "vendor/Box3Blocks-unityPackage/Editor/SourceAssets");
  if (!fs.existsSync(src)) {
    console.error("✗ 缺少方块图集，且没有上游纹理可重建。请先获取 Box3Blocks-unityPackage：");
    console.error("  git clone https://github.com/box3lab/Box3Blocks-unityPackage.git vendor/Box3Blocks-unityPackage");
    return false;
  }
  console.log("▸ 构建方块图集（一次性，约 10 秒）…");
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/build-block-atlas.mjs")], { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) { console.error("✗ 图集构建失败"); return false; }
  return fs.existsSync(json);
}

async function freePort(preferred) {
  // 探测打在 127.0.0.1，而不是服务真正要绑的 0.0.0.0。理由不是风格：
  // 本机另一个 dev server（vite 之类）通常只占 127.0.0.1:5173，而在这种机器上
  // 绑 0.0.0.0:5173 **是会成功的**——于是启动器报"已启动，打开 http://127.0.0.1:5173/"，
  // 用户点开的却是那个不相干的项目。要问的是"用户会打开的那个地址空不空"。
  // 真正绑上之后还有一道 whoami 复核，见 verifyOurs。
  const tryPort = (p) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "127.0.0.1");
  });
  for (const p of [...new Set([preferred, 5173, 5174, 8080, 3000])]) {
    // 先看是不是我们自己的旧实例：是就拿回来。这一步必须在 tryPort 之前——
    // 旧逻辑只对 preferred 做回收，于是 5174 上留着一个没退干净的 DAO3 时，
    // 它会跳过回收往下找，最后把 5173 这个其实被占的号返回出去，
    // server.js 起手就是一个未处理的 EADDRINUSE 崩在用户脸上。
    const who = await whoami(p);
    if (who && who.app === "dao3-editor-clone") {
      if (await reclaimOurs(p)) {
        console.log(`▸ 已停掉上一个 DAO3 实例${p === preferred ? "，" : `（端口 ${p} 上的），`}重新使用端口 ${p}`);
        return p;
      }
      continue;
    }
    if (await tryPort(p)) return p;
    // 不认识的一律不动：端口上可能是用户另一个项目的 dev server，静默 kill 不可接受。
    console.log(`▸ 端口 ${p} 被占用（不是 DAO3，不会去杀它），改用其他端口`);
    console.log(`  想查是谁：lsof -nP -iTCP:${p} -sTCP:LISTEN   （Windows：netstat -ano | findstr :${p}）`);
  }
  const p = await ephemeralPort();
  if (p) return p;
  console.error("✗ 找不到可用端口（5173/5174/8080/3000 都被占用，且随机端口也拿不到）");
  process.exit(1);
}

/**
 * 起来之后复核一次：127.0.0.1:PORT 上答话的必须是我们自己。
 * 少了这一步，"端口被别人以更具体的地址占着"这种情况会打印出一个
 * 点开是别的项目的 URL——比直接报错难查得多，因为看起来一切正常。
 */
async function verifyOurs(port) {
  const who = await whoami(port);
  if (!who || who.app === "dao3-editor-clone") return true;
  console.error(`✗ 127.0.0.1:${port} 上答话的不是本服务，而是另一个程序（本服务绑在 ${HOST}:${port}）。`);
  console.error(`  换个端口就能回到本机地址：node start.mjs --port=5200`);
  return false;
}

function ephemeralPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(0));
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** 端口上跑的是不是「我们自己的」DAO3 服务？是就把它停掉，把端口要回来。 */
async function reclaimOurs(port) {
  const who = await whoami(port);
  if (!who || who.app !== "dao3-editor-clone") {
    // 不认识的一律不动：端口上可能是用户另一个项目的 dev server，
    // 静默 kill 掉是不可接受的。这里只告诉他被谁占了、我们让开。
    console.log(`▸ 端口 ${port} 被另一个程序占用（不是 DAO3，不会去杀它），改用其他端口`);
    console.log(`  想查是谁：lsof -nP -iTCP:${port} -sTCP:LISTEN   （Windows：netstat -ano | findstr :${port}）`);
    return false;
  }
  const pids = pidsOnPort(port);
  if (!pids.length) return false;
  let killed = 0;
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); killed++; } catch { /* 已退出或无权限 */ }
  }
  if (!killed) return false;
  // 给旧进程一点时间真正退出，否则紧接着的 tryPort 还是会失败
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await whoami(port) === null) return true;
  }
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
  await new Promise((r) => setTimeout(r, 400));
  return (await whoami(port)) === null;
}

function whoami(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/whoami", timeout: 900 }, (r) => {
      let body = "";
      r.setEncoding("utf8");
      r.on("data", (c) => { body += c; if (body.length > 65536) r.destroy(); });
      r.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/** 查端口占用者的 PID。lsof 在 macOS/Linux 都有，Windows 退回 netstat。 */
function pidsOnPort(port) {
  const out = [];
  const push = (s) => { for (const m of String(s).matchAll(/^\s*(\d+)\s*$/gm)) out.push(Number(m[1])); };
  if (process.platform === "win32") {
    const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
    for (const line of String(r.stdout || "").split("\n")) {
      if (line.includes("LISTENING") && new RegExp(`[:.]${port}\\s`).test(line)) {
        const pid = Number(line.trim().split(/\s+/).pop());
        if (pid) out.push(pid);
      }
    }
  } else {
    const r = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    for (const m of String(r.stdout || "").split("\n")) { const p = Number(m.trim()); if (p) out.push(p); }
  }
  return [...new Set(out)].filter((p) => p !== process.pid);
}

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}

function openBrowser(url) {
  if (args["no-open"]) return;
  const platform = process.platform;
  try {
    if (platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch { /* 打不开浏览器不算失败，把地址打出来即可 */ }
}

if (!ensureAtlas()) process.exit(1);

const preferred = Number(args.port || process.env.PORT || 5173);
const PORT = await freePort(preferred);
if (preferred && PORT !== preferred) console.log(`▸ 端口 ${preferred} 被占用，改用 ${PORT}`);

const server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: "inherit", env: { ...process.env, PORT: String(PORT), HOST },
});
const url = `http://127.0.0.1:${PORT}/`;
await new Promise((resolve) => {
  const t0 = Date.now();
  const probe = () => {
    const req = http.get(url, (r) => { r.resume(); resolve(); });
    req.on("error", () => { if (Date.now() - t0 < 8000) setTimeout(probe, 200); else resolve(); });
  };
  setTimeout(probe, 300);
});
if (!(await verifyOurs(PORT))) {
  server.kill("SIGTERM");
  process.exit(1);
}

console.log("");
console.log(`  工作台   ${url}`);
console.log(`  示例地图 ${url}edit/216d665d3ca92bd1b9a2`);
for (const { name, address } of lanIPs()) console.log(`  局域网   http://${address}:${PORT}/  (${name})`);
console.log("");
console.log("  停止：Ctrl+C   数据都在 server/data/worlds/ 下，纯本地、不联网");
console.log("");

openBrowser(url);
server.on("exit", (code) => process.exit(code == null ? 0 : code));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { try { server.kill(); } catch {} process.exit(0); });
