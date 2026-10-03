/**
 * test/water.test.mjs — 水下与游泳的回归，跑在仓库自带的 CDP 通道上。
 *
 * 为什么单独一份：test/runtime_parity.mjs 要 playwright-core，这台机器上没装，
 * 于是那几条水下的判据根本不会执行。而它们恰恰是最容易悄悄回归的一类——
 * 图集里的 fluidColor 是 0..1 的浮点三元组，有人按字节去拼颜色，
 * 水的 [0.1,0.8,1] 就算成 0x000001：雾和背景一起涂黑，潜下去全黑，
 * 而且这个值是"真值"，兜底色永远不生效，所以没有任何报错。
 *
 * 判据不看截图，直接读 GL 缓冲：render() 之后 readPixels，取中心像素的亮度。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { launchChrome, Session } from "./cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + extra : "")); }
};

const PORT = 9417 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-water-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
const cleanup = () => { try { child.kill("SIGKILL"); } catch { } try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { } };
process.on("exit", cleanup);

const chrome = await launchChrome({});
const S = await Session.open(chrome.port, {
  width: 1280, height: 800,
  initScripts: ['localStorage.setItem("dao3_disclaimer_ack","3"); window.__errs=[]; addEventListener("error",e=>window.__errs.push(String(e.message)));'],
});

/* 全新数据目录里种子的是那张小示例图（48×32×48），不是随包附的 256×128×256 赛车模板，
   所以池子坐标必须按实际 shape 算，写死会把体素丢到界外、玩家一直往下掉。
   只改内存里的 world 与网格，不落盘——不污染任何存档。 */
await S.goto(BASE + "/edit/216d665d3ca92bd1b9a2?play=1", { settleMs: 2500 });
for (let i = 0; i < 60; i++) {
  if (await S.evaluate(`!!(window.__game && window.__game.running && window.__game.player)`)) break;
  await sleep(1000);
}
await sleep(1500);

const pool = await S.evaluate(`JSON.stringify((()=>{
  const E=window.__editor,w=E.world,wb=E.atlas.get("water");
  if(!wb)return {err:"图集里没有 water"};
  const [X,Y,Z]=w.shape;
  const bx=Math.max(1,Math.floor(X/2)-2), bz=Math.max(1,Math.floor(Z/2)-2);
  const by=Math.max(1,Math.floor(Y/3)), h=Math.min(8,Math.floor(Y/3));
  for(let x=bx;x<bx+5;x++)for(let y=by;y<by+h;y++)for(let z=bz;z<bz+5;z++)w.set(x,y,z,wb.id,0);
  E.renderer.rebuildAll();
  const g=window.__game; g.player.cameraMode="fps";
  g.playerEntity.position.set(bx+2.5,by+2,bz+2.5); g._vy=0;
  return {id:wb.id,shape:[X,Y,Z],at:[bx,by,bz],h,color:wb.fluidColor};
})())`);
const P = JSON.parse(pool);
ok("能在示例图里就地挖出一个水池", !P.err && P.id > 0, pool);

const read = () => S.evaluate(`JSON.stringify((()=>{
  const g=window.__game,R=window.__editor.renderer,gl=R.renderer.getContext();
  R.renderer.render(R.scene,R.camera);
  const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(4*w*h);
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const at=(x,y)=>{const i=((h-1-y)*w+x)*4;return [px[i],px[i+1],px[i+2]];};
  return {y:+g.playerEntity.position.y.toFixed(2),ms:g.player.moveState,under:R._underwater,
    fog:R.scene.fog.color.getHexString(),
    bg:R.scene.background&&R.scene.background.getHexString?R.scene.background.getHexString():null,
    center:at(w>>1,h>>1)};
})())`);

await sleep(700);
const mid = JSON.parse(await read());
ok("站在水里 moveState 是官方枚举 swim", mid.ms === "swim", JSON.stringify(mid));
ok("镜头在水里时切到水下态", mid.under === true, JSON.stringify(mid));

