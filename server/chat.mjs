/**
 * chat.mjs — 频道聊天：世界频道、地图频道、好友私聊，加一张在线表。
 *
 * 为什么单独一个模块而不是塞进 community.mjs：community 管的是"谁发的、能不能发"，
 * 这里管的是"话送到哪儿、留下多少"。两件事的淘汰规则完全不同（资料几乎不改，
 * 消息每秒都在进），混在一个 1200 行的文件里改哪边都要小心另一件。
 *
 * 三条规矩：
 *   1. 频道 id 由服务端算，客户端只能报"世界 / 某张图 / 某个人"，
 *      私聊那一对 key 是排序后的 id 拼接——不然 A 能给"任意字符串"发消息。
 *   2. 私聊只对好友开放，且只有当事人读得到。能私聊陌生人 = 给骚扰开大门。
 *   3. 消息是**有界环形缓冲**，落盘走原子写。不封顶的话一条刷屏就能把磁盘喂胖。
 *
 * 传输有两条路，但发送只有一条：HTTP POST 进来 → 存 → 推给订阅了这个频道的
 * WebSocket 连接（游戏内的房间、以及在线用户的私聊）。轮询负责兜底：
 * 社区网页那侧没有 socket，靠 after 游标拉增量。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const now = () => Date.now();
const newId = () => crypto.randomBytes(6).toString("hex");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) | 0));

const WORLD_KEEP = 200;         // 世界频道留多少条
const MAP_KEEP = 120;           // 每张图留多少条
const MAP_MAX = 80;             // 最多给多少张图留档（按最后发言时间淘汰）
const DM_KEEP = 200;            // 每对私聊留多少条
const DM_MAX = 300;             // 最多留多少对私聊
const MAX_LEN = 200;            // 单条长度
const COOLDOWN = 900;           // 同一个人在同一个频道两句话之间的最短间隔
const BURST = { max: 25, window: 60_000 };   // 一分钟内的条数上限

export function createChat({ dataRoot, screen, isFriend, livePub } = {}) {
  const file = path.join(dataRoot, "chat.json");
  fs.mkdirSync(dataRoot, { recursive: true });
  const DEFAULT = () => ({ world: [], maps: {}, dms: {}, unread: {}, last: {} });
  let loaded = null;
  try { loaded = JSON.parse(fs.readFileSync(file, "utf8")); } catch { loaded = null; }
  const doc = Object.assign(DEFAULT(), loaded || {});
  for (const k of ["world", "maps", "dms", "unread", "last"]) if (!(k in doc)) doc[k] = DEFAULT()[k];

  function persist() {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
  }

  /* ---------------- 订阅与在线 ---------------- */
  // channel -> Set<send>。send 是 realtime 那边给的"往这条连接写一帧"的函数。
  const subs = new Map();
  // userId -> Set<send>：一个人可能开好几个 tab。
  const online = new Map();

  function subscribe(ch, send) {
    if (!subs.has(ch)) subs.set(ch, new Set());
    subs.get(ch).add(send);
    return () => { const s = subs.get(ch); if (s) { s.delete(send); if (!s.size) subs.delete(ch); } };
  }
  function publish(ch, msg, except) {
    const s = subs.get(ch);
    if (s) for (const send of s) { if (send !== except) { try { send(msg); } catch {} } }
  }
  /** 在线的人不管开没开房间都要能收到私聊，所以按 userId 再挂一层。 */
  function attach(user, send) {
    if (!user || !user.id) return { room() {}, detach() {} };
    if (!online.has(user.id)) online.set(user.id, new Set());
    online.get(user.id).add(send);
    const offs = [subscribe("world", send)];
    let roomOff = null;
    return {
      /** 进图/换图时把地图频道订阅挪一下；传 null 表示离开房间。 */
      room(ch) {
        if (roomOff) { try { roomOff(); } catch {} roomOff = null; }
        if (ch) roomOff = subscribe(ch, send);
      },
      detach() {
        if (roomOff) { try { roomOff(); } catch {} roomOff = null; }
        for (const off of offs.splice(0)) { try { off(); } catch {} }
        const set = online.get(user.id);
        if (set) { set.delete(send); if (!set.size) online.delete(user.id); }
      },
    };
  }
  function pushToUser(userId, msg, except) {
    const set = online.get(userId);
    if (!set) return false;
    for (const send of set) { if (send === except) continue; try { send(msg); } catch {} }
    return true;
  }
  const isOnline = (userId) => online.has(userId);
  const onlineIds = () => [...online.keys()];

  /* ---------------- 频道 ---------------- */
  /** 客户端给的频道串 → 内部 key。不认识的一律拒绝，绝不"顺手开一个新频道"。 */
  function resolve(ch, viewerId) {
    const s = String(ch || "").trim();
    if (s === "world") return { ok: true, kind: "world", key: "world", title: "世界频道" };
    const m = /^map:([a-f0-9]{12,24})$/.exec(s);
    if (m) {
      const pub = livePub ? livePub(m[1]) : null;
      if (!pub) return { ok: false, error: "这张图已经不在架上了" };
      return { ok: true, kind: "map", key: s, id: m[1], title: pub.title || "地图频道" };
    }
    const d = /^dm:([a-f0-9]{6,64})$/.exec(s);
    if (d) {
      const other = d[1];
      if (!viewerId) return { ok: false, error: "先登录" };
      if (other === viewerId) return { ok: false, error: "不能给自己发私聊" };
      return { ok: true, kind: "dm", key: "dm:" + pairKey(viewerId, other), peer: other, title: "" };
    }
    return { ok: false, error: "没有这个频道" };
  }
  const pairKey = (a, b) => [a, b].sort().join(".");

  function bucketFor(ch) {
    if (ch.kind === "world") return doc.world;
    if (ch.kind === "map") return (doc.maps[ch.id] = doc.maps[ch.id] || []);
    const key = ch.key.slice(3);
    return (doc.dms[key] = doc.dms[key] || []);
  }
  function trimBuckets() {
    const mapKeys = Object.keys(doc.maps);
    if (mapKeys.length > MAP_MAX) {
      mapKeys.sort((a, b) => (doc.last["map:" + a] || 0) - (doc.last["map:" + b] || 0))
        .slice(0, mapKeys.length - MAP_MAX).forEach((k) => delete doc.maps[k]);
    }
    const dmKeys = Object.keys(doc.dms);
    if (dmKeys.length > DM_MAX) {
      dmKeys.sort((a, b) => (doc.last["dm:" + a] || 0) - (doc.last["dm:" + b] || 0))
        .slice(0, dmKeys.length - DM_MAX).forEach((k) => delete doc.dms[k]);
    }
  }

  /* ---------------- 收发 ---------------- */
  const rate = new Map();     // "<ch>|<userId>" -> [ts...]
  function rateCheck(key) {
    const t = now();
    const list = (rate.get(key) || []).filter((x) => t - x < BURST.window);
    if (list.length >= BURST.max) return { blocked: true, reason: "这一分钟发得太多了，先歇会儿" };
    list.push(t);
    rate.set(key, list);
    return { blocked: false };
  }

  /** @returns {{ok:boolean, msg?:object, error?:string}}
   *  via：发送方自己那条连接的写函数。客户端本地已经先回显过一次，
   *  再把同一条发回去就是屏幕上两行一样的话。 */
  function post({ ch, user, text, cooldownOk, via }) {
    const r = resolve(ch, user && user.id);
    if (!r.ok) return { error: r.error };
    if (r.kind === "dm" && isFriend && !isFriend(user.id, r.peer)) {
      return { error: "只能和好友私聊：先在资料页把对方加为好友" };
    }
    const raw = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_LEN * 2);
    if (!raw) return { error: "空的" };
    const key = r.key + "|" + user.id;
    const bucket = bucketFor(r);
    const last = bucket.length ? bucket[bucket.length - 1] : null;
    if (!cooldownOk && last && last.from === user.id && now() - last.ts < COOLDOWN) {
      return { error: "说得太快了", wait: Math.ceil((COOLDOWN - (now() - last.ts)) / 1000) };
    }
    const burst = rateCheck(key);
    if (burst.blocked) return { error: burst.reason };
    const verdict = screen ? screen(raw, { field: "消息", max: MAX_LEN }) : { blocked: false, clean: raw };
    if (verdict.blocked) return { error: verdict.reason || "内容不适合发出来" };
    const msg = {
      id: newId(), ch: r.key, from: user.id, name: user.name,
      avatar: user.avatar || "", text: verdict.clean.slice(0, MAX_LEN), ts: now(),
      flagged: !!verdict.flagged,
    };
    bucket.push(msg);
    const keep = r.kind === "world" ? WORLD_KEEP : r.kind === "map" ? MAP_KEEP : DM_KEEP;
    if (bucket.length > keep) bucket.splice(0, bucket.length - keep);
    doc.last[r.key] = msg.ts;
    // 私聊只推给对面那个人（外加自己其它 tab），别把别人的对话广播出去；
    // 未读也只算私聊：公共频道给每个人挂个红点，那是噪音不是消息。
    // 发出去的 ch 必须是**收件人自己那一份句柄**：内部 key 是排序后的 id 对
    // （"dm:a.b"），而客户端手里只有 "dm:<对方 id>"。把内部 key 发回去，客户端
    // 对不上号，就会把"我刚发的那句"当成别的会话——表现是发完一句，会话页被换回列表。
    if (r.kind === "dm") {
      pushToUser(r.peer, { t: "chat", ...msg, ch: "dm:" + user.id });
      bumpUnread(r.peer, r.key);
      pushToUser(user.id, { t: "chat", ...msg, ch: r.key }, via);
    } else {
      publish(r.key, { t: "chat", ...msg }, via);
    }
    trimBuckets();
    persist();
    return { ok: true, msg };
  }

  function bumpUnread(userId, ch) {
    const m = (doc.unread[userId] = doc.unread[userId] || {});
    m[ch] = Math.min(999, (m[ch] || 0) + 1);
  }
  function markRead(userId, ch) {
    if (!userId) return;
    const r = resolve(ch, userId);
    if (!r.ok) return;
    if (doc.unread[userId]) delete doc.unread[userId][r.key];
    persist();
  }
  function unreadOf(userId, ch) {
    const m = doc.unread[userId];
    if (!m) return 0;
    if (ch) { const r = resolve(ch, userId); return r.ok ? (m[r.key] || 0) : 0; }
    return Object.values(m).reduce((a, b) => a + (b || 0), 0);
  }

  /** 历史：after 用于增量拉取（轮询），before 用于往上翻。 */
  function history({ ch, viewerId, after = 0, before = 0, limit = 60 }) {
    const r = resolve(ch, viewerId);
    if (!r.ok) return { error: r.error };
    // 私聊的 key 是 resolve 用"我自己 + 对方"算出来的，能算出来就一定是当事人，
    // 不需要再查一遍归属。以前这里查的是"这条会话存不存在"，于是刚点开一个
    // 还没说过话的好友会话，看到的是一行"读不到这条私聊"。
    if (r.kind === "dm" && !viewerId) return { error: "先登录" };
    const bucket = bucketFor(r);
    let rows = bucket;
    if (after) rows = rows.filter((x) => x.ts > Number(after));
    else if (before) rows = rows.filter((x) => x.ts < Number(before));
    const n = clamp(limit, 1, 200);
    return { ok: true, channel: { key: r.key, kind: r.kind, title: r.title, peer: r.peer || null }, rows: rows.slice(-n) };
  }

  /** 面板要的"我的会话列表"：所有有往来的私聊 + 未读数 + 对方是谁。
   *  未读表的 key 一律是内部频道 key（"dm:a.b"），这里别再自己拼一套——
   *  两套 key 的代价就是"红点永远是 0"。 */
  function box(userId, userOf) {
    const threads = [];
    const un = doc.unread[userId] || {};
    for (const [pair, list] of Object.entries(doc.dms)) {
      if (!pair.split(".").includes(userId)) continue;
      const other = pair.split(".").find((x) => x !== userId);
      const last = list[list.length - 1];
      threads.push({
        ch: "dm:" + other, key: "dm:" + pair, peer: (userOf ? userOf(other) : null) || { id: other, name: "已注销" },
        last: last ? { from: last.from, name: last.name, text: last.text, ts: last.ts } : null,
        unread: un["dm:" + pair] || 0,
      });
    }
    threads.sort((a, b) => (b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0));
    return {
      threads,
      // 世界频道不给未读数：公共频道给每个人挂个红点是噪音，客户端自己记"看到哪儿了"
      world: { ch: "world", last: doc.world[doc.world.length - 1] || null },
      total: Object.values(doc.unread[userId] || {}).reduce((a, b) => a + (b || 0), 0),
    };
  }

  /** 地图频道列表：面板里"地图"那一档需要知道自己在哪张图，也用于详情页显示热度。 */
  const mapActivity = (id) => ({ count: (doc.maps[id] || []).length, last: doc.last["map:" + id] || 0 });

  return {
    resolve, post, history, markRead, unreadOf, box, mapActivity,
    attach, isOnline, onlineIds, pushToUser, subscribe, publish,
    stats: () => ({
      world: doc.world.length, maps: Object.keys(doc.maps).length,
      dms: Object.keys(doc.dms).length, online: online.size,
    }),
  };
}
