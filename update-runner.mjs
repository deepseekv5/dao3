#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const [root, staged, version, port, host, parentPid] = process.argv.slice(2);
if (!root || !staged || !version) process.exit(2);
const updateDir = path.join(root, ".update");
const logFile = path.join(updateDir, "update.log");
const log = (msg) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const copyTree = (src, dst) => {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); }
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
};

async function main() {
  await sleep(800);
  const pid = Number(parentPid);
  if (pid) {
    for (let i = 0; i < 50; i++) {
      try { process.kill(pid, 0); await sleep(100); }
      catch { break; }
    }
  }
  fs.mkdirSync(updateDir, { recursive: true });
  const backup = path.join(updateDir, `backup-${Date.now()}`);
  fs.mkdirSync(backup, { recursive: true });
  const moved = [];
  try {
    const walk = (dir, rel = "") => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const s = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { walk(s, r); continue; }
        if (!e.isFile()) continue;
        const target = path.join(root, r);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) {
          const b = path.join(backup, r);
          fs.mkdirSync(path.dirname(b), { recursive: true });
          fs.copyFileSync(target, b);
          moved.push(r);
        }
        fs.copyFileSync(s, target);
      }
    };
    walk(staged);
    fs.writeFileSync(path.join(updateDir, "last-update.json"), JSON.stringify({ version, at: new Date().toISOString(), backup }, null, 2));
    log(`updated to ${version}; ${moved.length} files backed up`);
  } catch (err) {
    log("update failed: " + (err && err.stack || err));
    for (const rel of moved) {
      try { fs.copyFileSync(path.join(backup, rel), path.join(root, rel)); } catch {}
    }
  }
  try { fs.rmSync(staged, { recursive: true, force: true }); } catch {}
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root, detached: true, stdio: "ignore", windowsHide: true,
    env: { ...process.env, PORT: port || process.env.PORT || "5173", HOST: host || process.env.HOST || "127.0.0.1", LAOYOU_UPDATED: version },
  });
  child.unref();
  log("server restarted");
}
main();