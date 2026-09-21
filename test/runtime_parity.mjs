// runtime_parity.mjs — 运行模式与官方 GameAPI 契约的一致性回归测试。
// 依据：vendor/ArenaPro-CLI/server/types/GameAPI.d.ts 与 box3-product-document 的默认值。
// 运行：node test/runtime_parity.mjs   （需先 ./run.sh；可用 BASE=http://127.0.0.1:5174 覆盖地址）
import fs from "node:fs";
import zlib from "node:zlib";
import { resolveChromium, chromeArgs, playwright } from "./browser.mjs";

// playwright-core 不是本项目依赖（运行时零依赖是硬要求），测试自己可移植地找它，找不到就 SKIP
const pw = await playwright();

const BASE = process.env.BASE || "http://127.0.0.1:5174";
const RACING_ID = "216d665d3ca92bd1b9a2";
const OUT = new URL("./out/", import.meta.url);
fs.mkdirSync(OUT.pathname, { recursive: true });

const home = process.env.HOME;
const exe = resolveChromium();
if (!exe) { console.log("SKIP  找不到可用的 Chromium：设置 CHROME=/path/to/chrome 后重试"); process.exit(0); }
if (!pw) { console.log("SKIP  找不到 playwright-core：设 PLAYWRIGHT_MODULE=/path/to/playwright-core 或先 npm i -D playwright-core"); process.exit(0); }

const browser = await pw.chromium.launch({ executablePath: exe, headless: true, args: chromeArgs() });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "   " + extra : "")); }
};

