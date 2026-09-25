// skins.js — 官方「玩家 → 项目皮肤库」弹窗。
//
// 数据落在 E.state.meta.skins（数组，跟着世界存档走），一项形如
//   { name, skin: { head, body, armL, armR, legL, legR }, default, created, edited }
// 六块颜色写回 meta.player.skin 时展开成官方 18 个 GameBodyPart 槽位。
//
// 字段口径（与现有实现的关系）：
//  · meta.player.skin —— 现有「玩家」面板（features.js buildPlayerExtras）按 18 槽写 {r,g,b}，
//    而运行时 game.js 的 skinColorOf() 只认 "#rrggbb"/"0xrrggbb" 字符串，也就是说 {r,g,b}
//    在运行期根本读不出来。这里以**运行时口径为准**写字符串：皮肤应用完在画面里真的会变。
//    代价是玩家面板那 18 个取色器会把字符串显示成黑色（features.js 的 rgbToHex 没有字符串分支），
//    接线时给它补一条 `typeof c === "string"` 即可，本面板不改动 features.js。
//  · meta.player.skinInvisible —— 隐藏部件的开关，皮肤不管这个字段，套皮肤时也不去动它。
//  · meta.gamepadLayout 在 gamepad.js 里，本文件不写。
import { h, iconSvg, toHex, renderDoll, disposeGL, openPlayerModal, registerPanel } from "./player-modal-shell.js";

// 六个本地部件 ↔ 官方 18 槽（game.js 的 PART_SLOT 反向表，那边没导出，只能自带一份）
const PARTS = [
  ["head", "头部"], ["body", "躯干"], ["armL", "左臂"], ["armR", "右臂"], ["legL", "左腿"], ["legR", "右腿"],
];
const PART_SLOTS = {
  head: ["head", "neck"], body: ["torso", "hips"],
  armL: ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"],
  armR: ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"],
  legL: ["leftUpperLeg", "leftLowerLeg", "leftFoot"],
  legR: ["rightUpperLeg", "rightLowerLeg", "rightFoot"],
};
const DEFAULT_COLORS = { head: "#ffd7b0", body: "#5aa8e8", armL: "#5aa8e8", armR: "#5aa8e8", legL: "#5b6c8e", legR: "#48566f" };
const SORTS = [["edited", "最近编辑"], ["created", "创建时间"], ["name", "名称"]];

// 预览图渲染一次就缓存：卡片可能几十张，每次刷新都重建一遍人偶会把主线程吃干净
const _previewCache = new Map();

export function openSkinLibrary(E) { return openPlayerModal(E, "skins"); }

registerPanel("skins", {
  title: "项目皮肤库",
  render: (ctx) => {
    const skins = ensureSkins(ctx.E);
    normalizeDefault(ctx.E, skins);
    return renderSkinPanel(ctx, skins);
  },
});

/* ------------------------------ 数据 ------------------------------ */
function ensureSkins(E) {
  const m = E.state.meta;
  if (!Array.isArray(m.skins)) m.skins = [];
  if (!m.skins.length) {
    m.skins.push(makeSkin("默认皮肤", colorsFromPlayer(E) || { ...DEFAULT_COLORS }, { default: true }));
    // 种子皮肤也要活下来：不标脏的话，用户只看了一眼面板、什么都没改，
    // 存盘时这张图里就还是没有皮肤
    E.markDirty && E.markDirty();
  }
  return m.skins;
}

function makeSkin(name, colors, extra) {
  const skin = {};
  for (const [k] of PARTS) skin[k] = colors[k] || DEFAULT_COLORS[k];
  return Object.assign({ name: String(name || "未命名皮肤"), skin, created: Date.now(), edited: Date.now() }, extra || {});
}

function colorsFromPlayer(E) {
  const p = (E.state.meta.player || {}).skin || {};
  const out = {};
  for (const [part] of PARTS) {
    const hex = toHex(p[PART_SLOTS[part][0]]);
    if (hex) out[part] = hex;
  }
  return Object.keys(out).length === PARTS.length ? Object.assign({}, DEFAULT_COLORS, out) : null;
}

function normalizeDefault(E, skins) {
  const flagged = skins.filter((s) => s && s.default);
  if (flagged.length > 1) for (const s of flagged.slice(1)) s.default = false;
  else if (!flagged.length && skins.length) skins[0].default = true;
}

function uniqueName(skins, base) {
  const want = String(base || "未命名皮肤").trim() || "未命名皮肤";
  if (!skins.some((s) => s.name === want)) return want;
  let i = 2;
  while (skins.some((s) => s.name === `${want}${i}`)) i++;
  return `${want}${i}`;
}

