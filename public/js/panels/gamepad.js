// gamepad.js — 官方「玩家 → 虚拟按键」弹窗：预览真实画面 + 可拖拽的触屏按钮。
//
// 用到的字段（与现有实现的关系，先说清楚免得两边打架）：
//  · meta.gamepadLayout = { walk: [ {id,label,x,y,size} … ], fly: [ … ] }
//    本面板新增，**按地图**存：x/y 是预览区左上角百分比，size 是宽度的百分比。
//  · meta.player.gamepad = { joystickBackground, joystickController, jump, crouch, actionA,
//      actionB, flyButton, flyingBackground, flyingController } —— 现有「玩家」面板
//      （features.js buildPlayerExtras 的「虚拟按键图标」组）已经在写这套**图标图片路径**，
//      所以这里只读它、把图标贴到对应按钮上，绝不把布局塞进同名字段。
//  · 运行模式那套悬浮按钮的位置存在 localStorage 的 dao3.floatLayout（game.js _saveFloatLayout），
//    语义是"这台设备的操作习惯"；本面板的 layout 是"这张地图给玩家摆什么键"，两者不该合并。
//    接线时若要让运行模式读 meta.gamepadLayout，用下面导出的 DEFAULT_GAMEPAD_LAYOUT / gamepadLayout()，
//    按钮 id 与运行模式的 DOM id 一一对应：joystick→#joyBase、jump→#tJump、crouch→#tCrouch、
//    run→#tRun、actionA→#tActionA、actionB→#tActionB、flyButton→#tFly。
import { h, iconSvg, openPlayerModal, registerPanel } from "./player-modal-shell.js";

// 官方截图位置：左下一个大摇杆，右侧一列圆键。size 用宽度百分比，圆键直径 = size% × 预览宽
// 跳跃必须在默认布局里：它是这套按钮存在的首要理由，漏掉等于给玩家一套不能跳的手柄。
export const DEFAULT_GAMEPAD_LAYOUT = {
  walk: [
    { id: "joystick", label: "摇杆", x: 4, y: 52, size: 17 },
    { id: "crouch", label: "蹲下", x: 86, y: 4, size: 9 },
    { id: "run", label: "奔跑", x: 86, y: 24, size: 9 },
    { id: "actionA", label: "A", x: 86, y: 44, size: 10 },
    { id: "actionB", label: "B", x: 86, y: 64, size: 10 },
    { id: "jump", label: "跳", x: 70, y: 56, size: 12 },
  ],
  fly: [
    { id: "joystick", label: "摇杆", x: 4, y: 52, size: 17 },
    { id: "flyButton", label: "降落", x: 86, y: 4, size: 9 },
    { id: "run", label: "加速", x: 86, y: 24, size: 9 },
    { id: "actionA", label: "A", x: 86, y: 44, size: 10 },
    { id: "actionB", label: "B", x: 86, y: 64, size: 10 },
    { id: "jump", label: "跳", x: 70, y: 56, size: 12 },
  ],
};

// 线性图标：官方那套按钮全是白描线，不是贴图
const ICONS = {
  jump: [["path", { d: "M12 5.5v13" }], ["path", { d: "M7.6 10.4 12 5.6l4.4 4.8" }], ["path", { d: "M7.6 15.4 12 10.6l4.4 4.8" }]],
  crouch: [["circle", { cx: 12, cy: 6, r: 2 }], ["path", { d: "M12 8.6v3.6" }], ["path", { d: "M12 12.2 8.6 15v4" }], ["path", { d: "M12 12.2 15.4 15v4" }], ["path", { d: "M12 10 15.6 11.6" }]],
  run: [["circle", { cx: 13.6, cy: 5, r: 2 }], ["path", { d: "M13.2 8.4 10.4 13l2.6 2.8L11.4 21" }], ["path", { d: "M10.4 13 7.2 11.6" }], ["path", { d: "M12.6 10.2 16.2 11.8 17.8 9.2" }], ["path", { d: "M13 15.8 16.6 17.4 17.2 21" }]],
  flyButton: [["path", { d: "M19.6 4.4C11.6 4.4 6.4 9.4 5.6 18.4" }], ["path", { d: "M19.6 4.4c1.4 8-3 13.4-12 14" }], ["path", { d: "M6 19.6 19.8 5.8" }], ["path", { d: "M9.4 13.4h5.2M10.6 10h4.4" }]],
  flyingController: [["path", { d: "M12 4v16" }], ["path", { d: "M7.6 15.6 12 20.4l4.4-4.8" }]],
  flyingBackground: [["circle", { cx: 12, cy: 12, r: 8 }], ["circle", { cx: 12, cy: 12, r: 3.2 }]],
  joystickBackground: [["circle", { cx: 12, cy: 12, r: 8 }]],
  joystickController: [["circle", { cx: 12, cy: 12, r: 4 }]],
};
// 官方 gamepad 图槽：id → 该按钮可以被哪几个图标槽换掉
const ICON_SLOTS = {
  joystick: ["joystickBackground", "joystickController"],
  jump: ["jump"], crouch: ["crouch"], run: [], actionA: ["actionA"], actionB: ["actionB"],
  flyButton: ["flyButton", "flyingController"],
};
const TEXT_IDS = new Set(["actionA", "actionB"]);
const STATES = [["walk", "步行状态"], ["fly", "飞行状态"]];