/* ---------------- 阶段 A：契约与物理（小超平坦世界） ---------------- */
await page.goto(`${BASE}/edit/${RACING_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 90000 });
await page.evaluate(() => { window.__noAutosave = true; });
await page.waitForTimeout(2500);
// 生成 64x64 超平坦作为可控测试场
await page.evaluate(() => window.__openSizeModal && window.__openSizeModal());
await page.waitForFunction(() => document.getElementById("sizeModal").classList.contains("show"), { timeout: 8000 });
await page.evaluate(() => {
  document.querySelector('#sizePresets [data-s="64,64"]').click();
  document.getElementById("szY").value = "64";
  document.getElementById("sizeOk").click();
});
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const S = window.__editor.state;
  S.entities = [
    { id: "按钮A", tags: ["互动"], pos: [10, 6, 10], bounds: [0.5, 0.5, 0.5], collides: false },
  ];
  S.scripts = [{ name: "index.js", code: `
const P = window.__probe = { fail: [], tickTimes: [], ticks: [], events: [] };
const need = (name, cond) => { if (!cond) P.fail.push(name); };

// 枚举字面值（官方 d.ts 为小写字符串）
need("GameCameraMode.FOLLOW=follow", GameCameraMode.FOLLOW === "follow");
need("GameCameraMode.FPS=fps", GameCameraMode.FPS === "fps");
need("GamePlayerMoveState.GROUND=ground", GamePlayerMoveState.GROUND === "ground");
need("GamePlayerWalkState.RUN=run", GamePlayerWalkState.RUN === "run");
need("GameButtonType.JUMP=jump", GameButtonType.JUMP === "jump");
need("GameButtonType.DOUBLE_JUMP=jump2", GameButtonType.DOUBLE_JUMP === "jump2");
need("GameInputDirection.BOTH=both", GameInputDirection.BOTH === "both");
need("GameDialogType.INPUT=input", GameDialogType.INPUT === "input");
need("GameCameraFreezedAxis.NONE=''", GameCameraFreezedAxis.NONE === "");

// 全局注入面
need("voxels 全局存在", !!voxels && typeof voxels.getVoxelId === "function");
need("world.say/setTimeout", typeof world.say === "function" && typeof world.setTimeout === "function");
need("getEntityBounds 全局", typeof getEntityBounds === "function");
need("sleep 返回 Promise", sleep(1) instanceof Promise);
need("resources.ls", typeof resources.ls("mesh") === "object");
need("storage 可用", typeof storage.set === "function");
need("remoteChannel 可用", typeof world.teleport === "function" && typeof sleep === "function");
need("GameVector3/GameBounds3/GameQuaternion", [GameVector3, GameBounds3, GameQuaternion].every((c) => typeof c === "function"));

// 官方世界默认值
need("world.gravity=-0.1", world.gravity === -0.1);
need("world.airFriction 取地图官方 velocityDamping", world.airFriction === 0.01);
need("world.useOBB=false", world.useOBB === false);
need("entityQuota 数值", typeof world.entityQuota() === "number");

// 方块旋转码编进数值 ID：base + 16384 * turn
const stoneId = voxels.id("stone");
voxels.setVoxel(4, 4, 4, stoneId, 2);
const packed = voxels.getVoxelId(4, 4, 4);
need("setVoxel 返回带旋转码 ID", packed === stoneId + 2 * 16384);
need("getVoxel 只给本体 ID", voxels.getVoxel(4, 4, 4) === stoneId);
need("getVoxelRotation=2", voxels.getVoxelRotation(4, 4, 4) === 2);
need("name() 能解析带旋转码 ID", voxels.name(packed) === "stone");
voxels.setVoxel(4, 4, 4, "air");
need("air 可破坏", voxels.getVoxel(4, 4, 4) === 0);
P.voxelTypes = voxels.VoxelTypes.length;
P.shape = [voxels.shape.x, voxels.shape.y, voxels.shape.z];

// 实体与选择器
const e2 = world.createEntity({ id: "测试物", tags: ["t"], position: new GameVector3(12, 12, 12), bounds: new GameVector3(0.5, 0.5, 0.5) });
need("createEntity 返回实体", !!e2 && e2.id === "测试物");
need("querySelector #id", world.querySelector("#测试物") === e2);
need("querySelectorAll .tag", world.querySelectorAll(".t").includes(e2));
need("testSelector", world.testSelector(".t", e2) === true);
need("getEntityBounds", getEntityBounds(e2).contains(new GameVector3(12, 12, 12)));
need("searchBox", world.searchBox(new GameBounds3(new GameVector3(11, 11, 11), new GameVector3(13, 13, 13))).includes(e2));
e2.destroy();
need("destroy 后查不到", world.querySelector("#测试物") === null);

// 区域触发器
const zone = world.addZone({ selector: "player", bounds: new GameBounds3(new GameVector3(0, 0, 0), new GameVector3(63, 40, 63)), force: new GameVector3(0, 0.02, 0), massScale: 0 });
zone.onEnter((ev) => { P.events.push("zoneEnter@" + ev.tick); });
zone.onLeave(() => { P.events.push("zoneLeave"); });
need("zones() 含新区域", world.zones().includes(zone));

// 事件通道：on* 返回 token，next* 是一次性 Promise
const tok = world.onTick(() => {});
need("onTick token", typeof tok.cancel === "function" && typeof tok.resume === "function" && typeof tok.active === "function");
need("token.active()", tok.active() === true);
tok.cancel();
need("token.cancel 生效", tok.active() === false);
world.nextTick().then((ev) => { P.nextTickOk = "tick" in ev && "prevTick" in ev && "skip" in ev && "elapsedTimeMS" in ev; });
world.onTick((ev) => {
  P.ticks.push({ tick: ev.tick, prev: ev.prevTick, skip: ev.skip, ms: performance.now(), el: ev.elapsedTimeMS });
  if (P.ticks.length > 600) P.ticks.shift();
});
const p0 = world.querySelector("player");
need("querySelector player", !!p0 && p0.isPlayer === true);
need("player.entity.player", p0.player && typeof p0.player.name === "string");
need("moveState 初始为官方枚举", ["fly","ground","swim","fall","jump","jump2"].includes(p0.player.moveState));
need("cameraMode 默认 follow", p0.player.cameraMode === "follow");
need("cameraDistance 默认 8.5", p0.player.cameraDistance === 8.5);
need("cameraFovY 默认 0.25", p0.player.cameraFovY === 0.25);
need("walkSpeed 默认 0.22", p0.player.walkSpeed === 0.22);
need("runSpeed 默认 0.4", p0.player.runSpeed === 0.4);
need("jumpPower 默认 0.96", p0.player.jumpPower === 0.96);
need("enableDoubleJump 默认 true", p0.player.enableDoubleJump === true);
need("movementBounds 是 GameBounds3", p0.player.movementBounds instanceof GameBounds3);
p0.player.onKeyDown((ev) => { if (ev.keyCode === 71) P.events.push("keyG"); });
p0.player.onPress((ev) => { P.events.push("press:" + ev.button + ":" + ev.pressed); });
p0.player.onRespawn(() => P.events.push("respawn"));
p0.player.dialog({ type: GameDialogType.SELECT, content: "x", options: ["a", "b"] }).then((v) => { P.dialogValue = v; });
need("world.sound 返回 Sound", (() => { const s = world.sound({ sample: "audio/无.mp3" }); return s === null || typeof s.stop === "function"; })());
const anim = world.animate([{ duration: 2, emissive: 0 }, { duration: 2, emissive: 1 }], { iterations: 1 });
need("world.animate 可 await", !!anim && typeof anim.cancel === "function");
need("getAnimations", world.getAnimations().includes(anim));
P.ok = true;
` }];
});
await page.evaluate(() => window.__play());
await page.waitForFunction(() => !!(window.__game && window.__game.player), { timeout: 10000 });
await page.waitForTimeout(300);

// 区域：把玩家明确搬进夹具盒子里，再搬出去 —— onEnter/onLeave 只依赖这一步，不靠出生点碰运气
await page.evaluate(() => {
  const g = window.__game;
  g.playerEntity.position.set(20, 30, 20);
  g._vy = 0; g._grounded = false;
});
await page.waitForTimeout(400);
const zoneEvents = await page.evaluate(() => (window.__probe.events || []).slice(0, 8));
ok("区域进入事件已触发", zoneEvents.some((e) => e.startsWith("zoneEnter@")), JSON.stringify(zoneEvents));

// 关掉区域，制造离开事件
await page.evaluate(() => { const z = window.__game.world.zones()[0]; if (z) z.remove(); });
await page.evaluate(() => { const b = document.querySelector("#gameDialog .d-options button"); if (b) b.click(); });

/* ---- 物理夹具：在阶段 A 那张 64×64×64 超平坦的半空里现搭一座平台，
   位移/跳跃/踏步/穿模只依赖它。以前直接在出生点量走路，前方是什么全看地图，
   碰撞判据一改就被装饰方块绊住（64³ 之外写方块则会被越界判据静默吃掉）。 */
const spot = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  const sp = p.spawnPoint || { x: 32, z: 32 };
  const x = Math.round(sp.x), z = Math.round(sp.z);
  return { x, z, y: g._topAt(x, z)[1] };
});
const phys = await page.evaluate(async (s) => {
  const g = window.__game, w = g.e.world, a = g.e.atlas, e = g.playerEntity, P = g.player;
  const sid = a.get("stone").id, gid = a.get("glass").id;
  const X = 18, Y = 40, Z = 18, N = 20, WX = X + 6; // WX：挡人的那列墙
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pump = async (frames) => { for (let i = 0; i < frames; i++) { g._last -= 320; g._frame(); await sleep(6); } };
  const saved = [];
  const keep = (x, y, z) => saved.push([x, y, z, w.get(x, y, z), w.getRot(x, y, z)]);
  for (let x = X; x < X + N; x++) for (let z = Z; z < Z + N; z++) {
    keep(x, Y - 1, z);
    w.set(x, Y - 1, z, sid, 0);
    for (let y = Y; y < Y + 13; y++) { keep(x, y, z); w.set(x, y, z, 0, 0); }
  }
  const home = () => {
    e.position.set(X + 2.5, Y, Z + 10.5); e.velocity.set(0, 0, 0);
    g._vy = 0; g._grounded = true; g._jumpPhase = false; g._tYaw = g._yaw = -Math.PI / 2; // 前方 = +X
  };
  Object.assign(P, { walkSpeed: 0.22, runSpeed: 0.4, jumpPower: 0.96, canFly: false, flying: false, spectator: false, enableJump: true, scale: 1 });
  const out = { fits: X + N - 1 < w.shape[0] && Y + 13 < w.shape[1] && Z + N - 1 < w.shape[2] };
  home(); await pump(3);
  out.onPlatform = g._grounded === true && Math.abs(e.position.y - Y) < 0.05;

  // 1) 行走：官方口径是「每 tick 位移」，按真实推进的 tick 数归一
  const p0 = { x: e.position.x, z: e.position.z }, t0 = g.currentTick;
  g._setKey("keyw", true); await pump(10); g._setKey("keyw", false);
  const n0 = g.currentTick - t0;
  out.walk = { per: Math.hypot(e.position.x - p0.x, e.position.z - p0.z) / Math.max(1, n0), n: n0, want: P.walkSpeed, dy: +(e.position.y - Y).toFixed(3) };
  home();

  // 2) 跳跃：jumpPower 0.96 + gravity -0.1（上升段还乘 jumpAccelerationFactor）→ 数格高
  let apex = e.position.y;
  g._jumpBuf = 0.2;
  for (let i = 0; i < 40; i++) { g._last -= 320; g._frame(); apex = Math.max(apex, e.position.y); await sleep(6); }
  out.jump = { apex: +(apex - Y).toFixed(2), back: +(e.position.y - Y).toFixed(2) };
  home();

  // 3) 玻璃必须挡人：官方 block-spec 里 transparent 只是渲染标记（456 格玻璃曾画得出来却穿得过去）
  for (let z = Z; z < Z + N; z++) w.set(WX, Y, z, gid, 0);
  out.glassBlocks = !!g._boxHitsVoxel(WX - 0.29, Y, Z + 10.5, 0.3, 1.8);
  g._setKey("keyw", true); await pump(14); g._setKey("keyw", false);
  out.glassWalk = { x: +e.position.x.toFixed(2), face: +(WX - 0.3).toFixed(2), rose: +(e.position.y - Y).toFixed(2) };
  for (let z = Z; z < Z + N; z++) w.set(WX, Y, z, 0, 0);
  home();

  // 4) 实心墙 + 高速位移：单帧 5 格撞墙不得隧穿，必须停在墙面
  for (let z = Z; z < Z + N; z++) { w.set(WX, Y, z, sid, 0); w.set(WX, Y + 1, z, sid, 0); }
  const moved = g._moveEntity(e, 5, 0, 0, 0.3, 1.8, false, P);
  out.tunnel = { x: +e.position.x.toFixed(2), blocked: !!moved.blockedX, limit: +(WX - 0.3).toFixed(2) };
  home();

  // 5) 自动踏步：1 格高的墙走路爬不上去（官方要跳），起跳才过得去
  g._setKey("keyw", true); await pump(14); g._setKey("keyw", false);
  out.stepWalk = { x: +e.position.x.toFixed(2), rose: +(e.position.y - Y).toFixed(2), passed: e.position.x > WX + 0.4 };
  home();
  g._setKey("keyw", true); g._jumpBuf = 0.2;
  for (let i = 0; i < 40 && e.position.x < WX + 0.5; i++) { g._last -= 320; g._frame(); await sleep(6); }
  g._setKey("keyw", false);
  out.stepJump = { passed: e.position.x > WX + 0.4, x: +e.position.x.toFixed(2) };
  for (let z = Z; z < Z + N; z++) { w.set(WX, Y, z, 0, 0); w.set(WX, Y + 1, z, 0, 0); }
  home();

  // 6) 实体碰撞盒按盒心算：从空中落到平台上应当停在顶面 + 半高
  const ent = g.world.createEntity({ name: "箱子", position: { x: X + 2.5, y: Y + 3, z: Z + 2.5 }, bounds: { x: 0.5, y: 0.5, z: 0.5 } });
  ent.collides = true; ent.gravity = true; ent.fixed = false;
  for (let i = 0; i < 80; i++) { g._last -= 320; g._frame(); await sleep(4); }
  out.bodyRest = { y: +ent.position.y.toFixed(2), want: Y + 0.5 };
  ent.destroy();

  // 复原夹具，别把测试方块留在图里；玩家也要搬回出生点，否则夹具一撤他就自由落体
  for (const [x, y, z, id, rot] of saved) w.set(x, y, z, id, rot);
  g._voxelDirty && g._voxelDirty.clear();
  out.walkState = P.walkState;
  e.position.set(s.x, s.y, s.z);
  e.velocity.set(0, 0, 0);
  g._vy = 0; g._grounded = true; g._jumpPhase = false; g._tYaw = g._yaw = 0;
  return out;
}, spot);
ok("物理夹具落在世界范围内", phys.fits === true && phys.onPlatform === true, JSON.stringify(phys));
ok(`行走为官方每-tick 位移（${phys.walk.n} tick，${phys.walk.per.toFixed(3)} 格/tick，官方 ${phys.walk.want}）`,
  phys.walk.per > phys.walk.want * 0.75 && phys.walk.per < phys.walk.want * 1.3 && Math.abs(phys.walk.dy) < 0.1, JSON.stringify(phys.walk));
ok(`跳跃高度为官方量级（${phys.jump.apex} 格，jumpPower 0.96 / gravity -0.1 → 期望 3–12）`,
  phys.jump.apex > 3 && phys.jump.apex < 12 && Math.abs(phys.jump.back) < 0.3, JSON.stringify(phys.jump));
ok(`玻璃参与碰撞（官方 transparent 只是渲染标记，不再画得出来穿得过去）`,
  phys.glassBlocks === true && phys.glassWalk.x <= phys.glassWalk.face + 0.05 && Math.abs(phys.glassWalk.rose) < 0.1, JSON.stringify(phys.glassWalk));
ok(`单帧 5 格位移撞墙不隧穿（停在 ${phys.tunnel.x}，墙面 ${phys.tunnel.limit}）`,
  phys.tunnel.blocked === true && phys.tunnel.x <= phys.tunnel.limit + 0.05, JSON.stringify(phys.tunnel));
ok(`1 格墙走路爬不上去、起跳才能过`, phys.stepWalk.rose < 0.1 && phys.stepWalk.passed === false && phys.stepJump.passed === true,
  JSON.stringify({ walk: phys.stepWalk, jump: phys.stepJump }));
ok(`实体碰撞盒按盒心积分（落回 ${phys.bodyRest.y}，期望 ${phys.bodyRest.want}）`,
  Math.abs(phys.bodyRest.y - phys.bodyRest.want) < 0.05, JSON.stringify(phys.bodyRest));

/* ---- 旋转码进网格：mesher 以前只存 rot 不用，setVoxel(...,3) 画面毫无变化。
   判据用「哪个世界面拿到 front 贴图」来量，而不是笼统地看 UV 变没变。 */
const rotMesh = await page.evaluate(async () => {
  const g = window.__game, r = g.e.renderer, w = g.e.world, a = g.e.atlas, A = a;
  const bid = (a.get("television") || a.get("bookshelf")).id;
  const X = 12, Y = 55, Z = 12; // 超平坦上空，四周全空，顶点只可能来自这一块
  const flush = () => new Promise((res) => setTimeout(res, 30));
  const face = (axis, sign) => {
    // 只认法线：同一平面上还有相邻面的顶点，按位置筛会把它们的 UV 混进来
    const key = Math.floor(X / 16) + "," + Math.floor(Y / 16) + "," + Math.floor(Z / 16);
    const mm = r.chunkMeshes.get(key) && r.chunkMeshes.get(key).opaque;
    if (!mm) return "";
    const g = mm.geometry;
    const p = g.getAttribute("position"), u = g.getAttribute("uv"), nr = g.getAttribute("normal");
    if (!p || !u || !nr) return "";
    const at = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const got = [];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(nr.getX(i) * (at === 0 ? 1 : 0) + nr.getY(i) * (at === 1 ? 1 : 0) + nr.getZ(i) * (at === 2 ? 1 : 0) - sign) > 1e-6) continue;
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (x < X - 1e-6 || x > X + 1 + 1e-6 || y < Y - 1e-6 || y > Y + 1 + 1e-6 || z < Z - 1e-6 || z > Z + 1 + 1e-6) continue;
      got.push(+u.getX(i).toFixed(5) + "," + +u.getY(i).toFixed(5));
    }
    return got.sort().join("|");
  };
  const snap = async (rot) => {
    g._setVox(X, Y, Z, bid, rot);
    r.markDirty(X, Y, Z);
    await flush();
    return { nz: face("z", -1), px: face("x", 1), pz: face("z", 1), nx: face("x", -1) };
  };
  // 期望值直接由图集算：turn t 时世界方向 d 上贴的是方块自身第 (d - t) mod 4 个方向的面。
  // 方向序号 0北(-Z) 1东(+X) 2南(+Z) 3西(-X) → 图集槽位 [front4, right1, back5, left0]
  const DIR_SLOT = [4, 1, 5, 0];
  const blk = A.byId(bid);
  const f5 = (v) => Number(v).toFixed(5); // 网格那边按 toFixed(5) 取值，两边必须同一格式
  const sig = (tile) => { const [u0, v0, u1, v1] = A.tileUV(tile); return [f5(u0) + "," + f5(v0), f5(u0) + "," + f5(v1), f5(u1) + "," + f5(v0), f5(u1) + "," + f5(v1)].sort().join("|"); };
  const norm = (s) => s.split("|").sort().join("|");
  const want = (dir, t) => sig(blk.faces[DIR_SLOT[(dir - t + 4) % 4]]);
  const shots = {};
  for (const t of [0, 1, 2, 3]) shots["t" + t] = await snap(t);
  const hits = {
    n0: norm(shots.t0.nz) === want(0, 0), n1: norm(shots.t1.nz) === want(0, 1),
    n2: norm(shots.t2.nz) === want(0, 2), n3: norm(shots.t3.nz) === want(0, 3),
    e1: norm(shots.t1.px) === want(1, 1), e2: norm(shots.t2.px) === want(1, 2),
  };
  const t4 = await snap(0);
  const out = { hits, block: blk.name, rotStored: w.getRot(X, Y, Z), loop: t4.nz === shots.t0.nz, frontBackDiffer: want(0, 0) !== want(0, 2), dbg: { got: norm(shots.t0.nz), want: want(0, 0) } };
  g._clearVox(X, Y, Z);
  await flush();
  return out;
});
ok(`旋转码被 mesher 消费：turn t 的世界面贴的是方块第 (d-t) mod 4 个方向的面（官方 N→E 顺时针）`,
  Object.values(rotMesh.hits).every(Boolean), JSON.stringify({ hits: rotMesh.hits, dbg: rotMesh.dbg }));
ok(`转满 360° 回到原位、正反面确有区别、rot 已按 turn 存储`,
  rotMesh.loop === true && rotMesh.frontBackDiffer === true && rotMesh.rotStored === 0, JSON.stringify(rotMesh));

/* ---- 粒子：官方把存活期五等分，color0..4 / size0..4 是各阶段的取值 ---- */
const part = await page.evaluate(async () => {
  const K = window.__game.constructor, g = window.__game, e = g.playerEntity;
  const spec = K.particleFrom({
    rate: 30, rateSpread: 5, limit: 200, lifetime: 2, lifetimeSpread: 1, damping: 3,
    acceleration: { x: 0, y: 1, z: 0 }, noiseAmpl: 2, noiseFreq: 10,
    velocity: { x: 0, y: 0, z: 50 }, velocitySpread: { x: 30, y: 2, z: 2 }, sizeSpread: 4,
    color0: { r: 1000, g: 500, b: 0 }, color1: { r: 200, g: 100, b: 1000 },
    color2: { r: 0, g: 0, b: 0 }, color3: { r: 0, g: 0, b: 0 }, color4: { r: 0, g: 0, b: 0 },
    size0: 2, size1: 4, size2: 8, size3: 4, size4: 10,
  });
  // 官方 199 实体的默认块：只有 color0=1000，其余全 0 —— 收成 5 档会让粒子渐变到黑色消失
  const def = K.particleFrom({ rate: 1, color0: { r: 1000, g: 1000, b: 1000 }, color1: { r: 0, g: 0, b: 0 }, size0: 1, size1: 1, size2: 1, size3: 1, size4: 1 });
  Object.assign(e, { particleRate: 60, particleLimit: 120, particleLifetime: 1, particleLifetimeSpread: 0, particleSize: [2, 4, 8, 4, 10], particleColor: [[1, 0, 0], [0, 0, 1]], particleSizeSpread: 0, particleAcceleration: { x: 0, y: 0, z: 0 } });
  g._initParticles(e);
  for (let i = 0; i < 14; i++) { g._last -= 320; g._frame(); await new Promise((r) => setTimeout(r, 4)); }
  const at = e._points.geometry.getAttribute("aSize"), ac = e._points.geometry.getAttribute("aCol");
  const sizes = [], cols = new Set();
  for (let i = 0; i < (at ? at.count : 0); i++) {
    sizes.push(+at.getX(i).toFixed(3));
    cols.add([ac.getX(i), ac.getY(i), ac.getZ(i)].map((v) => v.toFixed(2)).join(","));
  }
  const res = {
    specColor: spec && spec.color, specSize: spec && spec.size, specRate: spec && spec.rate,
    specLimit: spec && spec.limit, specNoise: spec && spec.noise, specFreq: spec && spec.noiseFrequency,
    specDamping: spec && spec.damping, specSpread: spec && spec.sizeSpread,
    defColor: def && def.color, n: sizes.length, uniqSize: new Set(sizes).size,
    min: Math.min(...sizes), max: Math.max(...sizes), cols: [...cols],
    visible: e._points.visible, blending: e._points.material.blending,
  };
  e.particleRate = 0;
  g._stepParticles(e, 0.016);
  res.hidden = !e._points.visible;
  return res;
});
ok(`particle color0..4 按 /1000 归一为 GameRGBColor 档位（0 档被丢掉，不会渐变到黑）`,
  JSON.stringify(part.specColor) === JSON.stringify([[1, 0.5, 0], [0.2, 0.1, 1]]) && JSON.stringify(part.defColor) === JSON.stringify([[1, 1, 1]]),
  JSON.stringify({ got: part.specColor, def: part.defColor }));
ok(`particle size0..4 原样作为五阶段尺寸，rate/limit/noise/spread 等一并映射`,
  JSON.stringify(part.specSize) === JSON.stringify([2, 4, 8, 4, 10]) && part.specRate === 30 && part.specLimit === 200
  && part.specNoise === 2 && part.specFreq === 10 && part.specDamping === 3 && part.specSpread === 4,
  JSON.stringify({ size: part.specSize, rate: part.specRate, limit: part.specLimit }));
ok(`粒子逐帧有各自的阶段尺寸与颜色（不再共用一个全局 size）`,
  part.n > 20 && part.uniqSize > 3 && part.min >= 2 && part.max <= 10 && part.cols.length >= 2 && part.visible === true && part.hidden === true,
  JSON.stringify({ n: part.n, uniqSize: part.uniqSize, min: part.min, max: part.max, cols: part.cols.length }));

/* ---- 玩家显示/移动属性：官方 color/metalness/emissive/shininess/scale/spectator/showName 逐个验证真的生效 ---- */
const pl = await page.evaluate(async () => {
  const g = window.__game, P = g.player, e = g.playerEntity, w = g.e.world, a = g.e.atlas;
  const sid = a.get("stone").id;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = async (n) => { for (let i = 0; i < (n || 2); i++) { g._last -= 320; g._frame(); await sleep(6); } };
  const out = {};
  const parts = e._avatar.userData.parts;
  const body = parts.body.material, leg = parts.legL.material;
  out.standard = !!(body.isMeshStandardMaterial && leg.isMeshStandardMaterial);
  P.color.red = 0.2; P.color.green = 0.9; P.color.blue = 0.4;
  P.metalness = 0.7; P.shininess = 0.35; P.emissive = 1.5;
  await step();
  out.look = {
    body: [body.color.r, body.color.g, body.color.b].map((v) => +v.toFixed(2)),
    metal: +leg.metalness.toFixed(2), rough: +leg.roughness.toFixed(2),
    emis: +leg.emissiveIntensity.toFixed(2), lit: +(leg.emissive.r + leg.emissive.g + leg.emissive.b).toFixed(2),
  };
  P.color.red = 0.95; P.color.green = 0.76; P.color.blue = 0.49;
  P.metalness = 0; P.shininess = 0; P.emissive = 0;
  await step();
  out.restored = { metal: +leg.metalness.toFixed(2), rough: +leg.roughness.toFixed(2), emis: +leg.emissiveIntensity.toFixed(2) };

  // 2 格高的通道：scale 1（盒高 1.8）走得进，scale 2（3.6）必须被顶住
  const saved = [];
  const put = (x, y, z, id) => { saved.push([x, y, z, w.get(x, y, z), w.getRot(x, y, z)]); w.set(x, y, z, id, 0); };
  const X = 20, Y = 40, Z = 30;
  for (let x = X; x < X + 8; x++) for (let z = Z; z < Z + 3; z++) {
    put(x, Y - 1, z, sid);
    for (let y = Y; y <= Y + 2; y++) put(x, y, z, 0);
    if (x >= X + 3) put(x, Y + 2, z, sid); // 前 5 列压上天花板 → 只剩 2 格净空
  }
  g._flushVoxelDirty && g._flushVoxelDirty();
  const walk = async (scale) => {
    P.scale = scale;
    e.position.set(X + 0.5, Y, Z + 1.5); e.velocity.set(0, 0, 0);
    g._vy = 0; g._grounded = true; g._tYaw = g._yaw = -Math.PI / 2;
    await step(3);
    g._setKey("keyw", true); await step(24); g._setKey("keyw", false);
    return { x: +e.position.x.toFixed(2), y: +e.position.y.toFixed(2), gate: X + 3 };
  };
  out.scale1 = await walk(1);
  out.scale2 = await walk(2);
  out.avatarScale = +e._avatar.scale.x.toFixed(2);
  P.scale = 1;

  // spectator（官方释义＝幽灵，可穿墙）：同一堵 2 格墙，关着走不过去、开着直接穿过
  for (let x = X; x < X + 8; x++) for (let z = Z; z < Z + 3; z++) { for (let y = Y; y <= Y + 2; y++) put(x, y, z, 0); }
  for (let z = Z - 2; z < Z + 5; z++) { put(X + 4, Y, z, sid); put(X + 4, Y + 1, z, sid); }
  g._flushVoxelDirty && g._flushVoxelDirty();
  const hitWall = async (spec) => {
    P.spectator = spec;
    e.position.set(X + 1.5, Y, Z + 1.5); e.velocity.set(0, 0, 0);
    g._vy = 0; g._grounded = false; g._tYaw = g._yaw = -Math.PI / 2;
    await step(3);
    g._setKey("keyw", true); await step(20); g._setKey("keyw", false);
    return +e.position.x.toFixed(2);
  };
  out.wallSolid = await hitWall(false);
  out.wallGhost = await hitWall(true);
  P.spectator = false;

  // showName：本地只有一个玩家，自己的名牌恒不显示，所以借一个 isPlayer 的替身走同一条代码路径
  const seen = [];
  const origUpdate = g.tags.update;
  g.tags.update = function (cam, target, ent2, opts) { seen.push([ent2 === dup ? opts.name : "(other)", P.showName]); return origUpdate.apply(this, arguments); };
  const dup = g.world.createEntity({ name: "替身", position: { x: X + 1, y: Y + 1, z: Z } });
  dup.isPlayer = true; dup.player = P;
  g.tags.ensure && g.tags.ensure(dup);
  P.name = "测试名";
  P.showName = true; await step(2);
  const withName = seen.filter((s) => s[1] === true && s[0] === "测试名").length;
  P.showName = false; seen.length = 0; await step(2);
  const without = seen.filter((s) => s[1] === false && s[0] === "").length;
  g.tags.update = origUpdate;
  dup.destroy();
  out.showName = { withName, without };

  for (const [x, y, z, id, rot] of saved) w.set(x, y, z, id, rot);
  g._voxelDirty && g._voxelDirty.clear();
  return out;
});
ok(`人偶材质是 PBR，player.color/metalness/shininess/emissive 赋值即时生效`,
  pl.standard === true && pl.look.body[0] === 0.2 && pl.look.body[1] === 0.9 && pl.look.body[2] === 0.4
  && pl.look.metal === 0.7 && pl.look.rough === 0.65 && pl.look.emis === 1.5 && pl.look.lit > 0.5
  && pl.restored.metal === 0 && pl.restored.emis === 1, JSON.stringify(pl.look) + " " + JSON.stringify(pl.restored));
ok(`player.scale 同时放大人偶与物理盒（2 格净空：scale1 过得去、scale2 被顶住）`,
  pl.avatarScale === 2 && pl.scale1.x > pl.scale1.gate && pl.scale2.x <= pl.scale2.gate + 0.35,
  JSON.stringify({ s1: pl.scale1, s2: pl.scale2, av: pl.avatarScale }));
ok(`player.spectator＝官方「幽灵可穿墙」：关掉被墙挡住、打开直接穿过`,
  pl.wallSolid < 24.4 && pl.wallGhost > 24.9, JSON.stringify({ solid: pl.wallSolid, ghost: pl.wallGhost }));
ok(`player.showName 控制名牌文本（开=名字，关=空）`,
  pl.showName.withName > 0 && pl.showName.without > 0, JSON.stringify(pl.showName));

/* ---- 图片资产：resources.ls("picture") 与 UiImage 的项目内路径解析 ---- */
const pic = await page.evaluate(() => {
  const g = window.__game, api = g._cliApi;
  g.e.state.meta.assetRoot = "/assets/worlds/pictest/";
  g.assets.pictureNames = ["picture/按钮底.png", "picture/图标.jpg"];
  const ls = g._resources().ls("picture");
  const scr = api.UiScreen.create();
  const img = api.UiImage.create();
  img.parent = scr;
  img.image = "picture/按钮底.png"; api.refresh();
  const withDir = img.el.getAttribute("src");
  img.image = "按钮底.png"; api.refresh();
  const bare = img.el.getAttribute("src");
  img.image = "https://example.com/x.png"; api.refresh();
  const abs = img.el.getAttribute("src");
  img.parent = null; scr.parent = null;
  return {
    n: ls.length, paths: ls.map((x) => x.path), types: [...new Set(ls.map((x) => x.type))],
    withDir, bare, abs,
    lut: g._resources().ls("lut").length, mesh: g._resources().ls("mesh").length,
    audio: g._resources().ls("audio").length, js: g._resources().ls("js").map((x) => x.path),
  };
});
ok(`resources.ls("picture") 列出项目内图片（path 带 picture/ 前缀、type 为 picture）`,
  pic.n === 2 && pic.types.join() === "picture" && pic.paths[0] === "picture/按钮底.png", JSON.stringify(pic));
ok(`UiImage 解析项目内路径：带目录与省略目录都落到 assetRoot，绝对 URL 原样透传`,
  pic.withDir === "/assets/worlds/pictest/picture/按钮底.png" && pic.bare === pic.withDir && pic.abs === "https://example.com/x.png",
  JSON.stringify({ withDir: pic.withDir, bare: pic.bare, abs: pic.abs }));
ok(`resources.ls 对 mesh/audio/lut/js 各目录都能列`, pic.mesh > 0 && pic.audio > 0 && pic.js.length > 0, JSON.stringify({ mesh: pic.mesh, audio: pic.audio, js: pic.js }));

/* ---- 镜头：cameraFreezedAxis 八种取值 + FOLLOW/RELATIVE 的角基准不同 ---- */
const cam = await page.evaluate(() => {
  const g = window.__game, P = g.player, e = g.playerEntity;
  const out = {};
  const move = (mx, my) => {
    const a0 = g._tYaw, b0 = g._tPitch;
    g._dragLook = true;
    g._onMouseMove({ movementX: mx, movementY: my });
    g._dragLook = false;
    return { yaw: Math.abs(g._tYaw - a0) > 1e-9, pitch: Math.abs(g._tPitch - b0) > 1e-9 };
  };
  for (const ax of ["", "x", "y", "z", "xy", "xz", "yz", "xyz"]) {
    g._tYaw = g._yaw = 0; g._tPitch = g._pitch = 0;
    P.cameraFreezedAxis = ax;
    out[ax || "none"] = move(120, 60);
  }
  // FOLLOW：身体转向实际移动方向；RELATIVE：身体刚性对齐镜头（侧移也不会错开）
  const gy = g._topAt(32, 32)[1];
  const strafe = (mode) => {
    P.cameraMode = mode;
    e.position.set(32, gy, 32); e.velocity.set(0, 0, 0);
    g._vy = 0; g._grounded = true; g._tYaw = g._yaw = 0; e._faceYaw = null; e._lookYaw = null;
    g._setKey("keyw", true); g._setKey("keyd", true);
    for (let i = 0; i < 10; i++) { g._last -= 320; g._frame(); }
    g._setKey("keyw", false); g._setKey("keyd", false);
    return { body: +Number(e._obj.rotation.y).toFixed(2), cam: +g._yaw.toFixed(2), dz: +(e.position.z - 32).toFixed(2) };
  };
  out.strafeFollow = strafe("follow");
  out.strafeRelative = strafe("relative");
  // RELATIVE + 冻结 Y：镜头不能绕行，身体也就转不动
  P.cameraMode = "relative"; P.cameraFreezedAxis = "y";
  g._tYaw = g._yaw = 0; e._faceYaw = null;
  g._dragLook = true; g._onMouseMove({ movementX: 200, movementY: 0 }); g._dragLook = false;
  for (let i = 0; i < 6; i++) { g._last -= 320; g._frame(); }
  out.relativeFreezeY = { yaw: +g._yaw.toFixed(3), body: +Number(e._obj.rotation.y).toFixed(3) };
  P.cameraFreezedAxis = ""; P.cameraMode = "follow"; e._faceYaw = null;
  return out;
});
const wantCam = {
  none: [1, 1], x: [1, 0], y: [0, 1], z: [1, 1], xy: [0, 0], xz: [1, 0], yz: [0, 1], xyz: [0, 0],
};
const camOk = Object.entries(wantCam).every(([k, [yaw, pitch]]) =>
  !!cam[k] && !!cam[k].yaw === !!yaw && !!cam[k].pitch === !!pitch);
ok(`cameraFreezedAxis 八种取值逐个生效（含 y 锁绕行、x 锁俯仰、组合叠加）`, camOk, JSON.stringify(cam));
ok(`FOLLOW 身体转向移动方向、RELATIVE 身体刚性对齐镜头`,
  Math.abs(cam.strafeFollow.body - cam.strafeFollow.cam) > 0.5 && Math.abs(cam.strafeRelative.body - cam.strafeRelative.cam) < 0.05,
  JSON.stringify({ f: cam.strafeFollow, r: cam.strafeRelative }));
ok(`RELATIVE + 冻结 Y：镜头转不动，身体也停在原朝向`,
  Math.abs(cam.relativeFreezeY.yaw) < 1e-6 && Math.abs(cam.relativeFreezeY.body) < 1e-6, JSON.stringify(cam.relativeFreezeY));
ok("walkState 为官方枚举值", ["", "walk", "run", "crouch"].includes(phys.walkState), phys.walkState);

// 官方契约是「每 tick 64ms」的确定性推进，而不是墙上时间；机器忙时 rAF 会被饿到，
// 所以这里断言 tick 单调 + 64ms 换算，墙上间隔只给一个宽松上限
const probe = await page.evaluate(() => window.__probe || {});
const ts = (probe.ticks || []).map((t) => t.ms);
const tail = ts.slice(-40);
const span = tail.length > 1 ? (tail[tail.length - 1] - tail[0]) / (tail.length - 1) : 0;
const tickNums = (probe.ticks || []).map((t) => t.tick);
const monotonic = tickNums.every((v, i) => i === 0 || v > tickNums[i - 1]);
const elapsedMath = await page.evaluate(() => {
  const g = window.__game;
  const ev = { t0: g.currentTick };
  const e = g._tickEvent ? g._tickEvent(g.currentTick - 1, false) : null;
  return e ? { got: e.elapsedTimeMS, want: g.currentTick * 64, tick: e.tick, prev: e.prevTick } : null;
});
ok(`world.onTick 稳定推进（tick 单调 + 64ms/tick 换算，墙上 ${span.toFixed(1)}ms）`,
  monotonic && !!elapsedMath && Math.abs(elapsedMath.got - elapsedMath.want) <= 64 && span < 400,
  JSON.stringify({ monotonic, elapsedMath, span, n: tail.length }));
ok("GameTickEvent 含 tick/prevTick/skip/elapsedTimeMS", (probe.ticks || []).some((t) => t.prev === t.tick - 1 && typeof t.skip === "boolean" && t.el === t.tick * 64));
ok("nextTick 事件字段完整", probe.nextTickOk !== false);
ok("方块旋转码/选择器/区域等契约全部通过", (probe.fail || []).length === 0, (probe.fail || []).join(" | "));
ok("VoxelTypes 为官方 384 方块表", probe.voxelTypes >= 380, "n=" + probe.voxelTypes);
ok("弹窗 SELECT 返回值", probe.dialogValue === "a", String(probe.dialogValue));

/* ---------------- 阶段 B：官方 API 行为（弹跳垫 / 传送带 / 流体 / 空气墙） ---------------- */
await page.evaluate(() => {
  const S = window.__editor.state;
  S.scripts = [{ name: "index.js", code: `
const P = window.__probe2 = { fail: [] };
const need = (n, c) => { if (!c) P.fail.push(n); };
const player = world.querySelector("player");
// 平整地面
voxels.fillVoxel(new GameVector3(20, 19, 20), new GameVector3(44, 19, 44), "stone");
// 弹跳垫：block-spec velocity [0,1.25,0]
voxels.setVoxel(32, 20, 32, "bounce_pad");
player.position.set(32.5, 22, 32.5);
P.bounceTest = true;
// 传送带：block-spec velocity [-0.25,0,0]
voxels.fillVoxel(new GameVector3(26, 20, 40), new GameVector3(40, 20, 40), "conveyor");
// 流体：水 → moveState swim（池底要有实心，否则玩家会掉出水面区）
voxels.fillVoxel(new GameVector3(9, 19, 9), new GameVector3(15, 19, 15), "stone");
voxels.fillVoxel(new GameVector3(10, 20, 10), new GameVector3(14, 26, 14), "water");
// 空气墙：不可见但实心
voxels.setVoxel(36, 21, 32, "barrier");
P.fluidId = voxels.id("water");
P.barrierId = voxels.id("barrier");
world.onFluidEnter((ev) => { P.events = (P.events || []).concat("enter"); });
world.onFluidLeave((ev) => { P.events = (P.events || []).concat("leave"); });
world.onVoxelContact((ev) => { P.voxelContact = { x: ev.x, y: ev.y, z: ev.z, voxel: ev.voxel, axisY: ev.axis.y }; });
const z = world.addZone({ selector: "player", bounds: new GameBounds3(new GameVector3(10, 19, 10), new GameVector3(14, 27, 14)) });
z.onEnter(() => { P.events = (P.events || []).concat("zone"); });
` }];
});
await page.evaluate(() => window.__stopPlay());
await page.waitForTimeout(300);
await page.evaluate(() => window.__play());
await page.waitForFunction(() => !!window.__probe2, { timeout: 10000 });
// 落在弹跳垫上
await page.evaluate(() => { const g = window.__game; g.playerEntity.position.set(32.5, 21.2, 32.5); g._vy = -0.2; g._grounded = false; });
await page.waitForTimeout(700);
const bounce = await page.evaluate(() => ({ y: window.__game.playerEntity.position.y, ms: window.__game.player.moveState }));
ok(`弹跳垫把玩家弹起（y=${bounce.y.toFixed(2)}，官方 velocity[1]=1.25）`, bounce.y > 22.2, JSON.stringify(bounce));

// 传送带推动
await page.evaluate(() => { const g = window.__game; g.playerEntity.position.set(32.5, 21.05, 40.5); g._vy = 0; g._grounded = true; g.player.walkSpeed = 0; g.player.runSpeed = 0; g.player.jumpPower = 0; });
const c1 = await page.evaluate(() => window.__game.playerEntity.position.x);
await page.waitForTimeout(650);
const c2 = await page.evaluate(() => window.__game.playerEntity.position.x);
ok(`传送带按官方 velocity[-0.25,0,0] 推动玩家（Δx=${(c2 - c1).toFixed(3)}）`, Math.abs(c2 - c1) > 0.15, JSON.stringify({ c1, c2 }));

// 游泳状态
await page.evaluate(() => { const g = window.__game; g.player.cameraMode = "fps"; g.playerEntity.position.set(12.5, 24, 12.5); g._vy = 0; });
await page.waitForTimeout(500);
const swim = await page.evaluate(() => ({ ms: window.__game.player.moveState, ev: (window.__probe2.events || []).slice() }));
ok("水中 moveState 为官方值 swim", swim.ms === "swim", JSON.stringify(swim));
ok("world.onFluidEnter 已触发", (swim.ev || []).includes("enter"), JSON.stringify(swim.ev));

// 空气墙实心
await page.evaluate(() => { const g = window.__game; g.playerEntity.position.set(34.5, 21, 32.5); g._vy = 0; g.player.walkSpeed = 0.22; });
await page.keyboard.down("KeyD");
await page.waitForTimeout(900);
await page.keyboard.up("KeyD");
const barrier = await page.evaluate(() => window.__game.playerEntity.position.x);
ok(`屏障方块隐形但实心（停在 x=${barrier.toFixed(2)}，墙在 36）`, barrier < 35.8, "x=" + barrier);
const p2probe = await page.evaluate(() => window.__probe2 || {});
ok("弹跳/传送/流体/接触契约无失败", (p2probe.fail || []).length === 0, (p2probe.fail || []).join(" | "));
ok("world.onVoxelContact 有方块接触", !!p2probe.voxelContact, JSON.stringify(p2probe.voxelContact));

/* ---------------- 阶段 C：官方赛车模板脚本零改动可跑 ---------------- */
const gz = fs.readFileSync(new URL(`../server/data/worlds/${RACING_ID}.json.gz`, import.meta.url));
const seed = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
const raceScript = (seed.meta.scripts.find((s) => s.name === "index.js") || {}).code || "";
// 官方音效链：对象槽要真的出声并带衰减，占位 "audio/.mp3" 必须保持安静
const audioProbe = await page.evaluate(() => {
  const g = window.__game;
  const GR = g.constructor;
  const before = g._sounds.size;
  const ent = g.playerEntity;
  const str = g._playAt("audio/boost.mp3", ent.position);
  const obj = g._playAt({ sample: "audio/airhorn.mp3", gain: 0.5, radius: 8, pitch: 1.5 }, ent.position);
  const ph1 = g._playAt({ sample: "audio/.mp3", gain: 1 }, ent.position);
  const ph2 = g._playAt("", ent.position);
  const spec = GR.soundSpecOf({ sample: "audio/land.mp3", radius: 4, gain: 0.7 });
  const specBad = GR.soundSpecOf({ sample: "audio/.mp3" });
  return {
    strPlays: !!str && str.sample === "audio/boost.mp3",
    objPlays: !!obj && obj.gain <= 0.5 + 1e-9 && obj.radius === 8 && obj.pitch > 0,
    placeholdersSilent: ph1 === null && ph2 === null,
    grew: g._sounds.size >= before + 2,
    specKeepsParams: !!spec && spec.radius === 4 && spec.gain === 0.7 && !!spec.sample,
    placeholderNull: specBad === null,
  };
});
ok("字符串与官方对象两种声音 spec 都能播", audioProbe.strPlays && audioProbe.objPlays, JSON.stringify(audioProbe));
ok("占位 audio/.mp3 不发声", audioProbe.placeholdersSilent, JSON.stringify(audioProbe));
ok("radius/gain 落进 Sound 实例", audioProbe.specKeepsParams && audioProbe.grew, JSON.stringify(audioProbe));

// 官方语义修正：movementBounds 钳制、createEntity 复制、碰撞过滤器生效、say 不再触发 Chat、临时聊天可回环
const semProbe = await page.evaluate(async () => {
  const g = window.__game, w = g.world, p = g.player, ent = g.playerEntity;
  const out = {};
  // movementBounds：走到边界应当被夹住而不是重生
  const mb = p.movementBounds;
  if (mb) {
    const before = { x: ent.position.x, y: ent.position.y, z: ent.position.z };
    ent.position.set(mb.hi.x + 40, before.y, before.z);
    for (let i = 0; i < 8; i++) { g._last -= 320; g._frame(); }
    out.clamp = { inside: ent.position.x <= mb.hi.x + 1e-6, keptAlive: !p.dead, from: before.x, to: +ent.position.x.toFixed(2), hi: mb.hi.x };
  }
  // say 不得再 fire Chat（否则 onChat 回声脚本会栈溢出）
  let chats = 0;
  const tok = w.onChat(() => chats++);
  w.say("广播文本");
  out.sayNoChat = { chats, chatted: chats === 0 };
  if (tok && tok.cancel) tok.cancel();
  // createEntity(实体) 复制
  const a = w.createEntity({ position: [10, 40, 10], tags: ["克隆源"] });
  const b = w.createEntity(a);
  out.clone = { made: !!a && !!b, diffId: !!a && !!b && a.id !== b.id, hasTag: !!b && b.hasTag("克隆源"), samePos: !!a && !!b && Math.abs(a.position.x - b.position.x) < 1e-9 };
  // 碰撞过滤器真正参与判定
  const s1 = w.createEntity({ position: [60, 45, 60], bounds: [2, 2, 2], collision: true, tags: ["fa"] });
  const s2 = w.createEntity({ position: [62, 45, 60], bounds: [2, 2, 2], collision: true, tags: ["fb"] });
  g._rebuildSolids();
  const blockedBefore = g._solidsNear(62, 45, 60, 0.3, 1.8, s2).length;
  w.addCollisionFilter(".fa", ".fb");
  const blockedAfter = g._solidsNear(62, 45, 60, 0.3, 1.8, s2).length;
  out.filter = { blockedBefore, blockedAfter, filters: w.collisionFilters().length };
  w.clearCollisionFilters();
  // 临时聊天回环
  const id = await w.createTempChat(["u1"]);
  await w.addTempChatPlayer(id, ["u2", "u3"]);
  const users = await w.getTempChatUsers(id);
  const chats2 = await w.getTempChats();
  await w.removeTempChatPlayer(id, ["u2"]);
  const after = await w.getTempChatUsers(id);
  out.tempChat = { id: String(id), users: users.slice(), listed: chats2.length, afterRemove: after.slice(), unique: id !== "temp-1" };
  return out;
});
ok("movementBounds 越界被夹回界内而非重生", semProbe.clamp ? (semProbe.clamp.inside && semProbe.clamp.keptAlive) : true, JSON.stringify(semProbe.clamp));
ok("world.say 不再触发 onChat", semProbe.sayNoChat.chatted, JSON.stringify(semProbe.sayNoChat));
ok("createEntity(实体) 复制出新 id 并保留标签", semProbe.clone.made && semProbe.clone.diffId && semProbe.clone.hasTag, JSON.stringify(semProbe.clone));
ok("碰撞过滤器解除实体互挡", semProbe.filter.blockedBefore > 0 && semProbe.filter.blockedAfter === 0, JSON.stringify(semProbe.filter));
ok("临时聊天增删查回环一致", semProbe.tempChat.users.length === 3 && semProbe.tempChat.afterRemove.length === 2 && semProbe.tempChat.listed >= 1, JSON.stringify(semProbe.tempChat));

// 体素 API：批量写不能每格重建一次网格 / 响一次音；朝向只由 rotation 参数决定
const voxProbe = await page.evaluate(async () => {
  const g = window.__game, V = g._globals().voxels;
  const t0 = performance.now();
  let plays = 0;
  const orig = g._playAt.bind(g);
  g._playAt = (spec, pos) => { plays++; return orig(spec, pos); };
  for (let x = 2; x < 40; x++) for (let z = 2; z < 40; z++) V.setVoxel(x, 30, z, "stone");
  g._frame();
  const ms = performance.now() - t0;
  g._playAt = orig;
  V.setVoxel(5, 31, 5, "stone", 2);
  const rotFromArg = V.getVoxelRotation(5, 31, 5);
  V.setVoxel(6, 31, 6, V.getVoxelId(5, 31, 5));           // 传带旋转码的 id 但不给 rotation
  const rotIgnored = V.getVoxelRotation(6, 31, 6);
  const raw = V.getVoxel(6, 31, 6);
  let shapeLocked = true, typesLocked = true;
  try { V.shape.x = 999; shapeLocked = V.shape.x !== 999; } catch { shapeLocked = true; }
  try { V.VoxelTypes.push("hack"); typesLocked = V.VoxelTypes.indexOf("hack") < 0; } catch { typesLocked = true; }
  return { ms, plays, rotFromArg, rotIgnored, rawIsBase: raw === 5 || raw < 16384, shapeLocked, typesLocked };
});
ok(`体素批量写不逐格重建（1444 格 ${voxProbe.ms.toFixed(0)}ms）`, voxProbe.ms < 1500, JSON.stringify({ ms: +voxProbe.ms.toFixed(0) }));
ok("API 写方块不再逐格发声", voxProbe.plays === 0, JSON.stringify({ plays: voxProbe.plays }));
ok("rotation 参数决定朝向，id 内的旋转码被忽略", voxProbe.rotFromArg === 2 && voxProbe.rotIgnored === 0, JSON.stringify(voxProbe));
ok("voxels.shape / VoxelTypes 按官方只读", voxProbe.shapeLocked && voxProbe.typesLocked, JSON.stringify(voxProbe));

// 客户端面：Vec3 量程、默认值、渲染冻结、指针锁事件名、UI 点击不泄漏为玩家输入
const cliProbe = await page.evaluate(async () => {
  const cli = window.__game._client();
  const { Vec3, UiText, UiBox, UiScreen } = cli;
  const g = window.__game, r = g.e.renderer;
  const out = {};
  out.white255 = (() => { const v = Vec3.create({ r: 255, g: 0, b: 0 }); return v.x === 255 && v.r === 255; })();
  const t = UiText.create();
  out.defaults = { text: t.textContent, size: t.textFontSize, ax: t.textXAlignment, ay: t.textYAlignment, lh: t.textLineHeight };
  const box = UiBox.create();
  out.boxDefaults = { opacity: box.backgroundOpacity, z: box.zIndex };
  t.richText = true;
  t.textContent = 'A<font size="25" color="#F55505">B</font><b>X</b>';
  t._layout();
  const font = t.el.querySelector("span");
  out.rich = { fontApplied: !!font && font.style.fontSize === "25px" && /85, 85, 5|245/.test(font.style.color), bAsText: /X/.test(t.el.textContent) && !t.el.querySelector("b") };
  const scr = UiScreen.create();
  const n1 = UiScreen.getAllScreen().length;
  const c2 = scr.clone();
  out.screens = { before: n1, afterClone: UiScreen.getAllScreen().length, grew: UiScreen.getAllScreen().length === n1 + 1 };
  scr.parent = null; c2.parent = null;
  out.afterDetach = UiScreen.getAllScreen().length;
  cli.world.rendering3d = false;
  out.freeze = { paused: r._render3d === false, visible: !document.querySelector("canvas") || document.querySelector("canvas").style.visibility !== "hidden" };
  cli.world.rendering3d = true;
  out.resumed = r._render3d !== false;
  const names = [];
  cli.input.pointerLockEvents.on("pointerlockchange", (e) => names.push("change:" + (typeof e.isLocked)));
  document.dispatchEvent(new Event("pointerlockchange"));
  out.lockEvent = names.join(",") || "none";
  cli.input.pointerLockEvents.removeAll();
  out.scaleGuard = (() => { const b = UiBox.create(); const sc = cli.UiScale.create(b); const before = sc.scale; sc.scale = -1; return { kept: sc.scale === before, before }; })();
  return out;
});
ok("Vec3 支持官方 r/g/b 0-255 写法", cliProbe.white255, JSON.stringify(cliProbe.white255));
ok("UiText/UiBox 默认值对齐官方", cliProbe.defaults.text === "Text" && cliProbe.defaults.size === 14 && cliProbe.defaults.ax === "Center" && cliProbe.boxDefaults.opacity === 1 && cliProbe.boxDefaults.z === 1, JSON.stringify(cliProbe.defaults) + JSON.stringify(cliProbe.boxDefaults));
ok("richText 只放行 font 且属性生效", cliProbe.rich.fontApplied && cliProbe.rich.bAsText, JSON.stringify(cliProbe.rich));
ok("UiScreen.clone 登记、置空摘除", cliProbe.screens.grew && cliProbe.afterDetach === cliProbe.screens.before - 1, JSON.stringify(cliProbe.screens) + " after=" + cliProbe.afterDetach);
ok("rendering3d=false 冻结最后一帧而非隐藏画布", cliProbe.freeze.paused && cliProbe.freeze.visible && cliProbe.resumed, JSON.stringify(cliProbe.freeze) + " resumed=" + cliProbe.resumed);
ok("pointerLockEvents 用官方事件名与 isLocked 负载", cliProbe.lockEvent === "change:boolean", cliProbe.lockEvent);
ok("UiScale 拒绝负值", cliProbe.scaleGuard.kept, JSON.stringify(cliProbe.scaleGuard));

// 官方天气 / 光照参数必须真的改变渲染层状态（以前 22 个键写了没反应）
const envProbe = await page.evaluate(async () => {
  const g = window.__game, r = g.e.renderer, w = g.world;
  const { GameRGBColor, GameRGBAColor, GameVector3 } = window.__game.e.state ? await import("/js/gapi.js") : {};
  const snap = () => ({
    fogColor: r.scene.fog.color.getHexString(), fogNear: +r.scene.fog.near.toFixed(2), fogFar: Math.round(r.scene.fog.far),
    hemiSky: r.hemi.color.getHexString(), hemiGround: r.hemi.groundColor.getHexString(),
    fillColor: r.fill.color.getHexString(), fillInt: +r.fill.intensity.toFixed(3), amb: +r.ambient.intensity.toFixed(3),
    rainCol: r._rain ? r._rain.pts.material.color.getHexString() : null,
    rainSize: r._rain ? +r._rain.pts.material.size.toFixed(3) : null,
    rainN: r._rain ? r._rain.n : null,
    snowCol: r._snow ? r._snow.pts.material.color.getHexString() : null,
    snowSize: r._snow ? +r._snow.pts.material.size.toFixed(3) : null,
  });
  const changed = (a, b, keys) => keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const out = {};
  w.rainDensity = 0.9; w.snowDensity = 0.7;
  g._applyEnvironment();
  const base = snap();
  out.baseHasRain = base.rainN > 0;
  w.fogColor = new GameRGBColor(1, 0, 0); g._applyEnvironment();
  let s2 = snap(); out.fogColor = { diff: changed(base, s2, ["fogColor"]), hex: s2.fogColor };
  w.fogStartDistance = 6; w.fogUniformDensity = 0.02; g._applyEnvironment();
  s2 = snap(); out.fogGeom = { diff: changed(base, s2, ["fogNear", "fogFar"]), near: s2.fogNear, far: s2.fogFar };
  base.fogColor = s2.fogColor; base.fogNear = s2.fogNear; base.fogFar = s2.fogFar;
  w.skyLeftLight = new GameRGBColor(1, 0, 0); w.skyRightLight = new GameRGBColor(1, 0, 0);
  w.skyFrontLight = new GameRGBColor(1, 0, 0); w.skyBackLight = new GameRGBColor(1, 0, 0);
  g._applyEnvironment(); s2 = snap();
  out.skyFaces = { diff: changed(base, s2, ["fillColor", "fillInt"]), col: s2.fillColor, int: s2.fillInt };
  base.fillColor = s2.fillColor; base.fillInt = s2.fillInt;
  w.skyTopLight = new GameRGBColor(0, 1, 0); w.skyBottomLight = new GameRGBColor(0, 0, 1); g._applyEnvironment();
  s2 = snap(); out.skyTopBottom = { diff: changed(base, s2, ["hemiSky", "hemiGround"]), sky: s2.hemiSky, ground: s2.hemiGround };
  base.hemiSky = s2.hemiSky; base.hemiGround = s2.hemiGround;
  w.globalLight = 0.9; g._applyEnvironment(); s2 = snap();
  out.globalLight = { diff: changed(base, s2, ["amb"]), amb: s2.amb };
  base.amb = s2.amb;
  w.rainColor = new GameRGBAColor(0, 1, 0, 0.8); w.rainSizeLo = 0.5; g._applyEnvironment();
  s2 = snap(); out.rain = { diff: changed(base, s2, ["rainCol", "rainSize"]), col: s2.rainCol, size: s2.rainSize };
  base.rainCol = s2.rainCol; base.rainSize = s2.rainSize;
  w.rainDensity = 0.05; g._applyEnvironment(); s2 = snap();
  out.rainCountByDensity = { from: base.rainN, to: s2.rainN, fewer: s2.rainN < base.rainN };
  base.rainN = s2.rainN;
  w.snowColor = new GameRGBAColor(1, 0, 1, 1); w.snowSizeLo = 0.6; w.snowFallSpeed = 9; w.snowSpinSpeed = 3; g._applyEnvironment();
  s2 = snap(); out.snow = { diff: changed(base, s2, ["snowCol", "snowSize"]), col: s2.snowCol, size: s2.snowSize };
  out.wxConsumed = { fall: r.wx && r.wx.snowFallSpeed, spin: r.wx && r.wx.snowSpinSpeed, speed: r.wx && r.wx.rainSpeed };
  return out;
});
ok("官方雾色生效", (envProbe.fogColor.diff || []).includes("fogColor"), JSON.stringify(envProbe.fogColor));
ok("官方雾起始距离/密度生效", (envProbe.fogGeom.diff || []).length > 0, JSON.stringify(envProbe.fogGeom));
ok("左右前后四面天光生效", (envProbe.skyFaces.diff || []).length > 0, JSON.stringify(envProbe.skyFaces));
ok("天顶与天底光进半球灯", (envProbe.skyTopBottom.diff || []).length === 2, JSON.stringify(envProbe.skyTopBottom));
ok("globalLight 进环境光", (envProbe.globalLight.diff || []).includes("amb"), JSON.stringify(envProbe.globalLight));
ok("雨色与雨滴尺寸生效", (envProbe.rain.diff || []).length === 2, JSON.stringify(envProbe.rain));
ok("雨密度改变粒子数量", envProbe.rainCountByDensity.fewer, JSON.stringify(envProbe.rainCountByDensity));
ok("雪色与雪片尺寸生效", (envProbe.snow.diff || []).length === 2, JSON.stringify(envProbe.snow));
ok("雪下落/旋转速度与雨速被渲染层读取", envProbe.wxConsumed.fall === 9 && envProbe.wxConsumed.spin === 3, JSON.stringify(envProbe.wxConsumed));

ok("取到官方赛车模板 index.js", raceScript.length > 6000, "len=" + raceScript.length);
await page.goto(`${BASE}/edit/${RACING_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 120000 });
await page.evaluate(() => { window.__noAutosave = true; });
await page.waitForTimeout(4000);
await page.evaluate(() => window.__play());
await page.waitForFunction(() => !!(window.__game && window.__game.player), { timeout: 30000 });
await page.waitForTimeout(3500);
const race = await page.evaluate(() => {
  const g = window.__game;
  const con = document.getElementById("gameConsole");
  return {
    console: con ? con.textContent : "",
    walk: g.player.walkSpeed,
    pos: [g.playerEntity.position.x, g.playerEntity.position.y, g.playerEntity.position.z],
    invisible: g.player.invisible,
    entities: g.entities.length,
   报名: !!g.world.querySelector("#报名点"),
    检查点: g.world.querySelectorAll(".检查点").length,
    道具: g.world.querySelectorAll("#加速道具").length,
  };
});
const raceErrLines = (race.console || "").split("\n").filter((l) => l.includes("[index.js]"));
ok("赛车模板脚本运行成功且无运行时错误", (race.console || "").includes("脚本 index.js 运行成功") && raceErrLines.length === 0, raceErrLines.slice(0, 3).join(" | "));
ok("onPlayerJoin 生效：initUser 把速度设为官方 0.4（格/tick）", race.walk === 0.4, "walkSpeed=" + race.walk);
ok("initUser 已把玩家传送到报名点 (115,45,105)", Math.abs(race.pos[0] - 115) < 1.2 && Math.abs(race.pos[2] - 105) < 1.2, JSON.stringify(race.pos));
ok("#报名点 / .检查点 / #加速道具 实体可被官方选择器查到", race["报名"] && race["道具"] > 0, JSON.stringify({ e: race.entities, cp: race["检查点"], pr: race["道具"] }));
await page.screenshot({ path: OUT.pathname + "10-racing-official.png" });

