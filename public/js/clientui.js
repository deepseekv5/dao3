// clientui.js — 运行期客户端 API（官方 ClientAPI.d.ts：ui 节点树 / input / screen / Audio / 向量辅助）
// 全部由真实 DOM 承载：脚本创建的节点会出现在运行画面上，属性写入即改样式。

/* ---------------- 事件发射器 ---------------- */
export class EventEmitter {
  constructor() { this._m = new Map(); }
  _list(type) { let a = this._m.get(type); if (!a) this._m.set(type, a = []); return a; }
  on(type, listener) { if (typeof listener === "function") this._list(type).push({ listener }); return this; }
  add(type, listener) { return this.on(type, listener); }
  once(type, listener) { if (typeof listener !== "function") return this; const rec = { listener, once: true }; this._list(type).push(rec); return this; }
  remove(type, listener) {
    const a = this._m.get(type); if (!a) return this;
    // 官方 remove 只摘掉找到的第一个，removeAll 才清空同名全部
    const i = listener ? a.findIndex((r) => r.listener === listener) : -1;
    if (i >= 0) a.splice(i, 1);
    return this;
  }
  off(type, listener) { return this.remove(type, listener); }
  removeAll(type, listener) { if (type == null) this._m.clear(); else this.remove(type, listener || null); return this; }
  emit(type, event) {
    const a = this._m.get(type); if (!a) return;
    for (const rec of a.slice()) {
      if (rec.once) { const i = a.indexOf(rec); if (i >= 0) a.splice(i, 1); }
      try { rec.listener(event); } catch (err) { console.warn("UI 事件回调出错:", type, err && err.message); }
    }
  }
}

/* ---------------- 向量辅助 ---------------- */
export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  copy(val) { if (val) { this.x = +val.x || 0; this.y = +val.y || 0; } return this; }
  static create(val) { return new Vec2(val && val.x, val && val.y); }
}
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  get r() { return this.x; } set r(v) { this.x = v; }
  get g() { return this.y; } set g(v) { this.y = v; }
  get b() { return this.z; } set b(v) { this.z = v; }
  copy(val) { if (val) { this.x = +val.x || 0; this.y = +val.y || 0; this.z = +val.z || 0; } return this; }
  // 官方 UI 侧用 r/g/b 写法且量程是 0-255（Vec3.create({r:255,g:0,b:0})），这里两种键名都收
  static create(val) {
    const v = val || {};
    const src = (v.r != null || v.g != null || v.b != null) ? { x: v.r, y: v.g, z: v.b } : v;
    return new Vec3(+src.x || 0, +src.y || 0, +src.z || 0);
  }
}
export class Coord2 {
  constructor() { this.offset = new Vec2(); this.scale = new Vec2(); }
  copy(val) { if (val) { this.offset.copy(val.offset); this.scale.copy(val.scale); } return this; }
  static create(val) { const c = new Coord2(); if (val) { c.offset.copy(val.offset || val); c.scale.copy(val.scale || {}); } return c; }
}

// 0-255 的颜色写法（官方 UI 侧口径），同时兼容 0~1 的浮点写法以免误伤已有脚本
function cssOf(v3, alpha) {
  const raw = [(v3 && v3.x) || 0, (v3 && v3.y) || 0, (v3 && v3.z) || 0];
  const f = raw.map((n) => (n > 1 ? Math.round(n) : Math.round(n * 255)));
  return `rgba(${f[0]},${f[1]},${f[2]},${alpha == null ? 1 : Math.max(0, Math.min(1, +alpha))})`;
}

