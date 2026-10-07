// pubs.js — 社区的可复用部件：卡片、弹层、提示，以及"把发布快照取回本地并开跑"。
//
// 为什么单独一个模块：工作台也要发布、也要游玩社区地图。如果这些函数住在 community.js 里，
// 工作台 import 它就会连带触发社区页的启动逻辑（挂载视图、按路径分派），
// 于是首页莫名多出两个 DOM 依赖，缺一个就整块报错。
import * as auth from "/js/auth.js";
const { api, esc, openAuth } = auth;
/** 图片上传走 fetch 的 body，不走 api()，所以 CSRF 头要自己取。 */
function csrfToken() {
  const m = /(?:^|; )ly_csrf=([^;]+)/.exec(document.cookie || "");
  return m ? decodeURIComponent(m[1]) : "";
}

const $ = (id) => document.getElementById(id);

export const timeAgo = (t) => {
  if (!t) return "—";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + " 秒前";
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
  return new Date(t).toLocaleDateString();
};
export const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : (b || 0) + " B");

// 弹层与提示的宿主：社区页的 HTML 里有，工作台里没有。
// 这个模块要在两处用，所以缺就自己造一个，而不是要求每个页面都预先摆好。
function host(id, cls) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = cls;
    document.body.appendChild(el);
  }
  return el;
}

export function toast(msg, bad = false, ms = 2600) {
  const t = host("cmToast", "cm-toast");
  t.hidden = false; t.textContent = msg; t.classList.toggle("bad", bad);
  clearTimeout(toast._h);
  if (ms) toast._h = setTimeout(() => (t.hidden = true), ms);
}

/* ---------------- 弹层 ---------------- */
export function modal(html, onMount) {
  const box = host("cmModal", "cm-modal");
  box.innerHTML = `<div class="cm-mbox">${html}</div>`;
  box.classList.add("show");
  const close = () => box.classList.remove("show");
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelectorAll('[data-x="cancel"]').forEach((b) => (b.onclick = close));
  onMount && onMount(box.querySelector(".cm-mbox"), close);
  return close;
}

export const face = (u, cls = "") => u && u.avatar && String(u.avatar).startsWith("/") && !u.avatar.startsWith("//")
  ? `<img class="au-face ${cls}" src="${esc(u.avatar)}" alt=""/>`
  : `<span class="au-face au-init ${cls}" style="background:${avatarBg(u && u.name)}">${esc(u && u.name ? [...u.name][0] : "?")}</span>`;
/** 没有头像就是首字缩写：一块中性暖石色，实现与顶栏共用一个（auth.js）。
    以前这里按名字取一段青→紫渐变，于是每个默认头像都是"同一种不同深浅的品牌色"。 */
export const avatarBg = auth.avatarBg;
/** 缺封面时不再画渐变——服务端已经会用这张图自己的体素画一张小地图，
    走到这里说明那张图真的是空的。空的就该看起来是空的：一张没落笔的方格纸。 */
export const coverArt = () => "background-color:#161616;"
  + "background-image:linear-gradient(rgba(255,255,255,.045) 0 1px,transparent 1px),"
  + "linear-gradient(90deg,rgba(255,255,255,.045) 0 1px,transparent 1px);"
  + "background-size:22px 22px";
/** 封面地址单独给一个函数：首页那条"图上渗出来的光"要拿它当背景，不该在别处再拼一次路径。 */
export const coverUrl = (p) => (p && (p.hasCover || p.kind === "model"))
  ? `/api/community/pubs/${p.id}/${p.hasCover ? "cover" : "preview"}` : "";
export const coverHtml = (p) => p.hasCover
  ? `<img src="/api/community/pubs/${p.id}/cover" alt="" loading="lazy" onerror="this.remove()"/>`
  : p.kind === "model"
    ? `<img src="/api/community/pubs/${p.id}/preview" alt="" loading="lazy" onerror="this.remove()"/>`
    : "";
/** 卡片底部那一行计数。图标自己画：字体里的 ★ ♥ 💬 在不同系统上会漂成 emoji，
 *  而漂不漂只有用户看得到，测试抓不到。 */
