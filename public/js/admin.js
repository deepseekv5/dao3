// admin.js — 管理后台：概览走势、举报队列、内容审核（作品+评论）、用户管理、审计日志。
// 所有动作打的是 /api/community/admin/*，服务端会再查一次角色；
// 前端藏按钮只是体验，不是权限。
import * as auth from "/js/auth.js";
import { toast, skRows } from "/js/pubs.js";

const { api, esc, mountAuth, openAuth } = auth;
const $ = (id) => document.getElementById(id);
const root = $("adRoot");
const sub = $("adSub");

const timeAgo = (t) => {
  if (!t) return "—";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
  return new Date(t).toLocaleDateString();
};
const dt = (t) => (t ? new Date(t).toLocaleString() : "—");
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : (b || 0) + " B");
const KIND_CN = { map: "地图", model: "模型", skin: "皮肤" };
const ACT_CN = { role: "改角色", ban: "封禁", unban: "解封", takedown: "下架", restore: "恢复上架", flag: "标记",
  purge: "删除作品", comment_delete: "删评论", rename: "改昵称", reset: "清资料", delete_user: "注销账号",
  sessions: "踢下线", note: "发通知", batch_ban: "批量封禁", batch_unban: "批量解封", batch_role: "批量改角色",
  batch_sessions: "批量踢下线", batch_flag_off: "批量取消标记" };

const TABS = [["ov", "概览"], ["reports", "举报队列"], ["content", "内容审核"], ["users", "用户"], ["audit", "审计日志"]];

let data = null;                        // overview，一次拉取、各 tab 共用
let tab = "ov";
const picked = new Set();               // 用户 tab 的批量勾选
const uf = { q: "", only: "", sort: "new", dir: "desc" };
const cf = { q: "", state: "live", kind: "" };
const cc = { q: "", filter: "" };
const af = { q: "", action: "" };
const rf = { state: "open" };
const store = { users: null, pubs: null, comments: null, audit: null, reports: null, flagged: null };

async function load(keepTab) {
  if (!auth.me) {
    root.innerHTML = `<div class="cm-empty"><b>先登录</b>后台只放行超级管理员。<button class="cm-btn primary" id="adLogin" style="margin-top:12px">登录</button></div>`;
    $("adLogin").onclick = () => openAuth("login");
    return;
  }
  try { data = await api("GET", "/api/community/admin/overview"); }
  catch (e) {
    root.innerHTML = `<div class="cm-empty"><b>进不去</b>${esc(e.message)}<br>当前账号「${esc(auth.me.name)}」不是超级管理员。第一个注册的账号会自动成为超级管理员。</div>`;
    return;
  }
  // 列表数据是分开拉的，动作之后要作废缓存，否则切回上一个 tab 看到的是旧表。
  for (const k of Object.keys(store)) store[k] = null;
  if (!keepTab) picked.clear();
  sub.textContent = `${data.totals.users} 个账号 · ${data.totals.pubs} 件作品 · ${data.reports.length} 条待处理 · ${data.online} 人在线`;
  draw();
}

/* ---------------- 骨架 ---------------- */
function draw() {
  const t = data.totals;
  const fl = data.flagged || { pubs: 0, comments: 0 };
  const badge = { ov: "", reports: data.reports.length || "", content: (fl.pubs || 0) + (fl.comments || 0) || "", users: "", audit: "" };
  root.innerHTML = `
    <div class="ad-cards">
      <div><b>${t.users}</b><em>账号</em><i>${data.banned || 0} 个被封 · ${data.online || 0} 人在线</i></div>
      <div><b>${t.pubs}</b><em>在线作品</em><i>${t.models} 模型 · ${t.skins || 0} 皮肤 · ${t.removed || 0} 已下架</i></div>
      <div><b>${t.plays}</b><em>游玩次数</em></div>
      <div><b>${t.comments}</b><em>评论</em></div>
      <div><b>${data.reports.length}</b><em>待处理举报</em><i>已处理 ${data.reportsHandled || 0}</i></div>
      <div><b>${kb(t.bytes)}</b><em>快照体积</em></div>
      <div><b>${(fl.pubs || 0) + (fl.comments || 0)}</b><em>被标记内容</em><i>进队列等人看</i></div>
    </div>
    <div class="cm-tabs">
      ${TABS.map(([k, label]) => `<button class="cm-btn ${tab === k ? "on" : ""}" data-t="${k}">${label}${badge[k] ? ` ${badge[k]}` : ""}</button>`).join("")}
    </div>
    <div id="adBody"></div>`;
  for (const b of root.querySelectorAll("[data-t]")) b.onclick = () => { tab = b.dataset.t; draw(); };
  const body = $("adBody");
  if (tab === "ov") drawOv(body);
  else if (tab === "reports") drawReports(body);
  else if (tab === "content") drawContent(body);
  else if (tab === "users") drawUsers(body);
  else drawAudit(body);
}

