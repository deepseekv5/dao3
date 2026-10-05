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
import { FACE_PLACEHOLDER, facePreview, MC_PRESETS, presetUrl, readSkinFile, skinNameFrom } from "../skin-sheet.js";
import { BUILTIN_RIG_PRESETS } from "../skin-presets.js";

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
const DEFAULT_COLORS = { head: "#ffd7b0", body: "#c9714f", armL: "#c9714f", armR: "#c9714f", legL: "#6b625a", legR: "#524a44" };
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
  // 贴图是本地扩展键（官方 player.skin 只有 18 个颜色槽）。运行时按它决定走经典
  // 六面体还是细节人偶，所以"设默认"必须把它一起写过去；而选中一套没贴图的皮肤
  // 时必须清掉——不然切过去还是上一张脸。
  if (skin.texture) cur.texture = skin.texture; else delete cur.texture;
  // 骨骼皮肤同理：kind + 映射表 + 轴向 + 缩放是一组，缺一个就得整组清掉，
  // 否则运行时会拿着上一台机甲的关节名去驱动这一台。
  if (skin.kind === "rig" && skin.model) {
    cur.kind = "rig"; cur.model = skin.model; cur.bones = skin.bones || {}; cur.axes = skin.axes || {};
    if (skin.scale) cur.scale = skin.scale; else delete cur.scale;
  } else { delete cur.kind; delete cur.model; delete cur.bones; delete cur.axes; delete cur.scale; }
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

/** 发布时随记录一起送出去的封面图：三类皮肤各有各的渲染器，取哪张算哪张。 */
async function coverFor(s) {
  if (s.cover) return s.cover;
  if (s.texture) { try { return (await facePreview(s.texture)) || null; } catch { return null; } }
  return previewOf(s);
}