const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EYE = ico('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>');
const HEART = ico('<path d="M12 20s-7.4-4.6-7.4-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.4 2.4C19.4 15.4 12 20 12 20z"/>');
const CHAT = ico('<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z"/>');
const PLAY = ico('<path d="M8 5.5 19 12 8 18.5z"/>');
const DOWN = ico('<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19h14"/>');
export const icons = { EYE, HEART, CHAT, PLAY, DOWN };
/** 一张作品卡。
 *    骨架照 dao3.fun 的展厅：图占绝对主导，标题压在图下缘的暗色渐变上，
 *    图下面只留作者与计数——眼睛先看到图，再决定点不点。
 *    封面用 contain 而不是 cover：这些图是体素小地图，裁掉一圈就看不出是什么图了；
 *    相框改成 16:10，16:9 的原图放进去只剩一条很窄的边，不再是上下两道大黑带。
 *    浏览量要按人读：41234 → 41.2K。 */
const kfmt = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(1) + "亿";
  if (v >= 1e4) return (v / 1e4).toFixed(2) + "K";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(v);
};
/** 骨架屏：读数据的时候给形状，不给"读取中…"三个字。
 *  一行灰条看不出在等什么，而一屏和真内容同形的灰块，人会先认出"这里将出现什么"。 */
export const skRows = (n = 4) => `<div class="sk-list">${Array.from({ length: n }, () => `<div class="sk-row">
  <span class="sk-img"></span><span class="sk-lines"><span class="sk-line"></span><span class="sk-line sm"></span></span>
</div>`).join("")}</div>`;

/** 出错了要给出路。一句话 + 一个"重试"，而不是把错误原文甩在空白页上。 */
export const errorState = (msg, extra = "") => `<div class="cm-empty">
  <b>没读出来</b>${esc(msg || "服务没回应")}
  <div class="cm-empty-acts"><button class="cm-btn primary" data-retry>重试</button>${extra}</div></div>`;

/** 空态：说清"这里为什么空" + 下一步去哪。空态没有出路，就等于页面坏了。 */
export const emptyState = ({ title = "这里还空着", body = "", action = "" } = {}) =>
  `<div class="cm-empty"><b>${esc(title)}</b>${body ? esc(body) : ""}${action ? `<div>${action}</div>` : ""}</div>`;

/** 卡片：照官方展厅的读法——图占主导，标题落在图下面，而不是压在图上。
 *  压在图上时，亮底封面会把字吃掉，而我们的封面全是服务端拿体素快照画的，
 *  什么底色都有可能。标题单独一行，字才永远读得清。 */
export function cardHtml(p) {
  const isModel = p.kind === "model";
  const isSkin = p.kind === "skin";
  // 卡片是可点的东西，就得能用键盘点到：role/tabindex + Enter，焦点环交给 CSS。
  return `<article class="cm-card" data-id="${esc(p.id)}" role="link" tabindex="0" aria-label="${esc(p.title)}">
    <div class="cm-thumb" ${p.hasCover || isModel ? "" : `style="${coverArt()}"`}>
      ${coverHtml(p)}
      <span class="cm-glyph">${esc((p.title || "?").slice(0, 1))}</span>
      ${isModel ? `<span class="cm-badge">模型</span>` : ""}
      ${isSkin ? `<span class="cm-badge">皮肤</span>` : ""}
      ${p.shape && !isModel && !isSkin ? `<span class="cm-shape">${esc(p.shape.join("×"))}</span>` : ""}
      ${isSkin || isModel ? "" : `<span class="cm-play">${PLAY}</span>`}
    </div>
    <div class="cm-lines">
      <h4 class="cm-title" title="${esc(p.title)}">${esc(p.title)}</h4>
      <div class="cm-author">${face(p.author)}<span>${esc(p.author ? p.author.name : "匿名")}</span></div>
      <div class="cm-views">
        ${isSkin || isModel ? "" : `<span class="now${p.playing ? " on" : ""}" title="现在有几层里有人">${kfmt(p.playing || 0)}</span>`}
        <span title="${isSkin ? "取用" : "游玩"}">${EYE}${kfmt(p.plays)}</span>
        <span title="点赞">${HEART}${kfmt(p.likes)}</span>
        <span title="评论">${CHAT}${kfmt(p.comments)}</span>
        ${p.rating == null ? "" : `<span class="rate" title="${p.up} 顶 / ${p.down} 踩">${p.rating}%</span>`}
      </div>
    </div>
  </article>`;
}

