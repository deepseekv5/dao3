/**
 * skin3d.test.mjs — MC 皮肤人偶的 UV 与骨架，用数字量而不是"看着像"。
 *
 * 为什么值得单独一条测试：展开图的六个面贴错、脚陷进地里，这两类错误在截图里
 * 都"像个皮肤"，只有把 UV 乘回 64 对着官方十字条量、把包围盒按像素量，
 * 才会当场报错。这两条恰好是初版真实踩过的坑。
 *
 * 参照实现是 skinview3d（浏览器里渲染真 MC 皮肤的那套），它的 setUVs 就是官方布局。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5900 + ((Date.now() % 90) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-skin3d-"));
const PX = 1.8 / 32;

const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanup() {
  try { child.kill("SIGTERM"); } catch { /* 已经退了 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 临时目录交给系统 */ }
}
process.on("exit", cleanup);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + String(extra) : "")); }
};

let up = false;
for (let i = 0; i < 60; i++) {
  await sleep(200);
  try {
    const j = await (await fetch(BASE + "/api/whoami")).json().catch(() => null);
    if (j && j.app === "laoyou-metaverse") { up = true; break; }
  } catch { /* 还没起来 */ }
}
if (!up) { console.log("FAIL  服务没起来"); process.exit(1); }

const chrome = await launchChrome({});
const S = await Session.open(chrome.port, { isolated: true, width: 900, height: 700 });
await S.goto(BASE + "/");
await sleep(600);

const d = JSON.parse(await S.evaluate(`(async () => {
  const T = await import('/vendor/three/three.module.js');
  const m = await import('/js/skin3d.js');
  const tex = await m.loadSkinTexture('/img/skins/creeper-tnt.png');
  const av = m.buildTexturedAvatar(tex);
  const full = new T.Box3().setFromObject(av);
  // 内层才是身体：外层（帽子/外套）按官方就该厚出半格，量比例要把它剔掉
  const inner = new T.Box3();
  av.traverse((o) => { if (o.isMesh && !o.userData.outer) inner.expandByObject(o); });
  const px = (v) => Math.round(v / ${PX} * 1000) / 1000;
  const face = (part, f) => {
    const uv = av.userData.parts[part].children[0].geometry.attributes.uv;
    const b = f * 4;
    return [uv.getX(b), uv.getY(b), uv.getX(b + 3), uv.getY(b + 3)].map((v) => Math.round(v * 64));
  };
  const joints = {};
  for (const [k, g] of Object.entries(av.userData.parts)) joints[k] = [g.position.x, g.position.y].map(px);
  let meshes = 0, nearest = 0, mip = 0;
  av.traverse((o) => { const t = o.isMesh && o.material.map; if (t) { meshes++; if (t.magFilter === T.NearestFilter) nearest++; } });
  return JSON.stringify({
    min: px(inner.min.y), top: px(inner.max.y), overTop: px(full.max.y), overMin: px(full.min.y),
    texW: tex.image && tex.image.width, texNearest: tex.magFilter === T.NearestFilter, texMip: !!tex.generateMipmaps,
    headFront: face('head', 4), headRight: face('head', 0), headTop: face('head', 2), headBack: face('head', 5),
    bodyFront: face('body', 4), bodyLeft: face('body', 1), legFront: face('legR', 4), armFront: face('armL', 4),
    joints, meshes, nearest,
    textured: !!av.userData.textured, parts6: ['head','body','armL','armR','legL','legR'].every((k) => av.userData.parts[k]),
  });
})()`));

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
/** UV 顶点存的是 (u0, vTop) 与 (u1, vBot)，v 是 1 - y/64，所以像素 y = 64 - v。 */
const wantRect = (label, a, x, y, w, h) => {
  const g = { x: a[0], yTop: 64 - a[1], x2: a[2], yBot: 64 - a[3] };
  ok(label, g.x === x && g.yTop === y && g.x2 === x + w && g.yBot === y + h, JSON.stringify(g) + ` 期望 ${x},${y} ${w}×${h}`);
};

ok("接口与细节人偶一致（parts/rig/textured）", d.textured && d.parts6, JSON.stringify(Object.keys(d.joints)));
ok("脚底正好落在原点（不陷地、不悬空）", near(d.min, 0), d.min);
ok("头顶在 32 像素 = 1.8 格", near(d.top, 32), d.top);
ok("外层只比身体厚出半格", d.overTop <= 32.6 && d.overMin >= -0.3, JSON.stringify([d.overMin, d.overTop]));
ok("关节高度：腿与躯干在 12，头与臂在 24", near(d.joints.legR[1], 12) && near(d.joints.body[1], 12)
  && near(d.joints.head[1], 24) && near(d.joints.armL[1], 24), JSON.stringify(d.joints));
ok("左右对称：手臂 ±6 像素、腿 ±2 像素", near(d.joints.armL[0], 6) && near(d.joints.armR[0], -6)
  && near(d.joints.legL[0], 2) && near(d.joints.legR[0], -2), JSON.stringify(d.joints));

wantRect("头的正脸取 (8,8) 8×8", d.headFront, 8, 8, 8, 8);
wantRect("头的侧面取 (16,8) 8×8", d.headRight, 16, 8, 8, 8);
wantRect("头的顶取 (8,0) 8×8", d.headTop, 8, 0, 8, 8);
wantRect("头的背取 (24,8) 8×8", d.headBack, 24, 8, 8, 8);
wantRect("躯干正面取 (20,20) 8×12", d.bodyFront, 20, 20, 8, 12);
wantRect("躯干侧面取 (16,20) 4×12", d.bodyLeft, 16, 20, 4, 12);
wantRect("右腿正面取 (4,20) 4×12", d.legFront, 4, 20, 4, 12);
wantRect("左臂正面取 (36,52) 4×12（64×64 扩展区）", d.armFront, 36, 52, 4, 12);

ok("六个部件都带外层，12 个网格全是最近邻", d.meshes === 12 && d.nearest === 12, JSON.stringify([d.meshes, d.nearest]));
ok("皮肤按 64×64 载入且用最近邻、不生成 mipmap", d.texW === 64 && d.texNearest && !d.texMip,
  JSON.stringify([d.texW, d.texNearest, d.texMip]));

console.log(`\nskin3d: ${pass} passed, ${fail} failed`);
await S.close().catch(() => { });
cleanup();
process.exit(fail ? 1 : 0);
