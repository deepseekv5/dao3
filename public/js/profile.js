// profile.js — 个人主页：横幅、头像、昵称、简介、皮肤，以及三种作品列表。
//
// 皮肤为什么在账号上而不是地图里：角色外观是"我是谁"，不是"这张图长什么样"，
// 换图、进别人发的图都应该带着走。运行时会读 auth.me.skin 贴到人偶上。
import * as auth from "/js/auth.js";
import { cardHtml, bindCards, face, hue } from "/js/pubs.js";

const { api, esc } = auth;
const $ = (id) => document.getElementById(id);
const timeAgo = (t) => {
  if (!t) return "—";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
  return new Date(t).toLocaleDateString();
};

const SKIN_DEFAULT = { skin: "#ffd7b0", shirt: "#5aa8e8", pants: "#5b6c8e", hair: "#6b4630", shoe: "#7b5441" };
const SKIN_PARTS = [
  ["shirt", "上衣"], ["pants", "裤子"], ["skin", "皮肤"], ["hair", "头发"], ["shoe", "鞋子"],
];
const SWATCHES = ["#5aa8e8", "#e8604c", "#4ecb8d", "#f2c14e", "#a06bff", "#ff7ab8", "#2f3b52", "#e8e6e1", "#6b4630", "#12b5c9"];

/** 纯 CSS 的角色预览：不为了看个配色就把 three.js 拖进社区页。 */
function previewHtml(skin) {
  const src = skin || {};
  // 颜色要进 style 属性，`red;background:url(...)` 这种值就能改写样式：
  // 只认 #rrggbb，其它一律退回默认色。
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : d);
  const c = {
    skin: hex(src.skin, SKIN_DEFAULT.skin), shirt: hex(src.shirt, SKIN_DEFAULT.shirt),
    pants: hex(src.pants, SKIN_DEFAULT.pants), hair: hex(src.hair, SKIN_DEFAULT.hair),
    shoe: hex(src.shoe, SKIN_DEFAULT.shoe),
  };
  return `<div class="pf-doll" aria-hidden="true">
    <i class="d-hair" style="background:${esc(c.hair)}"></i>
    <i class="d-head" style="background:${esc(c.skin)}"></i>
    <i class="d-torso" style="background:${esc(c.shirt)}"></i>
    <i class="d-arm l" style="background:${esc(c.shirt)}"></i><i class="d-arm r" style="background:${esc(c.shirt)}"></i>
    <i class="d-leg l" style="background:${esc(c.pants)}"></i><i class="d-leg r" style="background:${esc(c.pants)}"></i>
    <i class="d-foot l" style="background:${esc(c.shoe)}"></i><i class="d-foot r" style="background:${esc(c.shoe)}"></i>
  </div>`;
}

async function uploadImage(file, kind) {
  const buf = await file.arrayBuffer();
  const headers = { "Content-Type": file.type || "image/png" };
  if (auth.me) headers["X-CSRF-Token"] = (await api("GET", "/api/community/me")).csrf || "";
  const res = await fetch("/api/community/upload?kind=" + kind, { method: "POST", headers, body: buf, credentials: "same-origin" });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error) || "上传失败");
  return j.url;
}

/** 把一段我们自己生成的 HTML 变成节点（不是用户输入，但也不走 outerHTML 注入）。 */
function fragmentFirst(html) {
  const t2 = document.createElement("template");
  t2.innerHTML = html.trim();
  return t2.content.firstChild;
}

