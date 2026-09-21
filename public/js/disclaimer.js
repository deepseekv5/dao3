// disclaimer.js — 免责声明。首次进入弹出并需勾选确认，确认后记住，不再自动打扰；
// 各页保留「免责声明」入口，随时可重新查看（window.__showDisclaimer()）。
const ACK_KEY = "dao3_disclaimer_ack";
const ACK_VER = "1";
const shouldPrompt = () => { try { return localStorage.getItem(ACK_KEY) !== ACK_VER; } catch { return true; } };
const remember = () => { try { localStorage.setItem(ACK_KEY, ACK_VER); } catch {} };
const TEXT = {
  title: "免责声明 / Disclaimer",
  sub: "DAO3 编辑器复刻 · 本地研究与兼容性实现",
  blocks: [
    ["关于本项目", [
      "本项目是对 <b>dao3.fun（神奇代码岛 / DAO3 Arena）</b>编辑器与运行时的<b>独立兼容实现</b>：全部代码由本仓库自行编写，<b>未复制、未反编译、未分发任何官方源代码</b>。",
      "实现依据是官方公开发布的文档与类型声明（box3-product-document、GameAPI.d.ts、docs.dao3.fun）以及官方开源的方块图集仓库，目的是让同名地图与脚本能够被正确读取和运行，即<b>接口兼容</b>，而非代码同源。",
    ]],
    ["关于官方素材与地图数据", [
      "方块贴图、方块 ID 表、地图 <code>project.json</code> 及其 IPFS 数据块、模型与音频素材的<b>著作权归 box3lab 及其权利人所有</b>。",
      "本仓库仅在你本机内用于学习、技术研究与兼容性验证；未经权利人许可，<b>不得</b>用于商业分发、公开镜像或冒充官方产品。",
      "本项目与 box3lab / 神奇代码岛官方<b>无任何隶属、授权或背书关系</b>。",
    ]],
  ],
  note: "继续使用即表示你已阅读并同意：本工具仅供本地学习与兼容性研究，产生的地图与内容的权利责任由使用者自行承担。",
  agree: "我已阅读并理解上述声明",
  ok: "进入",
  leave: "离开",
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

export function showDisclaimer(opts = {}) {
  if (window.top !== window.self && !opts.force) return;      // 被 iframe 嵌入时不重复弹
  if (document.querySelector(".dc-mask")) return;
  const mask = el("div", "dc-mask");
  const card = el("div", "dc-card");

  const head = el("div", "dc-head");
  head.appendChild(el("div", "dc-mark", "!"));
  const ht = el("div");
  ht.appendChild(el("h2", null, TEXT.title));
  ht.appendChild(el("p", null, TEXT.sub));
  head.appendChild(ht);
  card.appendChild(head);

  const body = el("div", "dc-body");
  for (const [h, items] of TEXT.blocks) {
    body.appendChild(el("h3", null, h));
    const ul = el("ul");
    for (const t of items) ul.appendChild(el("li", null, t));
    body.appendChild(ul);
  }
  body.appendChild(el("div", "dc-note", TEXT.note));
  card.appendChild(body);

  const foot = el("div", "dc-foot");
  const label = el("label", "dc-check");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  label.appendChild(cb);
  label.appendChild(el("span", null, TEXT.agree));
  foot.appendChild(label);

  const acts = el("div", "dc-actions");
  const leave = el("button", "dc-btn", TEXT.leave);
  const ok = el("button", "dc-btn ok", TEXT.ok);
  ok.disabled = true;
  acts.appendChild(leave); acts.appendChild(ok);
  foot.appendChild(acts);
  card.appendChild(foot);
  mask.appendChild(card);
  document.body.appendChild(mask);

  cb.checked = !!opts.prechecked;
  ok.disabled = !cb.checked;
  cb.onchange = () => { ok.disabled = !cb.checked; if (cb.checked) ok.focus(); };
  leave.onclick = () => {
    if (opts.onLeave) return opts.onLeave();
    try { location.href = "/"; } catch { window.close(); }
  };
  const close = () => { mask.classList.add("closing"); setTimeout(() => mask.remove(), 320); };
  ok.onclick = () => {
    remember();
    close();
    opts.onAccept && opts.onAccept();
  };
}

// 页面里的「免责声明」链接随时可重新查看
window.__showDisclaimer = () => showDisclaimer({ force: true, prechecked: true });
document.addEventListener("click", (ev) => {
  const t = ev.target.closest && ev.target.closest("[data-disclaimer]");
  if (!t) return;
  ev.preventDefault();
  window.__showDisclaimer();
});

// 直接在任意页面 <script type="module"> 引入即可自动生效；确认过一次后不再自动弹
if (!window.__dcManual && shouldPrompt()) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => showDisclaimer());
  else showDisclaimer();
}
