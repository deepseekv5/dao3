// social.js — 好友 / 扩列 / 聊天：一个从右侧滑出来的抽屉，社区页与游戏内都能开。
//
// 为什么不是一个独立页面：加好友、看谁在线、回一句私聊，都是"正在做别的事"时
// 顺手要做的动作。跳页会打断当前视图（游戏里跳走等于把这局丢了），
// 所以它必须浮在任何页面上面。
//
// 三条不能省：
//   1. 所有文本走 esc()：昵称、备注、聊天内容都是用户输入。
//   2. 推送 + 轮询双轨：/ws/social 掉线时消息不能就此看不见，抽屉开着时每 5 秒
//      按 after 游标补一次增量。
//   3. 消息按 id 去重：游戏里同时有房间 socket 与社交 socket，同一条会来两次。
import { me, api, openAuth, esc, onLogin, avatarBg } from "./auth.js";
import { REGIONS, GENDERS, PERSONA, genderLabel, personaLabel, lookingLabel } from "./profile-fields.js";

/** 抽屉里读数据的骨架：和好友行同形（圆头像 + 两行字）。 */
const SK = `<div class="sk-list">${Array.from({ length: 5 }, () => `<div class="sk-row"><span class="sk-img round"></span><span class="sk-lines"><span class="sk-line"></span><span class="sk-line sm"></span></span></div>`).join("")}</div>`;
const TABS = [["friends", "好友"], ["expand", "扩列"], ["messages", "消息"]];
const PAGE = 20;

let tab = "friends";
let thread = null;                 // {ch, title, peer}
const seen = new Set();            // 已渲染过的消息 id（去重）
let lastWorld = 0;                 // 世界频道本地"看到哪儿了"，公共频道不占服务端未读
let worldBadge = 0;
let drawer = null, body = null;
let lastFocus = null;              // 打开抽屉前焦点在哪，关掉之后要还回去
let sock = null, sockRetry = 0;
let pollTimer = null;
let counts = { friends: 0, unread: 0 };

/* ---------------- 小工具 ---------------- */
const $ = (id) => document.getElementById(id);
const timeAgo = (ts) => {
  const s = Math.max(0, (Date.now() - Number(ts || 0)) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
  return new Date(Number(ts)).toLocaleDateString("zh-CN");
};
const face = (u) => {
  const src = typeof u.avatar === "string" && u.avatar.startsWith("/") && !u.avatar.startsWith("//") ? u.avatar : null;
  return src ? `<img class="so-face" src="${esc(src)}" alt=""/>`
    : `<span class="so-face so-init" style="background:${avatarBg()}">${esc(u.name ? [...u.name][0] : "?")}</span>`;
};
const dot = (u) => `<i class="so-dot ${u.online ? "on" : ""}" title="${u.online ? "在线" : "离线"}"></i>`;
/** 资料小标签：地区 / 性别 / 性格。空值不显示，主页与列表用同一套，别两处各写一遍。 */
const chips = (u) => {
  const out = [];
  if (u.region) out.push(u.region);
  if (u.gender) out.push(genderLabel(u.gender));
  for (const t of (u.persona || []).slice(0, 3)) out.push(personaLabel(t));
  if (u.looking && u.looking !== "none") out.push(lookingLabel(u.looking));
  return out.length ? `<div class="so-chips">${out.map((c) => `<span>${esc(c)}</span>`).join("")}</div>` : "";
};
function toast(msg, bad) {
  const el = $("cmToast") || $("toast");
  if (el) {
    el.hidden = false; el.textContent = msg; el.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.classList.remove("show"); el.hidden = true; }, 2600);
    return;
  }
  const t = document.createElement("div");
  t.className = "so-toast" + (bad ? " bad" : ""); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------------- 入口与角标 ---------------- */
