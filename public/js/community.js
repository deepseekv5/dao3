// community.js — 社区页：广场、地图详情、用户主页、好友与关注。
// 一个 HTML 壳 + 按路径分派，因为这几屏共用同一条数据管线（发布卡片、关注按钮、头像）。
import * as auth from "/js/auth.js";
import { timeAgo, kb, toast, modal, face, coverHtml, coverArt, cardHtml, bindCards, playPub, materialize, openPublishDialog } from "/js/pubs.js";
const { api, esc, mountAuth, onLogin, openAuth } = auth;

const root = document.getElementById("cmRoot");
const pageTitle = document.getElementById("cmTitle");
const pageSub = document.getElementById("cmSub");
const qBox = document.getElementById("cmQ");
const $ = (id) => document.getElementById(id);

/* ---------------- 广场 ---------------- */
const FEED_TABS = [["new", "最新"], ["hot", "最热"], ["following", "关注"]];
let feed = { sort: "new", q: "", offset: 0, total: 0, rows: [] };

async function feedView() {
  pageTitle.textContent = "社区广场";
  pageSub.textContent = "别人发布的世界，点进去就能跑一圈";
  qBox.closest(".wb-search").hidden = false;
  root.innerHTML = `<div class="cm-tabs" id="cmTabs"></div><div class="cm-grid" id="cmGrid"></div>
    <div id="cmMore" style="text-align:center"></div>`;
  drawTabs();
  await loadFeed(true);
}

function drawTabs() {
  const el = $("cmTabs");
  el.innerHTML = FEED_TABS.map(([k, label]) =>
    `<button class="cm-btn ${feed.sort === k ? "on" : ""}" data-s="${k}">${label}</button>`).join("")
    + `<span class="spacer"></span><span class="cm-count" id="cmCount"></span>`;
  for (const b of el.querySelectorAll("[data-s]")) b.onclick = () => { feed.sort = b.dataset.s; reload(); };
}

async function reload() { feed = { ...feed, offset: 0, rows: [] }; drawTabs(); $("cmGrid").innerHTML = ""; await loadFeed(true); }

async function loadFeed(reset) {
  const grid = $("cmGrid");
  if (!grid) return;
  if (reset) grid.innerHTML = `<div class="cm-empty">正在读取广场…</div>`;
  let r;
  try {
    r = await api("GET", `/api/community/feed?sort=${feed.sort}&q=${encodeURIComponent(feed.q)}&offset=${feed.offset}&limit=24`);
  } catch (e) {
    grid.innerHTML = `<div class="cm-empty"><b>${esc(e.message)}</b>${feed.sort === "following" ? "登录后才能看关注的人发布了什么。" : "社区服务没起来？"}</div>`;
    return;
  }
  feed.total = r.total;
  feed.rows = feed.rows.concat(r.rows);
  feed.offset = r.rows.length;
  grid.innerHTML = feed.rows.length ? feed.rows.map(cardHtml).join("") : `<div class="cm-empty" style="grid-column:1/-1"><b>这里还空着</b>还没有人发布地图。打开工作台，把你的世界发上来就是第一张。</div>`;
  $("cmCount").textContent = `${feed.rows.length} / ${r.total}`;
  $("cmMore").innerHTML = feed.rows.length < r.total ? `<button class="cm-btn" id="cmMoreBtn">再看 24 张</button>` : "";
  const more = $("cmMoreBtn");
  if (more) more.onclick = () => loadFeed(false);
  bindCards(grid);
}