const FONTS = { 0: "", 1: '"Baloo 2","PingFang SC",sans-serif', 2: '"Courier New",monospace', 3: 'Georgia,serif' };
const ALIGN_X = { Left: "left", Center: "center", Right: "right", left: "left", center: "center", right: "right" };
const ALIGN_Y = { Top: "flex-start", Center: "center", Bottom: "flex-end", top: "flex-start", center: "center", bottom: "flex-end" };
const FIT = { Fill: "fill", Contain: "contain", Cover: "cover", None: "none", 0: "fill", 1: "contain", 2: "cover", 3: "none" };
// 官方 richText 只支持 <font size color> 与 <stroke thickness opacity color> 两种标签，且属性必须真的生效；
// 其余标签按纯文本处理，用 DOMParser 白名单重建，避免把脚本内容当 HTML 执行
const RICH_OK = new Map([["FONT", ["size", "color"]], ["STROKE", ["thickness", "opacity", "color"]]]);
function sanitizeRich(html, depth) {
  if (depth > 12) return document.createDocumentFragment();
  const doc = new DOMParser().parseFromString(`<body>${String(html == null ? "" : html)}</body>`, "text/html");
  const frag = document.createDocumentFragment();
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === 3) { frag.appendChild(document.createTextNode(node.data)); continue; }
    if (node.nodeType !== 1) continue;
    const allow = RICH_OK.get(node.tagName);
    if (!allow) { frag.appendChild(document.createTextNode(node.textContent)); continue; }
    const el = document.createElement(node.tagName === "FONT" ? "span" : "span");
    for (const a of allow) {
      const v = node.getAttribute(a);
      if (v == null) continue;
      if (a === "size") el.style.fontSize = (/^[0-9.]+$/.test(v) ? v + "px" : v);
      else if (a === "thickness") el.style.webkitTextStrokeThickness = v + "px";
      else if (a === "opacity") el.style.webkitTextStrokeOpacity = String(Math.max(0, Math.min(1, +v || 0)));
      else el.style[a] = v;
    }
    el.appendChild(sanitizeRich(node.innerHTML, depth + 1));
    frag.appendChild(el);
  }
  return frag;
}

/* ---------------- 节点基类 ---------------- */
export class UiNode {
  constructor(host) {
    this.name = "";
    this._children = [];
    this._parent = null;
    this.events = new EventEmitter();
    this.uiScale = undefined;
    this.el = host || document.createElement("div");
  }
  get children() { return this._children.slice(); }
  get parent() { return this._parent; }
  set parent(node) {
    if (node === this._parent) return;
    const old = this._parent;
    if (old) { const i = old._children.indexOf(this); if (i >= 0) old._children.splice(i, 1); }
    this._parent = node || null;
    if (node) { node._children.push(this); if (this.el && this.el.parentNode !== node.el) node.el.appendChild(this.el); }
    else if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (node && node._layout) node._layout();
    this._layout();
  }
  findChildByName(name) { return this._children.find((c) => c.name === name); }
  _apply() {}
  _layout() { this._apply(); for (const c of this._children) c._layout(); }
  _copyInto(dst) {
    dst.name = this.name;
    if (this.uiScale) dst.uiScale = this.uiScale;
    return dst;
  }
  clone() {
    const c = new this.constructor(this._makeEl ? this._makeEl() : undefined, this._ui);
    this._copyInto(c);
    for (const ch of this._children) { const cc = ch.clone(); cc.parent = c; }
    return c;
  }
  destroy() { this.parent = null; this.events.removeAll(); }
}

