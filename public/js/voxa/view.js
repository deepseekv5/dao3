// voxa/view.js — VOXA 视口：部件实例化渲染、骨骼层级与绑定、拾取、选择高亮、动画播放。
import * as THREE from "../../vendor/three/three.module.js";
import { OrbitControls } from "../../vendor/three/OrbitControls.js";
import { colorOf, hexToRgb, partIndex, bindDoc, invalidateIndex, contourEdges } from "./model.js";

const CUBE = new THREE.BoxGeometry(1, 1, 1);
// 部件框：一根单位立方体的 12 条棱，靠每个框自己的 scale 拉成实际尺寸。
// 原来每个部件各建一份 BoxGeometry + EdgesGeometry，而拖拽位置/旋转时每帧都要
// rebuildBoxes()——15 个部件就是每帧 30 次几何分配，这棵树在换肤模板上直接卡手。
const UNIT_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const BOX_MAT = new THREE.LineBasicMaterial({ color: 0x565656 });
const BOX_MAT_ACTIVE = new THREE.LineBasicMaterial({ color: 0xe8e8e8 });
// 骨骼关节点：全部骨骼共用一颗球（材质也是），重建时不能顺手 dispose 掉它
const DOT_GEO = new THREE.SphereGeometry(0.22, 10, 8);
const DOT_MAT = new THREE.MeshBasicMaterial({ color: 0x50e3a4 });
const _v3 = new THREE.Vector3();
const HOVER_MAX = 64, SEL_MAX = 4000;   // 高亮层容量：改这里要同时改 _marker 的分配

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
    // 官方口径（voxels/shortcutKeys.md）：右键旋转、中键平移，左键归工具。
    // OrbitControls 的默认映射是 LEFT=旋转 / MIDDLE=推拉 / RIGHT=平移，不覆盖的话
    // "用工具拖一下"会同时把视角转走——底栏那句提示当时就是假的。
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
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
    this.boneNodes = new Map();  // boneId -> Object3D（保留在父子链里）
    this.boneMarkers = [];       // 每根骨骼的坐标轴+关节点球，显隐只关这一层
    this.boxHelpers = new THREE.Group();
    this.scene.add(this.boxHelpers);
    // 模型中心点标记（官方全局工具栏"调整模型中心点"）：三轴小箭头 + 一颗点
    this.pivotMarker = new THREE.AxesHelper(2.6);
    this.pivotMarker.visible = false;
    this.scene.add(this.pivotMarker);
    this.hoverMesh = this._marker(0x66ccff, 0.45, HOVER_MAX);
    this.selMesh = this._marker(0x00e5ff, 0.35, SEL_MAX);
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
  _marker(color, opacity, cap) {
    // 容量必须由调用方给：以前这里写死 1，而 showSelection 往 up-to-4000 个实例上写，
    // 越界的部分静默落在 Float32Array 之外——于是框选一片只亮一格，
    // 看起来像"框选根本不工作"。
    const m = new THREE.InstancedMesh(CUBE, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, wireframe: false,
    }), cap);
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
    // 骨骼集与父子关系没变就别重建节点：拖动骨骼位移/旋转的回调每帧都在调这里，
    // 整树重建会把挂在骨骼下的部件与框一并摘掉（画面上的小人拖一下就少一块），
    // 而且白扔十几个 AxesHelper。结构真变了才重建，并把部件重新挂回新的父节点。
    const sig = this.doc.bones.map((b) => `${b.id}>${b.parent || ""}`).join("|");
    if (sig !== this._boneSig || this.boneNodes.size !== this.doc.bones.length) {
      for (const b of this.boneNodes.values()) b.parent && b.parent.remove(b);
      this.boneNodes.clear();
      this.clearMarkers();
      this._boneSig = sig;
      for (const b of this.doc.bones) {
        const o = new THREE.Object3D();
        o.name = b.name;
        o.userData.boneId = b.id;
        this.boneNodes.set(b.id, o);
      }
      for (const b of this.doc.bones) {
        const o = this.boneNodes.get(b.id);
        const parent = b.parent && this.boneNodes.get(b.parent);
        // 骨骼节点必须留在父子链里：b.position 存的是**相对父骨骼**的偏移。
        // 之前这里最后又 boneHelpers.add(o)，等于把每根骨骼从链上摘下来平铺到
        // 场景级辅助组——于是 hips 的 +8 格没了、torso 只剩自己的 +3 格，
        // 挂在骨骼下的部件又用绝对位置，整个小人直接散架（换肤模板那些 bug 的真因）。
        (parent || this.root).add(o);
        // 关节标记单独包一层：骨骼下面挂着部件，开关"显示骨骼"只能关标记，
        // 关骨骼节点会把用户的部件一起藏掉。
        const mk = new THREE.Group();
        mk.userData.boneId = b.id;
        mk.add(new THREE.AxesHelper(2.2), new THREE.Mesh(DOT_GEO, DOT_MAT));
        mk.visible = this.showBones;
        o.add(mk);
        this.boneMarkers.push(mk);
      }
      this.reattachParts();
    }
    for (const b of this.doc.bones) {
      const o = this.boneNodes.get(b.id);
      if (!o) continue;
      o.position.set(...b.position);
      o.rotation.set((b.rotation[0] || 0) * Math.PI / 180, (b.rotation[1] || 0) * Math.PI / 180, (b.rotation[2] || 0) * Math.PI / 180);
      o.scale.set(b.scale[0] || 1, b.scale[1] || 1, b.scale[2] || 1);
    }
  }
  /** 骨骼树换过一次之后，把部件与部件框挂回各自的骨骼节点（或根） */
  reattachParts() {
    for (const p of this.doc.parts) {
      const n = this.partNodes.get(p.id);
      if (!n) continue;
      const bone = p.bone && this.boneNodes.get(p.bone);
      (bone || this.root).add(n.group);
    }
    this.rebuildBoxes();
  }
  clearMarkers() {
    for (const mk of this.boneMarkers) {
      for (const c of mk.children) {
        // DOT_GEO/DOT_MAT 是模块级共享资源，只有 AxesHelper 自己那份需要释放
        if (c.geometry && c.geometry !== DOT_GEO) c.geometry.dispose();
        if (c.material && c.material !== DOT_MAT) c.material.dispose();
      }
      mk.parent && mk.parent.remove(mk);
    }
    this.boneMarkers = [];
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
      this.dropContour(n);
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
    // 自发光那层不吃光照，所以材质要换成 MeshBasicMaterial，但必须留着 mk() 里
    // 按色相算好的 instanceColor——换材质可以，把颜色换成白色那笔是多余的。
    if (emissive) {
      const lit = emissive.material;
      emissive.material = new THREE.MeshBasicMaterial({ vertexColors: false });
      lit.dispose();
    }
    n = { group, mesh, emissive, part };
    this.partNodes.set(part.id, n);
    // 部件不透明度是数据（官方属性面板就有这一行），重建材质时必须重新贴上去，
    // 并把"基础值"记进 userData：物理模式的幽灵态会在它之上再乘一层。
    const op = part.opacity ?? 1;
    for (const m of [mesh, emissive]) {
      if (!m) continue;
      m.material.userData.baseOpacity = op;
      m.material.userData.baseTransparent = op < 0.999;
      m.material.transparent = op < 0.999;
      m.material.opacity = op;
    }
    // 边缘线 / 发光显隐是视口级偏好，而这里每次都新建材质，
    // 所以必须把当前开关重新贴上去——否则放一个体素就把用户设的边缘线悄悄关掉了
    const wire = this.edgeMode === "all";
    if (mesh) mesh.material.wireframe = wire;
    if (emissive) { emissive.material.wireframe = wire; emissive.visible = this._glowOn !== false; }
    if (this.edgeMode === "contour") this.rebuildContourFor(part);
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
  /** 默认皮肤底模：官方换肤模式打开就是"一套已绑好骨骼的角色"，我们那份现成的
   *  是 CC0 的 ATLAS-09 机甲。它只是参照：不进作品、不进导出、不参与拾取，
   *  但它的真实关节位置会被 app.fitBonesToRig() 读回去贴到骨骼上。 */
  async setRigReference(url, { opacity = 0.5, height = 22 } = {}) {
    this.clearRigReference();
    const { loadRigScene, autoMap, boneNames, deriveFacing } = await import("../skin-rig.js");
    const scene = await loadRigScene(url);
    const map = autoMap(boneNames(scene));
    const g = new THREE.Group();
    g.add(scene);
    // 体素编辑器的"前"是 +Z，而 glTF 导出时脸朝哪只有模型自己知道。
    // 由左右关节叉乘推出来再转正——照一台侧身的底模画皮肤是灾难。
    const fwd = deriveFacing(scene, map);
    g.rotation.y = Math.atan2(fwd.x, fwd.z);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const k = height / (box.max.y - box.min.y || 1);
    g.scale.setScalar(k);
    g.position.set(-(box.max.x + box.min.x) / 2 * k, -box.min.y * k, -(box.max.z + box.min.z) / 2 * k);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.raycast = () => {};
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!m) continue;
        m.transparent = true; m.opacity = opacity; m.depthWrite = false;
      }
    });
    g.renderOrder = -1;
    g.userData.url = url;
    g.userData.autoMap = map;
    this.root.add(g);
    this.rigRef = g;
    return g;
  }
  /** 底模里真实存在的节点名（映射表写错时用它当场纠正） */
  rigBoneNames() {
    if (!this.rigRef) return null;
    const out = new Set();
    this.rigRef.traverse((o) => { if (o.name) out.add(o.name); });
    return out;
  }
  /** 底模上这些关节名的模型空间位置（体素单位）。没载入参照就返回 null。 */
  rigJointPositions(names) {
    if (!this.rigRef) return null;
    this.root.updateWorldMatrix(true, false);
    const byName = new Map();
    this.rigRef.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
    const out = new Map();
    const v = new THREE.Vector3();
    for (const n of names || []) {
      const b = byName.get(n);
      if (!b) continue;
      b.getWorldPosition(v);
      this.root.worldToLocal(v);
      out.set(n, [v.x, v.y, v.z]);
    }
    return out;
  }
  setRigVisible(on) { if (this.rigRef) this.rigRef.visible = !!on; }
  clearRigReference() {
    if (!this.rigRef) return;
    this.rigRef.parent && this.rigRef.parent.remove(this.rigRef);
    this.rigRef.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry && o.geometry.dispose && o.geometry.dispose();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m && m.dispose && m.dispose();
    });
    this.rigRef = null;
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
      const box = new THREE.LineSegments(UNIT_EDGES,
        // 官方部件框是细白线（选中态更亮），不是实心块
        p === this.activePart ? BOX_MAT_ACTIVE : BOX_MAT);
      // 框必须跟着部件自己的旋转/缩放走：只摆位置的话，把部件转 90° 之后
      // 屏幕上那根框还停在原地，"选没选中"就变成猜。
      const sc = [p.scale[0] || 1, p.scale[1] || 1, p.scale[2] || 1];
      const dim = [p.size[0] * sc[0], p.size[1] * sc[1], p.size[2] * sc[2]];
      box.position.set(p.pos[0] + dim[0] / 2, p.pos[1] + dim[1] / 2, p.pos[2] + dim[2] / 2);
      box.rotation.set(p.rot[0] * Math.PI / 180, p.rot[1] * Math.PI / 180, p.rot[2] * Math.PI / 180);
      box.scale.set(dim[0], dim[1], dim[2]);
      box.userData.partId = p.id;
      const bone = p.bone && this.boneNodes.get(p.bone);
      (bone || this.root).add(box);
      this.boxHelpers.add(box);
    }
    this.boxHelpers.visible = this.showBoxes;
  }
  /** 只重绘"用得到这个颜色"的那几个部件。
   *  系统取色器每动一下就来一次，整场景 rebuild 在 128 部件的模型上会明显卡手。 */
  rebuildColors(colorId) {
    for (const p of this.doc.parts) {
      if (p.voxels.some((v) => v.c === colorId)) this.rebuildPart(p);
    }
    this.rebuildBoxes();
  }
  setActivePart(part) { this.activePart = part; this.rebuildBoxes(); }
  /** 「局部 / 世界坐标」要有真实差别，靠的就是渲染层这条现成的父子链：
   *  部件挂在骨骼节点下、骨骼再挂在父骨骼下，所以世界位置 = 链上变换 ∘ 部件局部位置。
   *  自己另拼一遍父链就会和 applyPose 分叉——动画播到一半时面板数字对不上画面。 */
  partWorldPos(part) {
    const n = this.partNodes.get(part.id);
    if (!n) return part.pos.slice();
    n.group.updateWorldMatrix(true, false);
    const v = new THREE.Vector3();
    n.group.getWorldPosition(v);
    return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  }
  partPosFromWorld(part, world) {
    const n = this.partNodes.get(part.id);
    if (!n || !n.group.parent) return world.slice();
    n.group.updateWorldMatrix(true, false);
    const v = n.group.parent.worldToLocal(new THREE.Vector3(world[0], world[1], world[2]));
    return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  }
  setBoneVisible(on) {
    this.showBones = on;
    for (const mk of this.boneMarkers) mk.visible = on;
  }
  /** 边缘线三档（官方 auxiliaryToolbar.md 里它是下拉框，不是二值开关）：
   *    hide     不画
   *    contour  只画"暴露面的外边界"——官方截图里那种干净的格子线
   *    all      每个立方体的 12 条棱全画（含被挡住的内部面），就是原来的 wireframe
   *  以前只有 wireframe 一档：内部面全画出来，密一点的模型糊成一片噪点。 */
  setEdgeMode(mode) {
    this.edgeMode = mode === "all" || mode === "contour" ? mode : "hide";
    for (const n of this.partNodes.values()) {
      if (n.mesh) n.mesh.material.wireframe = this.edgeMode === "all";
      if (n.emissive) n.emissive.material.wireframe = this.edgeMode === "all";
    }
    if (this.edgeMode === "contour") this.rebuildContours();
    else this.dropContours();
  }
  dropContours() {
    for (const n of this.partNodes.values()) this.dropContour(n);
  }
  dropContour(n) {
    if (!n || !n.contour) return;
    n.contour.parent && n.contour.parent.remove(n.contour);
    n.contour.geometry.dispose();
    n.contour.material.dispose();
    n.contour = null;
  }
  /** 轮廓线段数据在 model.contourEdges（纯函数，能在裸 Node 里单测）；这里只负责贴到场景上 */
  contourGeometry(part) { return contourEdges(part); }
  rebuildContours() {
    for (const p of this.doc.parts) this.rebuildContourFor(p);
  }
  /** 单个部件重算：放一个体素就重建整模型的所有轮廓线，128 部件时会明显卡手 */
  rebuildContourFor(part) {
    const n = this.partNodes.get(part.id);
    if (!n) return;
    this.dropContour(n);
    if (this.edgeMode !== "contour" || part.visible === false) return;
    const arr = this.contourGeometry(part);
    if (!arr.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    // 挂在部件自己的 group 下：轮廓线用的是部件局部坐标，挂到场景根上就等于
    // 无视部件的位置/旋转/缩放——部件一挪，线就留在原地。
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x101018 }));
    line.userData.partId = part.id;
    n.group.add(line);
    n.contour = line;
  }
  setBoxesVisible(on) { this.showBoxes = on; this.boxHelpers.visible = on; }
  /** 物理界面：官方把模型画成半透明，好让人看清碰撞盒与模型的关系 */
  setGhostMode(on) {
    this.ghost = !!on;
    for (const n of this.partNodes.values()) {
      if (!n.mesh) continue;
      // 半透明开关必须跟着"基础不透明度"走：只认 baseTransparent（没人写过它）
      // 会让幽灵态退出时把 transparent 冲回 false——opacity 还是 0.4，
      // 但材质没开混合，于是部件不透明度看着"设上了却没效果"。
      const base = n.mesh.material.userData?.baseOpacity ?? 1;
      n.mesh.material.transparent = this.ghost || base < 0.999;
      n.mesh.material.opacity = this.ghost ? 0.42 : base;
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
    const hits = this.raycaster.intersectObjects(this.boneMarkers, true);
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
    this.hoverMesh.count = Math.min(list.length, HOVER_MAX);
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.hoverMesh.count; i++) {
      m.makeTranslation(list[i][0] + 0.5, list[i][1] + 0.5, list[i][2] + 0.5);
      this.hoverMesh.setMatrixAt(i, m);
    }
    this.hoverMesh.instanceMatrix.needsUpdate = true;
  }
  showSelection(cells) {
    const list = cells || [];
    this.selMesh.count = Math.min(list.length, SEL_MAX);
    // 超出容量只画前若干格，但必须说出来：数据是全的、操作照常，只有高亮是截的。
    if (list.length > SEL_MAX && this.onClamp) this.onClamp(list.length, SEL_MAX);
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
      // 骨骼自己的不透明度是基准值。这里先前写死 1，于是滑杆调完、
      // 只要 applyPose 再跑一遍（每帧都会）读数就回到 100%。
      o.userData.op = b.op ?? 1;
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
      // 部件自身的不透明度是基础值，骨骼链上的 op 再往下乘：
      // 官方就是这两条通道叠加（部件可透明 + 不透明度可 K 帧做显隐动画）。
      let op = p.opacity ?? 1;
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
    if (!any) {
      // 换肤作品刚打开时一个部件都没有：这时要框住底模（没底模就框骨骼），
      // 否则相机停在初始位置上，画面里只剩机甲的一条腿，看着像模型坏了。
      if (this.rigRef) {
        const b = new THREE.Box3().setFromObject(this.rigRef);
        if (!b.isEmpty()) { lo = [b.min.x, b.min.y, b.min.z]; hi = [b.max.x, b.max.y, b.max.z]; any = true; }
      }
      if (!any && this.doc.bones.length) {
        for (const b of this.doc.bones) {
          const o = this.boneNodes.get(b.id);
          if (!o) continue;
          o.getWorldPosition(_v3);
          any = true;
          for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], _v3[a]); hi[a] = Math.max(hi[a], _v3[a]); }
        }
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
