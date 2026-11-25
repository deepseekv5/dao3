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
import { blockColors, renderCover, renderModelPreview } from "./covers.mjs";
import { createChat } from "./chat.mjs";
// 资料字段的枚举表与前端共用一份文件：服务端只认这里列出来的 id，
// 前端负责把 id 翻成中文。抄两份必然出现"前端能选、后端报非法"。
import { REGIONS, GENDERS, PERSONA, LOOKING, MAX_PERSONA } from "../public/js/profile-fields.js";

const PUB_ID_RE = /^[a-f0-9]{12,24}$/;
const WORLD_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
// 官方 GameBodyPart 的 18 个槽位：骨骼皮肤那份"我们的槽 → 对方关节名"的映射表按它收。
const SKIN_SLOT_NAMES = ["hips", "torso", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot"];
// 运行时真正被姿态驱动的十个挂点（六块 + 四个二级关节），轴向覆盖表按它收。
const SKIN_AXIS_NAMES = ["head", "body", "armL", "armR", "legL", "legR", "elbowL", "elbowR", "kneeL", "kneeR"];
// 广场的主导航按玩法分，不按"精选/热门/新作"那种运营位分：
// 玩家找的是"有没有能跑一圈的图"，不是被推荐。
const CATEGORIES = ["竞速", "跑酷", "解谜", "生存", "角色扮演", "模拟经营", "创造", "对战", "恐怖", "休闲"];
const SESSION_COOKIE = "ly_session";
const CSRF_COOKIE = "ly_csrf";
const SESSION_TTL = 30 * 24 * 3600;
// 限流阈值可以按部署调；本机开发反复跑回归时，注册上限太紧会把自己锁在门外。
const RATE = {
  register: Number(process.env.COMMUNITY_RATE_REGISTER || 60),
  login: Number(process.env.COMMUNITY_RATE_LOGIN || 10),
  comment: Number(process.env.COMMUNITY_RATE_COMMENT || 20),
};

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
  fs.mkdirSync(path.join(root, "uploads"), { recursive: true });
  const fileOf = (k) => path.join(root, `${k}.json`);
  const DEFAULTS = {
    users: () => ({ byId: {}, byLower: {} }),
    sessions: () => ({}),
    graph: () => ({ follows: [], requests: [], friends: [], blocks: [] }),
    pubs: () => ({ byId: {} }),
    comments: () => ({ byPub: {} }),
    // 主页留言板：一个人的墙上别人能写几句，和评论区分开存——
    // 评论挂在作品上，留言挂在人身上，两者的删除权限与生命周期都不一样。
    guestbook: () => ({ byUser: {} }),
    notes: () => ({ list: [] }),
    history: () => ({ byUser: {} }),
    versions: () => ({ byPub: {} }),
    reports: () => ({ list: [] }),
    // 管理员动作单独记一份：封号、改角色、下架、删评论都要能回答"是谁在什么时候干的"。
    // 没有这一份的话后台是个黑箱，出问题时唯一能查的东西是 git log 和记忆。
    audit: () => ({ list: [] }),
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
    uploads: path.join(root, "uploads"),
    pubFile: (id) => path.join(pubs, `${id}.json.gz`),
    verFile: (pubId, v) => path.join(pubs, `${pubId}.v${v}.json.gz`),
    pubCover: (id) => path.join(pubs, `${id}.cover.png`),
    pubPreview: (id) => path.join(pubs, `${id}.preview.png`),
    pubModelFile: (id) => path.join(pubs, `${id}.voxa.json`),
    pubSkinFile: (id) => path.join(pubs, `${id}.skin.json`),
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

/** 二进制上传：原样收字节，带体积上限；不看 Content-Type，只看文件头。 */
function rawBody(req) {
  const chunks = req._rawChunks || [];
  return Buffer.concat(chunks);
}
/** 按文件魔数判类型：扩展名与 Content-Type 都是调用方可以随便写的。 */
function imageType(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 6 && buf.toString("latin1", 0, 3) === "GIF") return "gif";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * 一次请求只读一次体：图片上传要原始字节，JSON 接口要解析后的对象。
 * 先按 Content-Type 决定，判错也不丢字节（chunks 始终留在 req 上）。
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > 4 * 1024 * 1024) { req.destroy(); throw new Error("too-large"); }
    chunks.push(ch);
  }
  req._rawChunks = chunks;
  const buf = Buffer.concat(chunks);
  const ct = String(req.headers["content-type"] || "");
  if (ct && !/json/i.test(ct)) return {};            // 二进制上传：交给 rawBody()
  const text = buf.toString("utf8").trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("bad-json"); }
}