/* ---------------- 概览：14 天走势 + 全体通知 ---------------- */
function spark(series) {
  const keys = ["users", "pubs", "comments"];
  const cn = { users: "新注册", pubs: "新发布", comments: "新评论" };
  const col = { users: "var(--primary)", pubs: "var(--warn)", comments: "var(--ok)" };
  const w = 640, h = 84, base = h - 16;
  const max = Math.max(1, ...series.flatMap((s) => keys.map((k) => s[k] || 0)));
  const step = (w - 8) / series.length;
  let bars = "";
  series.forEach((s, i) => {
    keys.forEach((k, j) => {
      const v = s[k] || 0;
      const bh = Math.round((v / max) * (base - 4));
      bars += `<rect x="${(4 + i * step + j * (step / 3) + 1).toFixed(1)}" y="${base - bh}" width="${Math.max(2, step / 3 - 2).toFixed(1)}" height="${bh}" fill="${col[k]}" opacity="${v ? ".9" : ".22"}"><title>${s.day} · ${cn[k]} ${v}</title></rect>`;
    });
  });
  let axis = "";
  series.forEach((s, i) => {
    if (i % 3 && i !== series.length - 1) return;
    axis += `<text x="${(4 + i * step + step / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="9" fill="var(--fg3)">${s.day}</text>`;
  });
  const sum = keys.map((k) => `<b style="color:${col[k]}">${series.reduce((a, s) => a + (s[k] || 0), 0)}</b> ${cn[k]}`).join(" · ");
  return `<div class="ad-spark">
    <div class="hd"><b>近 14 天</b><span>${sum}</span></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}" role="img" aria-label="近 14 天注册、发布与评论的走势">
      <line x1="4" y1="${base}" x2="${w - 4}" y2="${base}" stroke="var(--line2)"/>${bars}${axis}
    </svg>
    <div class="sub">纵条按天落桶；峰值看悬停。注册/发布/评论是精确计数，不是估算。</div>
  </div>`;
}

function drawOv(body) {
  const top = data.users.slice().sort((a, b) => b.pubsAll - a.pubsAll).slice(0, 5);
  body.innerHTML = `
    ${spark(data.series || [])}
    <div class="ad-two">
      <div class="ad-card">
        <div class="hd"><b>作品最多的账号</b><a class="cm-btn sm" data-goto="users">去用户页</a></div>
        ${top.length ? `<table class="ad-table"><tbody>${top.map((u) => `<tr>
          <td><a href="/u/${encodeURIComponent(u.name)}">${esc(u.name)}</a>${u.role === "admin" ? `<span class="ad-tag">超级管理员</span>` : ""}</td>
          <td class="num">${u.pubsAll} 件</td><td class="num">${kb(u.bytes)}</td><td class="num">${u.comments} 评论</td></tr>`).join("")}</tbody></table>`
      : `<div class="cm-empty">还没有人发过作品。</div>`}
      </div>
      <div class="ad-card">
        <div class="hd"><b>发一条系统通知</b></div>
        <div class="ad-note">
          <textarea id="adNoteText" maxlength="200" placeholder="会作为「系统通知」出现在对方的通知列表里。写给全体时别写只有一个人看得懂的话。"></textarea>
          <div class="row">
            <input id="adNoteName" placeholder="留空 = 发给全体（不含被封号的人）" maxlength="24"/>
            <button class="cm-btn primary sm" id="adNoteSend">发送</button>
          </div>
          <div class="sub">全体发送前会确认一次；通知不留撤回，所以发出去的就是发出去了。</div>
        </div>
      </div>
    </div>`;
  body.querySelector("[data-goto]").onclick = () => { tab = "users"; draw(); };
  $("adNoteSend").onclick = () => {
    const text = $("adNoteText").value.trim();
    if (!text) return toast("通知内容还空着", true);
    const who = $("adNoteName").value.trim();
    if (!who && !window.confirm("这会发给全体账号，确定？")) return;
    api("POST", "/api/community/admin/note", who ? { name: who, text } : { all: true, text })
      .then((r) => { toast(`已发给 ${r.sent} 人`); $("adNoteText").value = ""; })
      .catch((e) => toast(e.message, true));
  };
}

/* ---------------- 举报队列 ---------------- */
async function drawReports(body) {
  body.innerHTML = `<div class="ad-bar">
    ${[["open", "待处理"], ["resolved", "已处理"], ["dismissed", "已忽略"], ["all", "全部"]].map(([k, l]) =>
    `<button class="cm-btn sm ${rf.state === k ? "on" : ""}" data-rs="${k}">${l}</button>`).join("")}
    <span class="grow"></span>
    <button class="cm-btn sm" id="rpRefresh">刷新</button>
  </div><div id="rpBody">${skRows(6)}</div>`;
  for (const b of body.querySelectorAll("[data-rs]")) b.onclick = () => { rf.state = b.dataset.rs; drawReports(body); };
  $("rpRefresh").onclick = () => { store.reports = null; drawReports(body); };
  if (!store.reports) { try { store.reports = await api("GET", `/api/community/admin/reports?state=${rf.state}`); } catch (e) { $("rpBody").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; } }
  const d = store.reports;
  const host = $("rpBody");
  host.innerHTML = `<div class="ad-count">${d.rows.length} / ${d.total} 条 · 待处理 ${d.counts.open} · 已处理 ${d.counts.resolved} · 已忽略 ${d.counts.dismissed}</div>`
    + (d.rows.length ? d.rows.map((r) => `<div class="ad-row">
      <div class="grow"><b>${esc(r.targetType === "comment" ? "评论" : "作品")} · ${esc(r.ownerName)}</b>
        <div class="sub">${esc(r.excerpt || "（无摘要）")}</div>
        <div class="sub">理由：${esc(r.reason || "未填写")} · 由 ${esc(r.byName)} 举报 · ${esc(timeAgo(r.ts))}
          ${r.state !== "open" ? ` · ${esc(r.handledByName ? r.handledByName + " 处理" : "")}${esc(timeAgo(r.handledAt))}` : ""}</div></div>
      ${r.pubId ? `<a class="cm-btn sm" href="/p/${esc(r.pubId)}">看作品</a>` : ""}
      ${r.state === "open" ? `<button class="cm-btn sm" data-dismiss="${esc(r.id)}">忽略</button>
        <button class="cm-btn sm danger" data-resolve="${esc(r.id)}">处理并删内容</button>` : ""}
    </div>`).join("") : `<div class="cm-empty">这个状态下没有举报。</div>`);
  const act = (key, action) => (e) => {
    // 这颗按钮现在真的会动内容（删评论 / 下架作品），所以先要人确认一次。
    if (key === "resolve" && !window.confirm("这会连内容一起处理：评论直接删，作品下架。确定？")) return;
    const id = e.currentTarget.dataset[key];
    api("POST", `/api/community/admin/report/${id}`, { action, remove: key === "resolve" })
      .then(() => { toast("已处理"); store.reports = null; load(true); }).catch((x) => toast(x.message, true));
  };
  for (const b of host.querySelectorAll("[data-dismiss]")) b.onclick = act("dismiss", "dismiss");
  for (const b of host.querySelectorAll("[data-resolve]")) b.onclick = act("resolve", "resolve");
}

