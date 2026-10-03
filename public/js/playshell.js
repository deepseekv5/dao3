// playshell.js — 游玩态的内嵌外壳：Esc 呼出的是游戏内菜单，不是跳回编辑器。
//
// 为什么要有这个文件：以前 Esc 直接 stopPlay()，玩家一按退出就掉回编辑器界面，
// 对"打开一张图玩"的人来说等于被踢出产品。Roblox 的 escape 菜单是浮在游戏上的，
// 世界继续跑，菜单只给出口与设置——这里照这个口径做。

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
  host.className = "pm-menu";
  host.innerHTML = `
    <div class="pm-card">
      <header>
        <img src="${LOGO}" alt=""/>
        <div><b id="pmMap">—</b><i id="pmWho"></i></div>
      </header>
      <div class="pm-list">
        <button data-x="resume"><span>继续游戏</span><kbd>Esc</kbd></button>
        <button data-x="view"><span>切换视角</span><kbd>V</kbd></button>
        <button data-x="settings"><span>画面与操作</span><kbd>H</kbd></button>
        <button data-x="profile"><span>个人资料</span><kbd></kbd></button>
        <button class="danger" data-x="leave"><span id="pmLeave">离开游戏</span><kbd></kbd></button>
      </div>
      <footer>
        <span>老攸元宇宙 · 菜单不会暂停世界</span>
        <span id="pmOnline"></span>
      </footer>
    </div>`;
  document.body.appendChild(host);
  host.addEventListener("click", (e) => { if (e.target === host) close(); });
  const on = (k, fn) => { const b = host.querySelector(`[data-x="${k}"]`); if (b) b.onclick = fn; };
  on("resume", close);
  on("view", () => { const p = rt.player; p.cameraMode = p.cameraMode === "fps" ? "follow" : "fps"; close(); });
  on("settings", () => { close(); document.getElementById("gameHudSettings")?.classList.add("show"); });
  on("profile", () => { location.href = "/me"; });
  // 体验版是纯静态站，没有账号层，点"个人资料"只会 404
  if (!window.__me) host.querySelector('[data-x="profile"]').hidden = true;
  on("leave", () => leave());
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
  host.querySelector("#pmMap").textContent = m.title || (rt.e.state && rt.e.state.meta && rt.e.state.meta.name) || "未命名世界";
  const who = window.__me && window.__me.name;
  host.querySelector("#pmWho").textContent = who ? "玩家 " + who + (m.author ? " · 作者 " + m.author : "") : (m.author ? "作者 " + m.author : "本地玩家");
  host.querySelector("#pmLeave").textContent = isCommunity() ? "离开游戏" : "返回编辑器";
  host.querySelector("#pmOnline").textContent = (window.__online || 1) > 1 ? window.__online + " 人在线" : "";
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
    ? "WASD 移动 · V 切换视角 · 回车聊天 · Esc 呼出菜单"
    : "运行模式 · WASD 移动 · V 切换视角 · Esc 呼出菜单（不会退出到编辑器）";
}
