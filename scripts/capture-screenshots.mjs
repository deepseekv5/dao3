// scripts/capture-screenshots.mjs — 为文档站/官网抓取**真实**产品截图。
//
// 为什么用脚本而不是手拍：文档里的图必须和当前代码一致。改了 UI 之后重跑一次，
// 站点截图就跟着更新，不会出现"文档还是上个月的界面"。
//
// 用法：先起服务（npm start），再
//   BASE=http://127.0.0.1:5321 node scripts/capture-screenshots.mjs
// 找不到 playwright-core 时整套 SKIP 并给出提示（运行时零依赖，测试/截图工具是可选的）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromium, chromeArgs, playwright } from "../test/browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://127.0.0.1:5321";
const OUT = path.join(ROOT, "docs/img");
const RACING = "216d665d3ca92bd1b9a2";
const W = Number(process.env.SHOT_W || 1440), H = Number(process.env.SHOT_H || 900);

fs.mkdirSync(OUT, { recursive: true });
const exe = resolveChromium();
const pw = await playwright();
if (!exe || !pw) {
  console.log("SKIP  截图需要 Chromium 与 playwright-core。");
  console.log("      npm i -D playwright-core && npx playwright install chromium");
  console.log("      或设 CHROME=/path/to/chrome 与 PLAYWRIGHT_MODULE=/path/to/playwright-core");
  process.exit(0);
}
const { chromium } = pw;
const browser = await chromium.launch({ executablePath: exe, args: chromeArgs() });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
// 免责声明只确认一次；__noAutosave 保证截图过程绝不写回地图存档
await ctx.addInitScript(() => {
  try { localStorage.setItem("dao3_disclaimer_ack", "1"); } catch {}
  window.__noAutosave = true;
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));

const shots = [];
// DPR2 拍出来是 2880×1800，而站内最大显示宽度只有 1126px —— 超采样 2.5 倍，
// 光图片就给 Pages 压上 5MB。拍完在浏览器里降采样回 1440 宽再落盘：
// 显示尺寸下仍是 1.3x 超采样，肉眼不掉清晰度，体积降一半以上。零依赖。
const MAX_W = 1440;
async function downscale(file) {
  const b64 = fs.readFileSync(file).toString("base64");
  // evaluate 里跑的是浏览器上下文，看不到 Node 侧的 MAX_W，必须当参数传进去
  const out = await page.evaluate(async ([src, maxW]) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + src; });
    if (img.naturalWidth <= maxW) return null;
    const w = maxW, h = Math.round(img.naturalHeight * (maxW / img.naturalWidth));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = "high";
    cx.drawImage(img, 0, 0, w, h);
    // 不能直接回传 ArrayBuffer：过 evaluate 边界会被序列化成普通对象。转 base64 字符串。
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, [b64, MAX_W]);
  if (out) fs.writeFileSync(file, Buffer.from(out, "base64"));
}
async function shot(name, opts = {}) {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, fullPage: !!opts.full });
  const raw = fs.statSync(file).size;
  await downscale(file);
  const kb = +(fs.statSync(file).size / 1024).toFixed(0);
  shots.push({ name, kb });
  console.log(`  ✓ ${name}.png  ${kb}KB${raw !== fs.statSync(file).size ? `（原 ${+(raw / 1024).toFixed(0)}KB）` : ""}`);
}
const click = async (sel, wait = 900) => {
  const el = await page.waitForSelector(sel, { timeout: 20000 }).catch(() => null);
  if (!el) { console.log(`  ! 选择器没等到: ${sel}`); return false; }
  await el.click().catch(() => {});
  await page.waitForTimeout(wait);
  return true;
};
const waitEditor = () => page.waitForFunction(() => !document.getElementById("loading") && window.__editor, null, { timeout: 90000 });

console.log("▸ 工作台");
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#worldGrid tbody tr").length > 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(700);
await shot("workbench");

console.log("▸ 编辑器 · 搭建（官方赛车模板）");
await page.goto(`${BASE}/edit/${RACING}`, { waitUntil: "domcontentloaded" });
await waitEditor();
await page.waitForTimeout(2600);
await shot("editor-build");

console.log("▸ 编辑器 · 方块库（元素截图）");
{
  const el = await page.waitForSelector("#libCard", { timeout: 15000 }).catch(() => null);
  if (el) {
    const file = path.join(OUT, "block-library.png");
    await el.screenshot({ path: file });
    shots.push({ name: "block-library", kb: +(fs.statSync(file).size / 1024).toFixed(0) });
    console.log("  ✓ block-library.png（卡片）");
  } else console.log("  ! 没有 #libCard");
}

console.log("▸ 编辑器 · 模型属性");
await click('.mtab[data-menu="model"]', 1400);
await shot("editor-model");

console.log("▸ 编辑器 · 脚本");
await click('.mtab[data-menu="script"]', 1200);
await shot("editor-script");

console.log("▸ 编辑器 · 界面编辑器");
await click('.mtab[data-menu="ui"]', 1200);
await shot("editor-ui");

console.log("▸ 编辑器 · 玩家设置");
await click('.mtab[data-menu="player"]', 900);
await page.evaluate(() => { const b = document.querySelector("#playerPanel .modal-box"); if (b) b.scrollTop = 0; });
await page.waitForTimeout(300);
await shot("editor-player");
await click('#playerPanel #plOk', 500);
await click('.mtab[data-menu="build"]', 600);

console.log("▸ 运行模式（第三人称）");
await page.evaluate(() => { window.__editor.markDirty(); window.__editor.enterPlay(); });
await page.waitForFunction(() => !!(window.__game && window.__game.running), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
// 走到赛道上再拍，避免人物悬在出生点空转
await page.evaluate(() => {
  const g = window.__game;
  if (g && g.playerEntity) g.playerEntity.position.set(118, 45, 118);
});
await page.waitForTimeout(1400);
await shot("editor-run");

console.log("▸ 运行模式 · 商店面板（临时塞两条商品，拍完还原）");
await page.evaluate(() => {
  const m = window.__editor.state.meta;
  window.__savedProducts = m.products;
  m.products = [
    { id: "p1", productId: 1001, name: "氮气加速", price: 120, currency: "金币", enabled: true, limited: 3 },
    { id: "p2", productId: 1002, name: "涂装 · 烈焰", price: 480, currency: "金币", enabled: true },
  ];
});
await page.evaluate(() => window.__game && window.__game._toggleStore && window.__game._toggleStore(true));
await page.waitForTimeout(800);
await shot("run-store");
await page.evaluate(() => {
  window.__game && window.__game._toggleStore && window.__game._toggleStore(false);
  const m = window.__editor.state.meta;
  if (window.__savedProducts === undefined) delete m.products; else m.products = window.__savedProducts;
});

await page.evaluate(() => window.__editor.stopPlay && window.__editor.stopPlay());
await page.waitForTimeout(900);

console.log("▸ VOXA 体素建模");
await page.goto(BASE + "/voxa", { waitUntil: "load" });
await page.waitForTimeout(2600);
await shot("voxa");

await browser.close();
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  base: BASE, viewport: { width: W, height: H }, scale: 2,
  captured: new Date().toISOString(), shots, pageErrors: errs.slice(0, 5),
}, null, 1));
console.log(`\n完成：${shots.length} 张真实截图 → docs/img/` + (errs.length ? `  （页面报错 ${errs.length} 条）` : "  （无页面报错）"));