/** 一条横向导轨：标题 + 一行卡片。广场要"逛"起来靠分区，不是一屏平铺到底。 */
export function railHtml(title, rows, { more = "" } = {}) {
  if (!rows || !rows.length) return "";
  return `<section class="cm-rail">
    <header><h3>${esc(title)}</h3>${more ? `<a href="${esc(more.href || "/community")}">${esc(more.label || "查看全部")}</a>` : ""}</header>
    <div class="cm-rail-row">${rows.map(cardHtml).join("")}</div>
  </section>`;
}

/** 精选位：整屏最大的一块，给当前列表里最热的那张。
 *  标题压在图上——这是官方展厅的做法，也是唯一能让人一眼知道"这是什么"的位置。
 *  与我们自己的卡片不同：这里只有一张，底下的暗带可以按它自己那张图压够黑。 */
export function heroHtml(p) {
  if (!p) return "";
  const isModel = p.kind === "model";
  return `<section class="cm-feature" data-id="${esc(p.id)}">
    <div class="cm-feature-art" ${p.hasCover || isModel ? "" : `style="${coverArt()}"`}>
      ${coverHtml(p)}
      <span class="cm-feature-scrim"></span>
      <div class="cm-feature-cap">
        <span class="cm-feature-kicker">${isModel ? "精选模型" : "精选地图"}</span>
        <h2>${esc(p.title)}</h2>
        <div class="cm-author">${face(p.author)}<span>${esc(p.author ? p.author.name : "匿名")}</span>
          <em>· ${esc(timeAgo(p.updated || p.created))}发布</em></div>
        ${p.desc ? `<p>${esc(p.desc).slice(0, 120)}</p>` : `<p class="cm-feature-none">作者没写简介 —— 直接开一局看看是什么。</p>`}
        <div class="cm-feature-acts">
          <button class="cm-btn primary lg" data-play="${esc(p.id)}">${PLAY}${isModel ? "查看模型" : "开始游玩"}</button>
          <a class="cm-btn lg" href="/p/${esc(p.id)}">详情与评论</a>
          <div class="cm-feature-stats">
            <span>${EYE}${kfmt(p.plays)}</span><span>${HEART}${kfmt(p.likes)}</span><span>${CHAT}${kfmt(p.comments)}</span>
            ${p.shape ? `<span>${esc(p.shape.join("×"))}</span>` : ""}
          </div>
        </div>
      </div>
    </div>
  </section>`;
}
/** 卡片与精选位接线。
 *  onPlay 可选：给了就直接开跑（广场的精选位要这样），没给就退回详情页——
 *  主页/工作台那边只有卡片，没有手边的作品对象。 */
export function bindCards(scope, { onPlay } = {}) {
  for (const c of scope.querySelectorAll(".cm-card")) {
    c.onclick = () => (location.href = "/p/" + c.dataset.id);
    c.onkeydown = (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); location.href = "/p/" + c.dataset.id; }
    };
  }
  const art = scope.querySelector(".cm-feature-art");
  const feat = scope.querySelector(".cm-feature");
  if (art && feat) art.onclick = () => (location.href = "/p/" + feat.dataset.id);
  for (const b of scope.querySelectorAll("[data-play]")) b.onclick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (onPlay) onPlay(b.dataset.play, b);
    else location.href = "/p/" + b.dataset.play;
  };
}
/* ---------------- 游玩 / 取回本地 ---------------- */
/** 把社区里的模型取回本机 VOXA 库。
 *  原来模型发布只有"下载 .voxa"一条路：下载完还得自己找到导入入口，对玩家来说这一步等于没有。
 *  同名不覆盖——加序号，因为覆盖掉自己手上的模型比多一个副本糟得多。 */