/* ---------------- 内容审核：作品 + 评论 + 被标记 ---------------- */
async function drawContent(body) {
  const ct = store.contentTab || "pubs";
  store.contentTab = ct;
  body.innerHTML = `<div class="ad-seg">
    ${[["pubs", "作品"], ["comments", "评论"], ["flagged", "被标记 " + (data.flagged ? data.flagged.pubs + data.flagged.comments : 0)]].map(([k, l]) =>
    `<button class="cm-btn sm ${ct === k ? "on" : ""}" data-ct="${k}">${l}</button>`).join("")}
  </div><div id="ctBody">${skRows(6)}</div>`;
  for (const b of body.querySelectorAll("[data-ct]")) b.onclick = () => { store.contentTab = b.dataset.ct; drawContent(body); };
  const host = $("ctBody");
  const t = ct;

  if (t === "pubs") {
    host.innerHTML = `<div class="ad-bar">
      <input id="ctQ" placeholder="搜标题、简介或作者" value="${esc(cf.q)}"/>
      ${[["live", "在线"], ["removed", "已下架"], ["all", "全部"]].map(([k, l]) => `<button class="cm-btn sm ${cf.state === k ? "on" : ""}" data-st="${k}">${l}</button>`).join("")}
      ${[["", "所有类型"], ["map", "地图"], ["model", "模型"], ["skin", "皮肤"]].map(([k, l]) => `<button class="cm-btn sm ${cf.kind === k ? "on" : ""}" data-kd="${k}">${l}</button>`).join("")}
      <span class="grow"></span><button class="cm-btn sm" id="ctGo">查询</button></div><div id="ctRows"></div>`;
    const run = () => { store.pubs = null; drawContent(body); };
    $("ctGo").onclick = () => { cf.q = $("ctQ").value.trim(); run(); };
    $("ctQ").onkeydown = (e) => { if (e.key === "Enter") { cf.q = e.target.value.trim(); run(); } };
    for (const b of host.querySelectorAll("[data-st]")) b.onclick = () => { cf.state = b.dataset.st; run(); };
    for (const b of host.querySelectorAll("[data-kd]")) b.onclick = () => { cf.kind = b.dataset.kd; run(); };
    if (!store.pubs) { try { store.pubs = await api("GET", `/api/community/admin/pubs?state=${cf.state}&kind=${cf.kind}&q=${encodeURIComponent(cf.q)}`); } catch (e) { $("ctRows").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; } }
    const d = store.pubs;
    $("ctRows").innerHTML = `<div class="ad-count">${d.rows.length} / ${d.total} 件</div>` + (d.rows.length ? `<table class="ad-table">
      <thead><tr><th>作品</th><th>作者</th><th>状态</th><th class="num">版本</th><th class="num">游玩</th><th class="num">评论</th><th class="num">体积</th><th>更新</th><th></th></tr></thead>
      <tbody>${d.rows.map((p) => `<tr class="${p.flagged ? "flag" : ""}">
        <td><a href="/p/${esc(p.id)}">${esc(p.title)}</a><div class="sub">${KIND_CN[p.kind] || p.kind}${p.status !== "live" && p.removedBy ? ` · 由 ${esc(p.removedBy)} 下架` : ""}</div></td>
        <td><a href="/u/${encodeURIComponent(p.authorName)}">${esc(p.authorName)}</a></td>
        <td>${p.status === "live" ? "在线" : "已下架"}${p.flagged ? `<span class="ad-tag warn">待审</span>` : ""}</td>
        <td class="num">v${p.version}${p.versions ? ` <span class="sub">归档 ${p.versions}</span>` : ""}</td>
        <td class="num">${p.plays}</td><td class="num">${p.comments}</td><td class="num">${kb(p.bytes)}</td>
        <td class="sub">${esc(timeAgo(p.updated))}</td>
        <td class="ops">
          ${p.status === "live"
      ? `<button class="cm-btn sm" data-flag="${esc(p.id)}" data-on="${p.flagged ? 0 : 1}">${p.flagged ? "取消标记" : "标记"}</button>
               <button class="cm-btn sm danger" data-down="${esc(p.id)}">下架</button>`
      : `<button class="cm-btn sm primary" data-up="${esc(p.id)}">恢复上架</button>`}
          <button class="cm-btn sm danger" data-purge="${esc(p.id)}">删干净</button>
        </td></tr>`).join("")}</tbody></table>` : `<div class="cm-empty">没有符合条件的作品。</div>`);
    const after = (msg) => () => { toast(msg); store.pubs = null; drawContent(body); };
    for (const b of host.querySelectorAll("[data-down]")) b.onclick = () => {
      if (!window.confirm("下架这件作品？作者会收到通知，作品从广场消失但文件保留。")) return;
      api("POST", "/api/community/admin/takedown", { pubId: b.dataset.down })
        // 刚下架的东西切到「已下架」那一栏给你看：留在"在线"筛选里它就直接从眼前消失，
        // 看上去像按钮把行吃掉了，而不是"它换了一栏"。
        .then(() => { cf.state = "removed"; store.pubs = null; load(true); }).catch((e) => toast(e.message, true));
    };
    for (const b of host.querySelectorAll("[data-up]")) b.onclick = () => {
      api("POST", "/api/community/admin/restore", { pubId: b.dataset.up })
        .then(() => { cf.state = "live"; store.pubs = null; load(true); }).catch((e) => toast(e.message, true));
    };
    for (const b of host.querySelectorAll("[data-flag]")) b.onclick = () => {
      api("POST", "/api/community/admin/pub", { pubId: b.dataset.flag, action: "flag", flagged: b.dataset.on === "1" })
        .then(after("标记已更新")).catch((e) => toast(e.message, true));
    };
    for (const b of host.querySelectorAll("[data-purge]")) b.onclick = () => {
      // 硬删是唯一不可回退的一颗：文件、版本、评论一起走，所以把要删的东西念出来再问。
      const row = b.closest("tr");
      const title = row ? row.querySelector("a").textContent : b.dataset.purge;
      if (!window.confirm(`彻底删除「${title}」？快照、历史版本、资产目录和它的评论会一起从盘上抹掉，这一步不可回退。`)) return;
      if (!window.confirm("再确认一次：真的要删干净吗？")) return;
      api("POST", "/api/community/admin/pub", { pubId: b.dataset.purge, action: "purge" })
        .then((r) => { store.pubs = null; load(true); toast(`已删除，回收 ${r.files} 个文件`); })
        .catch((e) => toast(e.message, true));
    };
    return;
  }

  if (t === "comments") {
    host.innerHTML = `<div class="ad-bar">
      <input id="ccQ" placeholder="搜评论内容、作者或作品" value="${esc(cc.q)}"/>
      <button class="cm-btn sm ${cc.filter === "flagged" ? "on" : ""}" data-fl="flagged">只看被标记</button>
      <span class="grow"></span><button class="cm-btn sm" id="ccGo">查询</button></div><div id="ccRows"></div>`;
    const run = () => { store.comments = null; drawContent(body); };
    $("ccGo").onclick = () => { cc.q = $("ccQ").value.trim(); run(); };
    $("ccQ").onkeydown = (e) => { if (e.key === "Enter") { cc.q = e.target.value.trim(); run(); } };
    host.querySelector("[data-fl]").onclick = () => { cc.filter = cc.filter === "flagged" ? "" : "flagged"; run(); };
    if (!store.comments) { try { store.comments = await api("GET", `/api/community/admin/comments?q=${encodeURIComponent(cc.q)}&filter=${cc.filter}&limit=150`); } catch (e) { $("ccRows").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; } }
    const d = store.comments;
    $("ccRows").innerHTML = `<div class="ad-count">${d.rows.length} / ${d.total} 条</div>`
      + (d.rows.length ? d.rows.map((c) => `<div class="ad-row">
        <div class="grow"><b>${esc(c.userName)}</b> 评论
          <a href="/p/${esc(c.pubId)}">${esc(c.pubTitle)}</a>${c.pubStatus !== "live" ? "（已下架）" : ""}
          <div class="sub">${esc(c.body)}</div>
          <div class="sub">${esc(dt(c.ts))} · ${c.likes} 赞${c.reports ? ` · ${c.reports} 条举报` : ""}${c.flagged ? " · 已标记" : ""}</div></div>
        <button class="cm-btn sm" data-cflag="${esc(c.id)}" data-on="${c.flagged ? 0 : 1}">${c.flagged ? "取消标记" : "标记"}</button>
        <button class="cm-btn sm danger" data-cdel="${esc(c.id)}">删除</button>
      </div>`).join("") : `<div class="cm-empty">没有符合条件的评论。</div>`);
    for (const b of host.querySelectorAll("[data-cflag]")) b.onclick = () => {
      api("POST", "/api/community/admin/comment", { id: b.dataset.cflag, action: "flag", flagged: b.dataset.on === "1" })
        .then(() => { store.comments = null; drawContent(body); }).catch((e) => toast(e.message, true));
    };
    for (const b of host.querySelectorAll("[data-cdel]")) b.onclick = () => {
      if (!window.confirm("删掉这条评论？关联的举报也会一起结掉。")) return;
      api("POST", "/api/community/admin/comment", { id: b.dataset.cdel })
        .then(() => { toast("评论已删除"); store.comments = null; load(true); }).catch((e) => toast(e.message, true));
    };
    return;
  }

  // 被标记队列：审查留下的红旗集中在一处，省得一张图一张图翻。
  host.innerHTML = `<div id="flRows">${skRows(6)}</div>`;
  if (!store.flagged) { try { store.flagged = await api("GET", "/api/community/admin/flagged"); } catch (e) { $("flRows").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; } }
  const d = store.flagged;
  $("flRows").innerHTML = `<div class="ad-count">${d.total} 项被机器审查打上标记 · 人看一眼再决定：取消标记或下架/删除</div>`
    + (d.total ? d.pubs.map((p) => `<div class="ad-row"><div class="grow"><b>作品 · ${esc(p.title)}</b>
        <div class="sub">${KIND_CN[p.kind] || p.kind} · ${esc(p.authorName)} · ${esc(timeAgo(p.updated))} · ${p.status === "live" ? "在线" : "已下架"}</div></div>
        <a class="cm-btn sm" href="/p/${esc(p.id)}">看作品</a>
        <button class="cm-btn sm" data-unflag="${esc(p.id)}">取消标记</button></div>`).join("")
      + d.comments.map((c) => `<div class="ad-row"><div class="grow"><b>评论 · ${esc(c.userName)}</b>
        <div class="sub">${esc(c.body)}</div><div class="sub">在「${esc(c.pubTitle)}」· ${esc(timeAgo(c.ts))}</div></div>
        <a class="cm-btn sm" href="/p/${esc(c.pubId)}">看作品</a>
        <button class="cm-btn sm danger" data-delflag="${esc(c.id)}">删除评论</button></div>`).join("")
      : `<div class="cm-empty">没有被标记的内容。</div>`);
  for (const b of host.querySelectorAll("[data-unflag]")) b.onclick = () => {
    api("POST", "/api/community/admin/pub", { pubId: b.dataset.unflag, action: "flag", flagged: false })
      .then(() => { store.flagged = null; load(true); }).catch((e) => toast(e.message, true));
  };
  for (const b of host.querySelectorAll("[data-delflag]")) b.onclick = () => {
    api("POST", "/api/community/admin/comment", { id: b.dataset.delflag })
      .then(() => { toast("评论已删除"); store.flagged = null; load(true); }).catch((e) => toast(e.message, true));
  };
}

