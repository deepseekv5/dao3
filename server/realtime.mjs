/**
 * realtime.mjs — 零依赖的 WebSocket 房间：同一张社区地图里的多人同图与内置聊天。
 *
 * 为什么自己搓 RFC6455 而不是装 ws：这个项目的运行时依赖是零，
 * 一条只走本机的房间通道用不着引入第三方，而且帧格式本身不到 200 行。
 *
 * 鉴权只有一条路：升级请求带的是浏览器自动附上的 ly_session cookie，
 * 交给 community.sessionUser() 判，和 HTTP 层同一套会话规则（含过期与封禁）。
 * 房间 key 必须是一件还在架上的作品 id，凭空开的频道一律拒。
 */
import crypto from "node:crypto";
import { reblame, rle, diffStats } from "../public/js/diff.js";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 32 * 1024;          // 一条状态帧几十字节；给到 32 KB 已经宽到可以当攻击面用
const MAX_ROOM = 24;                  // 一个房间的人数上限：本地服务不是给压测用的
const MAX_MSG = 200;                  // 聊天长度
const CHAT_COOLDOWN = 1200;           // 同一个人两句话之间至少隔这么久
const STATE_HZ = 12;                  // 状态转发节流：人手每秒发 12 帧足够顺滑
const IDLE_MS = 45_000;               // 这么久没有任何动静就踢掉
// 一条世界改动包的上限。一格是 5 个数，2000 格 ≈ 一次大挖掘；实体 500 个已经
// 超过一张图里会被脚本同时驱动的规模。超出的部分丢掉，也不能让一个人用一条包
// 把整个房间的内存与带宽吃掉。
const MAX_OP_CELLS = 1000;
const MAX_OP_ENTS = 500;
const WORLD_OP_HZ = 8;                // 世界改动转发节流：方块不需要跟到 60Hz
const MAX_OP_SCRIPTS = 8;             // 一条包最多带几个脚本
const MAX_SCRIPT_BYTES = 200_000;     // 单文件上限：再大的脚本文件本身就该拆
const FEED_KEEP = 80;                 // 改动流留多少条给协作面板

const now = () => Date.now();

/* ---------------- 帧编解码 ---------------- */

/** 服务端 → 客户端：不掩码（协议规定服务端帧不得掩码）。 */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.allocUnsafe(2);
  else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  return Buffer.concat([head, payload]);
}

/**
 * 客户端 → 服务端的一帧。返回 {frame} 或 {need} 表示缓冲还不够。
 * 协议里客户端帧必须带掩码，没带就是不符合规范的客户端，直接断开。
 */
function decodeFrame(buf) {
  if (buf.length < 2) return { need: 2 };
  const b0 = buf[0], b1 = buf[1];
  const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f, off = 2;
  if (!masked) return { bad: "客户端帧必须带掩码" };
  if (len === 126) {
    if (buf.length < off + 2) return { need: off + 2 };
    len = buf.readUInt16BE(off); off += 2;
  } else if (len === 127) {
    if (buf.length < off + 8) return { need: off + 8 };
    const big = buf.readBigUInt64BE(off); off += 8;
    if (big > BigInt(MAX_FRAME)) return { bad: "帧过大" };
    len = Number(big);
  }
  if (len > MAX_FRAME) return { bad: "帧过大" };
  if (buf.length < off + 4 + len) return { need: off + 4 + len };
  const mask = buf.subarray(off, off + 4); off += 4;
  const data = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) data[i] = buf[off + i] ^ mask[i & 3];
  return { frame: { fin, opcode, data }, used: off + len };
}

/* ---------------- 一条连接 ---------------- */

class Peer {
  constructor(sock, room, user, socketId) {
    this.sock = sock; this.room = room; this.user = user; this.id = socketId;
    this.buf = Buffer.alloc(0);
    this.frag = null;                    // 分片帧的暂存
    this.lastChat = 0;
    this.lastState = 0;
    this.lastSeen = now();
    this.dead = false;
    this.pos = [0, 0, 0]; this.yaw = 0; this.anim = "idle";
    this.lastOp = 0;
    // 载具与换肤：赛车那类地图会把玩家本体换成 mesh 并把自己藏起来。这三样是本地状态，
    // 服务端不记不转，同伴看见的就是一具悬在车位置上的裸人偶。
    this.mesh = ""; this.meshScale = 1; this.hidden = false;
    this.pub = null;
  }