/* ---------------- 可渲染基类 ---------------- */
export class UiRenderable extends UiNode {
  constructor(host) {
    super(host);
    this.anchor = new Vec2(0, 0);
    this.position = new Coord2();
    this.size = new Coord2();
    this.backgroundColor = new Vec3(0, 0, 0);
    this.backgroundOpacity = 1;
    this.rotation = 0;
    this.zIndex = 1;
    this.autoResize = "NONE";
    this.visible = true;
    this.pointerEventBehavior = 3;
    this.el.className = "cui-node";
    this.el.style.position = "absolute";
    this._bindPointer();
  }
  get parent() { return this._parent; }
  set parent(node) { super.parent = node; }
  _bindPointer() {
    this.el.addEventListener("pointerdown", (ev) => {
      // 0/2 需要挡住后方（吞掉事件），1 是纯穿透（元素本身 pointer-events:none 根本收不到）
      if (this._swallow) { ev.stopPropagation(); ev.preventDefault(); }
      this.events.emit("pointerdown", { target: this });
      if (this._ui) this._ui.input.uiEvents.emit("pointerdown", { target: this });
      if (this._ui) for (const fn of this._ui.input.onPointerDown._subs.slice()) { try { fn({ target: this }); } catch {} }
    });
    this.el.addEventListener("pointerup", (ev) => {
      this.events.emit("pointerup", { target: this });
      if (this._ui) this._ui.input.uiEvents.emit("pointerup", { target: this });
    });
  }
  _cssBase() {
    const st = this.el.style;
    st.zIndex = String(this.zIndex | 0);
    st.display = this.visible ? this._display || "block" : "none";
    // 0 禁用且挡住后方，1 禁用但可穿透，2 自身响应且不往后传，3 全开
    const peb = this.pointerEventBehavior;
    st.pointerEvents = peb === 0 ? "auto" : (peb === 1 ? "none" : "auto");
    this._swallow = peb === 0 || peb === 2;
    const p = this._parentBox();
    const w = (this.size.offset.x || 0) + (this.size.scale.x || 0) * p.w;
    const h = (this.size.offset.y || 0) + (this.size.scale.y || 0) * p.h;
    this._w = w; this._h = h;
    const ar = String(this.autoResize || "NONE").toUpperCase();
    st.width = ar.includes("X") ? "auto" : Math.max(0, w) + "px";
    st.height = ar.includes("Y") ? "auto" : Math.max(0, h) + "px";
    const x = (this.position.offset.x || 0) + (this.position.scale.x || 0) * p.w;
    const y = (this.position.offset.y || 0) + (this.position.scale.y || 0) * p.h;
    // 滚动框内的子节点必须走常规文档流，否则绝对定位撑不出 scrollHeight，滚动就成了摆设
    const inFlow = !!(this._parent && this._parent._scrollContent);
    st.position = inFlow ? "relative" : "absolute";
    if (inFlow) { st.marginLeft = x + "px"; st.marginTop = y + "px"; st.left = st.top = ""; }
    else { st.left = x + "px"; st.top = y + "px"; st.marginLeft = st.marginTop = ""; }
    const sc = this.uiScale && this.uiScale.scale != null ? this.uiScale.scale : 1;
    // 官方：旋转始终绕几何中心，与 anchor 无关，角度夹在 -179..180
    const rot = Math.max(-179, Math.min(180, +this.rotation || 0));
    st.transformOrigin = "0 0";
    st.transform = `translate(-50%, -50%) rotate(${rot}deg) translate(50%, 50%) translate(${-50 + (this.anchor.x || 0) * -100}%, ${-50 + (this.anchor.y || 0) * -100}%) scale(${sc})`;
    if (this._display !== "none-always") st.background = cssOf(this.backgroundColor, this.backgroundOpacity);
  }
  _parentBox() {
    const pe = this._parent && this._parent.el;
    if (!pe) return { w: innerWidth, h: innerHeight };
    return { w: pe.clientWidth || innerWidth, h: pe.clientHeight || innerHeight };
  }
  _apply() { this._cssBase(); }
  _layout() { this._apply(); for (const c of this._children) c._layout(); }
  _copyInto(dst) {
    super._copyInto(dst);
    dst.anchor.copy(this.anchor); dst.position.copy(this.position); dst.size.copy(this.size);
    dst.backgroundColor.copy(this.backgroundColor); dst.backgroundOpacity = this.backgroundOpacity;
    dst.rotation = this.rotation; dst.zIndex = this.zIndex; dst.autoResize = this.autoResize;
    dst.visible = this.visible; dst.pointerEventBehavior = this.pointerEventBehavior;
    return dst;
  }
}

