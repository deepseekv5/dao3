import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session, freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(6400, 90), BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" } });
process.on("exit", () => { try { child.kill("SIGTERM"); } catch {} });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); cond ? pass++ : fail++; };
let up = false;
for (let i = 0; i < 80; i++) { await sleep(150); try { const j = await (await fetch(BASE + "/api/whoami")).json(); if (j?.app) { up = true; break; } } catch {} }
if (!up) { console.log("FAIL  本地服务未启动"); process.exit(1); }

const chrome = await launchChrome({ port: await freePort(9790, 30) });
const s = await Session.open(chrome.port, { isolated: true, width: 800, height: 600, initScripts: ['localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")'] });
const started = Date.now();
await s.goto(`${BASE}/edit/wmwx8en6qdbtx`, { settleMs: 200 });
let readyMs = 0;
for (let i = 0; i < 400; i++) { if (await s.evaluate("!!window.__editor", { awaitPromise: false })) { readyMs = Date.now() - started; break; } await sleep(100); }
ok("源码精灵工作区可用", readyMs > 0 && readyMs < 15000, `${readyMs}ms`);
const render = await s.evaluate(`(() => {
  const e=window.__editor,r=e.renderer,c=r.activeCam||r.camera;cancelAnimationFrame(r._raf);r._render3d=false;r.sky.position.copy(c.position);r.renderer.render(r.scene,c);
  const gl=r.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=(x,y)=>{const b=new Uint8Array(4);gl.readPixels(Math.round(x),Math.round(y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b]};
  return {quality:r.quality,ratio:r.renderer.getPixelRatio(),far:c.far,sky:r.sky.visible,near:r.scene.fog.near,fogFar:r.scene.fog.far,top:px(w*.5,h*.92),bottom:px(w*.5,h*.08)};
})()`);
ok("大地图使用高像素比且关闭阴影", render.quality === "large" && render.ratio >= 1.25, JSON.stringify(render));
ok("远平面不再裁掉天空球", render.far >= 1800 && render.sky, JSON.stringify({ far: render.far, sky: render.sky }));
ok("大地图雾近远平面有效", render.near < render.fogFar && render.near === 55 && render.fogFar === 250, JSON.stringify({ near: render.near, far: render.fogFar }));
ok("天空实际写入帧缓冲", render.top[3] === 255 && render.top.slice(0, 3).some((v, i) => Math.abs(v - render.bottom[i]) > 8), JSON.stringify({ top: render.top, bottom: render.bottom }));

console.log(`\nPASS: ${pass}  FAIL: ${fail}`);
await s.close(); try { chrome.child?.kill(); } catch {}
process.exit(fail ? 1 : 0);