/* ---------------- 编辑资料 ---------------- */
function openEditor(u, onSaved) {
  const box = $("cmModal");
  const skin = Object.assign({}, SKIN_DEFAULT, u.skin || {});
  box.innerHTML = `<div class="cm-mbox pf-edit">
    <h3>编辑资料</h3>
    <div class="pf-cols">
      <div>
        <label>昵称<input id="eName" maxlength="20" value="${esc(u.name)}"/></label>
        <label>简介<textarea id="eBio" maxlength="200">${esc(u.bio || "")}</textarea></label>
        <div class="pf-up">
          <label class="pf-file">头像<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="eAvatar"/></label>
          <label class="pf-file">横幅<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="eBanner"/></label>
          <span class="pf-hint">图片最大 3 MB，只存本机</span>
        </div>
      </div>
      <div>
        <h4>角色皮肤</h4>
        <div class="pf-skinrow">
          ${previewHtml(skin)}
          <div class="pf-swatches" id="eSkin"></div>
        </div>
        <p class="pf-hint">配色会带进每一张你游玩的地图；模型皮肤请在 VOXA 里发布后选择。</p>
      </div>
    </div>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="eSave">保存</button></div>
  </div>`;
  box.classList.add("show");
  const close = () => box.classList.remove("show");
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('[data-x="cancel"]').onclick = close;

  let active = "shirt";
  const draft = Object.assign({}, skin);
  const paintSwatches = () => {
    const host = box.querySelector("#eSkin");
    host.innerHTML = SKIN_PARTS.map(([k, label]) =>
      `<div class="pf-part ${k === active ? "on" : ""}" data-p="${k}"><span style="background:${esc(draft[k])}"></span>${esc(label)}</div>`).join("")
      + `<div class="pf-pal">${SWATCHES.map((c) => `<button class="pf-c" data-c="${c}" style="background:${c}"></button>`).join("")}
         <label class="pf-c pf-custom" title="自定义颜色"><input type="color" id="eCustom" value="${esc(draft[active])}"/></label></div>`;
    for (const b of host.querySelectorAll("[data-p]")) b.onclick = () => { active = b.dataset.p; paintSwatches(); };
    for (const b of host.querySelectorAll("[data-c]")) b.onclick = () => { draft[active] = b.dataset.c; paintSwatches(); };
    const custom = host.querySelector("#eCustom");
    if (custom) custom.oninput = () => { draft[active] = custom.value; paintSwatches(); };
    const doll = box.querySelector(".pf-doll");
    if (doll) doll.replaceWith(fragmentFirst(previewHtml(draft)));
  };
  paintSwatches();

  for (const [id, kind] of [["eAvatar", "avatar"], ["eBanner", "banner"]]) {
    box.querySelector("#" + id).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const url = await uploadImage(f, kind);
        const r = await api("PATCH", "/api/community/me", { [kind]: url });
        auth.setMe(r.user);
        // 传完就让人看到：底下的主页立刻重绘，否则要等"保存"才刷新，像是没传上去。
        onSaved && onSaved(r.user);
        box.querySelector("#" + id).replaceWith(Object.assign(document.createElement("span"), {
          className: "pf-ok", textContent: (kind === "avatar" ? "头像" : "横幅") + "已更新",
        }));
      } catch (err) { alert(err.message); }
    };
  }
  box.querySelector("#eSave").onclick = async () => {
    const btn = box.querySelector("#eSave");
    btn.disabled = true;
    try {
      const r = await api("PATCH", "/api/community/me", {
        name: box.querySelector("#eName").value.trim(),
        bio: box.querySelector("#eBio").value.trim(),
        skin: draft,
      });
      auth.setMe(r.user);
      close(); onSaved && onSaved(r.user);
    } catch (e) { btn.disabled = false; alert(e.message); }
  };
}

