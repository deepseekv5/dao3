// playshell.js — 游玩态的内嵌外壳：Esc 呼出的是游戏内菜单，不是跳回编辑器。
//
// 为什么要有这个文件：以前 Esc 直接 stopPlay()，玩家一按退出就掉回编辑器界面，
// 对"打开一张图玩"的人来说等于被踢出产品。Roblox 的 escape 菜单是浮在游戏上的，
// 世界继续跑，菜单只给出口与设置——这里照这个口径做。

import * as backend from "./backend.js";

/* 体验版是纯静态站点，部署在 Pages 子路径下，所以图标不能写根绝对路径。
   从模块自己的 URL 推：应用里模块在 /js/、图标在 /img/；体验版同理，只是多了个子路径前缀。 */
const LOGO = new URL("../img/laoyou.svg", import.meta.url).href;

let host = null, rt = null, menuOpen = false;

const isCommunity = () => !!(window.__playMeta && window.__playMeta.pubId);

function leaveTarget() {
  const m = window.__playMeta || {};
  return m.pubId ? "/p/" + m.pubId : m.back || "/";
}

function build() {
  host = document.createElement("div");
  host.id = "playMenu";
  host.className = "gm-menu";
  host.innerHTML = `
    <div class="gm-card">
      <header>
        <img src="${LOGO}" alt=""/>
        <div><b id="gmMap">—</b><i id="gmWho"></i></div>
      </header>
      <div class="gm-list">
        <button data-x="resume"><span>继续游戏</span><kbd>Esc</kbd></button>
        <button data-x="pause"><span id="gmPause">暂停世界</span><kbd>P</kbd></button>
        <button data-x="step"><span>单帧步进</span><kbd>⇧P</kbd></button>
        <button data-x="view"><span>切换视角</span><kbd>V</kbd></button>
        <button data-x="settings"><span>画面与操作</span><kbd>H</kbd></button>
        <button data-x="chat"><span>聊天</span><kbd>↵</kbd></button>
        ${backend.serverBacked ? '<button data-x="profile"><span>个人资料</span><kbd></kbd></button>' : ""}
        <button data-x="back" hidden><span id="gmBack">回到上一张</span><kbd></kbd></button>
        <button class="danger" data-x="leave"><span id="gmLeave">离开游戏</span><kbd></kbd></button>
      </div>
      <footer>
        <span id="gmPauseNote">菜单不会暂停世界</span>
        <span id="gmOnline"></span>
      </footer>
    </div>`;
  document.body.appendChild(host);
  host.addEventListener("click", (e) => { if (e.target === host) close(); });
  const on = (k, fn) => { const b = host.querySelector(`[data-x="${k}"]`); if (b) b.onclick = fn; };
  on("resume", close);
  on("pause", () => { rt._togglePause(); syncPause(); });
  // 步进前先确保是暂停态：菜单里点"单帧"的人要的就是"走一格给我看"，
  // 而不是被教育一遍"先暂停"。
  on("step", () => { if (!rt.paused) rt._togglePause(true); rt._stepFrame(); syncPause(); });
  on("view", () => { const p = rt.player; p.cameraMode = p.cameraMode === "fps" ? "follow" : "fps"; close(); });
  on("settings", () => { close(); document.getElementById("gameHudSettings")?.classList.add("show"); });
  on("chat", () => { close(); rt.openChat && rt.openChat(); });
  on("profile", () => backend.openProfile());
  on("back", () => {
    const f = cameFrom();
    if (f && f.id) backend.gotoWorld(f.id, mTitle());
  });
  on("leave", () => leave());
}

/** 暂停态在菜单里的两处体现：按钮文字、脚注。
 *  菜单是"世界状态的一面镜子"，镜子里写着"暂停世界"而其实已经暂停，
 *  人就再也分不清了。 */
function syncPause() {
  if (!host || !rt) return;
  const label = host.querySelector("#gmPause");
  const note = host.querySelector("#gmPauseNote");
  if (label) label.textContent = rt.paused ? "继续世界" : "暂停世界";
  if (note) note.textContent = rt.paused ? `世界已暂停 · tick ${rt.currentTick}` : "菜单不会暂停世界";
}

/** 当前这张图叫什么：回指的时候要带上，否则"回去"按钮只是一句无主的话。 */
function mTitle() {
  const m = window.__playMeta || {};
  return m.title || (rt && rt.e && rt.e.state && rt.e.state.meta && rt.e.state.meta.name) || "";
}
/** 从哪张图走过来。门本身是单向链接，没有这条就回不去，玩家穿两扇门就迷路了。 */
function cameFrom() {
  try { return JSON.parse(sessionStorage.getItem("ly.cameFrom") || "null"); } catch { return null; }
}

/** 出口只有一条逻辑：社区图回作品页，编辑器里的运行回编辑器。
    菜单按钮和顶栏停止按钮必须走同一个函数，否则两处行为会慢慢分叉——
    一处能退、一处只是"看起来没反应"。 */
export function leave(_rt) {
  const r = _rt || rt;
  if (!r) return;
  if (isCommunity()) { location.href = leaveTarget(); return; }
  // 编辑器里的"运行"是作者的预览，出口本来就是回到编辑器
  r.e && r.e.stopPlay ? r.e.stopPlay() : r.stop();
}

export function open(_rt) {
  rt = _rt;
  if (!host) build();
  menuOpen = true;
  host.classList.add("show");
  const m = window.__playMeta || {};
  // 菜单只建一次，但登录态和房间是每次运行才知道的：藏哪几项必须在 open 里判，不能写在 build 里
  const profile = host.querySelector('[data-x="profile"]');
  if (profile) profile.hidden = !window.__me;
  const chat = host.querySelector('[data-x="chat"]');
  if (chat) chat.hidden = !(rt._net && rt._net.live);
  host.querySelector("#gmMap").textContent = m.title || (rt.e.state && rt.e.state.meta && rt.e.state.meta.name) || "未命名世界";
  const who = window.__me && window.__me.name;
  host.querySelector("#gmWho").textContent = who ? "玩家 " + who + (m.author ? " · 作者 " + m.author : "") : (m.author ? "作者 " + m.author : "本地玩家");
  host.querySelector("#gmLeave").textContent = isCommunity() ? "离开游戏" : "返回编辑器";
  const back = host.querySelector('[data-x="back"]');
  const f = cameFrom();
  // 只有真的是"走过来的"才给这个出口：直接打开一张图时它没有意义
  if (back) {
    back.hidden = !(f && f.id && f.id !== String((rt.e && rt.e.worldId) || ""));
    const name = back.querySelector("#gmBack");
    if (name && f && f.title) name.textContent = "回到「" + f.title + "」";
  }
  host.querySelector("#gmOnline").textContent = (window.__online || 1) > 1 ? window.__online + " 人在线" : "";
  syncPause();
}

export function close() {
  if (!host) return;
  menuOpen = false;
  host.classList.remove("show");
}
export const isOpen = () => menuOpen;
export function toggle(_rt) { menuOpen ? close() : open(_rt); }

/** 顶部那条一次性提示：措辞要和"Esc 回编辑器"的旧行为彻底告别。 */
export function hintText() {
  return isCommunity()
    ? "WASD 移动 · V 视角 · 回车聊天 · Esc 菜单"
    : "WASD 移动 · V 视角 · Esc 菜单";
}