/** 顶栏那颗"消息"按钮：auth.js 画完身份区之后调进来。 */
export function paintEntry(host) {
  if (!host) return;
  if (!me) return;
  // 幂等：auth.js 每次重画身份区都会再调一次，不去重就会攒出好几个入口，
  // 而且它们是同一个 id—— getElementById 只会点着第一个。
  host.querySelectorAll(".so-entry").forEach((n) => n.remove());
  host.insertAdjacentHTML("afterbegin",
    `<button class="so-entry" id="soEntry" title="好友、扩列与聊天">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 6.5h16v9.5H9l-4 3.2z"/></svg><em id="soBadge" hidden>0</em></button>`);
  const b = $("soEntry");
  if (b) b.onclick = () => openSocial("messages");
  paintBadge();
}
function paintBadge() {
  const el = $("soBadge");
  if (!el) return;
  const n = counts.unread + worldBadge;
  el.hidden = !n;
  el.textContent = n > 99 ? "99+" : String(n);
}

/* ---------------- 抽屉骨架 ---------------- */
export function openSocial(which = "friends") {
  tab = which;
  if (!me) { openAuth("login"); return; }
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.id = "soDrawer"; drawer.className = "so-drawer";
    // 抽屉是盖在页面上的模态层：没有这三样，读屏软件会照本宣科地念整个背景页面，
    // 而 Tab 会从"关闭"一路走到被遮住的世界列表上去。
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "好友、扩列与聊天");
    drawer.innerHTML = `<header class="so-head">
        <div class="so-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("")}</div>
        <button class="so-x" id="soClose" aria-label="关闭">✕</button>
      </header><div class="so-body" id="soBody"></div>`;
    document.body.appendChild(drawer);
    const scrim = document.createElement("div");
    scrim.id = "soScrim"; scrim.className = "so-scrim";
    scrim.onclick = closeSocial;
    document.body.appendChild(scrim);
    drawer.__scrim = scrim;
    drawer.inert = true;   // 收起时整块从Tab顺序和点击里消失，只靠 translateX(102%) 移出去挡不住键盘
    for (const b of drawer.querySelectorAll("[data-tab]")) b.onclick = () => { tab = b.dataset.tab; thread = null; draw(); };
    $("soClose").onclick = closeSocial;
    document.addEventListener("keydown", (e) => {
      if (!drawer.classList.contains("on")) return;
      if (e.key === "Escape") { closeSocial(); return; }
      if (e.key === "Tab") trapFocus(e, drawer);
    });
  }
  // 已经在抽屉里换格子（或从主页点开私聊）时不能重记：那会把"回去的位置"
  // 记成抽屉里的某个按钮，关掉之后焦点落在一个刚消失的东西上。
  if (!drawer.classList.contains("on")) lastFocus = document.activeElement;
  drawer.classList.add("on");
  drawer.inert = false;
  drawer.__scrim.classList.add("on");
  const first = drawer.querySelector('.so-tabs [data-tab="' + tab + '"]') || $("soClose");
  if (first && !drawer.contains(document.activeElement)) first.focus();
  connectSocial();
  draw();
}

/** Tab 关在抽屉里：模态层最烦人的不是"要按很多次才走到关闭"，
 *  而是按着按着焦点跑到被遮住的页面上，此时回车会点到一个看不见的按钮。 */
