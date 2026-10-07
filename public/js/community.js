// community.js — 社区页：广场、地图详情、用户主页、好友与关注。
// 一个 HTML 壳 + 按路径分派，因为这几屏共用同一条数据管线（发布卡片、关注按钮、头像）。
import * as auth from "/js/auth.js";
import { timeAgo, kb, toast, modal, face, coverHtml, coverArt, coverUrl, cardHtml, railHtml, heroHtml, bindCards, playPub, materialize, pullModel, openPublishDialog, icons } from "/js/pubs.js";
import { profileView } from "/js/profile.js";
const { api, esc, mountAuth, onLogin, openAuth } = auth;

const root = document.getElementById("cmRoot");
const pageTitle = document.getElementById("cmTitle");
const pageSub = document.getElementById("cmSub");
const qBox = document.getElementById("cmQ");
const $ = (id) => document.getElementById(id);

/* ---------------- 广场 ---------------- */
const FEED_TABS = [["new", "最新"], ["hot", "最热"], ["foryou", "推荐"], ["following", "关注"]];
// 不写"全部"那一格：上面那行分类已经有一个"全部"了，同一屏出现两个同义词的开关，谁都要想一下。
const FEED_KINDS = [["map", "地图"], ["model", "模型"], ["skin", "皮肤"]];
const KIND_NOUN = { map: "地图", model: "模型", skin: "皮肤" };
let feed = { sort: "new", cat: "", kind: "", q: "", offset: 0, total: 0, rows: [], cats: [] };

/** 广场的筛选状态存在地址栏里。
 *  以前只存在内存：导轨上写着「按热度看 → /community?sort=hot」，点进去却停在最新，
 *  等于一条假链接；搜索结果也没法分享、没法后退。
 *  用 replaceState 而不是 pushState：切一次 tab 就压一条历史，后退键会变成
 *  "回到我三分钟前点过的那个分类"，没人想要那个。 */