/** 把皮肤写回官方 player.skin（18 槽，字符串色值），并刷新玩家面板的取值 */
function applySkin(E, skin, notify) {
  const p = (E.state.meta.player = E.state.meta.player || {});
  const cur = (p.skin = p.skin || {});
  for (const [part] of PARTS) for (const slot of PART_SLOTS[part]) cur[slot] = skin.skin[part];
  for (const s of E.state.meta.skins) s.default = s === skin;
  E.markDirty && E.markDirty();
  // 玩家面板的取色器要重新灌一次值，否则它显示的还是上一套皮肤
  try { E.syncPlayerPanel && E.syncPlayerPanel(); } catch (err) { console.warn("[skins] 玩家面板刷新失败", err); }
  notify(`已把「${skin.name}」设为本图默认皮肤`);
}

/* ------------------------------ 面板 ------------------------------ */
function previewOf(skin) {
  const key = PARTS.map(([k]) => skin.skin[k]).join("|");
  let url = _previewCache.get(key);
  if (!url) { url = renderDoll(skin.skin, { w: 210, h: 190 }); _previewCache.set(key, url); }
  return url;
}

function renderSkinPanel(ctx, skins) {
  const { E, el, notify } = ctx;
  let sortKey = "edited", asc = false, query = "";

  const grid = h("div", { class: "pm-grid" });
  const search = h("input", { class: "pm-search", type: "search", placeholder: "搜索皮肤名称" });
  const sortSel = h("select", { class: "pm-select" }, SORTS.map(([v, t]) => h("option", { value: v, text: t })));
  const dirBtn = h("button", { class: "pm-iconbtn", type: "button", title: "切换升降序" });
  const drawDir = () => {
    dirBtn.replaceChildren(iconSvg(asc
      ? [["path", { d: "M12 19V6" }], ["path", { d: "M6.5 11.5 12 5.6l5.5 5.9" }]]
      : [["path", { d: "M12 5v13" }], ["path", { d: "M17.5 12.5 12 18.4l-5.5-5.9" }]], 16));
  };
  const refresh = () => renderGrid();

  function visible() {
    const q = query.trim().toLowerCase();
    const list = skins.filter((s) => !q || String(s.name).toLowerCase().includes(q));
    const dir = asc ? 1 : -1;
    return list.sort((a, b) => sortKey === "name"
      ? String(a.name).localeCompare(String(b.name), "zh") * dir
      : ((a[sortKey] || 0) - (b[sortKey] || 0)) * dir);
  }

  function renderGrid() {
    grid.replaceChildren();
    const list = visible();
    if (!list.length) {
      grid.appendChild(h("div", { class: "pm-empty", text: skins.length ? "没有匹配的皮肤" : "还没有皮肤，点「创建皮肤」开始" }));
      return;
    }
    for (const s of list) grid.appendChild(card(s));
  }

  function card(s) {
    const img = h("img", { class: "pm-card-preview", src: previewOf(s), alt: s.name, loading: "lazy" });
    const menuBtn = h("button", { class: "pm-card-more", type: "button", title: "更多操作", text: "⋮" });
    menuBtn.onclick = () => popMenu(menuBtn, [
      ["设为本图默认", () => { applySkin(E, s, notify); refresh(); }],
      ["重命名", () => renameSkin(E, skins, s, refresh, notify)],
      ["删除", () => {
        const i = skins.indexOf(s);
        if (i >= 0) skins.splice(i, 1);
        if (!skins.length || s.default) normalizeDefault(E, skins);
        E.markDirty && E.markDirty();
        notify(`已删除「${s.name}」`);
        refresh();
      }],
    ]);
    return h("div", { class: "pm-card" + (s.default ? " is-default" : ""), "data-skin": s.name }, [
      img,
      s.default ? h("span", { class: "pm-card-badge", text: "本图默认皮肤" }) : null,
      menuBtn,
      h("div", { class: "pm-card-name", title: s.name, text: s.name }),
    ]);
  }

  el.replaceChildren(
    h("div", { class: "pm-h", text: "项目皮肤库" }),
    h("div", { class: "pm-toolbar" }, [
      h("button", {
        class: "pm-btn", type: "button", text: "创建皮肤",
        onclick: () => createSkin(E, skins, refresh, notify),
      }),
      h("button", {
        class: "pm-btn", type: "button", text: "从素材库导入",
        onclick: () => importFromVoxa(E, skins, refresh, notify),
      }),
      dirBtn, sortSel, search,
    ]),
    grid,
  );
  sortSel.value = sortKey;
  sortSel.onchange = () => { sortKey = sortSel.value; renderGrid(); };
  search.oninput = () => { query = search.value; renderGrid(); };
  dirBtn.onclick = () => { asc = !asc; drawDir(); renderGrid(); };
  drawDir();
  renderGrid();

  return () => {
    // 弹窗关掉才释放上下文；缓存的 dataURL 留着，下次开面板不用重渲染
    closePlayerOverlays();
    disposeGL();
  };
}

