// api.test.mjs — 官方 API 面的**运行时**对账（走 CDP，不依赖 playwright）。
// 运行：npm run serve &  然后  npm run test:api
//
// 为什么这套必须存在：scripts/api-audit.mjs 自己在输出里写"以 api-probe.js 的运行时对账为准"，
// 而那个探针只被 test/e2e.mjs 调用，e2e 依赖 playwright-core——这台机器上没装，
// 于是它整批 SKIP 并 exit 0。也就是说"最可信的那条结论"在这里从来没跑过，
// 报出来的 99.x% 全部来自静态 grep（静态搜到名字 ≠ 对象上真有这个成员）。
import { launchChrome, Session } from "./cdp.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (name, cond, extra = "") => console.log((cond ? "PASS  " : "FAIL  ") + name + (extra ? "  " + extra : ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.BASE || "http://127.0.0.1:5173";
const EDIT = BASE + "/edit/216d665d3ca92bd1b9a2";

const { port } = await launchChrome({});
const s = await Session.open(port, { width: 1280, height: 800, initScripts: ['try{localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")}catch(e){}' ] });
async function wait(expr, ms = 160000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await s.evaluate(`(() => !!(${expr}))()`)) return true; } catch { /* 世界 load 压满主线程，超时=还没就绪 */ }
    await sleep(1500);
  }
  throw new Error("等超时：" + label);
}
const page = (b) => s.evaluate(`(() => {${b}})()`);

/* ---------- 静态：官方清单本身不能掺水 ---------- */
// 审计的 d.ts 解析器曾经把 `declare type GameHttpHandler = (request, response)` 里
// 两空格缩进的**参数**当成类成员收进清单，于是凭空多出两个"官方成员"，
// 再报成"本地缺失"。分母错了，覆盖率数字就没有意义，所以这里当场钉住。
const members = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/api-members.json"), "utf8"));
const phantom = ["GameHttpRequest.response", "GameHttpResponse.response"]
  .filter((full) => (members[full.split(".")[0]] || []).includes(full.split(".")[1]));
ok("官方成员清单里没有 type 别名参数冒充的成员", phantom.length === 0, phantom.join(","));
ok("清单规模对得上（核心四类都在，且不是整类消失）",
  ["GameWorld", "GameEntity", "GamePlayer", "GameVoxels"].every((c) => (members[c] || []).length > 8),
  ["GameWorld", "GameEntity", "GamePlayer", "GameVoxels"].map((c) => `${c}:${(members[c] || []).length}`).join(" "));

/* ---------- 运行时：核心四类逐个成员验真 ---------- */
await s.goto(EDIT, { settleMs: 6000 });
await wait(`window.__editor && document.getElementById("sbMode").textContent === "搭建"`, 160000, "编辑器就绪");
await page(`window.__editor.enterPlay(); return 1;`);
await wait(`window.__game && window.__game.running && window.__game.player`, 120000, "进入运行模式");
await sleep(1200);

const probe = await s.evaluate(`(async () => {
  const m = await import(${JSON.stringify(BASE + "/js/api-probe.js")} + "?cb=" + Date.now());
  return await m.probe();
})()`);
ok("运行时对账真的跑起来了", !probe.error, probe.error || "");
ok("核心四类 API 运行时零缺失", probe.missingCount === 0, (probe.missing || []).slice(0, 8).join(", "));
ok("成员种类也对（方法没被实现成属性）", probe.kindOk === true, (probe.badKind || []).slice(0, 8).join(", "));
ok("对账覆盖到官方清单规模", probe.total >= 300, `${probe.total} 个成员 / 覆盖 ${probe.coverage}%`);
ok("四类各自都不缺", ["GameWorld", "GameEntity", "GamePlayer", "GameVoxels"]
  .every((c) => probe.per && probe.per[c] && probe.per[c].missing.length === 0),
  Object.entries(probe.per || {}).map(([k, v]) => `${k} ${v.ok}/${v.official}`).join(" · "));

// ---------- 事件通道：on* 与 next* 两边都得真的能调 ----------
const chans = await page(`
  const g = window.__game, W = g._globals().world, pl = g.player, e = g.playerEntity;
  const owners = { world: W, player: pl, entity: e };
  const want = [["world", "Tick"], ["world", "PlayerJoin"], ["world", "Chat"], ["world", "Interact"],
    ["player", "Chat"], ["player", "Press"], ["player", "Respawn"], ["player", "KeyDown"],
    ["entity", "Click"], ["entity", "Destroy"], ["entity", "TakeDamage"]];
  const bad = [];
  for (const [who, n] of want) {
    const o = owners[who];
    if (typeof o["on" + n] !== "function" || typeof o["next" + n] !== "function") bad.push(who + "." + n);
  }
  return { bad };`);
