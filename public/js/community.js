// community.js — 社区页：广场、地图详情、用户主页、好友与关注。
// 一个 HTML 壳 + 按路径分派，因为这几屏共用同一条数据管线（发布卡片、关注按钮、头像）。
import * as auth from "/js/auth.js";
import { timeAgo, kb, toast, modal, face, coverHtml, coverArt, cardHtml, railHtml, heroHtml, bindCards, playPub, materialize, pullModel, openPublishDialog, icons } from "/js/pubs.js";
import { profileView } from "/js/profile.js";
const { api, esc, mountAuth, onLogin, openAuth } = auth;

const root = document.getElementById("cmRoot");
const pageTitle = document.getElementById("cmTitle");
const pageSub = document.getElementById("cmSub");
const qBox = document.getElementById("cmQ");
const $ = (id) => document.getElementById(id);

/* ---------------- 广场 ---------------- */
const FEED_TABS = [["new", "最新"], ["hot", "最热"], ["following", "关注"]];
// 不写"全部"那一格：上面那行分类已经有一个"全部"了，同一屏出现两个同义词的开关，谁都要想一下。
const FEED_KINDS = [["map", "地图"], ["model", "模型"], ["skin", "皮肤"]];
const KIND_NOUN = { map: "地图", model: "模型", skin: "皮肤" };
let feed = { sort: "new", cat: "", kind: "", q: "", offset: 0, total: 0, rows: [], cats: [] };

async function feedView() {
  pageTitle.textContent = "地图展厅";
  pageSub.textContent = "别人发布的世界，点进去就能跑一圈";
  qBox.closest(".wb-search").hidden = false;
  root.innerHTML = `<div id="cmFeature"></div>
    <div class="cm-cats" id="cmCats"></div>
    <div class="cm-tabs" id="cmTabs"></div>
    <div id="cmRails"></div>
    <section class="cm-sect"><header><h3 id="cmSectTitle">全部作品</h3><span class="cm-count" id="cmCount"></span></header>
      <div class="cm-grid" id="cmGrid"></div></section>
    <div id="cmMore" style="text-align:center"></div>`;
  drawTabs();
  await loadFeed(true);
}

/** 玩法分类是主导航：玩家找的是"有没有能跑一圈的图"，不是被运营位推荐。
    列表由服务端给（/feed 的 cats 字段），不在前端再抄一份，否则两边会慢慢长歪。 */
function drawCats() {
  const el = $("cmCats");
  if (!el) return;
  const cats = feed.cats.length ? feed.cats : ["竞速", "跑酷", "解谜", "生存", "角色扮演", "模拟经营", "创造", "对战", "恐怖", "休闲"];
  el.innerHTML = [`<button class="cm-cat ${feed.cat ? "" : "on"}" data-c="">全部`]
    .concat(cats.map((c) => `<button class="cm-cat ${feed.cat === c ? "on" : ""}" data-c="${esc(c)}">${esc(c)}`))
    .join("</button>") + "</button>";
  for (const b of el.querySelectorAll("[data-c]")) b.onclick = () => { feed.cat = b.dataset.c; reload(); };
}

function drawTabs() {
  const el = $("cmTabs");
  el.innerHTML = FEED_TABS.map(([k, label]) =>
    `<button class="cm-btn ${feed.sort === k ? "on" : ""}" data-s="${k}">${label}</button>`).join("")
    // 地图和模型是两种东西：模型不能被"游玩"，只能被看、被评论、被取回自己的库里用。
    // 混在一条流里模型永远沉底，所以给一条按类型切的开关。
    + `<span class="cm-kinds">${FEED_KINDS.map(([k, label]) =>
      `<button class="cm-kind ${feed.kind === k ? "on" : ""}" data-k="${k}">${label}</button>`).join("")}</span>`
    + `<span class="spacer"></span>`;
  for (const b of el.querySelectorAll("[data-s]")) b.onclick = () => { feed.sort = b.dataset.s; reload(); };
  // 再点一次当前那一类就是取消筛选，回到"都看"
  for (const b of el.querySelectorAll("[data-k]")) b.onclick = () => { feed.kind = feed.kind === b.dataset.k ? "" : b.dataset.k; reload(); };
}

async function reload() { feed = { ...feed, offset: 0, rows: [] }; drawCats(); drawTabs(); $("cmGrid").innerHTML = ""; await loadFeed(true); }

