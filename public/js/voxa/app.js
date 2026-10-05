// voxa/app.js — VOXA 编辑器交互层：四种工作模式、体素工具、部件/骨骼/调色板、
// 24fps 动画时间轴、物理盒、导入导出与"导出到世界"。
import * as THREE from "../../vendor/three/three.module.js";
import { VoxaView } from "./view.js";
import {
  newDoc, newPart, newBone, newAnim, newPaletteEntry, addPart, clonePart, serialize, deserialize, stats,
  setVoxel, eraseVoxel, getVoxel, ensureColor, colorOf, removeUnusedColors, autoCrop, transformVoxels,
  floodSelect, fillRange, eraseRange, linePoints, faceCells, ensureRoom, extrude, addBone, childBones, removeBone, bindPart,
  groupParts, curAnim, createFrame, SKIN_BONES, MAX_PARTS, MAX_BOX, EASINGS, ANIM_FPS, hexToRgb, rgbToHex, toGLB, importVox,
  parseVoxPalette, refreshPhysics, invalidateIndex, bindDoc,
} from "./model.js";

import { openAiModel } from "./ai-model.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MODEL_KEY = "dao3_voxa_current";

/* 时间轴几何：骨骼名列的宽度要和 .tl-bone 的 CSS 宽度一致，
   刻度尺与轨道共用这一个数，否则秒线和段块会整体错开一截。 */
const TL_LABEL = 104;
/* 五档缓动在段块里画成的曲线形状（viewBox 24×12，左下→右上）。
   官方 animationPanel.md 只给名字，形状是照着它截图里那些块画的。 */
const EASE_PATH = {
  normal: "M0,12 L24,0",
  step: "M0,12 L12,12 L12,0 L24,0",
  in: "M0,12 Q24,12 24,0",
  out: "M0,12 Q0,0 24,0",
  inout: "M0,12 C12,12 12,0 24,0",
};

const TOOLS = {
  build: { label: "点建造", hint: "左键在命中面外侧放置体素" },
  erase: { label: "点删除", hint: "左键删除命中体素" },
  line: { label: "线建造", hint: "拖动起点→终点画一条直线体素" },
  lineDel: { label: "线删除", hint: "拖动删除一条直线" },
  face: { label: "面建造", hint: "拖动建造矩形面" },
  faceDel: { label: "面删除", hint: "拖动删除矩形面" },
  paint: { label: "色刷", hint: "左键改色" },
  bucket: { label: "油漆桶", hint: "填充相邻同色区域" },
  wand: { label: "魔棒", hint: "选中相邻同色连通块" },
  select: { label: "框选", hint: "拖动框选体素（供拉伸/删除）" },
  extrude: { label: "面拉伸", hint: "把选区沿轴挤出（滚轮改高度）" },
  move: { label: "移动部件", hint: "拖动部件在地面上移动" },
  rot: { label: "旋转部件", hint: "拖动绕 Y 旋转部件" },
  scale: { label: "缩放部件", hint: "拖动缩放部件" },
  eyedropper: { label: "吸管", hint: "取色" },
};

