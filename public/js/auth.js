// auth.js — 身份层：登录/注册、头像菜单、通知角标。工作台和社区页共用。
//
// 为什么单独一个文件：身份是跨页的。工作台要能发布、社区页要能评论，
// 两边都得知道"现在是谁"。复制两份必然出现一处改了另一处忘改。
//
// 所有文本都走 textContent 或 esc()：用户名和评论都是用户输入，
// 直接拼进 innerHTML 等于把 XSS 送进同源会话里。

export const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);

export let me = null;          // 当前登录用户，未登录为 null
let csrf = "";

export async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { status: res.status });
  return data;
}

export async function refreshMe() {
  const r = await api("GET", "/api/community/me");
  me = r.user;
  csrf = r.csrf || "";
  paint();
  return me;
}
export const isMe = () => me;
/** 改完资料后把新身份写回模块状态，顶栏与所有页面立刻跟着变，不用刷新。 */
export function setMe(u) { me = u || null; paint(); }

/* ---------------- 弹层：登录 / 注册 ---------------- */
export function openAuth(tab = "login") {
  let el = $("authModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "authModal";
    el.className = "cm-modal";
    document.body.appendChild(el);
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
  }
  const draw = (which, err) => {
    const reg = which === "register";
    el.innerHTML = `<div class="cm-mbox au-box">
      <div class="au-tabs">
        <button data-t="login" class="${reg ? "" : "on"}">登录</button>
        <button data-t="register" class="${reg ? "on" : ""}">注册</button>
      </div>
      <h3>${reg ? "注册一个老攸元宇宙账号" : "登录"}</h3>
      <p class="cm-hint">账号只存在你这台机器的 <code>server/data/community/</code> 里，不发往任何远端。</p>
      <label>名字<input id="auName" maxlength="20" autocomplete="username" placeholder="2–20 个字符，中英文都行"/></label>
      <label>口令<input id="auPw" type="password" maxlength="128" autocomplete="${reg ? "new-password" : "current-password"}" placeholder="至少 8 位"/></label>
      ${reg ? `<label class="au-pw2">确认口令<input id="auPw2" type="password" maxlength="128" autocomplete="new-password"/></label>` : ""}
      ${err ? `<p class="au-err">${esc(err)}</p>` : ""}
      <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" data-x="go">${reg ? "注册并登录" : "登录"}</button></div>
    </div>`;
    el.classList.add("show");
    el.querySelector("#auName").focus();
    for (const b of el.querySelectorAll(".au-tabs button")) b.onclick = () => draw(b.dataset.t, "");
    el.querySelector('[data-x="cancel"]').onclick = close;
    el.querySelector('[data-x="go"]').onclick = async () => {
      const name = el.querySelector("#auName").value.trim();
      const pw = el.querySelector("#auPw").value;
      if (reg && pw !== el.querySelector("#auPw2")?.value) return draw(which, "两次口令不一致");
      try {
        const r = await api("POST", reg ? "/api/community/register" : "/api/community/login", { name, password: pw });
        me = r.user; csrf = r.csrf;
        close(); paint();
        for (const fn of afterLogin) fn();
      } catch (e) { draw(which, e.message); }
    };
    el.querySelector("#auPw").addEventListener("keydown", (e) => { if (e.key === "Enter") el.querySelector('[data-x="go"]').click(); });
  };
  const close = () => el.classList.remove("show");
  draw(tab, "");
}
const afterLogin = [];
export const onLogin = (fn) => afterLogin.push(fn);

/* ---------------- 头像与菜单 ---------------- */
// 没有头像就是首字缩写 + 一块中性暖石色。以前这里按名字取一段青→紫渐变，
// 于是每个默认头像都是"同一种不同深浅的品牌色"，一眼就是生成的；
// 真人论坛的默认头像从来不做渐变。 pubs.js / social.js 共用这一个实现。
export const avatarBg = () => "#3a332a";
// 头像只认站内相对路径：//host 是协议相对（会跳出本站），javascript: 与 data: 一律不要
const safeAvatar = (u) => (typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u : null);
const avatarHtml = (u) => {
  const src = u && safeAvatar(u.avatar);
  return src
    ? `<img class="au-face" src="${esc(src)}" alt=""/>`
    : `<span class="au-face au-init" style="background:${avatarBg(u && u.name)}">${esc(u && u.name ? [...u.name][0] : "?")}</span>`;
};

