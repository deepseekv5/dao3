// voxa/app.js — VOXA 编辑器交互层：四种工作模式、体素工具、部件/骨骼/调色板、
// 24fps 动画时间轴、物理盒、导入导出与"导出到世界"。
import * as THREE from "../../vendor/three/three.module.js";
import { VoxaView } from "./view.js";
import {
  newDoc, newPart, newBone, newAnim, addPart, clonePart, serialize, deserialize, stats,
  setVoxel, eraseVoxel, getVoxel, ensureColor, colorOf, removeUnusedColors, autoCrop, transformVoxels,
  floodSelect, fillRange, eraseRange, linePoints, extrude, addBone, childBones, removeBone, bindPart,
  groupParts, curAnim, createFrame, SKIN_BONES, MAX_PARTS, hexToRgb, rgbToHex, toGLB, importVox,
  parseVoxPalette, refreshPhysics, invalidateIndex, bindDoc,
} from "./model.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MODEL_KEY = "dao3_voxa_current";

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
    this.doc = this.loadLocal() || newDoc();
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
    this.frame = 0;
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
    this.doc = deserialize(raw);
    this.activePart = this.doc.parts.find((p) => p.id === id) || this.doc.parts[0] || null;
    this.view.setDoc(this.doc);
    this.selection = [];
    this.renderAll();
  }

  /* ---------------- UI 绑定 ---------------- */
  bindUI() {
    const cv = $("vxCanvas");
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
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
    $("vxAddPart").onclick = () => { this.snapshot("新建部件"); addPart(this.doc, newPart("Object" + (this.doc.parts.length + 1), [8, 8, 8])); this.activePart = this.doc.parts[this.doc.parts.length - 1]; this.view.rebuild(); this.renderAll(); };
    $("vxDupPart").onclick = () => { if (!this.activePart) return; this.snapshot("复制部件"); const c = clonePart(this.doc, this.activePart); this.activePart = c; this.view.rebuild(); this.renderAll(); };
    $("vxGroup").onclick = () => {
      if (!this.selection.length || !this.activePart) return this.tip("先框选要编组的部件");
      this.snapshot("编组");
      groupParts(this.doc, [this.activePart], "Group" + ((this.doc.groups || []).length + 1));
      this.tip("已编组，可整体绑定到骨骼节点");
    };
    $("vxAddBone").onclick = () => { this.snapshot("新建骨骼"); const b = addBone(this.doc, "Bone", this.activeBone); this.activeBone = b; this.view.buildBones(); this.renderAll(); };
    $("vxSkinTemplate").onclick = () => this.loadSkinTemplate();
    $("vxAddColor").onclick = () => { this.doc.palette.push({ i: "c" + Date.now().toString(36), hex: "#88aaff", emissive: 0 }); this.renderPalette(); };
    $("vxCleanColors").onclick = () => { this.snapshot("清除未用颜色"); removeUnusedColors(this.doc); this.renderPalette(); this.view.rebuild(); };
    $("phMode").onchange = () => { this.doc.physics.mode = $("phMode").value; refreshPhysics(this.doc); this.renderPhysics(); };
    $("phPos").onchange = () => { this.doc.physics.center = parseVec($("phPos").value, this.doc.physics.center); this.dirty(); };
    $("phSize").onchange = () => { this.doc.physics.size = parseVec($("phSize").value, this.doc.physics.size); this.dirty(); };
    $("vxAnimNew").onclick = () => { this.doc.anims.push(newAnim("anim" + (this.doc.anims.length + 1))); this.doc.curAnim = this.doc.anims.length - 1; this.renderTimeline(); this.dirty(); };
    $("vxAnimDel").onclick = () => { if (this.doc.anims.length <= 1) return; this.doc.anims.splice(this.doc.curAnim, 1); this.doc.curAnim = 0; this.renderTimeline(); this.dirty(); };
    $("vxPlay").onclick = () => { this.playing = 1; };
    $("vxPlayRev").onclick = () => { this.playing = -1; };
    $("vxToStart").onclick = () => { this.playing = 0; this.setFrame(0); };
    $("vxToEnd").onclick = () => { this.playing = 0; this.setFrame(Math.max(0, this.view.frameBounds())); };
    $("vxSpeed").onclick = () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1; $("vxSpeed").textContent = this.speed + "x"; };
    $("vxKey").onclick = () => this.keyframe();
    $("vxScrub").oninput = () => { this.setFrame(Number($("vxScrub").value)); };
    this.wireChrome();
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); this.save(); return; }
      const map = { b: "build", e: "erase", l: "line", f: "face", g: "paint", k: "bucket", w: "wand", s: "select", x: "extrude", m: "move", r: "rot" };
      if (map[k] && !e.ctrlKey && !e.metaKey) { this.setTool(map[k]); }
      if (k === "delete" && this.selection.length) this.applySelectionOp("erase");
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
        this.snapshot("部件框大小");
        p.size[i] = Math.max(1, Math.min(128, Math.round(Number($(id).value) || 1)));
        this.view.rebuildBoxes(); this.syncSizeBoxes(); this.renderProps();
      };
    }
    $("vxCrop").onclick = () => {
      const p = this.activePart; if (!p) return this.tip("请先选中部件");
      this.snapshot("裁剪"); autoCrop(p); this.view.rebuild(); this.renderProps(); this.syncSizeBoxes();
    };

    $("vxBack").onclick = () => this.setInPart(false);
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
    $("spLocal").onclick = () => setSpace("local");
    $("spWorld").onclick = () => setSpace("world");
    $("propSpace").onclick = () => setSpace(this.space === "local" ? "world" : "local");

    // 底栏
    $("uUndo").onclick = () => this.undo();
    $("uRedo").onclick = () => this.redo();
    $("vxProj").onchange = () => this.view.setOrtho($("vxProj").value === "ortho");
    $("vxEdge").onchange = () => this.setEdges($("vxEdge").value === "show");
    const tgl = (id, fn) => { const b = $(id); b.onclick = () => { const on = !b.classList.contains("on"); b.classList.toggle("on", on); fn(on); }; };
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
    cv.addEventListener("pointerdown", (e) => { e.preventDefault(); cv.setPointerCapture(e.pointerId); at(e); });
    cv.addEventListener("pointermove", (e) => { if (e.buttons === 1) at(e); });
    $("vxHue").oninput = () => { paint(Number($("vxHue").value)); this.syncColorFields(); };
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
    $("vxGlow").oninput = (e) => {
      const c = this.color; if (!c) return;
      c.emissive = Number(e.target.value) / 100;
      $("vxGlowVal").textContent = Math.round(c.emissive * 100) + "%";
      this.view.rebuildPart && this.view.rebuildPart(this.activePart);
      this.snapshot("发光");
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
      case "new": if (confirm("新建模型会清空当前内容？")) { this.doc = newDoc(); this.activePart = null; this.seedStarterPart(); this.view.setDoc(this.doc); this.renderAll(); } break;
      case "save": this.save(); break;
      case "open": this.pickFile(".voxa,.json", (f) => this.openFile(f)); break;
      case "importVox": this.pickFile(".vox", (f) => this.importVoxFile(f)); break;
      case "exportGlb": this.exportGlb(); break;
      case "publish": this.publish(); break;
      case "undo": this.undo(); break;
      case "redo": this.redo(); break;
      case "saveVersion": this.pushHistory("手动存档"); break;
      case "versions": this.showHistory(); break;
      case "extLoad": this.loadExternal(); break;
      case "extToggle": this.toggleExternal(); break;
      case "extClear": this.view.clearExternal(); this._extDoc = null; this.tip("已清除外部参照"); break;
      case "shareCode": this.shareCode(); break;
      case "pasteCode": this.pasteCode(); break;
      case "toggleBones": this.view.setBoneVisible(!this.view.showBones); break;
      case "toggleBoxes": this.view.setBoxesVisible(!this.view.showBoxes); break;
      case "grid": this.view.grid.visible = !this.view.grid.visible; break;
      case "resetView": this.view.focus(); break;
      case "lang": this.tip("当前语言：简体中文"); break;
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
    const vox = this.mode !== "anim" && this.mode !== "physics" && this.inPart;
    $("vxTimeline").classList.toggle("show", anim);
    $("vxPhysics").classList.toggle("show", phys);
    // 顶栏的镜像/旋转/翻转/部件框大小只属于体素层，坐标系切换属于部件层与动画层
    for (const id of ["grpMirror", "grpRotate", "grpFlip", "grpSize"]) $(id).hidden = !vox;
    $("grpSpace").hidden = vox || phys;
    $("vxBack").hidden = !vox;
    $("sectPalette").style.display = phys ? "none" : "";
    $("sectProps").style.display = anim && !this.activePart ? "" : "";
    $("vxVoxOps").style.display = vox ? "" : "none";
    if (anim) { this.renderTimeline(); this.setFrame(this.frame); }
    if (phys) { refreshPhysics(this.doc); this.renderPhysics(); }
    if (this.mode === "skin") this.loadSkinTemplate(true);
    this.buildTools();
    this.syncSizeBoxes();
  }
  /** 把当前部件框尺寸回填到顶栏的三个数字框 */
  syncSizeBoxes() {
    const p = this.activePart;
    if (!p) return;
    $("boxX").value = p.size[0]; $("boxY").value = p.size[1]; $("boxZ").value = p.size[2];
  }

  /* ---------------- 编辑工具栏（左侧竖排图标） ---------------- */
  // 官方三套竖栏内容不同：部件层 6 个、体素层 11 个、动画层 3 个，
  // 且体素层要先「进入部件」才出现（视口左上角的 ← 返回 就是退出）。
  static RAIL_PART = [
    ["move", "move"], ["rot", "rot"], ["scale", "scale"], ["-", "-"],
    ["partNew", "newPart"], ["partDup", "dupPart"], ["bone", "addBone"], ["enter", "enterPart"],
  ];
  static RAIL_VOXEL = [
    ["move", "move"], ["select", "select"], ["wand", "wand"], ["line", "line"], ["lineDel", "lineDel"],
    ["face", "face"], ["faceDel", "faceDel"], ["extrude", "extrude"], ["bucket", "bucket"],
    ["paint", "paint"], ["eyedropper", "eyedropper"],
  ];
  static RAIL_ANIM = [["move", "move"], ["rot", "rot"], ["scale", "scale"]];

  buildTools() {
    const host = $("vxTools");
    host.innerHTML = "";
    const list = this.mode === "anim" ? VoxaApp.RAIL_ANIM
      : this.mode === "physics" ? []
        : this.mode === "skin" ? (this.inPart ? VoxaApp.RAIL_VOXEL : VoxaApp.RAIL_PART)
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
  setEdges(on) {
    this._edges = !!on;
    for (const n of this.view.partNodes.values()) {
      if (!n.mesh) continue;
      n.mesh.material.wireframe = this._edges;
      if (n.emissive) n.emissive.material.wireframe = this._edges;
    }
  }
  toggleEdges() { this.setEdges(!this._edges); }
  /** 底栏的发光开关：隐藏 emissive 层即可实时看到关掉自发光的效果 */
  setGlow(on) {
    for (const n of this.view.partNodes.values()) if (n.emissive) n.emissive.visible = !!on;
  }

  /* ---------------- 指针交互 ---------------- */
  onDown(e) {
    if (e.button !== 0) return;
    if (this.mode === "physics") return;
    const hit = this.view.pickVoxel(e);
    const bone = this.mode === "anim" ? this.view.pickBone(e) : null;
    if (bone) { this.activeBone = bone; this.drag = { kind: "bone", bone, x: e.clientX, y: e.clientY }; this.renderBones(); this.renderProps(); return; }
    if (this.tool === "select") {
      this.drag = { kind: "select", start: hit ? hit.cell : this.view.pickPlane(e, this.activePart ? this.activePart.size[1] / 2 : 0) || [0, 0, 0] };
      return;
    }
    if (["move", "rot", "scale"].includes(this.tool) && hit) {
      this.activePart = hit.part;
      this.view.setActivePart(hit.part);
      this.drag = { kind: this.tool, part: hit.part, x: e.clientX, y: e.clientY, pos: hit.part.pos.slice(), rot: hit.part.rot.slice(), scale: hit.part.scale.slice() };
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
    if (d.kind === "bone") {
      const dx = (e.clientX - d.x) * 0.06, dy = (e.clientY - d.y) * 0.06;
      d.bone.position[0] = +(d.bone.position[0] + dx).toFixed(2);
      d.bone.position[2] = +(d.bone.position[2] + dy).toFixed(2);
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
    if (d.kind === "move") {
      const dx = (e.clientX - d.x) * 0.08, dy = (e.clientY - d.y) * 0.08;
      d.part.pos = [+(d.pos[0] + dx).toFixed(2), +(d.pos[1] - dy).toFixed(2), d.pos[2]];
      this.view.applyPartTransform(d.part);
      this.view.rebuildBoxes();
      this.renderProps();
      return;
    }
    if (d.kind === "rot") {
      d.part.rot = [d.rot[0], +(d.rot[1] + (e.clientX - d.x) * 0.6).toFixed(1), d.rot[2]];
      this.view.applyPartTransform(d.part);
      this.renderProps();
      return;
    }
    if (d.kind === "scale") {
      const s = clamp(d.scale[0] * (1 + (e.clientX - d.x) * 0.004), 0.05, 20);
      d.part.scale = [s, s, s];
      this.view.applyPartTransform(d.part);
      this.renderProps();
      return;
    }
    if (d.kind === "voxel" && this.activePart) {
      const hit = this.view.pickVoxel(e);
      if (!hit) return;
      d.end = hit.cell.slice();
      if (["line", "lineDel", "face", "faceDel"].includes(this.tool)) {
        const cells = this.tool.startsWith("line") ? linePoints(d.start, d.end) : rangeCells(d.start, d.end);
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
        const cells = rangeCells(d.start, d.end);
        for (const c of cells) this.placeOrErase(c, this.tool === "face");
      }
      this.view.rebuildPart(this.activePart);
      this.renderStat();
    }
    if (d.kind === "select") this.renderProps();
    if (["move", "rot", "scale"].includes(d.kind)) { this.snapshot(d.kind); this.dirty(); }
    this.view.showSelection(this.selection);
  }
  applyVoxelTool(hit) {
    const p = this.activePart || hit.part;
    this.activePart = p;
    switch (this.tool) {
      case "build": setVoxel(this.doc, p, hit.adjacent[0], hit.adjacent[1], hit.adjacent[2], this.color.hex, this.color.emissive); break;
      case "erase": eraseVoxel(p, hit.cell[0], hit.cell[1], hit.cell[2]); break;
      case "paint": { const v = getVoxel(p, ...hit.cell); if (v) { v.c = ensureColor(this.doc, this.color.hex, this.color.emissive); } break; }
      case "bucket": { const cells = floodSelect(p, hit.cell, true); for (const c of cells) { const v = getVoxel(p, ...c); if (v) v.c = ensureColor(this.doc, this.color.hex, this.color.emissive); } break; }
      case "wand": this.selection = floodSelect(p, hit.cell, true); this.view.showSelection(this.selection); this.tip(`魔棒选中 ${this.selection.length} 个体素`); return;
      case "eyedropper": { const v = getVoxel(p, ...hit.cell); if (v) { this.color = colorOf(this.doc, v.c); this.renderPalette(); this.tip("已取色 " + this.color.hex); } return; }
      case "extrude": { const h = this._extrudeH || 1; extrude(this.doc, p, [hit.cell], dominantAxis(hit.normal), h); this.view.rebuildPart(p); this.tip(`挤出 ${h} 格`); break; }
      default: return;
    }
    this.view.rebuildPart(p);
    this.renderStat();
  }
  placeOrErase(cell, place) {
    const p = this.activePart;
    if (!p) return;
    if (place) setVoxel(this.doc, p, cell[0], cell[1], cell[2], this.color.hex, this.color.emissive);
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
  renderAll() { this.renderParts(); this.renderBones(); this.renderPalette(); this.renderProps(); this.renderVoxOps(); this.renderTools(); this.renderStat(); this.renderTimeline(); }
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
      row.className = "vx-item" + (p === this.activePart ? " active" : "");
      const bone = this.doc.bones.find((b) => b.id === p.bone);
      row.innerHTML = `<span class="vi-eye">${p.visible === false ? "▫" : "◼"}</span>
        <span class="vi-name">${esc(p.name)}</span>
        <span class="vi-meta">${p.voxels.length} · ${bone ? bone.name : "未绑定"}</span>
        <button class="vi-del">✕</button>`;
      row.onclick = (e) => {
        if (e.target.classList.contains("vi-eye")) { this.snapshot("可见性"); p.visible = p.visible === false; this.view.rebuildPart(p); this.renderParts(); return; }
        if (e.target.classList.contains("vi-del")) { this.snapshot("删除部件"); this.doc.parts = this.doc.parts.filter((x) => x !== p); this.activePart = this.doc.parts[0] || null; this.view.rebuild(); this.renderAll(); return; }
        this.activePart = p;
        this.view.setActivePart(p);
        this.renderParts(); this.renderProps();
      };
      row.ondblclick = () => {
        const inp = row.querySelector(".vi-name");
        inp.contentEditable = "true";
        inp.focus();
        inp.onblur = () => { p.name = inp.textContent.trim() || p.name; inp.contentEditable = "false"; this.snapshot("重命名"); this.renderParts(); };
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
          if (e.target.classList.contains("vi-del")) { this.snapshot("删除骨骼"); removeBone(this.doc, b.id); this.activeBone = this.doc.bones[0]; this.view.buildBones(); this.renderAll(); return; }
          this.activeBone = b;
          this.renderBones(); this.renderProps();
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
  renderPalette(keepFields) {
    const host = $("vxPalette");
    host.innerHTML = "";
    for (const c of this.doc.palette) {
      const el = document.createElement("div");
      el.className = "vx-swatch" + (c === this.color ? " active" : "");
      el.style.background = c.hex;
      el.title = `${c.hex} 发光 ${((c.emissive || 0) * 100).toFixed(0)}%`;
      if ((c.emissive || 0) > 0.02) el.classList.add("glow");
      el.onclick = () => { this.color = c; this.renderPalette(); this.renderProps(); };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        const inp = document.createElement("input");
        inp.type = "color"; inp.value = c.hex;
        inp.oninput = () => { c.hex = inp.value; el.style.background = c.hex; this.view.rebuild(); this.syncColorFields(); };
        inp.click();
      };
      host.appendChild(el);
    }
    if (!keepFields) this.syncColorFields();
  }
  renderProps() {
    const host = $("vxProps");
    host.innerHTML = "";
    if (this.mode === "anim" && this.activeBone) {
      host.appendChild(section("骨骼 " + this.activeBone.name, [
        vecRow("位移", this.activeBone.position, (v) => { this.activeBone.position = v; this.view.buildBones(); }),
        vecRow("旋转", this.activeBone.rotation, (v) => { this.activeBone.rotation = v; this.view.buildBones(); }),
        vecRow("缩放", this.activeBone.scale, (v) => { this.activeBone.scale = v; this.view.buildBones(); }),
        sliderRow("不透明度", boneOpacityOf(this.activeBone), (val) => this.setBoneOpacity(val)),
      ]));
      host.appendChild(btnRow([["◆ 创建帧", () => this.keyframe()]]));
      return;
    }
    const p = this.activePart;
    if (!p) { host.innerHTML = '<div class="vx-empty">未选中部件</div>'; return; }
    host.appendChild(section("部件 " + p.name, [
      vecRow("位置", p.pos, (v) => { p.pos = v; this.view.applyPartTransform(p); this.view.rebuildBoxes(); }),
      vecRow("旋转", p.rot, (v) => { p.rot = v; this.view.applyPartTransform(p); }),
      vecRow("缩放", p.scale, (v) => { p.scale = v; this.view.applyPartTransform(p); }),
      vecRow("部件框", p.size, (v) => { p.size = v.map((x) => Math.max(1, Math.round(x))); this.view.rebuildBoxes(); }),
      selectRow("绑定骨骼", ["", ...this.doc.bones.map((b) => b.id)], ["未绑定", ...this.doc.bones.map((b) => b.name)], p.bone || "", (val) => {
        this.snapshot("绑定");
        bindPart(this.doc, p, val || null);
        this.view.rebuild();
        this.renderParts();
      }),
    ]));
    host.appendChild(btnRow([
      ["自动裁剪", () => { this.snapshot("裁剪"); autoCrop(p); this.view.rebuild(); this.renderProps(); }],
      ["清空部件", () => { this.snapshot("清空"); p.voxels = []; invalidateIndex(p); this.view.rebuildPart(p); this.renderStat(); }],
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
    fn(this.activePart);
    this.view.rebuild();
    this.renderStat();
  }
  renderPhysics() {
    const ph = this.doc.physics;
    $("phMode").value = ph.mode;
    $("phPos").value = ph.center.map((v) => +v.toFixed(2)).join(", ");
    $("phSize").value = ph.size.map((v) => +v.toFixed(2)).join(", ");
  }
  renderTimeline() {
    // 官方动画面板：左列「动画列表」，右侧骨骼节点轨道 + 秒刻度尺
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

    const ruler = $("vxRuler");
    ruler.innerHTML = "";
    for (let s = 0; s <= Math.ceil(max / 24); s++) {
      const t = document.createElement("span");
      t.className = "tick"; t.style.left = (s * 24 / max * 100) + "%"; t.textContent = s + "s";
      ruler.appendChild(t);
    }
    const head = document.createElement("span"); head.className = "playhead"; head.id = "playhead";
    ruler.appendChild(head);

    const host = $("vxTracks");
    host.innerHTML = "";
    const rows = this.doc.bones.filter((b) => anim && anim.tracks[b.id] && anim.tracks[b.id].length);
    for (const b of rows) {
      const row = document.createElement("div");
      row.className = "tl-row";
      const lab = document.createElement("span"); lab.className = "tl-bone"; lab.textContent = b.name;
      const lane = document.createElement("div"); lane.className = "tl-lane";
      for (const k of anim.tracks[b.id]) {
        const cell = document.createElement("button");
        cell.className = "tl-key" + (k.f === this.frame ? " active" : "");
        cell.style.left = (k.f / max * 100) + "%";
        cell.title = `第 ${k.f} 帧 · 缓动 ${k.ease}`;
        cell.onclick = () => this.setFrame(k.f);
        cell.oncontextmenu = (e) => {
          e.preventDefault();
          const i = EASINGS.indexOf(k.ease || "normal");
          k.ease = EASINGS[(i + 1) % EASINGS.length];
          cell.title = `第 ${k.f} 帧 · 缓动 ${k.ease}`;
          this.tip("缓动：" + k.ease);
        };
        lane.appendChild(cell);
      }
      row.appendChild(lab); row.appendChild(lane);
      host.appendChild(row);
    }
    if (!rows.length) host.innerHTML = '<div class="vx-empty">选中骨骼并移动它，然后点 ◆ 创建帧</div>';
  }
  setFrame(f) {
    this.frame = Math.max(0, f);
    $("vxScrub").value = this.frame;
    $("vxFrameNum").textContent = this.frame;
    const max = Math.max(1, Number($("vxScrub").max) || 24);
    const head = $("playhead");
    if (head) head.style.left = (this.frame / max * 100) + "%";
    const t = this.frame / 24;
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
      op: this.activeBone._op ?? 1,
    } : { position: this.activeBone.position, rotation: this.activeBone.rotation, scale: this.activeBone.scale, op: 1 };
    this.snapshot("创建帧");
    createFrame(this.doc, this.activeBone, t, this.frame);
    this.renderTimeline();
    this.tip(`已在第 ${this.frame} 帧创建关键帧`);
  }
  setBoneOpacity(v) {
    const b = this.activeBone;
    if (!b) return;
    b._op = v;
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
  async openFile(f) {
    const text = await f.text();
    try {
      this.doc = deserialize(JSON.parse(text));
      this.activePart = this.doc.parts[0] || null;
      this.view.setDoc(this.doc);
      $("vxName").value = this.doc.name;
      this.renderAll();
      this.view.focus();
      this.toast("已打开 " + f.name);
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
  async publish() {
    const worldId = new URLSearchParams(location.search).get("world") || localStorage.getItem("dao3_last_world") || "216d665d3ca92bd1b9a2";
    const base = this.doc.name.replace(/[\\/:*?"<>|]/g, "_");
    const blob = toGLB(this.doc);
    const buf = await blob.arrayBuffer();
    try {
      const r = await fetch(`/api/world/${worldId}/asset?path=${encodeURIComponent("models/" + base)}.glb`, { method: "POST", body: buf });
      if (!r.ok) throw new Error("HTTP " + r.status);
      await fetch(`/api/world/${worldId}/asset?path=${encodeURIComponent("models/" + base)}.voxa.json`, { method: "POST", body: JSON.stringify(serialize(this.doc)) });
      this.toast(`已导出到世界素材库：mesh/${base}.vb`);
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
function vecRow(label, value, set) {
  const row = document.createElement("div");
  row.className = "vx-row";
  row.innerHTML = `<label>${label}</label>`;
  const inp = document.createElement("input");
  inp.className = "vx-vec";
  inp.value = value.map((v) => +v.toFixed(2)).join(", ");
  inp.onchange = () => set(parseVec(inp.value, value));
  row.appendChild(inp);
  return row;
}
function sliderRow(label, value, set) {
  const row = document.createElement("div");
  row.className = "vx-row";
  row.innerHTML = `<label>${label}</label><input type="range" min="0" max="1" step="0.01" value="${value}"/><em>${value}</em>`;
  const r = row.querySelector("input");
  r.oninput = () => { row.querySelector("em").textContent = r.value; set(Number(r.value)); };
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
function boneOpacityOf(bone) { return bone._op ?? 1; }

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
  return Math.round(h / 6) % 60;
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
