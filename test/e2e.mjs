// e2e.mjs — 端到端回归测试（playwright-core + 本地缓存 chromium）
// 运行：node test/e2e.mjs
import fs from "fs";
import { fileURLToPath } from "url";
import { resolveChromium, chromeArgs, playwright, resolveBase } from "./browser.mjs";
const pw = await playwright();
if (!pw) { console.log("SKIP  找不到 playwright-core：设 PLAYWRIGHT_MODULE=/path/to/playwright-core 或先 npm i -D playwright-core"); process.exit(0); }

const BASE = await resolveBase();
if (!BASE) { console.log("SKIP  没找到本项目在跑的本地服务：先 ./run.sh（或设 BASE=http://127.0.0.1:PORT）"); process.exit(0); }
const EDITOR_URL = BASE + "/edit/216d665d3ca92bd1b9a2";
// 中文目录名用 fileURLToPath 解码，避免 URL.pathname 的百分号编码
const OUT = fileURLToPath(new URL("./out/", import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const home = process.env.HOME;
const exe = resolveChromium();
if (!exe) { console.log("SKIP  找不到可用的 Chromium：设置 CHROME=/path/to/chrome 后重试"); process.exit(0); }

const browser = await pw.chromium.launch({
  executablePath: exe,
  headless: true,
  args: chromeArgs(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") jsErrors.push("console: " + m.text().slice(0, 300)); });

const ok = (name, cond, extra = "") => {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "   " + extra : ""));
  if (!cond) process.exitCode = 1;
};
const shot = async (name) => { try { await page.screenshot({ path: OUT + name + ".png" }); } catch (e) { console.log("SHOT-FAIL " + name + ": " + (e.message || e).slice(0, 150)); } };

console.log("== 打开编辑器（默认世界=赛车模板） ==");
await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 60000 });
await page.waitForTimeout(4000);

// 全新浏览器上下文 = 首次访问：免责声明是挡在编辑器前面的真门禁，
// 测试必须走过去（而不是塞 localStorage 绕开），否则后面每个点击都会被遮罩吃掉。
console.log("== 首次进入：免责声明门禁 ==");
const dcMask = page.locator(".dc-mask");
const prompted = await dcMask.isVisible().catch(() => false);
ok("首次进入弹免责声明", prompted);
if (prompted) {
  ok("未勾选时「进入」禁用", await page.locator(".dc-btn.ok").isDisabled());
  await page.check(".dc-check input");
  ok("勾选后「进入」可用", !(await page.locator(".dc-btn.ok").isDisabled()));
  await page.click(".dc-btn.ok");
  await page.waitForFunction(() => !document.querySelector(".dc-mask"), { timeout: 5000 }).catch(() => {});
  ok("确认后遮罩移除", (await page.locator(".dc-mask").count()) === 0);
  // 断言"记住了一次确认"，而不是记住版本号：disclaimer.js 在声明实质变化时会升 ACK_VER，
  // 写死 "1" 会让每次改文案都变成一条假故障。
  ok("确认已记住(写入版本号)", /^\d+$/.test(await page.evaluate(() => localStorage.getItem("dao3_disclaimer_ack")) || ""),
    await page.evaluate(() => localStorage.getItem("dao3_disclaimer_ack")));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 60000 });
  await page.waitForTimeout(3000);
  ok("重进后不重复打扰", (await page.locator(".dc-mask").count()) === 0);
  await page.evaluate(() => { window.__noAutosave = true; });
}

// 禁用本标签页的 30s 自动保存，避免测试世界覆盖磁盘上的种子世界
await page.evaluate(() => { window.__noAutosave = true; });
let errs = await page.evaluate(() => window.__errs || []);
ok("启动无 JS 错误", errs.length === 0, errs.slice(0, 3).join(" | "));
let cellCount = await page.evaluate(() => document.querySelectorAll("#blockLib .block").length);
ok("方块库渲染", cellCount > 30, cellCount + " cells");
const seedCount = await page.evaluate(() => parseInt(document.getElementById("blockCount").textContent.replace(/,/g, "")));
ok("默认世界为赛车模板(≈152万体素)", seedCount > 1300000, seedCount.toLocaleString());
ok("赛车脚本已载入(含 index.js)", (await page.evaluate(() => [...document.querySelectorAll("#scriptFiles .sfile")].map((e) => e.textContent).join(","))).includes("index.js"));
// 素材读不到时保存不能把实体清空：把 assetRoot 指到一个必然 404 的前缀、
// 清掉已缓存的网格后重走一次恢复，再问 collectEntities（保存就是用它算 meta.entities）。
const orphan = await page.evaluate(async () => {
  const E = window.__editor;
  const keepRoot = E.state.meta.assetRoot, keepMeshes = E.state.assets.meshes;
  E.state.meta.assetRoot = "/e2e-no-such-asset-dir/";
  E.state.assets.meshes = {};
  E.state.models = [];
  window.__replaceWorld(E.world);
  await new Promise((r) => setTimeout(r, 2500));
  const n = E.collectEntities().length;
  const left = E.state.entities.length;
  E.state.meta.assetRoot = keepRoot; E.state.assets.meshes = keepMeshes;
  return { n, left, models: E.state.models.length };
});
ok("资产 404 时未摆上的实体仍留在实体表里", orphan.left >= 199, `state.entities=${orphan.left} models=${orphan.models}`);
ok("资产 404 时保存仍保住 199 个实体", orphan.n >= 199, orphan.n + " 个");
await shot("01-loaded");