/* ---------------- 具体控件 ---------------- */
export class UiBox extends UiRenderable {
  constructor(host, ui) { super(host || document.createElement("div")); this._ui = ui; }
  _makeEl() { const d = document.createElement("div"); d.style.position = "absolute"; return d; }
  static create(ctx) { return ctx._instantiate(new UiBox(undefined, ctx)); }
}
export class UiScrollBox extends UiRenderable {
  constructor(host, ui) {
    super(host || document.createElement("div"));
    this._ui = ui;
    this._scrollContent = true; // 标记：我的子节点走常规流（见 UiRenderable._cssBase）
    this.scrollPosition = new Vec2();
    this.el.style.overflow = "auto";
    this.el.addEventListener("scroll", () => { this.scrollPosition.x = this.el.scrollLeft; this.scrollPosition.y = this.el.scrollTop; });
  }
  _makeEl() { const d = document.createElement("div"); d.style.position = "absolute"; d.style.overflow = "auto"; return d; }
  _apply() {
    super._apply();
    this.el.scrollLeft = this.scrollPosition.x;
    this.el.scrollTop = this.scrollPosition.y;
    // 官方：设置后受当前可滚动范围约束 —— 夹完把真实值回写，别让脚本读到越界的假数字
    if (this.el.scrollHeight > 0) {
      this.scrollPosition.x = this.el.scrollLeft;
      this.scrollPosition.y = this.el.scrollTop;
    }
  }
  static create(ctx) { return ctx._instantiate(new UiScrollBox(undefined, ctx)); }
}
export class UiText extends UiRenderable {
  constructor(host, ui) {
    super(host || document.createElement("div"));
    this._ui = ui; this._display = "flex";
    this.textContent = "Text"; this.richText = false;
    this.textFontSize = 14; this.textColor = new Vec3(255, 255, 255);
    this.textXAlignment = "Center"; this.textYAlignment = "Center";
    this.autoWordWrap = false; this.textLineHeight = 1.2;
    this.textStrokeColor = new Vec3(0, 0, 0); this.textStrokeOpacity = 1; this.textStrokeThickness = 0;
    this.textFontFamily = 0;
  }
  _makeEl() { const d = document.createElement("div"); d.style.position = "absolute"; return d; }
  _apply() {
    super._apply();
    const st = this.el.style;
    st.display = this.visible ? "flex" : "none";
    st.alignItems = ALIGN_Y[this.textYAlignment] || "flex-start";
    st.justifyContent = ALIGN_X[this.textXAlignment] === "center" ? "center" : ALIGN_X[this.textXAlignment] === "right" ? "flex-end" : "flex-start";
    st.font = `${this.textFontSize || 16}px/${this.textLineHeight || 1.4} ${FONTS[this.textFontFamily] || "inherit"}`.trim();
    st.color = cssOf(this.textColor, 1);
    st.textAlign = ALIGN_X[this.textXAlignment] || "left";
    st.whiteSpace = this.autoWordWrap ? "normal" : "pre";
    st.wordBreak = this.autoWordWrap ? "break-word" : "normal";
    st.webkitTextStroke = this.textStrokeThickness ? `${this.textStrokeThickness}px ${cssOf(this.textStrokeColor, this.textStrokeOpacity)}` : "";
    if (this.richText) { this.el.textContent = ""; this.el.appendChild(sanitizeRich(this.textContent, 0)); }
    else this.el.textContent = this.textContent == null ? "" : String(this.textContent);
  }
  _copyInto(dst) {
    super._copyInto(dst);
    dst.textContent = this.textContent; dst.richText = this.richText; dst.textFontSize = this.textFontSize;
    dst.textColor.copy(this.textColor); dst.textXAlignment = this.textXAlignment; dst.textYAlignment = this.textYAlignment;
    dst.autoWordWrap = this.autoWordWrap; dst.textLineHeight = this.textLineHeight;
    dst.textStrokeColor.copy(this.textStrokeColor); dst.textStrokeOpacity = this.textStrokeOpacity;
    dst.textStrokeThickness = this.textStrokeThickness; dst.textFontFamily = this.textFontFamily;
    return dst;
  }
  static create(ctx) { return ctx._instantiate(new UiText(undefined, ctx)); }
}
export class UiInput extends UiText {
  constructor(host, ui) {
    super(host || document.createElement("input"), ui);
    this._display = "inline-block";
    this.placeholder = "Type something here"; this.placeholderColor = new Vec3(153, 153, 153); this.placeholderOpacity = 1;
    this._input = this.el;
    this._input.style.padding = "4px 6px";
    this._input.addEventListener("focus", () => this.events.emit("focus", { target: this }));
    this._input.addEventListener("blur", () => this.events.emit("blur", { target: this }));
    this._input.addEventListener("input", () => { this.textContent = this._input.value; });
  }
  _makeEl() { const d = document.createElement("input"); d.style.position = "absolute"; return d; }
  get isFocus() { return document.activeElement === this.el; }
  focus() { try { this.el.focus(); } catch {} }
  blur() { try { this.el.blur(); } catch {} return this.el.value; }
  _apply() {
    const v = this.textContent;
    super._apply();
    const st = this.el.style;
    st.display = this.visible ? "inline-block" : "none";
    st.fontSize = (this.textFontSize || 16) + "px";
    st.color = cssOf(this.textColor, 1);
    st.background = cssOf(this.backgroundColor, this.backgroundOpacity);
    st.border = "1px solid rgba(255,255,255,.25)"; st.borderRadius = "6px";
    this.el.placeholder = this.placeholder || "";
    this.el.style.setProperty("--ph", cssOf(this.placeholderColor, this.placeholderOpacity));
    if (this.el.value !== (v == null ? "" : String(v))) this.el.value = v == null ? "" : String(v);
  }
  _copyInto(dst) { super._copyInto(dst); dst.placeholder = this.placeholder; dst.placeholderColor.copy(this.placeholderColor); dst.placeholderOpacity = this.placeholderOpacity; return dst; }
  static create(ctx) { return ctx._instantiate(new UiInput(undefined, ctx)); }
}
export class UiImage extends UiRenderable {
  constructor(host, ui) {
    super(host || document.createElement("img"), ui);
    this._ui = ui; this._display = "block";
    this.image = ""; this.imageOpacity = 1; this.imageDisplayMode = 0;
    this.el.addEventListener("load", () => this.events.emit("load", { target: this }));
  }
  get complete() { return !!this.el.complete; }
  _makeEl() { const d = document.createElement("img"); d.style.position = "absolute"; return d; }
  _apply() {
    super._apply();
    const st = this.el.style;
    st.display = this.visible ? "block" : "none";
    st.opacity = String(Math.max(0, Math.min(1, this.imageOpacity == null ? 1 : this.imageOpacity)));
    st.objectFit = FIT[this.imageDisplayMode] || "fill";
    const src = this.image == null ? "" : String(this.image);
    const url = src && this._ui && this._ui.resolveSrc ? this._ui.resolveSrc(src) : src;
    if (url && this.el.getAttribute("src") !== url) this.el.setAttribute("src", url);
    if (!url) this.el.removeAttribute("src");
  }
  _copyInto(dst) { super._copyInto(dst); dst.image = this.image; dst.imageOpacity = this.imageOpacity; dst.imageDisplayMode = this.imageDisplayMode; return dst; }
  static create(ctx) { return ctx._instantiate(new UiImage(undefined, ctx)); }
}
export class UiScale {
  constructor(node) { this.node = node || null; this._scale = 1; }
  get scale() { return this._scale; }
  set scale(v) {
    const n = +v;
    if (!Number.isFinite(n) || n < 0) { console.warn("UiScale.scale 需要非负数，已忽略：", v); return; }
    this._scale = n;
    if (this.node) this.node._layout();
  }
  static create(node) { const s = new UiScale(node); if (node) { node.uiScale = s; node._layout(); } return s; }
}

