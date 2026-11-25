// player-modal-shell.js — 官方「玩家」弹窗的外壳（左栏导航 + 右栏内容）与共用 DOM 工具。
//
// 皮肤库与虚拟按键是两个独立模块，但共用同一个弹窗：谁被打开谁 registerPanel，
// 导航跳到另一个时用 dynamic import 现取——静态 import 会在 skins.js ↔ gamepad.js
// 之间形成循环（两边导航里都有对方），而 panels 目录是零构建的原生 ESM，
// 循环里的函数声明提升不可依赖。动态 import 把这条边彻底断开，代价只是首次切换多一个请求。
import * as THREE from "../../vendor/three/three.module.js";
import { makeAvatar } from "../avatar.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/* ------------------------------ 共用 DOM 工具 ------------------------------ */
// 全站唯一的建元素入口：文本一律走 textContent。皮肤名是用户输入的，
// 走 innerHTML 拼接就等于把「地图名/皮肤名里带尖括号」变成存储型 XSS。
const DIRECT = new Set(["value", "checked", "disabled", "selected", "hidden", "textContent"]);
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false || v === "") continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (DIRECT.has(k)) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** 线性图标：传入 [标签, 属性] 列表，官方图标全是 1.7 描边的线性风格。 */
export function iconSvg(shapes, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/**
 * 样式挂载：面板模块自带 CSS，接线方只需要 import JS。
 * 已经在 editor.html 里 <link> 过就跳过，不重复注入。
 */
function ensurePanelCss() {
  if (document.querySelector("link[data-player-modal-css]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "/css/player-modal.css";
  l.setAttribute("data-player-modal-css", "");
  document.head.appendChild(l);
}

/** 弹窗内的提示条。#toast 的 z-index 比遮罩低，被弹窗盖住时这里才是看得见的反馈。 */
function notifyIn(host, msg) {
  if (!host) return;
  host.textContent = String(msg == null ? "" : msg);
  host.classList.toggle("show", !!msg);
  clearTimeout(host._t);
  host._t = setTimeout(() => host.classList.remove("show"), 3200);
}

/* ------------------------------ 颜色工具 ------------------------------ */
// 官方/本地两套颜色混在一起：#rrggbb 字符串、0xrrggbb、[r,g,b]（0..1）、{r,g,b}、{red,green,blue}。
// 读的时候必须全部认，写的时候只能写一种——见 skins.js 顶部说明。
const hx = (n) => Math.max(0, Math.min(255, Math.round((Number(n) || 0) * 255))).toString(16).padStart(2, "0");
function triple(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
    if (/^0x[0-9a-f]{6}$/i.test(s)) return [3, 5, 7].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
    return null;
  }
  if (Array.isArray(v)) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === "object") {
    if (v.red != null || v.green != null || v.blue != null) return [+v.red || 0, +v.green || 0, +v.blue || 0];
    if (v.r != null || v.g != null || v.b != null) return [+v.r || 0, +v.g || 0, +v.b || 0];
  }
  return null;
}
/** 任意颜色写法 → #rrggbb；认不出来返回 ""。 */
export function toHex(v) {
  const t = triple(v);
  return t ? "#" + t.map(hx).join("") : "";
}
/** #rrggbb → [0..1,0..1,0..1]。 */
function hexToRgb(hex) {
  const t = triple(hex);
  return t || [0, 0, 0];
}
/** 变暗（k<1），用于从一块主色推出头发、袖口、鞋这些派生色。 */
function shade(hex, k) {
  const t = hexToRgb(hex);
  return "#" + t.map((x) => hx(Math.min(1, x * k))).join("");
}

/* ------------------------------ 离屏 3D 预览 ------------------------------ */
let _gl = null;
/** 建一个共享的离屏渲染器（只占一个 WebGL 上下文），弹窗关闭时 disposeGL 释放。 */
function gl(w, hgt) {
  if (!_gl) {
    const canvas = document.createElement("canvas");
    _gl = {
      renderer: new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }),
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(26, 1, 0.1, 30),
    };
    _gl.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    _gl.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const hemi = new THREE.HemisphereLight(0xe8e2d8, 0x3a3632, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.6, 4.2, 3.4);
    const fill = new THREE.DirectionalLight(0xc2c6c4, 0.5);
    fill.position.set(-3, 1.6, -2.2);
    _gl.scene.add(hemi, key, fill);
  }
  _gl.renderer.setSize(w, hgt, false);
  _gl.camera.aspect = w / hgt;
  _gl.camera.updateProjectionMatrix();
  return _gl;
}
export function disposeGL() {
  if (!_gl) return;
  try { _gl.renderer.dispose(); _gl.renderer.forceContextLoss(); } catch { /* 上下文可能已被系统回收 */ }
  _gl = null;
}