let menuOpen = false;
async function toggleMenu(anchor) {
  // 菜单宿主：社区页里有，工作台没有——缺就造一个，别要求每个页面都预先摆好
  let box = $("auMenu");
  if (!box) { box = document.createElement("div"); box.id = "auMenu"; document.body.appendChild(box); }
  if (menuOpen) { box.remove(); menuOpen = false; return; }
  let notes = { unread: 0 }, friends = { incoming: [] };
  try {
    notes = await api("GET", "/api/community/notifications");
    friends = await api("GET", "/api/community/friends");
  } catch { /* 拿不到就别显示角标，菜单本身还能用 */ }
  box.innerHTML = `<div class="au-menu">
    <a class="au-head" href="/u/${encodeURIComponent(me.name)}">${avatarHtml(me)}
      <span><b>${esc(me.name)}</b><i>${(me.counts && me.counts.pubs) || 0} 张发布 · ${(me.counts && me.counts.friends) || 0} 好友</i></span></a>
    <div class="au-items">
      <a href="/community?mine=1">我的发布</a>
      <a href="/friends">好友与关注${friends.incoming.length ? `<em>${friends.incoming.length}</em>` : ""}</a>
      <a href="/friends?tab=notes">通知${notes.unread ? `<em>${notes.unread}</em>` : ""}</a>
      <a href="#" data-x="social">好友面板 · 扩列 · 聊天</a>
    </div>
    <button class="au-out" data-x="out">退出登录</button>
  </div>`;
  box.querySelector('[data-x="social"]').onclick = (e) => {
    e.preventDefault(); box.remove(); menuOpen = false;
    import("./social.js").then((m) => m.openSocial("friends")).catch(() => {});
  };
  box.querySelector('[data-x="out"]').onclick = async () => {
    try { await api("POST", "/api/community/logout"); } catch { /* 服务端已经忘了我也行 */ }
    me = null; csrf = ""; box.remove(); menuOpen = false; paint();
  };
  menuOpen = true;
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { position: "fixed", left: Math.max(8, r.left - 240) + "px", top: r.bottom + 8 + "px", zIndex: 999 });
  setTimeout(() => document.addEventListener("click", away, { once: true }), 0);
  function away(e) { if (!box.contains(e.target)) { box.remove(); menuOpen = false; } }
}

function paint() {
  const host = $("wbAuth");
  if (!host) return;
  if (!me) {
    host.innerHTML = `<button class="cm-btn" data-x="login">登录</button><button class="cm-btn primary" data-x="reg">注册</button>`;
    host.querySelector('[data-x="login"]').onclick = () => openAuth("login");
    host.querySelector('[data-x="reg"]').onclick = () => openAuth("register");
    return;
  }
  host.innerHTML = `<button class="au-chip" title="${esc(me.name)}">${avatarHtml(me)}<b>${esc(me.name)}</b></button>`;
  // 社交入口由 social.js 自己画：它比这一层大得多，塞进这里会变成
  // "身份层依赖聊天实现"。动态 import 也顺带避开两个模块互相引用的环。
  import("./social.js").then((m) => { m.initSocial(); m.paintEntry(host); }).catch(() => {});
  if (!$("auMenu")) { const m = document.createElement("div"); m.id = "auMenu"; document.body.appendChild(m); }
  host.querySelector(".au-chip").onclick = (e) => { e.stopPropagation(); toggleMenu(e.currentTarget); };
}

/** 在工作台/社区页顶栏挂身份区；返回当前用户（可能为 null）。 */
export async function mountAuth() {
  await refreshMe();
  return me;
}
