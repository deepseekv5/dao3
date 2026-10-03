// collab.js — 编辑器协作：多人同时改同一张图，每一处改动都带作者。
//
// 为什么挂在 history.commit 而不是各个工具上：放置/破坏/填充/粘贴/镜像/脚本沙箱
// 全都最终走这一个口子（main.js 里已经为了音效包过一次）。在工具层埋点要改十几处，
// 而且必然漏掉后来新增的工具——漏掉的那条不会报错，只是"我改了别人没看到"。
//
// 归属一律由服务端判定（见 server/realtime.mjs）：客户端自报"这行是我写的"可以伪造。
// 这里只负责把服务端给的作者表画出来。
import * as auth from "./auth.js";
import { connect } from "./net.js";
import { unrle, authorColor as hashColor } from "./diff.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hhmm = (ts) => new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

export function mountCollab(E) {
  const api = {
    on: false, peers: new Map(), authors: new Map(), feed: [], msgs: [], seq: 0,
    net: null, applying: false, myId: null, editingFile: null,
  };
  api.applyWorld = applyWorld;   // 测试与 Agent 都要能直接投一条远端改动进来
  api.render = render;
  // 这几个必须在 start() 可能被调用之前就声明：它们由 hookHistory/hookScripts 使用，
  // 而那两个函数在 start() 里就会跑。声明写在下面会踩到 TDZ——一点按钮就
  // "Cannot access 'origCommit' before initialization"，协作直接开不起来。
  let origCommit = null, origUndo = null, origRedo = null, scriptTimer = null, scriptHook = null;
  E.collab = api;   // features.js 的脚本 input 与行号槽要回调进来，先挂上
  const btn = document.getElementById("btnCollab");
  if (!btn) return api;
  btn.onclick = () => (api.on ? stop() : start());
  return api;

  /* ---------------- 面板 ---------------- */
  function panel() {
    let p = document.getElementById("collabPanel");
    if (p) return p;
    p = document.createElement("aside");
    p.id = "collabPanel";
    p.innerHTML = `
      <div class="cb-head"><b>协作</b><span class="cb-room" id="cbRoom"></span><button class="cb-x" title="关闭协作">×</button></div>
      <div class="cb-sec">在线</div>
      <div class="cb-people" id="cbPeople"></div>
      <div class="cb-sec">改动</div>
      <div class="cb-feed" id="cbFeed"></div>
      <div class="cb-sec">讨论</div>
      <div class="cb-chat" id="cbChat"></div>
      <textarea class="cb-input" id="cbInput" rows="3" placeholder="说点什么，Enter 发送 · Shift+Enter 换行"></textarea>`;
    document.body.appendChild(p);
    p.querySelector(".cb-x").onclick = () => stop();
    const input = p.querySelector("#cbInput");
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        api.net && api.net.send({ t: "chat", m: text });
        input.value = "";
      }
      ev.stopPropagation();   // 别让编辑器的 b/e/g/f 快捷键打在聊天框上
    });
    return p;
  }

  function render() {
    const p = document.getElementById("collabPanel");
    if (!p) return;
    const people = p.querySelector("#cbPeople");
    const mine = { id: api.myId, name: (auth.me && auth.me.name) || "我", editing: api.editingFile };
    const rows = [mine, ...[...api.peers.values()]];
    people.innerHTML = rows.map((u) => `<div class="cb-person">
      <i style="background:${hashColor(u.id)}"></i><span>${esc(u.name)}</span>
      ${u.editing ? `<em>正在写 ${esc(u.editing)}</em>` : ""}</div>`).join("");
    p.querySelector("#cbFeed").innerHTML = api.feed.slice(-40).reverse().map((f) => `<div class="cb-item">
      <i style="background:${hashColor(f.by && f.by.id)}"></i>
      <span class="cb-who">${esc(f.by && f.by.name)}</span>
      <span class="cb-what">${esc(kindLabel(f))}</span>
      <time>${esc(hhmm(f.ts))}</time></div>`).join("") || '<div class="cb-none">还没有改动</div>';
    const chat = p.querySelector("#cbChat");
    chat.innerHTML = api.msgs.slice(-120).map((m) => `<div class="cb-msg">
      <i style="background:${hashColor(m.id)}"></i><b>${esc(m.name)}</b><span>${esc(m.m)}</span><time>${esc(hhmm(m.ts))}</time></div>`).join("")
      || '<div class="cb-none">还没有人说话</div>';
    chat.scrollTop = chat.scrollHeight;
    p.querySelector("#cbRoom").textContent = api.on ? `${rows.length} 人 · ${E.worldId}` : "";
  }

  function kindLabel(f) {
    if (f.kind === "script") return `改了 ${f.what}（+${f.added} −${f.removed} 行）`;
    if (f.kind === "voxel") return `改了 ${f.what}`;
    if (f.kind === "entity") return `挪了 ${f.what}`;
    return f.what || f.kind;
  }

  /* ---------------- 开 / 关 ---------------- */
  async function start() {
    if (!auth.me) { await auth.refreshMe().catch(() => {}); }
    if (!auth.me) { E.toast("协作要先登录（右上角）", true); return; }
    api.myId = auth.me.id;
    api.on = true;
    panel().classList.add("show");
    document.body.classList.add("collab-on");
    btn.classList.add("on");
    btn.title = "协作中：点我关闭";
    api.net = connect({ kind: "edit", roomId: E.worldId, on: {
      welcome: (m) => {
        api.peers = new Map((m.peers || []).map((p) => [p.id, { id: p.id, name: p.name, editing: null }]));
        api.feed = m.feed || [];
        if (m.world) applyWorld(m.world, m.world.by);
        render();
        E.toast(`协作已连接：${(m.peers || []).length + 1} 人在一起编辑`);
      },
      join: (m) => { api.peers.set(m.peer.id, { id: m.peer.id, name: m.peer.name, editing: null }); render(); E.toast(`${m.peer.name} 加入协作`); },
      leave: (m) => { const p = api.peers.get(m.id); api.peers.delete(m.id); render(); if (p) E.toast(`${p.name} 离开了协作`); },
      world: (m) => applyWorld(m),
      note: (m) => { const p = api.peers.get(m.id); if (p) { p.editing = m.file || null; render(); } },
      chat: (m) => { api.msgs.push({ id: m.id, name: m.name, m: m.m, ts: Date.now() }); render(); },
      status: (s) => { if (!s.connected && api.on && s.closed) E.toast("协作连接断了，正在重连…", true); },
    } });
    hookHistory(); hookScripts();
  }

  function stop() {
    api.on = false;
    if (api.net) { api.net.close(); api.net = null; }
    unhook();
    const p = document.getElementById("collabPanel");
    if (p) p.classList.remove("show");
    document.body.classList.remove("collab-on");
    btn.classList.remove("on");
    btn.title = "协作：和别人一起改这张图";
    E.toast("已关闭协作");
  }

  /* ---------------- 发：体素与脚本 ---------------- */
  function hookHistory() {
    const h = E.history;
    origCommit = h.commit.bind(h); origUndo = h.undo.bind(h); origRedo = h.redo.bind(h);
    h.commit = (changes, label) => { origCommit(changes, label); sendCells(changes); };
    h.undo = () => { const top = h.stack[h.pointer]; const ok = origUndo(); if (ok && top) sendCells(top.changes, true); return ok; };
    h.redo = () => { const top = h.stack[h.pointer + 1]; const ok = origRedo(); if (ok && top) sendCells(top.changes); return ok; };
  }
  function unhook() {
    const h = E.history;
    if (origCommit) { h.commit = origCommit; h.undo = origUndo; h.redo = origRedo; origCommit = origUndo = origRedo = null; }
    if (scriptHook) { E.state.scripts.forEach((f) => { f._collabHook = false; }); scriptHook = null; }
    clearTimeout(scriptTimer);
  }
  function sendCells(changes, swap = false) {
    if (!api.net || !changes || !changes.length) return;
    const v = changes.map((c) => [c.x, c.y, c.z, (swap ? c.oldId : c.newId) | 0, (swap ? c.oldRot : c.newRot) & 3]);
    api.net.op(v, []);
  }
  function hookScripts() {
    // 脚本是"整份文件覆盖 + 服务端算归属"：不做行合并。两个人同时改同一个文件时
    // 后写的会盖掉先写的，但先写的那位会在改动流与行号颜色上看到自己的行没了 ——
    // 这比静默合并出错要诚实，也是本地工具能承担的最简单一致语义。
    scriptHook = (name) => {
      if (!api.net) return;
      api.net.send({ t: "note", file: name });
      clearTimeout(scriptTimer);
      scriptTimer = setTimeout(() => {
        const f = (E.state.scripts || []).find((x) => x.name === name);
        if (f) api.net.send({ t: "op", s: [[f.name, f.code || ""]] });
      }, 1200);
    };
    api.notifyEdit = scriptHook;
  }

  /* ---------------- 收：落到本地世界 ---------------- */
  function applyWorld(m) {
    if (!m) return;
    if (m.seq != null && m.seq <= api.seq) return;      // 过期包不能把世界倒回早先状态
    if (m.seq != null) api.seq = m.seq;
    // 自己发的包服务端也会发回来：不跳过。写同样的值是幂等的，而跳过会让
    // "我这次改动"从自己的改动流里消失，面板上就数不出自己动过几次。
    api.applying = true;
    try {
      for (const c of m.v || []) {
        const [x, y, z, id, rot] = c.map(Number);
        if (![x, y, z, id, rot].every(Number.isFinite)) continue;
        E.world.set(x, y, z, id, rot);
        E.renderer.markDirty(x, y, z);
      }
      for (const s of m.s || []) {
        const [name, code, authorRle, st] = s;
        api.authors.set(name, unrle(authorRle || []));
        const f = (E.state.scripts || []).find((x) => x.name === name);
        if (f) {
          if (f.code === code && !authorRle) continue;
          f.code = code;
          // 正在看这个文件就要立刻反映出来，否则别人改了而屏幕上还是旧的
          if (E.refreshScriptView) E.refreshScriptView(name);
          E.toast(`${(m.by && m.by.name) || "有人"} 改了 ${name}`);
        } else {
          E.state.scripts.push({ name, code });
          if (E.refreshScriptFiles) E.refreshScriptFiles();
        }
      }
      if ((m.v || []).length || (m.s || []).length) { E.markDirty && E.markDirty(); E.updateStatus && E.updateStatus(); }
      if (m.by && (m.v || []).length) api.feed.push({ ts: Date.now(), by: m.by, kind: "voxel", what: (m.v || []).length + " 格" });
      for (const sc of (m.s || [])) if (m.by) api.feed.push({ ts: Date.now(), by: m.by, kind: "script", what: sc[0], added: (sc[3] && sc[3].added) || 0, removed: (sc[3] && sc[3].removed) || 0 });
      if (api.feed.length > 200) api.feed.splice(0, api.feed.length - 200);
      render();
    } finally { api.applying = false; }
  }
}
