/**
 * realtime.test.mjs — 联机通道的端到端回归：握手、房间、状态转发、聊天闸门。
 *
 * 为什么手写一个 WebSocket 客户端：这个仓库的运行时依赖是零，测试也不该为了
 * 一条通道装 ws/autocannon。客户端要做的只是把帧掩码上——协议规定客户端帧
 * 必须掩码，服务端反过来要拒绝不掩码的帧，所以这段代码本身就是被测对象的一半。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
// 只要 freePort：这条套件自己不起浏览器，但它的 server.js 一样会留在端口上
import { freePort } from "./cdp.mjs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(5700, 200);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-realtime-"));

const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanup() {
  try { child.kill("SIGTERM"); } catch { /* 已经退了 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 临时目录交给系统 */ }
}
process.on("exit", cleanup);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; 

console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + String(extra).slice(0, 240) : "")); }
};

{
  let up = false;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      const j = await (await fetch(BASE + "/api/whoami")).json().catch(() => null);
      if (j && j.app === "laoyou-metaverse") { up = true; break; }
    } catch { /* 还没起来 */ }
  }
  if (!up) { console.log("FAIL  测试用的本地服务起不来（端口 " + PORT + "）"); process.exit(1); }
}

/* ---------------- 极简 HTTP（只为登录与发布拿 cookie） ---------------- */
async function call(method, p, body, cookie, csrf) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  // 写操作要"读一次再写"：服务端认的是 X-CSRF-Token 与 ly_csrf cookie 同源配对，
  // 光带 cookie 不带 header 会被当成跨站请求。
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  const setc = res.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
  return { status: res.status, json: j, cookie: setc };
}

/** 注册一个账号并返回会话 cookie。首个账号是管理员。 */
async function account(name) {
  const probe = await call("GET", "/api/community/me");
  const csrf = (probe.cookie.match(/ly_csrf=([^;]+)/) || [])[1] || "";
  const r = await call("POST", "/api/community/register", { name, password: "a-long-enough-password" }, `ly_csrf=${csrf}`, csrf);
  if (r.status !== 200) throw new Error("注册失败 " + r.status + " " + JSON.stringify(r.json));
  const sess = (r.cookie.match(/ly_session=([^;]+)/) || [])[1] || "";
  return { cookie: `ly_session=${sess}; ly_csrf=${csrf}`, csrf, name };
}

/* ---------------- 手写 WebSocket 客户端 ---------------- */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function clientFrame(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let head;
  if (len < 126) { head = Buffer.allocUnsafe(2); head[1] = 0x80 | len; }
  else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.allocUnsafe(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81;
  const data = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) data[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, data]);
}

/** 连上去；resolve 出 {sock, msgs, send, until, close}，HTTP 状态码非 101 时 reject 带 status。 */
function wsConnect(p, cookie) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(PORT, "127.0.0.1", () => {
      sock.write(
        `GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie || ""}\r\n\r\n`,
      );
    });
    let handshaken = false, buf = Buffer.alloc(0);
    const msgs = [];
    const waiters = new Set();
    const api = {
      sock, msgs,
      send(obj) { sock.write(clientFrame(typeof obj === "string" ? obj : JSON.stringify(obj))); },
      sendRaw(b) { sock.write(b); },
      async until(pred, ms = 3000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const hit = msgs.find(pred);
          if (hit) return hit;
          await new Promise((r) => { const w = () => { waiters.delete(w); r(); }; waiters.add(w); setTimeout(w, 60); });
        }
        return null;
      },
      close() { try { sock.destroy(); } catch { /* 已经关了 */ } },
    };
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buf.subarray(0, end).toString("latin1");
        buf = buf.subarray(end + 4);
        if (!head.startsWith("HTTP/1.1 101")) {
          const status = (head.match(/HTTP\/1\.1 (\d+)/) || [])[1];
          sock.destroy();
          reject(Object.assign(new Error("握手被拒 " + status), { status }));
          return;
        }
        const want = crypto.createHash("sha1").update(key + GUID).digest("base64");
        if (!head.includes(`Sec-WebSocket-Accept: ${want}`)) { sock.destroy(); reject(new Error("Accept 值不对")); return; }
        handshaken = true;
        resolve(api);
      }
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const body = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 1) {
          try { msgs.push(JSON.parse(body.toString("utf8"))); for (const w of waiters) w(); } catch { /* 非 JSON 忽略 */ }
        }
      }
    });
    sock.on("error", () => { /* 断连由 close 统一处理 */ });
    // 服务端对不接管的升级请求是直接 destroy，一个字节都不回。
    // 不在这里落定 promise，测试就会永远挂在一个"等不到握手"的连接上。
    sock.on("close", () => {
      if (!handshaken) reject(Object.assign(new Error("连接被关掉，没握手"), { status: "closed" }));
    });
  });
}

