// player-modal.mjs — 「玩家 → 项目皮肤库 / 虚拟按键」两个弹窗的最小结构验证。
// 运行：node test/player-modal.mjs
//   服务没起就先起：node start.mjs --no-open --port=5180 --host=127.0.0.1
//   可用 BASE=http://127.0.0.1:PORT 覆盖地址。
// 只开面板、只改内存里的 meta，__noAutosave 全程生效：这个脚本绝不写地图存档。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChromium, chromeArgs, playwright } from "./browser.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://127.0.0.1:5180";
// 用一个不存在的地图 id：服务端 404 → 前端拿空世界，磁盘上不会多出任何文件
const WORLD = "pmtest" + Date.now().toString(36);

const pw = await playwright();
const exe = resolveChromium();
if (!exe) { console.log("SKIP  找不到可用的 Chromium：设置 CHROME=/path/to/chrome 后重试"); process.exit(0); }
if (!pw) { console.log("SKIP  找不到 playwright-core：设 PLAYWRIGHT_MODULE=/path/to/playwright-core 或先 npm i -D playwright-core"); process.exit(0); }
// 免责声明的版本号从 disclaimer.js 读，不写死：写死了 ACK_VER 一升级，
// 整轮断言就全跑在那张遮罩上（capture-screenshots.mjs 踩过一次）。
const ACK = (/const\s+ACK_VER\s*=\s*["']([^"']+)["']/.exec(
  fs.readFileSync(path.join(ROOT, "public/js/disclaimer.js"), "utf8")) || [])[1];
if (!ACK) { console.error("FAIL  读不到 public/js/disclaimer.js 里的 ACK_VER，拒绝跑（否则遮罩会盖住整个编辑器）"); process.exit(1); }

const browser = await pw.chromium.launch({ executablePath: exe, headless: true, args: chromeArgs() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((ver) => {
  try {
    localStorage.setItem("dao3_disclaimer_ack", ver);
    localStorage.setItem("dao3.floatControls", "1");
    sessionStorage.setItem("dao3_no_autosave", "1");
  } catch {}
  window.__noAutosave = true;
}, ACK);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "   " + extra : "")); }
};
const evalIn = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE}/edit/${WORLD}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__editor && window.__editor.state, null, { timeout: 60000 });
ok("编辑器已就绪（未被免责声明遮罩挡住）", await evalIn(() => !document.querySelector(".dc-mask")));

await page.waitForTimeout(1200);
// 卡片定位：皮肤名是用户输入的一坨尖括号，选择器里塞不进去，只能按名字子串过滤
const cardWith = (sub) => page.locator(".pm-card").filter({ has: page.locator(".pm-card-name", { hasText: sub }) }).first();

/* ---------------- 界面 A：项目皮肤库 ---------------- */
await evalIn(async () => {
  const m = await import("/js/panels/skins.js");
  await m.openSkinLibrary(window.__editor);
});
await page.waitForSelector(".pm-mask.show", { timeout: 15000 });

const box = await page.locator(".pm-box").boundingBox();
ok("弹窗外壳尺寸接近官方 1180×760", box && box.width >= 1100 && box.height >= 640, JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));
ok("player-modal.css 已注入（弹窗底色 #1b1f27）",
  await evalIn(() => getComputedStyle(document.querySelector(".pm-box")).backgroundColor === "rgb(27, 31, 39)"));
ok("左栏标题「玩家」", (await page.locator(".pm-nav-title").textContent()) === "玩家");
ok("左栏三节齐全（属性 / 皮肤库 / 按键）", await page.locator(".pm-nav-item").count() === 3,
  await evalIn(() => [...document.querySelectorAll(".pm-nav-item")].map((b) => b.textContent).join("|")));