/** 从皮肤社区取回一套：记录与资产都复制进本地，作者之后下架不影响这张图。 */
async function importFromCommunity(E, skins, refresh, notify) {
  const m = await import("../publish-skin.js");
  let rows;
  try { rows = await m.listCommunitySkins(); } catch (err) { notify(`皮肤社区读取失败：${String((err && err.message) || err)}`, true); return; }
  if (!rows.length) { notify("皮肤社区还空着——先在任意一张卡的「⋯」里发布你的第一套"); return; }
  listDialog({
    title: "皮肤社区",
    items: rows.map((p) => ({
      label: p.title, hint: `${p.author ? p.author.name : "匿名"} · ${p.likes} 赞 · ${p.comments} 评论`, value: p,
    })),
    onPick: async (pub) => {
      notify("正在取回这套皮肤…");
      try {
        const rec = await m.importCommunitySkin(pub, E);
        const hit = skins.find((s) => s.from === pub.id && s.name === rec.name);
        if (hit) Object.assign(hit, rec, { edited: Date.now() });
        else skins.push(Object.assign(rec, { name: uniqueName(skins, rec.name) }));
        E.markDirty && E.markDirty();
        notify(`已取回「${rec.name}」`);
        refresh();
      } catch (err) { notify("取回失败：" + String((err && err.message) || err), true, 5000); }
    },
  });
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
    // 骨骼皮肤（机甲那类）的缩略图是导入时预览画布抓下来的一张 PNG；配色皮肤
    // 由 WebGL 人偶现渲；贴图皮肤取展开图的正脸。三条各有各的渲染器，不能互相喂。
    const img = h("img", { class: "pm-card-preview", src: s.cover || (s.texture ? FACE_PLACEHOLDER : previewOf(s)), alt: s.name, loading: "lazy" });
    if (s.texture && !s.cover) {
      // 贴图皮肤用展开图的正脸当缩略图：WebGL 人偶渲染器只吃颜色，喂不出这张脸
      img.classList.add("is-mc");
      img.title = "Minecraft 皮肤 · 预览取展开图的正脸";
      facePreview(s.texture).then((url) => { if (url) img.src = url; });
    } else if (s.kind === "rig") {
      img.classList.add("is-rig");
      img.title = "骨骼皮肤 · 关节映射见导入对话框";
    }
    const menuBtn = h("button", { class: "pm-card-more", type: "button", title: "更多操作", text: "⋮" });
    const entries = [
      ["设为本图默认", () => { applySkin(E, s, notify); refresh(); }],
      ["重命名", () => renameSkin(E, skins, s, refresh, notify)],
    ];
    // 回 VOXA 编辑只对从 VOXA 来的作品有意义：没有 src 就不知道开哪一份，
    // 摆一个点了只会报"模型库里没有"的按钮，比不给这个按钮更糟。
    if (s.src) entries.push(["在 VOXA 里编辑", () => { location.href = "/voxa?model=" + encodeURIComponent(s.src); }]);
    entries.push(["发布到皮肤社区", async () => {
      const c = await coverFor(s);
      import("../publish-skin.js").then((m) => m.openSkinPublishDialog(Object.assign({}, s, { cover: c }), notify));
    }]);
    entries.push(["删除", () => {
      const i = skins.indexOf(s);
      if (i >= 0) skins.splice(i, 1);
      if (!skins.length || s.default) normalizeDefault(E, skins);
      E.markDirty && E.markDirty();
      notify(`已删除「${s.name}」`);
      refresh();
    }]);
    menuBtn.onclick = () => popMenu(menuBtn, entries);
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
      h("button", {
        class: "pm-btn", type: "button", text: "MC 皮肤", title: "用随包附带的 Minecraft 皮肤做预设",
        onclick: () => pickMcPreset(E, skins, refresh, notify),
      }),
      h("button", {
        class: "pm-btn", type: "button", text: "上传皮肤图", title: "64×64 的 MC 皮肤展开图（PNG）",
        onclick: () => uploadSkinTexture(E, skins, refresh, notify),
      }),
      h("button", {
        class: "pm-btn", type: "button", text: "骨骼皮肤", title: "带骨架的 .glb 模型（机甲那类），导入时把关节映射到官方 18 个 GameBodyPart",
        onclick: () => importRigSkin(E, skins, refresh, notify),
      }),
      h("button", {
        class: "pm-btn", type: "button", text: "内置机甲", title: "随包附带的 CC0 机甲骨骼皮肤，直接穿上",
        onclick: () => listDialog({
          title: "内置骨骼皮肤",
          items: BUILTIN_RIGS.map((p) => ({ label: p.name, hint: p.hint, value: p })),
          onPick: (p) => addBuiltinRig(E, skins, refresh, notify, p),
        }),
      }),
      h("button", {
        class: "pm-btn", type: "button", text: "皮肤社区", title: "浏览别人发布的皮肤，取回一套进本图库",
        onclick: () => importFromCommunity(E, skins, refresh, notify),
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

/* ------------------------------ Minecraft 皮肤 ------------------------------ */
function addTextureSkin(E, skins, refresh, notify, opt) {
  const hit = skins.find((s) => s.texture === opt.texture);
  const skin = hit || makeSkin(uniqueName(skins, opt.name), Object.assign({}, DEFAULT_COLORS), { texture: opt.texture });
  if (!hit) { skins.push(skin); touch(skin); }
  applySkin(E, skin, notify);
  E.markDirty && E.markDirty();
  notify(hit ? `已切回「${skin.name}」` : `已加入并启用「${skin.name}」${opt.hint ? " · " + opt.hint : ""}`);
  refresh();
}

function pickMcPreset(E, skins, refresh, notify) {
  const items = MC_PRESETS.map((p) => ({ label: p.name, value: { name: p.name, texture: presetUrl(p.file) }, hint: "64×64" }));
  listDialog({ title: "Minecraft 皮肤预设", items, onPick: (v) => addTextureSkin(E, skins, refresh, notify, v) });
}

function uploadSkinTexture(E, skins, refresh, notify) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg";
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    let read;
    try { read = await readSkinFile(f); } catch (err) { notify(String(err && err.message || err), true); return; }
    // 存成 dataURL 而不是文件路径：皮肤跟着世界存档走，导出项目包、发给别人
    // 都还在；换成 /api/community/uploads/... 的话对方一断网就只剩六块素色。
    addTextureSkin(E, skins, refresh, notify, { name: skinNameFrom(f, "我的皮肤"), texture: read.dataUrl });
  };
  input.click();
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
    items: list.map((m) => ({
      label: (m.type === "skin" ? "【换肤】" : "") + (m.name || "(未命名)"),
      hint: m.type === "skin" ? `${m.parts | 0} 部件 / ${m.bones | 0} 骨骼：整套模型进库` : `${m.voxels | 0} 体素 / ${m.parts | 0} 部件：取配色`,
      value: m.name,
    })),
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
      if (doc.type === "skin") {
        try {
          const rec = await rigFromVoxa(E, skins, doc);
          const hit = skins.find((s) => s.src === rec.src);
          if (hit) Object.assign(hit, rec, { edited: Date.now() }); else skins.push(rec);
          applySkin(E, hit || rec, notify);
          E.markDirty && E.markDirty();
          notify(`已导入换肤作品「${rec.name}」并设为本图默认（在 VOXA 里改完可再同步一次）`);
          refresh();
        } catch (err) { notify("导入失败：" + String((err && err.message) || err), true); }
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

/** 换肤作品 → 骨骼皮肤：导成 .glb 落到本图素材目录，关节映射是恒等的
 *  （VOXA 那 18 根骨骼名本来就是官方 GameBodyPart）。
 *  只取配色的话，作者在小人身上画的衣服、头发、鞋就全丢了。 */
async function rigFromVoxa(E, skins, doc) {
  const painted = (doc.parts || []).some((p) => (p.voxels || []).length);
  if (doc.ref && doc.ref.model && !painted) {
    // 没涂过体素的换肤作品，"皮肤"就是它绑的那台底模：直接引用现成模型。
    // 走导出的话会得到一份只有骨骼、没有网格的 glb，穿上是个隐形人。
    return makeSkin(uniqueName(skins, doc.name), { ...DEFAULT_COLORS },
      { kind: "rig", model: doc.ref.model, bones: Object.assign({}, doc.ref.bones), src: doc.name });
  }
  const wid = E.worldId;
  if (!wid) throw new Error("先打开一张图：模型要落到本图的素材目录");
  const { toGLB, SKIN_BONES } = await import("../voxa/model.js");
  const bones = {};
  for (const b of doc.bones || []) if (SKIN_BONES.includes(b.name)) bones[b.name] = b.name;
  if (Object.keys(bones).length < 6) throw new Error("这份换肤作品的骨骼不全，导不出可穿的皮肤");
  const base = String(doc.name || "skin").replace(/[\\/:*?"<>|\s]+/g, "_");
  const rel = "models/" + base + ".skin.glb";
  const buf = await (await toGLB(doc)).arrayBuffer();
  const r = await fetch(`/api/world/${wid}/asset?path=${encodeURIComponent(rel)}`, { method: "POST", body: buf });
  if (!r.ok) throw new Error("素材写入失败 HTTP " + r.status);
  return makeSkin(uniqueName(skins, doc.name), colorsFromVoxa(doc) || { ...DEFAULT_COLORS },
    { kind: "rig", model: `/assets/worlds/${wid}/${rel}`, bones, src: doc.name });
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

/* ------------------------------ 骨骼皮肤（机甲那类） ------------------------------ */
/** 导入一台带骨架的 glTF：存进本图资产 → 认关节 → 映射表 + 走路预览 → 进皮肤库。
 *  预览必须是走路的：静着一张图，"前后摆"和"左右劈"看起来一模一样，
 *  映射错了当时看不出来，进游戏才发现角色在横着劈叉走路。 */
async function importRigSkin(E, skins, refresh, notify) {
  const R = await import("../skin-rig.js");
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".glb,.gltf,model/gltf-binary";
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const wid = E.worldId || (E.state && E.state.meta && E.state.meta.id);
    if (!wid) { notify("先打开一张图再导入骨骼皮肤：模型要存进这张图的资产目录", true); return; }
    notify("正在把模型存进本图资产…");
    let url;
    try {
      const buf = await f.arrayBuffer();
      if (buf.byteLength > 24 * 1024 * 1024) throw new Error("模型超过 24 MB 上限");
      const rel = "models/" + String(f.name).replace(/[^\w.\-一-龥]+/g, "_");
      const r = await fetch(`/api/world/${wid}/asset?path=${encodeURIComponent(rel)}`, { method: "POST", body: buf });
      if (!r.ok) throw new Error("资产写入失败：" + r.status);
      url = `/assets/worlds/${wid}/${rel}`;
    } catch (err) { notify("导入失败：" + String((err && err.message) || err), true, 5200); return; }
    let scene, names, map;
    try {
      scene = await R.loadRigScene(url);
      names = R.boneNames(scene);
      map = R.autoMap(names);
    } catch (err) { notify("这个 glb 读不出骨架：" + String((err && err.message) || err), true, 5200); return; }
    rigDialog(E, skins, refresh, notify, R, { url, names, map, fileName: f.name });
  };
  input.click();
}

function rigDialog(E, skins, refresh, notify, R, init) {
  const { url, names, fileName } = init;
  const map = Object.assign({}, init.map);
  let flip = 0, preview = null;
  const ov = overlay();
  const host = ov.box;
  const nameInp = h("input", { class: "pm-input", type: "text", value: uniqueName(skins, String(fileName).replace(/\.(glb|gltf)$/i, "") || "机甲皮肤") });
  const grid = h("div", { class: "pm-rigmap" });
  const stage = h("div", { class: "pm-rigstage" });
  const stat = h("div", { class: "pm-rigstat" });
  const SLOT_LABEL = {
    hips: "髋", torso: "胸/腰", neck: "颈", head: "头",
    leftShoulder: "左肩", leftUpperArm: "左上臂", leftLowerArm: "左小臂", leftHand: "左手",
    rightShoulder: "右肩", rightUpperArm: "右上臂", rightLowerArm: "右小臂", rightHand: "右手",
    leftUpperLeg: "左大腿", leftLowerLeg: "左小腿", leftFoot: "左脚",
    rightUpperLeg: "右大腿", rightLowerLeg: "右小腿", rightFoot: "右脚",
  };
  const rec = () => ({ model: url, bones: map, flip, scale: 1 });
  const repaint = () => {
    if (preview) preview.stop();
    stage.replaceChildren();
    preview = R.previewRig(stage, rec(), { w: 220, h: 250 });
    const miss = R.missingJoints(map);
    stat.replaceChildren(h("span", {
      text: miss.length ? `还缺：${miss.join("、")}——缺的那段不会跟着动作走` : "十个驱动挂点全部认到了，走路/跑步/腾空都会跟着动",
    }));
    for (const sel of grid.querySelectorAll("select")) sel.value = map[sel.dataset.slot] || "";
  };
  for (const slot of R.SLOTS) {
    const sel = h("select", { class: "pm-select", dataset: { slot } });
    sel.appendChild(h("option", { value: "", text: "（不映射）" }));
    for (const n of names) sel.appendChild(h("option", { value: n, text: n }));
    sel.value = map[slot] || "";
    sel.onchange = () => { map[slot] = sel.value; repaint(); };
    grid.appendChild(h("label", { class: "pm-rigrow" }, [h("span", { text: SLOT_LABEL[slot] || slot }), sel]));
  }
  const flipBtn = h("button", { class: "pm-btn", type: "button", text: "朝向反了？翻 180°" });
  flipBtn.onclick = () => { flip = flip ? 0 : -1; flipBtn.classList.toggle("on", !!flip); repaint(); };
  host.replaceChildren(
    h("div", { class: "pm-h small", text: "骨骼皮肤：关节映射" }),
    h("div", { class: "pm-rigwrap" }, [grid, h("div", { class: "pm-rigside" }, [stage, stat, flipBtn])]),
    h("label", { class: "pm-field" }, [h("span", { text: "皮肤名称" }), nameInp]),
    h("div", { class: "pm-dialog-actions" }, [
      h("button", { class: "pm-btn", type: "button", text: "取消", onclick: () => { if (preview) preview.stop(); ov.close(); } }),
      h("button", {
        class: "pm-btn primary", type: "button", text: "装进皮肤库",
        onclick: () => {
          const cover = preview ? preview.snap() : null;
          if (preview) preview.stop();
          const skin = makeSkin(uniqueName(skins, String(nameInp.value || "机甲皮肤").trim()), { ...DEFAULT_COLORS }, {
            kind: "rig", model: url, bones: { ...map }, flip: flip || undefined, cover: cover || undefined,
          });
          skins.push(skin);
          E.markDirty && E.markDirty();
          ov.close();
          notify(`已加入骨骼皮肤「${skin.name}」`);
          refresh();
        },
      }),
    ]),
  );
  repaint();
}

/* ------------------------------ 内置骨骼皮肤 ------------------------------ */
// CC0 机甲（来源与授权见 THIRD_PARTY_NOTICES.md 与 docs/credits.md）。
// 这份关节映射是实测出来的：这台模型没有 neck，其余十七个槽位一一对上，
// 走路姿态下左右脚/左右手的位移方向与经典人偶同向（tmp/rig-probe.mjs 量的）。
// 内置机甲预设挪到了 skin-presets.js：VOXA 的默认皮肤与这里必须是同一份数据，
// 否则"编辑器里的默认皮肤"和"皮肤库里那张卡"会长成两台不同的模型。
const BUILTIN_RIGS = BUILTIN_RIG_PRESETS;

async function addBuiltinRig(E, skins, refresh, notify, preset) {
  const hit = skins.find((s) => s.model === preset.model && String(s.name).startsWith(preset.name));
  const skin = hit || makeSkin(uniqueName(skins, preset.name), { ...DEFAULT_COLORS },
    { kind: "rig", model: preset.model, bones: Object.assign({}, preset.bones) });
  if (!hit) { skins.push(skin); touch(skin); E.markDirty && E.markDirty(); }
  applySkin(E, skin, notify);
  refresh();
  if (skin.cover) return;
  // 缩略图异步补：先让它上身，再等一张走路预览的截图。
  // 为了等预览而卡住点击，手感上就等于"按钮没反应"。
  const R = await import("../skin-rig.js");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  const pv = R.previewRig(host, skin, { w: 210, h: 190 });
  setTimeout(() => {
    const url = pv.snap();
    pv.stop(); host.remove();
    if (url) { skin.cover = url; refresh(); }
  }, 1200);
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