/* ---------------- 开始 ---------------- */
const A = await account("联机甲" + Date.now().toString(36).slice(-4));
const B = await account("联机乙" + Date.now().toString(36).slice(-4));

// 造一件可玩的发布物：房间 key 必须是真实存在的作品 id
const pub = await call("POST", "/api/community/publish", { worldId: "216d665d3ca92bd1b9a2", title: "联机试验场", desc: "两个人同一张图" }, A.cookie, A.csrf);
const pubId = pub.json && pub.json.pub && pub.json.pub.id;
ok("先发布一件作品当房间", !!pubId, JSON.stringify(pub.json));

const noAuth = await wsConnect(`/ws/play/${pubId}`, "").then(() => null, (e) => e);
ok("没登录连不上房间", noAuth && noAuth.status === "401", noAuth && noAuth.status);
const badRoom = await wsConnect("/ws/play/000000000000", A.cookie).then(() => null, (e) => e);
ok("不存在的作品开不出房间", badRoom && badRoom.status === "404", badRoom && badRoom.status);
const badPath = await wsConnect("/ws/other/x", A.cookie).then(() => null, (e) => e);
ok("非 /ws/play 的升级请求不被接管", !!badPath, String(badPath));

const c1 = await wsConnect(`/ws/play/${pubId}`, A.cookie);
const w1 = await c1.until((m) => m.t === "welcome");
ok("进房拿到 welcome 与自己是谁", !!w1 && !!w1.you, JSON.stringify(w1));
ok("房里的第一个人没有同伴", !!w1 && (!w1.peers || w1.peers.length === 0), JSON.stringify(w1 && w1.peers));
// 世界时间要有共同起点：welcome 得带房间创建时刻与服务端当前时间，
// 否则每个人各自从 tick 0 数，按 currentTick 计时的脚本在两人屏幕上会错开。
ok("welcome 带世界时钟（t0 与 now）", !!w1 && Number.isFinite(w1.t0) && Number.isFinite(w1.now) && w1.now >= w1.t0,
  JSON.stringify(w1 && { t0: w1.t0, now: w1.now }));

const c2 = await wsConnect(`/ws/play/${pubId}`, B.cookie);
const joined = await c1.until((m) => m.t === "join" && m.peer && m.peer.name === B.name);
ok("第二个人进来时第一个人收到 join", !!joined);
const w2 = await c2.until((m) => m.t === "welcome");
ok("后来的人能看到已在场的人", !!w2 && w2.peers.length === 1 && w2.peers[0].name === A.name, JSON.stringify(w2 && w2.peers));

c1.send({ t: "state", p: [12.5, 3, -7.25], r: 1.5, a: "run" });
const st = await c2.until((m) => m.t === "state" && m.id === w1.you);
ok("位置与朝向转发给了同伴", !!st && st.p[0] === 12.5 && st.p[2] === -7.25 && st.r === 1.5, JSON.stringify(st));
// 动作状态必须跟着走：只有坐标的话，同伴看见的是一个"在平移但四肢不动"的假人。
ok("动作状态也跟着转发", !!st && st.a === "run", JSON.stringify(st));


