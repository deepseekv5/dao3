/**
 * community.mjs — 老攸元宇宙的社区层：账号、关注、好友、地图发布、评论。
 *
 * 为什么自己写而不接数据库：本包的立身之处是"零第三方运行时依赖 + 数据不出机器"。
 * 装 pg/mysql 会把这个性质弄没，而社区数据在这个量级上（几千用户、几万条评论）
 * 用不到关系型数据库。所以这里是一组**原子落盘的 JSON 文档**：写临时文件再 rename，
 * 进程内串行改，读全在内存。
 *
 * 四条不能商量的规矩：
 *   1. 口令只存 scrypt 派生值，比对走 timingSafeEqual；任何响应里都不出现 salt/hash。
 *   2. 会话是 HttpOnly + SameSite=Lax 的 cookie；非幂等方法还要求 X-CSRF-Token 与服务端
 *      另发的那枚可读 cookie 相等——同源挡不住跨站表单提交，这一道必须过。
 *   3. 发布出去的是**快照**：复制一份不可变的 .json.gz。作者之后改自己的世界，
 *      别人正在玩的那份不会跟着变。
 *   4. 每个写接口都先问"这是谁、能不能"，再动数据；越权一律 403，不是静默忽略。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const PUB_ID_RE = /^[a-f0-9]{12,24}$/;
const WORLD_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const SESSION_COOKIE = "ly_session";
const CSRF_COOKIE = "ly_csrf";
const SESSION_TTL = 30 * 24 * 3600;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) | 0));
const newId = (n = 9) => crypto.randomBytes(n).toString("hex");
const now = () => Date.now();
const NAME_RE = /^[\p{L}\p{N}_ -]{2,20}$/u;
const normName = (s) => String(s == null ? "" : s).trim().replace(/\s+/g, " ");

/* 一次请求只允许有一个响应；重复 writeHead 会变成难查的"响应已发出"崩溃 */
function makeReply(res) {
  let sent = false;
  return {
    get sent() { return sent; },
    json(code, obj) {
      if (sent) return;
      sent = true;
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(obj));
    },
    fail(code, msg) { this.json(code, { error: msg }); },
    raw(code, buf, headers) {
      if (sent) return;
      sent = true;
      res.writeHead(code, headers);
      res.end(buf);
    },
    cookie(line) { res.setHeader("Set-Cookie", line); },
  };
}

function createStore(root) {
  const pubs = path.join(root, "pubs");
  fs.mkdirSync(pubs, { recursive: true });
  const fileOf = (k) => path.join(root, `${k}.json`);
  const DEFAULTS = {
    users: () => ({ byId: {}, byLower: {} }),
    sessions: () => ({}),
    graph: () => ({ follows: [], requests: [], friends: [] }),
    pubs: () => ({ byId: {} }),
    comments: () => ({ byPub: {} }),
    notes: () => ({ list: [] }),
  };
  const docs = {};
  for (const key of Object.keys(DEFAULTS)) {
    let loaded = null;
    try { loaded = JSON.parse(fs.readFileSync(fileOf(key), "utf8")); } catch { loaded = null; }
    docs[key] = Object.assign(DEFAULTS[key](), loaded || {});
    persist(key);
  }
  function persist(key) {
    const p = fileOf(key);
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(docs[key]));
    fs.renameSync(tmp, p);
  }
  return {
    docs, touch: persist,
    pubFile: (id) => path.join(pubs, `${id}.json.gz`),
    pubCover: (id) => path.join(pubs, `${id}.cover.png`),
    pubAssets: (id) => path.join(pubs, `${id}.assets`),
  };
}

/** 递归列目录（相对路径 + 字节数）。 */
function listFiles(root, rel = "", out = []) {
  let items;
  try { items = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const r = rel ? rel + "/" + it.name : it.name;
    if (it.isDirectory()) listFiles(root, r, out);
    else { try { out.push({ path: r, bytes: fs.statSync(path.join(root, r)).size }); } catch {} }
  }
  return out;
}