function readFeedUrl() {
  const u = new URLSearchParams(location.search);
  const s = u.get("sort");
  feed.sort = FEED_TABS.some(([k]) => k === s) ? s : "new";
  const k = u.get("kind");
  feed.kind = FEED_KINDS.some(([x]) => x === k) ? k : "";
  feed.cat = (u.get("cat") || "").slice(0, 12);
  feed.q = (u.get("q") || "").slice(0, 60);
  if (qBox && qBox.value !== feed.q) qBox.value = feed.q;
}
function writeFeedUrl() {
  if (!location.pathname.startsWith("/community")) return;
  const u = new URLSearchParams();
  if (feed.sort && feed.sort !== "new") u.set("sort", feed.sort);
  if (feed.kind) u.set("kind", feed.kind);
  if (feed.cat) u.set("cat", feed.cat);
  if (feed.q) u.set("q", feed.q);
  const qs = u.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

async function feedView() {
  pageTitle.textContent = "地图展厅";
  pageSub.textContent = "别人发布的世界，点进去就能跑一圈";
  qBox.closest(".wb-search").hidden = false;
  readFeedUrl();
  root.innerHTML = `<div class="cm-portal">
    <div class="cm-main">
      <div id="cmFeature"></div>
      <div class="cm-catgrid" id="cmCats"></div>
      <div class="cm-tabs" id="cmTabs"></div>
      <div id="cmContinue"></div>
      <div id="cmRails"></div>
      <section class="cm-sect"><header><h3 id="cmSectTitle">全部作品</h3><span class="cm-count" id="cmCount"></span></header>
        <div class="cm-grid" id="cmGrid"></div></section>
      <div id="cmMore" style="text-align:center"></div>
    </div>
    <aside class="cm-sidecol" id="cmSide" hidden></aside>
  </div>`;
  drawTabs();
  await loadFeed(true);
}

/** 玩法分类是主导航：玩家找的是"有没有能跑一圈的图"，不是被运营位推荐。
    列表由服务端给（/feed 的 cats 字段），不在前端再抄一份，否则两边会慢慢长歪。
    每一格拿该分类下最热那张图的封面当底图——瓷砖上有一张真图，人扫一眼就知道里面是什么；
    没有图就不铺渐变，退回一格纯色，空着也要空得诚实。 */
function drawCats() {
  const el = $("cmCats");
  if (!el) return;
  const cats = feed.cats.length ? feed.cats : ["竞速", "跑酷", "解谜", "生存", "角色扮演", "模拟经营", "创造", "对战", "恐怖", "休闲"];
  const tile = (key, label) => {
    const cov = feed.catCovers && feed.catCovers[key];
    const art = cov ? ` style="background-image:url('/api/community/pubs/${esc(cov)}/cover')"` : "";
    const n = key ? (feed.catCounts && feed.catCounts[key]) || 0 : feed.total;
    // 空分类不假装有图：去掉底图与描边，字退到第三档灰
    const empty = key && !n ? " gap" : "";
    return `<button class="cm-tile ${feed.cat === key ? "on" : ""}${empty}" data-c="${esc(key)}"${art}>
      <i>${esc(label)}</i><em>${n}${key ? " 张" : " 件"}</em></button>`;
  };
  const anyTagged = cats.some((c) => (feed.catCounts && feed.catCounts[c]) > 0);
  el.innerHTML = tile("", "全部") + cats.map((c) => tile(c, c)).join("")
    // 全新库里十个分类全是空的：那是"还没人打标签"，不是界面坏了，所以要有一句话说明白
    + (anyTagged ? "" : `<p class="cm-cathint">分类是按发布时填的标签归位的——现在这些作品都还没打标签，所以每一类都是空的。</p>`);
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

async function reload() { feed = { ...feed, offset: 0, rows: [] }; writeFeedUrl(); drawCats(); drawTabs(); $("cmGrid").innerHTML = ""; await loadFeed(true); }

/** 右栏：这一屏没有筛选时才出现。它回答的是"然后呢"——最新的在哪、谁在线、这站是什么。
 *  筛选过的一屏是"我在找东西"，旁边挂一排推荐只会分心，所以整栏收起、列表铺满。 */
function drawSide(plain) {
  const el = $("cmSide");
  if (!el) return;
  const on = !!plain;
  el.hidden = !on;
  root.classList.toggle("has-side", on);
  if (!on) { el.innerHTML = ""; return; }
  const recent = feed.recent || [];
  const online = feed.online || [];
  el.innerHTML = `
    <section class="cm-panel cm-notice">
      <h4>这是什么</h4>
      <p>本机上的一间社区：别人发布的地图、模型和皮肤，点开就能跑。数据全在这台电脑上，没有云端账号。</p>
      <a class="cm-btn sm primary" href="/">去工作台做一张图</a>
    </section>
    ${recent.length ? `<section class="cm-panel"><h4>最新发布</h4>
      <div class="cm-minilist">${recent.map(miniRow).join("")}</div>
      <a class="cm-morelink" href="/community?sort=new">全部新作 →</a></section>` : ""}
    ${online.length ? `<section class="cm-panel"><h4>现在在线 ${online.length}</h4>
      <div class="cm-people">${online.map((u) => `<a href="/u/${encodeURIComponent(u.name)}" title="${esc(u.name)}${u.role === "admin" ? " · 超级管理员" : ""}">${face(u)}<span>${esc(u.name)}</span></a>`).join("")}</div></section>` : ""}`;
}

/** 右栏里的一行：小图 + 两行字。图比字先被看到，所以图必须在左边、且真的是那张作品的封面。 */
function miniRow(p) {
  return `<a class="cm-mini" href="/p/${esc(p.id)}">
    <span class="cm-mini-art">${coverHtml(p)}</span>
    <span class="cm-mini-txt"><b>${esc(p.title)}</b><i>${esc(p.author ? p.author.name : "匿名")} · ${esc(timeAgo(p.created))}</i></span>
  </a>`;
}

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
  feed.catCovers = r.catCovers || {};
  feed.catCounts = r.catCounts || {};
  feed.recent = r.recent || [];
  feed.online = r.online || [];
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
  const hero = plain && byPlays.length ? byPlays[0] : null;
  featHost.innerHTML = hero ? heroHtml(hero) : "";
  /* 精选封面在页面顶上渗出的一层光。官方展厅顶上就有这么一层：
     它让"这一页有内容"在图片还没解码完的时候就已经成立。没有封面就不铺，别拿渐变色假装有图。 */
  const glow = hero ? coverUrl(hero) : "";
  document.documentElement.style.setProperty("--cm-hero", glow ? `url("${glow}")` : "none");
  drawSide(plain);
  // 导轨要在内容够多的时候才有意义：一共三张图还分"大家都在玩"和"全部作品"两遍，是凑版式。
  const rest = plain && byPlays.length > 7 ? byPlays.slice(1, 7) : [];
  railHost.innerHTML = rest.length ? railHtml("大家都在玩", rest, { href: "/community?sort=hot", label: "按热度看" }) : "";
  /** 「继续游玩」用真实的游玩历史，不用 localStorage 里"上次看过哪张"：
   *  前者是"我玩过这些"，后者只是浏览器记得一个 id。没登录就没有历史，这一格整块不出现。 */
  if (plain && auth.me) {
    api("GET", `/api/community/users/${encodeURIComponent(auth.me.name)}/recent`).then((h) => {
      const seen = new Set();
      const rows = (h.rows || []).map((x) => x.pub)
        .filter((p) => p && p.kind === "map" && !seen.has(p.id) && seen.add(p.id)).slice(0, 6);
      if (!rows.length || !document.getElementById("cmRails")) return;
      $("cmContinue").innerHTML = railHtml("继续游玩", rows, { href: "/me", label: "全部记录" });
      bindCards($("cmContinue"));
    }).catch(() => { });
  } else $("cmContinue").innerHTML = "";
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
let detailPoll = null;
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
  const isMap = p.kind !== "model" && p.kind !== "skin";
  root.innerHTML = `<div class="cm-detail">
    <div>
      <section class="cm-hero">
        <div class="pic${p.hasCover ? "" : " none"}"${p.hasCover ? "" : ` style="${coverArt(p)}"`}>${coverHtml(p)}<span class="glyph">${esc((p.title || "?").slice(0, 1))}</span>
          <div class="cap"><h2>${esc(p.title)}</h2><div class="kind">${esc(KIND_NOUN[p.kind] || "地图")} · ${esc(timeAgo(p.created))}发布</div></div>
        </div>
        <div class="meta">
          <div class="cm-statbar">
            <span class="st"><b id="stPlaying">${isMap ? p.playing : "—"}</b><i>正在玩</i></span>
            <span class="st"><b>${p.plays}</b><i>累计进入</i></span>
            <span class="st"><b id="stFav">${p.favs}</b><i>收藏</i></span>
            <span class="st rate">
              <b>${p.rating == null ? "暂无评分" : p.rating + "%"}</b>
              <i>${p.up + p.down ? `${p.up} 顶 / ${p.down} 踩` : "还没有人表过态"}</i>
              ${p.rating == null ? "" : `<span class="bar"><s style="width:${p.rating}%"></s></span>`}
            </span>
          </div>
          <div class="cm-playrow">
            ${p.kind === "skin"
              ? `<button class="cm-btn lg primary" id="cmApply" title="写进你的账号皮肤：进任何一张图都穿着它，别人看你也是">${icons.HEART}应用到我的角色</button>`
              : `<button class="cm-btn lg primary" id="cmPlay" title="游玩前会把这份快照取回本地，作者之后的改动不会跟着进来">${icons.PLAY}${p.kind === "model" ? "下载模型" : "开始游玩"}</button>`}
            ${isMap ? `<button class="cm-btn" id="cmFav" aria-pressed="${p.favByMe ? "true" : "false"}" title="收进我自己的清单，和点赞不是一回事">${p.favByMe ? "★" : "☆"} 收藏</button>` : ""}
            <button class="cm-btn" id="cmShare" title="复制这张图的链接">复制链接</button>
            <span class="cm-vote">
              <button id="cmUp" class="${p.votedByMe === 1 ? "on" : ""}" title="觉得好玩">▲ <b>${p.up}</b></button>
              <button id="cmDown" class="${p.votedByMe === -1 ? "on" : ""}" title="觉得不好玩">▼ <b>${p.down}</b></button>
            </span>
          </div>
          ${p.desc ? `<p class="lead">${esc(p.desc)}</p>` : `<p class="lead none">作者没写简介。进去跑一圈比看文字快。</p>`}
          ${p.tags.length ? `<div class="cm-tags">${p.tags.map((t) => `<span class="cm-tag">${esc(t)}</span>`).join("")}</div>` : ""}
        </div>
      </section>
      <section class="cm-cmts">
        <h3>评论</h3>
        <div id="cmCmtList"></div>
        <div id="cmCompose"></div>
      </section>
      <div id="cmByAuthor"></div>
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
      ${isMap ? `<div class="cm-panel">
        <h4>房间</h4>
        <div class="cm-room">
          <span class="dot${p.playing ? " on" : ""}"></span>
          <b id="rmN">${p.playing}</b><i>/ 24 人</i>
          <span id="rmNote" class="nt">${p.playing ? "里面已经有人了，进去就在同一间" : "现在没人，进去就是第一个"}</span>
        </div>
      </div>` : ""}
      <div class="cm-panel">
        <h4>这张${KIND_NOUN[p.kind] || "地图"}</h4>
        <div class="cm-acts" id="cmPubActs">
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
  /** 看完这张最想做的两件事：再来一张 TA 的（同一个作者的口味是连着的），
   *  或者换一张热门的。顺序就这么排——作者自己的其他图排在通用推荐前面。 */
  if (a) api("GET", `/api/community/users/${encodeURIComponent(a.name)}/pubs`).then((r) => {
    const rows = (r.rows || []).filter((x) => x.id !== p.id).slice(0, 6);
    const host = $("cmByAuthor");
    if (host && rows.length) { host.innerHTML = railHtml(` ${a.name} 的其他作品`.trim(), rows); bindCards(host); }
  }).catch(() => { });
  // 详情页最容易空：看完这张就该有下一张。取热门，排掉自己。
  api("GET", "/api/community/feed?sort=hot&limit=8").then((r) => {
    const rows = (r.rows || []).filter((x) => x.id !== p.id).slice(0, 6);
    const host = $("cmAlso");
    if (host && rows.length) { host.innerHTML = railHtml("接下来试试", rows); bindCards(host); }
  }).catch(() => { });
  const playBtn = $("cmPlay");
  if (playBtn) playBtn.onclick = () => playPub(p);
  /** 分享在本地就只有"复制链接"这一件事：没有社交网络 SDK 可接，
   *  硬造一个分享面板等于把用户推到站外。剪贴板 API 要安全上下文，
   *  非 https 的局域网访问走 execCommand 兜底——复制失败必须说，不能静默。 */
  const share = $("cmShare");
  if (share) share.onclick = async () => {
    const url = location.origin + "/p/" + p.id;
    let done = false;
    try { await navigator.clipboard.writeText(url); done = true; }
    catch {
      const ta = document.createElement("textarea");
      ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { done = document.execCommand("copy"); } catch { done = false; }
      ta.remove();
    }
    toast(done ? "链接已复制：" + url : "复制失败，地址栏里直接复制吧", !done);
  };
  const fav = $("cmFav");
  if (fav) fav.onclick = async () => {
    if (!requireLogin()) return;
    try {
      const r = await api("POST", `/api/community/pubs/${p.id}/favorite`);
      fav.innerHTML = `${r.favByMe ? "★" : "☆"} 收藏`;
      fav.setAttribute("aria-pressed", r.favByMe ? "true" : "false");
      const n = $("stFav"); if (n) n.textContent = r.favs;
    } catch (e) { toast(e.message, true); }
  };
  /** 顶与踩：再点一次同一边就是撤票。好评率与条形条一起改，
   *  不然数字动了、那根条还停在旧比例上，比谁都更像一个坏掉的界面。 */
  const paintVote = (v) => {
    const up = $("cmUp"), down = $("cmDown");
    if (up) { up.classList.toggle("on", v.votedByMe === 1); up.querySelector("b").textContent = v.up; }
    if (down) { down.classList.toggle("on", v.votedByMe === -1); down.querySelector("b").textContent = v.down; }
    const st = document.querySelector(".cm-statbar .rate");
    if (!st) return;
    st.querySelector("b").textContent = v.rating == null ? "暂无评分" : v.rating + "%";
    st.querySelector("i").textContent = v.up + v.down ? `${v.up} 顶 / ${v.down} 踩` : "还没有人表过态";
    // 一票没有时那根条不给：一根空的横杠看起来像"评分是 0%"，而实际上是没人说过话
    let bar = st.querySelector(".bar");
    if (v.rating == null) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("span"); bar.className = "bar";
      bar.appendChild(document.createElement("s"));
      st.appendChild(bar);
    }
    bar.querySelector("s").style.width = v.rating + "%";
  };
  for (const [id, val] of [["cmUp", 1], ["cmDown", -1]]) {
    const b = $(id);
    if (!b) continue;
    b.onclick = async () => {
      if (!requireLogin()) return;
      const want = p.votedByMe === val ? 0 : val;
      try { paintVote(await api("POST", `/api/community/pubs/${p.id}/vote`, { v: want })); p.votedByMe = want; }
      catch (e) { toast(e.message, true); }
    };
  }
  /** 「正在玩」是实时数，页面停着不动就一直是进来那一刻的值。
   *  12 秒一次；换路由时 pubView 开头会清掉上一条，不然看五张图就是五条轮询
   *  在对着自己的本地服务刷。 */
  clearInterval(detailPoll);
  if (isMap) {
    detailPoll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const d2 = await api("GET", "/api/community/pubs/" + id);
        const n = d2.pub.playing;
        const e1 = $("stPlaying"), e2 = $("rmN");
        if (e1) e1.textContent = n;
        if (e2) e2.textContent = n;
        const note = $("rmNote");
        if (note) note.textContent = n ? "里面已经有人了，进去就在同一间" : "现在没人，进去就是第一个";
        const dot = document.querySelector(".cm-room .dot");
        if (dot) dot.classList.toggle("on", !!n);
      } catch { /* 服务停了就停在最后一次读数上，别把整页刷没 */ }
    }, 12000);
  }
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
    const reason = prompt("举报理由（会进入超级管理员的审核队列）");
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
  await loadComments(p.id, p.author?.id);
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

async function loadComments(pubId, authorId) {
  const list = $("cmCmtList"), compose = $("cmCompose");
  if (!list) return;
  let rows = [];
  try { rows = (await api("GET", `/api/community/pubs/${pubId}/comments`)).rows; }
  catch (e) { list.innerHTML = `<p class="cm-hint">${esc(e.message)}</p>`; return; }
  // 一张地图的评论区里，作者那句话的分量不一样，所以要先认得出哪条是他。
  const badge = (c) => authorId && c.author && c.author.id === authorId ? '<em class="op">作者</em>' : "";
  /** 回复是"挂在一条评论上的第二句"，不是新楼层：所以输入框上方留一条引用条，
   *  点的时候看得见自己在回谁，发出去的那条正文里也带着那根线。 */
  let replyTarget = null;
  list.innerHTML = rows.length ? rows.map((c) => `<div class="cm-cmt" data-id="${esc(c.id)}">
      <a href="/u/${encodeURIComponent(c.author.name)}" style="text-decoration:none">${face(c.author)}</a>
      <div class="txt">
        <div class="hd"><a href="/u/${encodeURIComponent(c.author.name)}">${esc(c.author.name)}</a>${badge(c)}<time>${esc(timeAgo(c.ts))}</time></div>
        ${c.reply ? `<span class="quote"><b>${esc(c.reply.name)}</b>：${esc(c.reply.excerpt)}</span>` : ""}
        <p>${esc(c.body)}</p>
        <div class="ops">
          <button data-x="like" class="${c.likedByMe ? "on" : ""}">♥ <span>${c.likes}</span></button>
          ${auth.me && !c.mine ? '<button data-x="reply">回复</button>' : ""}
          ${c.mine ? '<button data-x="del">删除</button>'
            : auth.me ? '<button data-x="report">举报</button>' : ""}
        </div>
      </div>
    </div>`).join("") : `<p class="cm-hint">还没有评论。</p>`;
  for (const el of list.querySelectorAll(".cm-cmt")) {
    const id = el.dataset.id;
    const mine = rows.find((x) => x.id === id);
    const back = el.querySelector('[data-x="reply"]');
    if (back) back.onclick = () => {
      replyTarget = mine || null;
      drawChip();
      const ta = $("cBody");
      if (ta) { ta.focus(); if (!ta.value) ta.placeholder = `回复 ${mine && mine.author ? mine.author.name : ""}…`; }
    };
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
      try { await api("DELETE", `/api/community/pubs/${pubId}/comments/${id}`); await loadComments(pubId, authorId); bumpCount(-1); }
      catch (e) { toast(e.message, true); }
    };
    // 举报评论这条路服务端早就有（docs 的接口表里也写着），前端一直没接：
    // 结果就是地图能举报、评论不能，而评论才是真正会长出脏话的地方。
    const rep = el.querySelector('[data-x="report"]');
    if (rep) rep.onclick = async () => {
      const reason = window.prompt("举报这条评论的理由（会进入超级管理员的审核队列）");
      if (reason == null || !reason.trim()) return;
      try { await api("POST", `/api/community/comments/${id}/report`, { reason: reason.trim().slice(0, 200) }); toast("已提交举报"); }
      catch (e) { toast(e.message, true); }
    };
  }
  function drawChip() {
    const box = $("cReply");
    if (!box) return;
    box.innerHTML = replyTarget
      ? `<div class="cm-replyto">回复 <b>${esc(replyTarget.author ? replyTarget.author.name : "")}</b>：${esc(String(replyTarget.body || "").slice(0, 42))}<button id="cReplyX">取消</button></div>`
      : "";
    const x = $("cReplyX");
    if (x) x.onclick = () => { replyTarget = null; drawChip(); };
  }
  compose.innerHTML = auth.me
    ? `<div class="cm-compose"><div class="grow"><div id="cReply"></div>
        <textarea id="cBody" maxlength="500" placeholder="说点什么（最多 500 字，⌘/Ctrl + Enter 发送）"></textarea></div>
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
      await api("POST", `/api/community/pubs/${pubId}/comments`, { body, replyTo: replyTarget ? replyTarget.id : undefined });
      $("cBody").value = "";
      await loadComments(pubId, authorId); bumpCount(1);
    } catch (e) { toast(e.message, true); }
    finally { send.disabled = false; $("cBody")?.focus(); }
  };
  if (send) $("cBody").onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send.click(); }
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
    // 未登录也给内容，而不是一句"先登录"占满整屏：扩列读的是公开资料，
    // 这一页空着看起来像坏了。
    root.innerHTML = `<div class="cm-rows"><div class="cm-locked">
        <b>登录后才能加好友、发私聊。</b>
        <span>下面这些人是公开的，先看看有没有眼熟的。</span>
        <button class="cm-btn primary" id="fLogin">登录 / 注册</button>
      </div><div id="fBody"></div></div>`;
    $("fLogin").onclick = () => openAuth("login");
    const m = await import("/js/social.js");
    await m.renderPeopleGrid($("fBody"));
    return;
  }
  const [fr, notes] = await Promise.all([api("GET", "/api/community/friends"), api("GET", "/api/community/notifications")]);
  const tab = new URLSearchParams(location.search).get("tab") || "friends";
  const tabs = [["friends", `好友 ${fr.friends.length}`], ["requests", `请求 ${fr.incoming.length + fr.outgoing.length}`],
    ["expand", "扩列"], ["suggested", "可能认识"], ["notes", `通知 ${notes.unread ? "(" + notes.unread + ")" : ""}`]];
  root.innerHTML = `<div class="cm-rows"><div class="cm-tabs">${tabs.map(([k, l]) =>
    `<button class="cm-btn ${k === tab ? "on" : ""}" data-t="${k}">${esc(l)}</button>`).join("")}</div><div id="fBody"></div></div>`;
  for (const b of root.querySelectorAll("[data-t]")) b.onclick = () => {
    const u = new URLSearchParams(location.search); u.set("tab", b.dataset.t);
    history.replaceState(null, "", location.pathname + "?" + u);
    friendsView();
  };
  const body = $("fBody");
  const row = (u, ops, why) => `<div class="cm-row">${face(u)}<div class="grow"><b>${esc(u.name)}</b>
    <div class="sub"><span class="cm-on${u.online ? " on" : ""}">${u.online ? "在线" : "离线"}</span>${esc(u.bio || (u.counts ? u.counts.pubs + " 张发布" : ""))}${why ? ` · ${esc(why)}` : ""}</div></div>${ops}</div>`;
  if (tab === "expand") {
    // 扩列的筛选与卡片全部由 social.js 出：抽屉里那一页与这一页必须是同一份实现，
    // 否则改一处筛选参数就会有一边悄悄失效。
    const m = await import("/js/social.js");
    await m.renderPeopleGrid(body);
    return;
  }
  if (tab === "friends") {
    const ops = (u) => `<button class="cm-btn sm" data-dm="${esc(u.id)}" data-n="${esc(u.note || u.name)}">私聊</button>
      <a class="cm-btn sm" href="/u/${encodeURIComponent(u.name)}">主页</a>
      <button class="cm-btn sm" data-note="${esc(u.name)}">备注</button>
      <button class="cm-btn sm" data-rm="${esc(u.name)}">解除</button>`;
    /** 在线的排前面：这一页问的就是"现在能拉谁一起玩"，
     *  按加入时间排会把三个下线的人挡在第一个能上线的朋友前面。
     *  在线状态给一个点而不是"· 在线"那两个字——扫一眼就知道，不用读。 */
    const sorted = [...fr.friends].sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0)
      || (b.counts ? b.counts.pubs : 0) - (a.counts ? a.counts.pubs : 0));
    body.innerHTML = fr.friends.length ? sorted.map((u) => `<div class="cm-row">${face(u)}
      <div class="grow"><b>${esc(u.note || u.name)}${u.note ? ` <span class="cm-hint" style="display:inline">${esc(u.name)}</span>` : ""}</b>
        <div class="sub"><span class="cm-on${u.online ? " on" : ""}">${u.online ? "在线" : "离线"}</span>${esc(u.bio || (u.counts ? u.counts.pubs + " 张发布" : ""))}</div></div>${ops(u)}</div>`).join("")
      : `<div class="cm-empty">还没有好友。到「扩列」那一页按地区或性格找人，或者从别人主页上加好友。</div>`;
    const so = await import("/js/social.js");
    for (const b of body.querySelectorAll("[data-dm]")) b.onclick = () => so.openDm({ id: b.dataset.dm, name: b.dataset.n });
    for (const b of body.querySelectorAll("[data-note]")) b.onclick = async () => {
      const v = window.prompt("给这个好友起的备注（留空清除）");
      if (v == null) return;
      try { await api("POST", "/api/community/friend/note", { name: b.dataset.note, note: v.slice(0, 20) }); friendsView(); } catch (e) { toast(e.message, true); }
    };
    for (const b of body.querySelectorAll("[data-rm]")) b.onclick = async () => {
      // 抽屉里那条解除是有确认框的，这一页以前点一下就没了：同一件事两处代价不同。
      if (!window.confirm("解除好友关系？私聊记录还会留着。")) return;
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
    /** 这一屏以前只有一列名字 + 一个「关注」，看不出凭什么推荐。
     *  服务端现在会带 mutual（我的好友里有几个人跟了 TA），把它写成一句理由；
     *  同时给「加好友」——会被推荐出来就是因为熟，只让关注是把路走窄了。 */
    body.innerHTML = fr.suggested.length ? fr.suggested.map((u) => row(u,
      `<button class="cm-btn sm" data-fo="${esc(u.name)}">${u.relation && u.relation.following ? "已关注" : "关注"}</button>
       <button class="cm-btn sm primary" data-fr="${esc(u.name)}">加好友</button>`,
      `${u.mutual} 个好友在跟`)).join("")
      : `<div class="cm-empty">暂时没有可推荐的人。加了好友之后这里会出现好友们在关注的人。</div>`;
    for (const b of body.querySelectorAll("[data-fo]")) b.onclick = async () => {
      await api("POST", "/api/community/follow", { name: b.dataset.fo });
      friendsView();
    };
    for (const b of body.querySelectorAll("[data-fr]")) b.onclick = async () => {
      try { await api("POST", "/api/community/friend/request", { name: b.dataset.fr }); toast("好友请求已发出"); }
      catch (e) { toast(e.message, true); }
    };
  } else {
    const KIND = { follow: "关注了你", friend_request: "想加你为好友", friend: "接受了你的好友请求", like: "赞了你的地图", vote: "给这张图表了态", comment: "评论了你的地图", publish: "发布了新地图", restored: "把你的作品重新上架了", renamed: "调整了你的昵称", admin_note: "系统通知" };
    // 一屏通知被看到就算处理完，但页签上那个 (1) 会一直挂着到下次进页面——
    // 所以标记已读之后要顺手把那一格的字改掉，否则读数在说谎。
    const clearBadge = () => {
      const b = root.querySelector('[data-t="notes"]');
      if (b) b.textContent = "通知";
    };
    if (notes.rows.length) api("POST", "/api/community/notifications").then(clearBadge).catch(() => { });
    /** 通知是一条日志，不是一张待办：请求可能早就在「请求」页签里处理掉了。
     *  所以只有还在 pending 里的人才配那两个按钮（否则点下去只会拿到"你们已经是好友了"），
     *  而翻过篇的那条要补一个状态——不然那句"想加你为好友"就是句假话。 */
    const pending = new Set(fr.incoming.map((r) => r.user && r.user.name));
    const friendNames = new Set(fr.friends.map((u) => u.name));
    const label = (n) => {
      // 管理员发的通知是一段自由文本，没有固定句式可套，所以照原文显示。
      if (n.kind === "admin_note") return n.text || "超级管理员通知";
      if (n.kind !== "friend_request") return KIND[n.kind] || n.kind;
      if (n.actor && pending.has(n.actor.name)) return KIND.friend_request;
      return n.actor && friendNames.has(n.actor.name) ? "的好友请求已通过" : "的好友请求已处理";
    };
    body.innerHTML = notes.rows.length ? notes.rows.map((n) => {
      const ops = n.kind === "friend_request" && n.actor && pending.has(n.actor.name)
        ? `<button class="cm-btn sm primary" data-nacc="${esc(n.actor.name)}">接受</button>
           <button class="cm-btn sm" data-ndec="${esc(n.actor.name)}">拒绝</button>`
        : n.pub ? `<a class="cm-btn sm" href="/p/${esc(n.pub.id)}">去看地图</a>`
          : n.actor ? `<a class="cm-btn sm" href="/u/${encodeURIComponent(n.actor.name)}">看主页</a>` : "";
      return `<div class="cm-row">${face(n.actor || {})}
        <div class="grow"><b>${esc(n.actor ? n.actor.name : "系统")}</b><div class="sub">${esc(label(n))} · ${esc(timeAgo(n.ts))}</div></div>${ops}</div>`;
    }).join("")
      : `<div class="cm-empty">还没有通知。</div>`;
    /** 通知里躺着一条好友请求，却要用户先跳去「请求」页签才能处理——
     *  就地给接受/拒绝，处理完这条通知所在的列表也一起变了，所以重跑一次。 */
    const noteAct = (which) => (e) => {
      const name = e.currentTarget.dataset[which];
      api("POST", `/api/community/friend/${which === "nacc" ? "accept" : "decline"}`, { name })
        .then(() => { toast(which === "nacc" ? "已接受" : "已拒绝"); friendsView(); })
        .catch((x) => toast(x.message, true));
    };
    for (const b of body.querySelectorAll("[data-nacc]")) b.onclick = noteAct("nacc");
    for (const b of body.querySelectorAll("[data-ndec]")) b.onclick = noteAct("ndec");
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
  // 这里以前写的是 userView()——那个名字在本文件根本不存在，
  // 于是 /community?mine=1 一点就 ReferenceError，页面停在"读取中"。
  if (new URLSearchParams(location.search).get("mine") && auth.me) {
    return profileView(auth.me.name, root, (x) => (pageTitle.textContent = x), (x) => (pageSub.textContent = x));
  }
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