/**
 * 渲染一张正面 3/4 的人偶图，返回 dataURL。
 *
 * 几何与配色一律走 avatar.js —— 也就是图里跑的那一具。这里以前自己手搓过第二份
 * 三十来块盒子的人偶，比例、暗部、五官各调各的，结果皮肤面板里选的预览和进图之后
 * 的角色是两个模型。第二份画法一旦存在就一定会漂，所以删掉，只留翻译。
 *
 * 项目皮肤记录是六键（head/body/armL/armR/legL/legR），运行时人偶是五键
 * （skin/shirt/pants/hair/shoe），所以这里只做一次键名翻译：袖子跟着上衣、
 * 两条腿同一条裤子——因为运行时就是这么长的。
 */
export function renderDoll(colors, { w = 220, h = 200 } = {}) {
  const g = gl(w, h);
  const C = colors && typeof colors === "object" ? colors : {};
  const skin = /^#[0-9a-fA-F]{6}$/.test(String(C.head)) ? C.head : "#e7b98f";
  const group = makeAvatar({
    skin,
    shirt: C.body || "#d5a24a",
    pants: C.legL || "#2b3440",
    // 官方 skin 槽里没有头发这一件（游戏里头发不参与染色），但预览要一眼看出
    // 不同皮肤的差别，所以让 head 同时决定"头部区域整体色调"。
    hair: C.hair || shade(skin, 0.34),
    shoe: C.shoe || shade(skin, 0.42),
  });
  group.rotation.y = -0.42;
  g.scene.add(group);
  g.camera.position.set(0, 1.5, 5.1);
  g.camera.lookAt(0, 0.95, 0);
  g.renderer.render(g.scene, g.camera);
  const url = g.renderer.domElement.toDataURL("image/png");
  g.scene.remove(group);
  // 只丢材质：几何是 avatar.js 里按尺寸缓存着全页面共用的，dispose 掉下一张卡片就空了
  group.traverse((o) => { if (o.isMesh) o.material.dispose(); });
  return url;
}