  send(obj) {
    if (this.dead) return;
    const s = typeof obj === "string" ? obj : JSON.stringify(obj);
    try { this.sock.write(encodeFrame(1, Buffer.from(s, "utf8"))); }
    catch { this.close(); }
  }

  close(code = 1000, reason = "") {
    if (this.dead) return;
    this.dead = true;
    try { this.sock.write(encodeFrame(8, Buffer.from([code >> 8, code & 0xff]))); } catch { /* 已经断了 */ }
    try { this.sock.end(); } catch { /* 同上 */ }
    this.onClose && this.onClose();
  }
}

export function createRealtime({ community, worldExists } = {}) {
  const rooms = new Map();               // "pub:<id>" -> Set<Peer>
  const stats = { joins: 0, chat: 0, frames: 0, rejected: 0 };

  function roomOf(key) {
    let r = rooms.get(key);
    if (!r) {
      r = new Set(); r.key = key;
      // 房间创建即"这张图的世界时间起点"。每个客户端原先都从 tick 0 自己数，
      // 后进来的人与先进来的人 tick 不同，凡按 world.currentTick 计时的脚本
      // （整点事件、昼夜、按 tick 刷新的道具）就会在两个人屏幕上错开。
      r.start = Date.now();
      // 世界改动的权威副本：谁改的都记在这里，再发给所有人（包括改的人自己），
      // 所以"一处更改落到所有人身上"，而且后进来的人拿到的是当前状态而不是初始状态。
      // 记的是增量叠加（last write wins），不是重跑模拟——模拟仍在各端跑。
      r.voxels = new Map();   // "x,y,z" -> [id, rot]，id=0 表示这格被挖掉
      r.entities = new Map(); // 实体键 -> [x, y, z, ry, scale]
      // 脚本内容也走同一条权威流：协作编辑时"谁的版本覆盖谁的"必须有服务端说了算的顺序，
      // 否则两个人同时保存就是后保存的悄悄把前一个人的改动抹了。
      r.scripts = new Map();  // 文件名 -> 代码
      r.lineAuthors = new Map(); // 文件名 -> 每行的作者（"这行是谁写的"就靠它）
      r.feed = [];            // 改动流：{ts, by, kind, what}，给协作面板与"这行是谁写的"用
      r.seq = 0;
      rooms.set(key, r);
    }
    return r;
  }

  /** 收一条世界改动。所有字段都当不可信输入：越界、非整数、超量的直接丢。 */
  /** 给一条改动署名。名字只认服务端会话里的那个人——客户端自报的 by 一律不信，
   *  否则谁都能把改动写成别人的。 */
  function stamp(peer, kind, what) {
    const entry = { ts: now(), by: { id: peer.user.id, name: peer.user.name }, kind, what };
    return entry;
  }

  function pushFeed(room, entry) {
    room.feed.push(entry);
    if (room.feed.length > FEED_KEEP) room.feed.shift();
  }

  function applyWorldOp(room, m, peer) {
    const changedV = [], changedE = [], changedS = [];
    if (Array.isArray(m.v)) {
      for (const cell of m.v.slice(0, MAX_OP_CELLS)) {
        if (!Array.isArray(cell) || cell.length < 5) continue;
        const [x, y, z, id, rot] = cell.map(Number);
        if (![x, y, z, id, rot].every((n) => Number.isFinite(n))) continue;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
        if (Math.abs(x) > 1e5 || Math.abs(y) > 1e5 || Math.abs(z) > 1e5) continue;
        if (id < 0 || id > 1e6 || (rot & 3) !== rot) continue;
        const k = `${x},${y},${z}`;
        if (id === 0) room.voxels.delete(k); else room.voxels.set(k, [id | 0, rot | 0]);
        changedV.push([x, y, z, id | 0, rot | 0]);
      }
    }
    if (Array.isArray(m.e)) {
      for (const ent of m.e.slice(0, MAX_OP_ENTS)) {
        if (!Array.isArray(ent) || ent.length < 6) continue;
        const [key, x, y, z, ry, s] = ent;
        if (typeof key !== "string" || !key || key.length > 96) continue;
        const nums = [x, y, z, ry, s].map(Number);
        if (!nums.every((n) => Number.isFinite(n))) continue;
        if (Math.abs(nums[0]) > 1e5 || Math.abs(nums[1]) > 1e5 || Math.abs(nums[2]) > 1e5) continue;
        room.entities.set(key, [nums[0], nums[1], nums[2], nums[3], Math.min(1e3, Math.max(1e-4, nums[4] || 1))]);
        changedE.push([key, ...room.entities.get(key)]);
      }
    }
    if (Array.isArray(m.s)) {
      for (const pair of m.s.slice(0, MAX_OP_SCRIPTS)) {
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const name = String(pair[0]).slice(0, 96);
        const code = String(pair[1]);
        if (!/^[^/\\]+\.js$/i.test(name) || code.length > MAX_SCRIPT_BYTES) continue;
        const prev = room.scripts.get(name) || "";
        if (prev === code) continue;
        room.scripts.set(name, code);
        // 归属在服务端算：客户端自报的"这行是我写的"一律不信。没动的行沿用原作者，
        // 只有这次真的新增/改写的行才记到这次改动的人头上。
        const authors = reblame(prev.split("\n"), room.lineAuthors.get(name), code.split("\n"), peer.user.id);
        room.lineAuthors.set(name, authors);
        // 改动流里只记"动了多少行"，不把整份代码塞进历史：feed 要发给每个人看，
        // 而代码本身已经在 scripts 里了，重复存一遍只是把房间内存翻倍。
        const stat = diffStats(prev, code);
        changedS.push([name, code, rle(authors), stat]);
        pushFeed(room, Object.assign(stamp(peer, "script", name), stat));
      }
    }
    if (!changedV.length && !changedE.length && !changedS.length) return;
    room.seq++;
    if (changedV.length) pushFeed(room, stamp(peer, "voxel", changedV.length + " 格"));
    if (changedE.length) pushFeed(room, stamp(peer, "entity", changedE.length + " 个实体"));
    // by 一起广播：客户端要靠它标"这一格是谁放的"，而 by 是服务端盖的，伪造不了
    broadcast(room, { t: "world", seq: room.seq, v: changedV, e: changedE, s: changedS,
      by: { id: peer.user.id, name: peer.user.name } });
  }

  function worldSnapshot(room) {
    return { seq: room.seq, v: [...room.voxels.entries()].map(([k, val]) => [...k.split(",").map(Number), val[0], val[1]]),
      e: [...room.entities.entries()].map(([k, val]) => [k, ...val]),
      s: [...room.scripts.entries()].map(([name, code]) => [name, code]),
      authors: [...room.lineAuthors.entries()].map(([name, rows]) => [name, rows]) };
  }

  function broadcast(room, msg, except) {
    for (const p of room) if (p !== except) p.send(msg);
  }

  function leave(peer) {
    const room = peer.room;
    if (!room || peer.removed) return;
    peer.removed = true;
    room.delete(peer);
    broadcast(room, { t: "leave", id: peer.id });
    if (!room.size) rooms.delete(room.key);
  }

  function handleFrame(peer, frame) {
    if (frame.opcode === 8) { peer.close(); return; }
    if (frame.opcode === 9) { peer.sock.write(encodeFrame(10, frame.data)); return; }
    if (frame.opcode === 10) { peer.lastSeen = now(); return; }
    if (frame.opcode === 0) {
      if (!peer.frag) return;
      peer.frag.chunks.push(frame.data);
      if (!frame.fin) return;
      const buf = Buffer.concat(peer.frag.chunks);
      const fin = peer.frag.opcode; peer.frag = null;
      if (fin !== 1 || buf.length > MAX_FRAME) return;
      handleText(peer, buf.toString("utf8"));
      return;
    }
    if (frame.opcode !== 1) return;                     // 二进制、保留操作码一律不理
    if (!frame.fin) { peer.frag = { opcode: 1, chunks: [frame.data] }; return; }
    handleText(peer, frame.data.toString("utf8"));
  }

  function handleText(peer, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== "object") return;
    stats.frames++;
    const room = peer.room;
    if (!room) return;

    if (m.t === "state") {
      const dt = now() - peer.lastState;
      if (dt < 1000 / STATE_HZ) return;
      peer.lastState = now();
      const p = Array.isArray(m.p) ? m.p.slice(0, 3).map(Number) : [];
      if (p.length !== 3 || p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e5)) return;
      const yaw = Number(m.r);
      // 朝向同样要夹：客户端拿它做角度差，Infinity 会让"减 2π 直到落回 ±π"那种
      // 归一化循环永远跑不完，一个坏包就能把同伴的整个页面钉死。
      peer.yaw = Number.isFinite(yaw) ? Math.max(-1e4, Math.min(1e4, yaw)) : 0;
      peer.anim = typeof m.a === "string" ? m.a.slice(0, 12) : "idle";
      // 网格名只用来查本图已有的资产，去掉路径分隔符就没有别的作用；长度照截。
      peer.mesh = typeof m.m === "string" ? m.m.replace(/[\\/:*?<>|\u0000-\u001f\u007f]/g, "").slice(0, 48) : "";
      const ms = Number(m.s);
      peer.meshScale = Number.isFinite(ms) ? Math.min(20, Math.max(0.01, ms)) : 1;
      peer.hidden = !!m.h;
      peer.pos = p;
      broadcast(room, { t: "state", id: peer.id, p, r: peer.yaw, a: peer.anim,
        m: peer.mesh, s: peer.meshScale, h: peer.hidden ? 1 : 0 }, peer);
      return;
    }

    if (m.t === "op") {
      // 世界改动走服务端叠加，不走"谁先到谁说了算"的直转：房间里的每个人都只有
      // 提案权，落地顺序由服务端定序，这样两个人同时挖同一格也不会各留一份真相。
      const dt = now() - peer.lastOp;
      if (dt < 1000 / WORLD_OP_HZ) return;
      peer.lastOp = now();
      applyWorldOp(room, m, peer);
      return;
    }

    if (m.t === "note") {
      // "甲 正在写 index.js" 这类提示：只转一个文件名，不传内容。
      // 协作时知道谁在动哪个文件，比事后发现被覆盖了要有用得多。
      if (room.key.startsWith("edit:")) {
        const file = typeof m.file === "string" ? m.file.replace(/[^\w.\-]/g, "").slice(0, 64) : "";
        broadcast(room, { t: "note", id: peer.id, name: peer.user.name, file }, peer);
      }
      return;
    }

    if (m.t === "chat") {
      const raw = String(m.m == null ? "" : m.m).slice(0, MAX_MSG * 2);
      const clean = raw.replace(/\s+/g, " ").trim();
      if (!clean) return;
      const dt = now() - peer.lastChat;
      if (dt < CHAT_COOLDOWN) { peer.send({ t: "throttle", wait: Math.ceil((CHAT_COOLDOWN - dt) / 1000) }); return; }
      peer.lastChat = now();
      // 聊天和社区帖子走同一道审查：能发帖不等于能对着别人脸上刷。
      const verdict = community && community.screenText ? community.screenText(clean, { field: "chat" }) : { blocked: false, clean };
      if (verdict.blocked) { peer.send({ t: "rejected", reason: verdict.reason || "内容不适合公开频道" }); return; }
      stats.chat++;
      // 发送者本地已经先回显过一次了，再把同一条发回去就是屏幕上两行一样的话。
      broadcast(room, { t: "chat", id: peer.id, name: peer.user.name, m: verdict.clean.slice(0, MAX_MSG) }, peer);
      return;
    }

    if (m.t === "ping") peer.send({ t: "pong", now: now() });
  }

  function attach(sock, user, key, head) {
    const room = roomOf(key);
    if (room.size >= MAX_ROOM) {
      stats.rejected++;
      // 101 之后就只能用 WebSocket 关闭码，但这里还没升级，所以走 HTTP 503。
      sock.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); return;
    }
    const peer = new Peer(sock, room, user, crypto.randomBytes(8).toString("hex"));
    room.add(peer);
    stats.joins++;

    peer.send({
      t: "welcome", you: peer.id, room: key, t0: room.start, now: Date.now(),
      world: worldSnapshot(room),
      feed: room.feed.slice(-40),
      peers: [...room].filter((p) => p !== peer).map((p) => ({ id: p.id, name: p.user.name, skin: p.user.skin,
        p: p.pos, r: p.yaw, a: p.anim, m: p.mesh, s: p.meshScale, h: p.hidden ? 1 : 0 })),
    });
    broadcast(room, { t: "join", peer: { id: peer.id, name: user.name, skin: user.skin, p: peer.pos, r: 0, a: "idle", m: "", s: 1, h: 0 } }, peer);

    // 握手响应后面可能紧跟着客户端已经发出的帧，Node 把它们放在 head 里交给我们；
    // 不先喂进去就是"第一句话永远丢"。
    let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    const feed = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > MAX_FRAME * 4) { peer.close(1009, "too big"); return; }
      peer.lastSeen = now();
      for (;;) {
        const r = decodeFrame(buf);
        if (r.bad) { peer.close(1002, r.bad); return; }
        if (r.need) break;
        buf = buf.subarray(r.used);
        handleFrame(peer, r.frame);
        if (peer.dead) return;
      }
    };
    sock.on("data", feed);
    if (buf.length) feed(Buffer.alloc(0));
    sock.on("error", () => peer.close());
    // 对端 tab 被直接关掉时，服务端只会看到 end，close 要等我们自己那头也结束才来。
    // 只挂 close 的话，人走了房间号还占着，列表里全是再也动不了的幽灵。
    sock.on("end", () => peer.close());
    sock.on("close", () => peer.close());
    peer.onClose = () => { leave(peer); };
  }

  /** HTTP 升级入口：路径不对就不接管，交回原来的 server 处理。 */
  function handleUpgrade(req, socket, head) {
    let url;
    try { url = new URL(req.url, "http://localhost"); } catch { socket.destroy(); return; }
    const seg = url.pathname.split("/").filter(Boolean);       // ["ws","play"|"edit","<id>"]
    // 两种房间：play:<发布 id> 是"一起玩这张图"，edit:<世界 id> 是"一起改这张图"。
    // 协作编辑要的是后者——所有人共用一份世界改动流，而不是各自本地改完再靠保存覆盖。
    if (seg[0] !== "ws" || (seg[1] !== "play" && seg[1] !== "edit") || seg.length !== 3) { socket.destroy(); return; }
    const up = String(req.headers.upgrade || "").toLowerCase();
    const conn = String(req.headers.connection || "").toLowerCase();
    const key = req.headers["sec-websocket-key"];
    if (up !== "websocket" || !conn.includes("upgrade") || !key) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return;
    }
    const kind = seg[1];
    const roomId = seg[2];
    const idOk = kind === "play" ? /^[0-9a-f]{12,24}$/.test(roomId) : /^[A-Za-z0-9_-]{4,32}$/.test(roomId);
    if (!idOk) { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return; }
    if (kind === "play") {
      const pub = community && community.livePub(roomId);
      if (!pub) { stats.rejected++; socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    } else if (typeof worldExists === "function" && !worldExists(roomId)) {
      // 编辑房要有这张世界存档才开：否则第二个人进来的是一个空世界，
      // 两个人的"同一张图"根本是两张图。
      stats.rejected++; socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return;
    }
    const user = community && community.sessionUser(req);
    if (!user) { stats.rejected++; socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }

    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    attach(socket, user, (kind === "play" ? "pub:" : "edit:") + roomId, head);
  }

  // 空闲连接靠对端自己报活；45 秒没数据就单方面关掉，房间不会攒僵尸。
  const sweeper = setInterval(() => {
    for (const [, room] of rooms) {
      for (const p of [...room]) if (now() - p.lastSeen > IDLE_MS) p.close(1000, "idle");
    }
  }, 15_000);
  sweeper.unref && sweeper.unref();

  return {
    handleUpgrade,
    stats: () => ({ ...stats, rooms: rooms.size, online: [...rooms.values()].reduce((a, r) => a + r.size, 0) }),
    /** 测试与后台用：某个房间现在有谁。 */
    room: (key) => [...(rooms.get(key) || [])].map((p) => ({ id: p.id, name: p.user.name })),
    close: () => { clearInterval(sweeper); },
  };
}
