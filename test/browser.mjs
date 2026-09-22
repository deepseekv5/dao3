// test/browser.mjs — 可移植地解析一个可用的 Chromium 系浏览器与 playwright-core。
// 优先级：环境变量 → playwright 缓存（macOS / Linux / Windows 三种布局）→ 系统 Chrome / Edge / Chromium。
// 回归套件因此不需要任何全局安装或机器专属路径。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function cacheDirs() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    home && path.join(home, "Library/Caches/ms-playwright"),            // macOS
    home && path.join(home, ".cache/ms-playwright"),                    // Linux
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"), // Windows
  ].filter(Boolean);
}

function fromCache() {
  for (const CACHE of cacheDirs()) {
    if (!CACHE || !fs.existsSync(CACHE)) continue;
    const dirs = fs.readdirSync(CACHE).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const root = path.join(CACHE, d);
      const cands = [
        path.join(root, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        path.join(root, "chrome-headless-shell-mac", "chrome-headless-shell"),
        path.join(root, "chrome-headless-shell-win", "chrome-headless-shell.exe"),
        path.join(root, "chrome-headless-shell-linux", "chrome-headless-shell"),
        path.join(root, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(root, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        path.join(root, "chrome-win", "chrome.exe"),
      ];
      const hit = cands.find((p) => fs.existsSync(p));
      if (hit) return hit;
      // 目录结构变了就直接搜一层可执行文件名
      const found = walk(root, 3).find((p) => /chrome-headless-shell(\.exe)?$|Chromium$|chrome\.exe$/.test(p) && fs.existsSync(p));
      if (found) return found;
    }
  }
  return null;
}

function walk(dir, depth) {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, depth - 1));
    else out.push(p);
  }
  return out;
}

const SYSTEM = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

export function resolveChromium() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  return fromCache() || SYSTEM.find((p) => fs.existsSync(p)) || null;
}

export function chromeArgs() {
  return ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", "--mute-audio"];
}

// playwright-core 不是本项目的依赖（运行时零依赖是硬要求），测试自己可移植地找它：
// 显式 PLAYWRIGHT_MODULE → 向上逐层 node_modules → 常见全局目录 → ESM import。
// 找不到就返回 null，由调用方 SKIP，而不是抛一堆模块解析错误。
function requireCandidates() {
  const out = [];
  if (process.env.PLAYWRIGHT_MODULE) out.push(() => createRequire(path.join(here, "noop.js"))(process.env.PLAYWRIGHT_MODULE));
  let d = here;
  for (let i = 0; i < 6; i++) {
    const nm = path.join(d, "node_modules");
    if (fs.existsSync(path.join(nm, "playwright-core"))) out.push(() => createRequire(path.join(nm, "noop.js"))("playwright-core"));
    d = path.dirname(d);
  }
  const globals = ["/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules",
    process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules")].filter(Boolean);
  for (const root of globals) {
    if (fs.existsSync(path.join(root, "playwright-core"))) out.push(() => createRequire(path.join(root, "noop.js"))("playwright-core"));
  }
  return out;
}

export async function playwright() {
  for (const t of requireCandidates()) {
    try { const m = t(); if (m && m.chromium) return m; } catch {}
  }
  try {
    const m = await import("playwright-core");
    const r = m && m.chromium ? m : (m && m.default && m.default.chromium ? m.default : null);
    if (r) return r;
  } catch {}
  return null;
}

/* ---------------- 本地服务地址 ---------------- */
// 5173 只是 start.mjs 的**首选**端口：它被别的项目占着时会顺延，
// 所以写死 5173 的测试会对着别人的 dev server 跑，报出一堆莫名其妙的失败。
// 这里改成读 run.out 里服务自己打印的地址，并用 /api/whoami 的指纹确认是本项目。
const ROOT_DIR = path.resolve(here, "..");
const APP_ID = "dao3-editor-clone";

async function probe(origin) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 700);
    const r = await fetch(origin + "/api/whoami", { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!j && j.app === APP_ID;
  } catch { return false; }
}

export async function resolveBase() {
  if (process.env.BASE) return process.env.BASE.replace(/\/+$/, "");
  const cands = [];
  try {
    const out = fs.readFileSync(path.join(ROOT_DIR, "run.out"), "utf8");
    for (const m of out.matchAll(/http:\/\/(127\.0\.0\.1|localhost):(\d+)/g)) cands.push(m[0]);
  } catch {}
  cands.push("http://127.0.0.1:5173");
  for (let p = 5173; p <= 5185; p++) cands.push(`http://127.0.0.1:${p}`);
  for (const c of cands) {
    if (await probe(c)) return c;
  }
  return null;
}