ok("on*/next* 成对存在且可调用", chans.bad.length === 0, chans.bad.join(","));
// 挂上去要真收得到。tick 是 64ms 一步，但软件光栅化下实测能慢到 1 秒一步，
// 所以按"最多等 8 秒、期间至少响 2 次"轮询——按固定 260ms 判会得到一条假红。
const tickHits = await s.evaluate(`(async () => {
  const W = window.__game._globals().world;
  let hits = 0;
  W.onTick(() => hits++);
  const t0 = Date.now();
  while (hits < 2 && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 200));
  return hits;
})()`);
ok("onTick 挂上去真的会被调用", tickHits >= 2, `${tickHits} 次`);

/* ---------- 平台原生对象：http.fetch 交出去的是真 Response ---------- */
// 审计把 statusText / bodyUsed / formData 记成"原生透传，天生在"，
// 但这个说法只有跑一次才知道真假：我们若自己包一层普通对象，它们就是 undefined。
const nat = await s.evaluate(`(async () => {
  const http = window.__game._globals().http;
  if (!http || typeof http.fetch !== "function") return { err: "没有 http.fetch" };
  const r = await http.fetch(${JSON.stringify(BASE + "/api/whoami")});
  const j = await r.json();
  return { status: r.status, statusText: r.statusText, okFlag: r.ok, bodyUsed: r.bodyUsed,
    formData: typeof r.formData, redirected: r.redirected, app: j.app || null };
})()`);
ok("http.fetch 交出去的是真 Response（statusText/bodyUsed/formData 都在）",
  !nat.err && nat.status === 200 && nat.statusText === "OK" && nat.bodyUsed === true && nat.formData === "function",
  JSON.stringify(nat));

/* ---------- 官方 db：GameDatabase.sql ---------- */
// 官方类型里 db 标着 @deprecated（"旧代编辑器接口，请改用 GameDataStorage"），
// 但"标了弃用"和"我们不给"是两件事：脚本真按 d.ts 写 db.sql(...) 时不能拿到 undefined。
// 这里走完整三条路：await 拿整批、for await 逐行、写语句的返回也要能用。
const sql = await s.evaluate(`(async () => {
  const db = window.__game._globals().db;
  if (!db || typeof db.sql !== "function") return { err: "db.sql 不是函数", keys: db ? Object.keys(db) : null };
  await db.sql("drop table if exists apitest");
  await db.sql("create table apitest(id integer primary key, name text, n integer)");
  const ins = await db.sql("insert into apitest(name,n) values(?,?)", "甲", 7);
  await db.sql("insert into apitest(name,n) values(?,?)", "乙", 12);
  const rows = await db.sql("select name, n from apitest where n > ? order by id", 5);
  const one = [];
  for await (const r of db.sql("select name from apitest")) one.push(r.name);
  let sqlErr = null;
  try { await db.sql("select * from 没有这张表"); } catch (e) { sqlErr = String(e.message || e).slice(0, 60); }
  await db.sql("drop table apitest");
  return { n: rows.length, first: rows[0] || null, iterated: one, wrote: ins !== undefined, sqlErr };
})()`);
// err 只表示"db.sql 根本不在"，sqlErr 是故意踩出来的那条 SQL 错——
// 两个字段混用一个的话，最后一条断言会反过来把第一条判成失败。
ok("db.sql 建表/参数化写入/查询都能跑", !sql.err && sql.n === 2 && !!sql.first && sql.first.name === "甲" && sql.first.n === 7, JSON.stringify(sql));
ok("GameQueryResult 可以 for await 逐行取", Array.isArray(sql.iterated) && sql.iterated.join(",") === "甲,乙", JSON.stringify(sql.iterated));
const noSqlErr = /不是函数|not a function|is not defined|需要本地服务/.test(sql.sqlErr || "");
ok("SQL 报错要抛出来，不能静默给空数组", !!sql.sqlErr && !noSqlErr, sql.sqlErr || "没抛错");

/* ---------- 服务端 SQL 层：建库、删世界要连库一起删 ---------- */
// 走临时目录，不碰 server/data：这条测的是 drop 的清理语义，不是本机数据。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ly-sql-"));
const { createSql } = await import("../server/sql.mjs");
const sqlLayer = createSql(tmpDir);
let layerOk = false, layerErr = "";
try {
  await sqlLayer.run("unitworld", "create table t(a integer, b boolean)", []);
  await sqlLayer.run("unitworld", "insert into t values(?, ?)", [5, true]);
  const r = await sqlLayer.run("unitworld", "select a, b from t", []);
  layerOk = r.rows.length === 1 && r.rows[0].a === 5 && r.rows[0].b === 1;   // 布尔按 SQLite 收成 0/1
} catch (e) { layerErr = String(e.message || e); }
const dbFile = path.join(tmpDir, "unitworld.sqlite");
const existed = fs.existsSync(dbFile);
sqlLayer.drop("unitworld");
ok("SQL 层：布尔进得去、整数出得来", layerOk, layerErr);
ok("删世界把它的 .sqlite 一起删掉（同 id 重建不会继承上一张图的表）", existed && !fs.existsSync(dbFile), existed ? "已删" : "根本没建出文件");
fs.rmSync(tmpDir, { recursive: true, force: true });

await s.close();
process.exit(0);