ok("「项目皮肤库」为选中态", await page.locator('.pm-nav-item[data-key="skins"].active').count() === 1);
ok("选中项有 2px 亮橙左竖条", await evalIn(() => {
  const el = document.querySelector('.pm-nav-item[data-key="skins"]');
  const cs = getComputedStyle(el);
  return cs.borderLeftWidth === "2px" && /252,\s*131,\s*8/.test(cs.borderLeftColor);
}));
ok("导航项带线性图标", await evalIn(() => !!document.querySelector('.pm-nav-item svg[stroke="currentColor"]')));
ok("右栏标题「项目皮肤库」", (await page.locator(".pm-content .pm-h").first().textContent()) === "项目皮肤库");
for (const [name, sel] of [["创建皮肤按钮", '.pm-toolbar .pm-btn:has-text("创建皮肤")'], ["从素材库导入按钮", '.pm-toolbar .pm-btn:has-text("从素材库导入")'],
  ["排序图标按钮", ".pm-toolbar .pm-iconbtn"], ["排序下拉", ".pm-toolbar .pm-select"], ["搜索框", ".pm-toolbar .pm-search"]]) {
  ok("工具条 · " + name, await page.locator(sel).count() === 1);
}
ok("排序下拉默认项是「最近编辑」", await evalIn(() => {
  const s = document.querySelector(".pm-select");
  return [...s.options].map((o) => o.textContent).join(",") === "最近编辑,创建时间,名称" && /最近编辑/.test(s.selectedOptions[0].textContent);
}));

const cards = () => page.locator(".pm-card");
ok("卡片网格有内容", await cards().count() >= 1, "实际 " + (await cards().count()) + " 张");
ok("卡片预览是离屏 3D 渲染出来的图", await evalIn(() => {
  const src = document.querySelector(".pm-card-preview")?.src || "";
  return src.startsWith("data:image/png") && src.length > 4000;
}), await evalIn(() => (document.querySelector(".pm-card-preview")?.src || "").slice(0, 24)));
ok("默认皮肤卡片带「本图默认皮肤」角标", (await page.locator(".pm-card-badge").first().textContent()) === "本图默认皮肤");
ok("卡片有 ⋮ 菜单按钮与左下角名字", await page.locator(".pm-card-more").count() >= 1 && await page.locator(".pm-card-name").count() >= 1);
ok("皮肤数据落在 meta.skins（跟着世界存盘）", await evalIn(() => Array.isArray(window.__editor.state.meta.skins)
  && Object.keys(window.__editor.state.meta.skins[0].skin).sort().join(",") === "armL,armR,body,head,legL,legR"));

// 建皮肤表单 + 用户输入不许进 innerHTML
const NASTY = '<img src=x onerror="window.__xss=1">坤哥';
await page.locator('.pm-toolbar .pm-btn:has-text("创建皮肤")').click();
await page.waitForSelector(".pm-sub-mask", { timeout: 5000 });
ok("创建皮肤表单：名称 + 六块配色", await page.locator(".pm-field").count() === 7
  && await page.locator('.pm-input[type="color"]').count() === 6);
ok("创建皮肤表单有实时 3D 预览", await evalIn(() => (document.querySelector(".pm-form-preview")?.src || "").startsWith("data:image/png")));
await page.fill(".pm-sub-mask .pm-input[type=text]", NASTY);
// 取色器一律用 JS 写值 + 派发 input：page.fill 对 input[type=color] 的行为不可靠
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.pm-sub-mask .pm-input[type="color"]')];
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
  set(inputs[0], "#ff2d55"); set(inputs[1], "#12c48b"); set(inputs[4], "#2b6bff");
});
await page.waitForTimeout(120);
await page.locator('.pm-dialog-actions .pm-btn.primary').click();
await page.waitForSelector(".pm-sub-mask", { state: "detached", timeout: 5000 });
ok("新建的皮肤进了卡片列表", await cards().count() === 2);
ok("皮肤名按纯文本渲染（无 innerHTML 注入）", await evalIn((nasty) => {
  const names = [...document.querySelectorAll(".pm-card-name")].map((n) => n.textContent);
  return names.includes(nasty) && !document.querySelector(".pm-card-name img") && window.__xss === undefined;
}, NASTY));
await page.locator('.pm-nav-item[data-key="skins"]').click();
await page.waitForTimeout(250);
const urls = await evalIn(() => [...document.querySelectorAll(".pm-card-preview")].map((i) => i.src));
ok("不同配色的卡片预览图确实不同（头发/衣服看得出差别）", new Set(urls).size === urls.length && urls.length >= 2);