console.log("== 手动生成 100×100 超平坦（验证尺寸弹窗） ==");
await page.evaluate(() => window.__openSizeModal && window.__openSizeModal());
await page.waitForFunction(() => !!document.getElementById("sizeModal") && document.getElementById("sizeModal").classList.contains("show"), { timeout: 8000 });
await page.click("#sizeOk");
await page.waitForTimeout(2500);
const blockCount = await page.evaluate(() => parseInt(document.getElementById("blockCount").textContent.replace(/,/g, "")));
ok("生成 100×100×5 平坦(约5w体素)", blockCount > 49000 && blockCount < 51000, blockCount);
// 换图那一刻就要读脚本数：下面沙箱那节会自己往脚本表里加文件，事后再读就不是"新图"的状态了
const scriptsOnNewMap = await page.evaluate(() => (window.__editor.state.scripts || []).length);
await shot("02-flat-world");

console.log("== 第一人称编辑 ==");
await page.click("#fpEdit");
await page.waitForTimeout(400);
const fpOn = await page.evaluate(() => window.__editor.renderer.fpMode);
ok("FP 模式开启", fpOn === true);
await page.click("#fpEdit");
await page.waitForTimeout(300);
const fpOff = await page.evaluate(() => !window.__editor.renderer.fpMode);
ok("FP 模式关闭", fpOff === true);

console.log("== 脚本沙箱（sb 方块） ==");
await page.click('.mtab[data-menu="script"]');
await page.waitForFunction(() => document.getElementById("scriptScreen").classList.contains("show"), { timeout: 5000 });
// 新图不该继承旧图脚本（赛车模板的 index.js 会把 jumpPower 设成 0），
// 所以这里不借用地图自带的 index.js，而是走真实 UI 自己建两个文件。
ok("新建地图脚本表为空", scriptsOnNewMap === 0, scriptsOnNewMap + " 个");
await page.evaluate(() => { window.__editor.state.scripts.push({ name: "index.js", code: "" }, { name: "lib.js", code: "" }); });
await page.evaluate(() => window.__editor.refreshScriptFiles());
await page.evaluate(() => {
  const e = window.__editor;
  e.state.scripts[0].code = "let n=0; for (let x=0;x<6;x++) for (let y=0;y<6;y++) for (let z=0;z<6;z++){ sb.set(x,y+50,z,'stone'); n++; } console.log('完成，共 '+sb.count()+' 个体素');";
  e.__scriptIdx = 0;
  document.getElementById("scriptCode").value = e.state.scripts[0].code;
  document.getElementById("scriptCode").dispatchEvent(new Event("input"));
});
await page.waitForTimeout(300);
const fileNames = await page.evaluate(() => [...document.querySelectorAll("#scriptFiles .sfile")].map((x) => x.textContent.trim()));
ok("多文件列表含 index.js 与 lib.js", fileNames.some((t) => t.includes("index.js")) && fileNames.some((t) => t.includes("lib.js")), fileNames.join(","));
await page.click("#scriptRun");
await page.waitForTimeout(1200);
const sOut = await page.evaluate(() => document.getElementById("scriptOut").textContent || "");
ok("沙箱脚本成功输出", sOut.includes("完成"), sOut.slice(0, 80));
await shot("03-script");