c1.send({ t: "state", p: [1, 1, 1] });
c1.send({ t: "state", p: [2, 2, 2] });
const burst = (c2.msgs.filter((m) => m.t === "state").length);
ok("状态转发有节流（连发不会全转）", burst === 1, "got " + burst);

// 载具/隐身也要转发：赛车图把玩家换成汽车并把自己藏起来，这三样不转的话
// 同伴看到的是一具悬在车位置上的裸人偶——就是"两个人进图就崩坏"的那个崩。
await sleep(150); // 转发有 10Hz 节流：上一条测试刚把窗口用掉，不等就只会测到"没收到"
c1.send({ t: "state", p: [13, 3, -8], r: 0.4, a: "idle", m: "汽车模板-1", s: 0.0625, h: 1 });
const st2 = await c2.until((x) => x.t === "state" && x.id === w1.you && x.m === "汽车模板-1");
ok("网格名、缩放与隐身一起转发", !!st2 && st2.s === 0.0625 && st2.h === 1, JSON.stringify(st2));
// 网格名是从网络来的字符串：路径分隔符必须被削掉，否则它就是一个穿越载体
await sleep(150);
c1.send({ t: "state", p: [13, 3, -8], r: 0.4, m: "../../etc/passwd\u0000" });
// 只认"以点开头"的那一条：前面几条状态里的 m 要么是空、要么是"汽车模板-1"，
// 用它当选择条件才能证明我们等到的是这条被削过名字的包。
const st3 = await c2.until((x) => x.t === "state" && x.id === w1.you && typeof x.m === "string" && x.m.startsWith(".."));
ok("网格名里的路径分隔符被削掉", !!st3 && st3.m === "....etcpasswd", st3 && JSON.stringify(st3.m));

await sleep(1100);
c1.send({ t: "state", p: ["x", null, {}], r: "转" });
c1.send({ t: "state", p: [1e9, 0, 0] });
await sleep(400);
// 按内容判而不是按条数判：条数会把之前那条合法状态也算进来，测的就不是这一件事了
const badSeen = c2.msgs.filter((m) => m.t === "state"
  && (!Array.isArray(m.p) || m.p.length !== 3 || m.p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6)));
ok("非数字或越界的坐标不会被广播出去", badSeen.length === 0, JSON.stringify(badSeen));


c1.send({ t: "chat", m: "你那边能看到我了吗" });
const chat = await c2.until((m) => m.t === "chat" && m.name === A.name);
ok("聊天以发送者的昵称播出", !!chat && chat.text === "你那边能看到我了吗", JSON.stringify(chat));
ok("聊天带着频道走：房间里的话属于这张图的频道", !!chat && chat.ch === "map:" + pubId, chat && chat.ch);
ok("发送者不会收到自己那条的回声", !c1.msgs.some((m) => m.t === "chat"), JSON.stringify(c1.msgs.filter((m) => m.t === "chat")));

c1.send({ t: "chat", m: "第二句" });
const th = await c1.until((m) => m.t === "rejected");
ok("连发会被限流并告知原因", !!th && /太快/.test(th.reason || ""), JSON.stringify(th));

await sleep(1400);
c1.send({ t: "chat", m: "<script>alert(1)</script>" });
const rej = await c1.until((m) => m.t === "rejected" && /太快/.test(m.reason || "") === false);
ok("夹带标签的聊天被挡下且不广播", !!rej, JSON.stringify(c1.msgs.slice(-3)));
ok("被挡的那条没进同伴的屏幕", !c2.msgs.some((m) => m.t === "chat" && /alert/.test(m.text || "")));