// ⋮ 菜单：设为本图默认 / 重命名 / 删除
await cardWith("坤哥").locator(".pm-card-more").click();
await page.waitForSelector(".pm-pop", { timeout: 5000 });
ok("⋮ 菜单三项齐全", await evalIn(() => [...document.querySelectorAll(".pm-pop-item")].map((b) => b.textContent).join("|")) === "设为本图默认|重命名|删除");
await page.locator('.pm-pop-item:has-text("设为本图默认")').click();
await page.waitForTimeout(300);
ok("设为本图默认后角标换到该卡片", await evalIn(() => {
  const hit = [...document.querySelectorAll(".pm-card")].find((c) => c.querySelector(".pm-card-badge"));
  return !!hit && /坤哥/.test(hit.querySelector(".pm-card-name").textContent);
}));
ok("皮肤写回 meta.player.skin 用的是运行时认得的颜色字符串", await evalIn(() => {
  const s = window.__editor.state.meta.player.skin || {};
  return /^#[0-9a-f]{6}$/i.test(String(s.head)) && /^#[0-9a-f]{6}$/i.test(String(s.leftUpperArm)) && Object.keys(s).length >= 18;
}));
// 重命名走同一个表单
await cardWith("坤哥").locator(".pm-card-more").click();
await page.waitForSelector(".pm-pop", { timeout: 5000 });
await page.locator('.pm-pop-item:has-text("重命名")').click();
await page.waitForSelector(".pm-sub-mask", { timeout: 5000 });
await page.fill(".pm-sub-mask .pm-input[type=text]", "屑坤哥");
await page.locator('.pm-dialog-actions .pm-btn.primary').click();
await page.waitForTimeout(250);
ok("重命名生效且角标没丢", await cardWith("屑坤哥").count() === 1
  && await cardWith("屑坤哥").locator(".pm-card-badge").count() === 1);
// 搜索过滤
await page.fill(".pm-search", "不存在的名字zzz");
await page.waitForTimeout(200);
ok("搜索框会过滤卡片", await cards().count() === 0 && await page.locator(".pm-empty").count() === 1);
await page.fill(".pm-search", "");
await page.waitForTimeout(200);
// 删除
await cardWith("屑坤哥").locator(".pm-card-more").click();
await page.waitForSelector(".pm-pop", { timeout: 5000 });
await page.locator('.pm-pop-item:has-text("删除")').click();
await page.waitForTimeout(300);
ok("删除后回到 1 张卡片", await cards().count() === 1);
ok("删除后仍有且仅有一张默认皮肤", await page.locator(".pm-card-badge").count() === 1);

// 从素材库导入：有 VOXA 模型就建卡，没有就把原因写在提示条里——两条路都不许静默
const beforeImport = await cards().count();
await page.locator('.pm-toolbar .pm-btn:has-text("从素材库导入")').click();
await page.waitForTimeout(1500);
const listed = await page.locator(".pm-list-item").count();
if (listed) {
  ok("素材库列表列出了 VOXA 模型", listed >= 1, String(listed));
  await page.locator(".pm-list-item").first().click();
  await page.waitForTimeout(1500);
}
ok("导入要么多出卡片、要么给出原因（不静默）", await cards().count() > beforeImport
  || (await evalIn(() => document.querySelector(".pm-notice").textContent)).trim().length > 0,
  await evalIn(() => document.querySelector(".pm-notice").textContent));

