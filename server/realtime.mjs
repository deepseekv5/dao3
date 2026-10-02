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

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 32 * 1024;          // 一条状态帧几十字节；给到 32 KB 已经宽到可以当攻击面用
const MAX_ROOM = 24;                  // 一个房间的人数上限：本地服务不是给压测用的
const MAX_MSG = 200;                  // 聊天长度
const CHAT_COOLDOWN = 1200;           // 同一个人两句话之间至少隔这么久
const STATE_HZ = 12;                  // 状态转发节流：人手每秒发 12 帧足够顺滑
const IDLE_MS = 45_000;               // 这么久没有任何动静就踢掉

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

export function createRealtime({ community } = {}) {
  const rooms = new Map();               // "pub:<id>" -> Set<Peer>
  const stats = { joins: 0, chat: 0, frames: 0, rejected: 0 };

  function roomOf(key) {
    let r = rooms.get(key);
    if (!r) { r = new Set(); r.key = key; rooms.set(key, r); }
    return r;
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
      const yaw = Number(m.r); peer.yaw = Number.isFinite(yaw) ? yaw : 0;
      peer.anim = typeof m.a === "string" ? m.a.slice(0, 12) : "idle";
      peer.pos = p;
      broadcast(room, { t: "state", id: peer.id, p, r: peer.yaw, a: peer.anim }, peer);
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
      t: "welcome", you: peer.id, room: key,
      peers: [...room].filter((p) => p !== peer).map((p) => ({ id: p.id, name: p.user.name, skin: p.user.skin, p: p.pos, r: p.yaw, a: p.anim })),
    });
    broadcast(room, { t: "join", peer: { id: peer.id, name: user.name, skin: user.skin, p: peer.pos, r: 0, a: "idle" } }, peer);

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
    const seg = url.pathname.split("/").filter(Boolean);       // ["ws","play","<pubId>"]
    if (seg[0] !== "ws" || seg[1] !== "play" || seg.length !== 3) { socket.destroy(); return; }
    const up = String(req.headers.upgrade || "").toLowerCase();
    const conn = String(req.headers.connection || "").toLowerCase();
    const key = req.headers["sec-websocket-key"];
    if (up !== "websocket" || !conn.includes("upgrade") || !key) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return;
    }
    const pubId = seg[2];
    if (!/^[0-9a-f]{12,24}$/.test(pubId)) { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return; }
    const pub = community && community.livePub(pubId);
    if (!pub) { stats.rejected++; socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    const user = community && community.sessionUser(req);
    if (!user) { stats.rejected++; socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }

    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    attach(socket, user, "pub:" + pubId, head);
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