// 房间里说的话现在必须留得下来：以前 broadcast 完就丢，详情页与之后进来的人看不见历史
const hist = await call("GET", `/api/community/chat?ch=map:${pubId}`, undefined, B.cookie);
const lines = (hist.json && hist.json.rows) || [];
ok("地图频道的聊天会落盘，之后还能翻到历史",
  lines.some((x) => x.text === "你那边能看到我了吗") && !lines.some((x) => /alert/.test(x.text)),
  JSON.stringify(lines.map((x) => x.text)));

c2.close();
const gone = await c1.until((m) => m.t === "leave");
ok("同伴离开时收到 leave", !!gone, JSON.stringify(c1.msgs.slice(-2)));

// 不掩码的帧不符合 RFC6455，服务端必须断开而不是当正常帧读
const rude = await wsConnect(`/ws/play/${pubId}`, A.cookie);
rude.sendRaw(Buffer.from([0x81, 0x05, 0x7b, 0x22, 0x74, 0x22, 0x7d]));
const cut = await new Promise((r) => {
  const t = setTimeout(() => r(false), 1200);
  rude.sock.on("close", () => { clearTimeout(t); r(true); });
  rude.sock.on("error", () => { clearTimeout(t); r(true); });
});
ok("不掩码的客户端帧被直接断开", cut);

const huge = await wsConnect(`/ws/play/${pubId}`, A.cookie);
const head = Buffer.allocUnsafe(10); head[0] = 0x81; head[1] = 0x80 | 127;
head.writeBigUInt64BE(BigInt(9 * 1024 * 1024), 2);
huge.sendRaw(Buffer.concat([head, crypto.randomBytes(4), Buffer.alloc(1024)]));
const cut2 = await new Promise((r) => {
  const t = setTimeout(() => r(false), 1500);
  huge.sock.on("close", () => { clearTimeout(t); r(true); });
  huge.sock.on("error", () => { clearTimeout(t); r(true); });
});
ok("超大帧被拒掉而不是撑爆内存", cut2);

// 客户端把"请求 + 第一帧"写在同一个 TCP 包里是合法的（Chrome 就会这样）。
// Node 会把多出来的字节放进 head 交给我们，不接住的话玩家进房后说的第一句话永远丢。
// 前面 c2 已经关掉了，这里要另开一个还在场上的接收方，否则测的是"没人收"而不是"丢帧"。
const listener = await wsConnect(`/ws/play/${pubId}`, B.cookie);
await listener.until((m) => m.t === "welcome");
const pipelined = new Promise((res, rej) => {
  const key = crypto.randomBytes(16).toString("base64");
  const s = net.connect(PORT, "127.0.0.1", () => {
    s.write(Buffer.concat([
      Buffer.from(
        `GET /ws/play/${pubId} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: ${A.cookie}\r\n\r\n`, "latin1"),
      clientFrame(JSON.stringify({ t: "chat", m: "和握手写在同一个包里的第一句话" })),
    ]));
  });
  s.on("error", rej);
  res(s);
});
await pipelined;
const first = await listener.until((m) => m.t === "chat" && /同一个包里的第一句话/.test(m.text || ""));
ok("和握手挤在同一个包里的第一帧不会丢", !!first, JSON.stringify(listener.msgs.filter((m) => m.t === "chat")));
listener.close();

/* ---------------- 社交通道：不进房间也要在线、也要收到世界频道 ---------------- */
const social = await wsConnect("/ws/social", B.cookie);
const sw = await social.until((m) => m.t === "welcome");
ok("社区页那条连接能握上手（它不进任何房间）", !!sw && sw.room === "social", JSON.stringify(sw));
await call("POST", "/api/community/chat", { ch: "world", text: "全世界都听得见我" }, A.cookie, A.csrf);
const wpush = await social.until((m) => m.t === "chat" && m.ch === "world");
ok("世界频道的消息会推给不在图里的人", !!wpush && /全世界/.test(wpush.text || ""), JSON.stringify(wpush));
const noSoc = await wsConnect("/ws/social", "").then(() => null, (e) => e);
ok("没登录连不上社交通道", !!noSoc && noSoc.status === "401", String(noSoc && noSoc.status));
social.close();