/* ---------------- 界面 B：虚拟按键 ---------------- */
await page.locator('.pm-nav-item[data-key="gamepad"]').click();
await page.waitForSelector(".pm-stage", { timeout: 15000 });
ok("切到虚拟按键后导航选中态同步", await page.locator('.pm-nav-item[data-key="gamepad"].active').count() === 1
  && await page.locator('.pm-nav-item[data-key="skins"].active').count() === 0);
ok("右栏标题「虚拟按键」+ ⓘ 说明图标", await evalIn(() => {
  const h = document.querySelector(".pm-content .pm-h");
  return h.querySelector("span").textContent === "虚拟按键" && !!h.querySelector(".pm-info");
}));
const stageBox = await page.locator(".pm-stage").boundingBox();
ok("预览区约 16:9", stageBox && Math.abs(stageBox.width / stageBox.height - 16 / 9) < 0.25,
  stageBox && `${Math.round(stageBox.width)}×${Math.round(stageBox.height)}`);
ok("预览区叠在真实画面上（抓到视口快照或有占位底）", await evalIn(() => {
  const el = document.querySelector(".pm-stage");
  return el.style.backgroundImage.startsWith("url(") || el.classList.contains("no-frame");
}));
ok("胶囊两段切换：步行状态 | 飞行状态", await evalIn(() => {
  const items = [...document.querySelectorAll(".pm-seg-item")];
  return items.map((i) => i.textContent).join("|") === "步行状态|飞行状态" && items[0].classList.contains("active");
}));
ok("当前段下方有橙色短下划线", await evalIn(() => {
  const cs = getComputedStyle(document.querySelector(".pm-seg-item.active"), "::after");
  return cs.backgroundColor === "rgb(252, 131, 8)" && cs.height === "2px";
}));
ok("摇杆在左下，含圆心白点与四向箭头", await evalIn(() => {
  const joy = document.querySelector('.pm-pad-btn[data-id="joystick"]');
  if (!joy) return false;
  const r = joy.getBoundingClientRect(), s = document.querySelector(".pm-stage").getBoundingClientRect();
  return joy.querySelector(".pm-knob") && joy.querySelectorAll(".pm-arrow").length === 4
    && (r.left - s.left) / s.width < 0.2 && (r.top - s.top) / s.height > 0.4;
}));
const walkIds = await evalIn(() => [...document.querySelectorAll(".pm-pad-btn")].map((b) => b.dataset.id).sort().join(","));
// jump 必须在默认步行布局里：漏掉等于给玩家一套不能跳的手柄
ok("步行状态按钮集合：摇杆/蹲/跑/跳/A/B", walkIds === "actionA,actionB,crouch,joystick,jump,run", walkIds);
ok("A / B 圆键显示字母，蹲/跑/飞是线性图标", await evalIn(() => {
  const txt = (id) => document.querySelector(`.pm-pad-btn[data-id="${id}"]`)?.textContent.trim();
  const hasSvg = (id) => !!document.querySelector(`.pm-pad-btn[data-id="${id}"] svg`);
  return txt("actionA") === "A" && txt("actionB") === "B" && hasSvg("crouch") && hasSvg("run");
}));

await page.locator('.pm-seg-item[data-state="fly"]').click();
await page.waitForTimeout(200);
const flyIds = await evalIn(() => [...document.querySelectorAll(".pm-pad-btn")].map((b) => b.dataset.id).sort().join(","));
ok("飞行状态换成另一套按钮（有飞行/降落键）", flyIds !== walkIds && flyIds.includes("flyButton"), flyIds);
ok("羽毛图标存在", await evalIn(() => !!document.querySelector('.pm-pad-btn[data-id="flyButton"] svg path')));

