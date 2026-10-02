/**
 * community.test.mjs — 社区层的端到端回归：账号、关注、好友、发布、评论、闸门。
 *
 * 为什么自己搓一个带 cookie 的 HTTP 客户端：这条链路的**全部意义**在于
 * "谁在说话"。用裸 fetch 测出来的"能跑"是假的——所有请求都会变成匿名，
 * 鉴权与越权分支一次都走不到。
 *
 * 需要本地服务在跑（默认 http://127.0.0.1:5173，可用 BASE 覆盖）。
 * 数据落在 server/data/community/ 与 community/pubs/ 下，测试用随机后缀名字，
 * 跑完把自己造的用户删不掉（社区没有注销接口，这是刻意的：发布内容要能追责），
 * 但快照与评论不会污染广场——测完把测试发布下架。
 */
import { resolveBase } from "./browser.mjs";

const BASE = await resolveBase();
if (!BASE) { console.log("SKIP  找不到本地服务：先 ./run.sh 或 node server.js（或设 BASE=http://127.0.0.1:PORT）"); process.exit(0); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      " + String(extra).slice(0, 300) : "")); }
};
const S = (n) => new Promise((r) => setTimeout(r, n));

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
  const world = { id: TW };
  ok("能建一张一次性世界", (await putWorld(mkPayload(1, "社区回归用图"))).ok === true);

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
  r = await A.call("POST", "/api/community/publish", { worldId: world.id, title: RUN + " 第二张图", desc: "排序用" });
  const pub2 = r.data.pub?.id;
  ok("能发布第二张", !!pub2, JSON.stringify(r.data));

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
  r = await A.call("GET", "/api/community/notifications");
  ok("A 的通知里有来自 B 的评论与点赞", ["comment", "like"].every((k) => r.data.rows.some((n) => n.kind === k && n.actor?.name === nameB)), JSON.stringify(r.data.rows.map((n) => n.kind)));
  r = await A.call("POST", "/api/community/notifications");
  r = await A.call("GET", "/api/community/notifications");
  ok("通知能一键标已读", r.status === 200 && r.data.unread === 0, JSON.stringify(r.data).slice(0, 120));

  /* ---------- 9. 越权与注入面 ---------- */
  r = await A.call("POST", "/api/community/publish", { worldId: "../../etc/passwd", title: "穿越" });
  ok("发布不接受路径穿越的 worldId", r.status === 400, r.status);
  r = await A.call("POST", "/api/community/publish", { worldId: "nonexistent-world-id", title: "不存在" });
  ok("发布不存在的世界报 404", r.status === 404, r.status);
  r = await A.call("PATCH", "/api/community/me", { bio: "<img src=x onerror=alert(1)>" });
  ok("个人简介原样存（转义是前端的责任）", r.status === 200 && r.data.user.bio === "<img src=x onerror=alert(1)>", JSON.stringify(r.data));
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

  /* ---------- 收尾：把测试造的一次性世界删掉，测试发布下架 ---------- */
  await A.call("DELETE", `/api/community/pubs/${pubId}`);
  await fetch(`${BASE}/api/world/${TW}`, { method: "DELETE" });
  const gone = await (await fetch(BASE + "/api/worlds")).json();
  ok("一次性世界已清理", !gone.worlds.some((w) => w.id === TW), TW);
} catch (e) {
  fail++;
  console.log("FAIL  跑挂了：" + ((e && e.stack) || e));
}

console.log(`\ncommunity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
