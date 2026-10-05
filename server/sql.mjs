// server/sql.mjs — 官方 GameDatabase.sql 的执行端（每个世界一个 .sqlite 文件）。
//
// 为什么放在服务端：官方语义里 db 是游戏服务端的 SQL 库，脚本发语句、引擎执行。
// 我们这套运行时在浏览器里模拟双端，而浏览器没有 SQL 引擎——
// "零第三方依赖"是这个项目的前提，所以用 Node 自带的 node:sqlite，而不是拖一个
// sql.js/wasm 进来（那是几兆构建产物，也正是 Monaco 被排除的同一个理由）。
//
// 语句与参数分开传（prepare + bind）：脚本作者写 ? 占位就该拿到 ? 的语义，
// 任何字符串拼接都是把注入面留给用户自己的图。
import fs from "node:fs";
import path from "node:path";

const READ_RE = /^\s*(?:select|with|pragma|explain)\b/i;

let sqliteP = null;
function sqlite() {
  // 动态 import：Node < 22.5 没有这个模块。让它只影响 db.sql 一条接口，
  // 而不是整个服务起不来。
  if (!sqliteP) sqliteP = import("node:sqlite").then((m) => m.DatabaseSync).catch(() => null);
  return sqliteP;
}

/** SQLite 的值域比 JS 窄：布尔没有、BigInt 不能进 JSON。两头都在这收敛掉。 */
function bindValue(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  if (Array.isArray(v)) return new Uint8Array(v);
  if (v === null || typeof v === "number" || typeof v === "string" || v instanceof Uint8Array) return v;
  throw new Error("db.sql 的参数只能是 number / string / Uint8Array / boolean / null，收到 " + typeof v);
}
function jsonValue(v) {
  return typeof v === "bigint" ? Number(v) : v;
}
function jsonRow(r) {
  const out = {};
  for (const k of Object.keys(r)) out[k] = jsonValue(r[k]);
  return out;
}

export function createSql(dir) {
  const dbs = new Map();
  const open = async (worldId) => {
    const DatabaseSync = await sqlite();
    if (!DatabaseSync) throw new Error("本机 Node 没有 node:sqlite（需要 22.5+），db.sql 用不了");
    let db = dbs.get(worldId);
    if (!db) {
      fs.mkdirSync(dir, { recursive: true });
      db = new DatabaseSync(path.join(dir, `${worldId}.sqlite`));
      dbs.set(worldId, db);
    }
    return db;
  };
  return {
    async run(worldId, sql, params) {
      const db = await open(worldId);
      // 官方类型写的是 sql: string[]，可文档站根本没有 GameDatabase 这一页（db 标着
      // @deprecated），没有示例可依据。两种都收：数组按拼接处理（无插值的模板字符串
      // 就是这个形状），字符串原样用。
      const text = String(Array.isArray(sql) ? sql.join("") : sql || "").trim();
      if (!text) throw new Error("db.sql：语句是空的");
      const args = (Array.isArray(params) ? params : []).map(bindValue);
      const stmt = db.prepare(text);
      if (READ_RE.test(text)) return { rows: stmt.all(...args).map(jsonRow) };
      const r = stmt.run(...args);
      return { rows: [], changes: jsonValue(r.changes), lastInsertRowid: jsonValue(r.lastInsertRowid) };
    },
    // 删世界要把库一起删掉：先关句柄再删文件，否则 Windows 上文件被占着删不掉，
    // 而且同一个 id 将来重建时会继承上一张图的表。
    drop(worldId) {
      const db = dbs.get(worldId);
      if (db) { try { db.close(); } catch { /* 已经关了 */ } dbs.delete(worldId); }
      for (const suffix of ["", "-wal", "-shm"]) {
        const f = path.join(dir, `${worldId}.sqlite${suffix}`);
        if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      }
    },
  };
}