/* ------------------------------ 创建 / 重命名 ------------------------------ */
function createSkin(E, skins, refresh, notify) {
  const colors = Object.assign({}, DEFAULT_COLORS, colorsFromPlayer(E) || {});
  formDialog({
    title: "创建皮肤",
    fields: [{ key: "name", label: "皮肤名称", value: uniqueName(skins, "新皮肤"), placeholder: "例如：屑坤哥" }].concat(
      PARTS.map(([k, t]) => ({ key: k, label: t, type: "color", value: colors[k] }))),
    live: (vals) => previewFor(vals),
    onOk: (vals) => {
      const name = String(vals.name || "").trim();
      if (!name) { notify("皮肤名称不能为空"); return false; }
      const skin = makeSkin(uniqueName(skins, name), PARTS.reduce((o, [k]) => (o[k] = vals[k], o), {}));
      skins.push(skin);
      touch(skin);
      E.markDirty && E.markDirty();
      notify(`已创建「${skin.name}」`);
      refresh();
    },
  });
}

function previewFor(vals) {
  const skin = { name: "", skin: PARTS.reduce((o, [k]) => (o[k] = vals[k], o), {}) };
  return h("img", { class: "pm-form-preview", src: previewOf(skin), alt: "" });
}

function renameSkin(E, skins, s, refresh, notify) {
  formDialog({
    title: "重命名皮肤",
    fields: [{ key: "name", label: "皮肤名称", value: s.name }],
    onOk: (vals) => {
      const name = String(vals.name || "").trim();
      if (!name) { notify("皮肤名称不能为空"); return false; }
      s.name = name;
      touch(s);
      E.markDirty && E.markDirty();
      notify("已重命名");
      refresh();
    },
  });
}

const touch = (s) => { s.edited = Date.now(); };

/* ------------------------------ 从 VOXA 素材库导入 ------------------------------ */
async function importFromVoxa(E, skins, refresh, notify) {
  let list;
  try {
    const r = await fetch("/api/models");
    if (!r.ok) throw new Error("接口返回 " + r.status);
    list = (await r.json()).models || [];
  } catch (err) {
    notify(`素材库读取失败：${String((err && err.message) || err)}`);
    return;
  }
  if (!list.length) { notify("素材库里还没有 VOXA 模型，先去「模型」页签建一个再导入"); return; }
  listDialog({
    title: "从素材库导入",
    items: list.map((m) => ({ label: m.name || "(未命名)", hint: `${m.voxels | 0} 体素 / ${m.parts | 0} 部件`, value: m.name })),
    onPick: async (name) => {
      let doc = null;
      try {
        const r = await fetch("/api/models/" + encodeURIComponent(name));
        if (!r.ok) throw new Error("接口返回 " + r.status);
        doc = await r.json();
      } catch (err) {
        notify(`模型「${name}」读取失败：${String((err && err.message) || err)}`);
        return;
      }
      const colors = colorsFromVoxa(doc);
      if (!colors) { notify(`模型「${name}」是空的（没有体素），取不出配色`); return; }
      const skin = makeSkin(uniqueName(skins, name), colors);
      skins.push(skin);
      E.markDirty && E.markDirty();
      notify(`已从素材库导入「${skin.name}」`);
      refresh();
    },
  });
}

/**
 * 从体素模型推一套皮肤色：按高度分带，每带取出现最多的颜色（众数，不是均值——
 * 均值会把红蓝两件衣服糊成紫色）。腿/臂再按左右分侧，两侧同色就退化成同一件裤子。
 */
