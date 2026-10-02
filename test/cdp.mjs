// test/cdp.mjs — 零依赖的 CDP 客户端（只用 Node 内置 + 全局 WebSocket）。
//
// 为什么不用 playwright：playwright-core 装不上时，整套浏览器验证就整体退化成
// "只看代码觉得对"。这条通道只要一个本机 Chrome 就能出真实像素与真实 cookie。
//
// 关键能力是 isolated()：一个 Chrome 进程里开两个**cookie 互相隔离**的浏览器上下文，
// 于是"用户 A 在页面上做事、用户 B 也在页面上做事"能被真的测出来，
// 而不是拿一个会话假装两个人。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveChromium } from "./browser.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(port, p, method = "GET") {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method });
  return res.json();
}

/** 起一个 headless Chrome 调试端点；复用已经在跑的实例。 */
export async function launchChrome({ port = 9333 } = {}) {
  try { await httpJson(port, "/json/version"); return { reused: true, port }; } catch { /* 还没起，下面拉起 */ }
  const exe = resolveChromium();
  if (!exe) throw new Error("找不到 Chrome/Chromium，设 CHROME=/path/to/chrome 再试");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ly-cdp-"));
  const child = spawn(exe, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1440,900",
    // 无 GPU 的 headless 里 WebGL 默认起不来，编辑器/运行时直接卡在启动屏。
    // 软件光栅化（swiftshader）让它真能建上下文，运行时这一层才谈得上被验证过。
    "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { await httpJson(port, "/json/version"); return { reused: false, port, child, profile }; }
    catch { await wait(150); }
  }
  throw new Error("Chrome 调试端口起不来");
}

