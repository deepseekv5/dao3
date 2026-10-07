/**
 * community.test.mjs — 社区层的端到端回归：账号、关注、好友、发布、评论、闸门。
 *
 * 为什么自己搓一个带 cookie 的 HTTP 客户端：这条链路的**全部意义**在于
 * "谁在说话"。用裸 fetch 测出来的"能跑"是假的——所有请求都会变成匿名，
 * 鉴权与越权分支一次都走不到。
 *
 * 自己起一个服务、自己挑一个干净的数据目录（见下面 freePort 那段）。
 * 测试账号用随机后缀，跑完把自己的发布下架，不给广场留垃圾；
 * 用户本人删不掉自己的账号（追责要留得住人），后台的注销接口只有管理员能用，
 * 所以最后一节专门拿一个"牺牲丁"账号去走那条不可回退的路。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
// 这条套件不起浏览器，但只要那个 freePort：端口被上一轮的僵尸服务占着时，
// bind 失败不会报错，fetch 照样 200——回答的是上一轮那个陌生库，账号已注册。
import { freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 服务发现靠 /api/whoami 的 app 标识。改名时只改 server.js 的话，
// 所有浏览器测试会安静地 SKIP 掉——比失败更糟，所以这里当场对一遍。
{
  const ours = /const OUR_APP = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "server.js"), "utf8"));
  const probe = /const APP_ID = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "test/browser.mjs"), "utf8"));
  if (!ours || !probe || ours[1] !== probe[1]) {
    console.log("FAIL  服务标识不一致：server.js=" + (ours && ours[1]) + " test/browser.mjs=" + (probe && probe[1]));
    process.exit(1);
  }
}

/* 自己起一个服务、自己挑一个干净的数据目录。
   借用开发中那个实例有两个问题：测试账号永远留在开发库里；
   而"首个注册账号是管理员"这类规则只有在空库上才测得准。 */
const PORT = await freePort(5400, 400);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ly-community-test-"));
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR },
});
const BASE = `http://127.0.0.1:${PORT}`;
function cleanup() {
  try { child.kill("SIGTERM"); } catch { /* 已经退了 */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* 临时目录交给系统 */ }
}
process.on("exit", cleanup);
{
  let up = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const r = await fetch(BASE + "/api/whoami");
      const j = await r.json().catch(() => null);
      if (j && j.app === "laoyou-metaverse") { up = true; break; }
    } catch { /* 还没起来 */ }
  }
  if (!up) { console.log("FAIL  测试用的本地服务起不来（端口 " + PORT + "）"); process.exit(1); }
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
};
const S = (n) => new Promise((r) => setTimeout(r, n));
/** 二进制上传：call() 只会发 JSON，这里单独走一条。 */
async function uploadFile(c, path, buf) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "image/png", cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join("; "), "x-csrf-token": c.csrf },
    body: buf,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/* 最小 cookie jar：只关心 ly_session / ly_csrf 两枚。
   写接口一律要 CSRF，所以每个客户端先 GET 一次 /me 领 cookie——浏览器也是这个顺序：
   先加载页面，页面里的 community.js 调 /me，之后才发得出写请求。 */
function client() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    jar,
    get csrf() { return jar.get("ly_csrf") || ""; },
    async call(method, path, body) {
      // 浏览器是"先加载页面 → 页面调 /me → 才发得出写请求"。客户端也照这个顺序补一次，
      // 否则每个新建 client 都要手动 boot()，测的就不是权限而是领 cookie 了。
      if (method !== "GET" && !jar.get("ly_csrf")) await this.call("GET", "/api/community/me");
      const headers = { "Content-Type": "application/json" };
      if (jar.size) headers.cookie = cookieHeader();
      if (method !== "GET") headers["x-csrf-token"] = this.csrf;
      const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
      for (const line of res.headers.getSetCookie?.() || []) {
        const [kv] = line.split(";");
        const i = kv.indexOf("=");
        const k = kv.slice(0, i).trim(), v = decodeURIComponent(kv.slice(i + 1).trim());
        if (v === "") jar.delete(k); else jar.set(k, v);
      }
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("json") ? await res.json().catch(() => null) : null;
      return { status: res.status, data };
    },
    boot() { return this.call("GET", "/api/community/me"); },
  };
}

const suffix = Date.now().toString(36).slice(-5);
// 广场是共享的：只在本轮这几张图之间比排序，别拿上一轮的残留当对照组
const runRows = (feed) => feed.rows.filter((p) => p.title.startsWith(RUN)).map((p) => p.id);
// 广场是共享的：标题带上这一轮的后缀，否则上一轮没清干净的发布会让"命中一条"变成"命中两条"
const RUN = "r" + suffix;
const A = client(), B = client(), C = client();
const nameA = `老攸${suffix}`, nameB = `测试乙${suffix}`, nameC = `路人丙${suffix}`;
const PW = "a-long-enough-password-42";
const RATE_COMMENT = Number(process.env.COMMUNITY_RATE_COMMENT || 20);