export async function pullModel(p, btn) {
  if (!auth.me) { openAuth("register"); toast("取回模型要先有个账号"); return; }
  btn.disabled = true;
  try {
    const doc = await (await fetch(`/api/community/pubs/${p.id}/model`)).json();
    if (!doc || !Array.isArray(doc.parts)) throw new Error("这份发布里没有模型内容");
    const have = new Set((((await (await fetch("/api/models")).json()) || {}).models || []).map((m) => m.name));
    const base = String(p.title || "模型").replace(/[\\/\0]/g, "").trim().slice(0, 60) || "模型";
    let name = base;
    for (let i = 2; have.has(name) && i < 60; i++) name = `${base} · ${i}`;
    await api("POST", "/api/models/" + encodeURIComponent(name), Object.assign({}, doc, { name }));
    btn.textContent = "已取回";
    toast(`已取回模型库：${name}`);
  } catch (e) { btn.disabled = false; toast(e.message || "取回失败", true, 4200); }
}
/** 把发布快照落到本地世界：id 固定，重复游玩就是刷新，不会把世界列表塞满。 */
export async function materialize(p, { keep = false } = {}) {
  const wid = "pub" + p.id.slice(0, 16);
  toast("正在取回这份快照…", false, 0);
  try {
    const payload = await (await fetch(`/api/community/pubs/${p.id}/world`)).json();
    payload.meta = payload.meta || {};
    payload.meta.name = (keep ? "社区 · " : "") + p.title;
    payload.meta.community = p.id;
    payload.meta.created = payload.meta.created || Date.now();
    // 快照里的素材引用指向作者本机的路径，改写到本地这份复制品上
    const from = `/assets/worlds/${p.worldId}/`;
    const to = `/assets/worlds/${wid}/`;
    const rewrite = (o) => {
      if (!o || typeof o !== "object") return o;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && v.startsWith(from)) o[k] = to + v.slice(from.length);
        else if (v && typeof v === "object") rewrite(v);
      }
      return o;
    };
    rewrite(payload.meta);   // meta.assetRoot 与各实体身上的 assetRoot 一起改到本地这份复制品
    const files = (await api("GET", `/api/community/pubs/${p.id}/assets`)).files || [];
    for (const f of files) {
      const buf = await (await fetch(`/api/community/pubs/${p.id}/asset?path=${encodeURIComponent(f.path)}`)).arrayBuffer();
      await fetch(`/api/world/${wid}/asset?path=${encodeURIComponent(f.path)}`, { method: "POST", body: buf });
    }
    const r = await fetch(`/api/world/${wid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "保存失败");
    if (!keep) await api("POST", `/api/community/pubs/${p.id}/play`).catch(() => { });
    return { wid, files: files.length };
  } catch (e) {
    toast("取回失败：" + e.message, true, 4200);
    return null;
  }
}

/** 从运行时里"走进一扇门"到一张社区地图：取回快照、记一次游玩、换页。
 *  game.js 那边只认得 id 与标题，而素材路径改写要用作者的 worldId，所以先取一次详情。 */
export async function gotoPub(dest, fromTitle) {
  const d = await (await fetch(`/api/community/pubs/${encodeURIComponent(dest.id)}`)).json().catch(() => null);
  const p = d && d.pub;
  if (!p) throw Object.assign(new Error("那张图取不到了"), { status: "UNKNOWN" });
  const done = await materialize(p);
  if (!done) throw Object.assign(new Error("快照没能取回本地"), { status: "UNKNOWN" });
  const qs = new URLSearchParams({ play: "1", pub: p.id, title: p.title, author: (p.author && p.author.name) || dest.author || "" });
  if (fromTitle) qs.set("from", fromTitle);
  location.href = `/edit/${done.wid}?` + qs;
  return done;
}

export async function playPub(p) {  const btn = $("cmPlay");
  if (btn) btn.disabled = true;
  const done = await materialize(p);
  if (done) {
    toast(`快照已就位（${done.files} 个素材），正在进入…`, false, 1200);
    const qs = new URLSearchParams({ play: "1", pub: p.id, title: p.title, author: (p.author && p.author.name) || "" });
    setTimeout(() => (location.href = `/edit/${done.wid}?` + qs), 500);
  } else if (btn) btn.disabled = false;
}

/* ---------------- 发布对话框（工作台也会 import 这里） ---------------- */
export async function openPublishDialog(world) {
  if (!auth.me) { openAuth("register"); toast("发布要先有个账号"); return; }
  modal(`<h3>发布到社区</h3>
    <label>标题<input id="pTitle" maxlength="60" value="${esc(world.name || "")}"/></label>
    <label>简介<textarea id="pDesc" maxlength="2000" placeholder="这张图玩什么、怎么触发"></textarea></label>
    <label>标签<input id="pTags" placeholder="竞速, 地图, 教程"/></label>
    <label>封面<input id="pCover" type="file" accept="image/png,image/jpeg,image/webp" title="不选就用下面这张按地图全貌渲染的图"/></label>
    <div class="cm-coverbox" id="pCoverBox" hidden>
      <img id="pCoverPrev" alt="封面预览"/>
      <button type="button" class="cm-btn sm" id="pCoverGen">按地图全貌重画一张</button>
    </div>
    <label>更新说明<input id="pNote" maxlength="200" placeholder="这次改了什么"/></label>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="pOk" title="发布的是此刻的快照：体素、脚本、实体与素材整体复制一份，之后再改这张图不会跟着变。">发布</button></div>`,
    async (box, close) => {
      const me = auth.me;
      box.querySelector("#pDesc").placeholder = `作者 ${me.name} · ${world.shape ? world.shape.join("×") : ""}`;
      // 发布这一步是"这张图长什么样"唯一被大量看见的地方。默认不能再交给
      // 服务端那张 2D 小地图（黑底 + 一小块内容），而是当场按全貌渲一张产品照。
      const shot = () => {
        const r = typeof window.__editor?.renderer?.coverShot === "function" ? window.__editor.renderer : null;
        if (!r) return null;
        try { const c = r.coverShot(640, 360); return c ? c.toDataURL("image/png") : null; } catch { return null; }
      };
      let gen = null;
      const coverBox = box.querySelector("#pCoverBox"), prev = box.querySelector("#pCoverPrev");
      const setGen = (url) => { gen = url; prev.src = url; coverBox.hidden = false; };
      const first = shot();
      if (first) setGen(first);
      box.querySelector("#pCoverGen").onclick = () => {
        const url = shot();
        if (url) { setGen(url); toast("已按地图全貌重画"); } else toast("现在这个画面渲不出封面", true);
      };
      // 自己选了图就以选的为准，预览让给用户选的那张
      box.querySelector("#pCover").onchange = (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (f) { const fr = new FileReader(); fr.onload = () => { gen = null; prev.src = String(fr.result); coverBox.hidden = false; }; fr.readAsDataURL(f); }
      };
      box.querySelector("#pOk").onclick = async () => {
        const title = box.querySelector("#pTitle").value.trim();
        if (title.length < 2) return toast("标题至少 2 个字", true);
        const ok = box.querySelector("#pOk");
        ok.disabled = true;
        try {
          let coverUrl = null;
          const f = box.querySelector("#pCover").files[0];
          if (f) {
            const buf = await f.arrayBuffer();
            const up = await fetch("/api/community/upload?kind=cover", {
              method: "POST", headers: { "Content-Type": f.type || "image/png", "X-CSRF-Token": csrfToken() }, body: buf,
            });
            const uj = await up.json().catch(() => null);
            if (!up.ok) throw new Error((uj && uj.error) || "封面上传失败");
            coverUrl = uj.url;
          }
          if (!coverUrl && gen) {
            const blob = await (await fetch(gen)).blob();
            const up = await fetch("/api/community/upload?kind=cover", {
              method: "POST", headers: { "Content-Type": "image/png", "X-CSRF-Token": csrfToken() }, body: blob,
            });
            const uj = await up.json().catch(() => null);
            if (up.ok) coverUrl = uj.url;
          }
          const r = await api("POST", "/api/community/publish", {
            worldId: world.id, title, coverUrl,
            note: box.querySelector("#pNote").value.trim(),
            desc: box.querySelector("#pDesc").value.trim(),
            tags: box.querySelector("#pTags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          });
          close(); toast("已发布到社区");
          setTimeout(() => (location.href = "/p/" + r.pub.id), 600);
        } catch (e) { ok.disabled = false; toast(e.message, true, 4200); }
      };
    });
}
