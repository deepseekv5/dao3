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

class VoxaApp {
  constructor() {
    this.doc = this.loadLocal() || newDoc();
    this.doc.parts.forEach((p) => bindDoc(p, this.doc));
    if (!this.doc.parts.length) this.seedStarterPart();
    this.view = new VoxaView($("vxCanvas"), this.doc);
    this.mode = "model";
    this.tool = "build";
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
    $("vxAnimNew").onclick = () => { this.doc.anims.push(newAnim("anim" + (this.doc.anims.length + 1))); this.doc.curAnim = this.doc.anims.length - 1; this.renderTimeline(); };
    $("vxAnimDel").onclick = () => { if (this.doc.anims.length <= 1) return; this.doc.anims.splice(this.doc.curAnim, 1); this.doc.curAnim = 0; this.renderTimeline(); };
    $("vxAnimSel").onchange = () => { this.doc.curAnim = Number($("vxAnimSel").value); this.renderTimeline(); };
    $("vxPlay").onclick = () => { this.playing = 1; };
    $("vxPlayRev").onclick = () => { this.playing = -1; };
    $("vxSpeed").onclick = () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1; $("vxSpeed").textContent = this.speed + "x"; };
    $("vxKey").onclick = () => this.keyframe();
    $("vxScrub").oninput = () => { this.setFrame(Number($("vxScrub").value)); };
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
  menu(act) {
    switch (act) {
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
    $("vxTimeline").classList.toggle("show", anim);
    $("vxPhysics").classList.toggle("show", phys);
    $("vxVoxOps").style.display = this.mode === "model" ? "" : "none";
    if (anim) { this.renderTimeline(); this.setFrame(this.frame); }
    if (phys) { refreshPhysics(this.doc); this.renderPhysics(); }
    if (this.mode === "skin") this.loadSkinTemplate(true);
    this.buildTools();
  }

  /* ---------------- 工具条 ---------------- */
  buildTools() {
    const host = $("vxTools");
    host.innerHTML = "";
    const list = this.mode === "anim" ? ["move", "rot", "scale"]
      : this.mode === "skin" ? ["move"]
        : this.mode === "physics" ? []
          : Object.keys(TOOLS);
    for (const id of list) {
      const b = document.createElement("button");
      b.className = "vx-tool" + (this.tool === id ? " active" : "");
      b.textContent = TOOLS[id].label;
      b.title = TOOLS[id].hint;
      b.onclick = () => this.setTool(id);
      host.appendChild(b);
    }
    if (this.mode === "model") {
      const sep = document.createElement("span");
      sep.className = "vx-sep";
      host.appendChild(sep);
      for (const [label, fn] of [["透视/正交", () => this.view.setOrtho(!this.view.ortho)], ["边缘线", () => this.toggleEdges()], ["恢复视角", () => this.view.focus()]]) {
        const b = document.createElement("button");
        b.className = "vx-tool";
        b.textContent = label;
        b.onclick = fn;
        host.appendChild(b);
      }
    }
  }
  setTool(id) { this.tool = id; this.buildTools(); this.tip(TOOLS[id] ? TOOLS[id].hint : id); }
  toggleEdges() {
    this._edges = !this._edges;
    for (const n of this.view.partNodes.values()) {
      if (!n.mesh) continue;
      n.mesh.material.wireframe = this._edges;
      if (n.emissive) n.emissive.material.wireframe = this._edges;
    }
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
  renderPalette() {
    const host = $("vxPalette");
    host.innerHTML = "";
    for (const c of this.doc.palette) {
      const el = document.createElement("div");
      el.className = "vx-swatch" + (c === this.color ? " active" : "");
      el.style.background = c.hex;
      el.title = `${c.hex} 发光 ${(c.emissive * 100).toFixed(0)}%`;
      if ((c.emissive || 0) > 0.02) el.classList.add("glow");
      el.onclick = () => { this.color = c; this.renderPalette(); this.renderProps(); };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        const inp = document.createElement("input");
        inp.type = "color"; inp.value = c.hex;
        inp.oninput = () => { c.hex = inp.value; el.style.background = c.hex; this.view.rebuild(); };
        inp.click();
      };
      host.appendChild(el);
    }
    if (this.color) {
      const box = document.createElement("div");
      box.className = "vx-color-edit";
      box.innerHTML = `<label>发光 <input id="vxGlow" type="range" min="0" max="1" step="0.01" value="${this.color.emissive || 0}"/></label>
        <em id="vxGlowVal">${((this.color.emissive || 0) * 100).toFixed(0)}%</em>`;
      host.appendChild(box);
      box.querySelector("#vxGlow").oninput = (e) => {
        this.color.emissive = Number(e.target.value);
        box.querySelector("#vxGlowVal").textContent = (this.color.emissive * 100).toFixed(0) + "%";
        this.snapshot("发光");
        this.view.rebuild();
      };
    }
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
    const AX = ["X", "Y", "Z"];
    const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; host.appendChild(b); };
    AX.forEach((a, i) => mk("镜像" + a, () => this.voxOp((p) => transformVoxels(p, "mirror", i))));
    AX.forEach((a, i) => mk("旋转" + a + "90°", () => this.voxOp((p) => transformVoxels(p, "rot", i))));
    AX.forEach((a, i) => mk("翻转" + a, () => this.voxOp((p) => transformVoxels(p, "flip", i))));
    host.appendChild(btnRow([
      ["选区改色", () => this.applySelectionOp("paint")],
      ["选区删除", () => this.applySelectionOp("erase")],
      ["选区保留", () => this.applySelectionOp("crop")],
    ]));
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
    const sel = $("vxAnimSel");
    sel.innerHTML = "";
    this.doc.anims.forEach((a, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = a.name;
      sel.appendChild(o);
    });
    sel.value = this.doc.curAnim;
    const max = Math.max(24, this.view.frameBounds());
    $("vxScrub").max = max;
    $("vxFrameMax").textContent = max;
    const host = $("vxTracks");
    host.innerHTML = "";
    const anim = curAnim(this.doc);
    const rows = this.doc.bones.filter((b) => anim.tracks[b.id] && anim.tracks[b.id].length);
    for (const b of rows) {
      const row = document.createElement("div");
      row.className = "tl-row";
      row.innerHTML = `<span class="tl-bone">${esc(b.name)}</span>`;
      const lane = document.createElement("div");
      lane.className = "tl-lane";
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
      row.appendChild(lane);
      host.appendChild(row);
    }
    if (!rows.length) host.innerHTML = '<div class="vx-empty">选中骨骼并移动它，然后点 ◆ 创建帧</div>';
  }
  setFrame(f) {
    this.frame = Math.max(0, f);
    $("vxScrub").value = this.frame;
    $("vxFrameNum").textContent = this.frame;
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