/* ---------------- 用户 ---------------- */
const UCOLS = [["name", "账号"], ["new", "加入"], ["seen", "最近活跃"], ["pubs", "作品"], ["bytes", "占用"],
  ["comments", "评论"], ["plays", "游玩"], ["reports", "被举报"]];

async function drawUsers(body) {
  body.innerHTML = `<div class="ad-bar">
    <input id="usQ" placeholder="搜昵称或签名" value="${esc(uf.q)}"/>
    ${[["", "全部"], ["admin", "超级管理员"], ["banned", "已封禁"], ["online", "在线"], ["reported", "被举报"], ["quiet", "从没玩过"]].map(([k, l]) =>
    `<button class="cm-btn sm ${uf.only === k ? "on" : ""}" data-only="${k}">${l}</button>`).join("")}
    <span class="grow"></span><button class="cm-btn sm" id="usGo">查询</button></div>
  <div class="ad-batch" id="usBatch" hidden>
    <b id="usPickN">已选 0 人</b>
    <select id="usDays"><option value="0">无限期</option><option value="1">1 天</option><option value="3">3 天</option>
      <option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select>
    <button class="cm-btn sm danger" data-batch="ban">批量封禁</button>
    <button class="cm-btn sm" data-batch="unban">批量解封</button>
    <button class="cm-btn sm" data-batch="sessions">批量踢下线</button>
    <button class="cm-btn sm" data-batch="flag_off">批量取消标记</button>
    <button class="cm-btn sm" data-batch="role_admin">提为超级管理员</button>
    <button class="cm-btn sm" data-batch="role_user">降为普通</button>
    <button class="cm-btn sm" id="usClear">清空选择</button>
  </div>
  <div id="usRows">${skRows(6)}</div>`;
  const run = () => { store.users = null; drawUsers(body); };
  $("usGo").onclick = () => { uf.q = $("usQ").value.trim(); run(); };
  $("usQ").onkeydown = (e) => { if (e.key === "Enter") { uf.q = e.target.value.trim(); run(); } };
  $("usClear").onclick = () => { picked.clear(); drawUsers(body); };
  for (const b of body.querySelectorAll("[data-only]")) b.onclick = () => { uf.only = b.dataset.only; run(); };
  if (!store.users) {
    try { store.users = await api("GET", `/api/community/admin/users?q=${encodeURIComponent(uf.q)}&filter=${uf.only}&sort=${uf.sort}&dir=${uf.dir}`); }
    catch (e) { $("usRows").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; }
  }
  const d = store.users;
  const arrow = (k) => (uf.sort === k ? (uf.dir === "asc" ? " ↑" : " ↓") : "");
  const host = $("usRows");
  host.innerHTML = `<div class="ad-count">${d.rows.length} / ${d.total} 个账号</div>
    <table class="ad-table">
      <thead><tr><th class="chk"><input type="checkbox" id="usAll" ${d.rows.length && d.rows.every((u) => picked.has(u.name)) ? "checked" : ""}/></th>
        ${UCOLS.map(([k, l]) => `<th data-s="${k}" class="${k === "name" ? "" : "num"}">${l}${arrow(k)}</th>`).join("")}
        <th>状态</th><th></th></tr></thead>
      <tbody>${d.rows.map((u) => `<tr class="${u.banned ? "banned" : ""}">
        <td class="chk"><input type="checkbox" data-pick="${esc(u.name)}" ${picked.has(u.name) ? "checked" : ""}/></td>
        <td><a href="/u/${encodeURIComponent(u.name)}">${esc(u.name)}</a>${u.role === "admin" ? '<span class="ad-tag">超级管理员</span>' : ""}
          <div class="sub">${esc(u.bio || "")}${u.region ? ` · ${esc(u.region)}` : ""}${u.online ? ' <span class="cm-on">在线</span>' : ""}</div></td>
        <td class="num sub">${esc(timeAgo(u.createdAt))}</td>
        <td class="num sub">${u.lastSeen ? esc(timeAgo(u.lastSeen)) : "—"}</td>
        <td class="num">${u.pubsAll}</td><td class="num">${kb(u.bytes)}</td>
        <td class="num">${u.comments}</td><td class="num">${u.plays}</td>
        <td class="num">${u.reports || ""}</td>
        <td>${u.banned ? `<span class="ad-ban" title="${esc(u.bannedReason || "")}">已封禁${u.bannedUntil ? " 到 " + esc(new Date(u.bannedUntil).toLocaleDateString()) : ""}</span>` : "正常"}</td>
        <td class="ops">
          <button class="cm-btn sm" data-detail="${esc(u.name)}">详情</button>
          <button class="cm-btn sm" data-role="${esc(u.name)}" data-r="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "降为普通" : "提为超级管理员"}</button>
          <button class="cm-btn sm ${u.banned ? "" : "danger"}" data-ban="${esc(u.name)}" data-b="${u.banned ? 0 : 1}">${u.banned ? "解封" : "封禁"}</button>
          <button class="cm-btn sm" data-kick="${esc(u.name)}">踢下线</button>
        </td></tr>`).join("")}</tbody></table>`;
  for (const b of host.querySelectorAll("[data-s]")) b.onclick = () => {
    const k = b.dataset.s;
    if (uf.sort === k) uf.dir = uf.dir === "asc" ? "desc" : "asc"; else { uf.sort = k; uf.dir = k === "name" ? "asc" : "desc"; }
    run();
  };
  $("usAll").onchange = (e) => {
    for (const u of d.rows) { if (e.target.checked) picked.add(u.name); else picked.delete(u.name); }
    drawUsers(body);
  };
  for (const b of host.querySelectorAll("[data-pick]")) b.onchange = () => {
    if (b.checked) picked.add(b.dataset.pick); else picked.delete(b.dataset.pick);
    syncBatch();
  };
  for (const b of host.querySelectorAll("[data-detail]")) b.onclick = () => openUser(b.dataset.detail);
  const syncBatch = () => {
    const bar = $("usBatch");
    bar.hidden = picked.size === 0;
    $("usPickN").textContent = `已选 ${picked.size} 人`;
  };
  syncBatch();
  for (const b of body.querySelectorAll("[data-batch]")) b.onclick = () => {
    const a = b.dataset.batch;
    const names = [...picked];
    if (!names.length) return toast("先勾选人", true);
    const cn = { ban: "封禁", unban: "解封", sessions: "踢下线", flag_off: "取消标记", role_admin: "提为超级管理员", role_user: "降为普通" }[a];
    if (!window.confirm(`对 ${names.length} 个账号执行「${cn}」？自己会被自动跳过。`)) return;
    const payload = { names, action: a.startsWith("role_") ? "role" : a, role: a === "role_admin" ? "admin" : a === "role_user" ? "user" : undefined };
    if (a === "ban") { payload.days = Number($("usDays").value) || 0; payload.reason = "批量处理"; }
    api("POST", "/api/community/admin/batch", payload)
      .then((r) => { toast(`已${cn} ${r.done} 人`); picked.clear(); load(true); }).catch((e) => toast(e.message, true));
  };
  for (const b of host.querySelectorAll("[data-role]")) b.onclick = async () => {
    try { await api("POST", "/api/community/admin/role", { name: b.dataset.role, role: b.dataset.r }); toast("角色已更新"); load(true); }
    catch (e) { toast(e.message, true); }
  };
  for (const b of host.querySelectorAll("[data-ban]")) b.onclick = async () => {
    const on = b.dataset.b === "1";
    if (!on) {
      try { await api("POST", "/api/community/admin/ban", { name: b.dataset.ban, banned: false }); toast("已解封"); load(true); }
      catch (e) { toast(e.message, true); }
      return;
    }
    banDialog(b.dataset.ban);
  };
  for (const b of host.querySelectorAll("[data-kick]")) b.onclick = async () => {
    if (!window.confirm(`把 ${b.dataset.kick} 的所有登录会话踢掉？对方要重新登录才能继续用。`)) return;
    try { const r = await api("POST", "/api/community/admin/sessions", { name: b.dataset.kick }); toast(`已踢掉 ${r.killed} 个会话`); load(true); }
    catch (e) { toast(e.message, true); }
  };
}