// 报名并起跑：靠近报名点 → 交互 → 检查车辆 mesh 与速度覆盖
const started = await page.evaluate(async () => {
  const g = window.__game;
  const gate = g.world.querySelector("#报名点");
  g.playerEntity.position.set(gate.position.x, gate.position.y, gate.position.z + 1);
  g._tryInteract();
  await new Promise((r) => setTimeout(r, 5200));
  return { mesh: g.playerEntity.mesh, walk: g.player.walkSpeed, playing: g.playerEntity.playing, disabled: g.player.disableInputDirection, jump: g.player.jumpPower };
});
ok("报名后切换到赛车状态：车辆 mesh + 官方 1.5 速度 + 隐藏人物",
  String(started.mesh).includes("汽车模板") && started.walk === 1.5 && started.playing === true, JSON.stringify(started));
const consoleAfter = await page.evaluate(() => document.getElementById("gameConsole").textContent.split("\n").filter((l) => l.includes("[index.js]")).slice(0, 3));
ok("整段竞速逻辑运行无异常", consoleAfter.length === 0, consoleAfter.join(" | "));
await page.screenshot({ path: OUT.pathname + "11-racing-driving.png" });

// 实体材质属性必须「赋值即生效」：官方把 meshColor/metalness/emissive/shininess 归为显示类，
// 以前只有换 mesh 或改 scale 时才顺带刷一次材质，脚本单赋值看不到任何变化。
const matLive = await page.evaluate(() => {
  const g = window.__game;
  const num = (v) => (typeof v === "number" ? +v.toFixed(3) : null);
  const pick = (ent) => { let m = null; ent._meshHolder.traverse((o) => { if (!m && o.isMesh && o.material && !Array.isArray(o.material) && o.material.isMeshStandardMaterial) m = o.material; }); return m; };
  const ent = g.entities.find((e) => !e.destroyed && e._meshHolder && e._meshHolder.children.length && e !== g.playerEntity && pick(e));
  if (!ent) return { none: true };
  const out = { mesh: ent._meshName, standard: true };
  ent.meshColor = { red: 1, green: 0.5, blue: 0.25, alpha: 1 };
  ent.meshMetalness = 0.7; ent.meshShininess = 0.4; ent.meshEmissive = 2.5;
  const mt = pick(ent);
  out.after = {
    color: [num(mt.color.r), num(mt.color.g), num(mt.color.b)],
    metal: num(mt.metalness), rough: num(mt.roughness),
    emis: num(mt.emissiveIntensity), lit: num(mt.emissive.r + mt.emissive.g + mt.emissive.b),
  };
  ent.meshColor = { red: 1, green: 1, blue: 1, alpha: 1 };
  ent.meshMetalness = 0; ent.meshShininess = 0; ent.meshEmissive = 0;
  const back = pick(ent);
  out.restored = { metal: num(back.metalness), r: num(back.color.r) };
  return out;
});
ok(`实体 meshColor/metalness/shininess/emissive 赋值即时改到材质上（无需等下一帧）`,
  matLive.none === true || (matLive.standard === true && matLive.after.metal === 0.7 && matLive.after.rough === 0.6
    && matLive.after.emis === 2.5 && matLive.after.lit > 0.5 && matLive.after.color[1] === 0.5 && matLive.restored.metal === 0),
  JSON.stringify(matLive));