/* ---------------- 屏幕与根节点 ---------------- */
export class UiScreen extends UiNode {
  constructor(ui, name, host) {
    super(host || document.createElement("div"));
    this._ui = ui || null;
    this.name = name || ("screen" + (UiScreen._n = (UiScreen._n || 0) + 1));
    this.visible = true;
    this.zIndex = 0;
    this.el.className = "cui-screen";
    const st = this.el.style;
    st.position = "absolute"; st.inset = "0"; st.pointerEvents = "none";
  }
  // clone() 的通用实现按 (host, ui) 取参，与本类 (ui, name) 签名不同，故单独实现；克隆出的屏幕同样登记
  clone() {
    const c = new this.constructor(this._ui, this.name);
    c.visible = this.visible; c.zIndex = this.zIndex;
    if (UiScreen._all) UiScreen._all.push(c);
    for (const ch of this._children) { const cc = ch.clone(); cc.parent = c; }
    return c;
  }
  set parent(node) {
    super.parent = node;
    if (!node && UiScreen._all) { const i = UiScreen._all.indexOf(this); if (i >= 0) UiScreen._all.splice(i, 1); }
  }
  _layout() {
    this.el.style.zIndex = String(this.zIndex | 0);
    this.el.style.display = this.visible ? "block" : "none";
    for (const c of this._children) c._layout();
  }
  static create(ctx) { return ctx._instantiateScreen(new UiScreen(ctx)); }
  static getAllScreen() { return UiScreen._all ? UiScreen._all.slice() : []; }
}