function colorsFromVoxa(doc) {
  const hexes = new Map();
  for (const c of (doc && doc.palette) || []) hexes.set(c.i, /^#[0-9a-f]{3,8}$/i.test(String(c.hex)) ? c.hex : "#808080");
  const vox = [];
  for (const p of (doc && doc.parts) || []) for (const v of p.voxels || []) vox.push(v);
  if (!vox.length) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vox) {
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
  }
  const span = (maxY - minY) || 1;
  const band = (v) => (v.y - minY) / span;
  const midX = (minX + maxX) / 2;
  const mode = (list) => {
    const tally = new Map();
    for (const v of list) {
      const hex = toHex(hexes.get(v.c)) || "#808080";
      tally.set(hex, (tally.get(hex) || 0) + 1);
    }
    let best = null, n = -1;
    for (const [hex, k] of tally) if (k > n) { best = hex; n = k; }
    return best;
  };
  // VOXA 模型的体素全在第一象限，左右只能按模型自身的 X 中线劈，取不到就退回整带众数
  const pick = (lo, hi, side) => mode(vox.filter((v) => band(v) >= lo && band(v) < hi && (side == null || (v.x < midX) === (side < 0))));
  const body = pick(0.42, 0.72, null) || DEFAULT_COLORS.body;
  const out = {
    head: pick(0.78, 1.01, null) || DEFAULT_COLORS.head,
    body,
    armL: pick(0.42, 0.72, -1) || body,
    armR: pick(0.42, 0.72, 1) || body,
    legL: pick(0, 0.42, -1) || DEFAULT_COLORS.legL,
    legR: pick(0, 0.42, 1) || DEFAULT_COLORS.legR,
  };
  return out;
}

/* ------------------------------ 通用小弹窗 ------------------------------ */
// 二级弹窗（建皮肤 / 重命名 / 素材库列表）与 ⋮ 菜单都挂在 body 上、盖在玩家弹窗之上；
// 玩家弹窗的 Esc 会先问这里有没有开着的东西，否则一次 Esc 把两层一起关掉。
function overlay() {
  const mask = h("div", { class: "pm-sub-mask" });
  const close = () => {
    mask.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
  mask.addEventListener("pointerdown", (ev) => { if (ev.target === mask) close(); });
  window.addEventListener("keydown", onKey, true);
  const box = h("div", { class: "pm-dialog" });
  mask.appendChild(box);
  document.body.appendChild(mask);
  return { box, close };
}

function formDialog({ title, fields, live, onOk }) {
  const vals = {};
  const inputs = [];
  let queued = false;
  // 取色器拖动时每帧都会 input，预览是一次 WebGL 渲染，必须按帧合批
  const paint = () => {
    if (!live || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; previewHost.replaceChildren(live(vals)); });
  };
  const rows = fields.map((f) => {
    const input = h("input", { class: "pm-input", type: f.type || "text", value: f.value || "", placeholder: f.placeholder || "" });
    input.addEventListener("input", () => { vals[f.key] = input.value; paint(); });
    vals[f.key] = f.value || (f.type === "color" ? "#000000" : "");
    inputs.push(input);
    return h("label", { class: "pm-field" }, [h("span", { text: f.label }), input]);
  });
  const previewHost = h("div", { class: "pm-form-live" });
  const ov = overlay();
  const submit = () => { if (onOk(vals) !== false) ov.close(); };
  const ok = h("button", { class: "pm-btn primary", type: "button", text: "确定", onclick: submit });
  ov.box.replaceChildren(
    h("div", { class: "pm-h small", text: title }),
    h("div", { class: "pm-form" }, rows),
    previewHost,
    h("div", { class: "pm-dialog-actions" }, [h("button", { class: "pm-btn", type: "button", text: "取消", onclick: ov.close }), ok]),
  );
  if (inputs[0]) inputs[0].focus();
  ov.box.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submit(); } });
  if (live) previewHost.replaceChildren(live(vals));
}

function listDialog({ title, items, onPick }) {
  const ov = overlay();
  ov.box.replaceChildren(
    h("div", { class: "pm-h small", text: title }),
    h("div", { class: "pm-list" }, items.map((it) => h("button", {
      class: "pm-list-item", type: "button",
      onclick: () => { ov.close(); onPick(it.value); },
    }, [h("span", { class: "pm-list-name", text: it.label }), it.hint ? h("span", { class: "pm-list-hint", text: it.hint }) : null]))),
  );
}

function popMenu(anchor, entries) {
  for (const old of document.querySelectorAll(".pm-pop")) old.remove();
  const menu = h("div", { class: "pm-pop" }, entries.map(([label, fn]) => h("button", {
    class: "pm-pop-item" + (/删除/.test(label) ? " danger" : ""), type: "button", text: label,
    onclick: () => { menu.remove(); fn(); },
  })));
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, r.right - 148) + "px";
  menu.style.top = (r.bottom + 6) + "px";
  document.body.appendChild(menu);
  const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); window.removeEventListener("pointerdown", off, true); } };
  // 本次点击就是打开动作，下一帧再挂全局监听才不会立刻把自己关掉
  setTimeout(() => window.addEventListener("pointerdown", off, true), 0);
}

/** 弹窗关掉时二级弹窗和 ⋮ 菜单不能留在屏幕上（它们挂在 body，不在遮罩里面） */
export function closePlayerOverlays() {
  for (const el of document.querySelectorAll(".pm-sub-mask, .pm-pop")) el.remove();
}