/* ---------------- 详情页 ---------------- */
async function pubView(id) {
  root.innerHTML = `<div class="cm-empty">正在读取这张地图…</div>`;
  pageTitle.textContent = "地图详情";
  pageSub.textContent = "";
  qBox.closest(".wb-search").hidden = true;
  let d;
  try { d = await api("GET", "/api/community/pubs/" + id); }
  catch (e) { root.innerHTML = `<div class="cm-empty"><b>${esc(e.message)}</b><a href="/community">回广场</a></div>`; return; }
  const p = d.pub, a = d.author;
  const rel = a && a.relation;
  root.innerHTML = `<div class="cm-detail">
    <div>
      <section class="cm-hero">
        <div class="pic${p.hasCover ? "" : " none"}"${p.hasCover ? "" : ` style="${coverArt(p)}"`}>${coverHtml(p)}<span class="glyph">${esc((p.title || "?").slice(0, 1))}</span></div>
        <div class="meta">
          <h2>${esc(p.title)}</h2>
          <p class="lead">${esc(p.desc || "作者没写简介。")}</p>
          ${p.tags.length ? `<div class="cm-tags">${p.tags.map((t) => `<span class="cm-tag">${esc(t)}</span>`).join("")}</div>` : ""}
          <div class="stats" style="margin-top:12px">
            <span>游玩 ${p.plays}</span><span>点赞 ${p.likes}</span><span>评论 <b id="cmCmtN">${p.comments}</b></span>
            <span>存档 ${kb(p.bytes)}</span>${p.shape ? `<span>尺寸 ${esc(p.shape.join("×"))}</span>` : ""}
            ${p.assets ? `<span>素材 ${p.assets} 个文件</span>` : ""}
            <span>发布 ${esc(timeAgo(p.created))}</span>
          </div>
        </div>
      </section>
      <section class="cm-cmts">
        <h3>评论</h3>
        <div id="cmCmtList"></div>
        <div id="cmCompose"></div>
      </section>
    </div>
    <aside class="cm-side">
      <div class="cm-panel">
        <h4>作者</h4>
        <a class="cm-author" href="/u/${encodeURIComponent(a ? a.name : "")}" style="text-decoration:none;color:inherit">
          ${face(a, "lg")}<span><b>${esc(a ? a.name : "已注销")}</b><i>${a && a.counts ? a.counts.pubs + " 张发布 · " + a.counts.followers + " 关注者" : ""}</i></span>
        </a>
        ${a ? `<div class="cm-acts" id="cmAuthorActs"></div>` : ""}
      </div>
      <div class="cm-panel">
        <h4>这张地图</h4>
        <div class="cm-acts">
          <button class="cm-btn primary" id="cmPlay">开始游玩</button>
          <button class="cm-btn ${p.likedByMe ? "on" : ""}" id="cmLike">♥ 点赞 <b>${p.likes}</b></button>
          <button class="cm-btn" id="cmFork">存为我的地图</button>
          ${d.canEdit ? `<button class="cm-btn" id="cmEdit">编辑简介</button><button class="cm-btn" id="cmUnpub">下架</button>` : ""}
        </div>
        <p class="cm-hint" style="margin:10px 0 0">游玩会先把这份<b>快照</b>取回本地：作者之后的改动不会跟着进来。</p>
      </div>
    </aside>
  </div>`;

  if (a) renderAuthorActs(a, rel);
  $("cmPlay").onclick = () => playPub(p);
  $("cmFork").onclick = () => materialize(p, { keep: true });
  $("cmLike").onclick = async () => {
    if (!requireLogin()) return;
    try {
      const r = await api("POST", `/api/community/pubs/${p.id}/like`);
      $("cmLike").innerHTML = `♥ 点赞 <b>${r.likes}</b>`;
      $("cmLike").classList.toggle("on", r.likedByMe);
    } catch (e) { toast(e.message, true); }
  };
  const edit = $("cmEdit");
  if (edit) edit.onclick = () => modal(`<h3>编辑这条发布</h3>
    <label>标题<input id="eTitle" maxlength="60" value="${esc(p.title)}"/></label>
    <label>简介<textarea id="eDesc" maxlength="2000">${esc(p.desc)}</textarea></label>
    <label>标签（逗号分隔，最多 6 个）<input id="eTags" value="${esc(p.tags.join(", "))}"/></label>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="eOk">保存</button></div>`,
    (box, close) => {
      box.querySelector("#eOk").onclick = async () => {
        try {
          await api("PATCH", "/api/community/pubs/" + p.id, {
            title: box.querySelector("#eTitle").value.trim(),
            desc: box.querySelector("#eDesc").value.trim(),
            tags: box.querySelector("#eTags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          });
          close(); toast("已保存"); route();
        } catch (e) { toast(e.message, true); }
      };
    });
  const unpub = $("cmUnpub");
  if (unpub) unpub.onclick = async () => {
    if (!confirm("下架后这张图就从广场消失了，确定？")) return;
    try { await api("DELETE", "/api/community/pubs/" + p.id); toast("已下架"); go("/community"); }
    catch (e) { toast(e.message, true); }
  };
  await loadComments(p.id);
}

function renderAuthorActs(a, rel) {
  const host = $("cmAuthorActs");
  if (!host) return;
  if (!a) { host.innerHTML = ""; return; }
  const meName = auth.me && auth.me.name;
  if (meName === a.name) { host.innerHTML = `<span class="cm-hint" style="margin:0">这是你自己的主页。</span>`; return; }
  const r = rel || {};
  host.innerHTML = `
    <button class="cm-btn ${r.following ? "on" : ""}" id="cmFollow">${r.following ? "已关注" : "关注"}</button>
    <button class="cm-btn ${r.friend ? "on" : ""}" id="cmFriend" ${r.friend ? "disabled" : ""}>
      ${r.friend ? "已是好友" : r.pendingOut ? "等待回应" : r.pendingIn ? "接受好友请求" : "加好友"}</button>`;
  host.querySelector("#cmFollow").onclick = async () => {
    if (!requireLogin()) return;
    try {
      const x = await api("POST", "/api/community/follow", { name: a.name });
      renderAuthorActs(a, x.relation);
      toast(x.following ? "已关注 " + a.name : "已取消关注");
    } catch (e) { toast(e.message, true); }
  };
  host.querySelector("#cmFriend").onclick = async () => {
    if (!requireLogin()) return;
    try {
      const act = r.pendingIn ? "accept" : "request";
      await api("POST", `/api/community/friend/${act}`, { name: a.name });
      toast(act === "accept" ? "你们成为好友了" : "好友请求已发出");
      route();
    } catch (e) { toast(e.message, true); }
  };
}

async function loadComments(pubId) {
  const list = $("cmCmtList"), compose = $("cmCompose");
  if (!list) return;
  let rows = [];
  try { rows = (await api("GET", `/api/community/pubs/${pubId}/comments`)).rows; }
  catch (e) { list.innerHTML = `<p class="cm-hint">${esc(e.message)}</p>`; return; }
  list.innerHTML = rows.length ? rows.map((c) => `<div class="cm-cmt" data-id="${esc(c.id)}">
      <a href="/u/${encodeURIComponent(c.author.name)}" style="text-decoration:none">${face(c.author)}</a>
      <div class="txt">
        <div class="hd"><a href="/u/${encodeURIComponent(c.author.name)}">${esc(c.author.name)}</a><time>${esc(timeAgo(c.ts))}</time></div>
        <p>${esc(c.body)}</p>
        <div class="ops">
          <button data-x="like" class="${c.likedByMe ? "on" : ""}">♥ <span>${c.likes}</span></button>
          ${c.mine ? '<button data-x="del">删除</button>' : ""}
        </div>
      </div>
    </div>`).join("") : `<p class="cm-hint">还没有评论。说一句这张图哪里好玩。</p>`;
  for (const el of list.querySelectorAll(".cm-cmt")) {
    const id = el.dataset.id;
    const like = el.querySelector('[data-x="like"]');
    if (like) like.onclick = async () => {
      if (!requireLogin()) return;
      try {
        const r = await api("POST", `/api/community/comments/${id}/like`);
        like.classList.toggle("on", r.likedByMe);
        like.querySelector("span").textContent = r.likes;
      } catch (e) { toast(e.message, true); }
    };
    const del = el.querySelector('[data-x="del"]');
    if (del) del.onclick = async () => {
      try { await api("DELETE", `/api/community/pubs/${pubId}/comments/${id}`); await loadComments(pubId); bumpCount(-1); }
      catch (e) { toast(e.message, true); }
    };
  }
  compose.innerHTML = auth.me
    ? `<div class="cm-compose"><textarea id="cBody" maxlength="500" placeholder="说点什么（最多 500 字）"></textarea>
        <button class="cm-btn primary" id="cSend">发送</button></div>`
    : `<p class="cm-hint"><a href="#" id="cLogin">登录</a>后才能评论。</p>`;
  const login = $("cLogin");
  if (login) login.onclick = (e) => { e.preventDefault(); openAuth("login"); };
  const send = $("cSend");
  if (send) send.onclick = async () => {
    const body = $("cBody").value.trim();
    if (!body) return toast("先写点内容", true);
    send.disabled = true;
    try {
      await api("POST", `/api/community/pubs/${pubId}/comments`, { body });
      $("cBody").value = "";
      await loadComments(pubId); bumpCount(1);
    } catch (e) { toast(e.message, true); }
    finally { send.disabled = false; }
  };
  function bumpCount(n) { const el = $("cmCmtN"); if (el) el.textContent = Math.max(0, Number(el.textContent) + n); }
}

/* ---------------- 用户主页 ---------------- */
async function userView(name) {
  qBox.closest(".wb-search").hidden = true;
  root.innerHTML = `<div class="cm-empty">正在读取主页…</div>`;
  let d;
  try { d = await api("GET", "/api/community/users/" + encodeURIComponent(name)); }
  catch (e) { root.innerHTML = `<div class="cm-empty"><b>${esc(e.message)}</b></div>`; return; }
  const u = d.user;
  pageTitle.textContent = u.name + " 的主页";
  pageSub.textContent = u.bio || "这个人还没写简介";
  const mine = !!auth.me && auth.me.id === u.id;
  root.innerHTML = `<div class="cm-rows">
    <div class="cm-profile">${face(u, "lg")}
      <div><h2 style="margin:0;font-size:17px">${esc(u.name)}</h2>
        <p class="bio">${esc(u.bio || "")}</p>
        <p class="cm-hint" style="margin:4px 0 0">加入于 ${esc(new Date(u.createdAt).toLocaleDateString())}</p></div>
    </div>
    <div class="cm-rel">
      <span class="num"><b>${u.counts ? u.counts.followers : 0}</b> 关注者</span>
      <span class="num"><b>${u.counts ? u.counts.following : 0}</b> 关注中</span>
      <span class="num"><b>${u.counts ? u.counts.friends : 0}</b> 好友</span>
      <span class="num"><b>${u.counts ? u.counts.pubs : 0}</b> 张发布</span>
      <span class="spacer" style="flex:1"></span>
      ${mine ? '<button class="cm-btn sm" id="uEdit">编辑简介</button>' : '<span id="uActs"></span>'}
    </div>
    <div class="cm-tabs" id="uTabs">
      <button class="cm-btn on" data-t="pubs">发布的地图</button>
      <button class="cm-btn" data-t="followers">关注者</button>
      <button class="cm-btn" data-t="following">关注中</button>
    </div>
    <div id="uBody"></div>
  </div>`;
  if (!mine) {
    $("uActs").innerHTML = `<button class="cm-btn ${u.relation && u.relation.following ? "on" : ""}" id="uFollow">${u.relation && u.relation.following ? "已关注" : "关注"}</button>`;
    $("uFollow").onclick = async () => {
      if (!requireLogin()) return;
      const r = await api("POST", "/api/community/follow", { name: u.name });
      toast(r.following ? "已关注" : "已取消关注");
      userView(name);
    };
  } else {
    $("uEdit").onclick = () => modal(`<h3>编辑简介</h3><label>一句话介绍自己<textarea id="uBio" maxlength="200">${esc(u.bio || "")}</textarea></label>
      <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="uOk">保存</button></div>`,
      (box, close) => {
        box.querySelector("#uOk").onclick = async () => {
          try { await api("PATCH", "/api/community/me", { bio: box.querySelector("#uBio").value }); close(); toast("已保存"); userView(name); }
          catch (e) { toast(e.message, true); }
        };
      });
  }
  const tabs = $("uTabs");
  const show = async (which) => {
    for (const b of tabs.querySelectorAll("[data-t]")) b.classList.toggle("on", b.dataset.t === which);
    const body = $("uBody");
    body.innerHTML = `<div class="cm-empty">读取中…</div>`;
    if (which === "pubs") {
      const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/pubs`)).rows;
      body.innerHTML = rows.length ? `<div class="cm-grid">${rows.map(cardHtml).join("")}</div>` : `<div class="cm-empty">还没有发布过地图。</div>`;
      bindCards(body);
      return;
    }
    const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/${which}`)).rows;
    body.innerHTML = rows.length ? rows.map((x) => `<div class="cm-row">${face(x)}
      <div class="grow"><b>${esc(x.name)}</b><div class="sub">${esc(x.bio || "")}</div></div>
      <a class="cm-btn sm" href="/u/${encodeURIComponent(x.name)}">看主页</a></div>`).join("")
      : `<div class="cm-empty">${which === "followers" ? "还没有人关注这个人。" : "这个人还没关注谁。"}</div>`;
  };
  for (const b of tabs.querySelectorAll("[data-t]")) b.onclick = () => show(b.dataset.t);
  await show("pubs");
}

/* ---------------- 好友与关注 ---------------- */
async function friendsView() {
  qBox.closest(".wb-search").hidden = false;
  pageTitle.textContent = "好友与关注";
  pageSub.textContent = "谁在跟你一起玩，谁在等你回应";
  root.innerHTML = `<div class="cm-empty">读取中…</div>`;
  if (!auth.me) {
    root.innerHTML = `<div class="cm-empty"><b>先登录</b>好友、关注与通知都要先有个账号。<button class="cm-btn primary" id="fLogin" style="margin-top:12px">登录 / 注册</button></div>`;
    $("fLogin").onclick = () => openAuth("login");
    return;
  }
  const [fr, notes] = await Promise.all([api("GET", "/api/community/friends"), api("GET", "/api/community/notifications")]);
  const tab = new URLSearchParams(location.search).get("tab") || "friends";
  const tabs = [["friends", `好友 ${fr.friends.length}`], ["requests", `请求 ${fr.incoming.length + fr.outgoing.length}`],
    ["suggested", "可能认识"], ["notes", `通知 ${notes.unread ? "(" + notes.unread + ")" : ""}`]];
  root.innerHTML = `<div class="cm-rows"><div class="cm-tabs">${tabs.map(([k, l]) =>
    `<button class="cm-btn ${k === tab ? "on" : ""}" data-t="${k}">${esc(l)}</button>`).join("")}</div><div id="fBody"></div></div>`;
  for (const b of root.querySelectorAll("[data-t]")) b.onclick = () => {
    const u = new URLSearchParams(location.search); u.set("tab", b.dataset.t);
    history.replaceState(null, "", location.pathname + "?" + u);
    friendsView();
  };
  const body = $("fBody");
  const row = (u, ops) => `<div class="cm-row">${face(u)}<div class="grow"><b>${esc(u.name)}</b>
    <div class="sub">${esc(u.bio || (u.counts ? u.counts.pubs + " 张发布" : ""))}</div></div>${ops}</div>`;
  if (tab === "friends") {
    body.innerHTML = fr.friends.length ? fr.friends.map((u) => row(u,
      `<a class="cm-btn sm" href="/u/${encodeURIComponent(u.name)}">主页</a><button class="cm-btn sm" data-rm="${esc(u.name)}">解除</button>`)).join("")
      : `<div class="cm-empty">还没有好友。去广场看看别人发布的地图，从主页上加好友。</div>`;
    for (const b of body.querySelectorAll("[data-rm]")) b.onclick = async () => {
      await api("POST", "/api/community/friend/remove", { name: b.dataset.rm });
      toast("已解除好友"); friendsView();
    };
  } else if (tab === "requests") {
    const inb = fr.incoming.map(({ user }) => row(user,
      `<button class="cm-btn sm primary" data-acc="${esc(user.name)}">接受</button><button class="cm-btn sm" data-dec="${esc(user.name)}">拒绝</button>`));
    const out = fr.outgoing.map(({ user }) => row(user, `<span class="cm-hint" style="margin:0">等待回应</span>`));
    body.innerHTML = inb.length + out.length ? inb.concat(out).join("") : `<div class="cm-empty">没有待处理的好友请求。</div>`;
    const act = (which) => (e) => {
      const name = e.currentTarget.dataset[which];
      api("POST", `/api/community/friend/${which === "acc" ? "accept" : "decline"}`, { name })
        .then(() => { toast(which === "acc" ? "已接受" : "已拒绝"); friendsView(); })
        .catch((x) => toast(x.message, true));
    };
    for (const b of body.querySelectorAll("[data-acc]")) b.onclick = act("acc");
    for (const b of body.querySelectorAll("[data-dec]")) b.onclick = act("dec");
  } else if (tab === "suggested") {
    body.innerHTML = fr.suggested.length ? fr.suggested.map((u) => row(u,
      `<button class="cm-btn sm" data-fo="${esc(u.name)}">${u.relation && u.relation.following ? "已关注" : "关注"}</button>`)).join("")
      : `<div class="cm-empty">暂时没有可推荐的人。加了好友之后这里会出现好友们在关注的人。</div>`;
    for (const b of body.querySelectorAll("[data-fo]")) b.onclick = async () => {
      await api("POST", "/api/community/follow", { name: b.dataset.fo });
      friendsView();
    };
  } else {
    if (notes.rows.length) api("POST", "/api/community/notifications").catch(() => { });
    const KIND = { follow: "关注了你", friend_request: "想加你为好友", friend: "接受了你的好友请求", like: "赞了你的地图", comment: "评论了你的地图", publish: "发布了新地图" };
    body.innerHTML = notes.rows.length ? notes.rows.map((n) => `<div class="cm-row">${face(n.actor || {})}
      <div class="grow"><b>${esc(n.actor ? n.actor.name : "系统")}</b><div class="sub">${esc(KIND[n.kind] || n.kind)} · ${esc(timeAgo(n.ts))}</div></div>
      ${n.pub ? `<a class="cm-btn sm" href="/p/${esc(n.pub.id)}">去看地图</a>` : n.actor ? `<a class="cm-btn sm" href="/u/${encodeURIComponent(n.actor.name)}">看主页</a>` : ""}`).join("")
      : `<div class="cm-empty">还没有通知。</div>`;
  }
}


/* ---------------- 路由 ---------------- */
function requireLogin() {
  if (auth.me) return true;
  openAuth("login");
  return false;
}
export function go(path) { location.href = path; }

async function route() {
  const p = location.pathname;
  if (p.startsWith("/p/")) return pubView(p.slice(3));
  if (p.startsWith("/u/")) return userView(decodeURIComponent(p.slice(3)));
  if (p.startsWith("/friends")) return friendsView();
  if (p.startsWith("/me")) { if (!auth.me) { openAuth("login"); return feedView(); } return userView(auth.me.name); }
  if (new URLSearchParams(location.search).get("mine") && auth.me) return userView(auth.me.name);
  return feedView();
}

qBox.addEventListener("input", () => {
  feed.q = qBox.value.trim();
  if (location.pathname === "/community") reload();
});
window.addEventListener("popstate", route);

// 登录/注册成功后重跑当前视图：auth.me 是命名导出的实时绑定，读到的就是新人
onLogin(() => route());

(async () => {
  await mountAuth();
  await route();
})();