/* ---------------- 页面 ---------------- */
export async function profileView(name, root, setTitle, setSub) {
  let d;
  try { d = await api("GET", "/api/community/users/" + encodeURIComponent(name)); }
  catch (e) { root.innerHTML = `<div class="cm-empty"><b>${esc(e.message)}</b><a href="/community">回广场</a></div>`; return; }
  const u = d.user;
  const mine = !!(auth.me && auth.me.id === u.id);
  const c = u.counts || {};
  setTitle(u.name);
  setSub(u.bio || "这个人还没写简介");
  const banner = u.banner
    ? `<img src="${esc(u.banner)}" alt=""/>`
    : "";
  const bstyle = u.banner ? "" : `style="background-image:radial-gradient(120% 90% at 16% 0%,hsl(${190 + (hue(u.id) % 90)} 80% 30%),transparent 60%),linear-gradient(120deg,#101726,#1a1330)"`;
  root.innerHTML = `<div class="pf-wrap">
    <div class="pf-banner" ${bstyle}>${banner}</div>
    <div class="pf-head">
      <div class="pf-avatar">${face(u)}</div>
      <div class="pf-id">
        <h2>${esc(u.name)}${u.role === "admin" ? '<span class="pf-role">管理员</span>' : ""}</h2>
        <p class="pf-bio">${esc(u.bio || "")}</p>
        <p class="pf-meta">加入于 ${esc(new Date(u.createdAt).toLocaleDateString())} · ${c.pubs || 0} 张发布 · ${c.friends || 0} 好友 · ${c.followers || 0} 关注者</p>
      </div>
      <div class="pf-acts" id="pfActs"></div>
    </div>
    <div class="cm-tabs" id="pfTabs">
      <button class="cm-btn on" data-t="map">地图</button>
      <button class="cm-btn" data-t="model">模型</button>
      <button class="cm-btn" data-t="followers">关注者</button>
      <button class="cm-btn" data-t="following">关注中</button>
      <button class="cm-btn" data-t="recent">最近游玩</button>
    </div>
    <div id="pfBody"></div>
  </div>`;

  const acts = $("pfActs");
  if (mine) {
    acts.innerHTML = `<button class="cm-btn primary" id="pfEdit">编辑资料</button>
      ${auth.me.role === "admin" ? '<a class="cm-btn" href="/admin">管理后台</a>' : ""}`;
    acts.querySelector("#pfEdit").onclick = () => openEditor(u, (nu) => profileView(nu.name, root, setTitle, setSub));
  } else {
    const rel = u.relation || {};
    acts.innerHTML = `<button class="cm-btn ${rel.following ? "" : "primary"}" id="pfFollow">${rel.following ? "已关注" : "关注"}</button>
      <button class="cm-btn" id="pfFriend">${rel.friend ? "已是好友" : rel.pendingOut ? "等待回应" : rel.pendingIn ? "接受好友请求" : "加好友"}</button>`;
    acts.querySelector("#pfFollow").onclick = async () => {
      if (!auth.me) return auth.openAuth("login");
      const r = await api("POST", "/api/community/follow", { name: u.name });
      acts.querySelector("#pfFollow").textContent = r.following ? "已关注" : "关注";
      acts.querySelector("#pfFollow").classList.toggle("primary", !r.following);
    };
    acts.querySelector("#pfFriend").onclick = async () => {
      if (!auth.me) return auth.openAuth("login");
      try {
        await api("POST", `/api/community/friend/${rel.pendingIn ? "accept" : "request"}`, { name: u.name });
        profileView(name, root, setTitle, setSub);
      } catch (e) { alert(e.message); }
    };
  }

  const tabs = $("pfTabs"), body = $("pfBody");
  async function show(which) {
    for (const b of tabs.querySelectorAll("[data-t]")) b.classList.toggle("on", b.dataset.t === which);
    body.innerHTML = `<div class="cm-empty">读取中…</div>`;
    if (which === "recent") {
      const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/recent`)).rows;
      body.innerHTML = rows.length ? `<div class="pf-recent">${rows.map((h) => `<a class="pf-rrow" href="/p/${esc(h.pubId)}">
        <span class="pf-rtitle">${esc(h.pub.title)}</span><span class="pf-rmeta">${esc(h.pub.author ? h.pub.author.name : "")} · ${esc(timeAgo(h.ts))}${h.count > 1 ? " · 玩过 " + h.count + " 次" : ""}</span></a>`).join("")}</div>`
        : `<div class="cm-empty">还没有游玩记录。</div>`;
      return;
    }
    if (which === "followers" || which === "following") {
      const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/${which}`)).rows;
      body.innerHTML = rows.length ? `<div class="cm-rows">${rows.map((x) => `<div class="cm-row">${face(x)}
        <div class="grow"><b>${esc(x.name)}</b><div class="sub">${esc(x.bio || "")}</div></div>
        <a class="cm-btn sm" href="/u/${encodeURIComponent(x.name)}">主页</a></div>`).join("")}</div>`
        : `<div class="cm-empty">${which === "followers" ? "还没有人关注这个人。" : "这个人还没关注谁。"}</div>`;
      return;
    }
    const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/pubs?kind=${which}`)).rows;
    body.innerHTML = rows.length ? `<div class="cm-grid">${rows.map(cardHtml).join("")}</div>`
      : `<div class="cm-empty"><b>${which === "model" ? "还没有发布模型" : "还没有发布地图"}</b>${mine ? (which === "model" ? "在 VOXA 里点「发布到社区」。" : "打开工作台，把这张图发出去。") : ""}</div>`;
    bindCards(body);
  }
  for (const b of tabs.querySelectorAll("[data-t]")) b.onclick = () => show(b.dataset.t);
  await show("map");
}
export { previewHtml, SKIN_DEFAULT };