async function loadFeed(reset) {
  const grid = $("cmGrid");
  if (!grid) return;
  // 读的时候给一排骨架，不给一行字：一屏空白 + 一句话，看起来像坏了而不是在加载
  if (reset) grid.innerHTML = `<div class="cm-card cm-skel" style="grid-column:1/-1;display:none"></div>`
    + Array.from({ length: 8 }, () => `<div class="cm-skel"><span class="sk-img"></span><span class="sk-line"></span><span class="sk-line sm"></span></div>`).join("");
  let r;
  try {
    r = await api("GET", `/api/community/feed?sort=${feed.sort}&cat=${encodeURIComponent(feed.cat)}&kind=${feed.kind}&q=${encodeURIComponent(feed.q)}&offset=${feed.offset}&limit=24`);
  } catch (e) {
    grid.innerHTML = `<div class="cm-empty"><b>${esc(e.message)}</b>${feed.sort === "following" ? "登录后才能看关注的人发布了什么。" : "社区服务没起来？"}</div>`;
    return;
  }
  if (Array.isArray(r.cats) && r.cats.join() !== feed.cats.join()) feed.cats = r.cats;
  drawCats();
  feed.total = r.total;
  feed.rows = feed.rows.concat(r.rows);
  feed.offset = r.rows.length;
  const noun = KIND_NOUN[feed.kind] || "作品";
  const title = $("cmSectTitle");
  if (title) title.textContent = feed.cat ? `${feed.cat} · ${noun}` : (feed.q ? `“${feed.q}”的搜索结果` : `全部${noun}`);
  grid.innerHTML = feed.rows.length ? feed.rows.map(cardHtml).join("") : `<div class="cm-empty" style="grid-column:1/-1">
    <b>${feed.q ? "没找到匹配的作品" : `这里还空着`}</b>
    ${feed.q ? "换个词，或者回广场看看全部。" : `还没有${noun}发布。${auth.me ? "打开工作台，把第一张图发出来。" : "登录后就能发布你的第一张图。"}`}
    ${feed.q ? `<a class="cm-btn" href="/community">看全部${noun}</a>` : `<a class="cm-btn primary" href="/">去工作台</a>`}
  </div>`;
  // 精选位与导轨只在"没在筛选"的那一屏出现：搜索结果里放"大家都在玩"是答非所问。
  const plain = !feed.cat && !feed.kind && !feed.q && feed.sort !== "following";
  const featHost = $("cmFeature"), railHost = $("cmRails");
  const byPlays = [...feed.rows].sort((a, b) => (b.plays || 0) - (a.plays || 0) || (b.updated || 0) - (a.updated || 0));
  featHost.innerHTML = plain && byPlays.length ? heroHtml(byPlays[0]) : "";
  // 导轨要在内容够多的时候才有意义：一共三张图还分"大家都在玩"和"全部作品"两遍，是凑版式。
  const rest = plain && byPlays.length > 7 ? byPlays.slice(1, 7) : [];
  railHost.innerHTML = rest.length ? railHtml("大家都在玩", rest, { href: "/community?sort=hot", label: "按热度看" }) : "";
  $("cmCount").textContent = `${feed.rows.length} / ${r.total}`;
  $("cmMore").innerHTML = feed.rows.length < r.total ? `<button class="cm-btn" id="cmMoreBtn">再看 24 张</button>` : "";
  const more = $("cmMoreBtn");
  if (more) more.onclick = () => loadFeed(false);
  bindCards(root, { onPlay: (id, btn) => { const p = feed.rows.find((x) => x.id === id); if (p) playPub(p, btn); } });
}


/* ---------------- 皮肤社区：取用 ---------------- */
/** 社区那份皮肤记录 → 账号皮肤（五键 + 骨骼扩展键）。
 *  只有记录里有的来源才覆盖：六块色里没有"头发"这一格，硬覆盖会把用户的头发刷成默认棕。 */
function toAccountSkin(cur, doc) {
  const six = (doc && doc.skin) || {};
  const out = Object.assign({}, cur || {});
  if (six.head) out.skin = six.head;
  if (six.body) out.shirt = six.body;
  if (six.legL) out.pants = six.legL;
  if (six.legR) out.shoe = six.legR;
  if (doc.texture) out.texture = doc.texture; else delete out.texture;
  if (doc.model) out.model = doc.model; else delete out.model;
  if (doc.kind === "rig") { out.kind = "rig"; out.bones = doc.bones || {}; out.axes = doc.axes || {}; if (doc.scale) out.scale = doc.scale; }
  else delete out.kind;
  out.name = String(doc.name || "").slice(0, 24);
  return out;
}

