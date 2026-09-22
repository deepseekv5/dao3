// voxa/view.js — VOXA 视口：部件实例化渲染、骨骼层级与绑定、拾取、选择高亮、动画播放。
import * as THREE from "../../vendor/three/three.module.js";
import { OrbitControls } from "../../vendor/three/OrbitControls.js";
import { colorOf, hexToRgb, partIndex, bindDoc, invalidateIndex } from "./model.js";

const CUBE = new THREE.BoxGeometry(1, 1, 1);

export class VoxaView {
  constructor(canvas, doc) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    // 官方 VoxaEdit 视口是纯黑底 + 暗灰地面网格 + 贯穿网格的红(X)/蓝(Z)轴，
    // 不是 Arena 编辑器那种深蓝渐变。参照 vendor/box3-product-document/voxa/public/QQ20241113-*.png
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
    this.camera.position.set(28, 24, 34);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(4, 4, 4);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x30323a, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(30, 50, 20);
    this.scene.add(key, new THREE.AmbientLight(0xffffff, 0.35));
    this.grid = new THREE.GridHelper(64, 64, 0x3a3a3a, 0x1e1e1e);
    this.scene.add(this.grid);
    // 轴要拉满网格宽度，官方视口里红/蓝轴线是穿过整个地面的
    this.axes = new THREE.AxesHelper(64);
    this.axes.material.depthTest = false;
    this.scene.add(this.axes);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.partNodes = new Map();  // partId -> { group, mesh, emissive }
    this.boneNodes = new Map();  // boneId -> Object3D
    this.boneHelpers = new THREE.Group();
    this.scene.add(this.boneHelpers);
    this.boxHelpers = new THREE.Group();
    this.scene.add(this.boxHelpers);
    this.hoverMesh = this._marker(0x66ccff, 0.45);
    this.selMesh = this._marker(0xfc8308, 0.35);
    this.scene.add(this.hoverMesh, this.selMesh);
    this.raycaster = new THREE.Raycaster();
    this.ortho = false;
    this.showBones = true;
    this.showBoxes = true;
    this.onFrame = null;
    this.setDoc(doc);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }
  _marker(color, opacity) {
    const m = new THREE.InstancedMesh(CUBE, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, wireframe: false,
    }), 1);
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }
  setDoc(doc) {
    this.doc = doc;
    doc.parts.forEach((p) => bindDoc(p, doc));
    this.rebuild();
  }
  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const a = w / h;
    if (this.ortho) {
      const s = this._orthoSize || 20;
      this.camera = Object.assign(this.camera, {});
      const c = new THREE.OrthographicCamera(-s * a, s * a, s, -s, 0.1, 4000);
      c.position.copy(this.camera.position);
      c.quaternion.copy(this.camera.quaternion);
      this.camera = c;
      this.controls.object = c;
    } else if (this.camera.isOrthographicCamera) {
      const c = new THREE.PerspectiveCamera(50, a, 0.1, 4000);
      c.position.copy(this.camera.position);
      c.quaternion.copy(this.camera.quaternion);
      this.camera = c;
      this.controls.object = c;
    }
    if (this.camera.isPerspectiveCamera) { this.camera.aspect = a; }
    this.camera.updateProjectionMatrix();
  }
  setOrtho(on) { this._orthoSize = 22; this.ortho = !!on; this.resize(); }

  /* ---------------- 骨骼节点 ---------------- */
  buildBones() {
    for (const b of this.boneNodes.values()) b.parent && b.parent.remove(b);
    this.boneNodes.clear();
    this.boneHelpers.clear();
    for (const b of this.doc.bones) {
      const o = new THREE.Object3D();
      o.name = b.name;
      o.userData.boneId = b.id;
      this.boneNodes.set(b.id, o);
    }
    for (const b of this.doc.bones) {
      const o = this.boneNodes.get(b.id);
      const parent = b.parent && this.boneNodes.get(b.parent);
      (parent || this.root).add(o);
      o.position.set(...b.position);
      o.rotation.set(b.rotation.map(d => d * Math.PI / 180)[0] || 0, (b.rotation[1] || 0) * Math.PI / 180, (b.rotation[2] || 0) * Math.PI / 180);
      o.scale.set(b.scale[0] || 1, b.scale[1] || 1, b.scale[2] || 1);
      const h = new THREE.AxesHelper(2.2);
      h.userData.boneId = b.id;
      o.add(h);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0x50e3a4 }));
      dot.userData.boneId = b.id;
      o.add(dot);
      this.boneHelpers.add(o);
    }
    this.boneHelpers.visible = this.showBones;
  }
  /* ---------------- 部件网格 ---------------- */
  rebuild() {
    for (const [id, n] of this.partNodes) {
      if (n.group.parent) n.group.parent.remove(n.group);
      n.mesh && n.mesh.dispose();
    }
    this.partNodes.clear();
    this.buildBones();
    for (const p of this.doc.parts) this.rebuildPart(p);
    this.rebuildBoxes();
  }
  rebuildPart(part) {
    const doc = this.doc;
    let n = this.partNodes.get(part.id);
    if (n) {
      if (n.group.parent) n.group.parent.remove(n.group);
      n.mesh && n.mesh.dispose();
      n.emissive && n.emissive.dispose();
    }
    const group = new THREE.Group();
    group.name = part.name;
    group.userData.partId = part.id;
    const bone = part.bone && this.boneNodes.get(part.bone);
    (bone || this.root).add(group);
    const solid = [], glow = [];
    for (const v of part.voxels) {
      const c = colorOf(doc, v.c) || { hex: "#ffffff", emissive: 0 };
      const rgb = hexToRgb(c.hex);
      const rec = { x: v.x, y: v.y, z: v.z, rgb };
      ((c.emissive || 0) > 0.02 ? glow : solid).push(rec);
    }
    const mk = (list, factor) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(CUBE, new THREE.MeshLambertMaterial({ vertexColors: false }), list.length);
      mesh.userData.partId = part.id;
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      list.forEach((v, i) => {
        m.makeTranslation(v.x + 0.5, v.y + 0.5, v.z + 0.5);
        mesh.setMatrixAt(i, m);
        col.setRGB(Math.min(1, v.rgb[0] * factor), Math.min(1, v.rgb[1] * factor), Math.min(1, v.rgb[2] * factor));
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.list = list;
      group.add(mesh);
      return mesh;
    };
    const mesh = mk(solid, 1);
    const emissive = mk(glow, 1.9);
    if (emissive) emissive.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    n = { group, mesh, emissive, part };
    this.partNodes.set(part.id, n);
    this.applyPartTransform(part);
    group.visible = part.visible !== false;
  }
  /* 外部部件预览：把参照模型的全部体素合成一层半透明幽灵，不影响当前作品 */
  setExternal(refDoc, opacity = 0.28) {
    this.clearExternal();
    if (!refDoc || !refDoc.parts) return null;
    const list = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const part of refDoc.parts) {
      if (part.visible === false) continue;
      e.set(part.rot[0] * Math.PI / 180, part.rot[1] * Math.PI / 180, part.rot[2] * Math.PI / 180);
      q.setFromEuler(e); v3.set(...part.pos); sc.set(part.scale[0] || 1, part.scale[1] || 1, part.scale[2] || 1);
      for (const vox of part.voxels) {
        const c = colorOf(refDoc, vox.c) || { hex: "#ffffff" };
        const rgb = hexToRgb(c.hex);
        const p = new THREE.Vector3(vox.x + 0.5, vox.y + 0.5, vox.z + 0.5).multiply(sc).applyQuaternion(q).add(v3);
        list.push({ x: p.x, y: p.y, z: p.z, rgb });
      }
    }
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(CUBE, new THREE.MeshLambertMaterial({
      transparent: true, opacity, depthWrite: false, color: 0xffffff,
    }), list.length);
    const mm = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((v, i) => { mm.makeTranslation(v.x, v.y, v.z); mesh.setMatrixAt(i, mm); col.setRGB(v.rgb[0], v.rgb[1], v.rgb[2]); mesh.setColorAt(i, col); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = -1;
    this.external = mesh;
    this.root.add(mesh);
    return mesh;
  }
  clearExternal() {
    if (!this.external) return;
    this.external.parent && this.external.parent.remove(this.external);
    this.external.geometry && this.external.geometry.dispose && this.external.geometry.dispose();
    this.external.material && this.external.material.dispose && this.external.material.dispose();
    this.external = null;
  }
  applyPartTransform(part) {
    const n = this.partNodes.get(part.id);
    if (!n) return;
    n.group.position.set(...part.pos);
    n.group.rotation.set(part.rot[0] * Math.PI / 180, part.rot[1] * Math.PI / 180, part.rot[2] * Math.PI / 180);
    n.group.scale.set(part.scale[0] || 1, part.scale[1] || 1, part.scale[2] || 1);
  }
  rebuildBoxes() {
    this.boxHelpers.clear();
    for (const p of this.doc.parts) {
      const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2])),
        // 官方部件框是细白线（选中态更亮），不是 Arena 的橙色
        new THREE.LineBasicMaterial({ color: p === this.activePart ? 0xe8e8e8 : 0x565656 }));
      box.position.set(p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2);
      box.userData.partId = p.id;
      const bone = p.bone && this.boneNodes.get(p.bone);
      (bone || this.root).add(box);
      this.boxHelpers.add(box);
    }
    this.boxHelpers.visible = this.showBoxes;
  }
  setActivePart(part) { this.activePart = part; this.rebuildBoxes(); }
  setBoneVisible(on) { this.showBones = on; this.boneHelpers.visible = on; }
  setBoxesVisible(on) { this.showBoxes = on; this.boxHelpers.visible = on; }
  /** 物理界面：官方把模型画成半透明，好让人看清碰撞盒与模型的关系 */
  setGhostMode(on) {
    this.ghost = !!on;
    for (const n of this.partNodes.values()) {
      if (!n.mesh) continue;
      n.mesh.material.transparent = this.ghost || n.mesh.material.userData?.baseTransparent || false;
      n.mesh.material.opacity = this.ghost ? 0.42 : (n.mesh.material.userData?.baseOpacity ?? 1);
      n.mesh.material.needsUpdate = true;
      if (n.emissive) { n.emissive.visible = !this.ghost; }
    }
    // 碰撞盒在物理界面要始终可见，哪怕用户在部件层关掉了框
    if (on) this.boxHelpers.visible = true;
  }

  /* ---------------- 拾取 ---------------- */
  ndc(ev) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 };
  }
  pickVoxel(ev) {
    const doc = this.doc;
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const meshes = [];
    for (const p of doc.parts) {
      const n = this.partNodes.get(p.id);
      if (!n || n.group.visible === false) continue;
      if (n.mesh) meshes.push(n.mesh);
      if (n.emissive) meshes.push(n.emissive);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const partId = h.object.userData.partId;
    const part = doc.parts.find((p) => p.id === partId);
    if (!part) return null;
    const list = h.object.userData.list || [];
    const cell = list[h.instanceId];
    if (!cell) return null;
    const nrm = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    nrm.transformDirection(h.object.matrixWorld).round();
    return {
      part, cell: [cell.x, cell.y, cell.z], normal: [nrm.x, nrm.y, nrm.z],
      adjacent: [cell.x + Math.round(nrm.x), cell.y + Math.round(nrm.y), cell.z + Math.round(nrm.z)],
      point: h.point, distance: h.distance,
    };
  }
  pickBone(ev) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const hits = this.raycaster.intersectObjects(this.boneHelpers.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.boneId) o = o.parent;
      if (o) return this.doc.bones.find((b) => b.id === o.userData.boneId) || null;
    }
    return null;
  }
  pickPlane(ev, y) {
    this.raycaster.setFromCamera(this.ndc(ev), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, pt) ? [Math.floor(pt.x), Math.floor(pt.y), Math.floor(pt.z)] : null;
  }
  /* ---------------- 高亮 ---------------- */
  showHover(cells) {
    const list = cells ? (Array.isArray(cells[0]) ? cells : [cells]) : [];
    this.hoverMesh.count = Math.min(list.length, 64);
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.hoverMesh.count; i++) {
      m.makeTranslation(list[i][0] + 0.5, list[i][1] + 0.5, list[i][2] + 0.5);
      this.hoverMesh.setMatrixAt(i, m);
    }
    this.hoverMesh.instanceMatrix.needsUpdate = true;
  }
  showSelection(cells) {
    const list = cells || [];
    this.selMesh.count = Math.min(list.length, 4000);
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.selMesh.count; i++) {
      m.makeTranslation(list[i][0] + 0.5, list[i][1] + 0.5, list[i][2] + 0.5);
      this.selMesh.setMatrixAt(i, m);
    }
    this.selMesh.instanceMatrix.needsUpdate = true;
  }
  /* ---------------- 动画播放 ---------------- */
  applyPose(doc, anim, frame) {
    for (const b of doc.bones) {
      const o = this.boneNodes.get(b.id);
      if (!o) continue;
      o.position.set(...b.position);
      o.rotation.set(b.rotation[0] * Math.PI / 180, b.rotation[1] * Math.PI / 180, b.rotation[2] * Math.PI / 180);
      o.scale.set(b.scale[0] || 1, b.scale[1] || 1, b.scale[2] || 1);
      o.userData.op = 1;
    }
    if (!anim) return;
    for (const [boneId, keys] of Object.entries(anim.tracks)) {
      const b = doc.bones.find((x) => x.id === boneId);
      const o = this.boneNodes.get(boneId);
      if (!b || !o) continue;
      const s = sampleKeys(keys, frame);
      if (!s) continue;
      o.position.set(...s.pos);
      o.rotation.set(s.rot[0] * Math.PI / 180, s.rot[1] * Math.PI / 180, s.rot[2] * Math.PI / 180);
      o.scale.set(...s.scale);
      o.userData.op = s.op ?? 1;
    }
    for (const p of doc.parts) {
      const n = this.partNodes.get(p.id);
      if (!n) continue;
      let op = 1;
      if (p.bone) {
        const chain = [];
        let cur = this.doc.bones.find((b) => b.id === p.bone);
        while (cur) { chain.push(cur.id); cur = this.doc.bones.find((b) => b.id === cur.parent); }
        for (const id of chain) {
          const o = this.boneNodes.get(id);
          if (o && o.userData.op != null) op = Math.min(op, o.userData.op);
        }
      }
      for (const mesh of [n.mesh, n.emissive]) {
        if (!mesh) continue;
        mesh.material.transparent = op < 0.999;
        mesh.material.opacity = op;
      }
      n.group.visible = p.visible !== false && op > 0.02;
    }
  }
  frameBounds() {
    let max = 0;
    for (const a of this.doc.anims) for (const keys of Object.values(a.tracks)) for (const k of keys) max = Math.max(max, k.f);
    return max;
  }
  resetPose() { this.applyPose(this.doc, null, 0); }
  _loop() {
    requestAnimationFrame(this._loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame();
  }
  focus() {
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], any = false;
    for (const p of this.doc.parts) {
      any = true;
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p.pos[a]);
        hi[a] = Math.max(hi[a], p.pos[a] + p.size[a] * (p.scale[a] || 1));
      }
    }
    if (!any) return;
    const c = lo.map((v, i) => (v + hi[i]) / 2);
    const span = Math.max(8, ...hi.map((v, i) => v - lo[i]));
    this.controls.target.set(c[0], c[1], c[2]);
    this.camera.position.set(c[0] + span * 1.4, c[1] + span * 1.1, c[2] + span * 1.6);
    this._orthoSize = span * 0.9;
    this.resize();
  }
}
function sampleKeys(keys, frame) {
  if (!keys || !keys.length) return null;
  if (frame <= keys[0].f) return keys[0];
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].f < frame) i++;
  const a = keys[i], b = keys[i + 1];
  const t = (frame - a.f) / Math.max(1, b.f - a.f);
  const E = { normal: t, in: t * t, out: 1 - (1 - t) * (1 - t), inout: t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, step: 0 };
  const k = E[b.ease || "normal"] ?? t;
  const mix = (f) => [0, 1, 2].map((j) => a[f][j] + (b[f][j] - a[f][j]) * k);
  return { pos: mix("pos"), rot: mix("rot"), scale: mix("scale"), op: (a.op ?? 1) + ((b.op ?? 1) - (a.op ?? 1)) * k };
}