export function openGamepadEditor(E) { return openPlayerModal(E, "gamepad"); }

/** 读到一定是一套完整可用的布局；缺哪条状态就补默认，脏数据不炸面板。 */
export function gamepadLayout(E) {
  const meta = E.state.meta;
  const raw = meta.gamepadLayout;
  if (!raw || typeof raw !== "object") meta.gamepadLayout = cloneLayout(DEFAULT_GAMEPAD_LAYOUT);
  const out = meta.gamepadLayout;
  for (const [key] of STATES) {
    if (!Array.isArray(out[key]) || !out[key].length) out[key] = cloneLayout(DEFAULT_GAMEPAD_LAYOUT)[key];
    out[key] = out[key].map(normalizeItem).filter(Boolean);
  }
  return out;
}

export const cloneLayout = (src) => Object.fromEntries(Object.entries(src).map(([k, list]) => [k, list.map((i) => Object.assign({}, i))]));

function normalizeItem(i) {
  if (!i || typeof i !== "object" || !i.id) return null;
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  return { id: String(i.id), label: String(i.label == null ? i.id : i.label), x: num(i.x, 0), y: num(i.y, 0), size: num(i.size, 9) };
}

registerPanel("gamepad", {
  title: "虚拟按键",
  render: (ctx) => renderGamepadPanel(ctx),
});

function renderGamepadPanel(ctx) {
  const { E, el, notify } = ctx;
  const layout = gamepadLayout(E);
  let state = "walk";
  let drag = null;

  const stage = h("div", { class: "pm-stage", "data-state": state });
  const padLayer = h("div", { class: "pm-pad" });
  const seg = h("div", { class: "pm-seg" }, STATES.map(([key, label]) => h("button", {
    class: "pm-seg-item", type: "button", "data-state": key, text: label,
    onclick: () => { state = key; draw(); },
  })));
  const info = h("button", { class: "pm-info", type: "button", "aria-label": "说明", text: "i" });
  const frame = snapshotFrame(E);
  // 抓不到画面（还没进过运行模式、WebGL 上下文丢了）也要有底，否则预览区是一片黑，
  // 按钮摆在哪都看不出叠放关系
  if (frame) stage.style.backgroundImage = `url("${frame}")`;
  else stage.classList.add("no-frame");

  stage.appendChild(padLayer);
  el.replaceChildren(
    h("div", { class: "pm-h with-info", }, [h("span", { text: "虚拟按键" }), info]),
    seg,
    stage,
    h("div", { class: "pm-hint", text: `拖动按钮可改位置（${frame ? "底图取自当前视口" : "底图为占位画面"}）· 位置随本图保存` }),
  );

  info.onclick = () => popInfo(info, [
    "两种状态各自一套按钮：飞行状态才有飞行 / 降落键。",
    "按钮位置按地图保存在 meta.gamepadLayout；开关与设备上的摆放习惯存在 localStorage，两者不是一回事。",
    "想换按钮图标：「玩家」面板底部「虚拟按键图标」组，图片路径写进 meta.player.gamepad。",
  ]);

  function draw() {
    stage.dataset.state = state;
    for (const b of seg.querySelectorAll(".pm-seg-item")) b.classList.toggle("active", b.dataset.state === state);
    padLayer.replaceChildren();
    for (const item of layout[state]) padLayer.appendChild(padButton(item));
  }

  function padButton(item) {
    const cls = "pm-pad-btn" + (item.id === "joystick" ? " is-joy" : "");
    const btn = h("div", { class: cls, "data-id": item.id, title: item.label });
    btn.style.left = item.x + "%";
    btn.style.top = item.y + "%";
    btn.style.width = item.size + "%";
    if (item.id === "joystick") {
      btn.replaceChildren(
        ...["up", "right", "down", "left"].map((dir) => h("i", { class: "pm-arrow " + dir })),
        h("b", { class: "pm-knob" }),
      );
    } else if (TEXT_IDS.has(item.id)) {
      btn.replaceChildren(h("span", { class: "pm-pad-text", text: item.label || item.id.replace(/^action/, "") }));
    } else if (ICONS[item.id]) {
      btn.replaceChildren(iconSvg(ICONS[item.id], 26));
      if (item.label && item.id === "flyButton") btn.appendChild(h("span", { class: "pm-pad-cap", text: item.label }));
    } else {
      btn.replaceChildren(h("span", { class: "pm-pad-text", text: item.label || item.id }));
    }
    applyIconImage(E, btn, item.id);
    btn.addEventListener("pointerdown", (ev) => startDrag(ev, item, btn));
    return btn;
  }

  function startDrag(ev, item, btn) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    try { btn.setPointerCapture(ev.pointerId); } catch { /* 指针可能已经抬起 */ }
    drag = {
      item, btn,
      // 按住哪儿就从哪儿偏移，否则按钮会瞬间把左上角跳到指针下
      dx: ev.clientX - (r.left + (item.x / 100) * r.width),
      dy: ev.clientY - (r.top + (item.y / 100) * r.height),
      // 百分比是相对预览区算的，不记 left/top 就会把整块视口偏移一起加进去
      left: r.left, top: r.top, w: r.width, h: r.height, moved: false,
    };
    btn.classList.add("dragging");
    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointercancel", onUp);
  }
  function onMove(ev) {
    if (!drag) return;
    const { item, btn, w, h: hh } = drag;
    const sizePx = (item.size / 100) * w;
    const maxX = ((w - sizePx) / w) * 100;
    const maxY = ((hh - sizePx) / hh) * 100;
    item.x = clamp(((ev.clientX - drag.dx - drag.left) / w) * 100, 0, maxX);
    item.y = clamp(((ev.clientY - drag.dy - drag.top) / hh) * 100, 0, maxY);
    drag.moved = true;
    btn.style.left = item.x.toFixed(2) + "%";
    btn.style.top = item.y.toFixed(2) + "%";
  }
  function onUp() {
    if (!drag) return;
    const { btn, moved, item } = drag;
    btn.removeEventListener("pointermove", onMove);
    btn.removeEventListener("pointerup", onUp);
    btn.removeEventListener("pointercancel", onUp);
    btn.classList.remove("dragging");
    drag = null;
    if (!moved) return;
    item.x = round2(item.x); item.y = round2(item.y);
    E.markDirty && E.markDirty();
    notify(`已记住${labelOf(state)}的「${item.label}」位置`);
  }

  draw();
  // 卸载：收尾没抬起的拖拽，并摘掉挂在 body 上的说明气泡
  return () => {
    if (drag) onUp();
    for (const old of document.querySelectorAll(".pm-pop")) old.remove();
  };
}