/* ---- 沙箱按端裁剪：两端注入的全局必须与各自 d.ts 一致 ---- */
const scope = await page.evaluate(() => {
  const g = window.__game;
  const srv = Object.keys(g._globals(false)), cli = Object.keys(g._globals(true));
  const has = (a, k) => a.includes(k);
  return {
    uiOnlyClient: has(cli, "ui") && has(cli, "input") && has(cli, "UiText") && !has(srv, "ui") && !has(srv, "UiText"),
    voxelsOnlyServer: has(srv, "voxels") && has(srv, "storage") && has(srv, "resources") && !has(cli, "voxels") && !has(cli, "storage"),
    typesSplit: has(srv, "GameVector3") && !has(cli, "GameVector3") && has(cli, "Vec3") && !has(srv, "Vec3")
      && has(cli, "ImageDisplayMode") && !has(srv, "ImageDisplayMode") && has(srv, "GameAssetType") && !has(cli, "GameAssetType"),
    callOnlyClient: has(cli, "call") && has(cli, "callAsync") && !has(srv, "call"),
    shared: ["world", "http", "remoteChannel", "sleep", "console", "Math", "JSON", "setTimeout"].every((k) => has(srv, k) && has(cli, k)),
    n: [srv.length, cli.length],
  };
});
ok(`脚本沙箱按端裁剪（服务端无 ui/Ui*/Vec3，客户端无 voxels/storage/Game*，共用面保留）`,
  scope.uiOnlyClient && scope.voxelsOnlyServer && scope.typesSplit && scope.callOnlyClient && scope.shared,
  JSON.stringify(scope));