/** 封禁对话框：原因 + 天数。无限期是一个需要显式选择的选项，而不是默认值——
 *  默认值会替人做那个最难撤销的决定。 */
function banDialog(name) {
  const mask = document.createElement("div");
  mask.className = "ad-mask center";
  mask.innerHTML = `<div class="ad-dialog">
    <h3>封禁 ${esc(name)}</h3>
    <label>原因（会显示给对方）<input id="bdReason" maxlength="120" placeholder="违反社区规则"/></label>
    <label>时长
      <select id="bdDays">
        <option value="1">1 天</option><option value="3">3 天</option><option value="7" selected>7 天</option>
        <option value="30">30 天</option><option value="90">90 天</option><option value="0">无限期</option>
      </select></label>
    <div class="sub">到期自动解封，不需要有人再来点一次。封禁会把对方的登录会话一起踢掉。</div>
    <div class="row"><button class="cm-btn" id="bdCancel">取消</button><button class="cm-btn danger" id="bdOk">封禁</button></div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) close(); };
  $("bdCancel").onclick = close;
  $("bdOk").onclick = () => {
    const days = Number($("bdDays").value) || 0;
    api("POST", "/api/community/admin/ban", { name, banned: true, days, reason: $("bdReason").value.trim() })
      .then(() => { toast(days ? `已封禁 ${days} 天` : "已封禁（无限期）"); close(); load(true); })
      .catch((e) => toast(e.message, true));
  };
  mask.querySelector("input").focus();
}

/** 用户详情抽屉：一眼看到这个人有什么、说过什么、被谁举报过、被谁动过。 */
async function openUser(name) {
  const mask = document.createElement("div");
  mask.className = "ad-mask";
  mask.innerHTML = `<div class="ad-drawer">${skRows(6)}</div>`;
  document.body.appendChild(mask);
  const close = () => { document.removeEventListener("keydown", onKey); mask.remove(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  mask.onclick = (e) => { if (e.target === mask) close(); };
  let d;
  try { d = await api("GET", `/api/community/admin/user?name=${encodeURIComponent(name)}`); }
  catch (e) { mask.querySelector(".ad-drawer").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; }
  const u = d.user;
  mask.querySelector(".ad-drawer").innerHTML = `
    <div class="hd"><b>${esc(u.name)}</b>
      <span class="ad-tag ${u.role === "admin" ? "" : "mute"}">${u.role === "admin" ? "超级管理员" : "普通用户"}</span>
      ${u.banned ? `<span class="ad-ban">已封禁${u.bannedUntil ? " 到 " + esc(new Date(u.bannedUntil).toLocaleDateString()) : ""}</span>` : ""}
      <button class="cm-btn sm" id="udClose">关闭</button></div>
    <div class="ad-kv">
      <span>注册</span><i>${esc(dt(u.createdAt))}</i>
      <span>最近活跃</span><i>${u.lastSeen ? esc(dt(u.lastSeen)) : "—"}</i>
      <span>在线</span><i>${u.online ? "是" : "否"}</i>
      <span>会话</span><i>${u.sessions} 个</i>
      <span>作品</span><i>${u.pubs} 在线 / ${u.pubsAll} 总计</i>
      <span>占用</span><i>${kb(u.bytes)}</i>
      <span>评论</span><i>${u.comments} 条</i>
      <span>好友 / 关注者</span><i>${u.friends} / ${u.followers}</i>
      <span>被举报（未处理）</span><i>${u.reports}</i>
      <span>地区 / 性别 / 目的</span><i>${esc(u.region || "—")} · ${esc(u.gender || "—")} · ${esc(u.looking || "—")}</i>
    </div>
    ${u.bio ? `<div class="ad-sec"><b>签名</b><div class="sub">${esc(u.bio)}</div></div>` : ""}
    ${u.bannedReason ? `<div class="ad-sec"><b>封禁原因</b><div class="sub">${esc(u.bannedReason)}</div></div>` : ""}
    <div class="ad-sec"><b>作品 ${d.pubs.length}</b>${d.pubs.length ? `<table class="ad-table tight"><tbody>
      ${d.pubs.map((p) => `<tr><td><a href="/p/${esc(p.id)}">${esc(p.title)}</a></td>
        <td class="num sub">${KIND_CN[p.kind] || p.kind} · v${p.version}</td>
        <td class="num">${p.plays} 玩 · ${p.comments} 评</td>
        <td class="num sub">${p.status === "live" ? "在线" : "已下架"}</td></tr>`).join("")}</tbody></table>` : `<div class="sub">没发过东西。</div>`}</div>
    <div class="ad-sec"><b>最近的评论 ${d.comments.length}</b>${d.comments.length ? d.comments.slice(0, 12).map((c) =>
    `<div class="ad-cmt"><span class="sub">${esc(c.pubTitle)} · ${esc(timeAgo(c.ts))}</span>${esc(c.body)}
      <button class="cm-btn sm danger" data-ucdel="${esc(c.id)}">删</button></div>`).join("") : `<div class="sub">没评论过。</div>`}</div>
    <div class="ad-sec"><b>关系</b><div class="sub">关注 ${d.graph.following.length}：${esc(d.graph.following.slice(0, 12).join("、")) || "—"}</div>
      <div class="sub">粉丝 ${d.graph.followers.length}：${esc(d.graph.followers.slice(0, 12).join("、")) || "—"}</div>
      <div class="sub">好友 ${d.graph.friends.length}：${esc(d.graph.friends.slice(0, 12).join("、")) || "—"}</div></div>
    ${d.reports.length ? `<div class="ad-sec"><b>针对他的举报 ${d.reports.length}</b>${d.reports.map((r) =>
    `<div class="sub">· ${r.targetType === "comment" ? "评论" : "作品"}：${esc(r.reason || "未填")} · ${esc(r.byName)} · ${r.state === "open" ? "待处理" : r.state === "resolved" ? "已处理" : "已忽略"}</div>`).join("")}</div>` : ""}
    ${d.history.length ? `<div class="ad-sec"><b>最近游玩</b><div class="sub">${esc(d.history.slice(0, 8).map((h) => `${h.title}（${timeAgo(h.ts)}）`).join(" · "))}</div></div>` : ""}
    ${d.audit.length ? `<div class="ad-sec"><b>后台动过他几次</b>${d.audit.map((a) =>
    `<div class="sub">· ${esc(ACT_CN[a.action] || a.action)} · ${esc(a.by)} · ${esc(dt(a.ts))}${a.detail ? ` · ${esc(a.detail)}` : ""}</div>`).join("")}</div>` : ""}
    <div class="ad-ops">
      <button class="cm-btn" data-op="export">导出数据</button>
      <button class="cm-btn" data-op="note">发通知</button>
      <button class="cm-btn" data-op="kick">踢下线</button>
      <button class="cm-btn" data-op="rename">改昵称</button>
      <button class="cm-btn" data-op="reset">清空资料</button>
      ${u.banned ? `<button class="cm-btn" data-op="unban">解封</button><button class="cm-btn" data-op="ban">改封禁时长</button>`
      : `<button class="cm-btn danger" data-op="ban">封禁</button>`}
      <button class="cm-btn danger" data-op="delete">注销账号</button>
    </div>`;
  $("udClose").onclick = close;
  const box = mask.querySelector(".ad-drawer");
  for (const b of box.querySelectorAll("[data-ucdel]")) b.onclick = () => {
    if (!window.confirm("删掉这条评论？")) return;
    api("POST", "/api/community/admin/comment", { id: b.dataset.ucdel })
      .then(() => { toast("评论已删除"); close(); load(true); }).catch((e) => toast(e.message, true));
  };
  for (const b of box.querySelectorAll("[data-op]")) b.onclick = async () => {
    const op = b.dataset.op;
    try {
      if (op === "export") {
        const d2 = await api("GET", `/api/community/admin/export?name=${encodeURIComponent(name)}`);
        const blob = new Blob([JSON.stringify(d2, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `laoyou-user-${name}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast("已导出（不含密码散列）");
        return;
      }
      if (op === "kick") {
        const r = await api("POST", "/api/community/admin/sessions", { name });
        toast(`已踢掉 ${r.killed} 个会话`); close(); load(true); return;
      }
      if (op === "ban") { close(); banDialog(name); return; }
      if (op === "unban") { await api("POST", "/api/community/admin/ban", { name, banned: false }); toast("已解封"); close(); load(true); return; }
      if (op === "note") {
        const text = window.prompt("通知内容（最多 200 字，会显示在他的通知列表里）");
        if (!text || !text.trim()) return;
        await api("POST", "/api/community/admin/note", { name, text: text.trim() });
        toast("已发送"); return;
      }
      if (op === "rename") {
        const to = (window.prompt(`把「${name}」改成什么昵称？对方之后能用新昵称登录`, name) || "").trim();
        if (!to || to === name) return;
        await api("POST", "/api/community/admin/user", { name, action: "rename", name2: to });
        toast("昵称已改"); close(); load(true); return;
      }
      if (op === "reset") {
        const fields = window.prompt("清空哪几项？可填 bio / avatar / banner / skin / region / gender / persona / looking", "bio,avatar");
        if (!fields) return;
        const r = await api("POST", "/api/community/admin/user", { name, action: "reset", fields: fields.split(/[,，\s]+/).filter(Boolean) });
        toast(`已清空 ${r.cleared.length} 项`); close(); load(true); return;
      }
      if (op === "delete") {
        const warn = `注销是不可回退的：他 ${u.pubsAll} 件作品的快照文件、${u.comments} 条评论会一起删。`
          + `要确认请输入昵称「${name}」`;
        if (window.prompt(warn) !== name) return toast("确认文字不对，没动", true);
        const r = await api("POST", "/api/community/admin/user", { name, action: "delete", confirm: name });
        toast(`已注销：${r.pubs} 件作品、${r.comments} 条评论、${r.files} 个文件`); close(); load(true); return;
      }
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------- 审计日志 ---------------- */
async function drawAudit(body) {
  body.innerHTML = `<div class="ad-bar">
    <input id="auQ" placeholder="搜对象、动作或超级管理员" value="${esc(af.q)}"/>
    <select id="auAct"><option value="">所有动作</option>
      ${Object.entries(ACT_CN).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    <span class="grow"></span><button class="cm-btn sm" id="auGo">查询</button></div>
  <div id="auRows">${skRows(6)}</div>`;
  const run = () => { store.audit = null; drawAudit(body); };
  $("auGo").onclick = () => { af.q = $("auQ").value.trim(); af.action = $("auAct").value; run(); };
  $("auQ").onkeydown = (e) => { if (e.key === "Enter") { af.q = e.target.value.trim(); run(); } };
  $("auAct").value = af.action;
  $("auAct").onchange = () => { af.action = $("auAct").value; run(); };
  if (!store.audit) { try { store.audit = await api("GET", `/api/community/admin/audit?q=${encodeURIComponent(af.q)}&action=${af.action}&limit=200`); } catch (e) { $("auRows").innerHTML = `<div class="cm-empty">${esc(e.message)}</div>`; return; } }
  const d = store.audit;
  $("auRows").innerHTML = `<div class="ad-count">${d.rows.length} / ${d.total} 条</div>`
    + (d.rows.length ? `<table class="ad-table"><thead><tr><th>时间</th><th>超级管理员</th><th>动作</th><th>对象</th><th>说明</th></tr></thead>
      <tbody>${d.rows.map((a) => `<tr><td class="sub">${esc(dt(a.ts))}</td><td>${esc(a.byName)}</td>
        <td>${esc(ACT_CN[a.action] || a.action)}</td><td>${esc(a.target)}</td>
        <td class="sub">${esc(a.detail || "")}</td></tr>`).join("")}</tbody></table>`
      : `<div class="cm-empty">还没有后台动作。每次封号、改角色、下架、删内容都会写进这里。</div>`);
}

mountAuth().then(load).catch((e) => {
  // 这条 catch 接的是 mountAuth 之后任何一步的异常：把渲染报错说成"服务没在跑"，
  // 人就会去重启一个本来好好的服务。写下真正的错误，猜错也好过猜错得很有把握。
  root.innerHTML = `<div class="cm-empty"><b>后台打不开</b>${esc((e && e.message) || String(e))}</div>`;
});
