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
export function hue(s) { let h = 0; for (const c of String(s || "?")) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
/** 头像底色：同一套青→紫，靠名字在带内取位，避免广场变成彩虹。 */
export const avatarBg = (name) => { const h = 196 + (hue(name) % 74); return `linear-gradient(140deg,hsl(${h} 92% 66%),hsl(${h - 30} 84% 55%))`; };
/** 没有封面时也要像被设计过：按发布 id 派生一层渐变 + 细网格，而不是孤零零一个字。
    色相锁在品牌的青→蓝→紫这一段（约 190–285），否则随机色会把广场变成调色盘。 */
export const coverArt = (p) => {
  const h = 190 + (hue(p.id) % 96);
  return `background-image:radial-gradient(120% 90% at 18% 0%,hsl(${h} 82% 26%) 0%,transparent 62%),`
    + `repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 1px,transparent 1px 26px),`
    + `repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 26px),`
    + `linear-gradient(140deg,#12151f,#0d1016 55%,hsl(${(h + 40) % 360} 60% 12%))`;
};
export const coverHtml = (p) => p.hasCover
  ? `<img src="/api/community/pubs/${p.id}/cover" alt="" loading="lazy" onerror="this.remove()"/>`
  : "";
export function cardHtml(p) {
  return `<article class="cm-card" data-id="${esc(p.id)}">
    <div class="cm-cover${p.hasCover ? "" : " none"}" ${p.hasCover ? "" : `style="${coverArt(p)}"`}>${coverHtml(p)}<span class="glyph">${esc((p.title || "?").slice(0, 1))}</span>
      ${p.shape ? `<span class="shape">${esc(p.shape.join("×"))}</span>` : ""}</div>
    <div class="body">
      <h3>${esc(p.title)}</h3>
      <p class="desc">${esc(p.desc || "")}</p>
      ${p.tags && p.tags.length ? `<div class="cm-tags">${p.tags.map((t) => `<span class="cm-tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="foot">
        <span class="who">${face(p.author)}${esc(p.author ? p.author.name : "匿名")}</span>
        <span class="st"><span title="游玩">${p.plays}</span><span title="点赞">♥${p.likes}</span><span title="评论">✎${p.comments}</span></span>
      </div>
    </div>
  </article>`;
}
export function bindCards(scope) {
  for (const c of scope.querySelectorAll(".cm-card")) c.onclick = () => (location.href = "/p/" + c.dataset.id);
}
/* ---------------- 游玩 / 取回本地 ---------------- */
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

export async function playPub(p) {
  const btn = $("cmPlay");
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
    <p class="cm-hint">发布的是<b>此刻的快照</b>：体素、脚本、实体与引用的素材会整体复制一份，之后你再改这张图，社区里那份不会跟着变。</p>
    <label>标题<input id="pTitle" maxlength="60" value="${esc(world.name || "")}"/></label>
    <label>简介<textarea id="pDesc" maxlength="2000" placeholder="这张图玩什么、怎么触发、有什么坑"></textarea></label>
    <label>标签（逗号分隔，最多 6 个）<input id="pTags" placeholder="竞速, 地图, 教程"/></label>
    <label>封面（不选就用编辑器截图；都没有就用生成的色块）
      <input id="pCover" type="file" accept="image/png,image/jpeg,image/webp"/></label>
    <label>更新说明（再发一次同一张图时写进版本历史）<input id="pNote" maxlength="200" placeholder="加了两个检查点"/></label>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="pOk">发布</button></div>`,
    async (box, close) => {
      const me = auth.me;
      box.querySelector("#pDesc").placeholder = `作者 ${me.name} · ${world.shape ? world.shape.join("×") : ""}`;
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