const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const hexLum = (hex) => { const n = parseInt(hex, 16); return lum([(n >> 16) & 255, (n >> 8) & 255, n & 255]); };
ok("水下雾色不是黑的（水 [0.1,0.8,1] 该染成青蓝）", hexLum(mid.fog) > 40, JSON.stringify(mid));
ok("水下背景与雾同色，不会露出黑底", mid.bg === mid.fog, JSON.stringify(mid));
ok("中心像素看得见东西，不是一片纯黑", lum(mid.center) > 25, JSON.stringify(mid.center));

/* Minecraft 手感：按住空格上浮、松手缓沉。官方没有浮力常数，判据只取方向。 */
await S.evaluate(`window.__game._keys.space = true`);
await sleep(1200);
const up = JSON.parse(await read());
await S.evaluate(`window.__game._keys.space = false`);
// 松手后还会带着残余上速飘一小段（实测约 0.2 格、200ms 内收敛到下沉目标速度），
// 立刻取样只会量到那个顶点。等它飘完，再断言方向。
await sleep(700);
const glide = JSON.parse(await read());
await sleep(900);
const sank = JSON.parse(await read());
ok(`按住空格真的上浮（${mid.y} → ${up.y}）`, up.y > mid.y + 0.3, JSON.stringify({ mid: mid.y, up: up.y }));
// 松手后带残余上速飘一小段是正常的（水的阻力把它兜住）；这里要挡的是"失控弹射"：
// 二段跳那一支以前没判 swimming，触发时 vy 直接写成 doubleJumpPower(0.9 格/tick)，
// 700ms 内能再窜 5 格以上。所以上界取 2 格——手感容差内宽松，回归时又一定拦得住。
ok(`松手后不会弹射（700ms 内上飘 ${glide.y - up.y < 0 ? 0 : (glide.y - up.y).toFixed(2)} 格 < 2）`,
  glide.y < up.y + 2, JSON.stringify({ up: up.y, glide: glide.y }));

ok(`稳定后往下沉（${glide.y} → ${sank.y}）`, sank.y < glide.y - 0.2, JSON.stringify({ glide: glide.y, down: sank.y }));

// 二段跳那一支以前没判 swimming，而它写的 vy = doubleJumpPower(0.9) 发生在游泳钳制**之后**，
// 于是游着游着按空格会突然弹射。先确定还泡在水里，再看竖直速度有没有越界。
const backInWater = await S.evaluate(`(()=>{const g=window.__game,P=${JSON.stringify(P.at)};
  g.playerEntity.position.set(P[0]+2.5,P[1]+2,P[2]+2.5); g._vy=0; g._doubleJumpUsed=false; return true;})()`);
await sleep(400);
await S.evaluate(`window.__game._keys.space = true`);
await sleep(600);
await S.evaluate(`window.__game._keys.space = false`);
await sleep(200);
const vy = await S.evaluate(`({ms:window.__game.player.moveState, vy:Math.abs(window.__game._vy), cap:window.__game.player.swimSpeed})`);
ok(`游泳时竖直速度受 swimSpeed 约束（二段跳绕不过钳制的那条路已堵）`,
  vy.ms === "swim" && vy.vy <= vy.cap + 1e-6, JSON.stringify({ ...vy, backInWater }));

/* 水面从下面也要看得见：水-水之间的面会被剔掉，水面那层法线朝上，
   单面材质从水下抬头看是背面 → 透明，等于没有水面。 */
ok("水面材质是双面的（水下抬头能看见水面）", await S.evaluate(`window.__editor.renderer.waterMat.side === 2`));

const errs = await S.evaluate(`JSON.stringify((window.__errs||[]).slice(0,3))`);
ok("全程没有未捕获错误", errs === "[]", errs);

await S.close();
cleanup();
console.log(`\nwater: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
else process.exit(0);