console.log("== 运行模式（玩家出生在地图中心 + 脚本执行） ==");
await page.click('.mtab[data-menu="build"]'); // 从脚本界面返回搭建视图
await page.waitForTimeout(300);
await page.click("#btnPublish");
await page.waitForTimeout(2600);
const playing = await page.evaluate(() => {
  const pe = document.getElementById("playEntry");
  return { show: pe.classList.contains("show"), title: (document.getElementById("gameTitle") || {}).textContent, consoleText: (document.getElementById("gameConsole") || {}).textContent || "", cross: !!document.getElementById("gameCross").classList.value.includes("show") };
});
ok("运行 HUD 出现", playing.show === true, playing.title);
ok("准星显示", playing.cross);
const spawnPos = await page.evaluate(() => {
  if (!window.__game || !window.__game.playerEntity) return null;
  const p = window.__game.playerEntity.position;
  return [Math.round(p.x), Math.round(p.y * 10) / 10, Math.round(p.z)];
});
const claimedAtCenter = spawnPos && Math.abs(spawnPos[0] - 50) <= 2 && Math.abs(spawnPos[2] - 50) <= 2;
ok("出生点在地图中心 (50,*,50)", !!claimedAtCenter, spawnPos);
ok("脚本已载入提示", playing.consoleText.includes("已载入"), playing.consoleText.slice(0, 80));

// 跳跃：新建地图必须带着自己的脚本走。赛车模板的 index.js 有一句
// jumpPower = 0（官方把跳跃键改成吃加速道具），漏清就会渗进每一张新图，
// 表现为"按空格完全没反应"。这里在干净超平坦上真按一次空格量高度。
const jump = await page.evaluate(async () => {
  const g = window.__game;
  const y0 = g.playerEntity.position.y;
  g._jumpBuf = 0.14;
  const ys = [];
  for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 50)); ys.push(g.playerEntity.position.y); }
  return { jumpPower: g.player.jumpPower, rise: Math.max(...ys) - y0, scripts: (window.__editor.state.scripts || []).length };
});
ok("新建地图不继承旧图脚本", scriptsOnNewMap === 0, scriptsOnNewMap + " 个脚本");
ok("按空格真的跳起来", jump.jumpPower > 0 && jump.rise > 1.0, `jumpPower=${jump.jumpPower}  rise=${jump.rise.toFixed(2)} 格`);

// 角色外观：六个命名部件是对外契约（挂点/换肤/摆臂都靠它们），
// 且必须是有细节的部件组而不是六块居中盒子。
const look = await page.evaluate(() => {
  const av = window.__game.playerEntity._avatar;
  const parts = av.userData.parts;
  const names = Object.keys(parts);
  let meshes = 0, tintable = 0;
  av.traverse((m) => { if (m.isMesh) { meshes++; if (m.userData.tint) tintable++; } });
  // 肩宽必须撑得住头宽，否则是火柴人；腿要绕髋转而不是绕腿中心转
  const bb = (n) => parts[n].getWorldPosition({ x: 0, y: 0, z: 0 });
  return { names, meshes, tintable, groupParts: names.every((n) => parts[n].isGroup),
    shoulder: Math.abs(parts.armL.position.x - parts.armR.position.x),
    headW: parts.head.children[0] ? parts.head.children[0].geometry.parameters.width : 0 };
});
ok("六部件契约仍在且是关节 Group", look.groupParts
  && ["head", "body", "armL", "armR", "legL", "legR"].every((n) => look.names.includes(n)), look.names.join(","));
ok("角色有细节层次（不止六块盒子）", look.meshes >= 24 && look.tintable >= 8, `${look.meshes} 个子网格 / ${look.tintable} 个可染色`);
ok("肩宽撑得住头宽", look.shoulder > look.headW, `肩 ${look.shoulder.toFixed(2)} > 头宽 ${look.headW.toFixed(2)}`);
// player.color 官方默认 [1,1,1]＝不染色；旧实现直接 copy 会把上衣冲成灰白
const shirt = await page.evaluate(() => {
  const p = window.__game.playerEntity._avatar.userData.parts.body;
  let hex = null; p.traverse((m) => { if (m.isMesh && m.userData.tint === "cloth" && hex === null) hex = m.material.color.getHexString(); });
  return { hex, color: JSON.stringify(window.__game.player.color) };
});
ok("默认 player.color 不冲淡上衣原色", shirt.hex === "4a86c4", `player.color=${shirt.color} → 上衣 #${shirt.hex}`);
await shot("04-play");
await page.click("#gameStop");
await page.waitForTimeout(900);
const backToEditor = await page.evaluate(() => document.getElementById("playEntry").classList.contains("show") === false);
ok("停止运行返回编辑器", backToEditor);