/* ---- 项目包回环：player blob 必须是官方 41 键形状，本地扩展走 compat ---- */
const roundTrip = await page.evaluate(async () => {
  const io = await import("/js/io.js");
  const { readZipEntries } = await import("/js/zip.js");
  const e = window.__editor;
  const out = await io.exportProjectZip({ world: e.world, state: e.state, name: "回环", download: false });
  const z = await readZipEntries(new Uint8Array(await out.blob.arrayBuffer()));
  const read = async (re) => {
    const ent = z.entries.find((f) => re.test(f.name));
    return ent ? JSON.parse(new TextDecoder().decode(await z.extract(ent))) : null;
  };
  const p = await read(/project\/player\.json$/i);
  const compat = await read(/project\/compat\.json$/i);
  const imported = await io.importProjectZip(out.blob);
  const migrated = io.fromOfficialPlayer(p);
  return {
    n: Object.keys(p).length,
    local: Object.keys(p).filter((k) => /^_/.test(k) || ["canFly", "enableJump", "enableDoubleJump", "spectator", "cameraMode", "skin", "gamepad"].includes(k)),
    official: ["cameraType", "allowFlight", "noClip", "playerSounds", "sounds", "damage", "movementBounds", "initialPosition"].filter((k) => p[k] === undefined),
    sounds: Object.keys(p.playerSounds || {}).length, colorArray: Array.isArray(p.color),
    compatExtras: compat && compat.playerExtras ? Object.keys(compat.playerExtras) : [],
    reimported: Object.keys((imported.projectCfg || {}).player || {}).length,
    migrated: [migrated.cameraMode, migrated.canFly, migrated.spectator, !!migrated.playerSounds],
  };
});
ok(`导出的 player blob 是官方 41 键形状（无本地键、无内部名字，音效 14 槽、color 为数组）`,
  roundTrip.local.length === 0 && roundTrip.official.length === 0 && roundTrip.n <= 41
  && roundTrip.sounds === 14 && roundTrip.colorArray === true, JSON.stringify(roundTrip));
ok(`官方 blob 能翻回本地运行时名字，compat 带住 skin/gamepad 等本地扩展`,
  roundTrip.migrated[0] !== undefined && typeof roundTrip.migrated[1] === "boolean"
  && typeof roundTrip.migrated[2] === "boolean" && roundTrip.reimported > 0, JSON.stringify(roundTrip.migrated) + " " + JSON.stringify(roundTrip.compatExtras));

const runtimeErrs = errs.filter((e) => !/favicon|net::|Failed to load resource/.test(e));
ok("页面运行期无未捕获异常", runtimeErrs.length === 0, runtimeErrs.slice(0, 3).join(" | "));

await page.evaluate(() => window.__stopPlay());
await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) process.exitCode = 1;