// 官方编辑工具栏是**左侧竖排纯图标**，且内容随模式变化（部件 6 个 / 体素 11 个 / 动画 3 个）。
// 这里用内联 SVG 而不是位图切图：矢量在任意 DPR 下都不糊，也不必带一堆小 png。
const VICO = {
  build: '<path d="M12 3.6l7 4v8.8l-7 4-7-4V7.6l7-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 3.6v4.2M12 20.4v-4.2M5 7.6l3.6 2.1M19 7.6l-3.6 2.1M5 16.4l3.6-2.1M19 16.4l-3.6-2.1" stroke="currentColor" stroke-width="1.2" opacity=".55"/><path d="M12 12.2l2.6 1.5-2.6 1.5-2.6-1.5 2.6-1.5z" fill="currentColor"/>',
  erase: '<path d="M4 16.5L12.5 8l5.5 5.5L13.5 18H6l-2-1.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 20h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12.5 8l3-3 5.5 5.5-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-2.6 2.6M12 3l2.6 2.6M12 21l-2.6-2.6M12 21l2.6-2.6M3 12l2.6-2.6M3 12l2.6 2.6M21 12l-2.6-2.6M21 12l-2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  select: '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2.4"/><path d="M8 11l2.4 2.4L15 8.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  wand: '<path d="M5 19L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2zM19 12l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7.7-1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  line: '<path d="M5 19L19 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5" cy="19" r="1.9" fill="currentColor"/><circle cx="19" cy="5" r="1.9" fill="currentColor"/>',
  lineDel: '<path d="M5 19L19 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".55"/><path d="M14 4l6 6M20 4l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  face: '<path d="M4 8l8-4 8 4-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 8v8l8 4 8-4V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  faceDel: '<path d="M4 8l8-4 8 4-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/><path d="M13 12l7 7M20 12l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  extrude: '<path d="M12 20V6M12 6l-4 4M12 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  paint: '<path d="M15.5 3.5l5 5-9.8 9.8-5.7 1.2 1.2-5.7 9.3-10.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  bucket: '<path d="M12 4.5L6.5 15H17.5L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 4.5v10.5M19 17c1 1.4 1.5 2.2 1.5 2.8a1.5 1.5 0 0 1-3 0c0-.6.5-1.4 1.5-2.8z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  eyedropper: '<path d="M13 4l7 16-4.6-4.6L10.4 20 12 6.5 13 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  rot: '<path d="M12 5.5a6.5 6.5 0 1 1-6.2 8.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 2.6l3 2.9-3 2.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  scale: '<path d="M5 19L19 5M19 5h-6M19 5v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3.5" y="15.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  partNew: '<rect x="4" y="4" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M17 17.5h4M19 15.5v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  partDup: '<rect x="3.5" y="7" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 7V5a1.5 1.5 0 0 1 1.5-1.5h7A2 2 0 0 1 18 5.5v7a1.5 1.5 0 0 1-1.5 1.5H15" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  bone: '<path d="M7 17.5a2.4 2.4 0 1 1-2.3-3.2 2.4 2.4 0 1 1 3.2-2.3L14 6.2a2.4 2.4 0 1 1 3.1-3.1 2.4 2.4 0 1 1 2.3 3.2 2.4 2.4 0 1 1-3.2 2.3L10 15.4a2.4 2.4 0 1 1-3 2.1z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  person: '<circle cx="12" cy="6" r="2.8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6.5 21v-4.2a5.5 5.5 0 0 1 11 0V21M9 12.5l3 2 3-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  run: '<circle cx="14" cy="5" r="2.2" fill="currentColor"/><path d="M13 8.5l-3.4 2.2.8 4.1-2.9 5.4M13 8.5l3.6 1.6 2.9-1.1M9.6 10.7L6 12.4M10.4 14.8l4.2 1.2 1.3 4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  cube: '<path d="M12 3.5l7.2 4.2v8.6L12 20.5l-7.2-4.2V7.7L12 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  hitbox: '<path d="M12 3.5l7.2 4.2v8.6L12 20.5l-7.2-4.2V7.7L12 3.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  shirt: '<path d="M8.5 4L5 6l1.6 3.2L8.5 8v11h7V8l1.9 1.2L19 6l-3.5-2a3.5 3.5 0 0 1-7 0z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  scissors: '<circle cx="6.5" cy="17.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6.5" cy="6.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.6 8.2L19 18M8.6 15.8L19 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  local: '<path d="M12 12V4M12 12H4M12 12l7 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>',
  world: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.6 12h16.8M12 3.6c2.6 2.4 2.6 14.4 0 16.8M12 3.6c-2.6 2.4-2.6 14.4 0 16.8" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  undo: '<path d="M9 14L4 9l5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 0 1 0 12h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  redo: '<path d="M15 14l5-5-5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9H10a6 6 0 0 0 0 12h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  chart: '<path d="M4 20V9M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  bulb: '<path d="M9 17h6M10 20h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 3a6 6 0 0 1 3.6 10.8V15H8.4v-1.2A6 6 0 0 1 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  box: '<path d="M12 4.5l6.5 3.8v7.4L12 19.5l-6.5-3.8V8.3L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" stroke-width="1.5"/>',
  target: '<circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  folder: '<path d="M3.5 6.5h6l2 2.5h9V19a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19V6.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
};
const svgIco = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${VICO[k] || ""}</svg>`;

class VoxaApp {
  constructor() {
    // 社区作品页的「在 VOXA 里打开」把模型 JSON 暂存到 sessionStorage 再跳过来。
    // 这条交接以前只有写、没有读：跳过来看到的还是自己上一份作品，
    // 用户以为"打不开别人的模型"。读一次就立刻清掉，免得刷新时又盖回来。
    const handoff = sessionStorage.getItem("ly_voxa_import");
    if (handoff) {
      sessionStorage.removeItem("ly_voxa_import");
      try { this.doc = deserialize(JSON.parse(handoff)); }
      catch { this.doc = this.loadLocal() || newDoc(); this.toast("社区模型读不进来，已打开本地作品"); }
    } else {
      this.doc = this.loadLocal() || newDoc();
    }
    this.doc.parts.forEach((p) => bindDoc(p, this.doc));
    if (!this.doc.parts.length) this.seedStarterPart();
    this.view = new VoxaView($("vxCanvas"), this.doc);
    this.mode = "model";
    this.tool = "build";
    this.inPart = false;   // 官方分「部件层 / 体素层」两档，双击部件才进入体素层
    this.space = "local";  // 局部 / 世界坐标
    this.activePart = this.doc.parts[0] || null;
    this.activeBone = this.doc.bones[0] || null;
    this.color = this.doc.palette[0];
    this.selection = [];
    this.picked = new Set();   // Cmd/Ctrl 挑中的部件，编组用
    this.frame = 0;
    this.tl = { pxf: 7 };   // 时间轴：每帧多少像素（缩放滑条改的就是它）
    this.pivotMode = false;   // 中心点编辑态（顶栏那颗按钮开）
    this.playing = 0;
    this.speed = 1;
    this.undoStack = [];
    this.redoStack = [];
    // 官方口径：右键转视角、中键平移，左键留给工具
    this.view.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.bindUI();
    this.renderAll();
    this.view.setActivePart(this.activePart);
    this.view.focus();
    this.view.onFrame = () => { if (this.playing) this._tickPlay(); };
    this.applyDocType();
    this.applyMode();
  }
  /* ---------------- 初始内容 ---------------- */
  seedStarterPart() {
    const p = newPart("Body", [8, 8, 8]);
    addPart(this.doc, p);
    const c = this.doc.palette[0].i;
    fillRange(p, [2, 0, 2], [5, 5, 5], c);
    this.activePart = p;
  }
  /* ---------------- 撤销 ---------------- */
  snapshot(label) {
    this.undoStack.push(JSON.stringify(serialize(this.doc)));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this._label = label;
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(serialize(this.doc)));
    this.restore(JSON.parse(this.undoStack.pop()));
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(serialize(this.doc)));
    this.restore(JSON.parse(this.redoStack.pop()));
  }
  restore(raw) {
    const id = this.activePart && this.activePart.id;
    const bid = this.activeBone && this.activeBone.id;
    this.doc = deserialize(raw);
    this.activePart = this.doc.parts.find((p) => p.id === id) || this.doc.parts[0] || null;
    // 骨骼也要重新解析：deserialize 换的是整份文档，还攥着旧对象的话，
    // 动画模式下撤销一步之后参数面板读写的是那根"已经不在文档里"的骨骼——
    // 数字看着动了，画面和存盘都不跟着走。
    this.activeBone = this.doc.bones.find((b) => b.id === bid) || this.doc.bones[0] || null;
    this.view.setDoc(this.doc);
    this.selection = [];
    this.renderAll();
  }

  /* ---------------- UI 绑定 ---------------- */
  bindUI() {
    const cv = $("vxCanvas");
    // 高亮层容量有限，超出时由渲染层回一句，别让用户自己猜"是不是没选中"
    this.view.onClamp = (total, drawn) => this.tip(`选区 ${total} 格，高亮只画前 ${drawn} 格（选中的都还在，操作照常）`);
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    // 官方三篇 shortcutKeys 整篇讲的都是鼠标右键：未选中时右键是创建菜单，
    // 选中时是部件编辑菜单，骨骼列表右键有"添加子骨骼"。我们以前只 preventDefault，
    // 于是那套交互模型整个不存在。右键同时是"转视角"，所以按着拖过就不算要菜单。
    let rmb = null;
    cv.addEventListener("pointerdown", (e) => { if (e.button === 2) rmb = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener("pointerup", (e) => {
      if (e.button !== 2 || !rmb) return;
      const moved = Math.hypot(e.clientX - rmb.x, e.clientY - rmb.y);
      rmb = null;
      if (moved > 4) return;
      this.contextMenu(e);
    });
    cv.addEventListener("pointerdown", (e) => this.onDown(e));
    cv.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    cv.addEventListener("wheel", (e) => { if (this.tool === "extrude") { e.preventDefault(); this._extrudeH = clamp((this._extrudeH || 1) + (e.deltaY < 0 ? 1 : -1), -8, 8); this.tip(`挤出高度 ${this._extrudeH}`); } }, { passive: false });

    document.querySelectorAll(".vx-tab").forEach((b) => (b.onclick = () => {
      document.querySelectorAll(".vx-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      this.mode = b.dataset.mode;
      this.applyMode();
    }));
    $("vxName").value = this.doc.name;
    $("vxName").oninput = () => { this.doc.name = $("vxName").value || "未命名模型"; this.dirty(); };
    $("vxMenu").onclick = (e) => { e.stopPropagation(); $("vxMenuPanel").classList.toggle("show"); };
    document.addEventListener("click", () => $("vxMenuPanel").classList.remove("show"));
    $("vxMenuPanel").onclick = (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act) this.menu(act);
    };
    $("vxSave").onclick = () => this.save();
    $("vxPublish").onclick = () => this.publish();
    $("vxAddPart").onclick = () => {
      if (this.doc.parts.length >= MAX_PARTS) return this.tip(`部件已到 ${MAX_PARTS} 个上限，先删掉一些`);
      this.snapshot("新建部件");
      addPart(this.doc, newPart("Object" + (this.doc.parts.length + 1), [8, 8, 8]));
      this.activePart = this.doc.parts[this.doc.parts.length - 1];
      this.view.rebuild(); this.renderAll();
    };
    $("vxDupPart").onclick = () => {
      if (!this.activePart) return;
      if (this.doc.parts.length >= MAX_PARTS) return this.tip(`部件已到 ${MAX_PARTS} 个上限，先删掉一些`);
      this.snapshot("复制部件");
      const c = clonePart(this.doc, this.activePart);
      // 副本原来与原件 pos 完全相同：叠在一起，看不见、也选不中，只得多出一个同名部件
      c.pos = [c.pos[0] + c.size[0], c.pos[1], c.pos[2]];
      this.activePart = c;
      this.view.rebuild(); this.renderAll(); this.syncSizeBoxes();
    };
    $("vxGroup").onclick = () => {
      const picked = [...this.picked];
      if (picked.length < 2) return this.tip("先按住 ⌘/Ctrl 点选两个以上部件再编组");
      this.snapshot("编组");
      groupParts(this.doc, picked, "Group" + ((this.doc.groups || []).length + 1));
      this.picked.clear();
      this.tip(`已把 ${picked.length} 个部件编为一组`);
      this.renderParts();
    };
    $("vxAddBone").onclick = () => { this.snapshot("新建骨骼"); const b = addBone(this.doc, "Bone", this.activeBone); this.activeBone = b; this.view.buildBones(); this.renderAll(); };
    $("vxSkinTemplate").onclick = () => this.loadSkinTemplate();
    // 按钮的 title 写的是"增加颜色组"，实现就必须真的建一个组：
    // 以前它往平铺列表里塞一个色块，于是官方那块"多色组色板"永远做不出来。
    $("vxAddColor").onclick = () => this.addColorGroup();
    $("vxCleanColors").onclick = () => { this.snapshot("清除未用颜色"); removeUnusedColors(this.doc); this.renderPalette(); this.view.rebuild(); };
    $("vxPalExport").onclick = () => this.exportPalette();
    $("vxPalImport").onclick = () => $("vxPalFile").click();
    $("vxPalFile").onchange = (e) => this.importPalette(e.target.files && e.target.files[0]);
    $("vxAnimNew").onclick = () => { this.snapshot("新建动画"); this.doc.anims.push(newAnim("anim" + (this.doc.anims.length + 1))); this.doc.curAnim = this.doc.anims.length - 1; this.renderTimeline(); this.dirty(); };
    $("vxAnimDel").onclick = () => {
      if (this.doc.anims.length <= 1) return;
      if (!confirm(`删除动画「${curAnim(this.doc).name}」？它的全部关键帧都会没了。`)) return;
      this.snapshot("删除动画");
      this.doc.anims.splice(this.doc.curAnim, 1); this.doc.curAnim = 0; this.renderTimeline(); this.dirty();
    };
    $("vxPlay").onclick = () => { this.playing = 1; };
    $("vxPlayRev").onclick = () => { this.playing = -1; };
    $("vxToStart").onclick = () => { this.playing = 0; this.setFrame(0); };
    $("vxToEnd").onclick = () => { this.playing = 0; this.setFrame(Math.max(0, this.view.frameBounds())); };
    $("vxSpeed").onclick = () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1; $("vxSpeed").textContent = this.speed + "x"; };
    $("vxKey").onclick = () => this.keyframe();
    $("vxScrub").oninput = () => { this.setFrame(Number($("vxScrub").value)); };
    $("vxTlZoom").oninput = () => {
      this.tl.pxf = Number($("vxTlZoom").value);
      this.renderTimeline();
    };
    // 官方：时间轴空白处按住中键拖动 = 平移时间轴
    $("vxTlScroll").addEventListener("pointerdown", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const sc = e.currentTarget, x0 = e.clientX, l0 = sc.scrollLeft;
      const mv = (ev) => { sc.scrollLeft = l0 - (ev.clientX - x0); };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    });
    // 在刻度尺上按下并拖动 = 直接拨播放头（比去够底部那根 14px 的滑条容易得多）
    $("vxRuler").addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sc = $("vxTlScroll"), max = Number($("vxScrub").max) || 0;
      const at = (cx) => this.setFrame(clamp(Math.round((cx - sc.getBoundingClientRect().left - TL_LABEL + sc.scrollLeft) / this.tl.pxf), 0, max));
      at(e.clientX);
      const mv = (ev) => at(ev.clientX);
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    });
    this.wireChrome();
    window.addEventListener("keydown", (e) => {
      // 部件/骨骼/动画改名走的是 contentEditable 的 <span>，它不是 INPUT。
      // 只挡 INPUT/TEXTAREA/SELECT 的话，给部件起名打到 "b" 就顺手把工具切成了点建造，
      // 打个 "s" 变框选，按 Delete 还会把选区删掉——名字改一半，模型也坏一半。
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); this.save(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "d") { e.preventDefault(); $("vxDupPart").click(); return; }
      const map = { b: "build", e: "erase", l: "line", f: "face", g: "paint", k: "bucket", w: "wand", s: "select", x: "extrude", m: "move", r: "rot", t: "scale", i: "eyedropper" };
      if (map[k] && !e.ctrlKey && !e.metaKey) { this.setTool(map[k]); }
      if (k === "delete") {
        // 动画模式下 Delete 删的是"当前帧上这根骨骼的键"，不是体素选区：
        // 同一个键要跟当前语境走，否则在时间轴上按删除会把模型删了。
        const anim = curAnim(this.doc);
        const keys = this.mode === "anim" && this.activeBone && anim && anim.tracks[this.activeBone.id];
        const at = keys && keys.find((x) => x.f === this.frame);
        if (at) { e.preventDefault(); this.deleteKey(anim, this.activeBone, at); return; }
        if (this.selection.length) this.applySelectionOp("erase");
      }
      // 逐帧步进：官方文档通篇只写鼠标操作，没有键位，这一对是我们自己加的便利
      if (this.mode === "anim" && (k === "arrowleft" || k === "arrowright")) {
        e.preventDefault();
        this.setFrame(clamp(this.frame + (k === "arrowright" ? 1 : -1), 0, Number($("vxScrub").max) || 0));
      }
      if (k === "escape") { if (this.pivotMode) { this.setPivotMode(false); return; } if (this.inPart) this.setInPart(false); else if (this.selection.length) { this.selection = []; this.view.showSelection([]); } }
    });
    window.addEventListener("resize", () => this.view.resize());
  }
  /** 官方把镜像/旋转/翻转放在顶栏、把撤销重做和视口开关放在底栏，这里接上这些新位置 */
  wireChrome() {
    document.querySelectorAll("[data-vico]").forEach((el) => { el.innerHTML = svgIco(el.dataset.vico); });

    // 顶栏：镜像 / 旋转 / 翻转 的 X Y Z
    const op = (kind, axisIdx) => {
      if (!this.inPart) return this.tip("请先双击部件进入体素编辑");
      this.voxOp((p) => transformVoxels(p, kind, axisIdx));
      this.syncSizeBoxes();
    };
    const bind = (gid, kind) => {
      $(gid).querySelectorAll("button[data-axis]").forEach((b) => {
        b.onclick = () => op(kind, ["x", "y", "z"].indexOf(b.dataset.axis));
      });
    };
    bind("grpMirror", "mirror"); bind("grpRotate", "rot"); bind("grpFlip", "flip");

    // 部件框大小：三个数字框直接改 activePart.size
    for (const [id, i] of [["boxX", 0], ["boxY", 1], ["boxZ", 2]]) {
      $(id).onchange = () => {
        const p = this.activePart; if (!p) return;
        const want = Math.round(Number($(id).value) || 1);
        if (want > MAX_BOX) { this.tip(`部件框单边最多 ${MAX_BOX}`); this.syncSizeBoxes(); return; }
        this.snapshot("部件框大小");
        p.size[i] = Math.max(1, want);
        this.view.rebuild(); this.syncSizeBoxes(); this.renderProps(); this.renderStat();
      };
    }
    $("vxCrop").onclick = () => {
      const p = this.activePart; if (!p) return this.tip("请先选中部件");
      this.snapshot("裁剪"); autoCrop(p); this.view.rebuild(); this.renderProps(); this.syncSizeBoxes();
    };

    $("vxBack").onclick = () => this.setInPart(false);
    // 顶栏的碰撞盒模式（官方放在这里，不是浮层里的下拉框）
    $("grpPhMode").querySelectorAll("button[data-ph]").forEach((b) => {
      b.onclick = () => {
        this.doc.physics.mode = b.dataset.ph;
        refreshPhysics(this.doc);
        $("grpPhMode").querySelectorAll("button[data-ph]").forEach((x) => x.classList.toggle("on", x === b));
        this.renderPhysics(); this.renderProps(); this.dirty();
      };
    });
    // 官方：双击部件进入体素编辑
    this.view.canvas.addEventListener("dblclick", (ev) => {
      const hit = this.view.pickVoxel(ev);
      if (hit && hit.part) { this.activePart = hit.part; this.view.setActivePart(hit.part); this.renderParts(); }
      if (this.activePart) this.setInPart(true);
    });

    // 局部 / 世界坐标
    const setSpace = (s) => {
      this.space = s;
      $("spLocal").classList.toggle("on", s === "local");
      $("spWorld").classList.toggle("on", s === "world");
      $("propSpace").textContent = s === "local" ? "局" : "世";
      this.renderProps();
    };
    $("vxPivot").onclick = () => this.setPivotMode(!this.pivotMode);
    $("spLocal").onclick = () => setSpace("local");
    $("spWorld").onclick = () => setSpace("world");
    $("propSpace").onclick = () => setSpace(this.space === "local" ? "world" : "local");

    // 底栏
    $("uUndo").onclick = () => this.undo();
    $("uRedo").onclick = () => this.redo();
    $("vxProj").onchange = () => this.view.setOrtho($("vxProj").value === "ortho");
    $("vxEdge").onchange = () => this.setEdges($("vxEdge").value);
    // 绑定完立刻把 DOM 上的初值推给渲染层：以前只有点击才会推，于是
    // "下拉框写着显示边缘线而画面上没有线"、"发光按钮没亮而自发光在渲染"，
    // 用户读到的是"要点两下才生效"——看起来就是功能坏了。
    const tgl = (id, fn) => {
      const b = $(id);
      const apply = (on) => { b.classList.toggle("on", on); fn(on); };
      b.onclick = () => apply(!b.classList.contains("on"));
      apply(b.classList.contains("on"));
    };
    // 下拉框没有 class 可同步，单独推一次：默认值写着"显示边缘线"而 view 里是
    // undefined，症状同样是"要点两下才生效"。
    this.setEdges($("vxEdge").value);
    tgl("uBone", (on) => this.view.setBoneVisible(on));
    tgl("uBox", (on) => this.view.setBoxesVisible(on));
    tgl("uGrid", (on) => { this.view.grid.visible = on; });
    tgl("uGlow", (on) => this.setGlow(on));
    tgl("uStat", (on) => { $("vxStat").style.display = on ? "" : "none"; });
    $("uReset").onclick = () => this.view.focus();
    $("vxZoom").oninput = () => {
      const pct = Number($("vxZoom").value);
      $("vxZoomVal").textContent = pct + "%";
      this.view.camera.zoom = Math.max(0.2, pct / 100);
      this.view.camera.updateProjectionMatrix();
    };

    // 面板折叠
    document.querySelectorAll(".vx-sect-h .tri").forEach((t) => {
      t.onclick = () => t.closest(".vx-sect").classList.toggle("closed");
    });

    this.wireHsv();
    setSpace("local");
  }

  /** 色板下方的 HSV 取色块 + 色相条 + HEX/RGB，对齐官方色板 */
  wireHsv() {
    const cv = $("hsvArea"), ctx = cv.getContext("2d");
    const knob = document.createElement("span"); knob.className = "knob"; $("vxHsv").appendChild(knob);
    const paint = (hue) => {
      const w = cv.width, h = cv.height;   // 别写反：反了只会画出左边一条 96px 的方块
      const base = ctx.createLinearGradient(0, 0, w, 0);
      base.addColorStop(0, "#fff"); base.addColorStop(1, `hsl(${hue},100%,50%)`);
      ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      const sh = ctx.createLinearGradient(0, 0, 0, h);
      sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "#000");
      ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h);
    };
    const at = (e) => {
      const c = this.color; if (!c) return;
      const r = cv.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
      const hue = Number($("vxHue").value);
      const [R, G, B] = hsvToRgb(hue / 360, x, 1 - y);
      c.hex = rgb255ToHex(R, G, B);
      knob.style.left = (x * 100) + "%"; knob.style.top = (y * 100) + "%";
      this.applyColorEdit();
    };
    cv.addEventListener("pointerdown", (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); this.snapshot("改色"); at(e); });
    cv.addEventListener("pointermove", (e) => { if (e.buttons === 1) at(e); });
    $("vxHue").addEventListener("pointerdown", () => { this.snapshot("改色"); }, true);
    $("vxHue").oninput = () => {
      const hue = Number($("vxHue").value);
      paint(hue);
      // 以前这条只重画了色相条自己的渐变，顺手 syncColorFields() 又把滑块拽回
      // 当前颜色的色相上——于是色相条根本改不了颜色，拖着它只是在原地抖动。
      const c = this.color;
      if (c) {
        const [R, G, B] = hexTo255(c.hex);
        const [s, y] = rgbToSv(R, G, B);
        c.hex = rgb255ToHex(...hsvToRgb(hue / 360, s, 1 - y));
        this.applyColorEdit();
      } else this.syncColorFields();
    };
    for (const id of ["cHex", "cR", "cG", "cB"]) {
      $(id).onchange = () => {
        const c = this.color; if (!c) return;
        if (id === "cHex") { if (/^#[0-9a-fA-F]{6}$/.test($(id).value)) c.hex = $(id).value.toLowerCase(); }
        else {
          const [R, G, B] = hexTo255(c.hex);
          const v = { cR: R, cG: G, cB: B };
          v[id] = clamp(Math.round(Number($(id).value) || 0), 0, 255);
          c.hex = rgb255ToHex(v.cR, v.cG, v.cB);
        }
        this.applyColorEdit();
      };
    }
    // 发光滑块：以前每滑一格都"先改值、后拍快照"，一次拖动烧掉几十上百个撤销位，
    // 而且拍的是改完的状态，按一次 Ctrl+Z 撤回来的还是刚设的值——等于没有撤销。
    // 现在按下时拍一次，拖动过程中只改值。
    $("vxGlow").addEventListener("pointerdown", () => { this.snapshot("发光"); }, true);
    $("vxGlow").addEventListener("keydown", () => { this.snapshot("发光"); }, true);
    $("vxGlow").oninput = (e) => {
      const c = this.color; if (!c) return;
      c.emissive = Number(e.target.value) / 100;
      $("vxGlowVal").textContent = Math.round(c.emissive * 100) + "%";
      this.view.rebuildPart && this.view.rebuildPart(this.activePart);
      this.renderPalette(true);
    };
    this._paintHsv = paint;
    this._knob = knob;
  }
  applyColorEdit() {
    this.syncColorFields();
    this.view.rebuildPart && this.view.rebuildPart(this.activePart);
    this.renderPalette(true);
  }
  syncColorFields() {
    const c = this.color; if (!c) return;
    const [R, G, B] = hexTo255(c.hex);
    $("cHex").value = c.hex.toUpperCase();
    $("cR").value = R; $("cG").value = G; $("cB").value = B;
    const hue = rgbHue(R, G, B);
    $("vxHue").value = hue;
    this._paintHsv && this._paintHsv(hue);
    const [x, y] = rgbToSv(R, G, B);
    if (this._knob) { this._knob.style.left = (x * 100) + "%"; this._knob.style.top = (y * 100) + "%"; }
  }
  menu(act) {
    switch (act) {
      case "home":
        // 不需要离开前确认：dirty() 每次都 saveLocal() 落 localStorage，没有未保存态
        location.href = "/";
        break;
      case "new": this.newDocFlow(); break;
      case "save": this.save(); break;
      case "open": this.pickFile(".voxa,.json", (f) => this.openFile(f)); break;
      case "importVox": this.pickFile(".vox", (f) => this.importVoxFile(f)); break;
      case "exportGlb": this.exportGlb(); break;
      case "publish": this.publish(); break;
      case "publishModel": this.publishModel(); break;
      case "undo": this.undo(); break;
      case "redo": this.redo(); break;
      case "saveVersion": this.pushHistory("手动存档"); break;
      case "versions": this.showHistory(); break;
      case "extLoad": this.loadExternal(); break;
      case "extToggle": this.toggleExternal(); break;
      case "extClear": this.view.clearExternal(); this._extDoc = null; this.tip("已清除外部参照"); break;
      case "shareCode": this.shareCode(); break;
      case "pasteCode": this.pasteCode(); break;
      case "aiModel": openAiModel(this); break;
      case "toggleBones": this.view.setBoneVisible(!this.view.showBones); break;
      case "toggleBoxes": this.view.setBoxesVisible(!this.view.showBoxes); break;
      case "grid": this.view.grid.visible = !this.view.grid.visible; break;
      case "resetView": this.view.focus(); break;
    }
  }
  pickFile(accept, cb) {
    const inp = $("vxFile");
    inp.accept = accept;
    inp.onchange = () => { const f = inp.files[0]; if (f) cb(f); inp.value = ""; };
    inp.click();
  }
  applyMode() {
    const anim = this.mode === "anim", phys = this.mode === "physics";
    const vox = this.mode === "model" && this.inPart;
    $("vxTimeline").classList.toggle("show", anim);
    // 官方物理界面：模式在顶栏，参数在右侧「参数」面板，没有浮层
    $("grpPhMode").hidden = !phys;
    for (const id of ["grpMirror", "grpRotate", "grpFlip", "grpSize"]) $(id).hidden = !vox;
    $("grpSpace").hidden = vox || phys || anim;
    $("vxBack").hidden = !vox;
    $("sectPalette").style.display = phys ? "none" : "";
    $("sectList").style.display = phys ? "none" : "";
    $("vxVoxOps").style.display = vox ? "" : "none";
    this.view.setGhostMode(phys);
    if (anim) { this.renderTimeline(); this.setFrame(this.frame); }
    if (phys) { refreshPhysics(this.doc); this.renderPhysics(); }
    this.buildTools();
    this.syncSizeBoxes();
    this.renderProps();
  }
  /** 换肤是作品类型而不是编辑器模式：它只影响新建时的模板与可用操作 */
  /** 官方新建对话框：自由模式 / 换肤模式，类型一旦定下不可修改，所以必须问清楚 */
  newDocFlow() {
    const pick = window.prompt("新建模型\n1 = 自由模式（不设限，支持自定义动画）\n2 = 换肤模式（做玩家皮肤，载入 18 节点人形模板，类型创建后不可更改）", "1");
    if (pick === null) return;
    const type = String(pick).trim() === "2" ? "skin" : "free";
    if (!confirm("新建模型会清空当前内容，确定？")) return;
    this.doc = newDoc(type === "skin" ? "换肤作品" : "未命名模型", type);
    this.activePart = null; this.inPart = false;
    this.view.setDoc(this.doc);
    if (type === "skin") this.loadSkinTemplate(true);
    else this.seedStarterPart();
    this.applyDocType();
    this.renderAll();
    this.tip(type === "skin" ? "已新建换肤作品（类型不可更改）" : "已新建自由模式作品");
  }
  applyDocType() {
    // 官方：换肤模式下"调整模型中心点"置灰
    const pv = $("vxPivot");
    if (pv) { pv.disabled = this.doc.type === "skin"; pv.classList.toggle("dim", pv.disabled); }
    const skin = this.doc.type === "skin";
    const b = $("vxTypeBadge");
    b.textContent = skin ? "换肤模式" : "自由模式";
    b.classList.toggle("skin", skin);
    b.title = skin
      ? "换肤作品：仅可修改皮肤部件内容与各部件绑定骨骼节点的偏移，类型创建后不可更改"
      : "自由模式：不设限创作模式，支持自定义动画";
  }
  /** 把当前部件框尺寸回填到顶栏的三个数字框 */
  syncSizeBoxes() {
    const p = this.activePart;
    if (!p) return;
    $("boxX").value = p.size[0]; $("boxY").value = p.size[1]; $("boxZ").value = p.size[2];
  }
  /** 拖动中只改数值，不重建面板；正在输入的那个框不碰，免得把玩家打到一半的字吞掉 */
  syncPropVecs() {
    if (!this._vecSrc) return;
    for (const inp of document.querySelectorAll("#vxProps .vx-vec[data-vec]")) {
      if (inp === document.activeElement) continue;
      const arr = this._vecSrc[inp.dataset.vec];
      if (!arr) continue;
      const v = arr();
      const i = inp.dataset.i;
      inp.value = i == null ? v.map((x) => +x.toFixed(2)).join(", ") : String(+v[Number(i)].toFixed(2));
    }
  }
  syncPhysicsFields() {
    if (!this._phFields) return;
    for (const inp of document.querySelectorAll("#vxProps input[data-ph]")) {
      if (inp === document.activeElement) continue;
      const arr = this._phFields[inp.dataset.ph];
      if (arr) inp.value = +arr()[Number(inp.dataset.i) ?? 0].toFixed(2);
    }
  }

  /* ---------------- 编辑工具栏（左侧竖排图标） ---------------- */
  // 官方三套竖栏内容不同：部件层 6 个、体素层 11 个、动画层 3 个，
  // 且体素层要先「进入部件」才出现（视口左上角的 ← 返回 就是退出）。
  static RAIL_PART = [
    ["move", "move"], ["rot", "rot"], ["scale", "scale"], ["-", "-"],
    ["partNew", "newPart"], ["partDup", "dupPart"], ["bone", "addBone"], ["enter", "enterPart"],
  ];
  // 点建造 / 点删除是体素编辑最常用的两个工具，却只挂在 B 与 E 键上没有按钮：
  // 而默认工具恰好就是 build，于是第一次进体素层时左栏一个都不高亮，
  // 看起来就像"没有选中的工具，那左键该干什么？"
  static RAIL_VOXEL = [
    ["build", "build"], ["erase", "erase"], ["-", "-"],
    ["move", "move"], ["select", "select"], ["wand", "wand"], ["line", "line"], ["lineDel", "lineDel"],
    ["face", "face"], ["faceDel", "faceDel"], ["extrude", "extrude"], ["bucket", "bucket"],
    ["paint", "paint"], ["eyedropper", "eyedropper"],
  ];
  static RAIL_ANIM = [["move", "move"], ["rot", "rot"], ["scale", "scale"]];
  // 官方物理界面左侧只有两个图标：移动 + 缩放（碰撞盒不能旋转，旋转由实体承载）
  static RAIL_PHYSICS = [["move", "move"], ["scale", "scale"]];

  buildTools() {
    const host = $("vxTools");
    host.innerHTML = "";
    const list = this.mode === "anim" ? VoxaApp.RAIL_ANIM
      : this.mode === "physics" ? VoxaApp.RAIL_PHYSICS
        : (this.inPart ? VoxaApp.RAIL_VOXEL : VoxaApp.RAIL_PART);
    for (const [ico, act] of list) {
      if (ico === "-") {
        const s = document.createElement("span"); s.className = "vx-sep"; host.appendChild(s); continue;
      }
      const b = document.createElement("button");
      const isTool = !!TOOLS[act];
      b.className = "vx-tool" + (isTool && this.tool === act ? " active" : "");
      b.innerHTML = svgIco(ico);
      b.title = isTool ? TOOLS[act].label + " · " + TOOLS[act].hint : ({
        newPart: "新建部件", dupPart: "复制部件", addBone: "创建独立骨骼", enterPart: "进入部件（体素编辑）",
      }[act] || act);
      b.onclick = () => this.railAct(act);
      host.appendChild(b);
    }
  }
  railAct(act) {
    if (TOOLS[act]) return this.setTool(act);
    if (act === "enterPart") return this.setInPart(true);
    if (act === "newPart") return $("vxAddPart").click();
    if (act === "dupPart") return $("vxDupPart").click();
    if (act === "addBone") return $("vxAddBone").click();
  }
  setInPart(on) {
    if (on && !this.activePart) return this.tip("先选中一个部件");
    this.inPart = !!on;
    if (on && !TOOLS[this.tool]) this.tool = "build";
    if (!on && this.inPart === false && ["build", "erase", "line", "lineDel", "face", "faceDel", "paint", "bucket", "wand", "extrude"].includes(this.tool)) this.tool = "move";
    this.applyMode();
    this.tip(on ? "已进入部件：" + this.activePart.name : "已返回部件列表");
  }
  setTool(id) { this.tool = id; this.buildTools(); this.tip(TOOLS[id] ? TOOLS[id].hint : id); }
  /** 三档：hide / contour（只画暴露面的外边界）/ all（每个立方体 12 条棱） */
  setEdges(mode) {
    // 状态记在 view 上：rebuildPart 每次都会新建材质，只往旧节点上写一遍是留不住的
    this.view.setEdgeMode(mode);
  }
  toggleEdges() { this.setEdges(this.view.edgeMode === "hide" ? "contour" : "hide"); }
  /** 底栏的发光开关：隐藏 emissive 层即可实时看到关掉自发光的效果 */
  setGlow(on) {
    this.view._glowOn = !!on;
    for (const n of this.view.partNodes.values()) if (n.emissive) n.emissive.visible = this.view._glowOn;
  }

  /* ---------------- 指针交互 ---------------- */
  onDown(e) {
    if (e.button !== 0) return;
    if (this.mode === "physics") {
      // 物理模式下左栏给的是移动/缩放两个图标，以前 onDown 第一行就 return，
      // 于是那两颗按钮点了什么也不发生。碰撞盒的 center/size 本来就在右侧面板里，
      // 这里让拖动直接改它们。
      const ph = refreshPhysics(this.doc);
      if (this.tool !== "scale") {
        this.drag = { kind: "phbox", x: e.clientX, y: e.clientY, c: ph.center.slice() };
      } else {
        this.drag = { kind: "phboxScale", x: e.clientX, y: e.clientY, s: ph.size.slice() };
      }
      this.snapshot("碰撞盒");
      return;
    }
    if (this.pivotMode) {
      this.snapshot("移动中心点");
      this.drag = { kind: "pivot", x: e.clientX, y: e.clientY, p: (this.doc.pivot || [0, 0, 0]).slice() };
      return;
    }
    const hit = this.view.pickVoxel(e);
    const bone = this.mode === "anim" ? this.view.pickBone(e) : null;
    if (bone) {
      this.activeBone = bone;
      // 快照拍在按下这一拍：以前骨骼拖拽全程不进撤销栈，拖完一步撤不动。
      this.snapshot("骨骼位移");
      this.drag = { kind: "bone", bone, x: e.clientX, y: e.clientY, pos: bone.position.slice() };
      this.renderBones(); this.renderProps(); return;
    }
    if (this.tool === "select") {
      this.drag = { kind: "select", start: hit ? hit.cell : this.view.pickPlane(e, this.activePart ? this.activePart.size[1] / 2 : 0) || [0, 0, 0] };
      return;
    }
    if (["move", "rot", "scale"].includes(this.tool) && hit) {
      this.activePart = hit.part;
      this.view.setActivePart(hit.part);
      // 快照必须拍在改动之前。以前拍在 onUp（也就是改动之后），
      // 于是"撤销一步"回到的是拖完的状态，要撤两步才回到拖之前——读起来就是撤销不干净。
      this.snapshot(this.tool === "move" ? "移动部件" : this.tool === "rot" ? "旋转部件" : "缩放部件");
      // 编组必须真的整组变换，否则它只是个标签：命中一个成员，同组的一起跟着走
      const parts = this.dragTargets(hit.part);
      this.drag = { kind: this.tool, part: hit.part,
        parts: parts.map((q) => ({ p: q, pos: q.pos.slice(), rot: q.rot.slice(), scale: q.scale.slice() })),
        x: e.clientX, y: e.clientY, pos: hit.part.pos.slice(), rot: hit.part.rot.slice(), scale: hit.part.scale.slice() };
      this.renderParts();
      return;
    }
    if (!hit) { this.drag = null; return; }
    this.snapshot(this.tool);
    this.drag = { kind: "voxel", start: hit.cell.slice(), axis: dominantAxis(hit.normal) };
    this.applyVoxelTool(hit);
    this.dirty();
  }
  onMove(e) {
    if (!this.drag) {
      const hit = this.view.pickVoxel(e);
      this.view.showHover(hit && (this.tool === "build") ? [hit.adjacent] : hit ? [hit.cell] : null);
      return;
    }
    const d = this.drag;
    if (d.kind === "phbox" || d.kind === "phboxScale") {
      const ph = this.doc.physics;
      const dx = (e.clientX - d.x) * 0.06, dy = (e.clientY - d.y) * 0.06;
      if (d.kind === "phbox") {
        ph.center = [+(d.c[0] + dx).toFixed(2), +(d.c[1] - dy).toFixed(2), d.c[2]];
      } else {
        ph.size = [Math.max(0.05, +(d.s[0] + dx).toFixed(2)), Math.max(0.05, +(d.s[1] + dy).toFixed(2)), d.s[2]];
      }
      ph.mode = "custom";
      refreshPhysics(this.doc);
      this.renderPhysics(); this.syncPhysicsFields(); this.view.rebuild();
      return;
    }
    if (d.kind === "bone") {
      const dx = (e.clientX - d.x) * 0.06, dy = (e.clientY - d.y) * 0.06;
      // 增量要从"按下那一刻"的那份位置算。以前是往当前值上再加一遍"距起点的总位移"，
      // 于是每个 pointermove 都累加一次——越拖越快、松手时人已经不知道在哪了。
      const from = d.pos || (d.pos = d.bone.position.slice());
      d.bone.position = [+(from[0] + dx).toFixed(2), from[1], +(from[2] + dy).toFixed(2)];
      this.view.buildBones();
      this.renderProps();
      return;
    }
    if (d.kind === "select") {
      const hit = this.view.pickVoxel(e);
      const end = hit ? hit.cell : this.view.pickPlane(e, this.activePart ? this.activePart.size[1] / 2 : 0) || d.start;
      this.selection = rangeCells(d.start, end);
      this.view.showSelection(this.selection);
      return;
    }
    if (d.kind === "pivot") {
      const dx = (e.clientX - d.x) * 0.08, dy = (e.clientY - d.y) * 0.08;
      this.doc.pivot = [+(d.p[0] + dx).toFixed(2), +(d.p[1] - dy).toFixed(2), d.p[2]];
      this.syncPivotMarker(); this.renderProps(); this.dirty();
      return;
    }
    const each = (fn) => { for (const it of (d.parts || [{ p: d.part, pos: d.pos, rot: d.rot, scale: d.scale }])) fn(it); };
    if (d.kind === "move") {
      const dx = (e.clientX - d.x) * 0.08, dy = (e.clientY - d.y) * 0.08;
      each((it) => {
        if (this.space === "world") {
          // 世界系：屏幕位移加在"世界读数"上，再换算回部件局部值。
          // 部件绑在转过/移过的骨骼上时，这两种拖法的结果明显不同——那才是这个开关的意义。
          const w = it.world || (it.world = this.view.partWorldPos(it.p));
          it.p.pos = this.view.partPosFromWorld(it.p, [w[0] + dx, w[1] - dy, w[2]]);
        } else {
          it.p.pos = [+(it.pos[0] + dx).toFixed(2), +(it.pos[1] - dy).toFixed(2), it.pos[2]];
        }
        this.view.applyPartTransform(it.p);
      });
      this.view.rebuildBoxes();
      this.syncPropVecs();
      return;
    }
    if (d.kind === "rot") {
      const dz = (e.clientX - d.x) * 0.6;
      each((it) => {
        it.p.rot = [it.rot[0], +(it.rot[1] + dz).toFixed(1), it.rot[2]];
        this.view.applyPartTransform(it.p);
      });
      this.view.rebuildBoxes();
      this.syncPropVecs();
      return;
    }
    if (d.kind === "scale") {
      const k = 1 + (e.clientX - d.x) * 0.004;
      each((it) => {
        it.p.scale = it.scale.map((v) => clamp(+(v * k).toFixed(3), 0.05, 20));
        this.view.applyPartTransform(it.p);
      });
      this.view.rebuildBoxes();
      this.syncPropVecs();
      return;
    }
    if (d.kind === "voxel" && this.activePart) {
      const hit = this.view.pickVoxel(e);
      if (!hit) return;
      d.end = hit.cell.slice();
      if (["line", "lineDel", "face", "faceDel"].includes(this.tool)) {
        const cells = this.tool.startsWith("line") ? linePoints(d.start, d.end) : faceCells(d.start, d.end);
        this.view.showSelection(cells);
      }
    }
  }
  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === "voxel" && d.end && this.activePart) {
      if (this.tool === "line" || this.tool === "lineDel") {
        const cells = linePoints(d.start, d.end);
        for (const c of cells) this.placeOrErase(c, this.tool === "line");
      } else if (this.tool === "face" || this.tool === "faceDel") {
        const cells = faceCells(d.start, d.end);
        for (const c of cells) this.placeOrErase(c, this.tool === "face");
      }
      this.view.rebuildPart(this.activePart);
      this.renderStat();
      this.syncSizeBoxes();
    }
    if (d.kind === "select") this.renderProps();
    // 快照已在 onDown 拍过（改动之前），这里只需要把"有未保存改动"标出去
    if (["move", "rot", "scale", "bone"].includes(d.kind)) this.dirty();
    this.view.showSelection(this.selection);
  }
  applyVoxelTool(hit) {
    // 落在谁身上就写进谁。以前写死 this.activePart，而坐标是从 hit.part 表面采的：
    // 两个部件叠着放时，体素会进到 activePart 的局部空间里那个坐标，
    // 也就是"点 A 的屋顶，方块长进了 B 的墙里"。
    const p = hit.part || this.activePart;
    this.activePart = p;
    const put = (cell) => {
      if (!ensureRoom(p, cell[0], cell[1], cell[2])) {
        this.tip("部件框已经到 128 上限，放不下了");
        return false;
      }
      return setVoxel(this.doc, p, cell[0], cell[1], cell[2], this.color.hex, this.color.emissive);
    };
    switch (this.tool) {
      case "build": put(hit.adjacent); break;
      case "erase": eraseVoxel(p, hit.cell[0], hit.cell[1], hit.cell[2]); break;
      case "paint": { const v = getVoxel(p, ...hit.cell); if (v) { v.c = ensureColor(this.doc, this.color.hex, this.color.emissive); } break; }
      case "bucket": { const cells = floodSelect(p, hit.cell, true); for (const c of cells) { const v = getVoxel(p, ...c); if (v) v.c = ensureColor(this.doc, this.color.hex, this.color.emissive); } break; }
      case "wand": this.selection = floodSelect(p, hit.cell, true); this.view.showSelection(this.selection); this.tip(`魔棒选中 ${this.selection.length} 个体素`); this.renderVoxOps(); return;
      case "eyedropper": { const v = getVoxel(p, ...hit.cell); if (v) { this.color = colorOf(this.doc, v.c); this.renderPalette(); this.tip("已取色 " + this.color.hex); } return; }
      // 提示语写的是"把选区沿轴挤出"，实现却只传了点击的那一格。
      // 框选一片再挤是建模里最常用的一步，这里按提示语来。
      case "extrude": {
        const h = this._extrudeH || 1;
        const cells = this.selection.length ? this.selection : [hit.cell];
        extrude(this.doc, p, cells, dominantAxis(hit.normal), h);
        this.view.rebuildPart(p);
        this.tip(`挤出 ${cells.length} 格 × ${h}`);
        break;
      }
      default: return;
    }
    this.view.rebuildPart(p);
    this.renderStat();
    this.syncSizeBoxes();
  }
  placeOrErase(cell, place) {
    const p = this.activePart;
    if (!p) return;
    if (place) { if (!ensureRoom(p, cell[0], cell[1], cell[2])) return; setVoxel(this.doc, p, cell[0], cell[1], cell[2], this.color.hex, this.color.emissive); }
    else eraseVoxel(p, cell[0], cell[1], cell[2]);
  }
  applySelectionOp(kind) {
    const p = this.activePart;
    if (!p || !this.selection.length) return;
    this.snapshot(kind);
    if (kind === "erase") for (const c of this.selection) eraseVoxel(p, c[0], c[1], c[2]);
    if (kind === "paint") for (const c of this.selection) { const v = getVoxel(p, ...c); if (v) v.c = ensureColor(this.doc, this.color.hex, this.color.emissive); }
    if (kind === "crop") {
      const keep = new Set(this.selection.map((c) => c.join(",")));
      p.voxels = p.voxels.filter((v) => keep.has([v.x, v.y, v.z].join(",")));
      invalidateIndex(p);
    }
    this.view.rebuildPart(p);
    this.renderAll();
  }

  /* ---------------- 面板渲染 ---------------- */
  renderAll() { this.renderParts(); this.renderBones(); this.renderPalette(); this.renderProps(); this.renderVoxOps(); this.renderTools(); this.renderStat(); this.renderTimeline(); this.syncPivotMarker(); }
  renderTools() { this.buildTools(); }
  renderStat() {
    const s = stats(this.doc);
    $("vxStat").textContent = `部件 ${s.parts}/${MAX_PARTS} · 骨骼 ${s.bones} · 体素 ${s.voxels} · 面 ${s.faces.toLocaleString()} · 颜色 ${s.colors} · 动画 ${s.anims}`;
  }
  renderParts() {
    const host = $("vxParts");
    host.innerHTML = "";
    for (const p of this.doc.parts) {
      const row = document.createElement("div");
      row.className = "vx-item" + (p === this.activePart ? " active" : "") + (this.picked.has(p) ? " picked" : "");
      const bone = this.doc.bones.find((b) => b.id === p.bone);
      // 编组结果以前只写进 doc.groups、界面上没有任何地方读它，所以"编组成功"之后
      // 用户看不出发生了什么。把组名回显到行上，这一步才算看得见。
      const grp = p.group && (this.doc.groups || []).find((g) => g.id === p.group);
      row.innerHTML = `<span class="vi-eye">${p.visible === false ? "▫" : "◼"}</span>
        <span class="vi-name">${esc(p.name)}</span>
        <span class="vi-meta">${p.voxels.length} · ${bone ? bone.name : "未绑定"}${grp ? " · " + esc(grp.name) : ""}</span>
        <button class="vi-del">✕</button>`;
      row.onclick = (e) => {
        if (e.target.classList.contains("vi-eye")) { this.snapshot("可见性"); p.visible = p.visible === false; this.view.rebuildPart(p); this.renderParts(); return; }
        if (e.target.classList.contains("vi-del")) {
          if (!confirm(`删除部件「${p.name}」？它身上的 ${p.voxels.length} 个体素会一起没。`)) return;
          this.snapshot("删除部件");
          this.picked.delete(p);
          this.doc.parts = this.doc.parts.filter((x) => x !== p);
          this.activePart = this.doc.parts[0] || null;
          this.view.rebuild(); this.renderAll();
          return;
        }
        // Cmd/Ctrl 点选是把多个部件挑进"待编组"集合的唯一入口——
        // 编组按钮以前只看 this.selection（那是体素选区），所以永远只能组一个部件。
        if (e.metaKey || e.ctrlKey) {
          this.picked.has(p) ? this.picked.delete(p) : this.picked.add(p);
          this.renderParts();
          this.tip(this.picked.size ? `已挑 ${this.picked.size} 个部件` : "");
          return;
        }
        this.activePart = p;
        this.picked.clear();
        this.view.setActivePart(p);
        this.renderParts(); this.renderProps();
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        this.activePart = p; this.view.setActivePart(p); this.renderParts(); this.renderProps();
        const g = this.groupOf(p);
        this.menuAt(e.clientX, e.clientY, [
          { label: "编辑部件（进体素）", run: () => this.setInPart(true) },
          { label: "复制部件", run: () => { this.picked.clear(); this.picked.add(p); $("vxDupPart").click(); } },
          { label: "重命名", run: () => this.renamePart(p) },
          g ? { label: `解组「${g.name}」`, run: () => this.ungroup(p) } : { label: "编组（先按住 ⌘/Ctrl 点选）", run: () => $("vxGroup").click() },
          { sep: true },
          { label: "删除部件", danger: true, run: () => this.removePart(p) },
        ]);
      };
      row.ondblclick = () => {
        const inp = row.querySelector(".vi-name");
        // 撤销要拍在改名**之前**：先改再拍，按一次 Ctrl+Z 撤回来的已经是改完的名字了
        this.snapshot("重命名");
        inp.contentEditable = "true";
        inp.focus();
        inp.onblur = () => { p.name = inp.textContent.trim() || p.name; inp.contentEditable = "false"; this.renderParts(); };
      };
      host.appendChild(row);
    }
    if (!this.doc.parts.length) host.innerHTML = '<div class="vx-empty">＋ 新建部件开始建模</div>';
  }
  renderBones() {
    const host = $("vxBones");
    host.innerHTML = "";
    const walk = (parentId, depth) => {
      for (const b of this.doc.bones.filter((x) => (x.parent || null) === parentId)) {
        const row = document.createElement("div");
        row.className = "vx-item vx-bone" + (b === this.activeBone ? " active" : "");
        row.style.paddingLeft = 6 + depth * 12 + "px";
        row.innerHTML = `<span class="vb-ico">${depth ? "└" : "◈"}</span><span class="vb-name">${esc(b.name)}</span>
          <span class="vi-meta">${(this.doc.parts.filter((p) => p.bone === b.id)).length} 部件</span>
          <button class="vb-child" title="添加子骨骼">＋</button><button class="vi-del">✕</button>`;
        row.onclick = (e) => {
          if (e.target.classList.contains("vb-child")) { this.snapshot("子骨骼"); const nb = addBone(this.doc, "Bone", b); this.activeBone = nb; this.view.buildBones(); this.renderBones(); return; }
          if (e.target.classList.contains("vi-del")) return this.removeBone(b);
          this.activeBone = b;
          this.renderBones(); this.renderProps();
        };
        // 官方骨骼列表右键（截图 232039）：添加子骨骼 / 复制 / 重命名 / 删除
        row.oncontextmenu = (e) => {
          e.preventDefault();
          this.activeBone = b; this.renderBones(); this.renderProps();
          this.menuAt(e.clientX, e.clientY, [
            { label: "添加子骨骼", run: () => { this.snapshot("子骨骼"); const nb = addBone(this.doc, "Bone", b); this.activeBone = nb; this.view.buildBones(); this.renderBones(); this.dirty(); } },
            { label: "复制骨骼", run: () => this.cloneBone(b) },
            { label: "重命名", run: () => this.renameBone(b) },
            { sep: true },
            { label: "删除骨骼", danger: true, run: () => this.removeBone(b) },
          ]);
        };
        row.ondblclick = () => {
          const el = row.querySelector(".vb-name");
          el.contentEditable = "true";
          el.onblur = () => { b.name = el.textContent.trim() || b.name; el.contentEditable = "false"; this.renderBones(); };
        };
        host.appendChild(row);
        walk(b.id, depth + 1);
      }
    };
    walk(null, 0);
  }
  /** 官方色板：若干命名色组，每组一行一行铺（每行 11 块），组名可改，
   *  组尾一个 ＋ 往这一组加色。以前是一条平铺列表 + 一行写死的 "Group" 文字。 */
  renderPalette(keepFields) {
    const host = $("vxPalette");
    host.innerHTML = "";
    const order = [];
    for (const c of this.doc.palette) if (!order.includes(c.g || "Group")) order.push(c.g || "Group");
    if (!order.length) order.push("Group");
    for (const g of order) {
      const head = document.createElement("div");
      head.className = "vx-grpline";
      const nm = document.createElement("span");
      nm.className = "gp-name";
      nm.textContent = g;
      nm.title = "双击改色组名";
      nm.ondblclick = () => {
        nm.contentEditable = "true"; nm.focus();
        nm.onblur = () => {
          const to = (nm.textContent || "").trim() || g;
          if (to !== g) {
            this.snapshot("改色组名");
            for (const c of this.doc.palette) if ((c.g || "Group") === g) c.g = to;
            if (this.doc.palCur === g) this.doc.palCur = to;
          }
          nm.contentEditable = "false";
          this.renderPalette(true); this.dirty();
        };
      };
      const add = document.createElement("button");
      add.className = "gp-add";
      add.textContent = "＋";
      add.title = `往「${g}」加一个颜色`;
      add.onclick = () => this.addColorTo(g);
      head.appendChild(nm); head.appendChild(add);
      host.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "vx-palgrid";
      for (const c of this.doc.palette) {
        if ((c.g || "Group") !== g) continue;
        grid.appendChild(this.swatch(c));
      }
      host.appendChild(grid);
    }
    if (!keepFields) this.syncColorFields();
  }
  swatch(c) {
    const el = document.createElement("div");
    el.className = "vx-swatch" + (c === this.color ? " active" : "");
    el.style.background = c.hex;
    el.title = `${c.hex} 发光 ${((c.emissive || 0) * 100).toFixed(0)}%（右键：改色 / 复制 / 删除）`;
    if ((c.emissive || 0) > 0.02) el.classList.add("glow");
    el.onclick = () => { this.color = c; this.doc.palCur = c.g || "Group"; this.renderPalette(); this.renderProps(); };
    el.oncontextmenu = (e) => {
      e.preventDefault();
      const used = this.colorUsedCount(c);
      this.menuAt(e.clientX, e.clientY, [
        { label: "改色…", run: () => this.pickNative(c, el) },
        { label: "复制一份到下一组", run: () => this.cloneColor(c) },
        { sep: true },
        { label: used ? `删除（${used} 个体素在用）` : "从色板删除", danger: true, run: () => this.deleteColor(c, used) },
      ]);
    };
    return el;
  }
  colorUsedCount(c) {
    let n = 0;
    for (const p of this.doc.parts) for (const v of p.voxels) if (v.c === c.i) n++;
    return n;
  }
  /** 系统取色器。每动一下都触发 input：进面板拍一次快照、只重绘用到的部件，
   *  否则一次改色既占几十步撤销、又要重算整个场景。 */
  pickNative(c, el) {
    const inp = document.createElement("input");
    inp.type = "color"; inp.value = c.hex;
    let touched = false;
    inp.oninput = () => {
      if (!touched) { this.snapshot("改色"); touched = true; }
      c.hex = inp.value;
      el.style.background = c.hex;
      this.view.rebuildColors(c.i);
      if (this.color === c) this.syncColorFields();
    };
    inp.click();
  }
  addColorGroup() {
    this.snapshot("增加颜色组");
    let n = 1, name = "Group-1";
    const have = new Set(this.doc.palette.map((c) => c.g || "Group"));
    while (have.has(name)) { n++; name = `Group-${n}`; }
    this.doc.palCur = name;
    this.doc.palette.push(newPaletteEntry("#88aaff", 0, name));
    this.renderPalette(); this.dirty();
    this.tip(`新建色组「${name}」`);
  }
  addColorTo(g) {
    this.snapshot("增加颜色");
    this.doc.palCur = g;
    this.doc.palette.push(newPaletteEntry(this.color && this.color.hex ? this.color.hex : "#88aaff", 0, g));
    this.renderPalette(); this.dirty();
  }
  cloneColor(c) {
    this.snapshot("复制颜色");
    const order = [];
    for (const x of this.doc.palette) if (!order.includes(x.g || "Group")) order.push(x.g || "Group");
    const at = order.indexOf(c.g || "Group");
    const to = order[(at + 1) % order.length] || "Group";
    this.doc.palette.push(newPaletteEntry(c.hex, c.emissive || 0, to));
    this.renderPalette(); this.dirty();
    this.tip(`已把 ${c.hex} 复制到「${to}」`);
  }
  deleteColor(c, used) {
    if (used) return this.tip(`有 ${used} 个体素还在用 ${c.hex}，先把它们换成别的颜色`);
    if (this.doc.palette.length <= 1) return this.tip("色板至少要留一个颜色");
    this.snapshot("删除颜色");
    this.doc.palette = this.doc.palette.filter((x) => x !== c);
    if (this.color === c) this.color = this.doc.palette[0];
    this.renderPalette(); this.dirty();
  }
  exportPalette() {
    const groups = [];
    for (const c of this.doc.palette) {
      const g = c.g || "Group";
      let box = groups.find((x) => x.name === g);
      if (!box) groups.push(box = { name: g, colors: [] });
      box.colors.push({ hex: c.hex, emissive: +(c.emissive || 0).toFixed(3) });
    }
    download(new Blob([JSON.stringify({ kind: "voxa-palette", version: 1, groups }, null, 2)], { type: "application/json" }),
      (this.doc.name || "model") + "-色板.json");
    this.tip("色板已导出为 JSON");
  }
  /** 导入是"把这些颜色加进色板"，不是改模型：同 hex+发光 的复用现有项，
   *  所以重复导入不会产生一堆看起来不一样、实际等价的色块。 */
  async importPalette(file) {
    if (!file) return;
    let raw = null;
    try { raw = JSON.parse(await file.text()); } catch { return this.tip("这个文件不是合法的 JSON"); }
    const groups = Array.isArray(raw && raw.groups) ? raw.groups : null;
    if (!groups) return this.tip("文件里没有 groups 数组，不像 VOXA 导出的色板");
    this.snapshot("导入色板");
    let added = 0;
    for (const g of groups) {
      const name = String(g.name || "导入色组");
      for (const c of (g.colors || [])) {
        const hex = String(c.hex || "").toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(hex)) continue;
        const em = Number(c.emissive) || 0;
        const have = this.doc.palette.find((p) => p.hex.toLowerCase() === hex && Math.abs((p.emissive || 0) - em) < 0.01);
        if (have) continue;
        this.doc.palette.push(newPaletteEntry(hex, em, name));
        added++;
      }
    }
    this.renderPalette(); this.view.rebuild(); this.dirty();
    this.tip(added ? `导入色板：新增 ${added} 个颜色` : "色板里已经有这些颜色了");
  }
  renderProps() {
    const host = $("vxProps");
    host.innerHTML = "";
    // 两个"就地刷新数值"的钩子都指向本回合建出来的输入框，
    // 面板一重建就必须作废，否则 sync* 会往已经脱离文档的节点上写字
    this._phFields = null;
    this._vecSrc = null;
    // 官方物理界面的右侧只有「参数」：位置 + 尺寸两行，各自 X/Y/Z
    if (this.mode === "physics") {
      const ph = this.doc.physics;
      this._phFields = { center: () => ph.center, size: () => ph.size };
      const setPh = (key) => (next) => {
        if (key === "center") ph.center = next; else ph.size = next.map((v) => Math.max(0.05, v));
        ph.mode = "custom"; refreshPhysics(this.doc);
        this.renderPhysics(); this.view.rebuild(); this.dirty();
      };
      const box = document.createElement("div");
      box.className = "vx-sec";
      box.appendChild(axisRow("位置", ph.center, setPh("center"), { snap: () => this.snapshot("碰撞盒") }));
      box.appendChild(axisRow("尺寸", ph.size, setPh("size"), { snap: () => this.snapshot("碰撞盒尺寸") }));
      host.appendChild(box);
      const t = document.createElement("div");
      t.className = "vx-empty";
      t.textContent = "默认模式下碰撞盒是所有部件的最小外接包围盒，随模型变化；自定义后固定为你填的尺寸。Arena 里显示为黄色方框。";
      host.appendChild(t);
      return;
    }
    if (this.mode === "anim" && this.activeBone) {
      const snap = (l) => () => this.snapshot(l);
      host.appendChild(section("骨骼 " + this.activeBone.name, [
        axisRow("位移", this.activeBone.position, (v) => { this.activeBone.position = v; this.view.buildBones(); this.view.applyPose(this.doc, curAnim(this.doc), this.frame); }, { vecKey: "pos", snap: snap("骨骼位移") }),
        axisRow("旋转", this.activeBone.rotation, (v) => { this.activeBone.rotation = v; this.view.buildBones(); this.view.applyPose(this.doc, curAnim(this.doc), this.frame); }, { unit: "°", step: 1, vecKey: "rot", snap: snap("骨骼旋转") }),
        axisRow("缩放", this.activeBone.scale, (v) => { this.activeBone.scale = v; this.view.buildBones(); this.view.applyPose(this.doc, curAnim(this.doc), this.frame); }, { unit: "%", step: 1, vecKey: "scale", snap: snap("骨骼缩放") }),
        sliderRow("不透明度", boneOpacityOf(this.activeBone), (val) => this.setBoneOpacity(val)),
      ]));
      host.appendChild(btnRow([["◆ 创建帧", () => this.keyframe()]]));
      return;
    }
    if (this.pivotMode) {
      host.appendChild(section("模型中心点", [
        axisRow("锚点", this.doc.pivot || [0, 0, 0], (v) => { this.doc.pivot = v; this.syncPivotMarker(); this.dirty(); },
          { snap: () => this.snapshot("改中心点") }),
      ]));
      const t = document.createElement("div");
      t.className = "vx-empty";
      t.textContent = "拖视口或改这三个数都行。中心点决定实体在游戏里挂在哪、旋转绕哪；换肤模式下它固定不可改。";
      host.appendChild(t);
      return;
    }
    const p = this.activePart;
    if (!p) { host.innerHTML = '<div class="vx-empty">未选中部件</div>'; this._vecSrc = null; return; }
    const world = this.space === "world";
    // 拖动部件时只想把三个数字刷一下，不想把整块面板拆了重建：
    // 以前 pointermove 每次都调 renderProps()，等于 60fps 拆 DOM，
    // 而且玩家正在输入的那个数字框会被半路销毁。
    this._vecSrc = { pos: () => (world ? this.view.partWorldPos(p) : p.pos), rot: () => p.rot, scale: () => p.scale, size: () => p.size };
    const snap = (l) => () => this.snapshot(l);
    host.appendChild(section("部件 " + p.name, [
      // 「位置」这一行随坐标系变口径：局部=相对所绑骨骼，世界=模型空间里的绝对位置。
      // 旋转/缩放始终是局部值（官方那两行也没有世界口径，父子链上转两次欧拉角
      // 与分量相加并不等价，硬做只会给出一组对不上画面的数字）。
      axisRow("位置", world ? this.view.partWorldPos(p) : p.pos, (v) => {
        p.pos = world ? this.view.partPosFromWorld(p, v) : v;
        this.view.applyPartTransform(p); this.view.rebuildBoxes(); this.dirty();
      }, { vecKey: "pos", snap: snap("改位置") }),
      axisRow("旋转", p.rot, (v) => { p.rot = v; this.view.applyPartTransform(p); this.view.rebuildBoxes(); this.dirty(); }, { unit: "°", step: 1, vecKey: "rot", snap: snap("改旋转") }),
      axisRow("缩放", p.scale, (v) => { p.scale = v; this.view.applyPartTransform(p); this.dirty(); }, { unit: "%", step: 1, vecKey: "scale", snap: snap("改缩放") }),
      axisRow("部件框", p.size, (v) => {
        p.size = v;
        this.view.rebuildBoxes(); this.syncSizeBoxes(); this.renderStat(); this.dirty();
      }, { ints: true, step: 1, vecKey: "size", snap: snap("改部件框") }),
      sliderRow("不透明度", p.opacity ?? 1, (val) => {
        // 滑杆每动一格都拍一次快照会淹掉撤销栈，所以只在落到新值时记一步
        if ((p.opacity ?? 1) === val) return;
        this.snapshot("改不透明度");
        p.opacity = val;
        for (const m of [this.view.partNodes.get(p.id)?.mesh, this.view.partNodes.get(p.id)?.emissive]) {
          if (!m) continue;
          m.material.userData.baseOpacity = val;
          m.material.transparent = val < 0.999;
          m.material.opacity = val;
        }
        this.dirty();
      }),
      selectRow("绑定骨骼", ["", ...this.doc.bones.map((b) => b.id)], ["未绑定", ...this.doc.bones.map((b) => b.name)], p.bone || "", (val) => {
        this.snapshot("绑定");
        bindPart(this.doc, p, val || null);
        this.view.rebuild();
        this.renderParts();
      }),
    ]));
    host.appendChild(btnRow([
      ["自动裁剪", () => { this.snapshot("裁剪"); autoCrop(p); this.view.rebuild(); this.renderProps(); this.syncSizeBoxes(); }],
      ["清空部件", () => {
        if (!p.voxels.length) return this.tip("这个部件本来就是空的");
        if (!confirm(`清空部件「${p.name}」？${p.voxels.length} 个体素会被抹掉。`)) return;
        this.snapshot("清空");
        p.voxels = []; invalidateIndex(p);
        this.view.rebuildPart(p); this.renderStat();
      }],
    ]));
  }
  renderVoxOps() {
    const host = $("vxVoxOps");
    host.innerHTML = "";
    // 镜像/旋转/翻转已按官方口径移到顶栏，这里只留选区操作
    for (const [label, fn] of [["选区改色", "paint"], ["选区删除", "erase"], ["选区保留", "crop"]]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => this.applySelectionOp(fn);
      host.appendChild(b);
    }
  }
  voxOp(fn) {
    if (!this.activePart) return this.tip("请先选中部件");
    this.snapshot("体素变换");
    // 变换函数返回 false 表示"这一步装不下"（比如镜像要把框长到 128 以上）。
    // 以前返回值没人看，于是顶栏按下去既不变、也不说为什么。
    if (fn(this.activePart) === false) { this.undo(); return this.tip("这一步会超出 128 的部件框上限"); }
    this.view.rebuild();
    this.renderStat();
    this.syncSizeBoxes();
  }
  renderPhysics() {
    const ph = this.doc.physics;
    // 顶栏那对 默认/自定义 按钮是唯一的入口：以前还有一块 #vxPhysics 浮层，
    // 被 applyMode 无条件隐藏、却仍被这里写值——纯死代码，删了。
    $("grpPhMode").querySelectorAll("button[data-ph]").forEach((b) => b.classList.toggle("on", b.dataset.ph === ph.mode));
  }
  renderTimeline() {
    // 官方动画面板：左列「动画列表」，右侧每根骨骼一条轨道 + 秒刻度尺
    const list = $("vxAnimList");
    list.innerHTML = "";
    this.doc.anims.forEach((a, i) => {
      const row = document.createElement("div");
      row.className = "vx-item" + (i === this.doc.curAnim ? " active" : "");
      const nm = document.createElement("span"); nm.className = "vi-name"; nm.textContent = a.name;
      row.appendChild(nm);
      row.onclick = () => { this.doc.curAnim = i; this.renderTimeline(); };
      row.ondblclick = () => {
        nm.contentEditable = "true"; nm.focus();
        nm.onblur = () => { a.name = nm.textContent.trim() || a.name; nm.contentEditable = "false"; this.renderTimeline(); };
      };
      list.appendChild(row);
    });
    if (!this.doc.anims.length) {
      const empty = document.createElement("button");
      empty.className = "ap-create"; empty.innerHTML = "＋ 创建动画";
      empty.onclick = () => $("vxAnimNew").click();
      const wrap = document.createElement("div"); wrap.className = "ap-empty"; wrap.appendChild(empty);
      list.appendChild(wrap);
    }

    const anim = curAnim(this.doc);
    const max = Math.max(24, this.view.frameBounds());
    $("vxScrub").max = max;
    $("vxFrameMax").textContent = max;
    const pxf = this.tl.pxf;
    const laneW = max * pxf + 12;

    const ruler = $("vxRuler");
    ruler.style.width = (TL_LABEL + laneW) + "px";
    ruler.innerHTML = "";
    // 秒标：太密的时候隔两秒标一个，但每根秒线都画（数格子还要靠它们）
    const labelEvery = pxf * ANIM_FPS < 46 ? 2 : 1;
    for (let s = 0; s <= Math.ceil(max / ANIM_FPS); s++) {
      const t = document.createElement("span");
      t.className = "tick" + (s % labelEvery ? " min" : "");
      t.style.left = (TL_LABEL + s * ANIM_FPS * pxf) + "px";
      t.textContent = s + "s";
      ruler.appendChild(t);
    }
    const head = document.createElement("span"); head.className = "playhead"; head.id = "playhead";
    ruler.appendChild(head);

    const host = $("vxTracks");
    host.innerHTML = "";
    // 每一根骨骼都要有一行（官方 GIF 里没打键的骨骼也在列）。
    // 以前只列"当前动画里已有键"的骨骼，于是新建动画时整条时间轴是空的，
    // 用户看不到"该给谁打键"，只能瞎点。
    let anyKey = false;
    for (const b of this.doc.bones) {
      const keys = ((anim && anim.tracks[b.id]) || []).slice().sort((x, y) => x.f - y.f);
      if (keys.length) anyKey = true;
      const row = document.createElement("div");
      row.className = "tl-row" + (this.activeBone && this.activeBone.id === b.id ? " sel" : "");
      row.style.width = (TL_LABEL + laneW) + "px";
      const lab = document.createElement("span");
      lab.className = "tl-bone";
      lab.textContent = b.name;
      lab.title = keys.length ? `${b.name} · ${keys.length} 帧` : `${b.name} · 还没有帧`;
      if (keys.length) {
        const badge = document.createElement("i");
        badge.textContent = keys.length;
        lab.appendChild(badge);
      }
      lab.onclick = () => { this.activeBone = b; this.renderBones(); this.renderProps(); this.renderTimeline(); };
      const lane = document.createElement("div");
      lane.className = "tl-lane";
      lane.style.width = laneW + "px";
      for (let i = 0; i + 1 < keys.length; i++) {
        const a = keys[i], c = keys[i + 1];
        const seg = document.createElement("div");
        seg.className = "tl-seg";
        seg.style.left = a.f * pxf + "px";
        seg.style.width = Math.max(2, (c.f - a.f) * pxf) + "px";
        // 段块里画缓动曲线：官方那五档（正常/打断/缓入/缓出/缓入缓出）
        // 光看颜色分不出来，曲线形状一眼就知道这一段是怎么走的。
        // 缓动记在**目标帧**上（sampleTrack 用的就是 b.ease），段块画的必须是它，
        // 否则图上是一条 S 形、实际走的是匀速——这种不一致最难靠看代码发现。
        const ease = c.ease || "normal";
        seg.innerHTML = `<svg viewBox="0 0 24 12" preserveAspectRatio="none"><path d="${EASE_PATH[ease] || EASE_PATH.normal}"/></svg>`;
        seg.title = `${a.f} → ${c.f} 帧 · 缓动 ${ease}`;
        lane.appendChild(seg);
      }
      keys.forEach((k, i) => {
        const cell = document.createElement("button");
        cell.className = "tl-key" + (k.f === this.frame ? " active" : "");
        cell.style.left = k.f * pxf + "px";
        cell.title = `第 ${k.f} 帧 · 缓动 ${k.ease || "normal"}（拖动改时间，右键换缓动/删除）`;
        cell.onpointerdown = (e) => this.dragKey(e, anim, b, k, keys, i, pxf, max);
        cell.oncontextmenu = (e) => {
          e.preventDefault(); e.stopPropagation();
          this.menuAt(e.clientX, e.clientY, [
            ...EASINGS.map((name) => ({
              label: "缓动 · " + name, on: (k.ease || "normal") === name,
              run: () => { this.snapshot("改缓动"); k.ease = name; this.renderTimeline(); this.tip(`${b.name} 第 ${k.f} 帧缓动：${name}`); },
            })),
            { sep: true },
            { label: "删除这一帧", danger: true, run: () => this.deleteKey(anim, b, k) },
          ]);
        };
        lane.appendChild(cell);
      });
      row.appendChild(lab); row.appendChild(lane);
      host.appendChild(row);
    }
    if (!anyKey) {
      const tipRow = document.createElement("div");
      tipRow.className = "tl-row";
      tipRow.innerHTML = `<span class="tl-bone">提示</span><span class="tl-empty">点一行骨骼名选中它，摆好姿态后按 ◆ 创建帧</span>`;
      host.appendChild(tipRow);
    }
    this.setFrame(this.frame);
  }
  /** 拖动一个关键帧改时间。快照只在真的动了之后才拍——点一下不该往撤销栈里塞一步 */
  dragKey(e, anim, bone, k, keys, i, pxf, max) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = k.f, x0 = e.clientX;
    const lo = i > 0 ? keys[i - 1].f + 1 : 0;
    const hi = i + 1 < keys.length ? keys[i + 1].f - 1 : max;
    const el = e.target;
    let moved = false;
    const onMove = (ev) => {
      const f = clamp(from + Math.round((ev.clientX - x0) / pxf), Math.min(lo, from), Math.max(hi, from));
      if (f === k.f) return;
      if (!moved) { moved = true; this.snapshot("移动帧"); }
      k.f = f;
      el.style.left = f * pxf + "px";
      el.title = `第 ${f} 帧 · 缓动 ${k.ease || "normal"}（拖动改时间，右键换缓动/删除）`;
      this.setFrame(f);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) { this.renderTimeline(); this.dirty(); }
      else { this.setFrame(k.f); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  deleteKey(anim, bone, k) {
    // 先拍快照再删：反过来等于把"已经删完"的状态存进撤销栈，删掉的帧回不来。
    this.snapshot("删除帧");
    const keys = anim.tracks[bone.id] || [];
    const n = keys.length;
    anim.tracks[bone.id] = keys.filter((x) => x !== k);
    if (!anim.tracks[bone.id].length) delete anim.tracks[bone.id];
    this.tip(`删掉 ${bone.name} 第 ${k.f} 帧（还能撤销）`);
    this.renderTimeline();
    this.dirty();
    if (n === 1) this.view.resetPose();
  }
  /** 中心点编辑态：底栏那排开关让位给这颗锚点，左键拖的就是它自己。
   *  官方在换肤模式下把这个按钮置灰——皮肤部件的锚点是固定的。 */
  setPivotMode(on) {
    if (on && this.doc.type === "skin") return this.tip("换肤模式下中心点固定，不能调整");
    this.pivotMode = !!on;
    $("vxPivot").classList.toggle("on", this.pivotMode);
    this.view.pivotMarker.visible = this.pivotMode;
    this.syncPivotMarker();
    this.renderProps();
    if (this.pivotMode) this.tip("左键拖动中心点，Esc 退出");
  }
  syncPivotMarker() {
    const pv = this.doc.pivot || [0, 0, 0];
    this.view.pivotMarker.position.set(pv[0], pv[1], pv[2]);
  }
  /** 编组要真的能整组变换，否则它只是个标签。
   *  命中一个成员就把同组可见成员一起带上；参数面板仍显示被点的那个。 */
  dragTargets(p) {
    if (!p || !p.group) return [p];
    const g = (this.doc.groups || []).find((x) => x.id === p.group);
    if (!g) return [p];
    const ids = new Set(g.partIds);
    const list = this.doc.parts.filter((x) => ids.has(x.id) && x.visible !== false);
    return list.length ? list : [p];
  }
  groupOf(p) { return p && p.group && (this.doc.groups || []).find((g) => g.id === p.group); }
  ungroup(p) {
    const g = this.groupOf(p);
    if (!g) return this.tip("这个部件不在任何组里");
    this.snapshot("解组");
    for (const x of this.doc.parts) if (x.group === g.id) x.group = null;
    this.doc.groups = (this.doc.groups || []).filter((x) => x !== g);
    this.renderParts(); this.dirty();
    this.tip(`已解组「${g.name}」`);
  }
  /** 改名一律复用列表行上的就地编辑，不再做第二个输入框 */
  renamePart(p) {
    this.activePart = p; this.renderParts();
    const row = [...document.querySelectorAll("#vxParts .vx-item")][this.doc.parts.indexOf(p)];
    const nm = row && row.querySelector(".vi-name");
    if (!nm) return;
    this.snapshot("重命名");
    nm.contentEditable = "true"; nm.focus();
    nm.onblur = () => { p.name = nm.textContent.trim() || p.name; nm.contentEditable = "false"; this.renderParts(); this.renderProps(); };
  }
  cloneBone(b) {
    this.snapshot("复制骨骼");
    const c = addBone(this.doc, b.name + "-copy", b.parent);
    c.position = b.position.slice(); c.rotation = b.rotation.slice(); c.scale = b.scale.slice();
    this.activeBone = c;
    this.view.buildBones(); this.renderAll(); this.dirty();
    return c;
  }
  renameBone(b) {
    this.activeBone = b; this.renderBones();
    const row = [...document.querySelectorAll("#vxBones .vx-item")][this.doc.bones.indexOf(b)];
    // 骨骼行用的是 .vb-name（部件行才是 .vi-name），两处都试一下，别静默什么都不做
    const nm = row && (row.querySelector(".vb-name") || row.querySelector(".vi-name"));
    if (!nm) return;
    this.snapshot("重命名骨骼");
    nm.contentEditable = "true"; nm.focus();
    nm.onblur = () => { b.name = nm.textContent.trim() || b.name; nm.contentEditable = "false"; this.renderAll(); };
  }
  removeBone(b) {
    if (b.id === "root") return this.tip("Root 骨骼不能删");
    const kids = childBones(this.doc, b.id).length;
    const bound = this.doc.parts.filter((p) => p.bone === b.id).length;
    if (!confirm(`删除骨骼「${b.name}」？` + (kids ? ` ${kids} 根子骨骼` : "") + (bound ? `、${bound} 个部件的绑定` : "") + "会一起处理掉。")) return;
    this.snapshot("删除骨骼");
    removeBone(this.doc, b.id);
    this.activeBone = this.doc.bones[0];
    this.view.buildBones(); this.renderAll(); this.dirty();
  }
  /** 视口右键：官方是"未选中=创建菜单，命中部件=部件菜单，动画模式命中骨骼=骨骼菜单" */
  contextMenu(e) {
    const bone = this.mode === "anim" ? this.view.pickBone(e) : null;
    const hit = this.view.pickVoxel(e);
    if (bone) {
      this.activeBone = bone; this.renderBones(); this.renderProps();
      return this.menuAt(e.clientX, e.clientY, [
        { label: "添加子骨骼", run: () => { this.snapshot("新建子骨骼"); const c = addBone(this.doc, "Bone", bone.id); this.activeBone = c; this.view.buildBones(); this.renderAll(); this.dirty(); } },
        { label: "复制骨骼", run: () => this.cloneBone(bone) },
        { label: "重命名", run: () => this.renameBone(bone) },
        { sep: true },
        { label: "删除骨骼", danger: true, run: () => this.removeBone(bone) },
      ]);
    }
    if (hit && hit.part) {
      const p = hit.part;
      this.activePart = p; this.view.setActivePart(p); this.renderParts(); this.renderProps();
      const g = this.groupOf(p);
      return this.menuAt(e.clientX, e.clientY, [
        { label: "添加部件", run: () => $("vxAddPart").click() },
        { label: "编辑部件（进体素）", run: () => { this.setInPart(true); this.activePart = p; } },
        { label: "复制部件", run: () => { this.picked.clear(); this.picked.add(p); $("vxDupPart").click(); } },
        { label: "重命名", run: () => this.renamePart(p) },
        g ? { label: `解组「${g.name}」`, run: () => this.ungroup(p) }
          : { label: (this.picked.size > 1 ? `编组（已挑 ${this.picked.size} 个）` : "编组（先按住 ⌘/Ctrl 点选多个部件）"), run: () => $("vxGroup").click() },
        { sep: true },
        { label: "删除部件", danger: true, run: () => this.removePart(p) },
      ]);
    }
    this.menuAt(e.clientX, e.clientY, [
      { label: "添加部件", run: () => $("vxAddPart").click() },
      { label: "创建骨骼", run: () => $("vxAddBone").click() },
      { label: "选中整个模型", run: () => { this.picked.clear(); for (const p of this.doc.parts) this.picked.add(p); this.renderParts(); this.tip(`已挑 ${this.picked.size} 个部件`); } },
    ]);
  }
  removePart(p) {
    if (!confirm(`删除部件「${p.name}」？它身上的 ${p.voxels.length} 个体素会一起没。`)) return;
    this.snapshot("删除部件");
    this.picked.delete(p);
    this.doc.parts = this.doc.parts.filter((x) => x !== p);
    this.activePart = this.doc.parts[0] || null;
    this.view.rebuild(); this.renderAll(); this.dirty();
  }
  /** 一个很小的弹出菜单：时间轴先用，视口右键菜单（部件/骨骼）复用同一套 */
  menuAt(x, y, items) {
    this.closeMenu();
    const m = document.createElement("div");
    m.className = "vx-pop";
    m.style.left = x + "px"; m.style.top = y + "px";
    for (const it of items) {
      if (it.sep) { m.appendChild(Object.assign(document.createElement("hr"), { className: "vx-pop-sep" })); continue; }
      const b = document.createElement("button");
      b.className = "vx-pop-i" + (it.on ? " on" : "") + (it.danger ? " danger" : "");
      b.textContent = it.label;
      b.onclick = () => { this.closeMenu(); it.run && it.run(); };
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    if (r.right > innerWidth - 6) m.style.left = Math.max(6, innerWidth - r.width - 6) + "px";
    if (r.bottom > innerHeight - 6) m.style.top = Math.max(6, innerHeight - r.height - 6) + "px";
    this._menu = m;
    const off = (ev) => { if (!m.contains(ev.target)) { this.closeMenu(); window.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => window.addEventListener("pointerdown", off, true), 0);
  }
  closeMenu() { if (this._menu) { this._menu.remove(); this._menu = null; } }
  setFrame(f) {
    this.frame = Math.max(0, f);
    $("vxScrub").value = this.frame;
    $("vxFrameNum").textContent = this.frame;
    const max = Math.max(1, Number($("vxScrub").max) || 24);
    const head = $("playhead");
    if (head) head.style.left = (TL_LABEL + this.frame * this.tl.pxf) + "px";
    // 播放头跑到视口外时把它滚进来：否则拖帧/逐帧步进之后"看起来没动"
    const sc = $("vxTlScroll");
    if (sc && head) {
      const x = TL_LABEL + this.frame * this.tl.pxf;
      if (x < sc.scrollLeft + TL_LABEL) sc.scrollLeft = Math.max(0, x - TL_LABEL - 8);
      else if (x > sc.scrollLeft + sc.clientWidth - 12) sc.scrollLeft = x - sc.clientWidth + 20;
    }
    const t = this.frame / ANIM_FPS;
    $("vxTimeText").textContent = String(Math.floor(t)).padStart(2, "0") + ":" + String(Math.round((t % 1) * 60)).padStart(2, "0");
    this.view.applyPose(this.doc, curAnim(this.doc), this.frame);
  }
  _tickPlay() {
    const now = performance.now();
    if (!this._pt) this._pt = now;
    const dt = (now - this._pt) / 1000;
    this._pt = now;
    const max = Math.max(1, this.view.frameBounds());
    let f = this.frame + dt * 24 * this.speed * (this.playing > 0 ? 1 : -1);
    if (f > max) f = 0;
    if (f < 0) f = max;
    this.setFrame(Math.floor(f));
  }
  keyframe() {
    if (!this.activeBone) return this.tip("请先选中骨骼");
    const o = this.view.boneNodes.get(this.activeBone.id);
    const t = o ? {
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [(o.rotation.x * 180 / Math.PI).toFixed(1) * 1, (o.rotation.y * 180 / Math.PI).toFixed(1) * 1, (o.rotation.z * 180 / Math.PI).toFixed(1) * 1],
      scale: [o.scale.x, o.scale.y, o.scale.z],
      op: this.activeBone.op ?? 1,
    } : { position: this.activeBone.position, rotation: this.activeBone.rotation, scale: this.activeBone.scale, op: 1 };
    this.snapshot("创建帧");
    createFrame(this.doc, this.activeBone, t, this.frame);
    this.renderTimeline();
    this.tip(`已在第 ${this.frame} 帧创建关键帧`);
  }
  setBoneOpacity(v) {
    const b = this.activeBone;
    if (!b) return;
    b.op = v;
    const o = this.view.boneNodes.get(b.id);
    if (o) o.userData.op = v;
    // 动画模式：不透明度写进当前帧关键片（官方用不透明度做显隐动画）
    const a = curAnim(this.doc);
    const tr = a && a.tracks[b.id];
    const k = tr && tr.find((x) => x.f === this.frame);
    if (k) k.op = v;
    this.view.applyPose(this.doc, a, this.frame);
    this.dirty();
  }
  loadSkinTemplate(quiet) {
    const has = SKIN_BONES.every((n) => this.doc.bones.some((b) => b.name === n));
    if (has) { if (!quiet) this.tip("人形模板已存在"); return; }
    this.snapshot("换肤模板");
    const byName = { hips: "root" };
    const parentOf = {
      torso: "hips", neck: "torso", head: "neck",
      leftShoulder: "torso", leftUpperArm: "leftShoulder", leftLowerArm: "leftUpperArm", leftHand: "leftLowerArm",
      rightShoulder: "torso", rightUpperArm: "rightShoulder", rightLowerArm: "rightUpperArm", rightHand: "rightLowerArm",
      leftUpperLeg: "hips", leftLowerLeg: "leftUpperLeg", leftFoot: "leftLowerLeg",
      rightUpperLeg: "hips", rightLowerLeg: "rightUpperLeg", rightFoot: "rightLowerLeg",
    };
    const H = { hips: [0, 8, 0], torso: [0, 3, 0], neck: [0, 3, 0], head: [0, 2, 0] };
    for (const n of SKIN_BONES) {
      const parent = byName[parentOf[n]] || "root";
      const b = newBone(n, parent);
      b.position = (H[n] || [0, 0, 0]).slice();
      this.doc.bones.push(b);
      byName[n] = b.id;
    }
    this.view.buildBones();
    this.renderBones();
    if (!quiet) this.tip("已载入 18 节点人形骨骼模板");
  }

  /* ---------------- 持久化 ---------------- */
  dirty() { this.saveLocal(); }
  saveLocal() {
    try { localStorage.setItem(MODEL_KEY, JSON.stringify(serialize(this.doc))); } catch {}
  }
  loadLocal() {
    try {
      const raw = localStorage.getItem(MODEL_KEY);
      return raw ? deserialize(JSON.parse(raw)) : null;
    } catch { return null; }
  }
  /* ---------------- 外部部件预览（官方「外部部件预览」） ---------------- */
  async loadExternal() {
    try {
      const r = await fetch("/api/models");
      const names = r.ok ? (((await r.json()).models) || []).map((x) => (typeof x === "string" ? x : x && x.name)).filter(Boolean) : [];
      if (names.length) {
        const pick = prompt("输入要作为参照的已保存模型名（留空则从本地文件选择）：\n可选：" + names.join(", "), "");
        if (pick && names.includes(pick)) {
          const rr = await fetch("/api/models/" + encodeURIComponent(pick));
          if (rr.ok) return this.applyExternal(await rr.json(), pick);
          this.tip("读取失败：" + pick); return;
        }
      }
      this.pickFile(".voxa,.json", async (f) => {
        try { this.applyExternal(JSON.parse(await f.text()), f.name.replace(/\.(voxa|json)$/i, "")); }
        catch (err) { this.tip("参照文件解析失败：" + err.message); }
      });
    } catch { this.tip("无法读取模型列表"); }
  }
  applyExternal(raw, label) {
    try {
      const doc = deserialize(raw);
      const mesh = this.view.setExternal(doc, this._extOpacity || 0.28);
      if (!mesh) { this.tip("参照模型没有可显示的体素"); return; }
      this._extDoc = doc; this._extLabel = label; this._extOn = true;
      this.tip("已载入外部参照「" + label + "」· 再次点「外部部件预览」开关可显隐");
    } catch (e) { this.tip("载入失败：" + e.message); }
  }
  toggleExternal() {
    if (!this.view.external) { this.tip("还没有外部参照，先「载入外部参照模型」"); return; }
    this._extOn = !this._extOn;
    this.view.external.visible = this._extOn;
    this.tip(this._extOn ? "外部参照：显示" : "外部参照：隐藏");
  }
  /* ---------------- 版本历史 ---------------- */
  histKey() { return "dao3_voxa_hist:" + (this.doc && this.doc.name || "未命名模型"); }
  listHistory() {
    try { return JSON.parse(localStorage.getItem(this.histKey()) || "[]"); } catch { return []; }
  }
  pushHistory(label, quiet) {
    const raw = serialize(this.doc);
    const list = this.listHistory();
    list.unshift({ t: Date.now(), label: label || "存档", raw: JSON.stringify(raw) });
    while (list.length > 24) list.pop();
    try { localStorage.setItem(this.histKey(), JSON.stringify(list)); }
    catch { list.splice(8); try { localStorage.setItem(this.histKey(), JSON.stringify(list)); } catch {} }
    if (!quiet) this.toast("已存版本 · 共 " + list.length + " 条");
  }
  restoreHistory(t) {
    const rec = this.listHistory().find((v) => v.t === t);
    if (!rec) return;
    this.snapshot("恢复版本前");
    try {
      this.doc = deserialize(JSON.parse(rec.raw));
      this.activePart = this.doc.parts[0] || null;
      this.activeBone = this.doc.bones[0] || null;
      this.view.setDoc(this.doc);
      this.renderAll();
      this.saveLocal();
      this.toast("已恢复到 " + new Date(rec.t).toLocaleString());
    } catch (e) { this.toast("恢复失败：" + e.message); }
  }
  dropHistory(t) {
    localStorage.setItem(this.histKey(), JSON.stringify(this.listHistory().filter((v) => v.t !== t)));
  }
  showHistory() {
    const old = document.getElementById("vxHistModal");
    if (old) old.remove();
    const list = this.listHistory();
    const m = document.createElement("div");
    m.id = "vxHistModal"; m.className = "vx-modal show";
    const box = document.createElement("div"); box.className = "vx-modal-box vx-hist";
    const h = document.createElement("h3"); h.textContent = "版本历史 · " + (this.doc.name || "未命名模型");
    box.appendChild(h);
    if (!list.length) {
      const e = document.createElement("div"); e.className = "vx-hist-empty";
      e.textContent = "还没有版本。用菜单里的「存为一个版本」留档，每次保存也会自动记一条。";
      box.appendChild(e);
    }
    for (const v of list) {
      const row = document.createElement("div"); row.className = "vx-hist-row";
      const info = document.createElement("div"); info.className = "vx-hist-info";
      let stat = "";
      try { const d = JSON.parse(v.raw); stat = (d.parts || []).length + " 部件 · " + (d.bones || []).length + " 骨骼 · " + (d.anims || []).length + " 动画"; } catch {}
      info.innerHTML = "<b>" + new Date(v.t).toLocaleString() + "</b><span>" + v.label + (stat ? " · " + stat : "") + "</span>";
      const rst = document.createElement("button"); rst.textContent = "恢复"; rst.className = "vx-mini";
      rst.onclick = () => { if (confirm("恢复到这个版本？当前内容会先进入撤销栈。")) { this.restoreHistory(v.t); m.remove(); } };
      const del = document.createElement("button"); del.textContent = "删除"; del.className = "vx-mini vx-hist-del";
      del.onclick = () => { this.dropHistory(v.t); this.showHistory(); };
      row.appendChild(info); row.appendChild(rst); row.appendChild(del);
      box.appendChild(row);
    }
    const close = document.createElement("button"); close.textContent = "关闭"; close.className = "vx-btn";
    close.onclick = () => m.remove();
    box.appendChild(close);
    m.appendChild(box);
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    document.body.appendChild(m);
  }
  /* ---------- V口令：把当前模型压进一段可粘贴分享的文本 ---------- */
  _codeModal(title, hint, makeBody) {
    const old = document.getElementById("vxCodeModal");
    if (old) old.remove();
    const m = document.createElement("div");
    m.id = "vxCodeModal"; m.className = "vx-modal show";
    const box = document.createElement("div"); box.className = "vx-modal-box";
    const h = document.createElement("h3"); h.textContent = title; box.appendChild(h);
    if (hint) { const p = document.createElement("div"); p.className = "vx-hint"; p.textContent = hint; box.appendChild(p); }
    const ta = document.createElement("textarea");
    ta.className = "vx-code-ta"; ta.spellcheck = false;
    box.appendChild(ta);
    const row = document.createElement("div"); row.className = "vx-row";
    const ok = document.createElement("button"); ok.className = "vx-btn";
    const close = document.createElement("button"); close.textContent = "关闭"; close.className = "vx-mini";
    close.onclick = () => m.remove();
    row.appendChild(ok); row.appendChild(close);
    box.appendChild(row); m.appendChild(box);
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    document.body.appendChild(m);
    makeBody(ta, ok);
    setTimeout(() => ta.focus(), 60);
    return m;
  }
  async shareCode() {
    const raw = new TextEncoder().encode(JSON.stringify(serialize(this.doc)));
    const code = "V1" + b64urlEnc(await gzipBytes(raw));
    const vox = stats(this.doc).voxels ?? (this.doc.parts || []).reduce((n, p) => n + ((p.voxels || []).length / 4 | 0), 0);
    this._codeModal("V口令 · " + (this.doc.name || "未命名模型"),
      `口令含 ${code.length.toLocaleString()} 个字符（原 JSON ${raw.length.toLocaleString()} 字节）。复制后发给别人，对方用菜单里的「粘贴 V口令导入」即可还原。`,
      (ta, ok) => {
        ta.value = code; ta.readOnly = true;
        ok.textContent = "复制到剪贴板";
        ok.onclick = async () => {
          ta.select();
          let done = false;
          try { await navigator.clipboard.writeText(code); done = true; } catch {}
          if (!done) done = document.execCommand("copy");
          this.toast(done ? "口令已复制" : "复制失败，请手动全选复制");
        };
      });
    this.tip(`已生成口令：${(this.doc.parts || []).length} 部件 · ${vox} 体素 · ${code.length} 字符`);
  }
  pasteCode() {
    this._codeModal("粘贴 V口令导入",
      "口令导入会覆盖当前编辑内容（当前内容会先进入撤销栈）。",
      (ta, ok) => {
        ta.placeholder = "V1…";
        ok.textContent = "载入口令模型";
        ok.onclick = async () => {
          try {
            const doc = await this.decodeShare(ta.value);
            this.snapshot("导入 V口令");
            this.doc = doc;
            this.activePart = this.doc.parts[0] || null;
            this.view.setDoc(this.doc);
            $("vxName").value = this.doc.name;
            this.renderAll(); this.saveLocal(); this.view.focus();
            document.getElementById("vxCodeModal")?.remove();
            this.toast("已导入口令：" + (this.doc.name || "未命名模型"));
          } catch (e) { this.toast("口令无效：" + (e.message || e)); }
        };
      });
  }
  async decodeShare(code) {
    const t = String(code || "").trim().replace(/\s+/g, "");
    if (!t.startsWith("V1")) throw new Error("口令应以 V1 开头");
    const json = JSON.parse(new TextDecoder().decode(await gunzipBytes(b64urlDec(t.slice(2)))));
    return deserialize(json);
  }
  async save() {
    const raw = serialize(this.doc);
    this.saveLocal();
    this.pushHistory("保存", true);
    try {
      const r = await fetch(`/api/models/${encodeURIComponent(this.doc.name)}`, { method: "POST", body: JSON.stringify(raw) });
      if (r.ok) this.toast("已保存：" + this.doc.name);
      else this.toast("已存到本地（服务端保存失败）");
    } catch { this.toast("已存到本地"); }
    this.renderAll();
  }
  /** 整份换掉当前作品。以前 openFile 直接 this.doc = ...，既不拍快照也不问一句，
      于是"打开一个文件"会把没保存的作品原地抹掉，连撤销都撤不回来。 */
  loadDoc(doc, label) {
    this.snapshot(label);
    this.doc = doc;
    this.doc.parts.forEach((p) => bindDoc(p, this.doc));
    this.activePart = this.doc.parts[0] || null;
    this.activeBone = this.doc.bones[0] || null;
    this.color = this.doc.palette[0] || this.color;
    this.picked.clear();
    this.selection = [];
    this.view.setDoc(this.doc);
    $("vxName").value = this.doc.name;
    this.renderAll();
    this.applyDocType();
    this.view.focus();
  }
  async openFile(f) {
    const text = await f.text();
    try {
      const next = deserialize(JSON.parse(text));
      // 换文档先拍快照，所以"手滑打开了别的文件"是一次 Ctrl+Z 就能撤回去的事，
      // 不需要再拿一个确认框拦所有人。
      this.loadDoc(next, "打开文件");
      this.toast(`已打开 ${f.name} · 按 Ctrl+Z 可退回上一份`);
    } catch (e) { this.toast("文件解析失败：" + e.message); }
  }
  async importVoxFile(f) {
    const buf = await f.arrayBuffer();
    try {
      const { decodeVox } = await import("../world.js");
      const bytes = new Uint8Array(buf);
      const voxels = decodeVox(bytes);
      const pal = parseVoxPalette(bytes);
      this.snapshot("导入 VOX");
      const part = importVox(voxels, pal, this.doc, f.name.replace(/\.vox$/i, ""));
      if (part) this.activePart = part;
      this.view.rebuild();
      this.view.setActivePart(this.activePart);
      this.renderAll();
      this.view.focus();
      this.toast(`已导入 VOX：${voxels.length} 体素`);
    } catch (e) { this.toast("VOX 导入失败：" + (e.message || e)); }
  }
  exportGlb() {
    const blob = toGLB(this.doc);
    download(blob, this.doc.name + ".glb");
    this.toast("已导出 glTF");
  }
  /** 发布到社区：作品跟着账号走，别人能在广场看到并下载/在 VOXA 里打开。 */
  async publishModel() {
    const { openModelPublishDialog } = await import("../publish-model.js");
    openModelPublishDialog(this.doc, (msg) => this.toast(msg));
  }
  async publish() {
    const worldId = new URLSearchParams(location.search).get("world") || localStorage.getItem("dao3_last_world") || "216d665d3ca92bd1b9a2";
    const base = this.doc.name.replace(/[\\/:*?"<>|]/g, "_");
    const blob = toGLB(this.doc);
    const buf = await blob.arrayBuffer();
    try {
      const r = await fetch(`/api/world/${worldId}/asset?path=${encodeURIComponent("models/" + base)}.glb`, { method: "POST", body: buf });
      if (!r.ok) throw new Error("HTTP " + r.status);
      await fetch(`/api/world/${worldId}/asset?path=${encodeURIComponent("models/" + base)}.voxa.json`, { method: "POST", body: JSON.stringify(serialize(this.doc)) });
      // 提示语以前说"已导出 mesh/xxx.vb"，但这里实际上传的是 .glb + .voxa.json，
      // 玩家按那句话去素材列表找 .vb 是找不到的
      this.toast(`已进世界素材库：models/${base}.glb`);
    } catch (e) { this.toast("导出失败：" + e.message); }
  }
  tip(msg) { const el = $("vxTip"); el.textContent = msg; el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1400); }
  toast(msg) {
    const el = $("vxToast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(this._tt);
    this._tt = setTimeout(() => el.classList.remove("show"), 2600);
  }
}
/* ---------------- 小工具 ---------------- */
function parseVec(text, dflt) {
  const parts = String(text).split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
  return parts.length >= 3 ? parts.slice(0, 3) : (dflt || [0, 0, 0]).slice();
}
function dominantAxis(n) {
  const a = Math.abs(n[0]), b = Math.abs(n[1]), c = Math.abs(n[2]);
  return a >= b && a >= c ? 0 : b >= c ? 1 : 2;
}
function rangeCells(a, b) {
  const l = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])].map(Math.floor);
  const h = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])].map(Math.floor);
  const out = [];
  for (let x = l[0]; x <= h[0]; x++) for (let y = l[1]; y <= h[1]; y++) for (let z = l[2]; z <= h[2]; z++) {
    out.push([x, y, z]);
    if (out.length > 20000) return out;
  }
  return out;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function section(title, rows) {
  const d = document.createElement("div");
  d.className = "vx-sec";
  const h = document.createElement("div");
  h.className = "vx-sec-h";
  h.textContent = title;
  d.appendChild(h);
  for (const r of rows) d.appendChild(r);
  return d;
}
/** 官方「参数」面板一行的形状：一个名字 + 三个独立数字格，每格后挂 X/Y/Z
 *  （旋转带 °、缩放带 %）。以前是一格 "0, 0, 0" 的文本框——
 *  三个数挤在一起，只想改 Y 就得把三个数重打一遍，也没有单位。 */
function axisRow(label, values, onSet, opts = {}) {
  const { unit = "", step = 0.1, vecKey = null, snap = null, ints = false } = opts;
  const row = document.createElement("div");
  row.className = "vx-row vx-axis2";
  const lab = document.createElement("label");
  lab.textContent = label;
  row.appendChild(lab);
  ["X", "Y", "Z"].forEach((ax, i) => {
    const cell = document.createElement("span");
    cell.className = "vx-axcell";
    const inp = document.createElement("input");
    inp.type = "number"; inp.step = step;
    const v = values[i] ?? 0;
    inp.value = ints ? String(Math.round(v)) : String(+v.toFixed(2));
    if (vecKey) { inp.dataset.vec = vecKey; inp.dataset.i = String(i); }
    inp.title = `${label} ${ax}`;
    inp.onchange = () => {
      const next = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
      const raw = Number(inp.value);
      next[i] = ints ? clamp(Math.round(Number.isFinite(raw) ? raw : 1), 1, MAX_BOX) : (Number.isFinite(raw) ? raw : 0);
      if (snap) snap();
      onSet(next);
    };
    cell.appendChild(inp);
    const cap = document.createElement("em");
    cap.className = "ax " + ax.toLowerCase();
    cap.textContent = ax + unit;
    cell.appendChild(cap);
    row.appendChild(cell);
  });
  return row;
}

function vecRow(label, value, set, key, snap) {
  const row = document.createElement("div");
  row.className = "vx-row";
  row.innerHTML = `<label>${label}</label>`;
  const inp = document.createElement("input");
  inp.className = "vx-vec";
  if (key) inp.dataset.vec = key;
  inp.value = value.map((v) => +v.toFixed(2)).join(", ");
  // 每一次提交都先拍快照再改：以前数值框完全进不了撤销栈，
  // 手滑打错一个数只能自己凭记忆打回去。
  inp.onchange = () => { if (snap) snap(); set(parseVec(inp.value, value)); };
  row.appendChild(inp);
  return row;
}
function sliderRow(label, value, set) {
  // 官方这一行是"滑条 + 一个百分比读数框"：光有 0..1 的小数字既不好读也没法直接输入
  const row = document.createElement("div");
  row.className = "vx-row";
  row.innerHTML = `<label>${label}</label><input type="range" min="0" max="1" step="0.01" value="${value}"/>`
    + `<span class="vx-pct"><input type="number" min="0" max="100" step="1" value="${Math.round(value * 100)}"/><em>%</em></span>`;
  const r = row.querySelector('input[type="range"]'), n = row.querySelector('input[type="number"]');
  const show = (v) => { r.value = v; n.value = Math.round(v * 100); };
  r.oninput = () => { n.value = Math.round(r.value * 100); set(Number(r.value)); };
  n.onchange = () => set(clamp((Number(n.value) || 0) / 100, 0, 1));
  row.showValue = show;
  return row;
}
function selectRow(label, values, labels, value, set) {
  const row = document.createElement("div");
  row.className = "vx-row";
  row.innerHTML = `<label>${label}</label>`;
  const s = document.createElement("select");
  values.forEach((v, i) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = labels[i];
    if (v === value) o.selected = true;
    s.appendChild(o);
  });
  s.onchange = () => set(s.value);
  row.appendChild(s);
  return row;
}
function btnRow(pairs) {
  const d = document.createElement("div");
  d.className = "vx-btnrow";
  for (const [label, fn] of pairs) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    d.appendChild(b);
  }
  return d;
}
function boneOpacityOf(bone) { return bone.op ?? 1; }

/* HSV 取色块要自己算。注意 model.js 的 hexToRgb/rgbToHex 走的是 **0..1** 分量
   （直接喂给 three.js 材质），而官方色板上的 R/G/B 显示的是 0..255。
   混用会把颜色全部压成白色，所以这里自带一对 0..255 的版本，命名上区分开。 */
function hexTo255(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb255ToHex(r, g, b) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const c = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
}
function rgbHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  // h 到这里是 0..6 段号，色相条的量程是 0..360（voxa.html 的 max="360"）。
  // 以前写成 Math.round(h / 6) % 60：既把段号又除了一次 6，又对 60 取模，
  // 于是滑块永远停在 0~1 附近，色相条上六分之五的颜色点不到。
  return Math.round(h * 60) % 360;
}
/** 反解取色块上的圆点位置：x = 饱和度，y = 1 − 明度 */
function rgbToSv(r, g, b) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const v = mx, s = mx ? (mx - mn) / mx : 0;
  return [Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, 1 - v))];
}
// V口令编解码：gzip + base64url（无 CompressionStream 时退化为不压缩）
async function gzipBytes(u8) {
  if (typeof CompressionStream === "undefined") return u8;
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipBytes(u8) {
  if (typeof DecompressionStream === "undefined") return u8;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function b64urlEnc(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDec(t) {
  const s = String(t).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

window.__voxa = new VoxaApp();