// 拖拽改位置并记住
await evalIn(() => [...document.querySelectorAll(".pm-pad-btn")].map((b) => [b.dataset.id, b.style.left + "/" + b.style.top]));
const before = await evalIn(() => window.__editor.state.meta.gamepadLayout.fly.find((i) => i.id === "actionA"));
const btn = page.locator('.pm-pad-btn[data-id="actionA"]');
const bb = await btn.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 - 150, bb.y + bb.height / 2 - 60, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(200);
const after = await evalIn(() => window.__editor.state.meta.gamepadLayout.fly.find((i) => i.id === "actionA"));
ok("按钮可拖拽，位置写回 meta.gamepadLayout", after.x < before.x - 8 && after.y < before.y - 8,
  JSON.stringify({ before, after }));
ok("拖完标脏（跟着世界存盘）", await evalIn(() => window.__editor.state.dirty === true));
ok("拖拽范围被夹在预览区内", await evalIn(() => {
  const s = document.querySelector(".pm-stage").getBoundingClientRect();
  return [...document.querySelectorAll(".pm-pad-btn")].every((b) => {
    const r = b.getBoundingClientRect();
    return r.left >= s.left - 1 && r.top >= s.top - 1 && r.right <= s.right + 1 && r.bottom <= s.bottom + 1;
  });
}));

// 与现有实现打通：meta.player.gamepad 是「玩家」面板已经在写的图标图槽（图片路径）
await evalIn(() => {
  const p = window.__editor.state.meta.player;
  p.gamepad = Object.assign({}, p.gamepad, { actionA: "/img/arena.svg", actionB: "picture/根本不存在的图.png" });
});
await page.locator('.pm-nav-item[data-key="skins"]').click();
await page.locator('.pm-nav-item[data-key="gamepad"]').click();
await page.waitForTimeout(900);
ok("读现有 meta.player.gamepad 图槽：有图贴图，图取不到就退回默认图标", await evalIn(() => {
  const a = document.querySelector('.pm-pad-btn[data-id="actionA"]');
  const b = document.querySelector('.pm-pad-btn[data-id="actionB"]');
  return a.classList.contains("has-icon") && !!a.querySelector("img.pm-pad-icon")
    && !b.classList.contains("has-icon") && !b.querySelector("img.pm-pad-icon");
}));

// 关掉重开：布局要还在，步行那套不受影响
await page.locator(".pm-close").click();
await page.waitForTimeout(200);
ok("✕ 能关闭弹窗", await evalIn(() => !document.querySelector(".pm-mask").classList.contains("show")));
await evalIn(async () => (await import("/js/panels/gamepad.js")).openGamepadEditor(window.__editor));
await page.waitForSelector(".pm-mask.show", { timeout: 15000 });
const kept = await evalIn(() => window.__editor.state.meta.gamepadLayout.fly.find((i) => i.id === "actionA"));
ok("重开后拖过的位置还在", Math.abs(kept.x - after.x) < 0.01 && Math.abs(kept.y - after.y) < 0.01);
ok("默认回到步行状态，且这套布局没被飞行态拖拽污染", await evalIn(() => {
  const walk = window.__editor.state.meta.gamepadLayout.walk.map((i) => i.id).sort().join(",");
  return document.querySelector('.pm-seg-item[data-state="walk"]').classList.contains("active")
    && walk === "actionA,actionB,crouch,joystick,jump,run";
}));

/* ---------------- 界面 C：运行时真的读这两个面板写下的东西 ----------------
   面板做完了不代表功能有了：皮肤库写 meta.player.skin、按键写 meta.gamepadLayout，
   运行模式若不去读，编辑器里就是个好-looking 的假开关。这一段专门盯这条链。 */