/* ------------------------------ 弹窗外壳 ------------------------------ */
// 顺序即官方左栏顺序：先属性，再皮肤库，最后按键。
// "attrs" 由 features.js 在 init 时注册（它要把已有的玩家属性面板搬进来），
// 这里只占一个导航位。
const NAV = [
  { key: "attrs", label: "玩家属性", icon: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7" }]] },
  { key: "skins", label: "项目皮肤库", icon: [["circle", { cx: 12, cy: 7.2, r: 3.2 }], ["path", { d: "M5 19.6c1.2-3.6 3.8-5.4 7-5.4s5.8 1.8 7 5.4" }]] },
  { key: "gamepad", label: "虚拟按键", icon: [["path", { d: "M7.6 10.8V8.9M6.6 9.9h2M16.8 8.4h.01M19.2 10.8h.01" }], ["path", { d: "M16.5 6.4c1.9 0 3.2 1.4 3.4 3.3l.5 4.4c.2 1.6-1 2.9-2.5 2.9-.7 0-1.4-.4-1.9-1l-1-1.4h-4l-1 1.4c-.5.6-1.2 1-1.9 1-1.5 0-2.7-1.3-2.5-2.9l.5-4.4c.2-1.9 1.5-3.3 3.4-3.3z" }]] },
];

const PANELS = new Map();
let shell = null; // { E, mask, box, content, notice, key, destroy }

export function registerPanel(key, def) { PANELS.set(key, def); }

/** 面板模块按需加载：只认这两个 key，不接受外部传路径，免得变成任意 import 入口 */
async function ensureLoaded(key) {
  if (PANELS.has(key)) return;
  await import(key === "gamepad" ? "./gamepad.js" : "./skins.js");
}

/** 打开（或切换）「玩家」弹窗。key = "skins" | "gamepad"。 */
export async function openPlayerModal(E, key) {
  ensurePanelCss();
  await ensureLoaded(key);
  if (!PANELS.has(key)) return null;
  const s = ensureShell(E);
  s.mask.classList.add("show");
  await showPanel(s, key);
  return s;
}

export function closePlayerModal() {
  if (!shell) return;
  destroyPanel();
  // 关掉就把 key 清掉：重开要拿到一份新渲染的内容（和重新抓一帧画面），
  // 而不是停在上次关闭前的那个页签上
  shell.key = "";
  shell.mask.classList.remove("show");
}

function destroyPanel() {
  const s = shell;
  if (!s || !s.destroy) return;
  try { s.destroy(); } catch (err) { console.warn("[player-modal] 面板卸载失败", err); }
  s.destroy = null;
}

function ensureShell(E) {
  if (shell && shell.E === E) return shell;
  destroyShell();
  const content = h("div", { class: "pm-content" });
  const navItems = NAV.map((item) => h("button", {
    class: "pm-nav-item", type: "button", "data-key": item.key,
    onclick: () => showPanel(host, item.key),
  }, [iconSvg(item.icon, 17), h("span", { text: item.label })]));
  const notice = h("div", { class: "pm-notice" });
  const box = h("div", { class: "pm-box" }, [
    h("aside", { class: "pm-nav" }, [h("div", { class: "pm-nav-title", text: "玩家" }), ...navItems]),
    h("section", { class: "pm-main" }, [content]),
    h("button", { class: "pm-close", type: "button", title: "关闭", "aria-label": "关闭", text: "✕", onclick: () => closePlayerModal() }),
    notice,
  ]);
  const mask = h("div", { class: "pm-mask", role: "dialog", "aria-modal": "true", "aria-label": "玩家" }, [box]);
  mask.addEventListener("pointerdown", (ev) => { if (ev.target === mask) closePlayerModal(); });
  const host = { E, mask, box, content, notice, key: "", destroy: null };
  // 二级弹窗/⋮ 菜单开着时，Esc 先关它们（两边都在 window 捕获阶段，谁先注册谁先跑，
  // 所以只能在这里让路，靠子弹窗 stopPropagation 是拦不住的）
  host.onKey = (ev) => {
    if (ev.key !== "Escape" || shell !== host || !mask.classList.contains("show")) return;
    if (document.querySelector(".pm-sub-mask, .pm-pop")) return;
    closePlayerModal();
  };
  window.addEventListener("keydown", host.onKey, true);
  document.body.appendChild(mask);
  shell = host;
  return host;
}

function destroyShell() {
  if (!shell) return;
  destroyPanel();
  window.removeEventListener("keydown", shell.onKey, true);
  shell.mask.remove();
  shell = null;
}

async function showPanel(s, key) {
  if (s.key === key && s.content.childElementCount) return;
  await ensureLoaded(key);
  const def = PANELS.get(key);
  if (!def) return;
  destroyPanel();
  s.content.replaceChildren();
  s.key = key;
  for (const btn of s.mask.querySelectorAll(".pm-nav-item")) btn.classList.toggle("active", btn.dataset.key === key);
  let cleanup = null;
  const ctx = {
    E: s.E,
    el: s.content,
    go: (k) => showPanel(s, k),
    close: closePlayerModal,
    notify: (msg) => notifyIn(s.notice, msg),
  };
  try { cleanup = def.render(ctx); } catch (err) {
    console.warn("[player-modal] 面板渲染失败", err);
    s.content.appendChild(h("div", { class: "pm-empty", text: "面板渲染失败：" + String((err && err.message) || err) }));
  }
  s.destroy = typeof cleanup === "function" ? cleanup : null;
}