export function createClientApi({ getCanvas, lockPointer, unlockPointer, render3dChanged, resolveSrc }) {
  const rootEl = document.createElement("div");
  rootEl.id = "clientUiRoot";
  rootEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:58;overflow:hidden;font-family:inherit";
  const api = {
    input: {
      uiEvents: new EventEmitter(),
      pointerLockEvents: new EventEmitter(),
      onPointerDown: { _subs: [], sub(fn) { if (typeof fn === "function" && !this._subs.includes(fn)) this._subs.push(fn); } },
      lockPointer: () => lockPointer && lockPointer(),
      unlockPointer: () => unlockPointer && unlockPointer(),
    },
    screen: { get width() { return innerWidth; }, get height() { return innerHeight; }, events: new EventEmitter() },
    world: { rendering3d: true },
    // 项目内相对资产路径 → 可加载 URL（由运行时注入；没有注入时原样用）
    resolveSrc: (s) => (resolveSrc ? resolveSrc(s) : String(s == null ? "" : s)),
  };
  Object.defineProperty(api.world, "rendering3d", {
    // 官方语义是「暂停渲染、画面停在最后一帧」，所以关掉时不再提交新帧而非隐藏画布
    get() { return this._r3 !== false; },
    set(v) {
      this._r3 = !!v;
      if (render3dChanged) render3dChanged(this._r3);
    },
  });
  const ui = new UiNode(rootEl);
  ui.name = "ui";
  api.ui = ui;
  api._instantiate = (node) => { node._ui = api; return node; };
  api._instantiateScreen = (s) => { s._ui = api; s.parent = ui; return s; };
  UiScreen._all = [];
  const origCreate = UiScreen.create;
  api.UiScreen = class extends UiScreen {
    static create() { const s = api._instantiateScreen(new UiScreen(api)); UiScreen._all.push(s); return s; }
  };
  api.UiBox = class extends UiBox { static create() { return api._instantiate(new UiBox(undefined, api)); } };
  api.UiText = class extends UiText { static create() { return api._instantiate(new UiText(undefined, api)); } };
  api.UiInput = class extends UiInput { static create() { return api._instantiate(new UiInput(undefined, api)); } };
  api.UiImage = class extends UiImage { static create() { return api._instantiate(new UiImage(undefined, api)); } };
  api.UiScrollBox = class extends UiScrollBox { static create() { return api._instantiate(new UiScrollBox(undefined, api)); } };
  api.UiScale = UiScale;
  void origCreate;

  const onResize = () => api.screen.events.emit("resize", { screenWidth: innerWidth, screenHeight: innerHeight });
  addEventListener("resize", onResize);
  const onLockChange = () => {
    const c = getCanvas && getCanvas();
    api.input.pointerLockEvents.emit("pointerlockchange", { isLocked: document.pointerLockElement === c });
  };
  const onLockError = () => api.input.pointerLockEvents.emit("pointerlockerror", undefined);
  document.addEventListener("pointerlockchange", onLockChange);
  document.addEventListener("pointerlockerror", onLockError);

  // 官方是引擎每帧刷布局：属性写入是普通赋值（position.offset.x=…）没法挂钩，这里同样按帧重排
  let raf = 0;
  const step = () => { ui._layout(); raf = requestAnimationFrame(step); };
  api.attach = () => { if (!rootEl.parentNode) document.body.appendChild(rootEl); if (!raf) step(); };
  api.detach = () => { if (raf) cancelAnimationFrame(raf); raf = 0; if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl); };
  api.teardown = () => {
    removeEventListener("resize", onResize);
    document.removeEventListener("pointerlockchange", onLockChange);
    document.removeEventListener("pointerlockerror", onLockError);
    api.detach();
    for (const s of ui._children.slice()) s.parent = null;
    UiScreen._all = [];
  };
  api.refresh = () => ui._layout();
  api.rootEl = rootEl;
  api.Vec2 = Vec2; api.Vec3 = Vec3; api.Coord2 = Coord2; api.EventEmitter = EventEmitter;
  api.MediaError = MediaError; api.MediaErrorCode = MediaErrorCode;
  return api;
}

// 官方客户端的媒体错误对象与错误码
export const MediaErrorCode = {
  MEDIA_ERR_ABORTED: 1, MEDIA_ERR_DECODE: 3, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_NOT_ALLOWED: 4, MEDIA_ERR_SRC_NOT_SUPPORTED: 5,
};
export class MediaError {
  constructor(code, message) { this.code = code | 0; this.message = message || ""; }
}

/* ---------------- 录音回放 Audio ---------------- */
export function createAudioClass() {
  return class Audio extends EventEmitter {
    constructor(url) {
      super();
      this._el = new window.Audio();
      this._el.preload = "auto";
      this.error = null;
      this.src = url || "";
      this.volume = 1;
      this._el.addEventListener("loadeddata", () => this.emit("loadeddata", { target: this }));
      this._el.addEventListener("ended", () => this.emit("ended", { target: this }));
      this._el.addEventListener("error", () => { this.error = new MediaError(MediaErrorCode.MEDIA_ERR_SRC_NOT_SUPPORTED, "load failed"); this.emit("error", { target: this }); });
    }
    get src() { return this._el.src; }
    set src(v) { if (v) this._el.src = String(v); }
    get volume() { return this._el.volume; }
    set volume(v) { this._el.volume = Math.max(0, Math.min(1, +v || 0)); }
    load() { try { this._el.load(); } catch {} }
    async play() {
      try { await this._el.play(); }
      catch (err) { this.error = new MediaError(MediaErrorCode.MEDIA_ERR_NOT_ALLOWED, String(err && err.message || err)); }
    }
    pause() { try { this._el.pause(); } catch {} }
  };
}
