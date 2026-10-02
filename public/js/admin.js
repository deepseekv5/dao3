// admin.js — 管理后台：作品与用户数据、举报队列、角色与封禁。
// 所有动作打的是 /api/community/admin/*，服务端会再查一次角色；
// 前端藏按钮只是体验，不是权限。
import * as auth from "/js/auth.js";
import { toast } from "/js/pubs.js";

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
const kb = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : (b || 0) + " B");

let data = null, tab = "reports";

async function load() {
  if (!auth.me) {
    root.innerHTML = `<div class="cm-empty"><b>先登录</b>后台只放行管理员角色。<button class="cm-btn primary" id="adLogin" style="margin-top:12px">登录</button></div>`;
    $("adLogin").onclick = () => openAuth("login");
    return;
  }
  try { data = await api("GET", "/api/community/admin/overview"); }
  catch (e) {
    root.innerHTML = `<div class="cm-empty"><b>进不去</b>${esc(e.message)}<br>当前账号「${esc(auth.me.name)}」不是管理员。第一个注册的账号会自动成为管理员。</div>`;
    return;
  }
  sub.textContent = `${data.totals.users} 个账号 · ${data.totals.pubs} 件作品 · ${data.reports.length} 条待处理`;
  draw();
}

function draw() {
  const t = data.totals;
  const fl = data.flagged || { pubs: 0, comments: 0 };
  root.innerHTML = `
    <div class="ad-cards">
      <div><b>${t.users}</b><em>账号</em></div>
      <div><b>${t.pubs}</b><em>作品</em><i>其中 ${t.models} 个模型</i></div>
      <div><b>${t.plays}</b><em>游玩次数</em></div>
      <div><b>${t.comments}</b><em>评论</em></div>
      <div><b>${data.reports.length}</b><em>待处理举报</em></div>
      <div><b>${kb(t.bytes)}</b><em>快照体积</em></div>
      <div><b>${(fl.pubs || 0) + (fl.comments || 0)}</b><em>被标记内容</em><i>进队列等人看</i></div>
    </div>
    <div class="cm-tabs">
      <button class="cm-btn ${tab === "reports" ? "on" : ""}" data-t="reports">举报队列 ${data.reports.length}</button>
      <button class="cm-btn ${tab === "users" ? "on" : ""}" data-t="users">用户</button>
    </div>
    <div id="adBody"></div>`;
  for (const b of root.querySelectorAll("[data-t]")) b.onclick = () => { tab = b.dataset.t; draw(); };
  const body = $("adBody");
  if (tab === "reports") {
    body.innerHTML = data.reports.length ? data.reports.map((r) => `<div class="ad-row">
      <div class="grow"><b>${esc(r.targetType === "comment" ? "评论" : "作品")} · ${esc(r.ownerName)}</b>
        <div class="sub">${esc(r.excerpt || "（无摘要）")}</div>
        <div class="sub">理由：${esc(r.reason || "未填写")} · 由 ${esc(r.byName)} 举报 · ${esc(timeAgo(r.ts))}</div></div>
      ${r.pubId ? `<a class="cm-btn sm" href="/p/${esc(r.pubId)}">看作品</a>` : ""}
      <button class="cm-btn sm" data-dismiss="${esc(r.id)}">忽略</button>
      <button class="cm-btn sm danger" data-resolve="${esc(r.id)}">处理并删内容</button>
    </div>`).join("") : `<div class="cm-empty">没有待处理的举报。</div>`;
    const act = (key, action) => (e) => {
      const id = e.currentTarget.dataset[key];
      api("POST", `/api/community/admin/report/${id}`, { action, remove: key === "resolve" })
        .then(() => { toast("已处理"); load(); }).catch((x) => toast(x.message, true));
    };
    for (const b of body.querySelectorAll("[data-dismiss]")) b.onclick = act("dismiss", "dismiss");
    for (const b of body.querySelectorAll("[data-resolve]")) b.onclick = act("resolve", "resolve");
    return;
  }
  body.innerHTML = `<table class="ad-table">
    <thead><tr><th>账号</th><th>角色</th><th>作品</th><th>评论</th><th>好友</th><th>最近游玩</th><th>加入</th><th>状态</th><th></th></tr></thead>
    <tbody>${data.users.map((u) => `<tr class="${u.banned ? "banned" : ""}">
      <td><a href="/u/${encodeURIComponent(u.name)}">${esc(u.name)}</a>${u.bio ? `<div class="sub">${esc(u.bio.slice(0, 40))}</div>` : ""}</td>
      <td>${esc(u.role)}</td><td class="num">${u.pubs}</td><td class="num">${u.comments}</td>
      <td class="num">${u.friends}</td><td class="num">${u.plays}</td>
      <td class="sub">${esc(timeAgo(u.createdAt))}</td>
      <td>${u.banned ? `<span class="ad-ban" title="${esc(u.bannedReason || "")}">已封禁</span>` : "正常"}</td>
      <td class="ops">
        <button class="cm-btn sm" data-role="${esc(u.name)}" data-r="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "降为普通" : "提为管理员"}</button>
        <button class="cm-btn sm ${u.banned ? "" : "danger"}" data-ban="${esc(u.name)}" data-b="${u.banned ? 0 : 1}">${u.banned ? "解封" : "封禁"}</button>
      </td></tr>`).join("")}</tbody></table>`;
  for (const b of body.querySelectorAll("[data-role]")) b.onclick = async () => {
    try { await api("POST", "/api/community/admin/role", { name: b.dataset.role, role: b.dataset.r }); toast("角色已更新"); load(); }
    catch (e) { toast(e.message, true); }
  };
  for (const b of body.querySelectorAll("[data-ban]")) b.onclick = async () => {
    const on = b.dataset.b === "1";
    const reason = on ? (prompt("封禁原因（会显示给对方）") || "违反社区规则") : "";
    try { await api("POST", "/api/community/admin/ban", { name: b.dataset.ban, banned: on, reason }); toast(on ? "已封禁" : "已解封"); load(); }
    catch (e) { toast(e.message, true); }
  };
}

mountAuth().then(load).catch((e) => {
  // 这条 catch 接的是 mountAuth 之后任何一步的异常：把渲染报错说成"服务没在跑"，
  // 人就会去重启一个本来好好的服务。写下真正的错误，猜错也好过猜错得很有把握。
  root.innerHTML = `<div class="cm-empty"><b>后台打不开</b>${esc((e && e.message) || String(e))}</div>`;
});