/** 一个可隔离的浏览器会话：navigate / evaluate / click / 截图 / 读 cookie。 */
export class Session {
  constructor(ws, targetId, contextId, port) {
    this.ws = ws; this.targetId = targetId; this.contextId = contextId; this.port = port; this._id = 0;
    this._pending = new Map();
    this._events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        // 无头浏览器里没有可点的原生弹窗，alert/confirm/prompt 会直接冻住页面。
        // 默认全部接住放行，测试里改 s.dialog 就能指定 prompt 填什么。
        if (msg.method === "Page.javascriptDialogOpening" && this.dialog) {
          const d = msg.params || {};
          this.send("Page.handleJavaScriptDialog", {
            accept: this.dialog.accept !== false,
            promptText: d.type === "prompt" ? this.dialog.promptText || "" : undefined,
          }).catch(() => { /* 已经处理过了 */ });
        }
        this._events.push(msg);
        for (const fn of this._on) fn(msg);
      }
    });
    this._on = new Set();
    this.dialog = { accept: true, promptText: "" };
  }

  // dsf 默认 1：软件渲染（swiftshader）下每个像素都要 CPU 算，2× 的画布等于 4 倍开销，
  // 编辑器一帧要两三秒，截图永远抓到半帧。要看真机观感请直接在浏览器里开。
  static async open(port, { isolated = false, width = 1440, height = 900, dsf = 1, initScripts = [] } = {}) {
    let contextId = null;
    if (isolated) ({ browserContextId: contextId } = await callBrowser(port, "Target.createBrowserContext", { disposeOnDetach: true }));
    const target = await callBrowser(port, "Target.createTarget", { url: "about:blank", ...(contextId ? { browserContextId: contextId } : {}) });
    const list = await httpJson(port, "/json/list");
    const info = list.find((t) => t.id === target.targetId && t.webSocketDebuggerUrl);
    if (!info) throw new Error("拿不到新建 target 的 websocket");
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    const s = new Session(ws, target.targetId, contextId, port);
    await s.send("Page.enable");
    await s.send("Runtime.enable");
    // 每个会话各自设视口：设备指标是 per-target 的，所以同屏两个尺寸互不干扰。
    await s.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dsf, mobile: false });
    // about:blank 是隔离源，写不进站点 localStorage。初始化脚本在文档脚本之前跑，
    // 用来预置"已确认免责声明"这类开关——不然截到的每张图都是那张遮罩。
    if (initScripts.length) await s.send("Page.addScriptToEvaluateOnNewDocument", { source: initScripts.join("\n;\n") });
    return s;
  }

  send(method, params = {}) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this._pending.delete(id)) reject(new Error(`${method} 超时`)); }, 30000);
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error("页面脚本抛错：" + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  async goto(url, { settleMs = 400 } = {}) {
    let loaded = null;
    const fn = (msg) => { if (msg.method === "Page.loadEventFired") { loaded = true; } };
    this._on.add(fn);
    await this.send("Page.navigate", { url });
    for (let i = 0; i < 60 && !loaded; i++) await wait(50);
    this._on.delete(fn);
    await wait(settleMs);
    return this;
  }

  /** 点元素：走真实命中测试，元素被遮住就点不到——这正是我们要的行为。 */
  async click(selector) {
    const box = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, covered: !!hit && !hit.closest(${JSON.stringify(selector)}), by: hit ? hit.tagName + "." + hit.className : "null" }; })()`);
    if (!box) throw new Error(`找不到元素 ${selector}`);
    // 遮罩层吃掉点击时，"点不到"本身就是结论；不报出来的话后面每一步都在错状态上跑。
    if (box.covered) throw new Error(`${selector} 被 ${box.by} 盖住了，点不到`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
    await wait(120);
  }

  async type(selector, text) {
    await this.click(selector);
    // 先清空：复用过的输入框里可能还有上一轮的内容
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await this.send("Input.insertText", { text });
  }

  /** 真的往 <input type=file> 里塞文件：走 DOM.setFileInputFiles，会触发 change。 */
  async setFile(selector, paths) {
    await this.send("DOM.enable");
    const { root } = await this.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`找不到文件输入框 ${selector}`);
    await this.send("DOM.setFileInputFiles", { files: [].concat(paths), nodeId });
    await wait(200);
  }

  async shot(file) {
    // 软件渲染下合成器可能几秒才出一帧，默认截图会一直等；等不到就退回非 surface 抓取。
    let data;
    try { ({ data } = await this.send("Page.captureScreenshot", { format: "png" })); }
    catch { ({ data } = await this.send("Page.captureScreenshot", { format: "png", fromSurface: false })); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  async text() { return this.evaluate("document.body.innerText"); }

  /** 读 cookie：不传 urls 就是"当前会话能看到的全部"，隔离上下文之间互不可见。 */
  async cookies() { const r = await this.send("Network.getCookies"); return r.cookies; }

  async header() { return (await this.cookies()).map((c) => `${c.name}=${c.value}`).join("; "); }

  async close() {
    try { await callBrowser(this.port || 9333, "Target.closeTarget", { targetId: this.targetId }); } catch { /* 已经关了 */ }
    try { this.ws.close(); } catch { /* 同上 */ }
  }
}

let _browserWs = null;
async function callBrowser(port, method, params) {
  if (!_browserWs || _browserWs.url !== `ws://127.0.0.1:${port}/devtools/browser`) {
    const { webSocketDebuggerUrl } = await httpJson(port, "/json/version");
    _browserWs = { url: webSocketDebuggerUrl, ws: new WebSocket(webSocketDebuggerUrl) };
    await new Promise((res, rej) => { _browserWs.ws.addEventListener("open", res, { once: true }); _browserWs.ws.addEventListener("error", rej, { once: true }); });
    _browserWs.id = 0; _browserWs.pending = new Map();
    _browserWs.ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && _browserWs.pending.has(m.id)) {
        const { resolve, reject } = _browserWs.pending.get(m.id);
        _browserWs.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  const id = ++_browserWs.id;
  return new Promise((resolve, reject) => {
    _browserWs.pending.set(id, { resolve, reject });
    _browserWs.ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (_browserWs.pending.delete(id)) reject(new Error(`${method} 超时`)); }, 15000);
  });
}