export function createCommunity({ dataRoot, worldsDir, assetRoot, assetRoots, moderation, atlas, presence } = {}) {
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

  const mod = moderation || { check: () => ({ level: "ok", reason: "" }), sanitize: (v) => String(v == null ? "" : v) };
  /** 过一遍审查：block 直接抛给调用方变成 400，flag 就在记录上打标记。 */
  function screen(text, opts) {
    const r = mod.check(text, opts);
    return { blocked: r.level === "block", flagged: r.level === "flag", reason: r.reason, clean: mod.sanitize(text) };
  }
  const userByName = (name) => {
    const id = docs.users.byLower[normName(name).toLowerCase()];
    return id ? docs.users.byId[id] : null;
  };
  /* ---------------- 资料字段 / 关系 / 聊天 ---------------- */
  const GENDER_IDS = new Set(GENDERS.map((g) => g.id));
  const TAG_IDS = new Set(PERSONA.map((p) => p.id));
  const LOOK_IDS = new Set(LOOKING.map((l) => l.id));
  /** 四档枚举资料：只认列出来的值，认不出就退回"未填"。
   *  照单全收等于让任何人都能把主页写成广告位。 */
  function normalizeProfile(u, body) {
    if ("region" in body) {
      const r = String(body.region || "").trim();
      u.region = REGIONS.includes(r) ? r : "";
    }
    if ("gender" in body) { const g = String(body.gender || ""); u.gender = GENDER_IDS.has(g) ? g : ""; }
    if ("persona" in body) {
      const list = Array.isArray(body.persona) ? body.persona : [];
      const out = [];
      for (const t of list) { const id = String(t || ""); if (TAG_IDS.has(id) && !out.includes(id)) out.push(id); }
      u.persona = out.slice(0, MAX_PERSONA);
    }
    if ("looking" in body) { const l = String(body.looking || ""); u.looking = LOOK_IDS.has(l) ? l : ""; }
  }
  const isFriend = (a, b) => !!a && !!b && docs.graph.friends.some((e) => e.k === pairKey(a, b));
  /** 拉黑是双向生效的：我挡了你，就别再让我看见你、也别再让请求和评论找上我。
   *  存在 graph.blocks 里，与关注/好友同一份文档——一起落盘、一起迁移。 */
  const blockedBetween = (a, b) => !!a && !!b && docs.graph.blocks.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const friendEdge = (a, b) => docs.graph.friends.find((e) => e.k === pairKey(a, b)) || null;
  const pubLive = (id) => {
    const p = docs.pubs.byId && docs.pubs.byId[id];
    return p && !p.removed && p.status === "live" ? p : null;
  };
  const chat = createChat({
    dataRoot: path.join(dataRoot, "chat"), screen, isFriend, livePub: pubLive,
  });
  /** 好友边上的"我的备注"：一条边两个人各存各的，谁加的谁叫得顺口。 */
  function friendNote(a, b) {
    const e = friendEdge(a, b);
    return (e && e.notes && e.notes[a]) || "";
  }
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
    const out = {
      id: u.id, name: u.name, bio: u.bio || "", createdAt: u.createdAt,
      avatar: u.avatar || null, banner: u.banner || null, skin: u.skin || null,
      role: u.role || "user",
      // 资料四件套：主页要显示、扩列要按它筛选，所以必须是公开字段（不含任何标识符之外的东西）
      region: u.region || "", gender: u.gender || "", persona: u.persona || [], looking: u.looking || "",
      online: chat.isOnline(u.id),
    };
    if (!viewerId || viewerId === u.id) { if (viewerId === u.id) out.counts = countsOf(u.id); return out; }
    out.relation = {
      following: docs.graph.follows.some((e) => e.a === viewerId && e.b === u.id),
      followedBy: docs.graph.follows.some((e) => e.a === u.id && e.b === viewerId),
      friend: docs.graph.friends.some((e) => e.k === pairKey(viewerId, u.id)),
      pendingOut: docs.graph.requests.some((e) => e.from === viewerId && e.to === u.id),
      pendingIn: docs.graph.requests.some((e) => e.from === u.id && e.to === viewerId),
      // 拉黑是双向的，但界面要说清是"我挡的"还是"被挡的"——两者能点的按钮不一样。
      blocked: docs.graph.blocks.some((e) => e.a === viewerId && e.b === u.id),
      blockedBy: docs.graph.blocks.some((e) => e.a === u.id && e.b === viewerId),
    };
    const note = friendNote(viewerId, u.id);
    if (note) out.note = note;
    out.counts = countsOf(u.id);
    return out;
  }

  function addReport(targetType, targetId, ownerId, reason, byId, pubId) {
    const text = String(reason || "").slice(0, 200);
    const dup = docs.reports.list.find((r) => r.target === targetId && r.by === byId);
    if (dup) return;                       // 同一个人重复举报不叠加
    docs.reports.list.unshift({ id: newId(6), target: targetId, targetType, owner: ownerId, reason: text, by: byId, pubId: pubId || null, ts: now(), state: "open" });
    while (docs.reports.list.length > 500) docs.reports.list.pop();
    store.touch("reports");
  }

  /** 封禁到没到期。到期就**当场把标记清掉**并落盘：解封不靠有人来点按钮，
   *  否则一张过期封条会一直挂着，直到某个管理员恰好想起这个人。 */
  function bannedNow(u) {
    if (!u || !u.banned) return false;
    if (u.bannedUntil && u.bannedUntil <= now()) {
      u.banned = false; delete u.bannedUntil; delete u.bannedReason;
      store.touch("users");
      return false;
    }
    return true;
  }

  /** 管理员动作留痕。只记"谁对谁做了什么"，不记参数原文（封禁原因已经在用户身上）。 */
  function addAudit(byId, action, targetName, detail) {
    docs.audit.list.unshift({ id: newId(6), by: byId, action, target: String(targetName || "").slice(0, 64), detail: String(detail || "").slice(0, 160), ts: now() });
    while (docs.audit.list.length > 800) docs.audit.list.pop();
    store.touch("audit");
  }

  /** 删掉一件作品留在盘上的全部痕迹：快照、封面、预览、模型/皮肤正文、资产目录、历史版本。
   *  它们共用 `<id>.` 前缀，所以按前缀清一次，而不是逐个猜扩展名（封面可能是 .jpg）。 */
  function dropPubArtifacts(id) {
    const dir = path.dirname(store.pubFile(id));
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return 0; }
    let n = 0;
    for (const name of names) {
      if (name !== id && !name.startsWith(id + ".")) continue;
      try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); n++; } catch { /* 删不掉就留着，别把接口 500 */ }
    }
    return n;
  }

  function notify(to, kind, actorId, pubId, text) {
    if (!to || to === actorId) return;
    docs.notes.list.unshift({ id: newId(6), to, kind, actorId: actorId || null, pubId: pubId || null, text: text ? String(text).slice(0, 200) : "", ts: now(), read: false });
    while (docs.notes.list.length > 800) docs.notes.list.pop();
    store.touch("notes");
  }

  /** 一张发布自己的口碑分：踩是要扣分的，只加不减的话"一堆人顶 + 一堆人踩"
   *  会排得比"没人理"还高，而后者才是更该被看到的新图。 */
  function voteScore(p) {
    const up = (p.votes && p.votes.up || []).length;
    const down = (p.votes && p.votes.down || []).length;
    return up * 4 - down * 4;
  }

  function pubCard(p, viewerId) {
    const author = docs.users.byId[p.authorId];
    const up = (p.votes && p.votes.up) || [];
    const down = (p.votes && p.votes.down) || [];
    const favs = p.favs || [];
    const mineVote = up.includes(viewerId) ? 1 : down.includes(viewerId) ? -1 : 0;
    return {
      id: p.id, worldId: p.worldId, title: p.title, desc: p.desc, tags: p.tags || [],
      kind: p.kind || "map", version: p.version || 1, flagged: !!p.flagged,
      created: p.created, updated: p.updated, plays: p.plays || 0,
      likes: (p.likes || []).length, likedByMe: !!viewerId && (p.likes || []).includes(viewerId),
      /** 好评率只在"有人表过态"时给数。三票两踩写"100% 好评"是编的，
       *  所以一票没有时给 null，让界面显示"暂无评分"而不是一个假的高分。 */
      up: up.length, down: down.length, votedByMe: mineVote,
      rating: up.length + down.length ? Math.round((up.length / (up.length + down.length)) * 100) : null,
      favs: favs.length, favByMe: !!viewerId && favs.includes(viewerId),
      // 正在玩是实时房间人数，不是累计游玩数；没有注入（比如测试里）就给 0，
      // 而不是 undefined——前端拿到 undefined 会渲染成空白，看起来像坏了。
      playing: presence ? presence(p.id) : 0,
      comments: commentsOf(p.id).length, hasCover: !!p.hasCover, bytes: p.bytes, shape: p.shape || null,
      assets: p.assets || 0,
      mine: !!viewerId && viewerId === p.authorId,
      author: author ? { id: author.id, name: author.name, avatar: author.avatar || null } : null,
    };
  }
  /** 只允许站内上传目录里的图片路径，挡掉 //host 与 javascript: 这类。 */
  function safeAssetPath(v) {
    const s = String(v || "").trim();
    if (!s) return null;
    return s.startsWith("/api/community/uploads/") && !s.startsWith("//") ? s.slice(0, 120) : null;
  }
  /** 站内资产路径：随包预设、用户上传、别的发布带进来的附件，以及随包的骨骼模型目录。
   *  放行外链等于让每个访问者替作者去敲第三方的门，data: 则把几百 KB 塞进用户档案。
   *  /skins/ 必须在这张表里：那是随包的 CC0 机甲，「穿上默认皮肤」写的就是这个路径，
   *  不收的话账号皮肤永远换不到那台机甲（服务端悄悄把 model 丢掉，前端只会说"没接受"）。 */
  const ASSET_RE = /^\/(img\/skins\/|skins\/|api\/community\/(uploads|pubs)\/|assets\/worlds\/)[A-Za-z0-9_.\/%?=&-]{1,180}$/;
  const assetUrl = (v) => (typeof v === "string" && !v.startsWith("//") && ASSET_RE.test(v) ? v.slice(0, 200) : null);
  /** 账号皮肤：只留认识的键，颜色必须 #rrggbb，资产只能指向站内。 */
  function normalizeSkin(v) {
    const src = v && typeof v === "object" ? v : {};
    const hex = (x, d) => (/^#[0-9a-fA-F]{6}$/.test(String(x)) ? String(x).toLowerCase() : d);
    const out = {
      skin: hex(src.skin, "#e7b98f"), shirt: hex(src.shirt, "#d5a24a"), pants: hex(src.pants, "#2b3440"),
      hair: hex(src.hair, "#2a211d"), shoe: hex(src.shoe, "#eee9df"),
    };
    const model = assetUrl(src.model);
    if (model) out.model = model;
    /** 体型三档（身高 / 宽窄 / 腿长）：只收这个区间里的数，越界夹回来而不是拒掉整份皮肤。
     *  放任任意值等于让人把自己拉到看不见、或者撑破第三人称相机。 */
    const bd = src.body && typeof src.body === "object" ? src.body : null;
    if (bd) {
      const mul = (x) => (Number.isFinite(Number(x)) ? Math.min(1.25, Math.max(0.8, Number(x))) : 1);
      const body = { h: mul(bd.h), w: mul(bd.w), leg: mul(bd.leg) };
      // 全 1 就不存：默认值写进档案会让每一份皮肤记录都多三个数，
      // 以后想改默认身材得先迁移几百个账号。
      if (body.h !== 1 || body.w !== 1 || body.leg !== 1) out.body = body;
    }
    // MC 贴图皮肤：只认站内路径（随包预设 /img/skins/、用户上传 /api/community/uploads/）。
    const texture = assetUrl(src.texture);
    if (texture && /\.(png|jpe?g|webp)$/i.test(texture)) out.texture = texture;
    if (typeof src.name === "string") out.name = String(src.name).slice(0, 24);
    // 骨骼皮肤（机甲那类）：kind + 关节映射 + 每根关节的摆动轴。运行时按它把人偶
    // 的姿态写到对方骨架上，所以这三样必须能跟着账号走、也能从联机那边透传。
    // 认不全关节（<6 根）就整组不当它是骨骼皮肤：半台机甲只躯干跟着动，比没有更难看。
    if (out.model && src.kind === "rig") {
      const bones = src.bones && typeof src.bones === "object" ? src.bones : {};
      const map = {};
      for (const k of SKIN_SLOT_NAMES) {
        const v2 = String(bones[k] || "").slice(0, 48);
        if (v2) map[k] = v2;
      }
      if (Object.keys(map).length >= 6) {
        out.kind = "rig";
        out.bones = map;
        const axes = src.axes && typeof src.axes === "object" ? src.axes : {};
        const amap = {};
        for (const k of SKIN_AXIS_NAMES) {
          const a = axes[k];
          if (a && ["x", "y", "z"].includes(a.ax)) amap[k] = { ax: a.ax, sign: a.sign < 0 ? -1 : 1 };
        }
        if (Object.keys(amap).length) out.axes = amap;
        const sc = Number(src.scale);
        if (Number.isFinite(sc) && sc > 0.02 && sc < 50) out.scale = +sc.toFixed(4);
        if (Number(src.flip) < 0) out.flip = -1;    // 手动把推导出来的朝向翻 180°
      }
    }
    return out;
  }
  /** 皮肤库里那条记录（六块色 + 可选贴图/骨骼），发布到皮肤社区时吃这个。 */
  function normalizeSkinDoc(v) {
    const src = v && typeof v === "object" ? v : {};
    const hex = (x, d) => (/^#[0-9a-fA-F]{6}$/.test(String(x)) ? String(x).toLowerCase() : d);
    const out = { name: String(src.name || "未命名皮肤").trim().slice(0, 24) || "未命名皮肤" };
    const six = src.skin && typeof src.skin === "object" ? src.skin : {};
    out.skin = {
      head: hex(six.head, "#e7b98f"), body: hex(six.body, "#d5a24a"),
      armL: hex(six.armL, "#d5a24a"), armR: hex(six.armR, "#d5a24a"),
      legL: hex(six.legL, "#2b3440"), legR: hex(six.legR, "#222b36"),
    };
    // 资产本体（贴图 PNG / 骨骼 GLB）不进这条记录：发布时按 base64 附件收进
    // 这份快照自己的 .assets/ 目录，记录里只留指回它的站内路径。
    const tex = assetUrl(src.texture);
    if (tex && /\.(png|jpe?g|webp)$/i.test(tex)) out.texture = tex;
    const mdl = assetUrl(src.model);
    if (mdl && /\.(glb|gltf)$/i.test(mdl)) out.model = mdl;
    // 骨骼那一大段必须"有模型 + 认得出至少 6 根关节"才成立，否则整组丢掉：
    // kind 留着而 model/bones 空着，运行时读出来就是一个既不是人偶也不是机甲的怪胎。
    const bones = src.bones && typeof src.bones === "object" ? src.bones : {};
    const bmap = {};
    for (const k of SKIN_SLOT_NAMES) {
      const b = String(bones[k] || "").slice(0, 48);
      if (b) bmap[k] = b;
    }
    if (src.kind === "rig" && out.model && Object.keys(bmap).length >= 6) {
      out.kind = "rig";
      out.bones = bmap;
      const axes = src.axes && typeof src.axes === "object" ? src.axes : {};
      const amap = {};
      for (const k of SKIN_AXIS_NAMES) {
        const a = axes[k];
        if (a && ["x", "y", "z"].includes(a.ax)) amap[k] = { ax: a.ax, sign: a.sign < 0 ? -1 : 1 };
      }
      if (Object.keys(amap).length) out.axes = amap;
      const sc = Number(src.scale);
      if (Number.isFinite(sc) && sc > 0.02 && sc < 50) out.scale = +sc.toFixed(4);
      if (Number(src.flip) < 0) out.flip = -1;
    }
    return out;
  }
  const commentCard = (c, viewerId) => {
    const u = docs.users.byId[c.userId];
    return {
      id: c.id, body: c.body, ts: c.ts, likes: (c.likes || []).length, flagged: !!c.flagged,
      likedByMe: !!viewerId && (c.likes || []).includes(viewerId),
      mine: !!viewerId && c.userId === viewerId,
      reply: c.replyTo || null,
      author: u ? { id: u.id, name: u.name, avatar: u.avatar || null } : { id: null, name: "已注销", avatar: null },
    };
  };

  /** 留言板上一句话的读法：谁写的、写了什么、什么时候，以及"这条是不是我写的"。 */
  const wallCard = (m, viewerId) => {
    const u = docs.users.byId[m.from];
    return {
      id: m.id, text: m.text, ts: m.ts, flagged: !!m.flagged, mine: m.from === viewerId,
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

    if (viewerId && bannedNow(docs.users.byId[viewerId])) {
      reply.fail(403, "这个账号已被封禁，只能浏览"); return true;
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
    const isAdmin = () => !!(viewerId && docs.users.byId[viewerId] && docs.users.byId[viewerId].role === "admin");

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
      if ("bio" in body) {
        const r = screen(body.bio, { field: "简介", max: 200 });
        if (r.blocked) { reply.fail(400, r.reason); return true; }
        u.bio = r.clean.trim().slice(0, 200); u.bioFlagged = r.flagged;
      }
      // 昵称可以改：和注册同一套规则，且不能撞别人的名字
      if ("name" in body) {
        const nn = normName(body.name);
        if (!NAME_RE.test(nn)) { reply.fail(400, "名字要 2–20 个字符，只能用中英文、数字、空格、_ 与 -"); return true; }
        const r = screen(nn, { field: "名字", max: 20 });
        if (r.blocked) { reply.fail(400, r.reason); return true; }
        const taken = docs.users.byLower[nn.toLowerCase()];
        if (taken && taken !== u.id) { reply.fail(409, "这个名字已经被占了"); return true; }
        delete docs.users.byLower[u.lower];
        u.name = nn; u.lower = nn.toLowerCase(); u.nameFlagged = r.flagged;
        docs.users.byLower[u.lower] = u.id;
      }
      // 头像/横幅只认站内上传后的相对路径，不接受外部 URL
      for (const k of ["avatar", "banner"]) {
        if (k in body) u[k] = safeAssetPath(body[k]);
      }
      if ("skin" in body) u.skin = normalizeSkin(body.skin);
      normalizeProfile(u, body);
      store.touch("users");
      reply.json(200, { user: publicUser(u, viewerId) });
      return true;
    });

    if (seg[0] === "register" && method === "POST") {
      const name = normName(body.name), pw = String(body.password || "");
      if (!NAME_RE.test(name)) { reply.fail(400, "名字要 2–20 个字符，只能用中英文、数字、空格、_ 与 -"); return true; }
      if (pw.length < 8 || pw.length > 128) { reply.fail(400, "口令至少 8 位，最多 128 位"); return true; }
      if (userByName(name)) { reply.fail(409, "这个名字已经被占了"); return true; }
      if (limited("reg", req.socket.remoteAddress || "?", RATE.register, 10 * 60 * 1000)) { reply.fail(429, "注册太频繁，等一会儿再试"); return true; }
      { const r = screen(name, { field: "名字", max: 20 }); if (r.blocked) { reply.fail(400, r.reason); return true; } }
      const first = Object.keys(docs.users.byId).length === 0;
      const u = {
        id: newId(), name, lower: name.toLowerCase(), ...hashPassword(pw),
        bio: "", avatar: null, banner: null, skin: null,
        // 资料四件默认全空：注册对话框不该逼人家填性别，主页空着就是"没写"
        region: "", gender: "", persona: [], looking: "",
        role: first ? "admin" : "user", createdAt: now(),
      };
      docs.users.byId[u.id] = u;
      docs.users.byLower[u.lower] = u.id;
      store.touch("users");
      const c = startSession(reply, u.id);
      reply.json(200, { user: publicUser(u, u.id), csrf: c });
      return true;
    }

    if (seg[0] === "login" && method === "POST") {
      const name = normName(body.name);
      if (limited("login", `${name.toLowerCase()}|${req.socket.remoteAddress || "?"}`, RATE.login, 5 * 60 * 1000)) {
        reply.fail(429, "试得太多次了，5 分钟后再来"); return true;
      }
      const u = userByName(name);
      const ok = verifyPassword(body.password, u || DUMMY) && !!u;
      if (!ok) { reply.fail(401, "名字或口令不对"); return true; }
      if (bannedNow(u)) { reply.fail(403, "这个账号已被封禁：" + String(u.bannedReason || "违反社区规则")); return true; }
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

    /* ---------------- 上传图片（封面 / 头像 / 横幅 / 模型预览） ---------------- */
    if (seg[0] === "upload" && method === "POST") return login(() => {
      const kind = ["cover", "avatar", "banner", "preview", "skin"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "cover";
      const buf = rawBody(req);
      if (!buf.length) { reply.fail(400, "空的上传体"); return true; }
      if (buf.length > 3 * 1024 * 1024) { reply.fail(413, "图片最大 3 MB"); return true; }
      const ext = imageType(buf);
      if (!ext) { reply.fail(400, "只接受 PNG / JPEG / WEBP / GIF"); return true; }
      const fname = newId() + "." + ext;
      fs.writeFileSync(path.join(store.uploads, fname), buf);
      // 封面可以直接落到某个发布上：省掉"先上传、再引用"的两次来回
      const pid = url.searchParams.get("pub");
      if (pid && docs.pubs.byId[pid] && docs.pubs.byId[pid].authorId === viewerId) {
        fs.copyFileSync(path.join(store.uploads, fname), store.pubCover(pid));
        docs.pubs.byId[pid].hasCover = true;
        docs.pubs.byId[pid].updated = now();
        store.touch("pubs");
      }
      reply.json(200, { url: "/api/community/uploads/" + fname, kind, bytes: buf.length });
      return true;
    });
    if (seg[0] === "uploads" && method === "GET") {
      const f = path.join(store.uploads, path.basename(String(seg[1] || "")));
      if (!seg[1] || !f.startsWith(store.uploads) || !fs.existsSync(f)) { reply.fail(404, "没有这个文件"); return true; }
      const ext = path.extname(f).slice(1).toLowerCase();
      reply.raw(200, fs.readFileSync(f), {
        "Content-Type": ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      });
      return true;
    }

    /* ---------------- 用户 / 关注 / 好友 ---------------- */
    if (seg[0] === "users") {
      const u = userByName(seg[1]);
      if (!u) { reply.fail(404, "没有这个用户"); return true; }
      const sub = seg[2];
      if (!sub) { reply.json(200, { user: publicUser(u, viewerId) }); return true; }
      /* 留言板挂在人身上，所以它必须在这一段里处理——下面那句 `这里只读` 是给别的主页子路由的。 */
      if (sub === "guestbook") {
        const list = docs.guestbook.byUser[u.id] || (docs.guestbook.byUser[u.id] = []);
        if (method === "GET") {
          reply.json(200, {
            total: list.length,
            rows: list.slice(-60).reverse().map((m) => wallCard(m, viewerId)),
            // 能不能写是服务端说了算：自己的墙、被拉黑、没登录，三种都给不出输入框
            canPost: !!viewerId && viewerId !== u.id && !blockedBetween(viewerId, u.id),
            mine: viewerId === u.id,
          });
          return true;
        }
        if (method === "POST") return login(() => {
          if (viewerId === u.id) { reply.fail(400, "这是你自己的墙，想说什么写进签名里"); return true; }
          if (blockedBetween(viewerId, u.id)) { reply.fail(403, "你们之间有一方拉黑了对方"); return true; }
          const r = screen(body.text, { field: "留言", max: 200 });
          if (r.blocked) { reply.fail(400, r.reason); return true; }
          const text = r.clean.trim();
          if (!text) { reply.fail(400, "留言不能是空的"); return true; }
          if (limited("wall", viewerId, 10, 60 * 1000)) { reply.fail(429, "留言太频繁了，缓一分钟再写"); return true; }
          const m = { id: newId(6), from: viewerId, text, ts: now(), flagged: r.flagged };
          list.push(m);
          while (list.length > 200) list.shift();
          store.touch("guestbook");
          notify(u.id, "wall", viewerId);
          reply.json(200, { row: wallCard(m, viewerId), total: list.length });
          return true;
        });
        if (method === "DELETE" && seg[3]) return login(() => {
          const i = list.findIndex((x) => x.id === seg[3]);
          if (i < 0) { reply.fail(404, "没有这条留言"); return true; }
          // 三种人删得掉：写的人、墙的主人、超级管理员。别人一概不行。
          if (list[i].from !== viewerId && u.id !== viewerId && !isAdmin()) { reply.fail(403, "只有留言的人、墙的主人或超级管理员能删"); return true; }
          list.splice(i, 1);
          store.touch("guestbook");
          reply.json(200, { ok: true });
          return true;
        });
        reply.fail(405, "留言板只认 GET / POST / DELETE");
        return true;
      }
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
        const kind = url.searchParams.get("kind");
        const rows = livePubs().filter((p) => p.authorId === u.id && (!kind || (p.kind || "map") === kind))
          .sort((a, b) => b.created - a.created).map((p) => pubCard(p, viewerId));
        reply.json(200, { rows });
        return true;
      }
      if (sub === "favorites") {
        // 收藏清单和最近游玩走同一条隐私规矩：只有本人与管理员看得全。
        // "他收藏了什么"是可以反推兴趣的，公开出来就等于替人做了决定。
        if (!(viewerId === u.id || isAdmin())) { reply.fail(403, "收藏清单只有本人看得到"); return true; }
        const rows = livePubs().filter((p) => (p.favs || []).includes(u.id))
          .sort((a, b) => (b.updated || b.created) - (a.updated || a.created))
          .map((p) => pubCard(p, viewerId));
        reply.json(200, { rows });
        return true;
      }
      if (sub === "recent") {
        // 最近游玩只有本人和管理员看得全，别人主页只显示公开的那几条
        const rows = (docs.history.byUser[u.id] || []).slice(0, viewerId === u.id || isAdmin() ? 20 : 6)
          .map((h) => ({ ...h, pub: docs.pubs.byId[h.pubId] ? pubCard(docs.pubs.byId[h.pubId], viewerId) : null }))
          .filter((h) => h.pub);
        reply.json(200, { rows });
        return true;
      }
    }

    if (seg[0] === "follow" && method === "POST") {
      if (!viewerId) { reply.fail(401, "先登录"); return true; }
      const target = userParam(body.name);
      if (!target) return true;
      if (target.id === viewerId) { reply.fail(400, "不能关注自己"); return true; }
      if (blockedBetween(viewerId, target.id)) { reply.fail(403, "你们之间有一方拉黑了对方"); return true; }
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
      // 「可能认识的人」= 好友们在跟的人，去掉我自己、已加好友的。
      // 光给一个名字没有说服力：同一份数据顺手算出"我的好友里有几个人跟了 TA"，
      // 前端才写得出一句理由，也才排得出谁更可能认识。
      const friendIds = new Set(docs.graph.friends.filter((e) => e.a === viewerId || e.b === viewerId).map((e) => e.a === viewerId ? e.b : e.a));
      const known = new Set([viewerId, ...friendIds]);
      const followers = new Map();
      for (const f of docs.graph.follows) {
        if (friendIds.has(f.a) && !known.has(f.b)) followers.set(f.b, (followers.get(f.b) || 0) + 1);
      }
      const suggested = [...followers].filter(([id]) => docs.users.byId[id] && !blockedBetween(viewerId, id))
        .map(([id, mutual]) => ({ ...publicUser(docs.users.byId[id], viewerId), mutual }))
        .sort((x, y) => y.mutual - x.mutual || x.name.localeCompare(y.name, "zh"));
      reply.json(200, { friends, incoming, outgoing, suggested: suggested.slice(0, 12) });
      return true;
    });

    if (seg[0] === "friend") return login(() => {
      const action = seg[1];
      const target = userParam(body.name);
      if (!target) return true;
      if (target.id === viewerId) { reply.fail(400, "不能加自己为好友"); return true; }
      if (blockedBetween(viewerId, target.id)) { reply.fail(403, "你们之间有一方拉黑了对方"); return true; }
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
      if (action === "note") {
        const e = friendEdge(viewerId, target.id);
        if (!e) { reply.fail(404, "你们不是好友，备注不了"); return true; }
        const r = screen(body.note, { field: "备注", max: 20 });
        if (r.blocked) { reply.fail(400, r.reason); return true; }
        e.notes = e.notes || {};
        const v = normName(r.clean).slice(0, 20);
        if (v) e.notes[viewerId] = v; else delete e.notes[viewerId];
        store.touch("graph");
        reply.json(200, { ok: true, note: v });
        return true;
      }
      reply.fail(404, "好友接口没有这个动作：" + action);
      return true;
    });

    /* ---------------- 扩列：把陌生人找出来 ---------------- */
    // 原来只有「可能认识的人」= 好友在跟的人，硬截 12 条。想主动找人（按地区、
    // 按性格、按"欢迎扩列"）没有入口，所以这一块是新开的读接口，不碰老逻辑。
    if (seg[0] === "people" && method === "GET") {
      const q = normName(url.searchParams.get("q")).toLowerCase();
      const region = REGIONS.includes(url.searchParams.get("region")) ? url.searchParams.get("region") : "";
      const gender = GENDER_IDS.has(url.searchParams.get("gender")) ? url.searchParams.get("gender") : "";
      const tag = TAG_IDS.has(url.searchParams.get("tag")) ? url.searchParams.get("tag") : "";
      const sort = ["new", "active", "name"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "active";
      // 默认是"扩列"口径：写了不扩列的人不出现在这里。搜名字那种明确找人的场景
      // 由前端带 all=1 走另一条。
      const expand = url.searchParams.get("all") !== "1";
      const offset = clamp(url.searchParams.get("offset"), 0, 5000);
      const limit = clamp(url.searchParams.get("limit") || 24, 1, 60);
      const lastPub = new Map();
      for (const p of livePubs()) if (!lastPub.has(p.authorId) || p.created > lastPub.get(p.authorId)) lastPub.set(p.authorId, p.created);
      let rows = Object.values(docs.users.byId)
        .filter((u) => !bannedNow(u) && u.id !== viewerId)
        .filter((u) => !blockedBetween(viewerId, u.id))   // 拉黑过的两边都别再互相出现在"找人"里
        .filter((u) => !expand || (u.looking && u.looking !== "none"))
        .filter((u) => !region || u.region === region)
        .filter((u) => !gender || u.gender === gender)
        .filter((u) => !tag || (u.persona || []).includes(tag))
        .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.bio || "").toLowerCase().includes(q));
      const act = (u) => Math.max(lastPub.get(u.id) || 0, u.createdAt || 0);
      rows = rows.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh")
        : sort === "new" ? (b.createdAt - a.createdAt) : (act(b) - act(a)));
      const total = rows.length;
      const page = rows.slice(offset, offset + limit).map((u) => publicUser(u, viewerId));
      reply.json(200, { rows: page, total, more: offset + page.length < total });
      return true;
    }

    /* ---------------- 聊天：世界频道 / 地图频道 / 好友私聊 ---------------- */
    if (seg[0] === "chat" && method === "GET") {
      const h = chat.history({
        ch: url.searchParams.get("ch"), viewerId,
        after: url.searchParams.get("after") || 0,
        before: url.searchParams.get("before") || 0,
        limit: url.searchParams.get("limit") || 60,
      });
      if (h.error) { reply.fail(400, h.error); return true; }
      reply.json(200, { channel: h.channel, rows: h.rows, now: now() });
      return true;
    }
    if (seg[0] === "chat" && method === "POST" && seg[1] === "read") return login(() => {
      chat.markRead(viewerId, body.ch);
      reply.json(200, { ok: true, unread: chat.unreadOf(viewerId) });
      return true;
    });
    if (seg[0] === "chat" && method === "POST") return login(() => {
      const u = docs.users.byId[viewerId];
      const r = chat.post({ ch: body.ch, user: u, text: body.text });
      if (r.error) { reply.fail(r.wait ? 429 : 400, r.error + (r.wait ? `（再过 ${r.wait} 秒）` : "")); return true; }
      reply.json(200, { ok: true, msg: r.msg });
      return true;
    });
    if (seg[0] === "channels" && method === "GET") return login(() => {
      reply.json(200, Object.assign(chat.box(viewerId, (id) => publicUser(docs.users.byId[id], viewerId)), {
        online: chat.onlineIds().length,
        friendsOnline: docs.graph.friends
          .filter((e) => e.a === viewerId || e.b === viewerId)
          .map((e) => docs.users.byId[e.a === viewerId ? e.b : e.a])
          .filter((x) => x && chat.isOnline(x.id)).length,
      }));
      return true;
    });

    /* ---------------- 广场 / 发布 ---------------- */
    if (seg[0] === "feed" && method === "GET") {
      const sort = ["new", "hot", "following", "foryou"].includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "new";
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      // 玩法分类是广场的主导航，不是标签云：作者多半不会自己打标签，
      // 所以标题与简介里出现这个词也算命中，否则每个分类都是空的。
      const cat = CATEGORIES.includes(url.searchParams.get("cat")) ? url.searchParams.get("cat") : "";
      // 地图和模型混在一条流里时，模型永远排在后面：它没有"游玩"这个动作，
      // 热度天然低一截。给一个按类型切的开关，两边才谈得上都能被看到、被评论。
      const kind = ["map", "model", "skin"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "";
      let rows = livePubs();
      if (kind) rows = rows.filter((p) => (p.kind || "map") === kind);
      if (cat) {
        rows = rows.filter((p) => (p.tags || []).includes(cat)
          || `${p.title} ${p.desc}`.toLowerCase().includes(cat.toLowerCase()));
      }
      if (q) {
        rows = rows.filter((p) => `${p.title} ${p.desc} ${(p.tags || []).join(" ")} ${docs.users.byId[p.authorId]?.name || ""}`.toLowerCase().includes(q));
      }
      if (sort === "foryou") {
        // "推荐"在本地能做的就一件事：把已经玩过的排出去，再按热度打分。
        // 没看过的人、没有行为数据的新号，这里就退化成热榜——那是诚实的退化，
        // 而不是编一个"算法"出来。没登录时同样退化成热榜（不报错）。
        if (viewerId) {
          const seen = new Set((docs.history.byUser[viewerId] || []).map((h) => h.pubId));
          rows = rows.filter((p) => !seen.has(p.id) && p.authorId !== viewerId);
        }
      }
      if (sort === "following") {
        if (!viewerId) { reply.fail(401, "看关注流要先登录"); return true; }
        const ids = new Set(docs.graph.follows.filter((e) => e.a === viewerId).map((e) => e.b));
        ids.add(viewerId);
        rows = rows.filter((p) => ids.has(p.authorId));
      }
      // 拉黑的人不进我的任何一条流：筛选发生在排序之前，免得"第 2 页突然全是同一个人"。
      if (viewerId) rows = rows.filter((p) => !blockedBetween(viewerId, p.authorId));
      const score = (p) => (p.likes || []).length * 3 + (p.plays || 0) + commentsOf(p.id).length * 2
        + (p.favs || []).length * 2 + voteScore(p);
      rows.sort((a, b) => (sort === "hot" || sort === "foryou" ? score(b) - score(a) || b.created - a.created : b.created - a.created));
      const offset = clamp(url.searchParams.get("offset") || 0, 0, 1e6);
      const limit = clamp(url.searchParams.get("limit") || 24, 1, 100);
      /* 首页右侧那一栏要的三样东西在这里一起给：分类瓷砖的底图、最新发布、当前在线的人。
         分类瓷砖没有图时前端退回纯色——不去编一张图，也不留一个空格子。 */
      const pool = livePubs();
      const catCovers = {}, catCounts = {};
      for (const c of CATEGORIES) {
        const hit = pool.filter((p) => (p.tags || []).includes(c))
          .sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.updated || 0) - (a.updated || 0))[0];
        if (hit && hit.hasCover) catCovers[c] = hit.id;
        // 分类里有几张是真数出来的：瓷砖上写"竞速 · 3"，比一个只有名字的按钮有信息
        catCounts[c] = pool.filter((p) => (p.tags || []).includes(c)).length;
      }
      const online = chat.onlineIds().map((id) => docs.users.byId[id]).filter(Boolean)
        .filter((u) => !blockedBetween(viewerId, u.id)).slice(0, 30)
        .map((u) => ({ name: u.name, avatar: u.avatar || null, role: u.role || "user" }));
      const recent = pool.slice().sort((a, b) => b.created - a.created).slice(0, 6)
        .filter((p) => !blockedBetween(viewerId, p.authorId)).map((p) => pubCard(p, viewerId));
      reply.json(200, { total: rows.length, sort, cat, cats: CATEGORIES, catCovers, catCounts, recent, online,
        offset, rows: rows.slice(offset, offset + limit).map((p) => pubCard(p, viewerId)) });
      return true;
    }

    if (seg[0] === "publish" && method === "POST") return login(() => {
      const kind = body.kind === "model" ? "model" : body.kind === "skin" ? "skin" : "map";
      const t = screen(body.title, { field: "标题", max: 60 });
      const d = screen(body.desc, { field: "简介", max: 2000 });
      if (t.blocked) { reply.fail(400, t.reason); return true; }
      if (d.blocked) { reply.fail(400, d.reason); return true; }
      const title = t.clean.trim().slice(0, 60);
      if (title.length < 2) { reply.fail(400, "标题至少 2 个字"); return true; }
      const tags = (Array.isArray(body.tags) ? body.tags : [])
        .map((x) => screen(x, { field: "标签", max: 16 }).clean.trim().slice(0, 16)).filter(Boolean).slice(0, 6);

      let shape = null, srcFile = null, bytes = 0, key = "";
      let skinDoc = null, skinAttach = null;
      if (kind === "map") {
        const wid = String(body.worldId || "");
        if (!WORLD_ID_RE.test(wid)) { reply.fail(400, "worldId 不合法"); return true; }
        const src = path.join(worldsDir, `${wid}.json.gz`);
        if (!fs.existsSync(src)) { reply.fail(404, "本地找不到这个世界"); return true; }
        try { shape = JSON.parse(zlib.gunzipSync(fs.readFileSync(src))).shape || null; }
        catch { reply.fail(400, "世界存档读不出来，发布先取消"); return true; }
        srcFile = src; key = "map:" + wid;
      } else if (kind === "skin") {
        skinDoc = normalizeSkinDoc(body.skin);
        const json = JSON.stringify(skinDoc);
        if (json.length > 64 * 1024) { reply.fail(413, "皮肤记录太大（64 KB 上限）"); return true; }
        // 贴图 PNG 与骨骼 GLB 走 base64 附件（和模型发布同一条通道）。
        // 上限分开：一张 64×64 展开图几十 KB，而一台机甲是几 MB。
        const b64size = (v) => (typeof v === "string" && v ? Math.floor(v.length * 3 / 4) : 0);
        skinAttach = {
          texture: typeof body.textureB64 === "string" && body.textureB64 ? body.textureB64 : null,
          model: typeof body.modelB64 === "string" && body.modelB64 ? body.modelB64 : null,
        };
        if (b64size(skinAttach.texture) > 3 * 1024 * 1024) { reply.fail(413, "贴图超过 3 MB"); return true; }
        if (b64size(skinAttach.model) > 24 * 1024 * 1024) { reply.fail(413, "骨骼模型超过 24 MB"); return true; }
        key = "skin:" + String(body.slug || skinDoc.name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40);
        bytes = Buffer.byteLength(json);
        srcFile = { text: json, doc: skinDoc };
      } else {
        // 模型发布：VOXA 文档 + 可选 glb/vox 附件，都走 base64（同一个 JSON 通道，省一套 multipart）
        const doc = body.doc;
        if (!doc || typeof doc !== "object") { reply.fail(400, "模型内容为空"); return true; }
        const json = JSON.stringify(doc);
        if (json.length > 8 * 1024 * 1024) { reply.fail(413, "模型太大（8 MB 上限）"); return true; }
        key = "model:" + String(body.slug || body.name || title).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40);
        bytes = Buffer.byteLength(json);
        srcFile = { text: json, doc };
      }
      const flagged = t.flagged || d.flagged || tags.some((x) => screen(x, { field: "标签", max: 16 }).flagged);

      // 同一个作者、同一个源，再发一次就是"更新版本"，不是在广场堆一张重复卡片
      const prev = Object.values(docs.pubs.byId).find((p) => p.authorId === viewerId && p.key === key);
      const id = prev ? prev.id : newId();
      const versions = docs.versions.byPub[id] || (docs.versions.byPub[id] = []);
      if (prev) {
        const v = (prev.version || 1);
        const archive = store.verFile(id, v);
        if (kind === "map" && fs.existsSync(store.pubFile(id))) fs.copyFileSync(store.pubFile(id), archive);
        if (kind === "model" && fs.existsSync(store.pubModelFile(id))) fs.copyFileSync(store.pubModelFile(id), store.verFile(id, v) + ".voxa.json");
        if (kind === "skin" && fs.existsSync(store.pubSkinFile(id))) fs.copyFileSync(store.pubSkinFile(id), store.verFile(id, v) + ".skin.json");
        versions.push({ v, ts: prev.updated || prev.created, note: String(body.note || "").slice(0, 200), bytes: prev.bytes, kind });
      }
      if (kind === "map") {
        fs.copyFileSync(srcFile, store.pubFile(id));
        const assetDir = assetRoots.map((r) => path.join(r, String(body.worldId))).find((x) => fs.existsSync(x));
        if (!prev) {
          const cover = assetRoots.map((r) => path.join(r, String(body.worldId), "cover.png")).find((x) => fs.existsSync(x));
          if (cover) fs.copyFileSync(cover, store.pubCover(id));
          if (assetDir) {
            const a = copyAssets(assetDir, store.pubAssets(id));
            if (a.truncated) {
              fs.rmSync(store.pubAssets(id), { recursive: true, force: true });
              fs.rmSync(store.pubFile(id), { force: true });
              reply.fail(413, `这张图引用的素材太多（${a.files.length} 个文件），发布先取消；删掉没用到的模型再试`);
              return true;
            }
          }
        }
        bytes = fs.statSync(store.pubFile(id)).size;
      } else if (kind === "skin") {
        // 附件先落盘，再把记录里的 texture/model 改写成指回这份快照自己的资产。
        // 不改写的话，别人下载到的皮肤指向作者本机路径，装上去是空的。
        const dir = store.pubAssets(id);
        fs.mkdirSync(dir, { recursive: true });
        const rec = Object.assign({}, srcFile.doc);
        if (skinAttach.texture) {
          fs.writeFileSync(path.join(dir, "texture.png"), Buffer.from(skinAttach.texture, "base64"));
          rec.texture = `/api/community/pubs/${id}/asset?path=texture.png`;
        }
        if (skinAttach.model) {
          fs.writeFileSync(path.join(dir, "model.glb"), Buffer.from(skinAttach.model, "base64"));
          rec.model = `/api/community/pubs/${id}/asset?path=model.glb`;
          rec.kind = "rig";        // 有 glb 附件才谈得上骨骼皮肤；下面那次白名单会再验一遍关节数
        }
        const json = JSON.stringify(normalizeSkinDoc(rec));      // 改写后再过一次白名单
        fs.writeFileSync(store.pubSkinFile(id), json);
        srcFile.text = json; srcFile.doc = JSON.parse(json);
        bytes = Buffer.byteLength(json);
      } else {
        fs.writeFileSync(store.pubModelFile(id), srcFile.text);
        // 模型也要有预览：官方模型展厅里每张卡都是模型自己的 3D 渲染居中放在黑底上，
        // 没有预览的模型卡在展厅里就是一个写着文件名的灰框，根本不算"展品"。
        try {
          const preview = renderModelPreview(srcFile.doc, { width: 320, height: 320 });
          if (preview) fs.writeFileSync(store.pubPreview(id), preview);
        } catch { /* 画不出来就退回占位，不影响发布 */ }
      }
      // 上传过的图可以直接当封面：一步到位，不用先发布再编辑
      const up = safeAssetPath(body.coverUrl);
      if (up) {
        const src = path.join(store.uploads, path.basename(up));
        if (fs.existsSync(src)) { fs.copyFileSync(src, store.pubCover(id)); fs.copyFileSync(src, store.pubCover(id).replace(/\.png$/, "." + src.split(".").pop())); }
      }
      // 既没上传封面、也没有编辑器截图：拿这张图自己的体素画一张小地图。
      // 广场里最刺眼的"AI 做的"就是每张缺封面的图都退化成同一段渐变——
      // 颜色不该由 id 派生的随机数决定，应该由地图本身决定。
      if (kind === "map" && atlas && !fs.existsSync(store.pubCover(id))) {
        try {
          const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(store.pubFile(id))).toString());
          const png = renderCover({ indices: snap.indices, data: snap.data, shape: snap.shape, colors: blockColors(atlas.json, atlas.png) });
          if (png) fs.writeFileSync(store.pubCover(id), png);
        } catch { /* 封面画不出来不影响发布，广场会退回文字占位 */ }
      }
      const rec = Object.assign(prev || {}, {
        id, key, kind, authorId: viewerId, title, tags,
        desc: d.clean.trim().slice(0, 2000),
        worldId: kind === "map" ? String(body.worldId) : null,
        created: prev ? prev.created : now(), updated: now(),
        plays: prev ? prev.plays || 0 : 0, likes: prev ? prev.likes || [] : [],
        // 改版不清票：作者更新一版就把"这图好不好"的历史抹平，等于让每张
        // 迭代过的图永远停在"暂无评分"。下架重发也一样要留着。
        votes: prev && prev.votes ? { up: prev.votes.up || [], down: prev.votes.down || [] } : { up: [], down: [] },
        favs: prev ? prev.favs || [] : [],
        version: prev ? (prev.version || 1) + 1 : 1, status: "live",
        bytes, shape, hasCover: fs.existsSync(store.pubCover(id)),
        assets: prev && kind !== "skin" ? prev.assets || 0 : (kind === "map" || kind === "skin" ? listFiles(store.pubAssets(id)).length : 0),
        flagged: !!flagged,
      });
      docs.pubs.byId[id] = rec;
      store.touch("pubs"); store.touch("versions");
      if (!prev) for (const f of docs.graph.follows) if (f.b === viewerId) notify(f.a, "publish", viewerId, id);
      reply.json(200, { pub: pubCard(rec, viewerId), flagged: rec.flagged, versions: versions.length });
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

      /** 顶 / 踩：Roblox 那张详情页最显眼的是好评率而不是点赞数，而"点赞"
       *  给不出差评——只看好坏的话，一个全是赞的列表等于没有信息。
       *  一个人同时只能在 up 或 down 里出现一次，改票就是把自己从另一栏摘掉。 */
      if (sub === "vote" && method === "POST") return login(() => {
        const v = Number(body.v) > 0 ? 1 : Number(body.v) < 0 ? -1 : 0;
        const votes = p.votes || (p.votes = { up: [], down: [] });
        votes.up = (votes.up || []).filter((x) => x !== viewerId);
        votes.down = (votes.down || []).filter((x) => x !== viewerId);
        if (v === 1) { votes.up.push(viewerId); notify(p.authorId, "vote", viewerId, p.id); }
        else if (v === -1) votes.down.push(viewerId);
        store.touch("pubs");
        reply.json(200, pubCard(p, viewerId));
        return true;
      });

      /** 收藏与点赞的分工：赞是"这图好玩，作者收下"，收藏是"我自己的清单"。
       *  混在一个数上，个人主页的"我收藏的"就没法做。 */
      if (sub === "favorite" && method === "POST") return login(() => {
        const arr = p.favs || (p.favs = []);
        const i = arr.indexOf(viewerId);
        if (i < 0) arr.push(viewerId);
        else arr.splice(i, 1);
        store.touch("pubs");
        reply.json(200, { favs: arr.length, favByMe: i < 0 });
        return true;
      });

      if (sub === "play" && method === "POST") {
        p.plays = (p.plays || 0) + 1;
        // 顺手记一条"最近游玩"：个人主页要按时间列出玩过什么，
        // 没有记录的话那个 tab 只能永远空着。
        if (viewerId) {
          const list = docs.history.byUser[viewerId] || (docs.history.byUser[viewerId] = []);
          const hit = list.find((h) => h.pubId === p.id);
          if (hit) { hit.ts = now(); hit.count = (hit.count || 1) + 1; }
          else list.unshift({ pubId: p.id, ts: now(), count: 1, title: p.title, kind: p.kind || "map" });
          while (list.length > 40) list.pop();
          store.touch("history");
        }
        store.touch("pubs");
        reply.json(200, { plays: p.plays });
        return true;
      }

      if (sub === "versions" && method === "GET") {
        const rows = (docs.versions.byPub[p.id] || []).slice().reverse()
          .map((v) => ({ v: v.v, ts: v.ts, note: v.note || "", bytes: v.bytes, kind: v.kind || "map", current: v.v === (p.version || 1) - 1 }));
        reply.json(200, { current: p.version || 1, rows });
        return true;
      }
      // 回滚：把归档的那一版换回主文件，当前版反过来进归档——两边都不丢
      if (sub === "rollback" && method === "POST") {
        if (p.authorId !== viewerId) { reply.fail(403, "只有作者能回滚"); return true; }
        const v = Number(body.v) | 0;
        const list = docs.versions.byPub[p.id] || [];
        const at = list.findIndex((x) => x.v === v);
        const archive = store.verFile(p.id, v);
        if (at < 0 || !fs.existsSync(archive)) { reply.fail(404, "没有这个版本，或归档文件不在"); return true; }
        const cur = p.version || 1;
        list[at] = { ...list[at], v: cur };
        fs.copyFileSync(store.pubFile(p.id), store.verFile(p.id, cur));
        fs.copyFileSync(archive, store.pubFile(p.id));
        p.version = cur + 1; p.updated = now(); p.bytes = fs.statSync(store.pubFile(p.id)).size;
        store.touch("pubs"); store.touch("versions");
        reply.json(200, { ok: true, version: p.version, restored: v });
        return true;
      }
      if (sub === "report" && method === "POST") {
        if (!viewerId) { reply.fail(401, "举报要先登录"); return true; }
        addReport("pub", p.id, p.authorId, body.reason, viewerId);
        reply.json(200, { ok: true });
        return true;
      }
      if (sub === "preview" && method === "GET") {
        const f = store.pubPreview(p.id);
        if (!fs.existsSync(f)) { reply.fail(404, "这张还没有预览"); return true; }
        reply.raw(200, fs.readFileSync(f), { "Content-Type": "image/png", "Cache-Control": "no-store" });
        return true;
      }
      if (sub === "model" && method === "GET") {
        const f = store.pubModelFile(p.id);
        if (!fs.existsSync(f)) { reply.fail(404, "这不是模型发布"); return true; }
        reply.raw(200, fs.readFileSync(f), { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return true;
      }
      // 皮肤记录：广场的「应用到我的角色」和皮肤库的「下载」都读这一份
      if (sub === "skin" && method === "GET") {
        const f = store.pubSkinFile(p.id);
        if (!fs.existsSync(f)) { reply.fail(404, "这不是皮肤发布"); return true; }
        reply.raw(200, fs.readFileSync(f), { "Content-Type": "application/json", "Cache-Control": "no-store" });
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
          "Content-Type": ext === ".png" ? "image/png" : ext === ".glb" ? "model/gltf-binary"
            : ext === ".json" || ext === ".gltf" ? "application/json" : "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        });
        return true;
      }

      if (sub === "comments") {
        const list = commentsOf(p.id);
        if (method === "GET") { reply.json(200, { rows: list.map((c) => commentCard(c, viewerId)) }); return true; }
        if (method === "POST") return login(() => {
          const r = screen(body.body, { field: "评论", max: 500 });
          if (r.blocked) { reply.fail(400, r.reason); return true; }
          const text = r.clean.trim();
          if (!text) { reply.fail(400, "评论不能是空的"); return true; }
          if (blockedBetween(viewerId, p.authorId)) { reply.fail(403, "你们之间有一方拉黑了对方"); return true; }
          if (limited("cmt", viewerId, RATE.comment, 60 * 1000)) { reply.fail(429, "评论太频繁了，一分钟后再发"); return true; }
          /** 回复是同一张表上的一根线，不是一个新楼层：引用只存 id + 昵称 + 摘要快照，
           *  原评论被删之后，这句"回复某某"仍然读得通，而不是变成一条没有头的回声。 */
          let replyTo = null;
          if (body.replyTo) {
            const parent = list.find((x) => x.id === String(body.replyTo));
            if (!parent) { reply.fail(404, "要回复的那条评论已经不在了"); return true; }
            replyTo = { id: parent.id, name: (docs.users.byId[parent.userId] || {}).name || "?", excerpt: String(parent.body || "").slice(0, 60) };
          }
          const c = { id: newId(6), pubId: p.id, userId: viewerId, body: text, ts: now(), likes: [], flagged: r.flagged, replyTo };
          list.push(c);
          store.touch("comments");
          notify(p.authorId, "comment", viewerId, p.id);
          if (replyTo) notify(list.find((x) => x.id === replyTo.id).userId, "reply", viewerId, p.id);
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

    if (seg[0] === "comments" && PUB_ID_RE.test(seg[1] || "") && seg[2] === "report" && method === "POST") {
      return login(() => {
        for (const [pid, list] of Object.entries(docs.comments.byPub)) {
          const c = list.find((x) => x.id === seg[1]);
          if (!c) continue;
          addReport("comment", c.id, c.userId, body.reason, viewerId, pid);
          reply.json(200, { ok: true });
          return true;
        }
        reply.fail(404, "没有这条评论");
        return true;
      });
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

    /* ---------------- 拉黑 ---------------- */
    if (seg[0] === "blocks" && method === "GET") return login(() => {
      const rows = docs.graph.blocks.filter((e) => e.a === viewerId)
        .map((e) => Object.assign({ ts: e.ts }, publicUser(docs.users.byId[e.b], viewerId) || {}))
        .filter((u) => u.id);
      reply.json(200, { rows });
      return true;
    });
    if (seg[0] === "block" && method === "POST") return login(() => {
      const target = userParam(body.name);
      if (!target) return true;
      if (target.id === viewerId) { reply.fail(400, "不能拉黑自己"); return true; }
      const on = body.blocked !== false;
      const at = docs.graph.blocks.findIndex((e) => e.a === viewerId && e.b === target.id);
      if (on && at < 0) docs.graph.blocks.push({ a: viewerId, b: target.id, ts: now() });
      if (!on && at >= 0) docs.graph.blocks.splice(at, 1);
      if (on) {
        // 拉黑要顺手把两边的关注、好友与待处理请求收干净：只收一半，
        // 界面上就会出现"已拉黑但仍是好友"这种自相矛盾的状态。
        docs.graph.follows = docs.graph.follows.filter((e) => !(e.a === viewerId && e.b === target.id) && !(e.a === target.id && e.b === viewerId));
        docs.graph.friends = docs.graph.friends.filter((e) => e.k !== pairKey(viewerId, target.id));
        docs.graph.requests = docs.graph.requests.filter((e) => !(e.from === viewerId && e.to === target.id) && !(e.from === target.id && e.to === viewerId));
      }
      store.touch("graph");
      reply.json(200, { ok: true, blocked: on, relation: publicUser(target, viewerId).relation, counts: countsOf(target.id) });
      return true;
    });

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

    /* ---------------- 管理后台 ---------------- */
    if (seg[0] === "admin") {
      if (!viewerId) { reply.fail(401, "先登录"); return true; }
      if (!isAdmin()) { reply.fail(403, "这个账号不是超级管理员"); return true; }
      const sub = seg[1];
      const nameOf = (id) => (docs.users.byId[id] || {}).name || "（已注销）";
      const allComments = () => {
        const out = [];
        for (const [pid, list] of Object.entries(docs.comments.byPub)) {
          for (const c of list) out.push({ ...c, pubId: pid });
        }
        return out.sort((a, b) => b.ts - a.ts);
      };
      /** 后台看到的人行：比 publicUser 多角色、封禁、会话数、被举报数——
       *  这些都不是能公开出去的字段，所以单独一份，不给前端复用。 */
      const userRow = (u) => {
        const mine = Object.values(docs.pubs.byId).filter((p) => p.authorId === u.id);
        const hist = docs.history.byUser[u.id] || [];
        return {
          id: u.id, name: u.name, role: u.role || "user", createdAt: u.createdAt,
          banned: bannedNow(u), bannedReason: u.bannedReason || "", bannedUntil: u.bannedUntil || 0,
          bio: u.bio || "", region: u.region || "", gender: u.gender || "", looking: u.looking || "",
          avatar: u.avatar || null, online: chat.isOnline(u.id),
          pubs: mine.filter((p) => p.status === "live").length, pubsAll: mine.length,
          bytes: mine.reduce((a, p) => a + (p.bytes || 0), 0),
          comments: Object.values(docs.comments.byPub).reduce((a, l) => a + l.filter((c) => c.userId === u.id).length, 0),
          friends: docs.graph.friends.filter((e) => e.a === u.id || e.b === u.id).length,
          followers: docs.graph.follows.filter((e) => e.b === u.id).length,
          plays: hist.length, lastSeen: hist.length ? hist[0].ts : 0,
          reports: docs.reports.list.filter((r) => r.owner === u.id && r.state === "open").length,
          sessions: Object.values(docs.sessions).filter((s) => s.userId === u.id).length,
        };
      };

      if (sub === "overview" && method === "GET") {
        const pubs = livePubs();
        const DAY = 86400000;
        // 14 天走势：注册/新发/评论各按自己的真实时间戳落桶。active 是"当天留下过
        // 游玩记录的人次"——history 只存最近一次时间，所以它是活跃代理不是 DAU，
        // 界面也就照这个说法写，不冒充日活。
        const series = [];
        for (let i = 13; i >= 0; i--) {
          const end = now() - i * DAY, start = end - DAY;
          series.push({
            day: new Date(start).toISOString().slice(5, 10),
            users: Object.values(docs.users.byId).filter((u) => u.createdAt > start && u.createdAt <= end).length,
            pubs: Object.values(docs.pubs.byId).filter((p) => p.created > start && p.created <= end).length,
            comments: Object.values(docs.comments.byPub).flat().filter((c) => c.ts > start && c.ts <= end).length,
            active: Object.values(docs.history.byUser).flat().filter((h) => h.ts > start && h.ts <= end).length,
          });
        }
        reply.json(200, {
          users: Object.values(docs.users.byId).map(userRow).sort((a, b) => b.createdAt - a.createdAt),
          reports: docs.reports.list.filter((r) => r.state === "open").map((r) => ({
            ...r, target: r.target, byName: (docs.users.byId[r.by] || {}).name || "?",
            ownerName: (docs.users.byId[r.owner] || {}).name || "?",
            excerpt: r.targetType === "comment"
              ? (Object.values(docs.comments.byPub).flat().find((c) => c.id === r.target) || {}).body || ""
              : (docs.pubs.byId[r.target] || {}).title || "",
          })),
          online: chat.stats().online,
          banned: Object.values(docs.users.byId).filter((u) => bannedNow(u)).length,
          reportsHandled: docs.reports.list.filter((r) => r.state !== "open").length,
          series,
          flagged: { pubs: pubs.filter((p) => p.flagged).length, comments: Object.values(docs.comments.byPub).flat().filter((c) => c.flagged).length },
          totals: {
            users: Object.keys(docs.users.byId).length, pubs: pubs.length, models: pubs.filter((p) => p.kind === "model").length,
            skins: pubs.filter((p) => p.kind === "skin").length,
            removed: Object.values(docs.pubs.byId).filter((p) => p.status !== "live").length,
            comments: Object.values(docs.comments.byPub).reduce((a, v) => a + v.length, 0),
            plays: pubs.reduce((a, p) => a + (p.plays || 0), 0), reports: docs.reports.list.length,
            bytes: pubs.reduce((a, p) => a + (p.bytes || 0), 0),
          },
        });
        return true;
      }
      if (sub === "role" && method === "POST") {
        const u = userByName(body.name);
        if (!u) { reply.fail(404, "没有这个用户"); return true; }
        if (!["admin", "user"].includes(body.role)) { reply.fail(400, "角色只能是 admin 或 user"); return true; }
        if (u.id === viewerId && body.role !== "admin" && Object.values(docs.users.byId).filter((x) => x.role === "admin").length < 2) {
          reply.fail(400, "这是唯一的超级管理员，降下来就没人能进后台了"); return true;
        }
        u.role = body.role; store.touch("users");
        addAudit(viewerId, "role", u.name, "角色改成 " + u.role);
        reply.json(200, { ok: true, role: u.role });
        return true;
      }
      if (sub === "ban" && method === "POST") {
        const u = userByName(body.name);
        if (!u) { reply.fail(404, "没有这个用户"); return true; }
        if (u.id === viewerId) { reply.fail(400, "不能封自己"); return true; }
        u.banned = !!body.banned;
        if (u.banned) {
          u.bannedReason = String(body.reason || "").slice(0, 120) || "违反社区规则";
          // 天数是可选的：不填就是无限期。填了要真到期就自己解开，
          // 而不是等某个管理员哪天想起来点一下"解封"。
          const days = Math.round(Number(body.days) || 0);
          if (days > 0) u.bannedUntil = now() + Math.min(3650, days) * 86400000;
          else delete u.bannedUntil;
          for (const [h, sess] of Object.entries(docs.sessions)) if (sess.userId === u.id) delete docs.sessions[h];
        } else { delete u.bannedUntil; delete u.bannedReason; }
        store.touch("users"); store.touch("sessions");
        addAudit(viewerId, u.banned ? "ban" : "unban", u.name, u.banned ? `${u.bannedReason}${u.bannedUntil ? " · 到 " + new Date(u.bannedUntil).toLocaleDateString() : " · 无限期"}` : "");
        reply.json(200, { ok: true, banned: u.banned, bannedUntil: u.bannedUntil || 0 });
        return true;
      }
      if (sub === "takedown" && method === "POST") {
        const p = docs.pubs.byId[String(body.pubId || "")];
        if (!p) { reply.fail(404, "没有这个发布"); return true; }
        p.status = "removed"; p.removedBy = "admin"; p.updated = now();
        store.touch("pubs");
        addAudit(viewerId, "takedown", p.title, "下架 " + p.id);
        reply.json(200, { ok: true });
        return true;
      }
      if (sub === "report" && method === "POST") {
        const r = docs.reports.list.find((x) => x.id === seg[2] || x.id === body.id);
        if (!r) { reply.fail(404, "没有这条举报"); return true; }
        r.state = body.action === "dismiss" ? "dismissed" : "resolved";
        r.handledAt = now(); r.by2 = viewerId;
        if (r.state === "resolved" && body.remove) {
          if (r.targetType === "comment") {
            for (const list of Object.values(docs.comments.byPub)) {
              const i = list.findIndex((c) => c.id === r.target);
              if (i >= 0) list.splice(i, 1);
            }
            store.touch("comments");
          } else {
            // 这一支以前没有：作品那一行的「处理并删内容」只改了举报的状态，
            // 图还挂在广场上——按钮说的话和做的事不一样。下架复用 takedown 那套 status。
            const p = docs.pubs.byId[r.target];
            if (p && p.status !== "removed") {
              p.status = "removed"; p.removedBy = "admin"; p.updated = now();
              store.touch("pubs");
            }
          }
        }
        store.touch("reports");
        reply.json(200, { ok: true, state: r.state });
        return true;
      }
      /* ---- 后台的读接口：一次 overview 装不下所有列表，所以各开一条，
       *      前端要哪个拉哪个，而不是把整个数据库塞进一个响应里。 ---- */
      if (sub === "users" && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const only = url.searchParams.get("filter");
        let rows = Object.values(docs.users.byId).map(userRow);
        if (q) rows = rows.filter((u) => u.name.toLowerCase().includes(q) || (u.bio || "").toLowerCase().includes(q));
        if (only === "banned") rows = rows.filter((u) => u.banned);
        if (only === "admin") rows = rows.filter((u) => u.role === "admin");
        if (only === "online") rows = rows.filter((u) => u.online);
        if (only === "quiet") rows = rows.filter((u) => !u.online && !u.lastSeen);
        if (only === "reported") rows = rows.filter((u) => u.reports);
        const key = url.searchParams.get("sort") || "new";
        const dir = url.searchParams.get("dir") === "asc" ? 1 : -1;
        const cmp = { new: (a, b) => a.createdAt - b.createdAt, name: (a, b) => a.name.localeCompare(b.name),
          pubs: (a, b) => a.pubsAll - b.pubsAll, bytes: (a, b) => a.bytes - b.bytes,
          comments: (a, b) => a.comments - b.comments, plays: (a, b) => a.plays - b.plays,
          seen: (a, b) => (a.lastSeen || a.createdAt) - (b.lastSeen || b.createdAt),
          reports: (a, b) => a.reports - b.reports }[key] || ((a, b) => a.createdAt - b.createdAt);
        rows.sort((a, b) => cmp(a, b) * dir || a.name.localeCompare(b.name));
        reply.json(200, { rows, total: Object.keys(docs.users.byId).length });
        return true;
      }

      if (sub === "user" && method === "GET") {
        const u = userByName(url.searchParams.get("name"));
        if (!u) { reply.fail(404, "没有这个用户"); return true; }
        const mine = Object.values(docs.pubs.byId).filter((p) => p.authorId === u.id)
          .sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 40)
          .map((p) => ({ id: p.id, title: p.title, kind: p.kind || "map", status: p.status, version: p.version || 1,
            updated: p.updated, plays: p.plays || 0, flagged: !!p.flagged, bytes: p.bytes || 0, comments: commentsOf(p.id).length }));
        const cmts = allComments().filter((c) => c.userId === u.id).slice(0, 30)
          .map((c) => ({ id: c.id, pubId: c.pubId, pubTitle: (docs.pubs.byId[c.pubId] || {}).title || "（作品已删除）",
            body: c.body, ts: c.ts, flagged: !!c.flagged, likes: (c.likes || []).length }));
        reply.json(200, {
          user: userRow(u),
          detail: { id: u.id, lower: u.lower, persona: u.persona || [], skin: !!u.skin, wearables: (u.wearables || []).length,
            createdAtText: new Date(u.createdAt).toLocaleString(), hasAvatar: !!u.avatar },
          pubs: mine, comments: cmts,
          graph: {
            following: docs.graph.follows.filter((e) => e.a === u.id).map((e) => nameOf(e.b)).slice(0, 40),
            followers: docs.graph.follows.filter((e) => e.b === u.id).map((e) => nameOf(e.a)).slice(0, 40),
            friends: docs.graph.friends.filter((e) => e.a === u.id || e.b === u.id)
              .map((e) => nameOf(e.a === u.id ? e.b : e.a)).slice(0, 40),
          },
          reports: docs.reports.list.filter((r) => r.owner === u.id).slice(0, 20)
            .map((r) => ({ id: r.id, targetType: r.targetType, reason: r.reason, state: r.state, ts: r.ts, byName: nameOf(r.by) })),
          audit: docs.audit.list.filter((a) => a.target === u.name).slice(0, 20)
            .map((a) => ({ action: a.action, by: nameOf(a.by), detail: a.detail, ts: a.ts })),
          history: (docs.history.byUser[u.id] || []).slice(0, 20)
            .map((h) => ({ title: (docs.pubs.byId[h.pubId] || {}).title || h.pubId, ts: h.ts })),
        });
        return true;
      }

      // 导出一个人的全部数据：明文密码永远不出去，散列/盐也不出去。
      if (sub === "export" && method === "GET") {
        const u = userByName(url.searchParams.get("name"));
        if (!u) { reply.fail(404, "没有这个用户"); return true; }
        const drop = ["pw", "hash", "salt", "pwHash", "pwSalt"];
        const clone = (o) => JSON.parse(JSON.stringify(o));
        const pubFiles = (p) => {
          const dir = path.dirname(store.pubFile(p.id));
          let names = [];
          try { names = fs.readdirSync(dir); } catch { /* 目录不在就是没文件 */ }
          return names.filter((n) => n === p.id || n.startsWith(p.id + "."));
        };
        const pubs = Object.values(docs.pubs.byId).filter((p) => p.authorId === u.id).map((p) => ({ ...clone(p), files: pubFiles(p) }));
        reply.json(200, {
          exportedAt: now(), by: nameOf(viewerId),
          user: (({ pw, hash, salt, pwHash, pwSalt, ...rest }) => rest)(clone(u)),
          pubs,
          comments: allComments().filter((c) => c.userId === u.id),
          graph: {
            follows: docs.graph.follows.filter((e) => e.a === u.id || e.b === u.id),
            friends: docs.graph.friends.filter((e) => e.a === u.id || e.b === u.id),
            requests: docs.graph.requests.filter((e) => e.from === u.id || e.to === u.id),
          },
          notes: docs.notes.list.filter((n) => n.to === u.id || n.actorId === u.id),
          history: docs.history.byUser[u.id] || [],
          versions: Object.fromEntries(Object.entries(docs.versions.byPub)
            .filter(([pid]) => (docs.pubs.byId[pid] || {}).authorId === u.id)),
          reports: docs.reports.list.filter((r) => r.owner === u.id || r.by === u.id),
        });
        return true;
      }

      if (sub === "pubs" && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const state = url.searchParams.get("state") || "live";
        const kind = ["map", "model", "skin"].includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "";
        let rows = Object.values(docs.pubs.byId);
        if (state !== "all") rows = rows.filter((p) => p.status === state);
        if (kind) rows = rows.filter((p) => (p.kind || "map") === kind);
        if (q) rows = rows.filter((p) => (p.title || "").toLowerCase().includes(q)
          || (p.desc || "").toLowerCase().includes(q) || nameOf(p.authorId).toLowerCase().includes(q));
        rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));
        const total = rows.length;
        reply.json(200, {
          total, rows: rows.slice(0, 200).map((p) => ({
            id: p.id, title: p.title, kind: p.kind || "map", status: p.status, worldId: p.worldId,
            authorName: nameOf(p.authorId), authorId: p.authorId, version: p.version || 1,
            created: p.created, updated: p.updated, plays: p.plays || 0, likes: (p.likes || []).length,
            up: (p.votes && p.votes.up || []).length, down: (p.votes && p.votes.down || []).length,
            comments: commentsOf(p.id).length, flagged: !!p.flagged, bytes: p.bytes || 0, assets: p.assets || 0,
            removedBy: p.removedBy || "", versions: (docs.versions.byPub[p.id] || []).length,
          })),
        });
        return true;
      }

      if (sub === "restore" && method === "POST") {
        const p = docs.pubs.byId[String(body.pubId || "")];
        if (!p) { reply.fail(404, "没有这个发布"); return true; }
        if (p.status === "live") { reply.fail(400, "这件本来就在线"); return true; }
        p.status = "live"; delete p.removedBy; p.updated = now();
        store.touch("pubs");
        addAudit(viewerId, "restore", p.title, "恢复上架 " + p.id);
        notify(p.authorId, "restored", viewerId, p.id);
        reply.json(200, { ok: true, status: p.status });
        return true;
      }

      if (sub === "pub" && method === "POST") {
        const p = docs.pubs.byId[String(body.pubId || "")];
        if (!p) { reply.fail(404, "没有这个发布"); return true; }
        if (body.action === "flag") {
          p.flagged = !!body.flagged; p.updated = now(); store.touch("pubs");
          addAudit(viewerId, "flag", p.title, p.flagged ? "标记待审" : "取消标记");
          reply.json(200, { ok: true, flagged: p.flagged }); return true;
        }
        if (body.action === "purge") {
          // 硬删：作者自己的下架只是 status=removed，文件还在盘上。
          // 后台这颗按钮说的是"删掉"，那就得真的把快照和版本一起清走。
          const id = p.id;
          delete docs.comments.byPub[id];
          delete docs.versions.byPub[id];
          delete docs.pubs.byId[id];
          const files = dropPubArtifacts(id);
          docs.reports.list = docs.reports.list.filter((r) => r.target !== id && r.pubId !== id);
          store.touch("pubs"); store.touch("comments"); store.touch("versions"); store.touch("reports");
          addAudit(viewerId, "purge", p.title, `删除作品 ${id} 与 ${files} 个文件`);
          reply.json(200, { ok: true, files }); return true;
        }
        reply.fail(400, "不认识的动作：" + body.action); return true;
      }

      if (sub === "comments" && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const only = url.searchParams.get("filter");
        let rows = allComments();
        if (only === "flagged") rows = rows.filter((c) => c.flagged);
        if (q) rows = rows.filter((c) => (c.body || "").toLowerCase().includes(q)
          || (docs.pubs.byId[c.pubId] || {}).title?.toLowerCase().includes(q)
          || nameOf(c.userId).toLowerCase().includes(q));
        const limit = clamp(url.searchParams.get("limit") || 120, 1, 400);
        reply.json(200, {
          total: rows.length,
          rows: rows.slice(0, limit).map((c) => ({
            id: c.id, pubId: c.pubId, pubTitle: (docs.pubs.byId[c.pubId] || {}).title || "（作品已删除）",
            pubStatus: (docs.pubs.byId[c.pubId] || {}).status || "gone",
            userName: nameOf(c.userId), userId: c.userId, body: c.body, ts: c.ts,
            flagged: !!c.flagged, likes: (c.likes || []).length,
            reports: docs.reports.list.filter((r) => r.target === c.id).length,
          })),
        });
        return true;
      }

      if (sub === "comment" && method === "POST") {
        const id = String(body.id || "");
        const where = Object.entries(docs.comments.byPub).find(([, list]) => list.some((c) => c.id === id));
        if (!where) { reply.fail(404, "没有这条评论"); return true; }
        if (body.action === "flag") {
          const c = where[1].find((x) => x.id === id);
          c.flagged = !!body.flagged; store.touch("comments");
          addAudit(viewerId, "flag", nameOf(c.userId), (c.flagged ? "标记" : "取消标记") + "评论 " + id);
          reply.json(200, { ok: true, flagged: c.flagged }); return true;
        }
        const [pid, list] = where;
        const c = list.find((x) => x.id === id);
        list.splice(list.indexOf(c), 1);
        if (!list.length) delete docs.comments.byPub[pid];
        docs.reports.list = docs.reports.list.filter((r) => r.target !== id);
        store.touch("comments"); store.touch("reports");
        addAudit(viewerId, "comment_delete", nameOf(c.userId), "删掉评论 " + id + "（作品：" + ((docs.pubs.byId[pid] || {}).title || pid) + "）");
        reply.json(200, { ok: true }); return true;
      }

      if (sub === "flagged" && method === "GET") {
        const pubs = Object.values(docs.pubs.byId).filter((p) => p.flagged)
          .map((p) => ({ id: p.id, title: p.title, kind: p.kind || "map", authorName: nameOf(p.authorId), updated: p.updated, status: p.status }));
        const comments = allComments().filter((c) => c.flagged)
          .map((c) => ({ id: c.id, pubId: c.pubId, pubTitle: (docs.pubs.byId[c.pubId] || {}).title || "", userName: nameOf(c.userId), body: c.body, ts: c.ts }));
        reply.json(200, { pubs, comments, total: pubs.length + comments.length });
        return true;
      }

      if (sub === "reports" && method === "GET") {
        const state = url.searchParams.get("state") || "open";
        let rows = docs.reports.list;
        if (state !== "all") rows = rows.filter((r) => r.state === state);
        reply.json(200, {
          total: rows.length,
          counts: { open: docs.reports.list.filter((r) => r.state === "open").length,
            resolved: docs.reports.list.filter((r) => r.state === "resolved").length,
            dismissed: docs.reports.list.filter((r) => r.state === "dismissed").length },
          rows: rows.slice(0, 200).map((r) => ({ ...r,
            byName: nameOf(r.by), ownerName: nameOf(r.owner), handledByName: r.by2 ? nameOf(r.by2) : "",
            excerpt: r.targetType === "comment"
              ? (allComments().find((c) => c.id === r.target) || {}).body || "（这条评论已经不在了）"
              : (docs.pubs.byId[r.target] || {}).title || "（这件作品已经不在了）",
          })),
        });
        return true;
      }

      if (sub === "audit" && method === "GET") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const action = url.searchParams.get("action") || "";
        let rows = docs.audit.list;
        if (action) rows = rows.filter((a) => a.action === action);
        if (q) rows = rows.filter((a) => a.target.toLowerCase().includes(q) || (a.detail || "").toLowerCase().includes(q)
          || nameOf(a.by).toLowerCase().includes(q));
        const limit = clamp(url.searchParams.get("limit") || 150, 1, 500);
        reply.json(200, {
          total: rows.length,
          actions: [...new Set(docs.audit.list.map((a) => a.action))].sort(),
          rows: rows.slice(0, limit).map((a) => ({ ...a, byName: nameOf(a.by) })),
        });
        return true;
      }

      /* ---- 后台的写接口：每一个都留痕，涉及内容或删除的都通知当事人 ---- */
      if (sub === "sessions" && method === "POST") {
        const u = userByName(body.name);
        if (!u) { reply.fail(404, "没有这个用户"); return true; }
        let n = 0;
        for (const [h, sess] of Object.entries(docs.sessions)) if (sess.userId === u.id) { delete docs.sessions[h]; n++; }
        store.touch("sessions");
        addAudit(viewerId, "sessions", u.name, `踢掉 ${n} 个登录会话`);
        reply.json(200, { ok: true, killed: n });
        return true;
      }

      if (sub === "user" && method === "POST") {
        const u = userByName(body.name);
        if (!u) { reply.fail(404, "没有这个用户"); return true; }
        if (body.action === "rename") {
          const to = normName(body.name2);
          if (!to || to === u.name) { reply.fail(400, "新昵称没变或不能为空"); return true; }
          if (userByName(to)) { reply.fail(400, "这个昵称已经被占用"); return true; }
          const from = u.name;
          delete docs.users.byLower[u.lower];
          u.name = to; u.lower = to.toLowerCase();
          docs.users.byLower[u.lower] = u.id;
          store.touch("users");
          addAudit(viewerId, "rename", from, "改名成 " + to);
          notify(u.id, "renamed", viewerId, null, `超级管理员把你的昵称改成「${to}」`);
          reply.json(200, { ok: true, name: to }); return true;
        }
        if (body.action === "reset") {
          // 只清资料里的脏东西（简介/头像/皮肤），不碰密码：
          // 后台没有"替人设密码"这条路，因为那条路的尽头是管理员登进别人账号。
          const what = ["bio", "avatar", "banner", "skin", "region", "gender", "persona", "looking"];
          const hit = Array.isArray(body.fields) ? what.filter((f) => body.fields.includes(f)) : [];
          if (!hit.length) { reply.fail(400, "要说清楚清哪几项资料"); return true; }
          for (const f of hit) delete u[f];
          store.touch("users");
          addAudit(viewerId, "reset", u.name, "清空资料字段：" + hit.join("/"));
          reply.json(200, { ok: true, cleared: hit }); return true;
        }
        if (body.action === "delete") {
          if (String(body.confirm || "") !== u.name) { reply.fail(400, "要注销账号，得把对方的昵称原样填进确认框"); return true; }
          if (u.id === viewerId) { reply.fail(400, "不能注销自己"); return true; }
          if ((u.role || "user") === "admin" && Object.values(docs.users.byId).filter((x) => x.role === "admin").length < 2) {
            reply.fail(400, "这是唯一的超级管理员，注销掉就没人能进后台了"); return true;
          }
          const id = u.id, name = u.name;
          const pubs = Object.values(docs.pubs.byId).filter((p) => p.authorId === id);
          let files = 0;
          for (const p of pubs) {
            files += dropPubArtifacts(p.id);
            delete docs.pubs.byId[p.id];
            delete docs.versions.byPub[p.id];
            delete docs.comments.byPub[p.id];
          }
          let cmts = 0;
          for (const [pid, list] of Object.entries(docs.comments.byPub)) {
            const keep = list.filter((c) => c.userId !== id);
            cmts += list.length - keep.length;
            if (keep.length) docs.comments.byPub[pid] = keep; else delete docs.comments.byPub[pid];
          }
          delete docs.users.byId[id];
          delete docs.users.byLower[normName(name).toLowerCase()];
          delete docs.history.byUser[id];
          docs.graph.follows = docs.graph.follows.filter((e) => e.a !== id && e.b !== id);
          docs.graph.friends = docs.graph.friends.filter((e) => e.a !== id && e.b !== id);
          docs.graph.requests = docs.graph.requests.filter((e) => e.from !== id && e.to !== id);
          docs.notes.list = docs.notes.list.filter((n) => n.to !== id && n.actorId !== id);
          docs.reports.list = docs.reports.list.filter((r) => r.owner !== id && r.by !== id);
          docs.graph.blocks = docs.graph.blocks.filter((e) => e.a !== id && e.b !== id);
          delete docs.guestbook.byUser[id];
          for (const [owner, list] of Object.entries(docs.guestbook.byUser)) {
            const keep = list.filter((m) => m.from !== id);
            if (keep.length) docs.guestbook.byUser[owner] = keep; else delete docs.guestbook.byUser[owner];
          }
          for (const p of Object.values(docs.pubs.byId)) {
            p.likes = (p.likes || []).filter((x) => x !== id);
            if (p.votes) { p.votes.up = (p.votes.up || []).filter((x) => x !== id); p.votes.down = (p.votes.down || []).filter((x) => x !== id); }
            p.favs = (p.favs || []).filter((x) => x !== id);
          }
          for (const [h, sess] of Object.entries(docs.sessions)) if (sess.userId === id) delete docs.sessions[h];
          for (const key of ["pubs", "versions", "comments", "users", "graph", "notes", "reports", "history", "sessions", "guestbook"]) store.touch(key);
          addAudit(viewerId, "delete_user", name, `注销账号：${pubs.length} 件作品、${cmts} 条评论、${files} 个文件`);
          reply.json(200, { ok: true, pubs: pubs.length, comments: cmts, files });
          return true;
        }
        reply.fail(400, "不认识的动作：" + body.action);
        return true;
      }

      if (sub === "batch" && method === "POST") {
        const names = Array.isArray(body.names) ? body.names.slice(0, 200) : [];
        const action = String(body.action || "");
        if (!names.length) { reply.fail(400, "先勾选人"); return true; }
        if (!["ban", "unban", "role", "sessions", "flag_off"].includes(action)) { reply.fail(400, "不认识的批量动作"); return true; }
        const done = [];
        for (const nm of names) {
          const u = userByName(nm);
          if (!u || u.id === viewerId) continue;                 // 批量里跳过自己：一键封掉全后台是事故
          if (action === "ban") {
            u.banned = true; u.bannedReason = String(body.reason || "").slice(0, 120) || "批量处理";
            const days = Math.round(Number(body.days) || 0);
            u.bannedUntil = days > 0 ? now() + Math.min(3650, days) * 86400000 : 0;
            for (const [h, sess] of Object.entries(docs.sessions)) if (sess.userId === u.id) delete docs.sessions[h];
          } else if (action === "unban") {
            u.banned = false; delete u.bannedUntil; delete u.bannedReason;
          } else if (action === "role") {
            if (["admin", "user"].includes(body.role)) u.role = body.role;
          } else if (action === "sessions") {
            for (const [h, sess] of Object.entries(docs.sessions)) if (sess.userId === u.id) delete docs.sessions[h];
          } else if (action === "flag_off") {
            for (const p of Object.values(docs.pubs.byId)) if (p.authorId === u.id) p.flagged = false;
            for (const list of Object.values(docs.comments.byPub)) for (const c of list) if (c.userId === u.id) c.flagged = false;
            store.touch("pubs"); store.touch("comments");
          }
          done.push(u.name);
        }
        for (const key of ["users", "sessions", "pubs", "comments"]) store.touch(key);
        addAudit(viewerId, "batch_" + action, done.join("、").slice(0, 64), `批量处理 ${done.length} 人`);
        reply.json(200, { ok: true, done: done.length, names: done });
        return true;
      }

      if (sub === "note" && method === "POST") {
        const text = String(body.text || "").trim().slice(0, 200);
        if (!text) { reply.fail(400, "通知内容不能空着"); return true; }
        let to = [];
        if (body.all) to = Object.keys(docs.users.byId).filter((id) => !bannedNow(docs.users.byId[id]));
        else {
          const u = userByName(body.name);
          if (!u) { reply.fail(404, "没有这个用户"); return true; }
          to = [u.id];
        }
        for (const id of to) notify(id, "admin_note", null, null, text);
        store.touch("notes");
        addAudit(viewerId, "note", body.all ? `全体（${to.length} 人）` : (docs.users.byId[to[0]] || {}).name, text);
        reply.json(200, { ok: true, sent: to.length });
        return true;
      }

      reply.fail(404, "后台没有这个接口：" + sub);
      return true;
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
    /** 给联机层用：同一套会话规则，绝不在 WebSocket 那一侧再抄一遍鉴权。 */
    sessionUser(req) {
      const cookies = parseCookies(req);
      const tok = cookies[SESSION_COOKIE];
      if (!tok) return null;
      const sess = docs.sessions[hashOf(tok)];
      if (!sess) return null;
      if (now() - sess.createdAt >= SESSION_TTL * 1000) {
        delete docs.sessions[hashOf(tok)]; store.touch("sessions"); return null;
      }
      const u = docs.users.byId[sess.userId];
      if (!u || bannedNow(u)) return null;
      return { id: u.id, name: u.name, skin: u.skin || null, avatar: u.avatar || "", role: u.role || "user" };
    },
    /** 房间必须对应一件还在架上的作品，否则任何人都能凭空开一个频道。 */
    livePub(id) { const p = docs.pubs.byId && docs.pubs.byId[id]; return p && !p.removed ? p : null; },
    screenText: (text, opts) => screen(text, opts),
    /** 联机层与 server.js 共用这一个聊天实例：房间里的话要落到同一份环形缓冲里，
     *  否则"游戏里说过、详情页看不到"。 */
    chat, isFriend,
    /** 谁在线：面板与主页都要显示那一个小绿点。 */
    isOnline: (id) => chat.isOnline(id),
  };
}