c1.close(); c2.close();
/* ---------------- 世界改动：服务端定序，落到所有人身上 ---------------- */
{
  // 自己开两个连接：前面那组 c1/c2 在"同伴离开"那条测试里已经关掉了，
  // 而且它们的消息尾巴被后面的断言按位置读取，插进来只会互相污染。
  const A2 = await account("世界甲" + Date.now().toString(36).slice(-4));
  const B2 = await account("世界乙" + Date.now().toString(36).slice(-4));
  const C2 = await account("世界丙" + Date.now().toString(36).slice(-4));
  const a = await wsConnect(`/ws/play/${pubId}`, A2.cookie);
  const b = await wsConnect(`/ws/play/${pubId}`, B2.cookie);
  await a.until((x) => x.t === "welcome");
  await b.until((x) => x.t === "welcome");
  await sleep(150);
  a.send({ t: "op", v: [[10, 20, 30, 7, 1]], e: [["门#0", 1.5, 2, 3.5, 0.5, 1]] });
  const wa = await a.until((x) => x.t === "world" && x.v && x.v.length);
  const wb = await b.until((x) => x.t === "world" && x.v && x.v.length);
  // 改的人自己也收到：权威在服务端，客户端不假设"我改了就一定对"。
  ok("世界改动发给房间里所有人，包括改的人自己", !!wa && !!wb && wa.seq === wb.seq, JSON.stringify({ a: wa && wa.seq, b: wb && wb.seq }));
  ok("方块改动带值转发（不是只报坐标）", !!wb && JSON.stringify(wb.v[0]) === "[10,20,30,7,1]", JSON.stringify(wb && wb.v));
  ok("实体位姿一起转发", !!wb && wb.e && wb.e[0][0] === "门#0" && wb.e[0][1] === 1.5, JSON.stringify(wb && wb.e));
  // 后进来的人必须看到"已被改过的世界"，否则他眼里的图和别人不是同一张。
  const c = await wsConnect(`/ws/play/${pubId}`, C2.cookie);
  const wc = await c.until((x) => x.t === "welcome");
  ok("后进来的人拿到世界改动快照", !!wc && !!wc.world && wc.world.v.some((v) => v[0] === 10 && v[3] === 7)
    && wc.world.e.some((e) => e[0] === "门#0"), JSON.stringify(wc && wc.world));
  ok("快照带服务端序号", !!wc && Number.isFinite(wc.world.seq) && wc.world.seq >= 1, String(wc && wc.world && wc.world.seq));
  // 坏包：非整数、越界、非法旋转码都不能进权威日志
  await sleep(150);
  a.send({ t: "op", v: [[1.5, 2, 3, 7, 0], [1e9, 0, 0, 7, 0], [0, 0, 0, 7, 9], ["x", 1, 2, 3, 0]] });
  await sleep(300);
  ok("非整数/越界/非法旋转码的方块改动被丢掉", !b.msgs.some((x) => x.t === "world" && x.v
    && x.v.some((v) => v[0] === 1.5 || v[0] === 1e9 || v[4] === 9 || typeof v[0] === "string")),
    JSON.stringify(b.msgs.filter((x) => x.t === "world").slice(-1)));
  await sleep(150);
  // 5000 格那种包在帧上限就被拒了（见上面"超大帧"），要验这条叠加上限得用一条
  // 合法大小、但格数超过 MAX_OP_CELLS 的包。
  a.send({ t: "op", v: Array.from({ length: 1200 }, (_, i) => [i, 0, 0, 7, 0]) });
  const big = await b.until((x) => x.t === "world" && x.v && x.v.length >= 1000, 2500);
  ok("一条包里的改动格数有上限", !!big && big.v.length === 1000, big ? String(big.v.length) : "没转发");
  a.close(); b.close(); c.close();
}