console.log("== 导入赛车模板项目包 (.zip) ==");
const zipPath = process.env.RACING_ZIP || "";
const b64 = zipPath && fs.existsSync(zipPath) ? fs.readFileSync(zipPath).toString("base64") : "";
if (!b64) console.log("SKIP  未设 RACING_ZIP：赛车模板项目包导入这一段跳过（该 zip 不在仓库内）");
else {
  const importRes = await page.evaluate(async (b64str) => {
    const bin = atob(b64str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], "racing.zip", { type: "application/zip" });
    try { await window.__loadZip(file); return { ok: true }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, b64);
  ok("zip 导入成功", importRes.ok === true, importRes.err || "");
  await page.waitForTimeout(4000); // 1.5M 体素构建渲染
  const racingCount = await page.evaluate(() => parseInt(document.getElementById("blockCount").textContent.replace(/,/g, "")));
  ok("赛车世界加载(≈152万体素)", racingCount > 1300000, racingCount.toLocaleString());
  const racingScripts = await page.evaluate(() => [...document.querySelectorAll("#scriptFiles .sfile")].map((e) => e.textContent).join(","));
  ok("赛车脚本导入(含 index.js)", racingScripts.includes("index.js"), racingScripts);
  await shot("05-racing-import");

  console.log("== 运行赛车模板脚本 ==");
  await page.click("#btnPublish");
  await page.waitForTimeout(3500);
  const racePlay = await page.evaluate(() => {
    const c = document.getElementById("gameConsole").textContent || "";
    return { consoleText: c, spawnY: window.__game ? Math.round(window.__game.playerEntity.position.y) : -1, ti: document.getElementById("gameTitle").textContent };
  });
  ok("赛车脚本载入并运行", racePlay.consoleText.includes("已载入"), racePlay.consoleText.slice(0, 120));
  ok("玩家在地图上空出生（y≈地面+1）", racePlay.spawnY > 40 && racePlay.spawnY < 70, "y=" + racePlay.spawnY);
  await shot("06-racing-play");
}

// 检查运行中是否产生未捕获异常
errs = await page.evaluate(() => ({ errs: (window.__errs || []).length, list: (window.__errs || []).slice(0, 3) }));
ok("运行赛车无未捕获异常", errs.errs === 0, JSON.stringify(errs.list));

// 只有走了赛车那一段才可能还停在运行模式；SKIP 时早已返回编辑器，按钮不可见
if (await page.locator("#gameStop").isVisible().catch(() => false)) {
  await page.click("#gameStop");
  await page.waitForTimeout(600);
}
console.log("== 返回主界面：每个页面都要出得去 ==");
const HOME = BASE + "/";
// 编辑器：顶栏按钮，且未保存的改动必须先落盘
await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.getElementById("loading"), { timeout: 60000 });
await page.waitForTimeout(2500);
ok("编辑器顶栏有返回主界面按钮", await page.locator("#btnHome").isVisible());
ok("文件菜单第一项是返回主界面",
  (await page.evaluate(() => {
    document.getElementById("menuLogo").click();
    return [...document.querySelectorAll(".tb-left .worldlist .witem b")].map((b) => b.textContent)[0];
  })).includes("返回主界面"));
await page.evaluate(() => { window.__editor.state.dirty = true; });
await page.click("#btnHome");
await page.waitForURL(HOME, { timeout: 15000 });
ok("编辑器可返回工作台", page.url() === HOME, page.url());
ok("返回前脏状态已存盘（世界 API 仍读得到 199 实体）",
  await page.evaluate(async () => {
    const r = await fetch("/api/world/216d665d3ca92bd1b9a2").then((x) => x.json());
    return (r.meta?.entities || []).length === 199;
  }));

// VOXA：品牌位与菜单都要能回
await page.goto(BASE + "/voxa", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
ok("VOXA 品牌位是返回链接", await page.locator("a.vx-brand[href='/']").isVisible());
await page.click("#vxMenu");
await page.waitForTimeout(200);
ok("VOXA 菜单有返回主界面", await page.locator('#vxMenuPanel [data-act="home"]').isVisible());
await page.click('#vxMenuPanel [data-act="home"]');
await page.waitForURL(HOME, { timeout: 15000 });
ok("VOXA 可返回工作台", page.url() === HOME, page.url());

// 文档站：本地服务里要露出返回入口
await page.goto(BASE + "/docs/", { waitUntil: "load" });
await page.waitForTimeout(800);
ok("文档站有返回工作台且本地可见", await page.locator(".nav .home").isVisible());
await page.click(".nav .home");
await page.waitForURL(HOME, { timeout: 15000 });
ok("文档站可返回工作台", page.url() === HOME, page.url());

await browser.close();
console.log("== 测试完成（截图在 test/out/*.png） ==");