try {
  await Promise.all([A.boot(), B.boot(), C.boot()]);

  /* ---------- 1. 注册与身份 ---------- */
  let r = await A.call("POST", "/api/community/register", { name: nameA, password: PW });
  ok("注册返回身份与 csrf", r.status === 200 && r.data.user.name === nameA && !!r.data.csrf, JSON.stringify(r.data));
  const idA = r.data.user?.id;
  ok("注册响应里没有口令哈希", !JSON.stringify(r.data).match(/"hash"|"salt"/));
  r = await A.call("GET", "/api/community/me");
  ok("会话 cookie 让 /me 认出我", r.status === 200 && r.data.user && r.data.user.name === nameA, JSON.stringify(r.data));

  r = await B.call("POST", "/api/community/register", { name: nameB, password: PW });
  ok("第二个用户能注册", r.status === 200 && r.data.user.name === nameB, JSON.stringify(r.data));
  r = await C.call("POST", "/api/community/register", { name: nameC, password: PW });
  ok("第三个用户能注册", r.status === 200, JSON.stringify(r.data));

  r = await client().call("POST", "/api/community/register", { name: nameA, password: PW });
  ok("同名注册被拒（大小写不敏感）", r.status === 409, `${r.status} ${JSON.stringify(r.data)}`);
  r = await client().call("POST", "/api/community/register", { name: "x", password: PW });
  ok("名字太短被拒", r.status === 400, r.status);
  r = await client().call("POST", "/api/community/register", { name: `坏名${suffix}<script>`, password: PW });
  ok("带尖括号的名字被拒", r.status === 400, r.status);
  r = await client().call("POST", "/api/community/register", { name: `短口令${suffix}`, password: "123" });
  ok("口令太短被拒", r.status === 400, r.status);

  r = await client().call("POST", "/api/community/login", { name: nameA, password: "wrong-password-xx" });
  ok("错口令登录 401", r.status === 401, r.status);
  r = await client().call("POST", "/api/community/login", { name: `不存在的人${suffix}`, password: PW });
  ok("不存在的账号也是 401（不泄露有没有）", r.status === 401, r.status);
  const relog = client();
  await relog.boot();
  r = await relog.call("POST", "/api/community/login", { name: nameA, password: PW });
  ok("登录成功并发新会话", r.status === 200 && r.data.user.id === idA, JSON.stringify(r.data).slice(0, 120));
  r = await relog.call("PATCH", "/api/community/me", { bio: "换个签名" });
  ok("新会话立刻可用（能改自己的签名）", r.status === 200 && r.data.user.bio === "换个签名", JSON.stringify(r.data));

  /* ---------- 2. CSRF 闸门 ---------- */
  const jarHeader = (c) => [...c.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const rawPost = async (path, token) => (await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: jarHeader(A), ...(token === null ? {} : { "x-csrf-token": token }) },
    body: "{}",
  })).status;
  ok("缺 X-CSRF-Token 的写请求被拒", await rawPost("/api/community/follow", null) === 403);
  ok("csrf 头与 cookie 不一致同样被拒", await rawPost("/api/community/follow", "guessed-value") === 403);
  const crossSite = await fetch(BASE + "/api/community/follow", {
    method: "POST", mode: "no-cors", body: "{}",   // 模拟跨站表单：带得上 cookie，带不上自定义头
  }).then((x) => x.status).catch(() => 0);
  ok("跨站表单式提交过不了 CSRF 这一关", [0, 403].includes(crossSite), crossSite);

  /* ---------- 3. 匿名读、登录写 ---------- */
  const anon = client();
  r = await anon.call("GET", "/api/community/feed");
  ok("匿名能看广场", r.status === 200 && Array.isArray(r.data.rows), JSON.stringify(r.data).slice(0, 120));
  r = await anon.call("POST", "/api/community/follow", { name: nameB });
  ok("匿名关注被拒 401", r.status === 401, r.status);

  /* ---------- 4. 关注 ---------- */
  r = await A.call("POST", "/api/community/follow", { name: nameB });
  ok("A 关注 B", r.status === 200 && r.data.following === true, JSON.stringify(r.data));
  r = await B.call("GET", `/api/community/users/${encodeURIComponent(nameA)}`);
  ok("B 看到 A 的关注关系", r.status === 200 && r.data.user?.relation?.followedBy === true, JSON.stringify(r.data));
  r = await A.call("POST", "/api/community/follow", { name: nameA });
  ok("不能关注自己", r.status === 400, r.status);
  r = await B.call("GET", "/api/community/notifications");
  ok("B 收到被关注的通知", r.status === 200 && r.data.rows.some((n) => n.kind === "follow" && n.actor.name === nameA), JSON.stringify(r.data).slice(0, 200));

  /* ---------- 5. 好友：请求 / 反向即接受 / 拒绝 / 解除 ---------- */
  r = await A.call("POST", "/api/community/friend/request", { name: nameC });
  ok("A 向 C 发好友请求", r.status === 200 && r.data.friend === false, JSON.stringify(r.data));
  r = await A.call("POST", "/api/community/friend/request", { name: nameC });
  ok("重复请求被拒", r.status === 409, r.status);
  r = await C.call("POST", "/api/community/friend/request", { name: nameA });
  ok("对方回请求＝直接成为好友", r.status === 200 && r.data.accepted === true, JSON.stringify(r.data));
  r = await A.call("GET", "/api/community/friends");
  ok("A 的好友列表里有 C", r.status === 200 && r.data.friends.some((u) => u.name === nameC), JSON.stringify(r.data.friends));
  r = await A.call("POST", "/api/community/friend/remove", { name: nameC });
  ok("能解除好友", r.status === 200 && r.data.friend === false, r.status);
  r = await A.call("POST", "/api/community/friend/request", { name: nameC });
  ok("解除后能重新发请求", r.status === 200, r.status);
  r = await C.call("POST", "/api/community/friend/decline", { name: nameA });
  ok("C 拒绝请求", r.status === 200 && r.data.friend === false, JSON.stringify(r.data));
  r = await C.call("POST", "/api/community/friend/accept", { name: nameA });
  ok("没有待处理请求时 accept 报 404", r.status === 404, r.status);

  /* ---------- 5b. 可能认识：得说得出"凭什么推荐这个人" ---------- */
  r = await B.call("POST", "/api/community/friend/request", { name: nameA });
  ok("B 向 A 发好友请求", r.status === 200 && r.data.friend === false, r.status);
  r = await A.call("POST", "/api/community/friend/accept", { name: nameB });
  ok("A 接受后两人成好友", r.status === 200 && r.data.friend === true, JSON.stringify(r.data));
  r = await B.call("POST", "/api/community/follow", { name: nameC });
  ok("B 关注 C", r.status === 200, r.status);
  r = await A.call("GET", "/api/community/friends");
  const sug = (r.data.suggested || []).find((u) => u.name === nameC);
  // mutual 是这一栏唯一的理由：只有名字的话，"可能认识"和"随机抽人"没区别。
  ok("A 的「可能认识」列出 C，并带上 1 个好友在跟", r.status === 200 && !!sug && sug.mutual === 1, JSON.stringify(r.data.suggested));
  ok("已加好友的人不会出现在「可能认识」里", !(r.data.suggested || []).some((u) => u.name === nameB), JSON.stringify((r.data.suggested || []).map((u) => u.name)));

  /* ---------- 6. 发布：快照不可变 ---------- */
  // 绝不拿用户真实的世界做写测试：默认地图上留一丝残留都查不出来。
  // 造一张一次性的小图，测完删掉。
  const TW = "lytest" + suffix;
  const mkPayload = (n, name) => ({
    formatVersion: 1, shape: [8, 8, 8], dir: [1, 1, 1],
    indices: Array.from({ length: 512 }, (_, i) => i),
    data: new Array(512).fill(n), rot: new Array(512).fill(0),
    meta: { name, created: Date.now() },
  });
  const putWorld = (payload) => fetch(`${BASE}/api/world/${TW}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }).then((x) => x.json());
  const TW2 = "lytest2" + suffix;
  const putWorld2 = (payload) => fetch(`${BASE}/api/world/${TW2}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }).then((x) => x.json());
  const world = { id: TW };
  ok("能建一张一次性世界", (await putWorld(mkPayload(1, "社区回归用图"))).ok === true);
  ok("能建第二张一次性世界", (await putWorld2(mkPayload(2, "排序用图"))).ok === true);

  r = await A.call("POST", "/api/community/publish", { worldId: world.id, title: RUN + " 回归测试图", desc: "由 community.test.mjs 发布", tags: ["测试", "回归"] });
  ok("A 发布成功", r.status === 200 && r.data.pub.title === RUN + " 回归测试图", JSON.stringify(r.data));
  const pubId = r.data.pub?.id;
  ok("发布带出尺寸与字节数", !!r.data.pub.shape && r.data.pub.bytes > 0, JSON.stringify(r.data.pub));

  r = await B.call("PATCH", `/api/community/pubs/${pubId}`, { title: "改别人的标题" });
  ok("非作者改发布被拒 403", r.status === 403, `${r.status} ${JSON.stringify(r.data)}`);
  r = await B.call("DELETE", `/api/community/pubs/${pubId}`);
  ok("非作者下架被拒 403", r.status === 403, r.status);
  r = await A.call("PATCH", `/api/community/pubs/${pubId}`, { desc: "作者可以自己改简介" });
  ok("作者能改简介", r.status === 200 && r.data.pub.desc === "作者可以自己改简介", JSON.stringify(r.data));

  // 快照不可变：发布后再改原世界，社区里读到的必须还是发布那一刻的
  const before = await (await fetch(`${BASE}/api/community/pubs/${pubId}/world`)).json();
  ok("快照能按世界格式读出来", Array.isArray(before.data) && before.data.length === 512, JSON.stringify(before.shape));
  await putWorld(mkPayload(7, "改名后的世界"));   // 原世界被改得面目全非
  const after = await (await fetch(`${BASE}/api/community/pubs/${pubId}/world`)).json();
  ok("改了原世界，发布快照不变", after.meta.name !== "改名后的世界" && after.data.every((v) => v === 1),
    `${after.meta.name} / data[0]=${after.data[0]}`);
  const live = await (await fetch(`${BASE}/api/world/${TW}`)).json();
  ok("原世界确实被改过（对照组）", live.meta.name === "改名后的世界", live.meta.name);

  /* ---------- 7. 广场排序 / 搜索 / 关注流 ---------- */
  // 同一个世界再发一次 = 新版本，不是广场上多出一张重复卡片
  r = await A.call("POST", "/api/community/publish", { worldId: world.id, title: RUN + " 回归测试图", desc: "作者可以自己改简介", note: "加了检查点" });
  ok("同图再发是更新版本，不是多一张卡", r.data.pub.id === pubId && r.data.pub.version === 2, JSON.stringify({ id: r.data.pub && r.data.pub.id, v: r.data.pub && r.data.pub.version }));
  const ver = await A.call("GET", `/api/community/pubs/${pubId}/versions`);
  ok("版本历史留得下来", ver.data.current === 2 && ver.data.rows.length === 1 && ver.data.rows[0].note === "加了检查点", JSON.stringify(ver.data));
  // 另一张世界发出来才是新作品
  r = await A.call("POST", "/api/community/publish", { worldId: TW2, title: RUN + " 第二张图", desc: "排序用" });
  const pub2 = r.data.pub?.id;
  ok("不同世界发布成新作品", !!pub2 && pub2 !== pubId, JSON.stringify({ pub2, pubId }));

  await B.call("POST", `/api/community/pubs/${pub2}/play`);
  await B.call("POST", `/api/community/pubs/${pub2}/play`);
  await B.call("POST", `/api/community/pubs/${pub2}/like`);
  r = await (await fetch(BASE + "/api/community/feed?sort=hot")).json();
  ok("最热排序把有互动的排到前面", runRows(r).includes(pub2) && runRows(r)[0] === pub2, JSON.stringify((r.rows || []).slice(0, 3).map((x) => x.title + ":" + x.plays)));
  r = await (await fetch(BASE + "/api/community/feed?sort=new")).json();
  ok("最新排序把新发布的排到前面", runRows(r)[0] === pub2, JSON.stringify((r.rows || []).slice(0, 2).map((x) => x.title)));
  r = await (await fetch(BASE + "/api/community/feed?q=" + encodeURIComponent(RUN + " 第二张"))).json();
  ok("搜索命中标题", r.total === 1 && r.rows[0].title === RUN + " 第二张图", JSON.stringify(r));
  r = await (await fetch(BASE + "/api/community/feed?limit=1")).json();
  ok("分页 limit 生效", r.rows.length === 1 && r.total >= 2, JSON.stringify(r).slice(0, 120));
  r = await A.call("GET", "/api/community/feed?sort=following");
  const mine = (r.data.rows || []).filter((p) => p.title.startsWith(RUN));
  ok("关注流只看关注的人 + 自己", r.status === 200 && mine.length === 2 && mine.every((p) => p.author.name === nameA), JSON.stringify(r.data).slice(0, 200));
  r = await client().call("GET", "/api/community/feed?sort=following");
  ok("匿名看关注流被拒", r.status === 401, r.status);

  /* ---------- 8. 点赞 / 评论 ---------- */
  r = await B.call("POST", `/api/community/pubs/${pubId}/like`);
  ok("B 点赞 A 的发布", r.status === 200 && r.data.likes >= 1 && r.data.likedByMe === true, JSON.stringify(r.data));
  r = await B.call("POST", `/api/community/pubs/${pubId}/like`);
  ok("再点一次是取消", r.status === 200 && r.data.likedByMe === false, JSON.stringify(r.data));
  await B.call("POST", `/api/community/pubs/${pubId}/like`);

  /* 顶 / 踩：详情页那根好评率条的全部数据来源。 */
  r = await B.call("POST", `/api/community/pubs/${pubId}/vote`, { v: 1 });
  ok("B 顶了这张：up 记上、好评率 100%",
    r.status === 200 && r.data.up === 1 && r.data.down === 0 && r.data.rating === 100 && r.data.votedByMe === 1,
    JSON.stringify(r.data));
  r = await C.call("POST", `/api/community/pubs/${pubId}/vote`, { v: -1 });
  ok("C 踩了这张：好评率掉到 50%，不是仍然 100%",
    r.status === 200 && r.data.up === 1 && r.data.down === 1 && r.data.rating === 50, JSON.stringify(r.data));
  r = await C.call("POST", `/api/community/pubs/${pubId}/vote`, { v: 1 });
  ok("改票是把人从另一栏挪过来，不是两栏各留一份",
    r.status === 200 && r.data.up === 2 && r.data.down === 0 && r.data.votedByMe === 1, JSON.stringify(r.data));
  r = await C.call("POST", `/api/community/pubs/${pubId}/vote`, { v: 0 });
  ok("v=0 是撤票：一个人同时出现在顶和踩里，好评率就成了假的",
    r.status === 200 && r.data.up === 1 && r.data.down === 0 && r.data.votedByMe === 0, JSON.stringify(r.data));
  r = await client().call("GET", `/api/community/pubs/${pubId}`);
  ok("匿名读详情也拿得到票数与好评率（这是公开读数，不是私密统计）",
    r.status === 200 && r.data.pub.up === 1 && r.data.pub.rating === 100 && r.data.pub.votedByMe === 0,
    JSON.stringify({ up: r.data.pub?.up, rating: r.data.pub?.rating, v: r.data.pub?.votedByMe }));
  r = await client().call("POST", `/api/community/pubs/${pubId}/vote`, { v: 1 });
  ok("没登录不能表态", r.status === 401, r.status);

  r = await B.call("POST", `/api/community/pubs/${pubId}/favorite`);
  ok("B 收藏这张", r.status === 200 && r.data.favs === 1 && r.data.favByMe === true, JSON.stringify(r.data));
  /** 收藏要有地方看：本人读得到，别人读不到（"他收藏了什么"能反推兴趣）。 */
  r = await client().call("GET", `/api/community/users/${encodeURIComponent(nameB)}/favorites`);
  ok("匿名读别人的收藏清单被拒（403，不是空列表——空列表会诱导人猜）", r.status === 403, r.status);
  r = await B.call("GET", `/api/community/users/${encodeURIComponent(nameB)}/favorites`);
  ok("本人读自己的收藏，刚收藏那张在里面",
    r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].id === pubId && r.data.rows[0].favByMe === true,
    JSON.stringify(r.data).slice(0, 200));
  /** 用 C 而不是 A：这套里 A 是第一个注册的账号，按"首个注册即管理员"的规则它是管理员，
   *  管理员本来就读得到（和最近游玩同一条规矩）。拿管理员当"路人"会得到一个假失败。 */
  r = await C.call("GET", `/api/community/users/${encodeURIComponent(nameB)}/favorites`);
  ok("普通用户也读不到别人的收藏（只有登录者本人与管理员能读）", r.status === 403, r.status);
  r = await B.call("POST", `/api/community/pubs/${pubId}/favorite`);
  ok("再点一次是取消收藏", r.status === 200 && r.data.favs === 0 && r.data.favByMe === false, JSON.stringify(r.data));
  r = await B.call("GET", `/api/community/users/${encodeURIComponent(nameB)}/favorites`);
  ok("取消之后清单跟着空掉", r.status === 200 && r.data.rows.length === 0, JSON.stringify(r.data).slice(0, 160));
  /** 正在玩读的是实时房间人数。测试里没有真连接，所以判据是"这个字段在、
   *  且是个数"——缺字段会让前端渲染成空白，那和数值是 0 是两回事。 */
  r = await client().call("GET", `/api/community/pubs/${pubId}`);
  ok("详情里带「正在玩」实时读数（没连接时是 0，不是 undefined）",
    r.status === 200 && r.data.pub.playing === 0, JSON.stringify({ playing: r.data.pub?.playing }));
  r = await client().call("GET", "/api/community/feed?sort=foryou");
  ok("推荐流能出票（没登录时退化成热榜，而不是报错）",
    r.status === 200 && Array.isArray(r.data.rows), r.status);

  /* 体型三档：账号皮肤上的 body 必须能存住、能被夹住、能原样读回来——
   *  运行时、主页、皮肤库读的都是这一份记录。 */
  r = await B.call("PATCH", "/api/community/me", { skin: { shirt: "#123456", body: { h: 1.25, w: 0.8, leg: 1.1 } } });
  ok("体型存进账号皮肤（五键照旧，body 一起走）",
    r.status === 200 && r.data.user.skin.body.h === 1.25 && r.data.user.skin.body.w === 0.8
    && r.data.user.skin.shirt === "#123456", JSON.stringify(r.data.user && r.data.user.skin));
  r = await B.call("PATCH", "/api/community/me", { skin: { body: { h: 9, w: -3, leg: "abc" } } });
  ok("越界与垃圾值被夹回量程而不是写进去",
    r.status === 200 && r.data.user.skin.body.h === 1.25 && r.data.user.skin.body.w === 0.8
    && r.data.user.skin.body.leg === 1, JSON.stringify(r.data.user && r.data.user.skin.body));
  r = await client().call("GET", `/api/community/users/${encodeURIComponent(nameB)}`);
  ok("别人看主页也拿得到体型（否则别人看到的你永远是标准身材）",
    r.status === 200 && r.data.user.skin.body && r.data.user.skin.body.h === 1.25,
    JSON.stringify(r.data.user && r.data.user.skin));

  r = await B.call("POST", `/api/community/pubs/${pubId}/comments`, { body: "这张图做得很直" });
  ok("B 能评论", r.status === 200 && r.data.row.body === "这张图做得很直", JSON.stringify(r.data));
  const cmtId = r.data.row?.id;
  r = await client().call("GET", `/api/community/pubs/${pubId}/comments`);
  ok("匿名能读评论", r.status === 200 && r.data.rows.length === 1, JSON.stringify(r.data));
  r = await C.call("DELETE", `/api/community/pubs/${pubId}/comments/${cmtId}`);
  ok("路人删不掉别人的评论 403", r.status === 403, r.status);
  r = await A.call("DELETE", `/api/community/pubs/${pubId}/comments/${cmtId}`);
  ok("地图作者能删任何评论", r.status === 200, r.status);
  r = await B.call("POST", `/api/community/pubs/${pubId}/comments`, { body: "   " });
  ok("空评论被拒", r.status === 400, r.status);
  r = await B.call("POST", `/api/community/pubs/${pubId}/comments`, { body: "长".repeat(501) });
  ok("超长评论被拒", r.status === 400, r.status);
  r = await B.call("POST", `/api/community/pubs/${pubId}/comments`, { body: "作者收到通知了吗" });
  ok("评论会通知作者", r.status === 200, r.status);
  const cmt2 = r.data.row?.id;
  r = await A.call("GET", "/api/community/notifications");
  ok("A 的通知里有来自 B 的评论与点赞", ["comment", "like"].every((k) => r.data.rows.some((n) => n.kind === k && n.actor?.name === nameB)), JSON.stringify(r.data.rows.map((n) => n.kind)));
  // 举报评论的路由一直都在（接口表里也写着），前端却从来没接——评论才是真会长出脏话的地方。
  r = await C.call("POST", `/api/community/comments/${cmt2}/report`, { reason: "人身攻击" });
  ok("路人能举报一条评论", r.status === 200, JSON.stringify(r.data));
  r = await A.call("GET", "/api/community/admin/overview");
  ok("评论举报进的是审核队列，target 是评论而不是地图",
    (r.data.reports || []).some((x) => x.targetType === "comment" && x.target === cmt2), JSON.stringify(r.data.reports).slice(0, 240));
  r = await C.call("POST", "/api/community/comments/000000000000/report", { reason: "x" });
  ok("举报一条不存在的评论报 404", r.status === 404, r.status);
  r = await A.call("POST", "/api/community/notifications");
  r = await A.call("GET", "/api/community/notifications");
  ok("通知能一键标已读", r.status === 200 && r.data.unread === 0, JSON.stringify(r.data).slice(0, 120));

  /* ---------- 9. 越权与注入面 ---------- */
  r = await A.call("POST", "/api/community/publish", { worldId: "../../etc/passwd", title: "穿越" });
  ok("发布不接受路径穿越的 worldId", r.status === 400, r.status);
  r = await A.call("POST", "/api/community/publish", { worldId: "nonexistent-world-id", title: "不存在" });
  ok("发布不存在的世界报 404", r.status === 404, r.status);
  r = await A.call("PATCH", "/api/community/me", { bio: "<img src=x onerror=alert(1)>" });
  ok("简介里的 HTML 标签被服务端直接拒绝", r.status === 400, JSON.stringify(r.data));
  r = await A.call("PATCH", "/api/community/me", { bio: "正常一句话简介" });
  ok("正常简介能存下来", r.status === 200 && r.data.user.bio === "正常一句话简介", JSON.stringify(r.data));
  r = await A.call("POST", `/api/community/pubs/${pubId}/comments`, { body: "加群 123456789 代刷低价" });
  ok("广告内容被拒绝或打标记", r.status === 400 || (r.status === 200 && r.data.row.flagged === true), JSON.stringify(r.data).slice(0, 160));
  r = await A.call("GET", "/api/community/nope");
  ok("未知社区接口 404 而不是 500", r.status === 404, r.status);

  /* ---------- 10. 下架后从广场消失 ---------- */
  r = await A.call("DELETE", `/api/community/pubs/${pub2}`);
  ok("作者能下架", r.status === 200, r.status);
  r = await (await fetch(BASE + "/api/community/feed")).json();
  ok("下架的发布不在广场", !r.rows.some((p) => p.id === pub2), JSON.stringify(r.rows.map((p) => p.id)));
  r = await client().call("GET", `/api/community/pubs/${pub2}`);
  ok("下架后详情 404", r.status === 404, r.status);

  /* ---------- 11. 登出与统计 ---------- */
  r = await B.call("POST", "/api/community/logout");
  ok("登出清掉会话", r.status === 200, r.status);
  r = await B.call("GET", "/api/community/me");
  ok("登出后 /me 不再认人", r.status === 200 && r.data.user === null, JSON.stringify(r.data));
  r = await (await fetch(BASE + "/api/community/stats")).json();
  ok("统计数得出来", r.users >= 3 && r.pubs >= 1 && r.comments >= 1, JSON.stringify(r));

  /* ---------- 12. 发布 v2：图片上传、模型发布、版本回滚 ---------- */
  // 1x1 的合法 PNG：服务端认的是文件魔数，不是扩展名或 Content-Type
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const pngBuf = Buffer.from(PNG, "base64");
  const up = await A.call("POST", "/api/community/upload?kind=cover&pub=" + pubId, undefined);
  ok("没带图片体的上传被拒", up.status === 400, JSON.stringify(up.data));
  const upRes = await uploadFile(A, "/api/community/upload?kind=cover&pub=" + pubId, pngBuf);
  ok("封面图片能上传", upRes.status === 200 && /^\/api\/community\/uploads\/[a-f0-9]+\.png$/.test(upRes.data.url), JSON.stringify(upRes.data));
  const served = await fetch(BASE + upRes.data.url);
  ok("上传的文件能取回且类型正确", served.status === 200 && served.headers.get("content-type") === "image/png", served.headers.get("content-type"));
  const afterCover = await (await fetch(BASE + "/api/community/pubs/" + pubId)).json().catch(() => null);
  ok("上传的封面立刻生效在发布上", afterCover?.pub?.hasCover === true, JSON.stringify(afterCover).slice(0, 200));
  const evil = await uploadFile(A, "/api/community/upload?kind=cover", Buffer.from("<script>alert(1)</script>"));
  ok("非图片内容上传被拒", evil.status === 400, JSON.stringify(evil.data));

  // 没上传封面、也没编辑器截图时，服务端要用这张图自己的体素画一张小地图。
  // 广场里最"AI 做的"就是缺封面的图全退化成同一段渐变——颜色不该由 id 派生。
  const TW3 = "lytest3" + suffix;
  await fetch(`${BASE}/api/world/${TW3}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      formatVersion: 1, shape: [8, 8, 8], dir: [1, 1, 1],
      // 下半截是石头、上半截是木头：封面必须同时画出两种颜色才算读了体素
      indices: Array.from({ length: 512 }, (_, i) => i),
      data: Array.from({ length: 512 }, (_, i) => (Math.floor(i / 64) % 2 ? 129 : 137)),
      rot: new Array(512).fill(0), meta: { name: "封面自绘用图", created: Date.now() },
    }),
  }).then((x) => x.json());
  const noCover = await A.call("POST", "/api/community/publish", { worldId: TW3, title: RUN + " 无封面图", desc: "看服务端会不会自己画" });
  const ncId = noCover.data && noCover.data.pub && noCover.data.pub.id;
  ok("没封面的发布也带上了封面", !!(noCover.data && noCover.data.pub && noCover.data.pub.hasCover), JSON.stringify(noCover.data && noCover.data.pub).slice(0, 160));
  const coverRes = await fetch(BASE + "/api/community/pubs/" + ncId + "/cover");
  const coverBuf = Buffer.from(await coverRes.arrayBuffer());
  ok("自绘封面取得到，是合法 PNG", coverRes.status === 200 && coverRes.headers.get("content-type") === "image/png"
    && coverBuf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), coverRes.status + " " + coverRes.headers.get("content-type"));
  // 纯色说明它只是铺了个底色，根本没读体素
  const { decodePng } = await import("../server/covers.mjs");
  const img = decodePng(coverBuf);
  const seen = new Set();
  for (let i = 0; i < img.px.length; i += 4) {
    if (img.px[i] === 18 && img.px[i + 1] === 18 && img.px[i + 2] === 19) continue;   // 背景
    seen.add(`${img.px[i] >> 4},${img.px[i + 1] >> 4},${img.px[i + 2] >> 4}`);
  }
  ok("封面画的是地图本身（不止一种方块色）", seen.size >= 2, "colors=" + seen.size);

  const model = await A.call("POST", "/api/community/publish", {
    kind: "model", title: RUN + " 测试模型", slug: "test-model", doc: { name: "t", parts: [{ name: "p", size: [2, 2, 2], voxels: [{ x: 0, y: 0, z: 0, c: 1 }] }], colors: ["#ff0000"] },
  });
  ok("模型也能发布", model.status === 200 && model.data.pub.kind === "model", JSON.stringify(model.data).slice(0, 160));
  const modelId = model.data.pub?.id;
  const gotModel = await fetch(BASE + "/api/community/pubs/" + modelId + "/model");
  const jm = await gotModel.json().catch(() => null);
  ok("模型内容能取回", gotModel.status === 200 && jm && jm.parts[0].voxels.length === 1, JSON.stringify(jm).slice(0, 120));
  const feedModel = await (await fetch(BASE + "/api/community/feed?sort=new")).json();
  ok("广场里模型和地图一起出现", feedModel.rows.some((r) => r.kind === "model" && r.id === modelId));
  // 模型也要有预览：官方模型展厅里每张卡都是模型自己的 3D 渲染居中放在黑底上，
  // 没有预览的模型卡在展厅里就只是一个写着文件名的灰框。
  const prev = await fetch(BASE + "/api/community/pubs/" + modelId + "/preview");
  const prevBuf = Buffer.from(await prev.arrayBuffer());
  ok("模型发布会自绘一张预览", prev.status === 200 && prev.headers.get("content-type") === "image/png"
    && prevBuf.subarray(0, 4).toString("hex") === "89504e47", prev.status + " " + prev.headers.get("content-type"));
  // 模型和地图混在一条流里时，模型没有"游玩"这个动作，热度天然低一截，永远沉底。
  // 所以广场要能按类型切；而"模型能不能评论"这件事，用户问过一次，就别再让它只是接口通。
  const onlyModel = await (await fetch(BASE + "/api/community/feed?sort=new&kind=model")).json();
  const onlyMap = await (await fetch(BASE + "/api/community/feed?sort=new&kind=map")).json();
  ok("广场能只看模型", onlyModel.rows.length > 0 && onlyModel.rows.every((r) => r.kind === "model"), JSON.stringify(onlyModel.rows.map((r) => r.kind)));
  ok("广场能只看地图", onlyMap.rows.length > 0 && onlyMap.rows.every((r) => !r.kind || r.kind === "map"), JSON.stringify(onlyMap.rows.map((r) => r.kind)));
  /* ---------- 皮肤社区：发布 / 附件改写 / 分类 / 穿到账号上 ---------- */
  const PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const six = { head: "#112233", body: "#0a0a0a", armL: "#0b0b0b", armR: "#0c0c0c", legL: "#222222", legR: "#333333" };
  const bones18 = { hips: "pelvis", torso: "chest", head: "head",
    leftUpperArm: "upper_arm.L", rightUpperArm: "upper_arm.R", leftLowerArm: "forearm.L", rightLowerArm: "forearm.R",
    leftHand: "hand.L", rightHand: "hand.R", leftUpperLeg: "thigh.L", rightUpperLeg: "thigh.R",
    leftLowerLeg: "shin.L", rightLowerLeg: "shin.R", leftFoot: "foot.L", rightFoot: "foot.R" };
  const skinPub = await A.call("POST", "/api/community/publish", {
    kind: "skin", title: RUN + " 夜行机甲", slug: "night-mecha", desc: "把 CC0 机甲改成夜行色",
    skin: { name: "夜行机甲", kind: "rig", model: "/assets/worlds/some/models/mecha.glb", skin: six, bones: bones18,
      axes: { legL: { ax: "y", sign: -1 } }, scale: 0.8, flip: -1 },
    textureB64: PNG1, modelB64: Buffer.from("glTF-fake-bytes").toString("base64"),
  });
  ok("皮肤能发布（第三类发布，不是把皮肤塞进模型流里）",
    skinPub.status === 200 && skinPub.data.pub.kind === "skin", JSON.stringify(skinPub.data).slice(0, 160));
  const skinId = skinPub.data.pub?.id;
  const rec = await (await fetch(BASE + "/api/community/pubs/" + skinId + "/skin")).json();
  // 附件必须落进这份快照自己的 .assets/，记录里那条路径也得改指回它自己：
  // 不改写的话别人下载到的皮肤指向作者本机的世界目录，作者一删图就 404。
  ok("皮肤记录里的资产路径被改写到自己这份快照上",
    rec.model === `/api/community/pubs/${skinId}/asset?path=model.glb`
    && rec.texture === `/api/community/pubs/${skinId}/asset?path=texture.png`, JSON.stringify(rec).slice(0, 200));
  ok("骨骼皮肤的映射表整套往返：关节映射、摆动轴、缩放、朝向翻转都在",
    rec.kind === "rig" && Object.keys(rec.bones).length === 15 && rec.axes.legL.ax === "y"
    && rec.axes.legL.sign === -1 && rec.scale === 0.8 && rec.flip === -1, JSON.stringify(rec).slice(0, 220));
  const glb = await fetch(BASE + `/api/community/pubs/${skinId}/asset?path=model.glb`);
  ok("附件能取回，glb 的 Content-Type 不是 octet-stream",
    glb.status === 200 && glb.headers.get("content-type") === "model/gltf-binary", glb.status + " " + glb.headers.get("content-type"));
  const onlySkin = await (await fetch(BASE + "/api/community/feed?sort=new&kind=skin")).json();
  ok("广场能只看皮肤", onlySkin.rows.length > 0 && onlySkin.rows.every((r) => r.kind === "skin"), JSON.stringify(onlySkin.rows.map((r) => r.kind)));
  const mapSkin = await fetch(BASE + "/api/community/pubs/" + pubId + "/skin");
  ok("地图发布没有皮肤记录，读它是 404 而不是空对象", mapSkin.status === 404, String(mapSkin.status));
  // 越界与超大一律丢掉，但发布本身不能失败：静默改数据比报错更坏，所以前端会按返回值说
  const bad = await A.call("POST", "/api/community/publish", {
    kind: "skin", title: RUN + " 越界皮肤", slug: "bad-skin",
    skin: { name: "越界", kind: "rig", model: "//evil.example.com/x.glb", skin: { head: "red", body: "#zzz" },
      bones: { hips: "a" }, axes: { legL: { ax: "w", sign: 9 } }, scale: 1e9 },
  });
  const badRec = await (await fetch(BASE + "/api/community/pubs/" + bad.data.pub.id + "/skin")).json();
  ok("外链资产、坏颜色、坏轴向、离谱缩放全被白名单挡掉",
    !badRec.model && !badRec.kind && !badRec.axes && !badRec.scale
    && badRec.skin.head === "#ffd7b0" && badRec.skin.body === "#c9714f", JSON.stringify(badRec).slice(0, 200));
  // 穿到账号上：账号皮肤是"进任何一张图都这一身"，所以映射必须跟着账号走
  const worn = await A.call("PATCH", "/api/community/me", {
    skin: { skin: "#112233", shirt: "#0a0a0a", pants: "#222222", hair: "#6b4630", shoe: "#111111",
      kind: "rig", model: `/api/community/pubs/${skinId}/asset?path=model.glb`, bones: bones18, scale: 0.8 },
  });
  ok("账号能穿骨骼皮肤（kind/model/bones 跟着账号走，联机也透传这一份）",
    worn.data.user.skin.kind === "rig" && worn.data.user.skin.model.includes("model.glb")
    && Object.keys(worn.data.user.skin.bones).length === 15, JSON.stringify(worn.data.user.skin).slice(0, 180));
  const rigNoBones = await A.call("PATCH", "/api/community/me", {
    skin: { kind: "rig", model: `/api/community/pubs/${skinId}/asset?path=model.glb`, bones: { hips: "pelvis" } },
  });
  ok("认不全关节（映射少于 6 根）就不认它是骨骼皮肤：宁可退回纯色，也不要半台机甲",
    !rigNoBones.data.user.skin.kind && !rigNoBones.data.user.skin.bones, JSON.stringify(rigNoBones.data.user.skin).slice(0, 160));
  // 用 C：B 在上面那节刚登出过，到 414 行才重新登录
  const mCmt = await C.call("POST", `/api/community/pubs/${modelId}/comments`, { body: "这个模型的关节做得不错" });
  ok("模型也能被评论", mCmt.status === 200 && mCmt.data.row.body === "这个模型的关节做得不错", JSON.stringify(mCmt.data).slice(0, 140));
  const mFeed = await (await fetch(BASE + "/api/community/feed?sort=new&kind=model")).json();
  ok("模型的评论数上了卡片", (mFeed.rows.find((r) => r.id === modelId) || {}).comments >= 1,
    JSON.stringify(mFeed.rows.find((r) => r.id === modelId)));
  const mNote = await A.call("GET", "/api/community/notifications");
  ok("别人评论我的模型，作者会收到通知", (mNote.data?.rows || []).some((n) => n.kind === "comment" && n.pub && n.pub.id === modelId),
    JSON.stringify((mNote.data?.rows || []).map((n) => n.kind)));
  ok("模型发布没有世界快照可取", (await fetch(BASE + "/api/community/pubs/" + modelId + "/world")).status === 404);

  // 版本回滚：把 v1 换回来，当前版进归档
  const rb = await A.call("POST", `/api/community/pubs/${pubId}/rollback`, { v: 1 });
  ok("作者能回滚到上一版", rb.status === 200 && rb.data.restored === 1 && rb.data.version === 3, JSON.stringify(rb.data));
  const rb2 = await B.call("POST", `/api/community/pubs/${pubId}/rollback`, { v: 1 });
  ok("非作者不能回滚", rb2.status === 403 || rb2.status === 401, rb2.status);

  /* ---------- 13. 最近游玩 ---------- */
  await B.call("POST", "/api/community/login", { name: nameB, password: PW });   // 上面刚登出过
  await B.call("POST", `/api/community/pubs/${pubId}/play`);
  const recent = await B.call("GET", `/api/community/users/${encodeURIComponent(nameB)}/recent`);
  ok("玩过什么会记进最近游玩", recent.status === 200 && recent.data.rows.some((h) => h.pubId === pubId), JSON.stringify(recent.data).slice(0, 160));
  const recentOther = await A.call("GET", `/api/community/users/${encodeURIComponent(nameB)}/recent`);
  ok("别人的最近游玩也能读（只给公开条数）", recentOther.status === 200 && Array.isArray(recentOther.data.rows));

  /* ---------- 14. 举报与管理员 ---------- */
  const rep1 = await B.call("POST", `/api/community/pubs/${pubId}/report`, { reason: "标题党" });
  ok("能举报一张图", rep1.status === 200, JSON.stringify(rep1.data));
  const rep2 = await B.call("POST", `/api/community/pubs/${pubId}/report`, { reason: "再报一次" });
  ok("同一个人重复举报不叠加", rep2.status === 200);
  const notAdmin = await B.call("GET", "/api/community/admin/overview");
  ok("普通用户进不了后台", notAdmin.status === 403, JSON.stringify(notAdmin.data));
  // 本轮第一个注册的 A 就是管理员（服务端把首个账号提为 admin）
  const ov = await A.call("GET", "/api/community/admin/overview");
  ok("首个注册账号是管理员并能读后台总览", ov.status === 200 && ov.data.totals.users >= 3, JSON.stringify(ov.data.totals || ov.data).slice(0, 160));
  ok("举报队列里有刚才那条", ov.data.reports.some((r) => r.target === pubId && r.reason === "标题党"), JSON.stringify(ov.data.reports.map((r) => r.reason)));
  ok("后台能列出用户与其产出", ov.data.users.some((u) => u.name === nameA && u.pubs >= 1));
  const ban = await A.call("POST", "/api/community/admin/ban", { name: nameC, banned: true, reason: "测试封禁" });
  ok("管理员能封号", ban.status === 200 && ban.data.banned === true, JSON.stringify(ban.data));
  // 封号会连带踢掉在线会话，所以这里既可能是 401（会话没了）也可能是 403（明确封禁）；
  // 要断言的是"写不进去"，不是它先撞上哪一道。
  const bannedWrite = await C.call("POST", "/api/community/follow", { name: nameA });
  ok("被封的账号写不了东西", [401, 403].includes(bannedWrite.status), JSON.stringify(bannedWrite.data));
  ok("封号时在线会话被踢掉", !C.jar.get("ly_session") || bannedWrite.status === 401, JSON.stringify(bannedWrite.data));
  const bannedLogin = await client().call("POST", "/api/community/login", { name: nameC, password: PW });
  ok("被封的账号登录被拒并说明原因", bannedLogin.status === 403 && /封禁/.test(bannedLogin.data.error), JSON.stringify(bannedLogin.data));
  await A.call("POST", "/api/community/admin/ban", { name: nameC, banned: false });
  const td = await A.call("POST", "/api/community/admin/takedown", { pubId: modelId });
  ok("管理员能下架任何人的作品", td.status === 200, JSON.stringify(td.data));
  const goneModel = await client().call("GET", "/api/community/pubs/" + modelId);
  ok("下架的模型不在广场了", goneModel.status === 404, goneModel.status);

  /* ---------- 14b. 后台扩到"管理所有用户" ---------- */
  const uAll = await A.call("GET", "/api/community/admin/users");
  ok("后台能列出所有账号，带上会话数、占用与总计作品数",
    uAll.status === 200 && uAll.data.rows.length >= 3
    && uAll.data.rows.every((u) => "sessions" in u && "bytes" in u && "pubsAll" in u && "lastSeen" in u),
    JSON.stringify(uAll.data.rows[0]).slice(0, 220));
  const uQ = await A.call("GET", `/api/community/admin/users?q=${encodeURIComponent(nameB)}`);
  ok("用户能按昵称搜", uQ.status === 200 && uQ.data.rows.length === 1 && uQ.data.rows[0].name === nameB, JSON.stringify(uQ.data.rows.map((u) => u.name)));
  const uNone = await A.call("GET", "/api/community/admin/users?q=" + encodeURIComponent("查无此人" + suffix));
  ok("搜不到给空表而不是报错", uNone.status === 200 && uNone.data.rows.length === 0, JSON.stringify(uNone.data).slice(0, 120));
  const uSort = await A.call("GET", "/api/community/admin/users?sort=pubs&dir=desc");
  const pn = uSort.data.rows.map((u) => u.pubsAll);
  ok("按作品数排序真的是单调的", pn.every((v, i) => !i || pn[i - 1] >= v), JSON.stringify(pn));
  const uRep = await A.call("GET", "/api/community/admin/users?filter=reported");
  ok("能筛出被举报的人", uRep.status === 200 && uRep.data.rows.some((u) => u.name === nameA), JSON.stringify(uRep.data.rows.map((u) => u.name)));

  const banT = await A.call("POST", "/api/community/admin/ban", { name: nameC, banned: true, days: 7, reason: "定时封禁" });
  ok("封禁能带天数并写下到期时间", banT.status === 200 && banT.data.bannedUntil > Date.now() + 6 * 86400000, JSON.stringify(banT.data));
  const uBanned = await A.call("GET", "/api/community/admin/users?filter=banned");
  ok("筛'已封禁'只剩被封的那个", uBanned.data.rows.length === 1 && uBanned.data.rows[0].name === nameC, JSON.stringify(uBanned.data.rows.map((u) => u.name)));
  await A.call("POST", "/api/community/admin/ban", { name: nameC, banned: false });

  const detB = await A.call("GET", `/api/community/admin/user?name=${encodeURIComponent(nameB)}`);
  ok("用户详情把作品/评论/关系/举报/审计一次给齐",
    detB.status === 200 && ["pubs", "comments", "reports", "audit", "history"].every((k) => Array.isArray(detB.data[k]))
    && detB.data.comments.length >= 1 && detB.data.reports.some((x) => x.targetType === "comment"),
    JSON.stringify({ c: detB.data.comments && detB.data.comments.length, r: detB.data.reports && detB.data.reports.map((x) => x.targetType) }).slice(0, 200));
  ok("详情里的评论带着所在作品的标题", detB.status === 200 && !!detB.data.comments[0].pubTitle, JSON.stringify(detB.data.comments && detB.data.comments[0]));
  const det404 = await A.call("GET", "/api/community/admin/user?name=" + encodeURIComponent("没这个人" + suffix));
  ok("查不存在的用户是 404", det404.status === 404, det404.status);

  const exp = await A.call("GET", `/api/community/admin/export?name=${encodeURIComponent(nameB)}`);
  const expRaw = JSON.stringify(exp.data);
  ok("能导出一个人的全部数据", exp.status === 200 && exp.data.user.name === nameB && exp.data.comments.length >= 1, expRaw.slice(0, 160));
  ok("导出里没有口令散列或盐", !/"hash"|"salt"/.test(expRaw), expRaw.slice(0, 200));

  const pubRemoved = await A.call("GET", "/api/community/admin/pubs?state=removed");
  ok("内容审核能单独列出已下架的作品", pubRemoved.status === 200 && pubRemoved.data.rows.some((p) => p.id === modelId && p.authorName === nameA), JSON.stringify(pubRemoved.data.rows.map((p) => p.id)));
  const pubModel = await A.call("GET", "/api/community/admin/pubs?state=all&kind=model");
  ok("按类型筛作品就只剩那个类型", pubModel.data.rows.length >= 1 && pubModel.data.rows.every((p) => p.kind === "model"), JSON.stringify(pubModel.data.rows.map((p) => p.kind)));
  const cmtFind = await A.call("GET", "/api/community/admin/comments?q=" + encodeURIComponent("收到通知"));
  ok("后台能跨作品搜评论", cmtFind.status === 200 && cmtFind.data.rows.some((c) => c.userName === nameB && c.pubId === pubId), JSON.stringify(cmtFind.data.rows.slice(0, 2)).slice(0, 200));
  const repHist = await A.call("GET", "/api/community/admin/reports?state=all");
  ok("举报历史可以连已处理的一起翻", repHist.status === 200 && repHist.data.rows.length >= repHist.data.counts.open && typeof repHist.data.counts.dismissed === "number", JSON.stringify(repHist.data.counts));
  const aud0 = await A.call("GET", "/api/community/admin/audit");
  ok("封号与下架都留了痕，还能查出是谁做的",
    aud0.status === 200 && ["ban", "takedown"].every((a) => aud0.data.rows.some((x) => x.action === a && x.byName === nameA)),
    JSON.stringify(aud0.data.rows.slice(0, 8).map((x) => x.action)));
  const ov2 = await A.call("GET", "/api/community/admin/overview");
  ok("总览带在线数、封禁数与已处理举报数",
    "online" in ov2.data && "banned" in ov2.data && "reportsHandled" in ov2.data && ov2.data.totals.removed >= 1,
    JSON.stringify({ o: ov2.data.online, b: ov2.data.banned, h: ov2.data.reportsHandled, r: ov2.data.totals.removed }));
  ok("总览给一条 14 天的走势，最后一格装得下这轮的注册",
    Array.isArray(ov2.data.series) && ov2.data.series.length === 14 && ov2.data.series[13].users >= 3,
    JSON.stringify(ov2.data.series.slice(-2)));

  const back = await A.call("POST", "/api/community/admin/restore", { pubId: modelId });
  ok("被下架的作品能恢复上架", back.status === 200 && back.data.status === "live", JSON.stringify(back.data));
  ok("恢复之后广场又能读到这个模型", (await client().call("GET", "/api/community/pubs/" + modelId)).status === 200);
  ok("恢复一件不存在的作品是 404", (await A.call("POST", "/api/community/admin/restore", { pubId: "000000000000" })).status === 404);
  const flagP = await A.call("POST", "/api/community/admin/pub", { pubId: modelId, action: "flag", flagged: true });
  ok("能给作品打上审核标记", flagP.status === 200 && flagP.data.flagged === true, JSON.stringify(flagP.data));
  const fl = await A.call("GET", "/api/community/admin/flagged");
  ok("被标记的东西自成一个队列", fl.status === 200 && fl.data.pubs.some((p) => p.id === modelId) && fl.data.total >= 1, JSON.stringify(fl.data).slice(0, 200));
  const cflag = await A.call("POST", "/api/community/admin/comment", { id: cmt2, action: "flag", flagged: true });
  ok("评论也能单独标记", cflag.status === 200 && cflag.data.flagged === true, JSON.stringify(cflag.data));
  ok("删一条不存在的评论是 404", (await A.call("POST", "/api/community/admin/comment", { id: "000000" })).status === 404);
  ok("不认识的管理动作被拒绝", (await A.call("POST", "/api/community/admin/pub", { pubId: modelId, action: "explode" })).status === 400);

  /* 一个专门用来被折腾的账号：动它不会牵连上面任何一条断言。 */
  const D = client();
  const nameD = `牺牲丁${suffix}`;
  const nameD2 = `改过名${suffix}`;
  ok("为后台测试建一个专用账号", (await D.call("POST", "/api/community/register", { name: nameD, password: PW })).status === 200);
  const reC = client();
  ok("解封之后能重新登录", (await reC.call("POST", "/api/community/login", { name: nameC, password: PW })).status === 200);
  const kick = await A.call("POST", "/api/community/admin/sessions", { name: nameC });
  ok("管理员能把人踢下线", kick.status === 200 && kick.data.killed >= 1, JSON.stringify(kick.data));
  ok("被踢掉的会话立刻作废", (await reC.call("POST", "/api/community/follow", { name: nameA })).status === 401, JSON.stringify(reC.data));
  const batch = await A.call("POST", "/api/community/admin/batch", { names: [nameD, nameA], action: "ban", days: 1, reason: "批量测试" });
  ok("批量封禁跳过执行的人自己", batch.status === 200 && batch.data.done === 1 && batch.data.names[0] === nameD, JSON.stringify(batch.data));
  const batchBad = await A.call("POST", "/api/community/admin/batch", { names: [nameD], action: "nuke" });
  ok("不认识的批量动作被拒绝", batchBad.status === 400, JSON.stringify(batchBad.data));
  const unbatch = await A.call("POST", "/api/community/admin/batch", { names: [nameD], action: "unban" });
  ok("批量解封能收回来", unbatch.status === 200 && (await A.call("GET", "/api/community/admin/users?filter=banned")).data.rows.length === 0);
  // 批量封禁顺带踢了会话（这是刻意的），所以要看通知得先让人登回来。
  ok("批量解封后本人能重新登录", (await D.call("POST", "/api/community/login", { name: nameD, password: PW })).status === 200);
  const noteAll = await A.call("POST", "/api/community/admin/note", { all: true, text: "今晚十点例行维护" });
  ok("系统通知能发给全体", noteAll.status === 200 && noteAll.data.sent >= 4, JSON.stringify(noteAll.data));
  const noteD = await D.call("GET", "/api/community/notifications");
  ok("收到通知的人看得到原文", noteD.data.rows.some((n) => n.kind === "admin_note" && n.text === "今晚十点例行维护"), JSON.stringify(noteD.data.rows.slice(0, 3).map((n) => n.kind)));
  ok("空通知被拒绝", (await A.call("POST", "/api/community/admin/note", { all: true, text: "  " })).status === 400);
  const rn = await A.call("POST", "/api/community/admin/user", { name: nameD, action: "rename", name2: nameD2 });
  ok("管理员能给账号改昵称", rn.status === 200 && rn.data.name === nameD2, JSON.stringify(rn.data));
  const rnDup = await A.call("POST", "/api/community/admin/user", { name: nameD2, action: "rename", name2: nameB });
  ok("管理员改名也不能撞车", rnDup.status === 400, JSON.stringify(rnDup.data));
  await D.call("PATCH", "/api/community/me", { bio: "我是签名", region: "广东" });
  const rsBad = await A.call("POST", "/api/community/admin/user", { name: nameD2, action: "reset", fields: ["hash"] });
  ok("资料清理只认列出来的字段，口令这类碰不到", rsBad.status === 400, JSON.stringify(rsBad.data));
  const rs = await A.call("POST", "/api/community/admin/user", { name: nameD2, action: "reset", fields: ["bio", "region"] });
  ok("能点名清空某几项资料", rs.status === 200 && rs.data.cleared.length === 2, JSON.stringify(rs.data));
  const rsCheck = await D.call("GET", "/api/community/me");
  ok("清完真的是空的", rsCheck.status === 200 && !rsCheck.data.user.bio && !rsCheck.data.user.region, JSON.stringify({ b: rsCheck.data.user.bio, r: rsCheck.data.user.region }));
  const aud2 = await A.call("GET", "/api/community/admin/audit?limit=50");
  ok("后台的每一次写都进了审计日志", ["rename", "reset", "batch_ban", "note", "sessions"].every((a) => aud2.data.rows.some((x) => x.action === a)),
    JSON.stringify([...new Set(aud2.data.rows.map((x) => x.action))]));

  /* ---------- 15. 昵称与皮肤 ---------- */
  const rename = await A.call("PATCH", "/api/community/me", { name: "改名后" + suffix });
  ok("昵称可以改", rename.status === 200 && rename.data.user.name === "改名后" + suffix, JSON.stringify(rename.data).slice(0, 160));
  const dup = await B.call("PATCH", "/api/community/me", { name: "改名后" + suffix });
  ok("改名不能撞别人", dup.status === 409, dup.status);
  const skin = await A.call("PATCH", "/api/community/me", { skin: { shirt: "#ff0000", pants: "#00ff00", hair: "#123456", model: "//evil.example/x" } });
  ok("皮肤颜色收下了", skin.status === 200 && skin.data.user.skin.shirt === "#ff0000", JSON.stringify(skin.data.user && skin.data.user.skin));
  ok("皮肤里的外部模型地址被丢掉", skin.data.user.skin.model === undefined, JSON.stringify(skin.data.user.skin));
  const badAvatar = await A.call("PATCH", "/api/community/me", { avatar: "https://evil.example/a.png" });
  ok("头像只认站内上传路径", badAvatar.status === 200 && badAvatar.data.user.avatar === null, JSON.stringify(badAvatar.data.user.avatar));
  // 随包那台 CC0 机甲就在 /skins/ 下：它不是外链。以前白名单只认 img/skins、uploads、
  // pubs、assets/worlds 四种前缀，于是「穿上默认皮肤」写进去的 model 被服务端悄悄丢掉，
  // 用户点完只看到一句"服务端没接受这个模型路径"。
  const bones12 = { hips: "pelvis", torso: "chest", head: "head", leftUpperArm: "upper_armL", rightUpperArm: "upper_armR", leftLowerArm: "forearmL",
    rightLowerArm: "forearmR", leftUpperLeg: "thighL", rightUpperLeg: "thighR", leftLowerLeg: "shinL", rightLowerLeg: "shinR", leftFoot: "footL" };
  const mech = await A.call("PATCH", "/api/community/me", { skin: { kind: "rig", model: "/skins/atlas-09.glb", bones: bones12 } });
  ok("随包的 CC0 机甲能当账号皮肤（/skins/ 属于站内路径）",
    mech.status === 200 && mech.data.user.skin.model === "/skins/atlas-09.glb" && mech.data.user.skin.kind === "rig",
    JSON.stringify(mech.data.user && mech.data.user.skin).slice(0, 160));

  /* ---------- 15b. 资料四件：只认列出来的枚举值 ---------- */
  const prof = await A.call("PATCH", "/api/community/me", {
    region: "广东", gender: "f", looking: "open", persona: ["funny", "craft", "不存在的标签", "funny"],
  });
  ok("地区 / 性别 / 扩列状态 / 性格都收下了",
    prof.data.user.region === "广东" && prof.data.user.gender === "f" && prof.data.user.looking === "open"
    && prof.data.user.persona.join(",") === "funny,craft", JSON.stringify(prof.data.user.persona));
  const junk = await A.call("PATCH", "/api/community/me", { region: "广告推广", gender: "x", looking: "zzz", persona: ["a", "b", "c", "d", "e", "f", "g", "h"] });
  ok("不在枚举里的值一律退回未填，性格标签封顶 6 个",
    junk.data.user.region === "" && junk.data.user.gender === "" && junk.data.user.looking === ""
    && junk.data.user.persona.length === 0, JSON.stringify(junk.data.user).slice(0, 200));
  await A.call("PATCH", "/api/community/me", { region: "广东", looking: "open", persona: ["funny"] });
  const peek = await C.call("GET", "/api/community/users/" + encodeURIComponent("改名后" + suffix));
  ok("别人主页拿得到这四个字段（主页要显示皮肤、地区、性别、性格）",
    peek.data.user.region === "广东" && peek.data.user.looking === "open" && peek.data.user.persona.includes("funny"),
    JSON.stringify(peek.data.user).slice(0, 200));
  const foundMe = await C.call("GET", "/api/community/people?region=广东&tag=funny&sort=active");
  ok("扩列接口能按地区 + 性格搜到人",
    (foundMe.data.rows || []).some((u) => u.name === "改名后" + suffix && u.region === "广东" && u.persona.includes("funny")),
    JSON.stringify((foundMe.data.rows || []).map((u) => u.name)));
  const noSelf = await A.call("GET", "/api/community/people?all=1");
  ok("扩列列表里没有我自己（找人的人不该看到镜子）",
    !(noSelf.data.rows || []).some((u) => u.name === "改名后" + suffix), JSON.stringify((noSelf.data.rows || []).map((u) => u.name)));
  const paged = await A.call("GET", "/api/community/people?all=1&limit=1&offset=0");
  ok("扩列支持分页（limit 生效、more 说真话）",
    paged.data.rows.length === 1 && paged.data.more === true && paged.data.total >= 2,
    JSON.stringify({ n: paged.data.rows.length, more: paged.data.more, total: paged.data.total }));

  /* ---------- 15c. 三种频道：世界 / 地图 / 私聊 ---------- */
  const worldMsg = RUN + " 世界频道一句话";
  const sent = await A.call("POST", "/api/community/chat", { ch: "world", text: worldMsg });
  ok("世界频道发得出去", sent.status === 200 && sent.data.msg.ch === "world", JSON.stringify(sent.data).slice(0, 160));
  const anonRead = await client().call("GET", "/api/community/chat?ch=world");
  ok("世界频道不登录也能读（它是公共频道）",
    anonRead.status === 200 && (anonRead.data.rows || []).some((x) => x.text === worldMsg), JSON.stringify(anonRead.status));
  const fast = await A.call("POST", "/api/community/chat", { ch: "world", text: "紧接着第二句" });
  ok("同一个人两句话之间有冷却", fast.status === 429 || fast.status === 400, JSON.stringify(fast.data));
  const fakeMap = await A.call("POST", "/api/community/chat", { ch: "map:ffffffffffffffff", text: "凭空开的频道" });
  ok("地图频道必须是还在架上的作品", fakeMap.status === 400, JSON.stringify(fakeMap.data));
  const fakeCh = await A.call("POST", "/api/community/chat", { ch: "admin-only", text: "不存在的频道" });
  ok("不认识的频道一律拒绝，不会顺手开一个新的", fakeCh.status === 400, JSON.stringify(fakeCh.data));
  const dmNoFriend = await C.call("POST", "/api/community/chat", { ch: "dm:" + (await A.call("GET", "/api/community/me")).data.user.id, text: "陌生人私聊" });
  ok("非好友发不出私聊（先加好友这条规矩在服务端）",
    dmNoFriend.status === 401 || dmNoFriend.status === 400 || dmNoFriend.status === 403, JSON.stringify(dmNoFriend.data));

  /* ---------- 16. 限流是真的在数次数 ---------- */
  let blocked = 0;
  for (let i = 0; i < RATE_COMMENT + 2; i++) {
    const x = await B.call("POST", `/api/community/pubs/${pubId}/comments`, { body: "刷屏 " + i });
    if (x.status === 429) { blocked = i; break; }
  }
  ok("评论刷屏会被限流", blocked > 0, "连发 " + (RATE_COMMENT + 2) + " 条也没挡下");

  /* ---------- 16b. 举报队列那颗「处理并删内容」得真删得掉东西 ---------- */
  // 放在最后：这张一次性图到这儿已经完成了它的其它使命，下架它不再影响别的断言。
  const repRow = (await A.call("GET", "/api/community/admin/overview")).data.reports.find((x) => x.target === pubId);
  ok("举报队列里找得到这张图的举报", !!repRow, JSON.stringify((await A.call("GET", "/api/community/admin/overview")).data.reports.map((x) => x.target)));
  const resolved = await A.call("POST", `/api/community/admin/report/${repRow?.id}`, { action: "resolve", remove: true });
  ok("举报能标记为已处理", resolved.status === 200 && resolved.data.state === "resolved", JSON.stringify(resolved.data));
  ok("这颗按钮对作品真的会下架，不只是改状态", (await client().call("GET", "/api/community/pubs/" + pubId)).status === 404);
  ok("处理完的举报不再占着待处理队列",
    !(await A.call("GET", "/api/community/admin/overview")).data.reports.some((x) => x.id === repRow?.id));

  /* ---------- 16c. 不可回退的那两颗：硬删作品、注销账号 ---------- */
  const PUBS = path.join(DATA_DIR, "community", "pubs");
  const dDoc = { name: "d", parts: [{ name: "p", size: [2, 2, 2], voxels: [{ x: 0, y: 0, z: 0, c: 1 }] }], colors: ["#00ff00"] };
  const dModel = await D.call("POST", "/api/community/publish", { kind: "model", title: RUN + " 丁的模型", slug: "ding-model", doc: dDoc });
  const dId = dModel.data.pub?.id;
  ok("丁发了一件模型，盘上有它的正文", dModel.status === 200 && fs.existsSync(path.join(PUBS, `${dId}.voxa.json`)), dId);
  const dModel2 = await D.call("POST", "/api/community/publish", { kind: "model", title: RUN + " 丁的第二件", slug: "ding-model2", doc: dDoc });
  const dId2 = dModel2.data.pub?.id;
  ok("丁又发了一件（留给注销那一步）", dModel2.status === 200 && !!dId2, dId2);
  // 评论落在别人还在架的作品上：落在丁自己名下会被"连作品一起删"那条路先带走，
  // 那样就测不到"注销要清掉他写在别人家的评论"这一支。
  const dCmt = await D.call("POST", `/api/community/pubs/${modelId}/comments`, { body: "丁路过留个脚印" });
  ok("丁也留了一条评论", dCmt.status === 200, JSON.stringify(dCmt.data).slice(0, 140));
  await D.call("POST", "/api/community/follow", { name: nameA });
  const purgeBad = await A.call("POST", "/api/community/admin/user", { name: nameD2, action: "delete", confirm: "随便写的确认词" });
  ok("注销要求把对方昵称原样回填", purgeBad.status === 400, JSON.stringify(purgeBad.data));
  const purge = await A.call("POST", "/api/community/admin/pub", { pubId: dId, action: "purge" });
  ok("硬删作品会把正文文件一起从盘上清走", purge.status === 200 && purge.data.files >= 1 && !fs.existsSync(path.join(PUBS, `${dId}.voxa.json`)), JSON.stringify(purge.data));
  ok("删掉的正文文件取不回来了", (await client().call("GET", `/api/community/pubs/${dId}/model`)).status === 404);
  ok("这件作品在后台列表里也消失了", !(await A.call("GET", "/api/community/admin/pubs?state=all")).data.rows.some((p) => p.id === dId));
  const del = await A.call("POST", "/api/community/admin/user", { name: nameD2, action: "delete", confirm: nameD2 });
  ok("注销账号会带走剩下的作品与评论", del.status === 200 && del.data.pubs === 1 && del.data.comments >= 1, JSON.stringify(del.data));
  ok("注销把留下的作品文件也从盘上清走", !fs.existsSync(path.join(PUBS, `${dId2}.voxa.json`)), dId2);
  const usersDoc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "community", "users.json"), "utf8"));
  ok("盘上的用户记录真的没了", !Object.values(usersDoc.byId).some((u) => u.name === nameD2), Object.keys(usersDoc.byId).length);
  ok("注销之后这个账号登不进来", (await client().call("POST", "/api/community/login", { name: nameD2, password: PW })).status !== 200);
  ok("注销从后台的用户列表里也消失了", (await A.call("GET", `/api/community/admin/users?q=${encodeURIComponent(nameD2)}`)).data.rows.length === 0);
  // 第 15 节把 A 改过名，这里要按他现在的昵称查，不然拿到的是 404。
  const curA = (await A.call("GET", "/api/community/me")).data.user.name;
  const detA = await A.call("GET", `/api/community/admin/user?name=${encodeURIComponent(curA)}`);
  ok("注销带走他发出的关注关系", detA.status === 200 && !detA.data.graph.followers.includes(nameD2), JSON.stringify(detA.data.graph && detA.data.graph.followers));
  const cmtAfter = await A.call("GET", "/api/community/admin/comments?q=" + encodeURIComponent("丁路过留个脚印"));
  ok("注销带走他写过的评论", cmtAfter.data.rows.length === 0, JSON.stringify(cmtAfter.data.rows.slice(0, 2)));
  ok("注销自己记进审计日志", (await A.call("GET", "/api/community/admin/audit?action=delete_user")).data.rows.some((x) => x.target === nameD2));
  ok("唯一的管理员不能被注销", (await A.call("POST", "/api/community/admin/user", { name: curA, action: "delete", confirm: curA })).status === 400);

  /* ---------- 收尾：把测试造的一次性世界删掉，测试发布下架 ---------- */
  await A.call("DELETE", `/api/community/pubs/${pubId}`);
  for (const id of [skinId, bad.data.pub.id]) await A.call("DELETE", `/api/community/pubs/${id}`);
  for (const id of [TW, TW2, TW3]) await fetch(`${BASE}/api/world/${id}`, { method: "DELETE" });
  const gone = await (await fetch(BASE + "/api/worlds")).json();
  ok("一次性世界已清理", ![TW, TW2].some((id) => gone.worlds.some((w) => w.id === id)), TW);
} catch (e) {
  fail++;
  console.log("FAIL  跑挂了：" + ((e && e.stack) || e));
}

console.log(`\ncommunity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