await page.locator(".pm-close").click();
await page.waitForTimeout(200);
// 先要有一张真实的世界：取消掉尺寸弹窗会留下一个空编辑器，
// 在那上面断言"运行时应用了皮肤"没有意义——运行时自己会把 meta 重建一遍。
if (await page.locator("#sizeModal.show").count()) {
  await page.evaluate(() => {
    document.querySelector('#sizePresets [data-s="64,64"]').click();
    document.getElementById("sizeOk").click();
  });
  await page.waitForFunction(() => !document.getElementById("loading"), null, { timeout: 120000 });
  await page.waitForTimeout(1200);
}
await evalIn(() => {
  const m = window.__editor.state.meta;
  // 官方 18 槽里每个本地部件有多个子槽（legL = leftUpperLeg/leftLowerLeg/leftFoot），
  // 运行时按"最后一个有值的子槽"定色，所以只设 leftUpperLeg 会被 leftFoot 盖掉。
  // 这里把整组一起设，测的才是真实语义。
  const set = (slots, hex) => { m.player.skin = Object.assign({}, m.player.skin, Object.fromEntries(slots.map((s) => [s, hex]))); };
  set(["head", "neck"], "#ff0000");
  set(["torso", "hips"], "#00ff00");
  set(["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"], "#00ff00");
  set(["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"], "#00ff00");
  set(["leftUpperLeg", "leftLowerLeg", "leftFoot"], "#0000ff");
  set(["rightUpperLeg", "rightLowerLeg", "rightFoot"], "#0000ff");
  m.gamepadLayout = Object.assign({ walk: [], fly: [] }, m.gamepadLayout);
  m.gamepadLayout.walk = [
    { id: "joystick", label: "摇杆", x: 2, y: 60, size: 17 },
    { id: "jump", label: "跳", x: 40, y: 70, size: 12 },
  ];
});
await page.click("#btnPublish");
await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
await page.waitForTimeout(2500);
ok("运行模式起来了", await evalIn(() => !!window.__game));
ok("皮肤颜色真的落到运行时的部件材质上（不是只写进 meta）", await evalIn(() => {
  const parts = window.__game.playerEntity?._avatar?.userData?.parts;
  if (!parts) return false;
  const tinted = (node) => {
    let hit = null;
    node.traverse((m) => { if (!hit && m.isMesh && m.material && m.userData.tint) hit = m.material.color; });
    return hit;
  };
  const hex = (c) => "#" + c.getHexString();
  // head/torso/leg 三块分别设成红/绿/蓝：只有一块对上了也不够，可能只是默认色撞车
  return hex(tinted(parts.head)) === "#ff0000"
    && hex(tinted(parts.body)) === "#00ff00"
    && hex(tinted(parts.legL)) === "#0000ff";
}));
ok("虚拟按键按本图布局摆位（#tbtns 进入 gp-placed）", await evalIn(() =>
  document.getElementById("tbtns").classList.contains("gp-placed")));
ok("布局里没点名的按钮被收掉，不留在默认位置挡视线", await evalIn(() => {
  const hidden = ["tCrouch", "tRun", "tActionA", "tActionB", "tFly"]
    .every((id) => document.getElementById(id).style.display === "none");
  return hidden && document.getElementById("tJump").style.display !== "none";
}));
ok("摇杆按布局的 x/y 落位（不再是 CSS 默认左下角）", await evalIn(() => {
  const r = document.getElementById("joyBase").getBoundingClientRect();
  const stage = Math.min(innerWidth, innerHeight * 16 / 9);
  const oy = (innerHeight - stage * 9 / 16) / 2;
  return Math.abs(r.x - stage * 0.02) < 2 && Math.abs(r.y - (oy + stage * 9 / 16 * 0.6)) < 2;
}));
ok("跳跃键真的在运行模式里（默认布局漏跳=手柄不能跳）", await evalIn(() => {
  const r = document.getElementById("tJump").getBoundingClientRect();
  return r.width >= 40 && r.x > 0 && r.y > 0;
}));
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
ok("退出运行模式后按键布局退回 CSS 默认（不留行内样式污染下一张图）", await evalIn(() =>
  !document.getElementById("tbtns").classList.contains("gp-placed")
  && !document.getElementById("tJump").style.left));

const noise = errs.filter((e) => !/favicon|404|WebGL|Download the React/i.test(e));
ok("过程中没有页面报错", noise.length === 0, noise.slice(0, 3).join(" ⧩ "));

console.log(`\nplayer-modal: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