/** 把世界资产目录整体复制一份进快照：只复制地图引用的那些文件，且带上总量上限。 */
function copyAssets(src, dst, cap = { files: 400, bytes: 120 * 1024 * 1024 }) {
  const list = listFiles(src);
  let bytes = 0, n = 0;
  for (const f of list) {
    bytes += f.bytes;
    if (++n > cap.files || bytes > cap.bytes) return { files: list, copied: n - 1, truncated: true };
    const to = path.join(dst, f.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, f.path), to);
  }
  return { files: list, copied: n, truncated: false };
}

const hashOf = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex") };
}
function verifyPassword(pw, rec) {
  if (!rec || !rec.salt) return false;
  const a = crypto.scryptSync(String(pw), rec.salt, 64, { N: 16384, r: 8, p: 1 });
  const b = Buffer.from(rec.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// 账号不存在时也要花一样的时间：否则"有没有这个用户名"能从响应时间里读出来
const DUMMY = { salt: "0".repeat(32), hash: "0".repeat(128) };

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim() || "");
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (ch) => {
      raw += ch;
      if (raw.length > 512 * 1024) reject(new Error("too-large"));
    });
    req.on("end", () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error("bad-json")); } });
    req.on("error", () => reject(new Error("read")));
  });
}

export function createCommunity({ dataRoot, worldsDir, assetRoot, assetRoots } = {}) {
  const store = createStore(path.join(dataRoot, "community"));
  // 世界资产可能落在两处：可写数据目录，或仓库内的 public/assets（老包）
  const roots = assetRoots || [assetRoot].filter(Boolean);
  const { docs } = store;
  const rate = new Map();

  function limited(bucket, key, max, windowMs) {
    const k = `${bucket}:${key}`;
    const t = now();
    let rec = rate.get(k);
    if (!rec || t - rec.at > windowMs) { rec = { n: 0, at: t }; rate.set(k, rec); }
    rec.n += 1;
    return rec.n > max;
  }

  const userByName = (name) => {
    const id = docs.users.byLower[normName(name).toLowerCase()];
    return id ? docs.users.byId[id] : null;
  };
  const livePubs = () => Object.values(docs.pubs.byId).filter((p) => p.status === "live");
  const commentsOf = (pubId) => docs.comments.byPub[pubId] || (docs.comments.byPub[pubId] = []);

  function countsOf(id) {
    return {
      followers: docs.graph.follows.filter((e) => e.b === id).length,
      following: docs.graph.follows.filter((e) => e.a === id).length,
      friends: docs.graph.friends.filter((e) => e.a === id || e.b === id).length,
      pubs: livePubs().filter((p) => p.authorId === id).length,
    };
  }

  function publicUser(u, viewerId) {
    if (!u) return null;
    const out = { id: u.id, name: u.name, bio: u.bio || "", createdAt: u.createdAt, avatar: u.avatar || null };
    if (!viewerId || viewerId === u.id) { if (viewerId === u.id) out.counts = countsOf(u.id); return out; }
    out.relation = {
      following: docs.graph.follows.some((e) => e.a === viewerId && e.b === u.id),
      followedBy: docs.graph.follows.some((e) => e.a === u.id && e.b === viewerId),
      friend: docs.graph.friends.some((e) => e.k === pairKey(viewerId, u.id)),
      pendingOut: docs.graph.requests.some((e) => e.from === viewerId && e.to === u.id),
      pendingIn: docs.graph.requests.some((e) => e.from === u.id && e.to === viewerId),
    };
    out.counts = countsOf(u.id);
    return out;
  }

  function notify(to, kind, actorId, pubId) {
    if (!to || to === actorId) return;
    docs.notes.list.unshift({ id: newId(6), to, kind, actorId: actorId || null, pubId: pubId || null, ts: now(), read: false });
    while (docs.notes.list.length > 800) docs.notes.list.pop();
    store.touch("notes");
  }

  function pubCard(p, viewerId) {
    const author = docs.users.byId[p.authorId];
    return {
      id: p.id, worldId: p.worldId, title: p.title, desc: p.desc, tags: p.tags || [],
      created: p.created, updated: p.updated, plays: p.plays || 0,
      likes: (p.likes || []).length, likedByMe: !!viewerId && (p.likes || []).includes(viewerId),
      comments: commentsOf(p.id).length, hasCover: !!p.hasCover, bytes: p.bytes, shape: p.shape || null,
      assets: p.assets || 0,
      mine: !!viewerId && viewerId === p.authorId,
      author: author ? { id: author.id, name: author.name, avatar: author.avatar || null } : null,
    };
  }
  const commentCard = (c, viewerId) => {
    const u = docs.users.byId[c.userId];
    return {
      id: c.id, body: c.body, ts: c.ts, likes: (c.likes || []).length,
      likedByMe: !!viewerId && (c.likes || []).includes(viewerId),
      mine: !!viewerId && c.userId === viewerId,
      author: u ? { id: u.id, name: u.name, avatar: u.avatar || null } : { id: null, name: "已注销", avatar: null },
    };
  };

  function startSession(reply, userId) {
    const token = crypto.randomBytes(24).toString("base64url");
    docs.sessions[hashOf(token)] = { userId, createdAt: now() };
    store.touch("sessions");
    const csrf = crypto.randomBytes(16).toString("base64url");
    reply.cookie([
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`,
      `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL}`,
    ]);
    return csrf;
  }

  /** @returns {Promise<boolean>} 恒为 true：/api/community/ 下的路径一律由这里收尾 */
  async function handle(req, res, url) {
    const reply = makeReply(res);
    // url.pathname 还是百分号编码的：用户名是中文时不解码就查不到人
    // （/api/community/users/%E8%80%81%E6%94%B8 会被当成一个叫 "%E8%80%81…" 的用户）。
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { decoded = url.pathname; }
    const seg = decoded.split("/").filter(Boolean).slice(2); // 去掉 api、community
    const method = req.method;
    const cookies = parseCookies(req);

    let viewerId = null;
    const sess = cookies[SESSION_COOKIE] && docs.sessions[hashOf(cookies[SESSION_COOKIE])];
    if (sess && now() - sess.createdAt < SESSION_TTL * 1000 && docs.users.byId[sess.userId]) viewerId = sess.userId;
    else if (cookies[SESSION_COOKIE]) { delete docs.sessions[hashOf(cookies[SESSION_COOKIE])]; store.touch("sessions"); }

    // 静态页第一次打开时没有 CSRF cookie：读接口顺手补一枚，前端才发得出写请求
    let csrf = cookies[CSRF_COOKIE] || "";
    if (!csrf) {
      csrf = crypto.randomBytes(16).toString("base64url");
      reply.cookie(`${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL}`);
    }

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (!cookies["ly_csrf"] || req.headers["x-csrf-token"] !== cookies["ly_csrf"]) {
        reply.fail(403, "缺少或错误的 X-CSRF-Token：写操作要把页面上那枚 ly_csrf 原样带回来");
        return true;
      }
    }

    let body = {};
    if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
      try { body = await readBody(req) || {}; }
      catch (e) { reply.fail(e.message === "too-large" ? 413 : 400, e.message === "bad-json" ? "请求体不是合法 JSON" : "读请求体失败"); return true; }
    }

    const login = (fn) => {
      if (!viewerId) { reply.fail(401, "先登录"); return true; }
      return fn();
    };
    const userParam = (v) => {
      if (!NAME_RE.test(normName(v))) { reply.fail(400, "名字格式不对"); return null; }
      const u = userByName(v);
      if (!u) { reply.fail(404, "没有这个用户"); return null; }
      return u;
    };

    /* ---------------- 身份 ---------------- */
    if (seg[0] === "me" && method === "GET") {
      reply.json(200, { user: viewerId ? publicUser(docs.users.byId[viewerId], viewerId) : null, csrf });
      return true;
    }
    if (seg[0] === "me" && method === "PATCH") return login(() => {
      const u = docs.users.byId[viewerId];
      if ("bio" in body) u.bio = String(body.bio || "").trim().slice(0, 200);
      if ("avatar" in body) u.avatar = body.avatar ? String(body.avatar).trim().slice(0, 24) : null;
      store.touch("users");
      reply.json(200, { user: publicUser(u, viewerId) });
      return true;
    });

    if (seg[0] === "register" && method === "POST") {
      const name = normName(body.name), pw = String(body.password || "");
      if (!NAME_RE.test(name)) { reply.fail(400, "名字要 2–20 个字符，只能用中英文、数字、空格、_ 与 -"); return true; }
      if (pw.length < 8 || pw.length > 128) { reply.fail(400, "口令至少 8 位，最多 128 位"); return true; }
      if (userByName(name)) { reply.fail(409, "这个名字已经被占了"); return true; }
      if (limited("reg", req.socket.remoteAddress || "?", 20, 10 * 60 * 1000)) { reply.fail(429, "注册太频繁，等一会儿再试"); return true; }
      const u = { id: newId(), name, lower: name.toLowerCase(), ...hashPassword(pw), bio: "", avatar: null, createdAt: now() };
      docs.users.byId[u.id] = u;
      docs.users.byLower[u.lower] = u.id;
      store.touch("users");
      const c = startSession(reply, u.id);
      reply.json(200, { user: publicUser(u, u.id), csrf: c });
      return true;
    }

    if (seg[0] === "login" && method === "POST") {
      const name = normName(body.name);
      if (limited("login", `${name.toLowerCase()}|${req.socket.remoteAddress || "?"}`, 10, 5 * 60 * 1000)) {
        reply.fail(429, "试得太多次了，5 分钟后再来"); return true;
      }
      const u = userByName(name);
      const ok = verifyPassword(body.password, u || DUMMY) && !!u;
      if (!ok) { reply.fail(401, "名字或口令不对"); return true; }
      const c = startSession(reply, u.id);
      reply.json(200, { user: publicUser(u, u.id), csrf: c });
      return true;
    }

    if (seg[0] === "logout" && method === "POST") {
      if (sess) { delete docs.sessions[hashOf(cookies[SESSION_COOKIE])]; store.touch("sessions"); }
      reply.cookie([
        `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        `${CSRF_COOKIE}=; Path=/; Max-Age=0`,
      ]);
      reply.json(200, { ok: true, csrf: null });
      return true;
    }

    /* ---------------- 用户 / 关注 / 好友 ---------------- */
    if (seg[0] === "users") {
      const u = userByName(seg[1]);
      if (!u) { reply.fail(404, "没有这个用户"); return true; }
      const sub = seg[2];
      if (!sub) { reply.json(200, { user: publicUser(u, viewerId) }); return true; }
      if (method !== "GET") { reply.fail(405, "这里只读"); return true; }
      if (sub === "followers") {
        reply.json(200, { rows: docs.graph.follows.filter((e) => e.b === u.id).map((e) => publicUser(docs.users.byId[e.a], viewerId)).filter(Boolean) });
        return true;
      }
      if (sub === "following") {
        reply.json(200, { rows: docs.graph.follows.filter((e) => e.a === u.id).map((e) => publicUser(docs.users.byId[e.b], viewerId)).filter(Boolean) });
        return true;
      }
      if (sub === "pubs") {
        reply.json(200, { rows: livePubs().filter((p) => p.authorId === u.id).sort((a, b) => b.created - a.created).map((p) => pubCard(p, viewerId)) });
        return true;
      }
    }

    if (seg[0] === "follow" && method === "POST") {
      if (!viewerId) { reply.fail(401, "先登录"); return true; }
      const target = userParam(body.name);
      if (!target) return true;
      if (target.id === viewerId) { reply.fail(400, "不能关注自己"); return true; }
      const i = docs.graph.follows.findIndex((e) => e.a === viewerId && e.b === target.id);
      if (i >= 0) docs.graph.follows.splice(i, 1);
      else { docs.graph.follows.push({ a: viewerId, b: target.id, ts: now() }); notify(target.id, "follow", viewerId); }
      store.touch("graph");
      reply.json(200, { following: i < 0, relation: publicUser(target, viewerId).relation, counts: countsOf(target.id) });
      return true;
    }

    if (seg[0] === "friends" && method === "GET") return login(() => {
      const asFriend = (e) => publicUser(docs.users.byId[e.a === viewerId ? e.b : e.a], viewerId);
      const friends = docs.graph.friends.filter((e) => e.a === viewerId || e.b === viewerId)
        .map(asFriend).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name, "zh"));
      const incoming = docs.graph.requests.filter((e) => e.to === viewerId)
        .map((e) => ({ user: publicUser(docs.users.byId[e.from], viewerId), ts: e.ts })).filter((r) => r.user);
      const outgoing = docs.graph.requests.filter((e) => e.from === viewerId)
        .map((e) => ({ user: publicUser(docs.users.byId[e.to], viewerId), ts: e.ts })).filter((r) => r.user);
      // 「可能认识的人」= 好友们在跟的人，去掉我自己、已加好友的
      const friendIds = new Set(docs.graph.friends.filter((e) => e.a === viewerId || e.b === viewerId).map((e) => e.a === viewerId ? e.b : e.a));
      const known = new Set([viewerId, ...friendIds]);
      const suggested = [];
      for (const f of docs.graph.follows) {
        if (!friendIds.has(f.a) || known.has(f.b)) continue;
        const u = docs.users.byId[f.b];
        if (u) { suggested.push(publicUser(u, viewerId)); known.add(f.b); }
      }
      reply.json(200, { friends, incoming, outgoing, suggested: suggested.slice(0, 12) });
      return true;
    });

    if (seg[0] === "friend") return login(() => {
      const action = seg[1];
      const target = userParam(body.name);
      if (!target) return true;
      if (target.id === viewerId) { reply.fail(400, "不能加自己为好友"); return true; }
      const k = pairKey(viewerId, target.id);
      const isIncoming = docs.graph.requests.findIndex((e) => e.from === target.id && e.to === viewerId);
      const isOutgoing = docs.graph.requests.findIndex((e) => e.from === viewerId && e.to === target.id);
      if (action === "request") {
        if (docs.graph.friends.some((e) => e.k === k)) { reply.fail(409, "你们已经是好友了"); return true; }
        if (isIncoming >= 0) { // 对方先发的请求：直接当作接受，省一次往返
          docs.graph.requests.splice(isIncoming, 1);
          docs.graph.friends.push({ k, a: viewerId, b: target.id, ts: now() });
          notify(target.id, "friend", viewerId);
          store.touch("graph");
          reply.json(200, { ok: true, friend: true, accepted: true });
          return true;
        }
        if (isOutgoing >= 0) { reply.fail(409, "请求已经发出去了，等对方回应"); return true; }
        docs.graph.requests.push({ from: viewerId, to: target.id, ts: now() });
        store.touch("graph");
        notify(target.id, "friend_request", viewerId);
        reply.json(200, { ok: true, friend: false });
        return true;
      }
      if (action === "remove") {
        const i = docs.graph.friends.findIndex((e) => e.k === k);
        if (i < 0) { reply.fail(404, "你们不是好友"); return true; }
        docs.graph.friends.splice(i, 1);
        store.touch("graph");
        reply.json(200, { ok: true, friend: false });
        return true;
      }
      if (action === "accept" || action === "decline") {
        if (isIncoming < 0) { reply.fail(404, "没有来自这个人的待处理请求"); return true; }
        docs.graph.requests.splice(isIncoming, 1);
        if (action === "accept") { docs.graph.friends.push({ k, a: viewerId, b: target.id, ts: now() }); notify(target.id, "friend", viewerId); }
        store.touch("graph");
        reply.json(200, { ok: true, friend: action === "accept" });
        return true;
      }
      reply.fail(404, "好友接口没有这个动作：" + action);
      return true;
    });

    /* ---------------- 广场 / 发布 ---------------- */
    if (seg[0] === "feed" && method === "GET") {
      const sort = ["new", "hot", "following"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "new";
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      let rows = livePubs();
      if (q) {
        rows = rows.filter((p) => `${p.title} ${p.desc} ${(p.tags || []).join(" ")} ${docs.users.byId[p.authorId]?.name || ""}`.toLowerCase().includes(q));
      }
      if (sort === "following") {
        if (!viewerId) { reply.fail(401, "看关注流要先登录"); return true; }
        const ids = new Set(docs.graph.follows.filter((e) => e.a === viewerId).map((e) => e.b));
        ids.add(viewerId);
        rows = rows.filter((p) => ids.has(p.authorId));
      }
      const score = (p) => (p.likes || []).length * 3 + (p.plays || 0) + commentsOf(p.id).length * 2;
      rows.sort((a, b) => (sort === "hot" ? score(b) - score(a) || b.created - a.created : b.created - a.created));
      const offset = clamp(url.searchParams.get("offset") || 0, 0, 1e6);
      const limit = clamp(url.searchParams.get("limit") || 24, 1, 100);
      reply.json(200, { total: rows.length, sort, offset, rows: rows.slice(offset, offset + limit).map((p) => pubCard(p, viewerId)) });
      return true;
    }

    if (seg[0] === "publish" && method === "POST") return login(() => {
      const wid = String(body.worldId || "");
      if (!WORLD_ID_RE.test(wid)) { reply.fail(400, "worldId 不合法"); return true; }
      const src = path.join(worldsDir, `${wid}.json.gz`);
      if (!fs.existsSync(src)) { reply.fail(404, "本地找不到这个世界"); return true; }
      const title = String(body.title || "").trim().slice(0, 60);
      if (title.length < 2) { reply.fail(400, "标题至少 2 个字"); return true; }
      let shape = null;
      try { shape = JSON.parse(zlib.gunzipSync(fs.readFileSync(src))).shape || null; }
      catch { reply.fail(400, "世界存档读不出来，发布先取消"); return true; }
      const id = newId();
      fs.copyFileSync(src, store.pubFile(id));
      const cover = assetRoots.map((r) => path.join(r, wid, "cover.png")).find((p) => fs.existsSync(p));
      if (cover) fs.copyFileSync(cover, store.pubCover(id));
      // 地图引用的模型/贴图必须跟着快照走：只存体素的话，别人点开你发布的图会是一片 404。
      const assetDir = assetRoots.map((r) => path.join(r, wid)).find((p) => fs.existsSync(p));
      let assets = { files: [], copied: 0, truncated: false };
      if (assetDir) {
        assets = copyAssets(assetDir, store.pubAssets(id));
        if (assets.truncated) {
          fs.rmSync(store.pubAssets(id), { recursive: true, force: true });
          fs.rmSync(store.pubFile(id), { force: true });
          reply.fail(413, `这张图引用的素材太多（${assets.files.length} 个文件），发布先取消；删掉没用到的模型再试`);
          return true;
        }
      }
      const rec = {
        id, worldId: wid, authorId: viewerId, title,
        desc: String(body.desc || "").trim().slice(0, 2000),
        tags: (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).trim().slice(0, 16)).filter(Boolean).slice(0, 6),
        created: now(), updated: now(), plays: 0, likes: [], status: "live",
        bytes: fs.statSync(store.pubFile(id)).size, shape, hasCover: !!cover,
        assets: assets.files.length,
      };
      docs.pubs.byId[id] = rec;
      store.touch("pubs");
      // 关注作者的人收到"你关注的人发布了新地图"
      for (const f of docs.graph.follows) if (f.b === viewerId) notify(f.a, "publish", viewerId, id);
      reply.json(200, { pub: pubCard(rec, viewerId) });
      return true;
    });

    if (seg[0] === "pubs" && PUB_ID_RE.test(seg[1] || "")) {
      const p = docs.pubs.byId[seg[1]];
      if (!p || p.status !== "live") { reply.fail(404, "这个发布不存在或已下架"); return true; }
      const sub = seg[2];

      if (!sub && method === "GET") {
        reply.json(200, { pub: pubCard(p, viewerId), author: publicUser(docs.users.byId[p.authorId], viewerId), canEdit: p.authorId === viewerId });
        return true;
      }
      if (!sub && method === "PATCH") return login(() => {
        if (p.authorId !== viewerId) { reply.fail(403, "只有作者能改这条发布"); return true; }
        if (body.title) p.title = String(body.title).trim().slice(0, 60);
        if ("desc" in body) p.desc = String(body.desc).trim().slice(0, 2000);
        if (Array.isArray(body.tags)) p.tags = body.tags.map((t) => String(t).trim().slice(0, 16)).filter(Boolean).slice(0, 6);
        p.updated = now();
        store.touch("pubs");
        reply.json(200, { pub: pubCard(p, viewerId) });
        return true;
      });
      if (!sub && method === "DELETE") return login(() => {
        if (p.authorId !== viewerId) { reply.fail(403, "只有作者能下架这条发布"); return true; }
        p.status = "removed"; p.updated = now();
        store.touch("pubs");
        reply.json(200, { ok: true });
        return true;
      });

      if (sub === "like" && method === "POST") return login(() => {
        const arr = p.likes || (p.likes = []);
        const i = arr.indexOf(viewerId);
        if (i < 0) { arr.push(viewerId); notify(p.authorId, "like", viewerId, p.id); }
        else arr.splice(i, 1);
        store.touch("pubs");
        reply.json(200, { likes: arr.length, likedByMe: i < 0 });
        return true;
      });

      if (sub === "play" && method === "POST") {
        p.plays = (p.plays || 0) + 1;
        store.touch("pubs");
        reply.json(200, { plays: p.plays });
        return true;
      }

      // 快照按世界原格式送出：存的就是 gzip(JSON)，加上 Content-Encoding 让浏览器自己解
      if (sub === "world" && method === "GET") {
        const f = store.pubFile(p.id);
        if (!fs.existsSync(f)) { reply.fail(404, "快照文件不见了"); return true; }
        reply.raw(200, fs.readFileSync(f), { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store" });
        return true;
      }
      if (sub === "cover" && method === "GET") {
        const f = store.pubCover(p.id);
        if (!fs.existsSync(f)) { reply.raw(404, Buffer.from(""), { "Content-Type": "text/plain" }); return true; }
        reply.raw(200, fs.readFileSync(f), { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" });
        return true;
      }
      // 快照引用的素材：清单 + 单个文件。路径解析结果必须仍在该快照目录内。
      if (sub === "assets" && method === "GET") {
        reply.json(200, { files: listFiles(store.pubAssets(p.id)) });
        return true;
      }
      if (sub === "asset" && method === "GET") {
        const rel = String(url.searchParams.get("path") || "").replace(/^\/+/, "");
        if (!rel || rel.includes("..") || rel.length > 200) { reply.fail(400, "bad path"); return true; }
        const dir = store.pubAssets(p.id);
        const f = path.join(dir, rel);
        if (!f.startsWith(dir + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { reply.fail(404, "快照里没有这个文件"); return true; }
        const ext = path.extname(f).toLowerCase();
        reply.raw(200, fs.readFileSync(f), {
          "Content-Type": ext === ".png" ? "image/png" : ext === ".json" || ext === ".gltf" ? "application/json" : "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        });
        return true;
      }

      if (sub === "comments") {
        const list = commentsOf(p.id);
        if (method === "GET") { reply.json(200, { rows: list.map((c) => commentCard(c, viewerId)) }); return true; }
        if (method === "POST") return login(() => {
          const text = String(body.body || "").trim();
          if (!text) { reply.fail(400, "评论不能是空的"); return true; }
          if (text.length > 500) { reply.fail(400, "评论最多 500 字"); return true; }
          if (limited("cmt", viewerId, 20, 60 * 1000)) { reply.fail(429, "评论太频繁了，一分钟后再发"); return true; }
          const c = { id: newId(6), pubId: p.id, userId: viewerId, body: text, ts: now(), likes: [] };
          list.push(c);
          store.touch("comments");
          notify(p.authorId, "comment", viewerId, p.id);
          reply.json(200, { row: commentCard(c, viewerId), total: list.length });
          return true;
        });
        if (method === "DELETE" && PUB_ID_RE.test(seg[3] || "")) return login(() => {
          const i = list.findIndex((c) => c.id === seg[3]);
          if (i < 0) { reply.fail(404, "没有这条评论"); return true; }
          if (list[i].userId !== viewerId && p.authorId !== viewerId) { reply.fail(403, "只能删自己的评论（地图作者可以删任何一条）"); return true; }
          list.splice(i, 1);
          store.touch("comments");
          reply.json(200, { ok: true });
          return true;
        });
      }
    }

    if (seg[0] === "comments" && PUB_ID_RE.test(seg[1] || "") && seg[2] === "like" && method === "POST") {
      return login(() => {
        for (const list of Object.values(docs.comments.byPub)) {
          const c = list.find((x) => x.id === seg[1]);
          if (!c) continue;
          const arr = c.likes || (c.likes = []);
          const i = arr.indexOf(viewerId);
          if (i < 0) arr.push(viewerId); else arr.splice(i, 1);
          store.touch("comments");
          reply.json(200, { likes: arr.length, likedByMe: i < 0 });
          return true;
        }
        reply.fail(404, "没有这条评论");
        return true;
      });
    }

    if (seg[0] === "notifications") {
      if (method === "GET") return login(() => {
        const rows = docs.notes.list.filter((n) => n.to === viewerId).slice(0, 40).map((n) => ({
          ...n,
          actor: n.actorId ? publicUser(docs.users.byId[n.actorId], viewerId) : null,
          pub: n.pubId && docs.pubs.byId[n.pubId] ? pubCard(docs.pubs.byId[n.pubId], viewerId) : null,
        }));
        reply.json(200, { rows, unread: rows.filter((r) => !r.read).length });
        return true;
      });
      if (method === "POST") return login(() => {
        for (const n of docs.notes.list) if (n.to === viewerId) n.read = true;
        store.touch("notes");
        reply.json(200, { ok: true });
        return true;
      });
    }

    if (seg[0] === "stats" && method === "GET") {
      const pubs = livePubs();
      reply.json(200, {
        users: Object.keys(docs.users.byId).length,
        pubs: pubs.length,
        comments: Object.values(docs.comments.byPub).reduce((a, v) => a + v.length, 0),
        plays: pubs.reduce((a, p) => a + (p.plays || 0), 0),
        likes: pubs.reduce((a, p) => a + (p.likes || []).length, 0),
        friends: docs.graph.friends.length,
        follows: docs.graph.follows.length,
      });
      return true;
    }

    reply.fail(404, "社区接口里没有这一条：" + url.pathname);
    return true;
  }

  return {
    handle, docs,
    summary: () => ({ users: Object.keys(docs.users.byId).length, pubs: livePubs().length }),
  };
}