function trapFocus(e, root) {
  const items = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
export function closeSocial() {
  if (!drawer) return;
  drawer.classList.remove("on");
  drawer.__scrim.classList.remove("on");
  stopPoll();
  // 焦点不能留在一个已经看不见的按钮上：那样下一次 Tab 是从抽屉里继续走的，
  // 而不是从"我刚才点的那个入口"接着往下。
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}
export const socialIsOpen = () => !!(drawer && drawer.classList.contains("on"));

/** 从任何地方跳到"和某人私聊"：主页、好友列表、聊天里的头像都用它。 */
export function openDm(user) {
  if (!user || !user.id) return;
  thread = { ch: "dm:" + user.id, title: user.note || user.name, peer: user };
  tab = "messages";
  openSocial("messages");
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function startPoll(fn, ms) { stopPoll(); pollTimer = setInterval(fn, ms); }

async function draw() {
  for (const b of drawer.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === tab);
  body = $("soBody");
  body.innerHTML = SK;
  if (tab === "friends") return friendsPane();
  if (tab === "expand") return expandPane();
  return thread ? conversationPane() : messagesPane();
}

/* ---------------- 好友 ---------------- */
async function friendsPane() {
  let fr, blocks = [];
  try {
    const [a, b] = await Promise.all([
      api("GET", "/api/community/friends"),
      api("GET", "/api/community/blocks").catch(() => ({ rows: [] })),
    ]);
    fr = a; blocks = b.rows || [];
  } catch (e) { body.innerHTML = `<div class="so-empty">${esc(e.message)}</div>`; return; }
  counts.friends = fr.friends.length;
  const reqs = fr.incoming || [];
  const row = (u, ops) => `<div class="so-row" data-u="${esc(u.id)}">
      ${dot(u)}${face(u)}
      <div class="so-main"><b>${esc(u.note || u.name)}${u.note ? `<i>${esc(u.name)}</i>` : ""}</b>${chips(u)}</div>
      <div class="so-ops">${ops}</div></div>`;
  const ops = (u) => `<button class="so-ib" data-dm="${esc(u.id)}" data-n="${esc(u.note || u.name)}" title="私聊">聊</button>
    <a class="so-ib" href="/u/${encodeURIComponent(u.name)}" title="看主页">页</a>
    <button class="so-ib" data-note="${esc(u.name)}" title="改备注">注</button>
    <button class="so-ib warn" data-rm="${esc(u.name)}" title="解除好友">除</button>`;
  body.innerHTML = `
    ${reqs.length ? `<div class="so-sec"><b>好友请求 ${reqs.length}</b>${reqs.map(({ user }) =>
      `<div class="so-row">${face(user)}<div class="so-main"><b>${esc(user.name)}</b><div class="so-chips"><span>${timeAgo(user.ts)}</span></div></div>
        <div class="so-ops"><button class="so-ib ok" data-acc="${esc(user.name)}">接受</button><button class="so-ib" data-dec="${esc(user.name)}">拒绝</button></div></div>`).join("")}</div>` : ""}
    <div class="so-sec"><b>好友 ${fr.friends.length}<i>在线 ${fr.friends.filter((u) => u.online).length}</i></b>
      ${fr.friends.length ? fr.friends.map((u) => row(u, ops(u))).join("") : `<div class="so-empty">还没有好友。到「扩列」那一页按地区或性格找人。</div>`}</div>
    ${fr.outgoing && fr.outgoing.length ? `<div class="so-sec"><b>等对方回应 ${fr.outgoing.length}</b>${fr.outgoing.map(({ user }) =>
      `<div class="so-row">${face(user)}<div class="so-main"><b>${esc(user.name)}</b>${chips(user)}</div>
        <div class="so-ops"><button class="so-ib warn" data-rm="${esc(user.name)}">撤回</button></div></div>`).join("")}</div>` : ""}
    ${blocks.length ? `<div class="so-sec"><b>黑名单 ${blocks.length}<i>互相看不到</i></b>${blocks.map((u) => `<div class="so-row">
      ${face(u)}<div class="so-main"><b>${esc(u.name)}</b><div class="so-chips"><span>${esc(timeAgo(u.ts))}拉黑</span></div></div>
      <div class="so-ops"><button class="so-ib ok" data-unblk="${esc(u.name)}">解除</button></div></div>`).join("")}</div>` : ""}`;

  bind(body, "[data-dm]", (el) => openDm({ id: el.dataset.dm, name: el.dataset.n }));
  bind(body, "[data-note]", async (el) => {
    const v = window.prompt("给这个好友起的备注（留空清除）", el.closest(".so-row").querySelector("b").textContent);
    if (v == null) return;
    try { await api("POST", "/api/community/friend/note", { name: el.dataset.note, note: v.slice(0, 20) }); friendsPane(); } catch (e) { toast(e.message, true); }
  });
  bind(body, "[data-rm]", async (el) => {
    if (!window.confirm("解除好友关系？私聊记录还会留着。")) return;
    try { await api("POST", "/api/community/friend/remove", { name: el.dataset.rm }); toast("已解除"); friendsPane(); } catch (e) { toast(e.message, true); }
  });
  bind(body, "[data-acc]", async (el) => { await act("/api/community/friend/accept", el.dataset.acc); });
  bind(body, "[data-dec]", async (el) => { await act("/api/community/friend/decline", el.dataset.dec); });
  bind(body, "[data-unblk]", async (el) => {
    try { await api("POST", "/api/community/block", { name: el.dataset.unblk, blocked: false }); toast("已解除拉黑"); friendsPane(); }
    catch (e) { toast(e.message, true); }
  });
}
async function act(path, name) {
  try { await api("POST", path, { name }); friendsPane(); } catch (e) { toast(e.message, true); }
}

/* ---------------- 扩列 ---------------- */
/** 把"找人 + 加好友"这一整块渲染进任意容器：抽屉里那一页与 /friends 的
 *  「扩列」页签共用同一份实现，状态挂在容器自己身上，两处不会各写一套筛选。 */
export async function renderPeopleGrid(el) {
  const st = el.__st || (el.__st = { q: "", region: "", gender: "", tag: "", sort: "active", offset: 0, rows: [] });
  const sel = (key, label, list) => `<select data-f="${key}" class="so-sel">
    <option value="">${label}</option>${list.map(([v, t]) => `<option value="${esc(v)}" ${st[key] === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  el.innerHTML = `<div class="so-filters">
      <input class="so-q" type="search" placeholder="搜昵称或简介" value="${esc(st.q)}"/>
      ${sel("region", "全部地区", REGIONS.map((r) => [r, r]))}
      ${sel("gender", "不限性别", GENDERS.filter((g) => g.id).map((g) => [g.id, g.label]))}
      ${sel("tag", "不限性格", PERSONA.map((p) => [p.id, p.label]))}
      ${sel("sort", "最近活跃", [["active", "最近活跃"], ["new", "最新注册"], ["name", "按名字"]])}
    </div><div class="so-people"></div>`;
  for (const s of el.querySelectorAll("[data-f]")) s.onchange = () => { st[s.dataset.f] = s.value; st.offset = 0; load(); };
  const q = el.querySelector(".so-q");
  q.oninput = () => { st.q = q.value.trim(); st.offset = 0; clearTimeout(q._t); q._t = setTimeout(load, 260); };
  await load();

  async function load() {
    const host = el.querySelector(".so-people");
    host.innerHTML = `<div class="so-empty">找人中…</div>`;
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(st.offset), sort: st.sort });
    for (const k of ["q", "region", "gender", "tag"]) if (st[k]) p.set(k, st[k]);
    let r;
    try { r = await api("GET", "/api/community/people?" + p); } catch (e) { host.innerHTML = `<div class="so-empty">${esc(e.message)}</div>`; return; }
    st.rows = st.offset ? st.rows.concat(r.rows) : r.rows;
    const btn = (u) => {
      const rel = u.relation || {};
      if (rel.friend) return `<button class="so-ib ok" data-dm="${esc(u.id)}" data-n="${esc(u.note || u.name)}">私聊</button>`;
      if (rel.pendingOut) return `<span class="so-hint">等待回应</span>`;
      if (rel.pendingIn) return `<button class="so-ib ok" data-acc="${esc(u.name)}">接受添加</button>`;
      return `<button class="so-ib ok" data-add="${esc(u.name)}">加好友</button>`;
    };
    host.innerHTML = (st.rows.length ? st.rows.map((u) => `<div class="so-row">
        ${dot(u)}${face(u)}
        <div class="so-main"><b>${esc(u.name)}</b>
          <div class="so-bio">${esc(u.bio || (u.counts ? u.counts.pubs + " 张发布" : "还没写过简介"))}</div>${chips(u)}</div>
        <div class="so-ops">${btn(u)}<a class="so-ib" href="/u/${encodeURIComponent(u.name)}" title="看主页">页</a></div>
      </div>`).join("") : `<div class="so-empty">没有符合条件的人。换个地区或性格试试。<br/>想让别人搜到你，到「编辑资料」里把扩列状态改成「欢迎扩列」。</div>`)
      + (r.more ? `<button class="so-more" data-more>再看 ${PAGE} 个（共 ${r.total}）</button>`
        : st.rows.length ? `<div class="so-hint2">一共 ${r.total} 个人</div>` : "");
    bind(host, "[data-add]", async (b) => {
      try { await api("POST", "/api/community/friend/request", { name: b.dataset.add }); toast("好友请求已发出，等对方回应"); load(); } catch (e) { toast(e.message, true); }
    });
    bind(host, "[data-acc]", async (b) => { await act("/api/community/friend/accept", b.dataset.acc); load(); });
    bind(host, "[data-dm]", (b) => openDm({ id: b.dataset.dm, name: b.dataset.n }));
    bind(host, "[data-more]", () => { st.offset += PAGE; load(); });
  }
}
function expandPane() { body.innerHTML = ""; renderPeopleGrid(body); }

/* ---------------- 消息：会话列表 + 单个会话 ---------------- */
async function messagesPane() {
  let box;
  try { box = await api("GET", "/api/community/channels"); } catch (e) { body.innerHTML = `<div class="so-empty">${esc(e.message)}</div>`; return; }
  counts.unread = box.total || 0;
  paintBadge();
  const mapCh = window.__playMeta && window.__playMeta.pubId ? { ch: "map:" + window.__playMeta.pubId, title: "这张图", last: null } : null;
  const line = (ch, title, last, badge, sub) => `<button class="so-row so-thread" data-ch="${esc(ch)}" data-t="${esc(title)}">
      <span class="so-thumb">${esc(title.slice(0, 1))}</span>
      <div class="so-main"><b>${esc(title)}</b><div class="so-last">${esc(last ? (last.name + "：" + last.text) : (sub || "还没有人说话"))}</div></div>
      ${badge ? `<em class="so-unread">${badge > 99 ? "99+" : badge}</em>` : ""}</button>`;
  body.innerHTML = `<div class="so-sec"><b>频道</b>
      ${line("world", "世界频道", box.world && box.world.last, worldBadge, "所有在线的人")}
      ${mapCh ? line(mapCh.ch, "地图频道", mapCh.last, 0, "同在这张图的人") : ""}
    </div>
    <div class="so-sec"><b>私聊<i>在线 ${box.online || 0} 人 · 好友 ${counts.friends} · 好友在线 ${box.friendsOnline || 0}</i></b>
      ${box.threads.length ? box.threads.map((t) => line(t.ch, t.peer.note || t.peer.name, t.last, t.unread)).join("")
        : `<div class="so-empty">还没有私聊。只能和好友私聊——到「好友」或「扩列」里找个人说第一句。</div>`}</div>`;
  bind(body, "[data-ch]", (el) => {
    const ch = el.dataset.ch;
    if (ch === "world") worldBadge = 0;
    thread = { ch, title: el.dataset.t };
    paintBadge();
    conversationPane();
  });
  startPoll(refreshCounts, 8000);
}
async function refreshCounts() {
  if (thread) return;
  try {
    const box = await api("GET", "/api/community/channels");
    counts.unread = box.total || 0;
    paintBadge();
    if (socialIsOpen() && tab === "messages" && !thread) messagesPane();
  } catch { /* 网断了就保留上一次画面 */ }
}

async function conversationPane() {
  stopPoll();
  const ch = thread.ch;
  body.innerHTML = `<div class="so-conv">
      <header class="so-convhead"><button class="so-back" id="soBack">‹ 返回</button><b>${esc(thread.title)}</b><i id="soWho"></i></header>
      <div class="so-log" id="soLog" role="log" aria-live="polite"></div>
      <div class="so-send"><input id="soBox" maxlength="200" placeholder="说点什么…" spellcheck="false"/><button class="so-go" id="soGo">发送</button></div>
    </div>`;
  $("soBack").onclick = () => { thread = null; messagesPane(); };
  const box = $("soBox");
  $("soGo").onclick = () => send(box);
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(box); } });
  box.focus();
  await pull(ch, true);
  startPoll(() => pull(ch, false), 5000);
}
async function send(input) {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    const r = await api("POST", "/api/community/chat", { ch: thread.ch, text });
    renderMsg(r.msg, true);
    pull(thread.ch, false);
  } catch (e) { toast(e.message, true); input.value = text; }
}
/** after 游标拉增量；reset 为真时是打开会话，整段重画。 */
let cursor = 0;
async function pull(ch, reset) {
  if (reset) { cursor = 0; seen.clear(); }
  let r;
  try { r = await api("GET", `/api/community/chat?ch=${encodeURIComponent(ch)}&after=${cursor}&limit=${reset ? 60 : 100}`); } catch (e) {
    if (reset) { const log = $("soLog"); if (log) log.innerHTML = `<div class="so-empty">${esc(e.message)}</div>`; }
    return;
  }
  if (!r.rows.length) return;
  for (const m of r.rows) { cursor = Math.max(cursor, m.ts); renderMsg(m, false); }
  if (ch.startsWith("dm:")) { api("POST", "/api/community/chat/read", { ch }).then(() => { counts.unread = 0; paintBadge(); }).catch(() => {}); }
}
function renderMsg(m, mine) {
  if (!m || seen.has(m.id)) return;
  seen.add(m.id);
  const log = $("soLog");
  if (!log) return;
  const own = me && m.from === me.id;
  const el = document.createElement("div");
  el.className = "so-msg" + (own ? " mine" : "");
  el.innerHTML = `${face({ name: m.name, avatar: m.avatar })}
    <div class="so-bubble"><b>${esc(own ? "我" : m.name)}</b><span>${esc(m.text)}</span><i>${timeAgo(m.ts)}</i></div>`;
  if (!own && thread && thread.ch.startsWith("dm:")) el.classList.add("dm");
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

/* ---------------- 推送 ---------------- */
const chatHooks = new Set();
/** 给游戏内那套 HUD 用的出口：发一条、拉增量、订阅推送。
 *  让游戏自己再实现一遍 HTTP + socket，两处规则一定会飘（限流、审查、游标）。 */
export const chatSend = (ch, text) => api("POST", "/api/community/chat", { ch, text });
export async function chatPull(ch, after = 0, limit = 60) {
  return (await api("GET", `/api/community/chat?ch=${encodeURIComponent(ch)}&after=${after}&limit=${limit}`)).rows;
}
export function onChat(fn) { chatHooks.add(fn); connectSocial(); return () => chatHooks.delete(fn); }

function connectSocial() {
  if (!me || sock) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  try { sock = new WebSocket(`${proto}://${location.host}/ws/social`); } catch { return; }
  sock.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t !== "chat") return;
    for (const fn of chatHooks) { try { fn(m); } catch { /* 一个订阅者出错不该断掉别人的消息 */ } }
    if (thread && m.ch === thread.ch) { cursor = Math.max(cursor, m.ts); renderMsg(m, false); return; }
    if (m.ch === "world") { worldBadge++; paintBadge(); return; }
    // 别的会话来话：只有停在列表页时才重画。正开着某个会话还把它顶掉，
    // 表现就是"话说一半窗口跳走了"——这条规则比"及时刷新"重要。
    if (socialIsOpen() && tab === "messages" && !thread) messagesPane(); else refreshCounts();
  };
  sock.onclose = () => {
    sock = null;
    setTimeout(connectSocial, Math.min(20000, 1200 * (2 ** sockRetry++)));
  };
  sock.onerror = () => { try { sock && sock.close(); } catch {} };
}

/* ---------------- 绑定 ---------------- */
function bind(rootEl, sel, fn) {
  for (const el of rootEl.querySelectorAll(sel)) el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(el, e); };
}

/** 页面加载后挂到顶栏；登录成功也要重挂一次（未登录时没有那颗按钮）。 */
export function initSocial() {
  onLogin(() => { const host = $("wbAuth"); if (host) paintEntry(host); worldBadge = 0; });
}
