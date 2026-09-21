// e2e.mjs — 端到端回归测试（playwright-core + 本地缓存 chromium）
// 运行：node test/e2e.mjs
import fs from "fs";
import { fileURLToPath } from "url";
import { resolveChromium, chromeArgs, playwright } from "./browser.mjs";
const pw = await playwright();
if (!pw) { console.log("SKIP  找不到 playwright-core：设 PLAYWRIGHT_MODULE=/path/to/playwright-core 或先 npm i -D playwright-core"); process.exit(0); }

const EDITOR_URL = (process.env.BASE || "http://127.0.0.1:5173") + "/edit/216d665d3ca92bd1b9a2";
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
  ok("确认已记住(不再自动弹)", (await page.evaluate(() => localStorage.getItem("dao3_disclaimer_ack"))) === "1");
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
await shot("01-loaded");

console.log("== 手动生成 100×100 超平坦（验证尺寸弹窗） ==");
await page.evaluate(() => window.__openSizeModal && window.__openSizeModal());
await page.waitForFunction(() => !!document.getElementById("sizeModal") && document.getElementById("sizeModal").classList.contains("show"), { timeout: 8000 });
await page.click("#sizeOk");
await page.waitForTimeout(2500);
const blockCount = await page.evaluate(() => parseInt(document.getElementById("blockCount").textContent.replace(/,/g, "")));
ok("生成 100×100×5 平坦(约5w体素)", blockCount > 49000 && blockCount < 51000, blockCount);
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
const hasIndexFile = await page.evaluate(() => [...document.querySelectorAll("#scriptFiles .sfile")].some((e) => e.textContent.includes("index.js")));
ok("多文件列表含 index.js", hasIndexFile);
await page.click("#scriptExample");
await page.click("#scriptRun");
await page.waitForTimeout(1200);
const sOut = await page.evaluate(() => document.getElementById("scriptOut").textContent || "");
ok("沙箱脚本成功输出", sOut.includes("变更") || sOut.includes("完成"), sOut);
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
await browser.close();
console.log("== 测试完成（截图在 test/out/*.png） ==");