const labelOf = (key) => (STATES.find(([k]) => k === key) || [])[1] || key;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * 抓一张当前视口。和 main.js 的 captureCover 同一手法：自己 render 一次再立刻 drawImage——
 * WebGL 画布没开 preserveDrawingBuffer，隔一帧去读就是空的。
 */
function snapshotFrame(E) {
  const r = E && E.renderer;
  if (!r || !r.renderer || !r.scene) return "";
  try {
    r.renderer.render(r.scene, r.activeCam || r.camera);
    const src = r.renderer.domElement;
    const W = 640, H = 360;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    // 视口不一定是 16:9，按 cover 裁，免得预览被拉扁
    const s = Math.max(W / src.width, H / src.height);
    const dw = src.width * s, dh = src.height * s;
    g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return c.toDataURL("image/jpeg", 0.72);
  } catch (err) {
    console.warn("[gamepad] 视口截图失败，预览改用占位底图", err);
    return "";
  }
}

/** 官方 gamepad 图槽有值就把按钮换成项目内图片，和运行时 _applyGamepad 同一套语义 */
function applyIconImage(E, btn, id) {
  const gp = ((E.state.meta.player || {}).gamepad) || {};
  const slots = ICON_SLOTS[id] || [];
  const raw = slots.map((s) => String(gp[s] || "")).find(Boolean);
  if (!raw) return;
  const url = pictureUrl(E, raw);
  btn.classList.add("has-icon");
  btn.dataset.iconSrc = url || raw;
  const img = h("img", { class: "pm-pad-icon", src: url || raw, alt: "" });
  // 图槽里写的路径可能指向这张图里并不存在的文件：加载失败要把原图标还原回来，
  // 不能留下一个被淡化成 18% 透明度的空圆钮
  img.addEventListener("error", () => { img.remove(); btn.classList.remove("has-icon"); });
  btn.appendChild(img);
}

// 项目内图片路径 → URL：与 features.js 界面编辑器 / 运行时 GameRuntime._assetUrl 同一条规则
function pictureUrl(E, src) {
  const s = String(src == null ? "" : src).trim();
  if (!s || /^(https?:|data:|blob:|\/)/i.test(s)) return s;
  const meta = E.state.meta || {};
  const root = meta.pictureRoot || meta.assetRoot || "";
  const rel = s.replace(/^\.\//, "");
  const pics = meta.pictureNames || [];
  if (pics.includes(rel)) return root + rel;
  if (pics.includes("picture/" + rel)) return root + "picture/" + rel;
  return root + (rel.includes("/") ? rel : "picture/" + rel);
}

function popInfo(anchor, lines) {
  for (const old of document.querySelectorAll(".pm-pop")) old.remove();
  const pop = h("div", { class: "pm-pop wide" }, lines.map((t) => h("p", { text: t })));
  const r = anchor.getBoundingClientRect();
  // 说明图标紧贴标题、离左栏很近，气泡往右开才不会盖住导航栏
  pop.style.left = Math.max(12, Math.min(innerWidth - 332, r.left - 6)) + "px";
  pop.style.top = (r.bottom + 8) + "px";
  document.body.appendChild(pop);
  const off = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchor) { pop.remove(); window.removeEventListener("pointerdown", off, true); } };
  setTimeout(() => window.addEventListener("pointerdown", off, true), 0);
}
