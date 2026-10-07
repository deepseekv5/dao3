// rail.js — 左侧导航栏只在这里渲染一份。
//
// 为什么：index.html / community.html / admin.html 以前各自抄了一遍
// `<nav class="wb-railnav">`，三份抄到最后 admin 那一份只剩 4 条，而且把
// "社区广场"写成了"社区"——人在后台就点不回手册与 API。导航是产品的骨架，
// 骨架有三份，就必然出现"这个页面少了那个入口"这类永远修不完的 bug。
import * as auth from "/js/auth.js";

// 默认世界的 id：编辑器入口指向它（与工作台"继续编辑"同一张图）。
const EDITOR_HREF = "/edit/216d665d3ca92bd1b9a2";

const S = (paths, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ${extra}>${paths}</svg>`;

const ICON = {
  home: S('<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>', 'stroke-linejoin="round"'),
  people: S('<circle cx="9" cy="8" r="3.1"/><path d="M3.6 19c0-3 2.4-5 5.4-5s5.4 2 5.4 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 14.3c2.5.3 4.6 2 4.6 4.4"/>', 'stroke-linecap="round"'),
  cube: S('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>', 'stroke-linejoin="round"'),
  vox: S('<path d="M4 20h6v-6H4zM10 14h6V8h-6zM16 8h4V4h-4z"/>', 'stroke-linejoin="round"'),
  chat: S('<path d="M4 5.5h16v10.5H9.5L4 20z"/><path d="M8 9h8M8 12h5"/>', 'stroke-linejoin="round" stroke-linecap="round"'),
  doc: S('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9.5 12.5h5M9.5 16h4"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  book: S('<path d="M11 4H5.8C5 4 4.3 4.7 4.3 5.5v13c0 .8.7 1.5 1.5 1.5H11zM13 4h5.2c.8 0 1.5.7 1.5 1.5v13c0 .8-.7 1.5-1.5 1.5H13z"/><path d="M11 4v16h2V4z"/>', 'stroke-linejoin="round"'),
  code: S('<path d="M8.4 8 4.4 12l4 4M15.6 8l4 4-4 4M13.4 5.2l-2.8 13.6"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 3.4v2.3M12 18.3v2.3M20.6 12h-2.3M5.7 12H3.4M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6M18.1 18.1l-1.6-1.6M7.5 7.5 5.9 5.9"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
};

/** 顺序即产品地图：先自己的东西，再公共的，最后是"怎么做的"。 */
const ITEMS = [
  { href: "/", label: "工作台", title: "工作台", icon: "home", on: (p) => p === "/" },
  { href: "/community", label: "社区", title: "社区广场", icon: "people", on: (p) => p.startsWith("/community") || p.startsWith("/p/") || p.startsWith("/u/") },
  { href: "/friends", label: "好友", title: "好友、扩列与通知", icon: "chat", on: (p) => p.startsWith("/friends") },
  { href: EDITOR_HREF, label: "编辑器", title: "编辑器", icon: "cube", on: (p) => p.startsWith("/edit") },
  { href: "/voxa", label: "建模", title: "VOXA 体素建模", icon: "vox", on: (p) => p.startsWith("/voxa") },
  { href: "/admin", label: "后台", title: "管理后台（仅超级管理员可见）", icon: "gear", on: (p) => p.startsWith("/admin"), admin: true },
  { href: "/site", label: "简介", title: "简介", icon: "doc", on: (p) => p === "/site" },
  { href: "/manual", label: "手册", title: "游玩手册", icon: "book", on: (p) => p.startsWith("/manual") },
  { href: "/docs/api-reference.html", label: "API", title: "API 参考", icon: "code", on: (p) => p.startsWith("/docs") },
];

export function renderRail(host = document.querySelector(".wb-railnav")) {
  if (!host) return;
  const path = location.pathname;
  const isAdmin = !!(auth.me && auth.me.role === "admin");
  host.innerHTML = ITEMS
    .filter((it) => !it.admin || isAdmin)
    .map((it) => `<a href="${it.href}"${it.on(path) ? ' class="on"' : ""} title="${it.title}">`
      + `<span>${ICON[it.icon]}</span><i>${it.label}</i></a>`)
    .join("");
}

/** 各页在 boot 时调一次：登录态是异步拿的，拿到之后才能决定"后台"这条要不要出现。 */
export async function bootRail() {
  renderRail();
  if (!auth.me) { try { await auth.refreshMe(); } catch { /* 未登录是正常状态 */ } renderRail(); }
}

// 自举：导航比页面内容更要紧——就算这页的业务脚本挂了，用户也得能跳走。
// 所以 rail.js 自己 import 自己渲染，不依赖各页记得调用。
if (typeof document !== "undefined") {
  const go = () => { bootRail(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
}
