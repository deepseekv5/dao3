import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session, freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(6200, 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-creative-"));
const PW = "a-long-enough-password-42";
const RUN = "c" + Date.now().toString(36).slice(-5);
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  " + extra : "")); cond ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR } });
process.on("exit", () => { try { child.kill("SIGTERM"); } catch { } try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { } });
let up = false;
for (let i = 0; i < 60; i++) { await sleep(200); try { const j = await (await fetch(BASE + "/api/whoami")).json(); if (j && j.app) { up = true; break; } } catch { } }
if (!up) { console.log("FAIL  服务没起来"); process.exit(1); }

const jar = new Map();
async function call(method, p, body) {
  if (method !== "GET" && !jar.get("ly_csrf")) await call("GET", "/api/community/me");
  const headers = { "Content-Type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (method !== "GET") headers["x-csrf-token"] = jar.get("ly_csrf") || "";
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const line of r.headers.getSetCookie?.() || []) {
    const [kv] = line.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(), v = decodeURIComponent(kv.slice(i + 1).trim());
    if (v) jar.set(k, v); else jar.delete(k);
  }
  return { status: r.status, data: await r.json().catch(() => null) };
}
await call("GET", "/api/community/me");
const name = "创作验收" + RUN;
const reg = await call("POST", "/api/community/register", { name, password: PW });
ok("测试账号已注册", reg.status === 200 && !!reg.data.user);
const chrome = await launchChrome({ port: await freePort(6300, 90) });
const S = await Session.open(chrome.port, { isolated: true, width: 1180, height: 800, initScripts: ['localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")'] });
await S.send("Network.enable", {});
for (const [k, v] of jar) await S.send("Network.setCookie", { name: k, value: v, url: BASE, path: "/", httpOnly: k === "ly_session", sameSite: "Lax" });

await S.goto(BASE + "/community", { settleMs: 1600 });
const empty = await S.evaluate(`({tiles:document.querySelectorAll('.cm-tile').length,hint:document.querySelector('.cm-catfirst')?.textContent||""})`);
ok("空社区不再用一排零分类占满首屏", empty.tiles === 0 && /还没有作品/.test(empty.hint), JSON.stringify(empty));

await S.goto(BASE + "/u/" + encodeURIComponent(name), { settleMs: 1800 });
for (let i = 0; i < 30; i++) { if (await S.evaluate(`!!document.getElementById("pfSkinEdit")`)) break; await sleep(300); }
ok("个人页有独立皮肤页签", await S.evaluate(`!!document.querySelector('#pfTabs [data-t="skin"]')`));
await S.evaluate(`document.getElementById("pfSkinEdit").click()`);
await sleep(900);
const studio = await S.evaluate(`(() => {const c=document.querySelector('#skinStudio .ss-atlas');return{open:!!document.querySelector('#skinStudio.show'),tools:document.querySelectorAll('#skinStudio [data-tool]').length,size:c?[c.width,c.height]:null};})()`);
ok("完整皮肤工作台打开：六种工具 + 64×64 画布", studio.open && studio.tools === 6 && studio.size?.[0] === 64, JSON.stringify(studio));
const before = await S.evaluate(`document.querySelector('#skinStudio .ss-atlas').toDataURL()`);
await S.evaluate(`(() => {const c=document.querySelector('#skinStudio .ss-atlas'),r=c.getBoundingClientRect();const p=(t,x,y)=>new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:7,isPrimary:true,button:0});c.dispatchEvent(p('pointerdown',r.left+80,r.top+80));c.dispatchEvent(p('pointermove',r.left+96,r.top+80));c.dispatchEvent(p('pointerup',r.left+96,r.top+80));return 1;})()`);
const after = await S.evaluate(`document.querySelector('#skinStudio .ss-atlas').toDataURL()`);
ok("像素画笔真的改到展开图", before !== after);
await S.evaluate(`document.querySelector('#skinStudio [data-act="undo"]').click()`);
const undone = await S.evaluate(`document.querySelector('#skinStudio .ss-atlas').toDataURL()`);
ok("撤销把画笔那一笔收回去", undone === before);
await S.evaluate(`document.querySelector('#skinStudio [data-act="save"]').click()`);
await sleep(1600);
const savedSkin = await S.evaluate(`(async()=>{const j=await (await fetch('/api/community/me')).json();return j.user&&j.user.skin&&j.user.skin.texture||"";})()`);
ok("皮肤保存后上传为站内贴图并写进账号", /^\/api\/community\/uploads\//.test(savedSkin), savedSkin);

await S.goto(BASE + "/community", { settleMs: 1200 });
await S.evaluate(`(async()=>{const m=await import('/js/music-editor.js');window.__fakeE={state:{meta:{}},markDirty(){window.__dirty=(window.__dirty||0)+1},toast(){}};window.__musicStudio=m.openMusicStudio(window.__fakeE);return 1;})()`);
await sleep(500);
const music = await S.evaluate(`({open:!!document.querySelector('#musicStudio'),canvas:!!document.querySelector('.me-roll'),tracks:document.querySelectorAll('.me-track').length,notes:window.__musicStudio.doc.tracks.reduce((n,t)=>n+t.notes.length,0)})`);
ok("音乐工作台打开：钢琴卷帘 + 三条真实音符轨", music.open && music.canvas && music.tracks === 3 && music.notes > 20, JSON.stringify(music));
const n0 = await S.evaluate(`window.__musicStudio.doc.tracks[0].notes.length`);
await S.evaluate(`(() => {const c=document.querySelector('.me-roll'),r=c.getBoundingClientRect();const p=(t,x,y)=>new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:8,button:0});c.dispatchEvent(p('pointerdown',r.left+r.width*.75,r.top+180));c.dispatchEvent(p('pointerup',r.left+r.width*.75,r.top+180));return 1;})()`);
const n1 = await S.evaluate(`window.__musicStudio.doc.tracks[0].notes.length`);
ok("在钢琴卷帘上点击会真的增加音符", n1 === n0 + 1, `${n0}→${n1}`);
await S.evaluate(`document.querySelector('#musicStudio [data-act="play"]').click()`);
await sleep(650);
const playing = await S.evaluate(`document.querySelector('[data-read]').textContent`);
ok("Web Audio 播放时播放头与拍号真的前进", /第/.test(playing) && playing !== "第 1 拍", playing);
await S.evaluate(`document.querySelector('#musicStudio [data-act="stop"]').click();document.querySelector('#musicStudio [data-bgm]').click();document.querySelector('#musicStudio [data-act="save"]').click()`);
const stored = await S.evaluate(`({dirty:window.__dirty,tracks:window.__fakeE.state.meta.music.tracks.length,bgm:window.__fakeE.state.meta.music.bgm})`);
ok("音乐保存进世界 meta，背景音乐开关与脏标记一起落", stored.dirty === 1 && stored.tracks === 3 && stored.bgm, JSON.stringify(stored));
await S.evaluate(`document.querySelector('#musicStudio [data-act="close"]').click()`);
ok("关闭音乐工作台会释放播放器", await S.evaluate(`!document.querySelector('#musicStudio')`));

console.log(`\nPASS: ${pass}  FAIL: ${fail}`);
try { await S.close(); } catch { }
try { chrome.child?.kill(); } catch { }
process.exit(fail ? 1 : 0);
