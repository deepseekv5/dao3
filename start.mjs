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
  const tryPort = (p) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, HOST === "0.0.0.0" ? "127.0.0.1" : HOST);
  });
  for (const p of [preferred, 5173, 5174, 8080, 3000, 0]) {
    if (p === 0) return new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); });
    });
    if (await tryPort(p)) return p;
  }
  return 5173;
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
