// backend.js — 运行时够得着"服务端"的那一层，集中放在一个文件里。
//
// 为什么要单独一层：网页体验版（`npm run build:play` → play/）是**纯静态**的，
// 部署在 Pages 子路径下。它复用的是同一份 game.js，而 game.js 里有世界之门、
// 个人资料、db.sql 这些必须打 `/api/...` 或 `/edit/...` 的动作。散在运行时里，
// 体验版就会带着几十个"点了必然 404"的取用点，构建自检也一次次报红。
// 收成一个模块之后，构建时把这一份换成 play-src/js/backend.play.js，
// 运行时其余代码一个字不用改，也拿不到任何根绝对路径。
//
// 这里的失败语义和原来散在 game.js 里时一致：查不到就返回 null / 空数组，
// 让调用方决定"认不出这个目标"该怎么说；只有 db.sql 那种"用户会看到报错"的
// 才抛，且抛的话把原因说清。

export const serverBacked = true;

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 本地世界列表（编辑器那套存档），读不到就是空表。 */
export async function listWorlds() {
  try {
    return ((await getJson("/api/worlds")).worlds) || [];
  } catch { return []; }
}

/** 世界之门的目标解析。三种写法都认：本地世界 id、社区发布 id、两者的精确名字——
 *  作者记不住 20 位十六进制，逼他们抄 id 的门没人摆。 */
export async function findWorld(target) {
  const t = String(target == null ? "" : target).trim();
  if (!t) return null;
  const ws = await listWorlds();
  const w = ws.find((x) => x.id === t) || ws.find((x) => (x.name || "") === t);
  return w ? { kind: "world", id: w.id, title: w.name || w.id } : null;
}

export async function findPub(target) {
  const t = String(target == null ? "" : target).trim();
  if (!t) return null;
  try {
    const d = await getJson(`/api/community/pubs/${encodeURIComponent(t)}`);
    if (d && d.pub && d.pub.kind !== "model") {
      return { kind: "pub", id: d.pub.id, title: d.pub.title, author: (d.author && d.author.name) || "" };
    }
  } catch { /* 不是发布 id */ }
  try {
    const f = await getJson(`/api/community/feed?sort=new&kind=map&limit=100&q=${encodeURIComponent(t)}`);
    const hit = (f.rows || []).find((p) => p.title === t);
    if (hit) return { kind: "pub", id: hit.id, title: hit.title, author: (hit.author && hit.author.name) || "" };
  } catch { /* 广场读不到 */ }
  return null;
}

/** 换页去编辑器里跑一张本地世界。`from` 只是给加载页看的"你从哪来"。 */
export function gotoWorld(id, fromTitle) {
  location.href = `/edit/${encodeURIComponent(id)}?play=1&from=${encodeURIComponent(fromTitle || "")}`;
}

/** 换页去社区发布快照。pubs.js 只有这条路径用得到，所以留成动态 import：
 *  不打开发布图的人不该为它多下一份代码。 */
export async function gotoPub(dest, fromTitle) {
  const m = await import("./pubs.js");
  await m.gotoPub(dest, fromTitle);
}

/** 官方 db 是 GameDatabase，唯一成员是 sql(标准 SQL)，落在服务端 sqlite 上。 */
export async function runSql(worldId, sql, params) {
  let res;
  try {
    res = await fetch(`/api/db/${encodeURIComponent(worldId)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
  } catch {
    // 说清是"送不出去"而不是"表里没数据"：后者会让人去查自己的 SQL。
    throw new Error("db.sql 需要本地服务在跑（编辑器与便携包自带）；直接双击打开 html 时用不了");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((j && j.error) || `db.sql 失败：HTTP ${res.status}`));
  return (j && j.rows) || [];
}

export function openProfile() { location.href = "/me"; }

/* ---------------- 聊天与社交入口 ----------------
   世界频道落在社区后端的 HTTP 上（要落盘、要限流、要让没在这张图里的人也看得见），
   所以运行时对 social.js / auth.js 的引用必须只从这里走：静态体验版没有这两个模块，
   一旦 game.js 直接 import，构建闭包就会把整层社交拉进产物里。 */

export async function chatSend(ch, text) {
  const { chatSend } = await import("./social.js");
  return chatSend(ch, text);
}

export async function chatPull(ch, after, limit) {
  const { chatPull } = await import("./social.js");
  return chatPull(ch, after, limit);
}

/** 聊天面板上那颗「好友 / 私聊」：没登录先弹登录框，登录了才开抽屉。 */
export async function openMessages() {
  if (!window.__me) {
    const a = await import("./auth.js");
    a.openAuth("login");
    return;
  }
  const m = await import("./social.js");
  m.openSocial("messages");
}