/** 应用到账号：进任何一张图都穿着它，联机时别人看你也是这一身。 */
async function applyCommunitySkin(p, btn) {
  if (!requireLogin()) return;
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = "正在取用…";
  try {
    const r = await fetch(`/api/community/pubs/${p.id}/skin`);
    if (!r.ok) throw new Error(r.status === 404 ? "这份发布不是皮肤" : "皮肤记录读不出来");
    const doc = await r.json();
    const res = await api("PATCH", "/api/community/me", { skin: toAccountSkin(auth.me && auth.me.skin, doc) });
    auth.setMe(res.user);
    // 服务端会丢掉它不认的键（越界路径、超大映射表）。丢了却说"已应用"，
    // 用户进图才发现还是原来那张脸，只会以为我们没接上。
    const lost = (doc.model && !res.user.skin.model) || (doc.texture && !res.user.skin.texture);
    toast(lost ? `已应用配色，但资产没被接受（只认站内路径）` : `已穿上「${doc.name || p.title}」`, lost, 4200);
    api("POST", `/api/community/pubs/${p.id}/play`).catch(() => { });
    btn.innerHTML = label;
    btn.disabled = false;
  } catch (e) {
    toast("应用失败：" + (e.message || e), true, 4200);
    btn.innerHTML = label;
    btn.disabled = false;
  }
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
        <div class="pic${p.hasCover ? "" : " none"}"${p.hasCover ? "" : ` style="${coverArt(p)}"`}>${coverHtml(p)}<span class="glyph">${esc((p.title || "?").slice(0, 1))}</span>
          <div class="cap"><h2>${esc(p.title)}</h2><div class="kind">${esc(KIND_NOUN[p.kind] || "地图")} · ${esc(timeAgo(p.created))}发布</div></div>
        </div>
        <div class="meta">
          ${p.desc ? `<p class="lead">${esc(p.desc)}</p>` : `<p class="lead none">作者没写简介。进去跑一圈比看文字快。</p>`}
          ${p.tags.length ? `<div class="cm-tags">${p.tags.map((t) => `<span class="cm-tag">${esc(t)}</span>`).join("")}</div>` : ""}
        </div>
      </section>
      <section class="cm-cmts">
        <h3>评论</h3>
        <div id="cmCmtList"></div>
        <div id="cmCompose"></div>
      </section>
      <div id="cmAlso"></div>
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
        <h4>这张${KIND_NOUN[p.kind] || "地图"}</h4>
        <div class="cm-acts" id="cmPubActs">
          ${p.kind === "skin"
            ? `<button class="cm-btn primary" id="cmApply" title="写进你的账号皮肤：进任何一张图都穿着它，别人看你也是">${icons.HEART}应用到我的角色</button>`
            : `<button class="cm-btn primary" id="cmPlay" title="游玩前会把这份快照取回本地，作者之后的改动不会跟着进来">${icons.PLAY}${p.kind === "model" ? "下载模型" : "开始游玩"}</button>`}
          <button class="cm-btn ${p.likedByMe ? "on" : ""}" id="cmLike">${icons.HEART}点赞 <b>${p.likes}</b></button>
          ${p.kind === "model"
            ? `<button class="cm-btn" id="cmPull">${icons.DOWN}取回到模型库</button>`
            : p.kind === "skin"
              ? `<button class="cm-btn" id="cmDl">${icons.DOWN}下载皮肤文件</button>`
              : `<button class="cm-btn" id="cmFork">${icons.DOWN}存为我的地图</button>`}
          ${d.canEdit ? `<button class="cm-btn" id="cmEdit">编辑简介</button><button class="cm-btn" id="cmUnpub">下架</button>` : ""}
          ${d.canEdit ? "" : `<button class="cm-report" id="cmReport">举报这张${KIND_NOUN[p.kind] || "地图"}</button>`}
        </div>
        ${p.version > 1 ? `<div style="margin-top:10px"><h4 style="margin:0 0 4px;font-size:11px;color:var(--fg3)">版本 ${p.version}</h4><div class="cm-ver" id="cmVer"></div></div>` : ""}
      </div>
      <div class="cm-panel">
        <h4>这张地图的信息</h4>
        <dl class="cm-info">
          <div><dt>游玩</dt><dd>${p.plays}</dd></div>
          <div><dt>点赞</dt><dd>${p.likes}</dd></div>
          <div><dt>评论</dt><dd><b id="cmCmtN">${p.comments}</b></dd></div>
          <div><dt>存档</dt><dd>${kb(p.bytes)}</dd></div>
          ${p.shape ? `<div><dt>尺寸</dt><dd>${esc(p.shape.join(" × "))}</dd></div>` : ""}
          ${p.assets ? `<div><dt>素材</dt><dd>${p.assets} 个文件</dd></div>` : ""}
          <div><dt>版本</dt><dd>v${p.version}</dd></div>
          <div><dt>发布</dt><dd>${esc(timeAgo(p.created))}</dd></div>
        </dl>
      </div>
    </aside>
  </div>`;

  if (a) renderAuthorActs(a, rel);
  // 详情页最容易空：看完这张就该有下一张。取热门，排掉自己。
  api("GET", "/api/community/feed?sort=hot&limit=8").then((r) => {
    const rows = (r.rows || []).filter((x) => x.id !== p.id).slice(0, 6);
    const host = $("cmAlso");
    if (host && rows.length) { host.innerHTML = railHtml("接下来试试", rows); bindCards(host); }
  }).catch(() => { });
  const playBtn = $("cmPlay");
  if (playBtn) playBtn.onclick = () => playPub(p);
  const fork = $("cmFork");
  if (fork) fork.onclick = () => materialize(p, { keep: true });
  const pull = $("cmPull");
  if (pull) pull.onclick = () => pullModel(p, pull);
  const apply = $("cmApply");
  if (apply) apply.onclick = () => applyCommunitySkin(p, apply);
  const dl = $("cmDl");
  if (dl) dl.onclick = async () => {
    dl.disabled = true;
    try {
      const r = await fetch(`/api/community/pubs/${p.id}/skin`);
      if (!r.ok) throw new Error(await r.text());
      const blob = new Blob([await r.text()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = (p.title || "skin") + ".skin.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      api("POST", `/api/community/pubs/${p.id}/play`).catch(() => { });
    } catch (e) { toast("下载失败：" + e.message, true); }
    dl.disabled = false;
  };
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
  if (p.kind === "model") {
    $("cmPlay").onclick = async () => {
      const r = await fetch(`/api/community/pubs/${p.id}/model`);
      const j = await r.json().catch(() => null);
      if (!j) return toast("取不到模型内容", true);
      const blob = new Blob([JSON.stringify(j)], { type: "application/octet-stream" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = (p.title || "model") + ".voxa"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("已下载 " + (p.title || "") + ".voxa");
    };
    const note = document.createElement("button");
    note.className = "cm-btn"; note.textContent = "在 VOXA 里打开";
    note.onclick = async () => {
      try {
        const j = await (await fetch(`/api/community/pubs/${p.id}/model`)).json();
        sessionStorage.setItem("ly_voxa_import", JSON.stringify(j));
        location.href = "/voxa?import=1";
      } catch (e) { toast(e.message, true); }
    };
    $("cmPubActs").append(note);
  }
  const reportBtn = $("cmReport");
  if (reportBtn) reportBtn.onclick = async () => {
    if (!auth.me) return openAuth("login");
    const reason = prompt("举报理由（会进入管理员的审核队列）");
    if (reason == null || !reason.trim()) return;
    try { await api("POST", `/api/community/pubs/${p.id}/report`, { reason: reason.trim() }); toast("已提交举报"); }
    catch (e) { toast(e.message, true); }
  };
  const verHost = $("cmVer");
  if (verHost) {
    try {
      const vs = await api("GET", `/api/community/pubs/${p.id}/versions`);
      verHost.innerHTML = vs.rows.map((v) => `<button data-v="${v.v}">v${v.v} · ${new Date(v.ts).toLocaleDateString()}</button>`).join("");
      for (const b of verHost.querySelectorAll("[data-v]")) b.onclick = async () => {
        if (!confirm(`回到 v${b.dataset.v}？当前版本会被归档，不会丢。`)) return;
        try { await api("POST", `/api/community/pubs/${p.id}/rollback`, { v: Number(b.dataset.v) }); toast("已回滚"); pubView(id); }
        catch (e) { toast(e.message, true); }
      };
    } catch { verHost.remove(); }
  }
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
  if (meName === a.name) { host.innerHTML = ""; return; }
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
    </div>`).join("") : `<p class="cm-hint">还没有评论。</p>`;
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
    : `<div class="cm-compose is-guest"><textarea disabled placeholder="登录后就能评论这张地图"></textarea>
        <button class="cm-btn primary" id="cLogin">登录</button></div>`;
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
  if (p.startsWith("/u/")) return profileView(decodeURIComponent(p.slice(3)), root, (x) => (pageTitle.textContent = x), (x) => (pageSub.textContent = x));
  if (p.startsWith("/friends")) return friendsView();
  if (p.startsWith("/me")) { if (!auth.me) { openAuth("login"); return feedView(); } return profileView(auth.me.name, root, (x) => (pageTitle.textContent = x), (x) => (pageSub.textContent = x)); }
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