/* ---------------- 编辑协作房：脚本归属由服务端判 ---------------- */
{
  const W = "216d665d3ca92bd1b9a2";
  const P = await account("协作甲" + Date.now().toString(36).slice(-4));
  const Q = await account("协作乙" + Date.now().toString(36).slice(-5));
  const a = await wsConnect(`/ws/edit/${W}`, P.cookie);
  const b = await wsConnect(`/ws/edit/${W}`, Q.cookie);
  const wa = await a.until((x) => x.t === "welcome");
  await b.until((x) => x.t === "welcome");
  ok("编辑协作房能开（edit:<世界 id>）", !!wa && !!wa.world && Array.isArray(wa.feed), JSON.stringify(wa && { room: wa.room, feed: (wa.feed || []).length }));

  const three = "line1\nline2\nline3";
  a.send({ t: "op", s: [["index.js", three]] });
  const sa = await b.until((x) => x.t === "world" && x.s && x.s.length);
  ok("脚本改动转发给了同伴，并带服务端作者戳", !!sa && sa.s[0][0] === "index.js" && !!sa.by && !!sa.by.name, JSON.stringify(sa && sa.by));
  ok("首发时三行都记在写的人头上", !!sa && JSON.stringify(sa.s[0][2]) === JSON.stringify([[sa.by.id, 3]]), JSON.stringify(sa && sa.s[0][2]));

  // 乙只改中间那一行：归属必须保留甲的第一、三行
  await sleep(150);
  b.send({ t: "op", s: [["index.js", "line1\nLINE2-BY-B\nline3"]] });
  // 必须等"乙署名的那一条"：a 自己第一次发的改动也会被广播回来（含自己），
  // 只按 t==="world" 取到的是自己那条旧包，测出来永远是"三行都是我的"。
  const sb = await a.until((x) => x.t === "world" && x.s && x.s.length && x.by && x.by.name === Q.name);
  const rows = sb && sb.s[0][2];
  const byA = wa.you && rows && rows.length;
  ok("改一行不会把整份文件算成改的人写的", !!sb && Array.isArray(rows) && rows.length === 3,
    JSON.stringify(rows) + " / by=" + (sb && sb.by && sb.by.name));
  ok("改动流记下谁改了哪个文件与行数", !!sb && sb.s[0][1].includes("LINE2-BY-B")
    && (await b.until((x) => x.t === "world" && x.s && x.s.length)) && true);

  // "谁在写哪个文件"的提示只发给别人，不回流给自己
  await sleep(150);
  a.send({ t: "note", file: "index.js" });
  const nb = await b.until((x) => x.t === "note" && x.file === "index.js");
  ok("正在编辑哪个文件会告诉同伴", !!nb && nb.name === P.name, JSON.stringify(nb));
  ok("note 不回流给发送者自己", !a.msgs.some((x) => x.t === "note"), JSON.stringify(a.msgs.filter((x) => x.t === "note")));

  // 客户端自报的作者不算数：广播里的 by 只能是服务端会话里的人
  await sleep(150);
  a.send({ t: "op", by: { id: "ghost", name: "幽灵" }, s: [["index.js", "line1\nLINE2\nline3\nextra"]] });
  const sg = await b.until((x) => x.t === "world" && x.s && x.s[0][1].includes("extra"));
  ok("广播里的作者来自会话而不是客户端自报", !!sg && sg.by && sg.by.name === P.name, JSON.stringify(sg && sg.by));

  a.close(); b.close();
  const bad = await wsConnect("/ws/edit/does-not-exist-0000", P.cookie).then(() => null, (e) => e);
  ok("没有这份世界存档就开不了协作房", !!bad && String(bad.status) === "404", String(bad && bad.status));
}

console.log(`\nrealtime: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
